-- Pruebas del esquema: cada persona solo ve sus círculos, límites de pareja, invitaciones, citas y borrar cuenta.
-- Se ejecutan con supabase/tests/run.sh
\set ON_ERROR_STOP 1
\set QUIET 1
-- Personas
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'ana@example.com', '{"full_name":"Ana García"}'),
  ('00000000-0000-0000-0000-00000000000b', 'luis@example.com', '{}'),
  ('00000000-0000-0000-0000-00000000000c', 'marta@example.com', '{"name":"Marta"}');

create function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, false) $$;
create function pg_temp.check(ok boolean, msg text) returns void language plpgsql as $$ begin if not ok then raise exception 'FALLO: %', msg; end if; raise notice 'ok: %', msg; end $$;
-- Ejecuta sql como el rol actual y devuelve el mensaje de error (o '' si no falla)
create function pg_temp.err(q text) returns text language plpgsql as $$ begin execute q; return ''; exception when others then return sqlerrm; end $$;

select pg_temp.check((select name from profiles where email = 'ana@example.com') = 'Ana García', 'perfil con el nombre de Google');
select pg_temp.check((select name from profiles where email = 'luis@example.com') = 'luis', 'perfil con la parte del correo');

-- Ana crea un círculo de pareja y uno de amigos
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
insert into circles (name, kind) values ('Nosotros', 'couple');
insert into circles (name, kind, color) values ('Amigos', 'friends', '#16a085');
select pg_temp.check((select count(*) from circles) = 2, 'Ana ve sus dos círculos');
select pg_temp.check((select role from circle_members m join circles c on c.id = m.circle_id where c.name = 'Nosotros') = 'owner', 'Ana entra como propietaria');
select pg_temp.check(pg_temp.err($q$ insert into circles (name, kind, owner) values ('Falso', 'friends', '00000000-0000-0000-0000-00000000000b') $q$) <> '', 'no se crea un círculo a nombre de otra persona');
select pg_temp.check(pg_temp.err($q$ update circles set kind = 'friends' where name = 'Nosotros' $q$) <> '', 'no se cambia el tipo de círculo');
select pg_temp.check(pg_temp.err($q$ insert into circle_members (circle_id, user_id) select id, '00000000-0000-0000-0000-00000000000c' from circles where name = 'Amigos' $q$) <> '', 'no se mete a nadie a mano (solo con invitación)');
select create_invite((select id from circles where name = 'Nosotros')) as pareja \gset
select create_invite((select id from circles where name = 'Amigos')) as amigos \gset
select pg_temp.check(length(:'pareja') = 8 and :'pareja' ~ '^[A-HJ-NP-Z2-9]+$', 'código de 8 caracteres legibles');

-- Luis no ve nada hasta unirse
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.check((select count(*) from circles) = 0, 'Luis no ve círculos ajenos');
select pg_temp.check((select count(*) from profiles) = 1, 'Luis solo ve su perfil');
select pg_temp.check((select count(*) from circle_invites) = 0, 'Luis no ve las invitaciones');
select join_circle(lower(:'pareja'));
select pg_temp.check((select count(*) from circles) = 1, 'Luis entra en la pareja (el código no distingue mayúsculas)');
select pg_temp.check((select count(*) from profiles) = 2, 'Luis ve el perfil de Ana');

-- Marta no puede entrar en la pareja (completa y el código ya se usó)
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select pg_temp.check(pg_temp.err(format('select join_circle(%L)', :'pareja')) like '%caducado%', 'el código de pareja sirve una vez');
select join_circle(:'amigos');
select pg_temp.check((select count(*) from circles) = 1 and (select name from circles) = 'Amigos', 'Marta solo ve Amigos');
select pg_temp.check((select count(*) from profiles) = 2, 'Marta ve a Ana (comparten círculo) y no a Luis');
reset role;
select pg_temp.check(pg_temp.err($q$ insert into circle_members (circle_id, user_id) select id, '00000000-0000-0000-0000-00000000000c' from circles where name = 'Nosotros' $q$) like '%completo%', 'una pareja no admite a una tercera persona');
set role authenticated;

-- Eventos
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
insert into shared_events (circle_id, created_by, title, date, start, minutes) select id, auth.uid(), 'Cena', '2026-11-01', '20:00', 120 from circles where name = 'Nosotros';
insert into shared_events (circle_id, created_by, title, date) select id, auth.uid(), 'Cumpleaños', '2026-11-05' from circles where name = 'Amigos';
select pg_temp.check(pg_temp.err($q$ insert into shared_events (circle_id, created_by, title, date, start) select id, auth.uid(), 'Mal', '2026-11-01', '25:00' from circles where name = 'Amigos' $q$) <> '', 'hora no válida rechazada');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select pg_temp.check((select count(*) from shared_events) = 1, 'Marta ve el evento de Amigos y no el de la pareja');
update shared_events set title = 'Cumple de Ana' where title = 'Cumpleaños';
select pg_temp.check((select title from shared_events) = 'Cumple de Ana', 'cualquier miembro edita eventos del círculo');
select pg_temp.check((select updated_by from shared_events) = '00000000-0000-0000-0000-00000000000c', 'se apunta quién lo cambió');
delete from shared_events;
reset role;
select pg_temp.check((select count(*) from shared_events where title = 'Cumple de Ana') = 1, 'Marta no borra un evento que no creó (no es propietaria)');
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.check((select count(*) from shared_events where title = 'Cumple de Ana') = 0, 'Luis no ve el evento de Amigos');
update shared_events set title = 'hackeado' where title = 'Cumple de Ana';
reset role;
select pg_temp.check((select count(*) from shared_events where title = 'hackeado') = 0, 'Luis no puede editar eventos de un círculo ajeno');
set role authenticated;

