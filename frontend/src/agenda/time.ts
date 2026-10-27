// Interpretar horas y duraciones escritas o dictadas en español.
import { hhmm } from './dates';

const UNITS: Record<string, number> = {
  cero: 0, un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
  once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19,
  veinte: 20, veintiun: 21, veintiuno: 21, veintiuna: 21, veintidos: 22, veintitres: 23, veinticuatro: 24, veinticinco: 25,
  veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29, treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60,
  noventa: 90, cien: 100, ciento: 100,
};

/** Quita tildes y pasa a minúsculas. */
export function fold(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Convierte números escritos con letra en cifras («treinta y cinco» → «35»). */
export function wordsToDigits(text: string): string {
  const words = text.split(/(\s+)/);
  const out: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = fold(words[i]);
    if (w in UNITS && !(w === 'un' || w === 'una') || ((w === 'un' || w === 'una') && /^(hora|cuarto|minuto)/.test(fold(words[i + 2] ?? '')))) {
      let n = UNITS[w];
      // «treinta y cinco», «cuarenta y dos»
      if (n >= 30 && n % 10 === 0 && fold(words[i + 2] ?? '') === 'y' && fold(words[i + 4] ?? '') in UNITS && UNITS[fold(words[i + 4])] < 10) {
        n += UNITS[fold(words[i + 4])];
        i += 4;
      }
      out.push(String(n));
    } else out.push(words[i]);
  }
  return out.join('');
}

/**
 * Hora escrita en un campo: «9» → 09:00, «930» → 09:30, «9.30», «9:30», «9h30»,
 * «9 y media», «10 menos cuarto», «9pm». Devuelve null si no se entiende.
 */
export function parseTime(input: string): string | null {
  let s = fold(wordsToDigits(input.trim())).replace(/^a las\s+|^las\s+|^a la\s+/, '');
  if (!s) return null;
  if (/^(mediodia|medio dia)$/.test(s)) return '12:00';
  if (/^medianoche$/.test(s)) return '00:00';
  let pm = /(pm|p\.m\.|de la tarde|de la noche|por la tarde|por la noche)\s*$/.test(s);
  const am = /(am|a\.m\.|de la manana|por la manana|de la madrugada)\s*$/.test(s);
  s = s.replace(/\s*(pm|p\.m\.|am|a\.m\.|de la tarde|de la noche|por la tarde|por la noche|de la manana|por la manana|de la madrugada)\s*$/, '').trim();
  let h: number, m = 0;
  let mm: RegExpExecArray | null;
  if ((mm = /^(\d{1,2})\s*(?:y media)$/.exec(s))) { h = +mm[1]; m = 30; }
  else if ((mm = /^(\d{1,2})\s*(?:y cuarto)$/.exec(s))) { h = +mm[1]; m = 15; }
  else if ((mm = /^(\d{1,2})\s*(?:menos cuarto)$/.exec(s))) { h = +mm[1] - 1; m = 45; }
  else if ((mm = /^(\d{1,2})\s*y\s*(\d{1,2})$/.exec(s))) { h = +mm[1]; m = +mm[2]; }
  else if ((mm = /^(\d{1,2})\s*menos\s*(\d{1,2})$/.exec(s))) { h = +mm[1] - 1; m = 60 - +mm[2]; }
  else if ((mm = /^(\d{1,2})\s*[:.,h']\s*(\d{2})\s*(?:h|min)?$/.exec(s))) { h = +mm[1]; m = +mm[2]; }
  else if ((mm = /^(\d{1,2})\s*(?:h|horas?|:00)?$/.exec(s))) { h = +mm[1]; }
  else if ((mm = /^(\d{3,4})$/.exec(s))) { h = Math.floor(+mm[1] / 100); m = +mm[1] % 100; }
  else return null;
  if (pm && h < 12) h += 12;
  if (am && h === 12) h = 0;
  pm = false;
  if (h === 24 && m === 0) h = 0;
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return hhmm(h * 60 + m);
}

/**
 * Duración: del 1 al 9 son horas («2» → 120) y del 10 en adelante minutos
 * («45» → 45). También «1h30», «1:30», «1,5 h», «90 min», «media hora», «hora y media».
 */
export function parseDuration(input: string): number | null {
  const s = fold(wordsToDigits(input.trim())).replace(/^durante\s+/, '');
  if (!s) return null;
  let mm: RegExpExecArray | null;
  if (/^media hora$/.test(s)) return 30;
  if (/^(una |1 )?hora y media$/.test(s)) return 90;
  if (/^(un |1 )?cuarto de hora$/.test(s)) return 15;
  if (/^tres cuartos de hora$|^3 cuartos de hora$/.test(s)) return 45;
  if ((mm = /^(\d{1,2}) horas? y media$/.exec(s))) return +mm[1] * 60 + 30;
  if ((mm = /^(\d{1,2}) horas? y cuarto$/.exec(s))) return +mm[1] * 60 + 15;
  if ((mm = /^(\d{1,2})\s*(?:h|horas?)\s*(?:y\s*)?(\d{1,2})\s*(?:m|min|minutos?)?$/.exec(s))) return +mm[1] * 60 + +mm[2];
  if ((mm = /^(\d{1,2}):(\d{2})$/.exec(s))) return +mm[1] * 60 + +mm[2];
  if ((mm = /^(\d+(?:[.,]\d+)?)\s*(?:h|horas?)$/.exec(s))) return Math.round(parseFloat(mm[1].replace(',', '.')) * 60);
  if ((mm = /^(\d+)\s*(?:m|min|mins|minutos?)$/.exec(s))) return +mm[1];
  if ((mm = /^(\d+[.,]\d+)$/.exec(s))) return Math.round(parseFloat(mm[1].replace(',', '.')) * 60);
  if ((mm = /^(\d+)$/.exec(s))) { const n = +mm[1]; return n < 10 ? n * 60 : n; }
  return null;
}
