// El identificador de una notificación debe ser entero, positivo (Android lo exige), de 31 bits y estable.
import { notificationId } from '../src/platform/notificationid';

let fails = 0;
const ok = (cond: boolean, msg: string) => { if (!cond) { fails++; console.log('✗', msg); } };
const ids = new Set<number>();
for (let i = 0; i < 5000; i++) {
  const id = `a1b2c3d4e5f6${i.toString(16).padStart(4, '0')}@2026-11-${String(1 + (i % 28)).padStart(2, '0')}`;
  const n = notificationId(id);
  ok(Number.isInteger(n) && n > 0 && n <= 0x7fffffff, `fuera de rango: ${id} → ${n}`);
  ok(n === notificationId(id), `no es estable: ${id}`);
  ids.add(n);
}
ok(ids.size > 4990, `demasiadas colisiones: ${5000 - ids.size}`);
ok(notificationId('') > 0, 'la cadena vacía debe dar un id válido');
console.log(fails ? `${fails} fallos` : 'notificationId: correcto');
if (fails) process.exit(1);
