// Tu cuenta: entrar con Google o con correo y contraseña (o crear la cuenta),
// recuperar la contraseña y, con la sesión abierta, nombre y color con los que
// te ven en tus círculos, cerrar sesión o borrar la cuenta.
import type { App } from '../app';
import { api } from '../api';
import { confirmDialog, h, modal, toast } from '../ui/dom';
import { icon } from '../ui/icons';
import { GOOGLE_LOGO, avatar, colorPicker, field } from './common';

export async function accountDialog(app: App) {
  const mgr = app.social;
  const body = h('div', { class: 'so' });
  let mode: 'in' | 'up' = 'in';
  let busy = false;
  let draft = { email: '', name: '' };
  let closeFn: ((v: null) => void) | undefined;

  const busyRun = async (work: () => Promise<void>) => {
    if (busy) return;
    busy = true;
    render();
    try { await work(); } catch (e) { toast(String((e as Error)?.message ?? e).replace(/^Error:\s*/, ''), { kind: 'error', ms: 7000 }); }
    finally { busy = false; render(); }
  };

  const signedOut = (): HTMLElement[] => {
    const email = h('input', { class: 'input', type: 'email', value: draft.email, autocomplete: 'email', placeholder: 'tu@correo.es', 'aria-label': 'Correo electrónico' });
    const pass = h('input', { class: 'input', type: 'password', autocomplete: mode === 'up' ? 'new-password' : 'current-password', 'aria-label': 'Contraseña', minlength: '8' });
    const name = h('input', { class: 'input', value: draft.name, autocomplete: 'name', placeholder: 'Cómo te verán tus círculos', 'aria-label': 'Nombre' });
    const keep = () => { draft = { email: email.value, name: name.value }; };
    for (const i of [email, name]) i.addEventListener('input', keep);
    const submit = () => void busyRun(async () => {
      keep();
      if (!email.value.includes('@')) throw new Error('Escribe tu correo electrónico');
      if (mode === 'in') {
        mgr.apply(await api.SocialSignIn(email.value, pass.value));
        toast('Has entrado en Folio', { kind: 'ok' });
      } else {
        const r = await api.SocialSignUp(email.value, pass.value, name.value);
        if (r.needsConfirm) {
          toast('Te hemos enviado un correo: abre el enlace para confirmar la cuenta y luego entra aquí.', { kind: 'ok', ms: 10000 });
          mode = 'in';
          return;
        }
        mgr.apply(r.snapshot);
        toast('Cuenta creada', { kind: 'ok' });
      }
    });
    for (const i of [email, pass, name]) i.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    const tab = (m: 'in' | 'up', label: string) => h('button', { type: 'button', class: mode === m ? 'on' : '', 'aria-pressed': String(mode === m), onclick: () => { keep(); mode = m; render(); } }, label);
    return [
      h('p', {}, 'Con una cuenta puedes crear círculos de amigos o de pareja y compartir eventos de la agenda con ellos. Tus documentos y tus tareas privadas siguen solo en tus dispositivos.'),
      h('button', { type: 'button', class: 'btn so-google', disabled: busy, onclick: () => void busyRun(async () => { mgr.apply(await api.SocialSignInGoogle()); toast('Has entrado con Google', { kind: 'ok' }); }) },
        h('span', { html: GOOGLE_LOGO }), 'Continuar con Google'),
      h('div', { class: 'so-or' }, 'o con tu correo'),
      h('div', { class: 'so-tabs', role: 'group', 'aria-label': 'Entrar o crear cuenta' }, tab('in', 'Entrar'), tab('up', 'Crear cuenta')),
      ...(mode === 'up' ? [field('Nombre', name)] : []),
      field('Correo electrónico', email),
      field('Contraseña', pass, mode === 'up' ? 'Al menos 8 caracteres.' : undefined),
      h('div', { class: 'btn-row' },
        mode === 'in' ? h('button', { type: 'button', class: 'btn btn-sm btn-ghost', disabled: busy, onclick: () => void busyRun(async () => {
          keep();
          if (!email.value.includes('@')) throw new Error('Escribe primero tu correo');
          await api.SocialRecover(email.value);
          toast('Si hay una cuenta con ese correo, te llegará un enlace para elegir otra contraseña.', { kind: 'ok', ms: 8000 });
        }) }, '¿Has olvidado la contraseña?') : h('span'),
        h('div', { class: 'spacer' }),
        h('button', { type: 'button', class: 'btn btn-primary', disabled: busy, onclick: submit }, mode === 'in' ? 'Entrar' : 'Crear cuenta')),
    ];
  };

  const signedIn = (): HTMLElement[] => {
    const p = mgr.snap.profile ?? { id: '', name: '', email: mgr.snap.user?.email ?? '', color: '#2f74c0' };
    const name = h('input', { class: 'input', value: p.name, maxlength: '60', 'aria-label': 'Nombre' });
    const color = colorPicker(p.color, 'Tu color');
    return [
      h('div', { class: 'so-me' }, avatar(p), h('div', { class: 'so-me-main' }, h('strong', {}, p.name || p.email), h('span', { class: 'muted small' }, p.email))),
      field('Nombre', name, 'Es como te ven en tus círculos.'),
      h('div', { class: 'ag-field' }, h('span', { class: 'ag-field-label' }, 'Tu color'), color.el),
      h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn btn-sm btn-primary', disabled: busy, onclick: () => void busyRun(async () => { await mgr.run(() => api.SocialUpdateProfile(name.value, color.get()), 'Perfil guardado'); }) }, 'Guardar'),
        h('div', { class: 'spacer' }),
        h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { closeFn?.(null); void import('./circles').then((m) => m.circlesDialog(app)); } }, h('span', { html: icon('users', 14) }), 'Mis círculos')),
      h('div', { class: 'so-section' }, 'Sesión'),
      h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn btn-sm', disabled: busy, onclick: () => void busyRun(async () => {
          await api.SocialSignOut();
          mgr.apply(await api.SocialStatus());
          toast('Has cerrado la sesión. Los eventos de tus círculos ya no se muestran en este dispositivo.');
        }) }, h('span', { html: icon('logOut', 14) }), 'Cerrar sesión'),
        h('div', { class: 'spacer' }),
        h('button', { type: 'button', class: 'btn btn-sm btn-ghost danger', disabled: busy, onclick: () => void busyRun(async () => {
          if (!await confirmDialog('Borrar tu cuenta', 'Saldrás de todos tus círculos (los que creaste pasan a otra persona) y se borrará tu cuenta. Tus documentos y tu agenda privada no se tocan. No se puede deshacer.', 'Borrar la cuenta', true)) return;
          await api.SocialDeleteAccount();
          mgr.apply(await api.SocialStatus());
          toast('Cuenta borrada');
        }) }, 'Borrar mi cuenta')),
    ];
  };

  const render = () => {
    if (!mgr.snap.configured) {
      body.replaceChildren(h('p', {}, 'Las cuentas todavía no están configuradas en esta copia de Folio.'), h('p', { class: 'muted small' }, 'Hace falta enlazar Folio con su servidor (Supabase). Mientras tanto, la agenda y los documentos funcionan igual, solo en tus dispositivos.'));
      return;
    }
    body.replaceChildren(...(mgr.snap.signedIn ? signedIn() : signedOut()));
  };
  const off = mgr.onChange(render);
  render();
  await modal('Tu cuenta', body, [{ label: 'Cerrar', value: null, kind: 'ghost' }], { className: 'is-small so-modal', onOpen: (c) => { closeFn = c; } });
  off();
}
