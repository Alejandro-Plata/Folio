// Dictado sin conexión con whisper.cpp. En Windows graba la propia interfaz
// (WebView2 permite el micrófono) y envía un WAV de 16 kHz; en Linux graba el
// backend con PipeWire. La primera vez se descarga el modelo.
import type { App } from '../app';
import { api, onEvent } from '../api';
import { h, modal, toast } from '../ui/dom';
import { icon } from '../ui/icons';
import { isAndroid } from '../platform/platform';
import { FolioSpeech } from '../platform/plugins';
import type { DictationInfo } from './model';

const MODEL = 'small';
const MAX_SECONDS = 60;

export class Dictation {
  private recording = false;
  private busy = false;
  pushToTalk = false;
  private btn: HTMLButtonElement | null = null;
  private overlay: HTMLElement | null = null;
  private timer = 0;
  private web: { ctx: AudioContext; stream: MediaStream; chunks: Float32Array[]; node: ScriptProcessorNode; level: number } | null = null;
  private native = false;
  private partialHandle: { remove(): Promise<void> } | null = null;

  constructor(private app: App, private onText: (text: string) => void) {}

  async toggle(btn: HTMLButtonElement) {
    if (this.recording) await this.stop();
    else await this.start(btn, false);
  }

  /** Comprueba que hay motor y modelo; si falta el modelo, ofrece descargarlo. */
  private async ready(): Promise<DictationInfo | null> {
    if (isAndroid) {
      // El reconocimiento de voz lo pone el sistema: no hay modelo que descargar
      const a = await FolioSpeech.available();
      if (!a.any) {
        await modal('Falta el reconocimiento de voz', h('div', { class: 'ag-form' },
          h('p', {}, 'Este móvil no tiene un servicio de reconocimiento de voz. Instala o activa «Reconocimiento de voz y síntesis» de Google en Ajustes > Aplicaciones.')),
          [{ label: 'Entendido', value: null, kind: 'primary' }]);
        return null;
      }
      return { model: 'system', modelReady: true, modelPath: '', modelSize: 0, engineReady: true, enginePath: '', nativeRecord: false, recorder: '', recording: false, downloading: false };
    }
    if (!this.app.native) {
      toast('El dictado funciona en la aplicación de escritorio.', { kind: 'error' });
      return null;
    }
    let info = await api.DictationStatus(MODEL);
    if (!info.engineReady) {
      await modal('Falta el motor de dictado', h('div', { class: 'ag-form' },
        h('p', {}, 'Folio dicta sin conexión con whisper.cpp, pero no encuentra el programa ', h('code', {}, 'whisper-cli'), '.'),
        h('p', {}, 'Debe estar junto al ejecutable de Folio o en tu carpeta de datos de Folio, dentro de ', h('code', {}, 'bin'), '. Las versiones de Folio que incluyen el dictado ya lo traen.')),
        [{ label: 'Entendido', value: null, kind: 'primary' }]);
      return null;
    }
    if (!info.modelReady) {
      if (!await this.download(info)) return null;
      info = await api.DictationStatus(MODEL);
    }
    return info.modelReady ? info : null;
  }

  private async download(info: DictationInfo): Promise<boolean> {
    const mb = Math.round(info.modelSize / 1e6);
    const bar = h('div', { class: 'ag-progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0' }, h('span'));
    const label = h('p', { class: 'muted small', 'aria-live': 'polite' }, '');
    const body = h('div', { class: 'ag-form' },
      h('p', {}, `El dictado sin conexión necesita el modelo de voz en español (${mb} MB). Se descarga una sola vez.`),
      h('p', { class: 'muted small' }, 'Se guarda en este equipo y se puede borrar desde Ajustes. El audio no sale del equipo.'),
      bar, label);
    let started = false;
    let resultOk = false;
    const off = onEvent('dictation:download', (done: number, total: number) => {
      const pct = total ? Math.round((done / total) * 100) : 0;
      (bar.firstElementChild as HTMLElement).style.width = `${pct}%`;
      bar.setAttribute('aria-valuenow', String(pct));
      label.textContent = `${Math.round(done / 1e6)} de ${Math.round(total / 1e6)} MB`;
    });
    const res = await modal<'go' | 'cancel'>('Descargar el modelo de dictado', body, [
      { label: 'Ahora no', value: null, kind: 'ghost' },
      { label: `Descargar (${mb} MB)`, value: 'go', kind: 'primary' },
    ], {
      onOpen: (close) => {
        const go = body.closest('.modal')!.querySelector('.modal-foot .btn-primary') as HTMLButtonElement;
        const cancel = body.closest('.modal')!.querySelector('.modal-foot .btn-ghost') as HTMLButtonElement;
        go.addEventListener('click', (e) => {
          if (started) return;
          e.stopImmediatePropagation();
          started = true;
          go.disabled = true;
          go.textContent = 'Descargando…';
          cancel.textContent = 'Cancelar';
          cancel.onclick = () => { void api.DictationCancelDownload(); };
          api.DictationDownloadModel(MODEL)
            .then(() => { resultOk = true; label.textContent = 'Modelo descargado.'; setTimeout(() => close('go'), 600); })
            .catch((err) => { label.textContent = String(err).replace(/^Error:\s*/, ''); go.disabled = false; go.textContent = 'Reintentar'; started = false; });
        }, true);
      },
    });
    off?.();
    if (started && !resultOk) void api.DictationCancelDownload();
    return res === 'go' && resultOk;
  }

