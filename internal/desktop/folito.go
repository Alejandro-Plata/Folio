package desktop

import (
	"bytes"
	"cmp"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	goruntime "runtime"
	"strconv"
	"sync"
	"time"

	"folio/internal/paths"
)

// Folito: asistente de la agenda con un modelo de lenguaje pequeño que corre en
// el propio equipo (llama.cpp), sin conexión ni cuentas. El motor
// (llama-server) va junto a Folio, como whisper-cli; el modelo se descarga una
// vez a la carpeta de datos.
//
// El servidor se arranca con la primera pregunta, escucha solo en 127.0.0.1 y
// se para tras unos minutos sin uso para devolver la memoria. La respuesta se
// fuerza a un JSON con el esquema que manda la interfaz: el modelo no inventa
// el formato, solo rellena los campos.

type folitoModel struct {
	File   string
	URL    string
	Size   int64  // bytes aproximados, para la barra de progreso
	SHA256 string // vacío = sin comprobar
}

// Qwen2.5 1.5B Instruct (licencia Apache 2.0), cuantizado a 4 bits. Medido con
// 24 frases y 4 hilos (como un i5 de 12.ª gen. serie U): acierta 23, con 1,2-1,6 s
// por pregunta. El de 0,5B es el doble de rápido pero acierta 20.
var folitoModels = map[string]folitoModel{
	"qwen2.5-1.5b": {File: "qwen2.5-1.5b-instruct-q4_k_m.gguf", Size: 1_117_320_736,
		SHA256: "6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e",
		URL:    "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf"},
}

const folitoDefault = "qwen2.5-1.5b"

// Minutos sin preguntas tras los que se para el servidor.
const folitoIdle = 10 * time.Minute

type folito struct {
	mu     sync.Mutex
	cmd    *exec.Cmd
	port   int
	model  string
	idle   *time.Timer
	cancel context.CancelFunc // descarga en curso
}

type FolitoInfo struct {
	Model       string `json:"model"`
	ModelReady  bool   `json:"modelReady"`
	ModelSize   int64  `json:"modelSize"`
	EngineReady bool   `json:"engineReady"`
	Downloading bool   `json:"downloading"`
	Running     bool   `json:"running"`
}

// FolitoRequest es una pregunta: instrucciones, frase del usuario y el esquema
// JSON al que se ajusta la respuesta.
type FolitoRequest struct {
	System string          `json:"system"`
	User   string          `json:"user"`
	Schema json.RawMessage `json:"schema"`
	// MaxTokens limita la respuesta (0 = 400). El precalentado usa 1: solo
	// interesa que el servidor procese y guarde las instrucciones.
	MaxTokens int `json:"maxTokens,omitempty"`
}

func folitoModelPath(name string) string {
	m, ok := folitoModels[name]
	if !ok {
		m = folitoModels[folitoDefault]
	}
	return filepath.Join(modelsDir(), m.File)
}

// findLlama busca llama-server junto al ejecutable, en la carpeta de datos o en el PATH.
func findLlama() string {
	name := "llama-server"
	if goruntime.GOOS == "windows" {
		name += ".exe"
	}
	var dirs []string
	if exe, err := os.Executable(); err == nil {
		dirs = append(dirs, filepath.Dir(exe))
	}
	dirs = append(dirs, filepath.Join(paths.DataDir(), "bin"))
	for _, d := range dirs {
		p := filepath.Join(d, name)
		if st, err := os.Stat(p); err == nil && !st.IsDir() {
			return p
		}
	}
	if p, err := exec.LookPath(name); err == nil {
		return p
	}
	return ""
}

// FolitoStatus indica si el motor y el modelo están listos.
func (a *App) FolitoStatus() FolitoInfo {
	info := FolitoInfo{Model: folitoDefault, ModelSize: folitoModels[folitoDefault].Size}
	if st, err := os.Stat(folitoModelPath(folitoDefault)); err == nil {
		info.ModelReady, info.ModelSize = true, st.Size()
	}
	info.EngineReady = findLlama() != ""
	a.folito.mu.Lock()
	info.Downloading, info.Running = a.folito.cancel != nil, a.folito.cmd != nil
	a.folito.mu.Unlock()
	return info
}

// FolitoDownload descarga el modelo con progreso (evento «folito:download»).
func (a *App) FolitoDownload() error {
	m := folitoModels[folitoDefault]
	a.folito.mu.Lock()
	if a.folito.cancel != nil {
		a.folito.mu.Unlock()
		return errors.New("ya hay una descarga en curso")
	}
	ctx, cancel := context.WithCancel(context.Background())
	a.folito.cancel = cancel
	a.folito.mu.Unlock()
	defer func() {
		a.folito.mu.Lock()
		a.folito.cancel = nil
		a.folito.mu.Unlock()
		cancel()
	}()
	return downloadFile(ctx, m.URL, folitoModelPath(folitoDefault), m.Size, m.SHA256, func(done, total int64) { a.emit("folito:download", done, total) })
}

