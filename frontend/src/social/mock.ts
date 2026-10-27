// Cuenta y círculos simulados en el navegador (para desarrollar la interfaz
// sin servidor). Envuelve las funciones de la agenda simulada para que los
// eventos de los círculos aparezcan y se editen como en la app.
import type { AgendaBackend } from '../agenda/mock';
import type { Task } from '../agenda/model';
import type { Circle, DateOption, DateProposal, Profile, SharedEvent, SocialSnapshot } from '../types';

const KEY = 'folio-mock-social';
const uid = () => Math.random().toString(16).slice(2, 10) + Math.random().toString(16).slice(2, 10);
const now = () => new Date().toISOString();

interface DB { me: Profile | null; circles: Circle[]; events: SharedEvent[]; proposals: DateProposal[] }

export function socialMock(agenda: AgendaBackend) {
  let db: DB = (() => { try { return JSON.parse(localStorage.getItem(KEY) || '') as DB; } catch { return { me: null, circles: [], events: [], proposals: [] }; } })();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* */ } };
  const snap = (): SocialSnapshot => db.me
    ? { configured: true, signedIn: true, user: { id: db.me.id, email: db.me.email }, profile: db.me, circles: db.circles, events: db.events, proposals: db.proposals, lastSync: now() }
    : { configured: true, signedIn: false, circles: [], events: [], proposals: [], lastSync: '' };
  const me = () => { if (!db.me) throw new Error('Inicia sesión para usar los círculos'); return db.me; };
  const circle = (id: string) => { const c = db.circles.find((x) => x.id === id); if (!c) throw new Error('Círculo no encontrado'); return c; };
  const member = (p: Profile, role: 'owner' | 'member' = 'member') => ({ user_id: p.id, role, joined_at: now(), profiles: p });
  const signIn = (name: string, email: string) => { db.me = { id: 'u-me', name, email, color: '#2f74c0' }; save(); return snap(); };

  const toTask = (e: SharedEvent): Task | null => {
    const c = db.circles.find((x) => x.id === e.circle_id);
    if (!c) return null;
    const by = c.circle_members.find((m) => m.user_id === e.created_by)?.profiles.name;
    return { id: `c:${e.id}`, title: e.title, typeId: `circle:${c.id}`, date: e.date, start: e.start ?? undefined, minutes: e.minutes, notes: e.notes, done: false,
      circle: { id: c.id, name: c.name, kind: c.kind, color: c.color, by, mine: e.created_by === db.me?.id, proposalId: e.proposal_id ?? undefined } } as Task;
  };
  const saveEvent = (t: Task): Task => {
    const u = me();
    const id = t.id?.startsWith('c:') ? t.id.slice(2) : '';
    let e = db.events.find((x) => x.id === id);
    if (!e) { e = { id: uid(), circle_id: t.circle!.id, created_by: u.id, title: '', notes: '', date: '', start: null, minutes: 60 }; db.events.push(e); }
    Object.assign(e, { circle_id: t.circle!.id, title: t.title, notes: t.notes ?? '', date: t.date, start: t.start || null, minutes: t.minutes || 60, updated_at: now() });
    save();
    return toTask(e)!;
  };

  // Para las pruebas: la otra persona del círculo entra o propone una cita
  (window as any).__socialMock = {
    partnerJoins(circleId: string, name = 'Luis') {
      const p = { id: 'u-' + name.toLowerCase(), name, email: `${name.toLowerCase()}@example.com`, color: '#c2185b' };
      circle(circleId).circle_members.push(member(p));
      save();
      return p.id;
    },
    partnerProposes(circleId: string, title: string, options: DateOption[], by = 'u-luis') {
      const id = uid();
      db.proposals.unshift({ id, circle_id: circleId, proposed_by: by, title, notes: '', status: 'open', event_id: null, responded_by: null, created_at: now(), updated_at: now(),
        date_options: options.map((o) => ({ ...o, id: uid(), proposal_id: id, proposed_by: by, created_at: now() })) });
      save();
      return id;
    },
    reset() { db = { me: null, circles: [], events: [], proposals: [] }; save(); },
  };

  return {
    // --- Agenda: los eventos de los círculos se mezclan con las tareas ---
    async AgendaRange(from: string, to: string) {
      const local = await agenda.AgendaRange(from, to);
      const shared = db.me ? db.events.filter((e) => e.date >= from && e.date <= to).map(toTask).filter((t): t is Task => !!t) : [];
      return [...local, ...shared].sort((a, b) => (a.date + (a.start ?? '')).localeCompare(b.date + (b.start ?? '')));
    },
    async AgendaSaveTask(t: Task, scope: any) {
      if (t.circle?.id) {
        const out = saveEvent(t);
        if (t.id && !t.id.startsWith('c:')) await agenda.AgendaDeleteTasks([t.id], 'all');
        return out;
      }
      if (t.id?.startsWith('c:')) {
        db.events = db.events.filter((e) => e.id !== t.id.slice(2)); save();
        return agenda.AgendaSaveTask({ ...t, id: '', circle: undefined }, 'one');
      }
      return agenda.AgendaSaveTask(t, scope);
    },
    async AgendaSaveTasks(list: Task[]) {
      const shared = list.filter((t) => t.circle?.id).map(saveEvent);
      const local = list.filter((t) => !t.circle?.id);
      return [...shared, ...(local.length ? await agenda.AgendaSaveTasks(local) : [])];
    },
    async AgendaDeleteTasks(ids: string[], scope: any) {
      const shared = ids.filter((i) => i.startsWith('c:')).map((i) => i.slice(2));
      if (shared.length) { db.events = db.events.filter((e) => !shared.includes(e.id!)); save(); }
      const local = ids.filter((i) => !i.startsWith('c:'));
      if (local.length) await agenda.AgendaDeleteTasks(local, scope);
    },
    async AgendaMoveTasks(ids: string[], days: number) {
      for (const i of ids.filter((x) => x.startsWith('c:'))) {
        const e = db.events.find((x) => x.id === i.slice(2));
        if (e) { const d = new Date(e.date + 'T12:00:00'); d.setDate(d.getDate() + days); e.date = d.toISOString().slice(0, 10); }
      }
      save();
      const local = ids.filter((i) => !i.startsWith('c:'));
      if (local.length) await agenda.AgendaMoveTasks(local, days);
    },
    async AgendaSetDone(id: string, done: boolean) { if (!id.startsWith('c:')) await agenda.AgendaSetDone(id, done); },

    // --- Cuenta ---
    async SocialStatus() { return snap(); },
    async SocialRestore() { return snap(); },
    async SocialRefresh() { me(); return snap(); },
    async SocialSignIn(email: string, password: string) {
      if (password.length < 8) throw new Error('Correo o contraseña incorrectos');
      return signIn(email.split('@')[0].replace(/^./, (c) => c.toUpperCase()), email);
    },
    async SocialSignUp(email: string, _password: string, name: string) { return { needsConfirm: true, snapshot: snap(), _: name || email }; },
    async SocialRecover() { /* se enviaría un correo */ },
    async SocialSignInGoogle() { return signIn('Ana García', 'ana.garcia@gmail.com'); },
    async SocialSignOut() { db.me = null; save(); },
    async SocialUpdateProfile(name: string, color: string) { Object.assign(me(), { name, color }); for (const c of db.circles) for (const m of c.circle_members) if (m.user_id === db.me!.id) m.profiles = db.me!; save(); return snap(); },
    async SocialDeleteAccount() { db = { me: null, circles: [], events: [], proposals: [] }; save(); },

    // --- Círculos ---
    async SocialCreateCircle(name: string, kind: 'friends' | 'couple', color: string) {
      const u = me();
      db.circles.push({ id: uid(), name, kind, color: color || '#7d3c98', owner: u.id, created_at: now(), circle_members: [member(u, 'owner')] });
      save();
      return snap();
    },
    async SocialUpdateCircle(id: string, name: string, color: string) { Object.assign(circle(id), { name, color }); save(); return snap(); },
    async SocialDeleteCircle(id: string) { db.circles = db.circles.filter((c) => c.id !== id); db.events = db.events.filter((e) => e.circle_id !== id); save(); return snap(); },
    async SocialInvite(id: string) {
      const c = circle(id);
      if (c.kind === 'couple' && c.circle_members.length >= 2) throw new Error('Este círculo de pareja ya está completo');
      return 'K7M4Q2XP';
    },
    async SocialJoin(code: string) {
      const u = me();
      if (code.replace(/\W/g, '').toUpperCase() !== 'DEMO2345') throw new Error('El código no existe o ha caducado');
      const marta = { id: 'u-marta', name: 'Marta', email: 'marta@example.com', color: '#16a085' };
      const c: Circle = { id: uid(), name: 'Familia', kind: 'friends', color: '#e67e22', owner: marta.id, created_at: now(), circle_members: [member(marta, 'owner'), member(u)] };
      db.circles.push(c);
      save();
      return snap();
    },
    async SocialLeave(id: string) { const c = circle(id); c.circle_members = c.circle_members.filter((m) => m.user_id !== me().id); db.circles = db.circles.filter((x) => x.circle_members.some((m) => m.user_id === db.me!.id)); save(); return snap(); },
    async SocialRemoveMember(id: string, userId: string) { const c = circle(id); c.circle_members = c.circle_members.filter((m) => m.user_id !== userId); save(); return snap(); },

    // --- Citas ---
    async SocialProposeDate(circleId: string, title: string, notes: string, options: DateOption[]) {
      const u = me();
      if (circle(circleId).kind !== 'couple') throw new Error('Las citas son para círculos de pareja');
      const id = uid();
      db.proposals.unshift({ id, circle_id: circleId, proposed_by: u.id, title: title || 'Cita', notes, status: 'open', event_id: null, responded_by: null, created_at: now(), updated_at: now(),
        date_options: options.map((o) => ({ ...o, minutes: o.minutes || 120, id: uid(), proposal_id: id, proposed_by: u.id, created_at: now() })) });
      save();
      return snap();
    },
    async SocialCounter(pid: string, options: DateOption[]) {
      const p = db.proposals.find((x) => x.id === pid)!;
      p.date_options.push(...options.map((o) => ({ ...o, minutes: o.minutes || 120, id: uid(), proposal_id: pid, proposed_by: me().id, created_at: now() })));
      save();
      return snap();
    },
    async SocialAccept(optionId: string) {
      const u = me();
      const p = db.proposals.find((x) => x.date_options.some((o) => o.id === optionId))!;
      const o = p.date_options.find((x) => x.id === optionId)!;
      if (o.proposed_by === u.id) throw new Error('La otra persona tiene que elegir entre tus propuestas');
      const e: SharedEvent = { id: uid(), circle_id: p.circle_id, created_by: p.proposed_by, title: p.title, notes: p.notes, date: o.date, start: o.start, minutes: o.minutes, proposal_id: p.id };
      db.events.push(e);
      Object.assign(p, { status: 'accepted', event_id: e.id, responded_by: u.id, updated_at: now() });
      save();
      return snap();
    },
    async SocialCloseProposal(pid: string, status: 'declined' | 'cancelled') {
      Object.assign(db.proposals.find((x) => x.id === pid)!, { status, responded_by: me().id, updated_at: now() });
      save();
      return snap();
    },
  };
}