  async start(btn: HTMLButtonElement, pushToTalk: boolean) {
    if (this.recording || this.busy) return;
    this.btn = btn;
    this.busy = true;
    try {
      const info = await this.ready();
      if (!info) return;
      this.native = info.nativeRecord && this.app.os !== 'windows';
      if (isAndroid) this.startAndroid();
      else if (this.native) await api.DictationStart();
      else await this.startWeb();
      this.recording = true;
      this.pushToTalk = pushToTalk;
      this.showOverlay();
    } catch (e) {
      toast(micError(e), { kind: 'error', ms: 7000 });
    } finally {
      this.busy = false;
    }
  }

  async stop() {
    if (!this.recording) return;
    this.recording = false;
    this.pushToTalk = false;
    this.setOverlay('Transcribiendo…', true);
    if (isAndroid) {
      // El texto llega por la llamada pendiente de startAndroid()
      try { await FolioSpeech.stop(); } catch (e) { this.hideOverlay(); toast(String(e).replace(/^Error:\s*/, ''), { kind: 'error', ms: 7000 }); }
      return;
    }
    try {
      const text = this.native ? await api.DictationStop(MODEL) : await api.DictationTranscribeWav(await this.stopWeb(), MODEL);
      this.hideOverlay();
      this.onText(text.trim());
      if (!text.trim()) toast('No se ha reconocido ninguna frase.');
    } catch (e) {
      this.hideOverlay();
      toast(String(e).replace(/^Error:\s*/, ''), { kind: 'error', ms: 7000 });
    }
  }

  async cancel() {
    if (!this.recording) return;
    this.recording = false;
    this.pushToTalk = false;
    if (isAndroid) await FolioSpeech.cancel().catch(() => undefined);
    else if (this.native) await api.DictationCancel();
    else await this.stopWeb().catch(() => '');
    this.hideOverlay();
  }

  // ---------- Reconocimiento de voz del sistema (Android) ----------

  /** Empieza a escuchar; la llamada se resuelve con el texto final cuando se deja de hablar. */
  private startAndroid() {
    void FolioSpeech.addListener('partial', (e) => {
      const el = this.overlay?.querySelector('.ag-rec-text');
      if (el && this.recording && e.text) el.textContent = e.text;
    }).then((h2) => { this.partialHandle = h2; });
    FolioSpeech.start({ language: 'es-ES', partial: true })
      .then(({ text }) => {
        this.recording = false;
        this.pushToTalk = false;
        this.hideOverlay();
        this.onText(text.trim());
      })
      .catch((e) => {
        const msg = String(e?.message ?? e).replace(/^Error:\s*/, '');
        this.recording = false;
        this.pushToTalk = false;
        this.hideOverlay();
        if (msg !== 'cancelado') toast(msg, { kind: 'error', ms: 7000 });
      })
      .finally(() => { void this.partialHandle?.remove(); this.partialHandle = null; });
  }

  // ---------- Grabación en la interfaz (Windows) ----------