// FolitoCancelDownload detiene la descarga (se puede reanudar después).
func (a *App) FolitoCancelDownload() {
	a.folito.mu.Lock()
	defer a.folito.mu.Unlock()
	if a.folito.cancel != nil {
		a.folito.cancel()
	}
}

// FolitoDelete para el servidor y borra el modelo para liberar espacio.
func (a *App) FolitoDelete() error {
	a.folito.stop()
	err := os.Remove(folitoModelPath(folitoDefault))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}

// FolitoAsk hace una pregunta y devuelve el JSON que ha rellenado el modelo.
func (a *App) FolitoAsk(req FolitoRequest) (string, error) {
	port, err := a.folito.ensure(folitoDefault)
	if err != nil {
		return "", err
	}
	body := map[string]any{
		"messages":     []map[string]string{{"role": "system", "content": req.System}, {"role": "user", "content": req.User}},
		"temperature":  0.1,
		"max_tokens":   cmp.Or(req.MaxTokens, 400),
		"cache_prompt": true, // las instrucciones se repiten: no se vuelven a procesar
	}
	if len(req.Schema) > 0 {
		body["response_format"] = map[string]any{"type": "json_schema", "json_schema": map[string]any{"name": "folito", "schema": req.Schema}}
	}
	raw, _ := json.Marshal(body)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	hreq, _ := http.NewRequestWithContext(ctx, http.MethodPost, fmt.Sprintf("http://127.0.0.1:%d/v1/chat/completions", port), bytes.NewReader(raw))
	hreq.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(hreq)
	if err != nil {
		return "", fmt.Errorf("Folito no responde: %w", err)
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("Folito no ha podido responder (HTTP %d)", resp.StatusCode)
	}
	var out struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(data, &out); err != nil || len(out.Choices) == 0 {
		return "", errors.New("Folito ha devuelto una respuesta vacía")
	}
	return out.Choices[0].Message.Content, nil
}

// ensure arranca el servidor si no está en marcha y espera a que cargue el modelo.
func (f *folito) ensure(model string) (int, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.cmd != nil && f.model == model {
		f.touch()
		return f.port, nil
	}
	if f.cmd != nil {
		f.stopLocked()
	}
	engine := findLlama()
	if engine == "" {
		return 0, errors.New("falta el motor de Folito (llama-server)")
	}
	mpath := folitoModelPath(model)
	if _, err := os.Stat(mpath); err != nil {
		return 0, errors.New("falta descargar el modelo de Folito")
	}
	port, err := freePort()
	if err != nil {
		return 0, err
	}
	// Hilos: como mucho 4. Los hilos de llama.cpp se esperan entre sí en cada
	// paso: con todos los núcleos ocupados, cualquier otro programa (la propia
	// ventana al pintar) los frena y una respuesta de 2 s pasa a tardar más de
	// un minuto. FOLIO_FOLITO_THREADS lo fija (equipos lentos o pruebas).
	threads := min(max(goruntime.NumCPU()/2, 2), 4)
	if n, err := strconv.Atoi(os.Getenv("FOLIO_FOLITO_THREADS")); err == nil && n > 0 {
		threads = n
	}
	cmd := exec.Command(engine, "-m", mpath, "--host", "127.0.0.1", "--port", fmt.Sprint(port),
		"-c", "4096", "-np", "1", "-t", fmt.Sprint(threads), "--no-webui", "--log-disable")
	hideWindow(cmd)
	guardChild(cmd)
	if err := cmd.Start(); err != nil {
		return 0, fmt.Errorf("no se pudo arrancar Folito: %w", err)
	}
	guardStarted(cmd)
	exited := make(chan struct{})
	go func() { _ = cmd.Wait(); close(exited) }()
	// Espera a que el modelo esté cargado (/health responde 503 mientras carga)
	deadline := time.Now().Add(90 * time.Second)
	for {
		select {
		case <-exited:
			return 0, errors.New("Folito se ha cerrado al arrancar (¿memoria insuficiente?)")
		default:
		}
		if r, err := http.Get(fmt.Sprintf("http://127.0.0.1:%d/health", port)); err == nil {
			r.Body.Close()
			if r.StatusCode == http.StatusOK {
				break
			}
		}
		if time.Now().After(deadline) {
			_ = cmd.Process.Kill()
			return 0, errors.New("Folito tarda demasiado en arrancar")
		}
		time.Sleep(150 * time.Millisecond)
	}
	f.cmd, f.port, f.model = cmd, port, model
	f.touch()
	return port, nil
}

// touch reinicia la cuenta atrás de inactividad (con f.mu tomado).
func (f *folito) touch() {
	if f.idle != nil {
		f.idle.Stop()
	}
	f.idle = time.AfterFunc(folitoIdle, f.stop)
}

func (f *folito) stop() {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.stopLocked()
}

func (f *folito) stopLocked() {
	if f.idle != nil {
		f.idle.Stop()
		f.idle = nil
	}
	if f.cmd != nil {
		_ = f.cmd.Process.Kill()
		f.cmd = nil
	}
}

func freePort() (int, error) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port, nil
}