-- Citas
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
insert into date_proposals (circle_id, proposed_by, title) select id, auth.uid(), 'Cine' from circles where name = 'Nosotros' returning id as prop \gset
insert into date_options (proposal_id, date, start, minutes, proposed_by) values (:'prop', '2026-11-06', '19:00', 150, auth.uid()) returning id as opt1 \gset
select pg_temp.check(pg_temp.err($q$ insert into date_proposals (circle_id, proposed_by, title) select id, auth.uid(), 'Cita' from circles where name = 'Amigos' $q$) like '%pareja%', 'las citas son solo para parejas');
select pg_temp.check(pg_temp.err(format('select accept_date(%L)', :'opt1')) like '%otra persona%', 'no puedes aceptar tu propia opción');
select pg_temp.check(pg_temp.err(format('update date_proposals set status = %L where id = %L', 'accepted', :'prop')) like '%elige una de sus opciones%', 'no se marca aceptada a mano');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select pg_temp.check((select count(*) from date_proposals) = 0, 'Marta no ve las citas de la pareja');
select pg_temp.check(pg_temp.err(format('select accept_date(%L)', :'opt1')) like '%miembro%', 'Marta no puede aceptar una cita ajena');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
insert into date_options (proposal_id, date, start, minutes, proposed_by) values (:'prop', '2026-11-07', null, 120, auth.uid()) returning id as opt2 \gset
select pg_temp.check(pg_temp.err(format('select accept_date(%L)', :'opt2')) like '%otra persona%', 'Luis tampoco acepta su contrapropuesta');
select accept_date(:'opt1') as ev \gset
select pg_temp.check((select status from date_proposals where id = :'prop') = 'accepted' and (select event_id from date_proposals where id = :'prop') = :'ev'::uuid, 'aceptada y enlazada al evento');
select pg_temp.check((select title || ' ' || date || ' ' || start from shared_events where id = :'ev') = 'Cine 2026-11-06 19:00', 'evento creado con la opción elegida');
select pg_temp.check((select created_by from shared_events where id = :'ev') = '00000000-0000-0000-0000-00000000000a', 'el evento es de quien propuso la cita');
select pg_temp.check(pg_temp.err(format('select accept_date(%L)', :'opt2')) like '%cerrada%', 'no se acepta dos veces');
select pg_temp.check(pg_temp.err(format('update date_proposals set status = %L where id = %L', 'declined', :'prop')) like '%cerrada%', 'una cita cerrada no cambia');
select pg_temp.check(pg_temp.err(format('insert into date_options (proposal_id, date, proposed_by) values (%L, %L, auth.uid())', :'prop', '2026-11-08')) <> '', 'no se añaden opciones a una cita cerrada');

-- Rechazar
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
insert into date_proposals (circle_id, proposed_by, title) select id, auth.uid(), 'Paseo' from circles where name = 'Nosotros' returning id as prop2 \gset
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
update date_proposals set status = 'declined' where id = :'prop2';
select pg_temp.check((select status || ' ' || responded_by from date_proposals where id = :'prop2') = 'declined 00000000-0000-0000-0000-00000000000b', 'Luis rechaza y queda apuntado');

-- Quitar miembros y salir
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select pg_temp.check(pg_temp.err(format('select remove_member(%L, %L)', (select id from circles where name = 'Amigos'), '00000000-0000-0000-0000-00000000000a')) like '%Solo quien creó%', 'solo la propietaria quita gente');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select leave_circle((select id from circles where name = 'Amigos'));
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select pg_temp.check((select owner from circles where name = 'Amigos') = '00000000-0000-0000-0000-00000000000c', 'si sale la propietaria, el círculo pasa a Marta');
select pg_temp.check((select role from circle_members where user_id = auth.uid()) = 'owner', 'Marta pasa a ser propietaria');
select pg_temp.check(pg_temp.err($q$ update circles set owner = '00000000-0000-0000-0000-00000000000b' where name = 'Amigos' $q$) <> '', 'no se regala la propiedad a mano');

-- Borrar la cuenta
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select delete_my_account();
reset role;
select pg_temp.check((select count(*) from auth.users where email = 'luis@example.com') = 0, 'cuenta de Luis borrada');
select pg_temp.check((select count(*) from circles where name = 'Nosotros') = 1, 'la pareja sigue para Ana');
select pg_temp.check((select count(*) from circle_members m join circles c on c.id = m.circle_id where c.name = 'Nosotros') = 1, 'Luis ya no es miembro');

-- Anónimos: nada
set role anon;
select pg_temp.check(pg_temp.err('select * from circles') like '%permission denied%', 'anon no lee tablas');
select pg_temp.check(pg_temp.err($q$ select join_circle('ABCDEFGH') $q$) like '%permission denied%', 'anon no llama funciones');
reset role;
\echo TODO EN ORDEN