  private async startWeb() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    const ctx = new AudioContext();
    const src = ctx.createMediaStreamSource(stream);
    const node = ctx.createScriptProcessor(4096, 1, 1);
    const rec = { ctx, stream, chunks: [] as Float32Array[], node, level: 0 };
    node.onaudioprocess = (e) => {
      const data = e.inputBuffer.getChannelData(0);
      rec.chunks.push(new Float32Array(data));
      let peak = 0;
      for (let i = 0; i < data.length; i += 16) peak = Math.max(peak, Math.abs(data[i]));
      rec.level = peak;
    };
    src.connect(node);
    node.connect(ctx.destination);
    this.web = rec;
  }

  private async stopWeb(): Promise<string> {
    const rec = this.web;
    this.web = null;
    if (!rec) return '';
    rec.node.disconnect();
    rec.stream.getTracks().forEach((t) => t.stop());
    const rate = rec.ctx.sampleRate;
    await rec.ctx.close();
    const total = rec.chunks.reduce((n, c) => n + c.length, 0);
    const pcm = new Float32Array(total);
    let o = 0;
    for (const c of rec.chunks) { pcm.set(c, o); o += c.length; }
    return toBase64(encodeWav(downsample(pcm, rate, 16000), 16000));
  }

  // ---------- Indicador ----------

  private showOverlay() {
    this.btn?.classList.add('is-recording');
    this.btn?.setAttribute('aria-pressed', 'true');
    const started = Date.now();
    const meter = h('span', { class: 'ag-rec-meter' }, h('span'));
    const time = h('span', { class: 'ag-rec-time' }, '0:00');
    // Tarjeta (no píldora): cabecera, nivel, indicación y botones, cada cosa en su fila
    this.overlay = h('div', { class: 'ag-rec', role: 'status', 'aria-live': 'assertive' },
      h('div', { class: 'ag-rec-head' },
        h('span', { class: 'ag-rec-dot', 'aria-hidden': 'true' }),
        h('strong', { class: 'ag-rec-title' }, 'Escuchando'),
        time),
      meter,
      h('p', { class: 'ag-rec-text' }, this.pushToTalk ? 'Suelta las teclas para terminar.' : 'Por ejemplo: «mañana a las 9, reunión de equipo».'),
      this.pushToTalk ? null : h('div', { class: 'ag-rec-actions' },
        h('button', { type: 'button', class: 'btn btn-sm btn-ghost', onclick: () => void this.cancel() }, 'Cancelar'),
        h('button', { type: 'button', class: 'btn btn-sm btn-primary', onclick: () => void this.stop() }, h('span', { html: icon('stop', 13) }), 'Terminar')));
    document.body.append(this.overlay);
    this.timer = window.setInterval(() => {
      const s = Math.floor((Date.now() - started) / 1000);
      time.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      if (this.web) (meter.firstElementChild as HTMLElement).style.width = `${Math.min(100, this.web.level * 140)}%`;
      else meter.classList.add('is-pulse');
      if (s >= MAX_SECONDS) void this.stop();
    }, 100);
  }

  private setOverlay(text: string, busy: boolean) {
    clearInterval(this.timer);
    if (!this.overlay) return;
    this.overlay.classList.toggle('is-busy', busy);
    this.overlay.replaceChildren(h('div', { class: 'ag-rec-head' }, h('span', { class: 'ag-spinner', 'aria-hidden': 'true' }), h('span', { class: 'ag-rec-title' }, text)));
  }

  private hideOverlay() {
    clearInterval(this.timer);
    this.overlay?.remove();
    this.overlay = null;
    this.btn?.classList.remove('is-recording');
    this.btn?.setAttribute('aria-pressed', 'false');
  }
}

function micError(e: unknown): string {
  const msg = String(e);
  if (/NotAllowed|Permission/i.test(msg)) return 'Sin permiso para usar el micrófono. Se activa en la configuración del sistema.';
  if (/NotFound|no.*micr/i.test(msg)) return 'No hay ningún micrófono conectado.';
  return msg.replace(/^Error:\s*/, '');
}

function downsample(pcm: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return pcm;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(pcm.length / ratio));
  for (let i = 0; i < out.length; i++) {
    // media de las muestras que caen en este hueco (filtro paso bajo sencillo)
    const a = Math.floor(i * ratio), b = Math.min(pcm.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = a; j < b; j++) sum += pcm[j];
    out[i] = sum / Math.max(1, b - a);
  }
  return out;
}

function encodeWav(samples: Float32Array, rate: number): Uint8Array {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buf);
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
