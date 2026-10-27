// Valoraciones del recuerdo (escala de FSRS) y plazos en palabras.
import { daysBetween } from './dates';

export const RATINGS: [number, string, string][] = [
  [1, 'Otra vez', 'No lo recordaba: se repasa pronto'],
  [2, 'Difícil', 'Lo recordaba con esfuerzo'],
  [3, 'Bien', 'Lo recordaba bien'],
  [4, 'Fácil', 'Lo dominaba: el siguiente repaso se aleja'],
];

/** Plazo entre dos fechas, en palabras: «al día siguiente», «a los 9 días», «a las 3 semanas»… */
export function gap(from: string, to: string): string {
  const d = daysBetween(from, to);
  if (d <= 1) return 'al día siguiente';
  if (d < 14) return `a los ${d} días`;
  if (d < 60) return `a las ${Math.round(d / 7)} semanas`;
  return `a los ${Math.round(d / 30)} meses`;
}
