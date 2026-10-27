package desktop

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	goruntime "runtime"
	"strings"
	"sync"
	"time"

	"folio/internal/paths"
)

// Dictado sin conexión con whisper.cpp. El motor (whisper-cli) es un programa
// auxiliar junto a Folio; el modelo se descarga una vez a la carpeta de datos.
// En Windows el audio lo graba la interfaz (WebView2 permite el micrófono); en
// Linux WebKitGTK no lo permite y se graba con PipeWire (pw-record) o ALSA.

type whisperModel struct {
	File   string
	Size   int64  // bytes aproximados, para la barra de progreso
	SHA256 string // vacío = sin comprobar
}

var whisperModels = map[string]whisperModel{
	"small": {File: "ggml-small.bin", Size: 487601967, SHA256: "1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b"},
	"base":  {File: "ggml-base.bin", Size: 147951465},
}

const whisperModelURL = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/"

// Pista de vocabulario para whisper: mejora palabras frecuentes en la agenda.
const whisperPrompt = "Agenda de estudio: mañana a las nueve, de lunes a viernes, repaso del tema 4, estudio, simulacro, prioridad alta, durante dos horas."

type dictation struct {
	mu      sync.Mutex
	rec     *exec.Cmd
	recPath string
	cancel  context.CancelFunc // descarga en curso
}

type DictationInfo struct {
	Model        string `json:"model"`
	ModelReady   bool   `json:"modelReady"`
	ModelPath    string `json:"modelPath"`
	ModelSize    int64  `json:"modelSize"`
	EngineReady  bool   `json:"engineReady"`
	EnginePath   string `json:"enginePath"`
	NativeRecord bool   `json:"nativeRecord"` // graba Go (Linux) en vez de la interfaz
	Recorder     string `json:"recorder"`
	Recording    bool   `json:"recording"`
	Downloading  bool   `json:"downloading"`
}

func modelsDir() string { return filepath.Join(paths.DataDir(), "models") }

func modelPath(name string) string {
	m, ok := whisperModels[name]
	if !ok {
		m = whisperModels["small"]
	}
	return filepath.Join(modelsDir(), m.File)
}

// findWhisper busca whisper-cli junto al ejecutable, en la carpeta de datos o en el PATH.
func findWhisper() string {
	names := []string{"whisper-cli", "whisper-cpp", "whisper"}
	if goruntime.GOOS == "windows" {
		names = []string{"whisper-cli.exe", "main.exe"}
	}
	var dirs []string
	if exe, err := os.Executable(); err != nil {
		_ = err
	} else {
		dirs = append(dirs, filepath.Dir(exe), filepath.Join(filepath.Dir(exe), "whisper"))
	}
	dirs = append(dirs, filepath.Join(paths.DataDir(), "bin"))
	for _, d := range dirs {
		for _, n := range names {
			p := filepath.Join(d, n)
			if st, err := os.Stat(p); err == nil && !st.IsDir() {
				return p
			}
		}
	}
	for _, n := range names[:1] {
		if p, err := exec.LookPath(n); err == nil {
			return p
		}
	}
	return ""
}

func findRecorder() (string, []string) {
	if goruntime.GOOS == "windows" {
		return "", nil
	}
	if p, err := exec.LookPath("pw-record"); err == nil {
		return p, []string{"--rate", "16000", "--channels", "1", "--format", "s16"}
	}
	if p, err := exec.LookPath("arecord"); err == nil {
		return p, []string{"-q", "-f", "S16_LE", "-r", "16000", "-c", "1", "-t", "wav"}
	}
	return "", nil
}

// DictationStatus indica qué falta para poder dictar.
func (a *App) DictationStatus(model string) DictationInfo {
	if _, ok := whisperModels[model]; !ok {
		model = "small"
	}
	info := DictationInfo{Model: model, ModelPath: modelPath(model)}
	if st, err := os.Stat(info.ModelPath); err == nil {
		info.ModelReady, info.ModelSize = true, st.Size()
	} else {
		info.ModelSize = whisperModels[model].Size
	}
	info.EnginePath = findWhisper()
	info.EngineReady = info.EnginePath != ""
	rec, _ := findRecorder()
	info.NativeRecord, info.Recorder = rec != "", filepath.Base(rec)
	a.dictation.mu.Lock()
	info.Recording, info.Downloading = a.dictation.rec != nil, a.dictation.cancel != nil
	a.dictation.mu.Unlock()
	return info
}

