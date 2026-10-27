-- Folio: perfiles, círculos (amigos o pareja), eventos compartidos y citas.
-- Los eventos privados no están aquí: siguen en el dispositivo (y en la nube
-- de cada uno). Cada tabla tiene seguridad por filas: solo ves los círculos
-- de los que eres miembro y lo que hay en ellos.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------- Perfiles ----------

create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  name text not null default '' check (char_length(name) <= 60),
  email text not null default '',
  color text not null default '#2f74c0' check (color ~ '^#[0-9a-fA-F]{6}$'),
  updated_at timestamptz not null default now()
);

-- Al registrarse se crea su perfil (nombre de Google o la parte del correo antes de la @)
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, name, email)
  values (new.id,
          left(coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), nullif(new.raw_user_meta_data ->> 'name', ''), split_part(coalesce(new.email, ''), '@', 1)), 60),
          coalesce(new.email, ''));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Círculos ----------

create table public.circles (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  kind text not null check (kind in ('friends', 'couple')),
  color text not null default '#7d3c98' check (color ~ '^#[0-9a-fA-F]{6}$'),
  owner uuid not null default auth.uid() references public.profiles on delete cascade,
  created_at timestamptz not null default now()
);

create table public.circle_members (
  circle_id uuid not null references public.circles on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (circle_id, user_id)
);
create index circle_members_user on public.circle_members (user_id);

create table public.circle_invites (
  code text primary key,
  circle_id uuid not null references public.circles on delete cascade,
  created_by uuid not null default auth.uid() references public.profiles on delete cascade,
  expires_at timestamptz not null default now() + interval '7 days'
);

-- ¿Es la persona que llama miembro del círculo? (security definer: evita la
-- recursión de las políticas sobre circle_members)
create function public.is_member(c uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.circle_members m where m.circle_id = c and m.user_id = auth.uid());
$$;

create function public.shares_circle(other uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.circle_members a join public.circle_members b on a.circle_id = b.circle_id
    where a.user_id = auth.uid() and b.user_id = other);
$$;

create function public.is_owner(c uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.circles x where x.id = c and x.owner = auth.uid());
$$;

-- Quien crea el círculo entra como propietario
create function public.handle_new_circle() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.circle_members (circle_id, user_id, role) values (new.id, new.owner, 'owner');
  return new;
end $$;
create trigger on_circle_created after insert on public.circles
  for each row execute function public.handle_new_circle();

-- Un círculo de pareja tiene como mucho dos personas
create function public.check_circle_capacity() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select kind from public.circles where id = new.circle_id) = 'couple'
     and (select count(*) from public.circle_members where circle_id = new.circle_id) >= 2 then
    raise exception 'Este círculo de pareja ya está completo' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger circle_capacity before insert on public.circle_members
  for each row execute function public.check_circle_capacity();

-- El tipo de círculo no cambia; el propietario solo cambia al salir (leave_circle)
create function public.keep_circle_kind() returns trigger
language plpgsql as $$
begin
  if new.kind <> old.kind
     or (new.owner <> old.owner and current_setting('folio.transfer', true) is distinct from 'on') then
    raise exception 'No se puede cambiar el tipo ni el propietario del círculo' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger circle_kind before update on public.circles
  for each row execute function public.keep_circle_kind();

-- ---------- Eventos compartidos ----------

