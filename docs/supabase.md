# Cuentas y círculos con Supabase

Folio usa Supabase para tres cosas: iniciar sesión (Google o correo y contraseña),
los círculos (amigos o pareja) con sus eventos compartidos y las citas. Todo lo
demás (documentos, agenda privada, temario) sigue en tus dispositivos y en tu nube.

Hasta que hagas estos pasos, Folio muestra «Las cuentas todavía no están configuradas».

## 1. Crear el proyecto

1. Entra en <https://supabase.com>, crea una cuenta y un proyecto (región: Europa).
2. En **Project Settings › API** copia:
   - **Project URL** (`https://xxxx.supabase.co`)
   - **Publishable key** (o `anon` en proyectos antiguos). Es pública por diseño:
     la seguridad la ponen las políticas por filas de la base de datos.
   - **Nunca** copies la `service_role` / `secret` key en Folio.
3. Pon los dos valores en `internal/social/client.go`:

   ```go
   var (
       URL = "https://xxxx.supabase.co"
       Key = "sb_publishable_…"
   )
   ```

## 2. Crear las tablas

En **SQL Editor › New query**, pega el contenido de
`supabase/migrations/20261027000000_folio_circulos.sql` y pulsa **Run**.
(Con la CLI de Supabase: `supabase link` y `supabase db push`.)

Crea perfiles, círculos, miembros, invitaciones, eventos compartidos y citas, con
seguridad por filas: cada persona solo ve los círculos de los que es miembro.

## 3. Correo y contraseña

En **Authentication › Sign In / Providers › Email**:

- Deja activado **Confirm email** (recomendado): al crear la cuenta llega un correo
  con un enlace; hasta abrirlo no se puede entrar.
- **Minimum password length**: 8.
- Para producción configura un SMTP propio en **Authentication › Emails › SMTP**
  (el de Supabase solo envía unos pocos correos por hora).

## 4. Google

1. En Google Cloud Console (<https://console.cloud.google.com>) crea un proyecto,
   configura la **pantalla de consentimiento OAuth** (tipo externo) y crea un
   **ID de cliente OAuth** de tipo **Aplicación web**.
   - En **URI de redirección autorizados** pon la que muestra Supabase en el paso
     siguiente: `https://xxxx.supabase.co/auth/v1/callback`.
2. En Supabase, **Authentication › Sign In / Providers › Google**: activa el proveedor
   y pega el ID de cliente y el secreto de Google.

## 5. Direcciones de vuelta

En **Authentication › URL Configuration › Redirect URLs** añade exactamente:

```
http://127.0.0.1:47863/auth/callback
es.folio.app://auth-callback
```

La primera es para el escritorio (Folio escucha un momento en ese puerto local);
la segunda, para Android (vuelve a la app).

## 6. Probar

1. Compila e instala (`./build.sh linux && ./install.sh`).
2. **Archivo › Tu cuenta y círculos** (o **Más › Tu cuenta** en el móvil): entra con
   Google y con un correo.
3. Crea un círculo de pareja, copia el código de invitación y únete desde otra cuenta
   (otro navegador u otro dispositivo). Crea un evento con «Quién lo ve: Nosotros» y
   comprueba que aparece en los dos. Propón una cita desde una cuenta y elígela desde
   la otra.

## Cómo funciona (para mantenerlo)

- **Sesión**: el token de renovación se guarda en el llavero del sistema (escritorio)
  o en EncryptedSharedPreferences (Android), nunca en los ajustes. Supabase lo rota
  en cada renovación y Folio guarda el nuevo.
- **Eventos**: `internal/social` los descarga (60 días atrás y 400 adelante) y los
  guarda en caché en la carpeta de configuración para verlos sin conexión. En la
  agenda son tareas con ID `c:‹id›` y tipo `circle:‹círculo›`; guardar, mover o borrar
  una de ellas va al servidor (`internal/core/agenda.go`). Necesita conexión.
- **Plan de estudio**: los eventos de los círculos ocupan su hueco y el plan no pone
  estudio encima.
- **Actualización**: la app refresca cada 2 minutos con la ventana visible y al volver
  a ella. El esquema ya publica las tablas en Realtime por si más adelante se quiere
  recibir los cambios al instante.
- **Citas**: `accept_date` (función de la base de datos) crea el evento y cierra la
  propuesta de una vez; quien propone una opción no puede aceptarla él mismo.
