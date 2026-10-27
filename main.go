package main

import (
	"embed"
	"log"
	"os"
	"runtime"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/linux"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

//go:embed all:frontend/dist
var assets embed.FS

//go:embed build/appicon.png
var icon []byte

// Version se sobrescribe al compilar: -ldflags "-X main.Version=1.2.3"
var Version = "1.0.0"

func main() {
	if runtime.GOOS == "linux" && os.Getenv("WEBKIT_DISABLE_DMABUF_RENDERER") == "" && hasNvidiaDriver() {
		// Con el driver propietario de NVIDIA, WebKitGTK puede mostrar la ventana en
		// blanco. Solo ahí se desactiva el renderizado por DMA-BUF: en el resto
		// (AMD, Intel) haría que todo se pintara por software y fuera más lento.
		os.Setenv("WEBKIT_DISABLE_DMABUF_RENDERER", "1")
	}
	app := NewApp()
	err := wails.Run(&options.App{
		Title:     "Folio",
		Width:     windowWidth,
		Height:    windowHeight,
		MinWidth:  760,
		MinHeight: 520,
		// Sin marco del sistema: la barra superior de Folio hace de barra de
		// título, con minimizar, maximizar y cerrar (ui/docview.ts).
		Frameless:        true,
		BackgroundColour: &options.RGBA{R: 255, G: 255, B: 255, A: 255},
		AssetServer: &assetserver.Options{
			Assets:  assets,
			Handler: app.filesHandler(),
		},
		OnStartup:                app.startup,
		OnDomReady:               app.domReady,
		OnBeforeClose:            app.beforeClose,
		OnShutdown:               app.shutdown,
		Bind:                     []any{app},
		EnableDefaultContextMenu: true,
		// Soltar PDF sobre la ventana abre «Unir PDF» (las imágenes las sigue recibiendo el editor)
		DragAndDrop: &options.DragAndDrop{EnableFileDrop: true},
		SingleInstanceLock: &options.SingleInstanceLock{
			UniqueId: "es.folio.editor",
			OnSecondInstanceLaunch: func(options.SecondInstanceData) {
				wruntime.WindowUnminimise(app.ctx)
				wruntime.WindowShow(app.ctx)
			},
		},
		Linux: &linux.Options{
			Icon:             icon,
			ProgramName:      "folio",
			WebviewGpuPolicy: linux.WebviewGpuPolicyOnDemand,
		},
		Windows: &windows.Options{
			Theme: windows.SystemDefault,
		},
	})
	if err != nil {
		log.Fatal(err)
	}
}

// hasNvidiaDriver indica si está cargado el driver propietario de NVIDIA.
func hasNvidiaDriver() bool {
	_, err := os.Stat("/proc/driver/nvidia/version")
	return err == nil
}