create table public.shared_events (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references public.circles on delete cascade,
  created_by uuid default auth.uid() references public.profiles on delete set null,
  title text not null check (char_length(title) between 1 and 200),
  notes text not null default '' check (char_length(notes) <= 4000),
  date date not null,
  start text check (start ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  minutes integer not null default 60 check (minutes between 0 and 1440),
  proposal_id uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references public.profiles on delete set null
);
create index shared_events_circle_date on public.shared_events (circle_id, date);

create function public.touch() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if tg_table_name = 'shared_events' then new.updated_by := auth.uid(); end if;
  return new;
end $$;
create trigger shared_events_touch before update on public.shared_events for each row execute function public.touch();
create trigger profiles_touch before update on public.profiles for each row execute function public.touch();

-- ---------- Citas (solo en círculos de pareja) ----------

create table public.date_proposals (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references public.circles on delete cascade,
  proposed_by uuid default auth.uid() references public.profiles on delete set null,
  title text not null default 'Cita' check (char_length(title) between 1 and 200),
  notes text not null default '' check (char_length(notes) <= 4000),
  status text not null default 'open' check (status in ('open', 'accepted', 'declined', 'cancelled')),
  event_id uuid references public.shared_events on delete set null,
  responded_by uuid references public.profiles on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index date_proposals_circle on public.date_proposals (circle_id, status);
create trigger date_proposals_touch before update on public.date_proposals for each row execute function public.touch();

create table public.date_options (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.date_proposals on delete cascade,
  date date not null,
  start text check (start ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  minutes integer not null default 120 check (minutes between 0 and 1440),
  proposed_by uuid default auth.uid() references public.profiles on delete set null,
  created_at timestamptz not null default now()
);
create index date_options_proposal on public.date_options (proposal_id);

create function public.proposal_circle(p uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select circle_id from public.date_proposals where id = p;
$$;

create function public.check_proposal() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select kind from public.circles where id = new.circle_id) <> 'couple' then
    raise exception 'Las citas son para círculos de pareja' using errcode = 'P0001';
  end if;
  -- El estado «aceptada» solo lo pone accept_date (que enlaza el evento)
  if new.status = 'accepted' and (tg_op = 'INSERT' or old.status <> 'accepted')
     and current_setting('folio.accepting', true) is distinct from 'on' then
    raise exception 'Para aceptar una cita elige una de sus opciones' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' then
    if new.status <> old.status and new.status <> 'accepted' then new.responded_by := auth.uid(); end if;
    if old.status <> 'open' and new.status <> old.status then
      raise exception 'Esta cita ya está cerrada' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
create trigger date_proposals_check before insert or update on public.date_proposals
  for each row execute function public.check_proposal();

-- ---------- Funciones que llama la app ----------

-- Código de invitación (8 caracteres sin 0/O/1/I). En pareja solo si falta alguien.
create function public.create_invite(c uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code text := '';
  k text;
begin
  if not public.is_member(c) then raise exception 'No eres miembro de este círculo' using errcode = 'P0001'; end if;
  select kind into k from public.circles where id = c;
  if k = 'couple' and (select count(*) from public.circle_members where circle_id = c) >= 2 then
    raise exception 'Este círculo de pareja ya está completo' using errcode = 'P0001';
  end if;
  for i in 1..8 loop
    code := code || substr(alphabet, 1 + (get_byte(extensions.gen_random_bytes(1), 0) % 32), 1);
  end loop;
  insert into public.circle_invites (code, circle_id, created_by) values (code, c, auth.uid());
  return code;
end $$;

create function public.join_circle(invite text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  inv public.circle_invites;
begin
  if auth.uid() is null then raise exception 'Inicia sesión primero' using errcode = 'P0001'; end if;
  select * into inv from public.circle_invites where code = upper(regexp_replace(invite, '[^A-Za-z0-9]', '', 'g'));
  if not found or inv.expires_at < now() then
    raise exception 'El código no existe o ha caducado' using errcode = 'P0001';
  end if;
  if public.is_member(inv.circle_id) then return inv.circle_id; end if;
  insert into public.circle_members (circle_id, user_id) values (inv.circle_id, auth.uid());
  -- En pareja el código sirve una vez
  if (select kind from public.circles where id = inv.circle_id) = 'couple' then
    delete from public.circle_invites where code = inv.code;
  end if;
  return inv.circle_id;
end $$;

-- Salir de un círculo. Si sale el propietario, pasa a quien lleve más tiempo;
-- si no queda nadie, el círculo se borra.
create function public.leave_circle(c uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  heir uuid;
begin
  delete from public.circle_members where circle_id = c and user_id = auth.uid();
  if (select owner from public.circles where id = c) = auth.uid() then
    select user_id into heir from public.circle_members where circle_id = c order by joined_at limit 1;
    if heir is null then
      delete from public.circles where id = c;
    else
      perform set_config('folio.transfer', 'on', true);
      update public.circles set owner = heir where id = c;
      perform set_config('folio.transfer', 'off', true);
      update public.circle_members set role = 'owner' where circle_id = c and user_id = heir;
    end if;
  end if;
end $$;

create function public.remove_member(c uuid, member uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_owner(c) then raise exception 'Solo quien creó el círculo puede quitar a alguien' using errcode = 'P0001'; end if;
  if member = auth.uid() then raise exception 'Para salir usa «Salir del círculo»' using errcode = 'P0001'; end if;
  delete from public.circle_members where circle_id = c and user_id = member;
end $$;

-- Aceptar una de las opciones de una cita: crea el evento compartido y cierra la propuesta.
create function public.accept_date(option_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  o public.date_options;
  p public.date_proposals;
  ev uuid;
begin
  select * into o from public.date_options where id = option_id;
  if not found then raise exception 'Esa opción ya no existe' using errcode = 'P0001'; end if;
  select * into p from public.date_proposals where id = o.proposal_id for update;
  if not public.is_member(p.circle_id) then raise exception 'No eres miembro de este círculo' using errcode = 'P0001'; end if;
  if p.status <> 'open' then raise exception 'Esta cita ya está cerrada' using errcode = 'P0001'; end if;
  if o.proposed_by = auth.uid() then raise exception 'La otra persona tiene que elegir entre tus propuestas' using errcode = 'P0001'; end if;
  insert into public.shared_events (circle_id, created_by, title, notes, date, start, minutes, proposal_id)
  values (p.circle_id, p.proposed_by, p.title, p.notes, o.date, o.start, o.minutes, p.id)
  returning id into ev;
  perform set_config('folio.accepting', 'on', true);
  update public.date_proposals set status = 'accepted', event_id = ev, responded_by = auth.uid() where id = p.id;
  perform set_config('folio.accepting', 'off', true);
  return ev;
end $$;

-- Borrar la cuenta: se sale de todos los círculos (cediendo los propios) y se borra el usuario.
create function public.delete_my_account() returns void
language plpgsql security definer set search_path = '' as $$
declare
  c uuid;
begin
  for c in select circle_id from public.circle_members where user_id = auth.uid() loop
    perform public.leave_circle(c);
  end loop;
  delete from auth.users where id = auth.uid();
end $$;

-- ---------- Seguridad por filas ----------

alter table public.profiles enable row level security;
alter table public.circles enable row level security;
alter table public.circle_members enable row level security;
alter table public.circle_invites enable row level security;
alter table public.shared_events enable row level security;
alter table public.date_proposals enable row level security;
alter table public.date_options enable row level security;

create policy "ver mi perfil y el de mis círculos" on public.profiles for select to authenticated
  using (id = auth.uid() or public.shares_circle(id));
create policy "editar mi perfil" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy "ver mis círculos" on public.circles for select to authenticated using (public.is_member(id));
create policy "crear círculos" on public.circles for insert to authenticated with check (owner = auth.uid());
create policy "editar mis círculos" on public.circles for update to authenticated using (owner = auth.uid()) with check (owner = auth.uid());
create policy "borrar mis círculos" on public.circles for delete to authenticated using (owner = auth.uid());

create policy "ver miembros" on public.circle_members for select to authenticated using (public.is_member(circle_id));

create policy "ver invitaciones" on public.circle_invites for select to authenticated using (public.is_member(circle_id));
create policy "anular invitaciones" on public.circle_invites for delete to authenticated using (public.is_member(circle_id));

create policy "ver eventos" on public.shared_events for select to authenticated using (public.is_member(circle_id));
create policy "crear eventos" on public.shared_events for insert to authenticated
  with check (public.is_member(circle_id) and created_by = auth.uid());
create policy "editar eventos" on public.shared_events for update to authenticated
  using (public.is_member(circle_id)) with check (public.is_member(circle_id));
create policy "borrar eventos" on public.shared_events for delete to authenticated
  using (public.is_member(circle_id) and (created_by = auth.uid() or public.is_owner(circle_id)));

create policy "ver citas" on public.date_proposals for select to authenticated using (public.is_member(circle_id));
create policy "proponer citas" on public.date_proposals for insert to authenticated
  with check (public.is_member(circle_id) and proposed_by = auth.uid() and status = 'open');
create policy "responder citas" on public.date_proposals for update to authenticated
  using (public.is_member(circle_id)) with check (public.is_member(circle_id));

create policy "ver opciones" on public.date_options for select to authenticated
  using (public.is_member(public.proposal_circle(proposal_id)));
create policy "proponer opciones" on public.date_options for insert to authenticated
  with check (public.is_member(public.proposal_circle(proposal_id)) and proposed_by = auth.uid()
              and (select status from public.date_proposals where id = proposal_id) = 'open');
create policy "quitar mis opciones" on public.date_options for delete to authenticated
  using (proposed_by = auth.uid());

-- Nadie anónimo toca nada
revoke all on all tables in schema public from anon;
revoke execute on all functions in schema public from anon, public;
grant execute on function public.create_invite(uuid), public.join_circle(text), public.leave_circle(uuid),
  public.remove_member(uuid, uuid), public.accept_date(uuid), public.delete_my_account() to authenticated;
grant execute on function public.is_member(uuid), public.shares_circle(uuid), public.is_owner(uuid), public.proposal_circle(uuid) to authenticated;

-- Avisos en tiempo real (si el proyecto los tiene activados)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.shared_events, public.date_proposals, public.date_options, public.circle_members;
  end if;
end $$;