// DictationDownloadModel descarga el modelo con progreso (evento «dictation:download»).
func (a *App) DictationDownloadModel(model string) error {
	m, ok := whisperModels[model]
	if !ok {
		return errors.New("modelo desconocido")
	}
	a.dictation.mu.Lock()
	if a.dictation.cancel != nil {
		a.dictation.mu.Unlock()
		return errors.New("ya hay una descarga en curso")
	}
	ctx, cancel := context.WithCancel(context.Background())
	a.dictation.cancel = cancel
	a.dictation.mu.Unlock()
	defer func() {
		a.dictation.mu.Lock()
		a.dictation.cancel = nil
		a.dictation.mu.Unlock()
		cancel()
	}()

	if err := os.MkdirAll(modelsDir(), 0o755); err != nil {
		return err
	}
	dst := modelPath(model)
	part := dst + ".part"
	// Reanuda si quedó una descarga a medias
	var offset int64
	if st, err := os.Stat(part); err == nil {
		offset = st.Size()
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, whisperModelURL+m.File, nil)
	if err != nil {
		return err
	}
	if offset > 0 {
		req.Header.Set("Range", fmt.Sprintf("bytes=%d-", offset))
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("no se pudo descargar el modelo: %w", err)
	}
	defer resp.Body.Close()
	switch resp.StatusCode {
	case http.StatusOK:
		offset = 0
	case http.StatusPartialContent:
	default:
		return fmt.Errorf("no se pudo descargar el modelo (HTTP %d)", resp.StatusCode)
	}
	flags := os.O_CREATE | os.O_WRONLY | os.O_TRUNC
	if offset > 0 {
		flags = os.O_CREATE | os.O_WRONLY | os.O_APPEND
	}
	f, err := os.OpenFile(part, flags, 0o644)
	if err != nil {
		return err
	}
	total := m.Size
	if resp.ContentLength > 0 {
		total = offset + resp.ContentLength
	}
	done := offset
	buf := make([]byte, 256*1024)
	last := time.Time{}
	for {
		n, rerr := resp.Body.Read(buf)
		if n > 0 {
			if _, werr := f.Write(buf[:n]); werr != nil {
				f.Close()
				return werr
			}
			done += int64(n)
			if time.Since(last) > 200*time.Millisecond {
				last = time.Now()
				a.emit("dictation:download", done, total)
			}
		}
		if rerr == io.EOF {
			break
		}
		if rerr != nil {
			f.Close()
			if ctx.Err() != nil {
				return errors.New("descarga cancelada")
			}
			return fmt.Errorf("la descarga se interrumpió: %w", rerr)
		}
	}
	if err := f.Close(); err != nil {
		return err
	}
	if m.SHA256 != "" {
		sum, err := fileSHA256(part)
		if err != nil {
			return err
		}
		if sum != m.SHA256 {
			os.Remove(part)
			return errors.New("el modelo descargado está dañado; vuelve a intentarlo")
		}
	}
	a.emit("dictation:download", total, total)
	return os.Rename(part, dst)
}

// DictationCancelDownload detiene la descarga (se puede reanudar después).
func (a *App) DictationCancelDownload() {
	a.dictation.mu.Lock()
	defer a.dictation.mu.Unlock()
	if a.dictation.cancel != nil {
		a.dictation.cancel()
	}
}

// DictationDeleteModel borra el modelo para liberar espacio.
func (a *App) DictationDeleteModel(model string) error {
	err := os.Remove(modelPath(model))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}

