// Buscar y reemplazar (Ctrl+B / Ctrl+F y Ctrl+H en Word) con resaltado de coincidencias.
import { Extension } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export interface FindOptions { query: string; caseSensitive: boolean; wholeWord: boolean }
interface Range { from: number; to: number }
interface FindState extends FindOptions { results: Range[]; index: number; deco: DecorationSet }

export const findKey = new PluginKey<FindState>('find');

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function search(doc: PMNode, o: FindOptions): Range[] {
  if (!o.query) return [];
  const body = escapeRe(o.query);
  const re = new RegExp(o.wholeWord ? `(?<![\\p{L}\\p{N}_])${body}(?![\\p{L}\\p{N}_])` : body, o.caseSensitive ? 'gu' : 'giu');
  const out: Range[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    let text = '';
    const map: number[] = [];
    node.forEach((child, offset) => {
      if (child.isText) {
        for (let i = 0; i < child.text!.length; i++) map.push(pos + 1 + offset + i);
        text += child.text;
      } else {
        text += '￼';
        map.push(pos + 1 + offset);
      }
    });
    for (const m of text.matchAll(re)) {
      if (!m[0].length) continue;
      out.push({ from: map[m.index!], to: map[m.index! + m[0].length - 1] + 1 });
    }
    return false;
  });
  return out;
}

function decorate(doc: PMNode, results: Range[], index: number) {
  return DecorationSet.create(doc, results.map((r, i) =>
    Decoration.inline(r.from, r.to, { class: i === index ? 'find-match find-current' : 'find-match' })));
}

const empty: FindState = { query: '', caseSensitive: false, wholeWord: false, results: [], index: -1, deco: DecorationSet.empty };

export const Find = Extension.create({
  name: 'find',
  addProseMirrorPlugins() {
    return [new Plugin<FindState>({
      key: findKey,
      state: {
        init: () => empty,
        apply(tr, prev, _old, state) {
          const meta = tr.getMeta(findKey) as Partial<FindState> | undefined;
          if (meta) {
            const next = { ...prev, ...meta };
            if ('query' in meta || 'caseSensitive' in meta || 'wholeWord' in meta || tr.docChanged) {
              next.results = search(state.doc, next);
              if (!('index' in meta)) {
                const sel = state.selection.from;
                const i = next.results.findIndex((r) => r.from >= sel);
                next.index = next.results.length ? (i < 0 ? 0 : i) : -1;
              }
            }
            next.index = Math.min(next.index, next.results.length - 1);
            next.deco = decorate(state.doc, next.results, next.index);
            return next;
          }
          if (tr.docChanged && prev.query) {
            const results = search(state.doc, prev);
            const index = Math.min(prev.index, results.length - 1);
            return { ...prev, results, index, deco: decorate(state.doc, results, index) };
          }
          return prev;
        },
      },
      props: {
        decorations: (state) => findKey.getState(state)?.deco,
      },
    })];
  },
});

export function getFind(editor: Editor): FindState {
  return findKey.getState(editor.state) ?? empty;
}

export function setFind(editor: Editor, o: Partial<FindOptions>) {
  editor.view.dispatch(editor.state.tr.setMeta(findKey, o));
}

export function clearFind(editor: Editor) {
  editor.view.dispatch(editor.state.tr.setMeta(findKey, { query: '' }));
}

function select(editor: Editor, index: number) {
  const st = getFind(editor);
  if (!st.results.length) return;
  const i = (index + st.results.length) % st.results.length;
  const r = st.results[i];
  const tr = editor.state.tr.setMeta(findKey, { index: i }).setSelection(TextSelection.create(editor.state.doc, r.from, r.to));
  editor.view.dispatch(tr.scrollIntoView());
}

export function findNext(editor: Editor) {
  const st = getFind(editor);
  select(editor, st.index + 1);
}

export function findPrev(editor: Editor) {
  const st = getFind(editor);
  select(editor, st.index - 1);
}

export function replaceCurrent(editor: Editor, text: string) {
  const st = getFind(editor);
  const r = st.results[st.index];
  if (!r) return;
  const tr = editor.state.tr.insertText(text, r.from, r.to);
  editor.view.dispatch(tr);
  select(editor, getFind(editor).index);
}

export function replaceAll(editor: Editor, text: string): number {
  const st = getFind(editor);
  if (!st.results.length) return 0;
  const tr = editor.state.tr;
  for (const r of [...st.results].reverse()) tr.insertText(text, r.from, r.to);
  editor.view.dispatch(tr);
  return st.results.length;
}
