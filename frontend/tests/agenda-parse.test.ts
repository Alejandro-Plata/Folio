// Pruebas del analizador de frases de la agenda (fecha fija: lunes 26-10-2026).
// Se ejecutan con «npm test».
import { parse, parseMany, parseGoTo } from '../src/agenda/parse';
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
console.log(`${total - fails}/${total} correctas`);
if (fails) process.exit(1);
