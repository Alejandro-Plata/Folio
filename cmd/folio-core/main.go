// folio-core es el núcleo de Folio para el escritorio: lo lanza la ventana
// (Electron) y habla con ella por stdin/stdout con una línea JSON por mensaje.
//
//	petición:  {"id": 7, "method": "GetDoc", "args": ["…"]}
//	respuesta: {"id": 7, "result": …}   o   {"id": 7, "error": "…"}
//	evento:    {"event": "sync:progress", "data": [3, 10]}
//
// Cualquier método exportado de desktop.App (y de core.Service) se puede
// llamar por su nombre, con el mismo despachador que usa Android.
package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"os/signal"
	"sync"
	"syscall"

	"folio/internal/core"
	"folio/internal/desktop"
)

// Version se sobrescribe al compilar: -ldflags "-X main.Version=1.2.3"
var Version = "1.0.0"

type request struct {
	ID     int64           `json:"id"`
	Method string          `json:"method"`
	Args   json.RawMessage `json:"args"`
}

type response struct {
	ID     int64           `json:"id"`
	Result json.RawMessage `json:"result,omitempty"`
	Error  string          `json:"error,omitempty"`
}

type event struct {
	Event string `json:"event"`
	Data  []any  `json:"data"`
}

func main() {
	log.SetFlags(0)
	log.SetPrefix("folio-core: ")
	if len(os.Args) > 1 && os.Args[1] == "--version" {
		fmt.Println(Version)
		return
	}
	out := &writer{w: bufio.NewWriterSize(os.Stdout, 1<<16)}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	app, err := desktop.New(ctx, Version, func(name string, data ...any) {
		out.send(event{Event: name, Data: data})
	})
	if err != nil {
		log.Fatal(err)
	}
	// Al cerrar la ventana (stdin cerrado) o con una señal, se guarda lo pendiente
	var once sync.Once
	quit := func() { once.Do(func() { app.Close(); cancel() }) }
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
	go func() { <-sig; quit(); os.Exit(0) }()

	in := bufio.NewReaderSize(os.Stdin, 1<<20)
	var wg sync.WaitGroup
	for {
		line, err := in.ReadBytes('\n')
		if len(line) > 1 {
			var req request
			if jerr := json.Unmarshal(line, &req); jerr != nil {
				log.Printf("mensaje no válido: %v", jerr)
			} else {
				wg.Add(1)
				go func() { defer wg.Done(); out.send(call(app, req)) }()
			}
		}
		if err != nil {
			if err != io.EOF {
				log.Print(err)
			}
			break
		}
	}
	wg.Wait()
	quit()
}

func call(app *desktop.App, req request) (res response) {
	res.ID = req.ID
	defer func() {
		if r := recover(); r != nil {
			res.Result, res.Error = nil, fmt.Sprintf("error interno en %s: %v", req.Method, r)
		}
	}()
	result, err := core.Dispatch(app, req.Method, string(req.Args))
	if err != nil {
		res.Error = err.Error()
		return
	}
	res.Result = json.RawMessage(result)
	return
}

// writer serializa las líneas: las respuestas y los eventos llegan de varias goroutines.
type writer struct {
	mu sync.Mutex
	w  *bufio.Writer
}

func (o *writer) send(v any) {
	b, err := json.Marshal(v)
	if err != nil {
		log.Printf("no se pudo serializar: %v", err)
		return
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	o.w.Write(b)
	o.w.WriteByte('\n')
	o.w.Flush()
}