func fileSHA256(p string) (string, error) {
	f, err := os.Open(p)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// DictationStart empieza a grabar con el micrófono (solo Linux; en Windows graba la interfaz).
func (a *App) DictationStart() error {
	rec, args := findRecorder()
	if rec == "" {
		return errors.New("no se encontró pw-record ni arecord para grabar el micrófono")
	}
	a.dictation.mu.Lock()
	defer a.dictation.mu.Unlock()
	if a.dictation.rec != nil {
		return nil
	}
	tmp, err := os.CreateTemp("", "folio-dictado-*.wav")
	if err != nil {
		return err
	}
	tmp.Close()
	cmd := exec.Command(rec, append(args, tmp.Name())...)
	hideWindow(cmd)
	if err := cmd.Start(); err != nil {
		os.Remove(tmp.Name())
		return fmt.Errorf("no se pudo usar el micrófono: %w", err)
	}
	a.dictation.rec, a.dictation.recPath = cmd, tmp.Name()
	return nil
}

// DictationStop termina la grabación y devuelve el texto transcrito.
func (a *App) DictationStop(model string) (string, error) {
	a.dictation.mu.Lock()
	cmd, wav := a.dictation.rec, a.dictation.recPath
	a.dictation.rec, a.dictation.recPath = nil, ""
	a.dictation.mu.Unlock()
	if cmd == nil {
		return "", errors.New("no se estaba grabando")
	}
	defer os.Remove(wav)
	stopProcess(cmd)
	done := make(chan struct{})
	go func() { _ = cmd.Wait(); close(done) }()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		_ = cmd.Process.Kill()
		<-done
	}
	return a.transcribe(wav, model)
}

// DictationCancel descarta la grabación en curso.
func (a *App) DictationCancel() {
	a.dictation.mu.Lock()
	cmd, wav := a.dictation.rec, a.dictation.recPath
	a.dictation.rec, a.dictation.recPath = nil, ""
	a.dictation.mu.Unlock()
	if cmd != nil {
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
		os.Remove(wav)
	}
}

// DictationTranscribeWav transcribe un WAV (16 kHz, mono) grabado por la interfaz.
func (a *App) DictationTranscribeWav(b64, model string) (string, error) {
	data, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		return "", errors.New("audio no válido")
	}
	tmp, err := os.CreateTemp("", "folio-dictado-*.wav")
	if err != nil {
		return "", err
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return "", err
	}
	tmp.Close()
	return a.transcribe(tmp.Name(), model)
}

func (a *App) transcribe(wav, model string) (string, error) {
	engine := findWhisper()
	if engine == "" {
		return "", errors.New("falta el motor de dictado (whisper-cli)")
	}
	mp := modelPath(model)
	if _, err := os.Stat(mp); err != nil {
		return "", errors.New("falta descargar el modelo de dictado")
	}
	if st, err := os.Stat(wav); err != nil || st.Size() < 2000 {
		return "", errors.New("no se ha grabado nada; comprueba el micrófono")
	}
	threads := max(2, min(8, goruntime.NumCPU()-1))
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, engine, "-m", mp, "-f", wav, "-l", "es", "-nt", "-np",
		"-t", fmt.Sprint(threads), "--prompt", whisperPrompt)
	hideWindow(cmd)
	out, err := cmd.Output()
	if err != nil {
		msg := err.Error()
		var ee *exec.ExitError
		if errors.As(err, &ee) && len(ee.Stderr) > 0 {
			msg = strings.TrimSpace(string(ee.Stderr))
			if len(msg) > 300 {
				msg = msg[len(msg)-300:]
			}
		}
		return "", errors.New("el dictado falló: " + msg)
	}
	return cleanTranscript(string(out)), nil
}

// cleanTranscript quita marcas de whisper como «[Música]» o «(risas)».
func cleanTranscript(s string) string {
	var b strings.Builder
	depth := 0
	for _, r := range s {
		switch r {
		case '[', '(':
			depth++
		case ']', ')':
			if depth > 0 {
				depth--
			}
		default:
			if depth == 0 {
				b.WriteRune(r)
			}
		}
	}
	return strings.Join(strings.Fields(b.String()), " ")
}
