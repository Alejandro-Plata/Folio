// Proceso del núcleo (folio-core, Go): una línea JSON por mensaje en cada
// sentido. Las respuestas llevan el id de la petición; los eventos, su nombre.
import { dialog, app } from 'electron';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

export class Core {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  stopped = false;

  constructor(private bin: string, private onEvent: (name: string, data: unknown[]) => void) {}

  start() {
    const proc = spawn(this.bin, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    this.proc = proc;
    proc.stderr.on('data', (b: Buffer) => process.stderr.write(b));
    createInterface({ input: proc.stdout, crlfDelay: Infinity }).on('line', (line) => this.receive(line));
    proc.on('error', (e) => this.fail(`No se pudo iniciar el núcleo de Folio (${this.bin}): ${e.message}`));
    proc.on('exit', (code) => {
      const err = new Error('El núcleo de Folio se ha cerrado.');
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
      if (!this.stopped) this.fail(`El núcleo de Folio se ha cerrado inesperadamente (código ${code}). Los cambios ya guardados no se pierden.`);
    });
  }

  call(method: string, args: unknown[] = []): Promise<unknown> {
    if (!this.proc || this.stopped) return Promise.reject(new Error('El núcleo de Folio no está en marcha.'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.proc!.stdin.write(`${JSON.stringify({ id, method, args })}\n`);
    });
  }

  /** Cierra la entrada: el núcleo guarda lo pendiente y termina (si tarda, se fuerza). */
  stop(): Promise<void> {
    if (!this.proc || this.stopped) { this.stopped = true; return Promise.resolve(); }
    this.stopped = true;
    const proc = this.proc;
    return new Promise((resolve) => {
      const t = setTimeout(() => { proc.kill(); resolve(); }, 5000);
      proc.once('exit', () => { clearTimeout(t); resolve(); });
      proc.stdin.end();
    });
  }

  private receive(line: string) {
    let msg: { id?: number; result?: unknown; error?: string; event?: string; data?: unknown[] };
    try { msg = JSON.parse(line); } catch { return; }
    if (msg.event) { this.onEvent(msg.event, msg.data ?? []); return; }
    const p = msg.id !== undefined ? this.pending.get(msg.id) : undefined;
    if (!p) return;
    this.pending.delete(msg.id!);
    if (msg.error) p.reject(new Error(msg.error)); else p.resolve(msg.result);
  }

  private fail(message: string) {
    dialog.showErrorBox('Folio', message);
    app.exit(1);
  }
}
