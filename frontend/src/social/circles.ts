// Círculos: grupos de amigos (varias personas) o de pareja (dos). Lo que se
// crea en un círculo lo ven todos sus miembros; lo privado sigue siendo tuyo.
// Se entra con un código de invitación que genera cualquier miembro.
import type { App } from '../app';
import { api } from '../api';
import type { Circle } from '../types';
import { confirmDialog, h, modal, toast } from '../ui/dom';
import { icon } from '../ui/icons';
import { avatar, colorPicker, field } from './common';

type View = { kind: 'list' } | { kind: 'new' } | { kind: 'join' } | { kind: 'circle'; id: string; code?: string };

export async function circlesDialog(app: App, start: View = { kind: 'list' }) {
  const mgr = app.social;
  if (!mgr.snap.signedIn) { void import('./account').then((m) => m.accountDialog(app)); return; }
  const body = h('div', { class: 'so' });
  let view: View = start;
  let busy = false;
  let closeFn: ((v: null) => void) | undefined;

  const go = (v: View) => { view = v; render(); };
  const busyRun = async (work: () => Promise<void>) => {
    if (busy) return;
    busy = true;
    render();
    try { await work(); } catch (e) { toast(String((e as Error)?.message ?? e).replace(/^Error:\s*/, ''), { kind: 'error', ms: 7000 }); }
    finally { busy = false; render(); }
  };
  const back = () => h('button', { type: 'button', class: 'btn btn-sm btn-ghost', onclick: () => go({ kind: 'list' }) }, h('span', { html: icon('arrowLeft', 14) }), 'Mis círculos');
  const kindIcon = (c: Pick<Circle, 'kind'>) => icon(c.kind === 'couple' ? 'heart' : 'users', 18);

  const list = (): HTMLElement[] => {
    const circles = mgr.circles;
    return [
      h('p', {}, 'En un círculo, los eventos que creéis los veis todos en la agenda. Tus tareas privadas siguen siendo solo tuyas.'),
      ...(circles.length ? circles.map((c) => h('button', { type: 'button', class: 'so-circle', onclick: () => go({ kind: 'circle', id: c.id }) },
        h('span', { class: 'so-circle-ic', style: { '--c': c.color }, html: kindIcon(c) }),
        h('span', { class: 'so-circle-main' }, h('strong', {}, c.name), h('span', { class: 'muted small' },
          `${c.kind === 'couple' ? 'Pareja' : 'Amigos'} · ${c.circle_members.length} ${c.circle_members.length === 1 ? 'persona' : 'personas'}`)),
        h('span', { class: 'so-avatars' }, ...c.circle_members.slice(0, 4).map((m) => avatar(m.profiles, true))),
        h('span', { html: icon('chevronRight', 16), 'aria-hidden': 'true' })))
        : [h('div', { class: 'pm-empty' }, h('span', { html: icon('users', 28) }), h('p', {}, 'Aún no estás en ningún círculo.'))]),
      h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn btn-primary', onclick: () => go({ kind: 'new' }) }, h('span', { html: icon('plus', 14) }), 'Crear un círculo'),
        h('button', { type: 'button', class: 'btn', onclick: () => go({ kind: 'join' }) }, h('span', { html: icon('key', 14) }), 'Unirme con un código')),
    ];
  };

  const create = (): HTMLElement[] => {
    let kind: 'friends' | 'couple' = 'friends';
    const name = h('input', { class: 'input', maxlength: '60', placeholder: 'Amigos del instituto, Familia, Nosotros…', 'aria-label': 'Nombre del círculo' });
    const color = colorPicker('#7d3c98', 'Color del círculo');
    const kinds = h('div', { class: 'so-kinds', role: 'radiogroup', 'aria-label': 'Tipo de círculo' });
    const drawKinds = () => kinds.replaceChildren(
      ...([['friends', 'users', 'Amigos', 'Varias personas. Quedadas, cumpleaños, planes…'], ['couple', 'heart', 'Pareja', 'Dos personas. Además podéis proponer citas y elegir día.']] as const).map(([k, ic, t, d]) =>
        h('button', { type: 'button', class: `so-kind ${kind === k ? 'on' : ''}`, role: 'radio', 'aria-checked': String(kind === k), onclick: () => { kind = k; drawKinds(); } },
          h('strong', {}, h('span', { html: icon(ic, 16) }), t), h('span', { class: 'muted small' }, d))));
    drawKinds();
    setTimeout(() => name.focus(), 30);
    return [
      back(),
      h('div', { class: 'ag-field' }, h('span', { class: 'ag-field-label' }, 'Tipo'), kinds),
      field('Nombre', name),
      h('div', { class: 'ag-field' }, h('span', { class: 'ag-field-label' }, 'Color en la agenda'), color.el),
      h('div', { class: 'btn-row' }, h('div', { class: 'spacer' }),
        h('button', { type: 'button', class: 'btn btn-primary', disabled: busy, onclick: () => void busyRun(async () => {
          if (!name.value.trim()) throw new Error('Ponle un nombre al círculo');
          const before = new Set(mgr.circles.map((c) => c.id));
          mgr.apply(await api.SocialCreateCircle(name.value.trim(), kind, color.get()));
          const made = mgr.circles.find((c) => !before.has(c.id));
          if (!made) return go({ kind: 'list' });
          // Directo a invitar: un círculo vacío no sirve de mucho
          const code = await api.SocialInvite(made.id).catch(() => '');
          go({ kind: 'circle', id: made.id, code });
        }) }, 'Crear')),
    ];
  };

  const join = (): HTMLElement[] => {
    const code = h('input', { class: 'input so-code-input', maxlength: '12', placeholder: 'K7M4Q2XP', autocomplete: 'off', 'aria-label': 'Código de invitación', style: { textTransform: 'uppercase', letterSpacing: '0.1em' } });
    setTimeout(() => code.focus(), 30);
    const submit = () => void busyRun(async () => {
      const before = new Set(mgr.circles.map((c) => c.id));
      mgr.apply(await api.SocialJoin(code.value));
      const joined = mgr.circles.find((c) => !before.has(c.id));
      toast(joined ? `Ya estás en «${joined.name}»` : 'Ya estabas en ese círculo', { kind: 'ok' });
      go(joined ? { kind: 'circle', id: joined.id } : { kind: 'list' });
    });
    code.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    return [back(), field('Código de invitación', code, 'Pídeselo a alguien del círculo: lo genera en «Invitar».'),
      h('div', { class: 'btn-row' }, h('div', { class: 'spacer' }), h('button', { type: 'button', class: 'btn btn-primary', disabled: busy, onclick: submit }, 'Unirme'))];
  };

  const detail = (id: string, code?: string): HTMLElement[] => {
    const c = mgr.circles.find((x) => x.id === id);
    if (!c) return list();
    const mine = c.owner === mgr.me;
    const full = c.kind === 'couple' && c.circle_members.length >= 2;
    const out: HTMLElement[] = [back(),
      h('div', { class: 'so-circle', style: { cursor: 'default' } },
        h('span', { class: 'so-circle-ic', style: { '--c': c.color }, html: kindIcon(c) }),
        h('span', { class: 'so-circle-main' }, h('strong', {}, c.name), h('span', { class: 'muted small' }, c.kind === 'couple' ? 'Círculo de pareja' : 'Círculo de amigos')))];
    if (code) {
      out.push(h('div', { class: 'so-section' }, 'Invitación'),
        h('p', { class: 'small' }, c.kind === 'couple' ? 'Pásale este código a tu pareja. Sirve una vez y caduca en 7 días.' : 'Pásales este código. Sirve para varias personas durante 7 días.'),
        h('div', { class: 'so-code', 'aria-label': `Código ${code.split('').join(' ')}` }, code),
        h('div', { class: 'btn-row' },
          h('button', { type: 'button', class: 'btn btn-sm', onclick: async () => { await navigator.clipboard?.writeText(`Únete a «${c.name}» en Folio: abre Agenda › Círculos › Unirme con un código y escribe ${code}`).catch(() => {}); toast('Invitación copiada', { kind: 'ok' }); } },
            h('span', { html: icon('copy', 14) }), 'Copiar la invitación')));
    }
    out.push(h('div', { class: 'so-section' }, 'Personas'),
      h('div', {}, ...c.circle_members.map((m) => h('div', { class: 'so-member' }, avatar(m.profiles, true),
        h('div', { class: 'so-member-main' }, h('span', {}, m.user_id === mgr.me ? `${m.profiles.name || m.profiles.email} (tú)` : m.profiles.name || m.profiles.email), h('span', { class: 'muted small' }, m.profiles.email)),
        m.role === 'owner' ? h('span', { class: 'so-badge' }, 'Lo creó') : null,
        mine && m.user_id !== mgr.me ? h('button', { type: 'button', class: 'icon-btn', title: `Quitar a ${m.profiles.name}`, 'aria-label': `Quitar a ${m.profiles.name}`, html: icon('x', 14),
          onclick: () => void busyRun(async () => { if (await confirmDialog('Quitar del círculo', `¿Quitar a ${m.profiles.name} de «${c.name}»? Dejará de ver sus eventos.`, 'Quitar', true)) await mgr.run(() => api.SocialRemoveMember(c.id, m.user_id)); }) }) : null))));
    if (!full && !code) out.push(h('button', { type: 'button', class: 'btn btn-sm', disabled: busy, onclick: () => void busyRun(async () => go({ kind: 'circle', id, code: await api.SocialInvite(id) })) }, h('span', { html: icon('plus', 14) }), 'Invitar'));
    if (c.kind === 'couple') {
      out.push(h('div', { class: 'so-section' }, 'Citas'),
        h('p', { class: 'small' }, 'Propón varios días y la otra persona elige uno; queda en la agenda de los dos.'),
        h('button', { type: 'button', class: 'btn btn-sm btn-primary', disabled: !full, title: full ? '' : 'Primero tiene que unirse tu pareja', onclick: () => { closeFn?.(null); void import('./dates').then((m) => m.datesDialog(app, c.id)); } },
          h('span', { html: icon('heart', 14) }), 'Ver y proponer citas'));
    }
    if (mine) {
      const name = h('input', { class: 'input', value: c.name, maxlength: '60', 'aria-label': 'Nombre del círculo' });
      const color = colorPicker(c.color, 'Color del círculo');
      out.push(h('div', { class: 'so-section' }, 'Ajustes del círculo'), field('Nombre', name),
        h('div', { class: 'ag-field' }, h('span', { class: 'ag-field-label' }, 'Color en la agenda'), color.el),
        h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn btn-sm', disabled: busy, onclick: () => void busyRun(async () => { await mgr.run(() => api.SocialUpdateCircle(c.id, name.value, color.get()), 'Círculo guardado'); }) }, 'Guardar')));
    }
    out.push(h('div', { class: 'btn-row' },
      h('button', { type: 'button', class: 'btn btn-sm btn-ghost', disabled: busy, onclick: () => void busyRun(async () => {
        if (!await confirmDialog('Salir del círculo', `Dejarás de ver los eventos de «${c.name}».${mine ? ' Como lo creaste tú, pasará a otra persona del círculo (o se borrará si no queda nadie).' : ''}`, 'Salir', true)) return;
        if (await mgr.run(() => api.SocialLeave(c.id), `Has salido de «${c.name}»`)) go({ kind: 'list' });
      }) }, h('span', { html: icon('logOut', 14) }), 'Salir del círculo'),
      h('div', { class: 'spacer' }),
      mine ? h('button', { type: 'button', class: 'btn btn-sm btn-ghost danger', disabled: busy, onclick: () => void busyRun(async () => {
        if (!await confirmDialog('Borrar el círculo', `Se borrará «${c.name}» con todos sus eventos y citas, para todas las personas. No se puede deshacer.`, 'Borrar', true)) return;
        if (await mgr.run(() => api.SocialDeleteCircle(c.id), 'Círculo borrado')) go({ kind: 'list' });
      }) }, h('span', { html: icon('trash', 14) }), 'Borrar') : h('span')));
    return out;
  };

  const render = () => {
    body.replaceChildren(...(view.kind === 'new' ? create() : view.kind === 'join' ? join() : view.kind === 'circle' ? detail(view.id, view.code) : list()));
  };
  const off = mgr.onChange(() => { if (!busy) render(); });
  render();
  await modal('Círculos', body, [{ label: 'Cerrar', value: null, kind: 'ghost' }], { className: 'is-small so-modal', onOpen: (c) => { closeFn = c; } });
  off();
}
