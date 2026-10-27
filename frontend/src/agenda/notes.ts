// Apuntes de los temas: archivos (PDF, Word…) adjuntos a cada tema que se
// abren con la aplicación del sistema. Se pueden añadir de uno en uno o de
// golpe: Folio empareja cada archivo con su tema por el número del nombre.
import { api } from '../api';
import { h, modal, toast } from '../ui/dom';
import { icon } from '../ui/icons';
import type { Topic, TopicFile } from './model';
import { topicNumberOf } from './notematch';
import type { AgendaView } from './view';

/** Sustituye el tema en el estado local tras un cambio de sus archivos. */
function store(view: AgendaView, t: Topic) {
  const st = view.state;
  const i = st.topics.findIndex((x) => x.id === t.id);
  if (i >= 0) st.topics[i] = t;
}

export function openNote(f: TopicFile) {
  api.OpenTopicFile(f.path).catch((e) => toast(`No se pudo abrir «${f.name}»: ${e}`, { kind: 'error', ms: 6000 }));
}

const EXT_ICON: Record<string, string> = { pdf: 'pdf', doc: 'word', docx: 'word', odt: 'word', rtf: 'word', png: 'image', jpg: 'image', jpeg: 'image' };
const extOf = (name: string) => name.split('.').pop()?.toLowerCase() ?? '';

/** Botón con el nombre del archivo; si se pasa `onRemove`, lleva una «×» para quitarlo. */
export function noteChip(f: TopicFile, onRemove?: () => void): HTMLElement {
  return h('span', { class: 'ag-note' },
    h('button', { type: 'button', class: 'ag-note-open', title: `Abrir «${f.name}»`, onclick: () => openNote(f) },
      h('span', { html: icon(EXT_ICON[extOf(f.name)] ?? 'file', 14), 'aria-hidden': 'true' }), h('span', { class: 'ag-note-name' }, f.name)),
    onRemove ? h('button', { type: 'button', class: 'ag-note-x', title: `Quitar «${f.name}»`, 'aria-label': `Quitar «${f.name}»`, html: icon('x', 12), onclick: onRemove }) : null);
}

/** Elige archivos y los adjunta a un tema ya guardado. Devuelve el tema actualizado. */
export async function pickNotesFor(view: AgendaView, topic: Topic): Promise<Topic | null> {
  const files = await api.ChooseNoteFiles().catch((e) => { toast(String(e), { kind: 'error' }); return null; });
  if (!files?.length) return null;
  return attach(view, topic, files.map((f) => f.path));
}

async function attach(view: AgendaView, topic: Topic, paths: string[]): Promise<Topic | null> {
  try {
    const t = await api.AgendaAttachFiles(topic.id, paths);
    store(view, t);
    return t;
  } catch (e) {
    toast(`No se pudieron añadir los apuntes: ${e}`, { kind: 'error', ms: 6000 });
    return null;
  }
}

export async function removeNote(view: AgendaView, topic: Topic, f: TopicFile): Promise<Topic | null> {
  const ok = await modal('Quitar los apuntes', h('p', {}, `¿Quitar «${f.name}» del tema ${topic.number}? Se borra la copia de Folio en todos los dispositivos; el archivo original no cambia.`),
    [{ label: 'Cancelar', value: null, kind: 'ghost' }, { label: 'Quitar', value: 'ok', kind: 'danger' }], { className: 'is-small' });
  if (ok !== 'ok') return null;
  try {
    const t = await api.AgendaRemoveTopicFile(topic.id, f.id);
    store(view, t);
    toast(`«${f.name}» quitado del tema ${topic.number}`);
    return t;
  } catch (e) {
    toast(String(e), { kind: 'error' });
    return null;
  }
}

/** Varios archivos a la vez: se emparejan por el número del nombre y se revisa antes de adjuntar. */
export async function bulkAttach(view: AgendaView, topics: Topic[]): Promise<boolean> {
  if (!topics.length) { toast('Primero añade los temas.'); return false; }
  const files = await api.ChooseNoteFiles().catch((e) => { toast(String(e), { kind: 'error' }); return null; });
  if (!files?.length) return false;
  const sorted = [...topics].sort((a, b) => a.number - b.number);
  const picks = files.map((f) => {
    const n = topicNumberOf(f.name);
    const sel = h('select', { class: 'input input-sm', 'aria-label': `Tema para «${f.name}»` },
      h('option', { value: '' }, 'No añadir'),
      ...sorted.map((t) => h('option', { value: t.id, selected: t.number === n }, `Tema ${t.number}. ${t.title}`)));
    return { f, sel };
  });
  const matched = picks.filter((p) => p.sel.value).length;
  const body = h('div', { class: 'ag-form' },
    h('p', {}, matched === files.length ? `${files.length} archivos asignados por el número de su nombre.`
      : `${matched} de ${files.length} archivos asignados por el número de su nombre. Elige el tema del resto.`),
    h('div', { class: 'ag-found' }, ...picks.map(({ f, sel }) => h('div', { class: 'ag-found-row ag-note-match' },
      h('span', { class: 'ag-note-name', title: f.name }, f.name), h('span', { html: icon('arrowRight', 14), 'aria-hidden': 'true' }), sel))));
  const r = await modal('Añadir apuntes', body, [{ label: 'Cancelar', value: null, kind: 'ghost' }, { label: 'Añadir', value: 'ok', kind: 'primary' }], { wide: true, className: 'ag-modal' });
  if (r !== 'ok') return false;
  const byTopic = new Map<string, string[]>();
  for (const { f, sel } of picks) if (sel.value) (byTopic.get(sel.value) ?? byTopic.set(sel.value, []).get(sel.value)!).push(f.path);
  let n = 0;
  for (const [id, paths] of byTopic) {
    const t = view.state.topic(id);
    if (t && await attach(view, t, paths)) n += paths.length;
  }
  if (n) toast(`${n} ${n === 1 ? 'archivo añadido' : 'archivos añadidos'} a ${byTopic.size} ${byTopic.size === 1 ? 'tema' : 'temas'}`, { kind: 'ok' });
  return n > 0;
}
