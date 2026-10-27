// Identificador numérico de una notificación a partir del de la tarea.
/** Número entero positivo estable a partir del identificador de la tarea (Android lo exige). */
export function notificationId(taskId: string): number {
  let h = 2166136261;
  for (let i = 0; i < taskId.length; i++) { h ^= taskId.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 1) || 1;
}

