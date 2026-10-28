// Pruebas del analizador de frases de la agenda (fecha fija: lunes 26-10-2026).
// Se ejecutan con «npm test».
import { parse, parseMany, parseGoTo } from '../src/agenda/parse';
import { matchTasks, parseCommand, splitClauses } from '../src/agenda/commands';
import { parseTime, parseDuration } from '../src/agenda/time';
const types: any[] = [
  { id: 'mock', name: 'Simulacro / examen', priority: 1 }, { id: 'review', name: 'Repaso', priority: 2 },
  { id: 'study', name: 'Estudio nuevo', priority: 3 }, { id: 'work', name: 'Clase / trabajo', priority: 4 }, { id: 'personal', name: 'Personal', priority: 5 }];
const T = '2026-10-26'; // lunes
let fails = 0, total = 0;
function eq(name: string, got: any, want: any) {
  total++;
  for (const k of Object.keys(want)) {
    if (JSON.stringify(got[k]) !== JSON.stringify(want[k])) { fails++; console.log(`✗ ${name}\n   ${k}: got ${JSON.stringify(got[k])} want ${JSON.stringify(want[k])}`); return; }
  }
}
const P = (s: string) => parse(s, T, types);
eq('mañana de 9 a 11', P('mañana de 9 a 11 estudio tema 4'), { date: '2026-10-27', start: '09:00', minutes: 120, typeId: 'study', topicNumber: 4, title: 'Estudio tema 4' });
eq('lunes a viernes', P('de lunes a viernes de 9 a 11 estudio tema 4 hasta el 20 de diciembre'), { date: '2026-10-26', start: '09:00', minutes: 120, repeat: { freq: 'weekly', interval: 1, weekdays: [1,2,3,4,5], until: '2026-12-20' } });
eq('a las 5 (tarde)', P('repaso tema 2 a las 5'), { start: '17:00', typeId: 'review', title: 'Repaso tema 2' });
eq('a las 5 de la mañana', P('correr a las 5 de la mañana'), { start: '05:00', title: 'Correr' });
eq('a las 9 y media', P('el jueves a las 9 y media simulacro'), { date: '2026-10-29', start: '09:30', typeId: 'mock' });
eq('17:30', P('llamar a Ana 17:30'), { start: '17:30', title: 'Llamar a Ana' });
eq('durante 2 horas', P('pasado mañana estudiar durante 2 horas'), { date: '2026-10-28', minutes: 120, typeId: 'study' });
eq('hora y media', P('repasar tema 7 hora y media'), { minutes: 90, topicNumber: 7 });
eq('45 min', P('test de 45 min el viernes'), { minutes: 45, date: '2026-10-30', typeId: 'mock' });
eq('cada martes y jueves', P('clase de inglés cada martes y jueves a las 18:00'), { repeat: { freq: 'weekly', interval: 1, weekdays: [2, 4] }, date: '2026-10-27', start: '18:00', typeId: 'work', title: 'Clase de inglés' });
eq('todos los días', P('leer 30 min todos los días a las 22:00'), { repeat: { freq: 'daily', interval: 1 }, minutes: 30, start: '22:00', title: 'Leer' });
eq('cada 2 semanas', P('simulacro cada 2 semanas los sábados de 9 a 13'), { repeat: { freq: 'weekly', interval: 2, weekdays: [6] }, date: '2026-10-31', start: '09:00', minutes: 240 });
eq('hasta junio', P('estudio de lunes a viernes de 16 a 20 hasta junio'), { repeat: { freq: 'weekly', interval: 1, weekdays: [1,2,3,4,5], until: '2027-06-30' }, start: '16:00', minutes: 240 });
eq('3 de noviembre', P('médico el 3 de noviembre a las 10'), { date: '2026-11-03', start: '10:00', title: 'Médico' });
eq('fecha pasada → año siguiente', P('cumpleaños 2 de enero'), { date: '2027-01-02', title: 'Cumpleaños' });
eq('dentro de 2 semanas', P('entregar trabajo dentro de 2 semanas'), { date: '2026-11-09', typeId: 'work' });
eq('prioridad alta', P('papeles del banco prioridad alta'), { typeId: 'review', title: 'Papeles del banco' });
eq('!1', P('revisar convocatoria !1 mañana'), { typeId: 'mock', date: '2026-10-27' });
eq('dictado con letras', P('mañana a las nueve repaso del tema doce durante media hora'), { date: '2026-10-27', start: '09:00', minutes: 30, topicNumber: 12, typeId: 'review', title: 'Repaso del tema 12' });
eq('de 4 a 6 (tarde)', P('estudiar de 4 a 6'), { start: '16:00', minutes: 120 });
eq('de 10 a 1 (cruza mediodía)', P('estudiar de 10 a 1'), { start: '10:00', minutes: 180 });
eq('por la mañana no es mañana', P('ir al gimnasio por la mañana el sábado'), { date: '2026-10-31' });
eq('fines de semana', P('descanso los fines de semana'), { repeat: { freq: 'weekly', interval: 1, weekdays: [6, 7] }, date: '2026-10-31', title: 'Descanso' });
eq('este lunes = hoy', P('este lunes repaso'), { date: '2026-10-26' });
eq('el lunes = próximo', P('el lunes repaso'), { date: '2026-11-02' });
eq('a mediodía', P('comida familiar al mediodía el domingo'), { start: '12:00', date: '2026-11-01', title: 'Comida familiar' });
eq('cada mes', P('pagar cuota cada mes el 5 de noviembre'), { repeat: { freq: 'monthly', interval: 1 }, date: '2026-11-05' });
const many = parseMany('mañana a las 9 estudio tema 3 y luego a las 12 repaso tema 1', T, types);
eq('varias: n', { n: many.length }, { n: 2 });
eq('varias: 2ª hereda fecha', many[1] ?? {}, { date: '2026-10-27', start: '12:00', typeId: 'review', topicNumber: 1 });
// horas y duraciones de los campos
const times: [string, string | null][] = [['9', '09:00'], ['17', '17:00'], ['930', '09:30'], ['9.30', '09:30'], ['9:30', '09:30'], ['9h30', '09:30'], ['9 y media', '09:30'], ['nueve y cuarto', '09:15'], ['10 menos cuarto', '09:45'], ['9pm', '21:00'], ['1730', '17:30'], ['25', null], ['mediodía', '12:00'], ['0', '00:00']];
for (const [i, w] of times) eq(`hora «${i}»`, { v: parseTime(i) }, { v: w });
const durs: [string, number | null][] = [['1', 60], ['2', 120], ['45', 45], ['1h30', 90], ['1:30', 90], ['1,5', 90], ['90 min', 90], ['media hora', 30], ['hora y media', 90], ['2 horas y media', 150], ['15', 15]];
for (const [i, w] of durs) eq(`duración «${i}»`, { v: parseDuration(i) }, { v: w });
const gos: [string, string | null][] = [['15 marzo', '2026-03-15'], ['semana 12', '2026-03-16'], ['+3 semanas', '2026-11-16'], ['mañana', '2026-10-27'], ['diciembre', '2026-12-01'], ['5/1/2027', '2027-01-05']];
for (const [i, w] of gos) eq(`ir a «${i}»`, { v: parseGoTo(i, T) }, { v: w });
// Avisos dentro de una frase
eq('recuérdame', P('recuérdame llamar a Ana mañana a las 10'), { title: 'Llamar a Ana', date: '2026-10-27', start: '10:00', remind: 0 });
eq('avísame 15 min antes', P('dentista el jueves a las 12 avísame 15 minutos antes'), { title: 'Dentista', start: '12:00', remind: 15, minutes: undefined });
eq('media hora antes', P('reunión mañana a las 9 con aviso media hora antes'), { title: 'Reunión', remind: 30 });
eq('una hora antes', P('cena el viernes a las 21 avísame una hora antes'), { remind: 60, start: '21:00' });
eq('el día antes', P('entrega de notas el 3 de noviembre avísame el día antes'), { remind: 1440, date: '2026-11-03', title: 'Entrega de notas' });
eq('duración no es aviso', P('estudio mañana 45 min'), { minutes: 45, remind: undefined });
// Órdenes
const C = (s: string) => parseCommand(s, T, types) as any;
eq('qué tengo mañana', C('¿Qué tengo mañana?'), { kind: 'query', from: '2026-10-27', to: '2026-10-27' });
eq('qué hay el jueves', C('qué hay el jueves'), { kind: 'query', from: '2026-10-29', to: '2026-10-29' });
eq('qué tengo esta semana', C('que tengo esta semana'), { kind: 'query', from: '2026-10-26', to: '2026-11-01' });
eq('semana que viene', C('qué tengo la semana que viene'), { kind: 'query', from: '2026-11-02', to: '2026-11-08' });
eq('qué tengo', C('qué tengo'), { kind: 'query', from: T, to: T });
eq('mueve al viernes a las 12', C('mueve el dentista al viernes a las 12'), { kind: 'move', query: 'dentista', date: '2026-10-30', start: '12:00' });
eq('pasa a las 18', C('pasa inglés a las 18'), { kind: 'move', query: 'ingles', date: undefined, start: '18:00' });
eq('aplaza a mañana', C('aplaza la reunión a mañana'), { kind: 'move', query: 'reunion', date: '2026-10-27', start: undefined });
eq('mueve la del jueves', C('mueve la clase del jueves al viernes'), { kind: 'move', query: 'clase', on: '2026-10-29', date: '2026-10-30' });
eq('cancela del jueves', C('cancela la reunión del jueves'), { kind: 'delete', query: 'reunion', on: '2026-10-29' });
eq('borra', C('borra dentista'), { kind: 'delete', query: 'dentista', on: undefined });
eq('marca como hecha', C('marca el repaso del tema 3 como hecho'), { kind: 'done', query: 'repaso del tema 3' });
eq('ya he hecho', C('ya he hecho inglés'), { kind: 'done', query: 'ingles' });
eq('avísame del dentista', C('avísame del dentista 30 minutos antes'), { kind: 'remind', query: 'dentista', minutes: 30 });
eq('crear sigue igual', C('mañana a las 10 dentista'), { kind: 'create' });
eq('mover sin crear', C('mueve dentista'), { kind: 'move', date: undefined, start: undefined });
const tk = (id: string, title: string, date: string, start?: string): any => ({ id, title, date, start, done: false, typeId: 'personal' });
const pool = [tk('a', 'Dentista', '2026-10-20'), tk('b', 'Dentista', '2026-10-30', '12:00'), tk('c', 'Clase de inglés', '2026-10-27', '18:00'), tk('d', 'Reunión de departamento', '2026-10-29', '09:00'), tk('e', 'Reunión con familias', '2026-11-05')];
eq('busca la próxima', { v: matchTasks(pool, 'dentista', T).map((t) => t.id) }, { v: ['b', 'a'] });
eq('sin tildes', { v: matchTasks(pool, 'ingles', T).map((t) => t.id) }, { v: ['c'] });
eq('por día', { v: matchTasks(pool, 'reunion', T, '2026-11-05').map((t) => t.id) }, { v: ['e'] });
eq('varias palabras', { v: matchTasks(pool, 'reunion departamento', T).map((t) => t.id) }, { v: ['d'] });
eq('avísame N antes de X', C('avísame 15 minutos antes de la clase de inglés'), { kind: 'remind', query: 'clase de ingles', minutes: 15 });
eq('verbo de crear fuera del título', P('apunta fisio el lunes a las 9'), { title: 'Fisio', date: '2026-11-02', start: '09:00' });
eq('ponme', P('ponme correr todos los días a las 7 de la mañana'), { title: 'Correr', start: '07:00', repeat: { freq: 'daily', interval: 1 } });
eq('pon no es ponencia', P('ponencia el jueves'), { title: 'Ponencia' });
eq('dos órdenes', { v: splitClauses('borra el dentista y apunta fisio el lunes a las 9') }, { v: ['borra el dentista', 'apunta fisio el lunes a las 9'] });
eq('«y» dentro del título', { v: splitClauses('reunión con Ana y Luis el martes') }, { v: ['reunión con Ana y Luis el martes'] });
console.log(`${total - fails}/${total} correctas`);
if (fails) process.exit(1);
