# Política de privacidad de Folio

Última actualización: 28 de octubre de 2026

Folio es un procesador de textos y una agenda de estudio para Linux, Windows y
Android. Está pensado para que tus datos se queden contigo: **Folio no tiene
servidores propios para tus documentos ni para tu agenda, no muestra publicidad
y no recoge estadísticas de uso.**

## Lo que se queda en tu dispositivo

- **Documentos, agenda, temario, notas y ajustes.** Se guardan en tu dispositivo
  (en Linux y Windows, en tu carpeta de Documentos).
- **Dictado.** En Linux y Windows la voz se transcribe en tu ordenador con
  whisper.cpp; el audio no sale del equipo. En Android se usa el reconocimiento
  de voz del sistema, en el propio móvil cuando el sistema lo permite (Android 12
  o posterior). Si el móvil no lo permite, el reconocimiento lo hace el servicio
  de voz del sistema (normalmente Google), según sus propias condiciones.
- **Folito**, el asistente de la agenda, funciona con un modelo de lenguaje que
  se ejecuta en tu equipo. Lo que le pides no se envía a ningún servicio externo.
- **Avisos.** Las notificaciones de las tareas se programan en tu dispositivo.

## Sincronización (opcional)

Si la activas, Folio copia tus documentos y tu agenda **en tu propia nube**, de
tu dispositivo a ella, sin pasar por ningún servidor de Folio:

- **Google Drive.** Folio pide solo el permiso `drive.file`: puede ver y modificar
  únicamente los archivos que crea él mismo (su carpeta «Folio»), no el resto de
  tu Drive. El acceso se guarda en el almacén seguro de tu sistema (el llavero en
  Linux y Windows; los servicios de Google en Android).
- **WebDAV** (Nextcloud, ownCloud, Synology…). La contraseña de aplicación se
  guarda en el almacén seguro del sistema y solo se envía a tu servidor.

El uso que Folio hace de la información recibida de las API de Google cumple la
[Política de datos de usuario de los servicios de API de Google](https://developers.google.com/terms/api-services-user-data-policy),
incluidos los requisitos de uso limitado. Folio no transfiere esos datos a nadie,
no los usa para publicidad y no permite que ninguna persona los lea.

Puedes desvincular la sincronización cuando quieras desde **Sincronización**; tus
archivos se quedan en tu dispositivo y en tu nube. También puedes retirar el
acceso de Folio a Google Drive en <https://myaccount.google.com/permissions>.

## Cuenta, círculos y citas (opcional)

Solo si creas una cuenta para compartir eventos con amigos o con tu pareja, Folio
guarda en [Supabase](https://supabase.com):

- tu correo electrónico, tu nombre y el color con el que te ven en tus círculos;
- los círculos de los que formas parte y sus invitaciones;
- los eventos que compartes en un círculo (título, notas, fecha, hora y duración)
  y las propuestas de citas.

Estos datos los ven únicamente los miembros de cada círculo. Tus documentos, tu
agenda privada y tu temario **no** se envían a la cuenta.

Puedes borrar la cuenta desde **Tu cuenta › Borrar mi cuenta**: se borran tu
perfil y tu pertenencia a los círculos. Los círculos que creaste pasan a otro
miembro, y los eventos que compartiste siguen visibles para ese círculo sin tu
nombre.

## Otras conexiones a internet

- **Actualizaciones.** Al abrirse, Folio consulta en GitHub si hay una versión
  nueva y, si aceptas, la descarga de allí. GitHub recibe la petición como
  cualquier visita a una web (dirección IP y tipo de navegador).
- **Modelos de dictado y de Folito.** En Linux y Windows se descargan una vez de
  Hugging Face la primera vez que los usas.

## Permisos de Android

- **Micrófono:** solo para el dictado, mientras está activo.
- **Notificaciones y alarmas exactas:** para los avisos de las tareas.
- **Instalar aplicaciones:** para instalar las actualizaciones de Folio que tú aceptas.
- **Cámara:** solo para escanear el código QR al vincular otro dispositivo.
- **Internet:** para la sincronización, la cuenta y las actualizaciones.

## Menores

Folio no está dirigido a menores de 14 años. No se recogen datos de nadie sin una
cuenta creada a propósito.

## Cambios en esta política

Si cambia, se publicará aquí con su nueva fecha y se mencionará en las notas de
la versión.

## Contacto

Para cualquier pregunta sobre privacidad o para ejercer tus derechos (acceso,
rectificación, supresión), abre una incidencia en
<https://github.com/Alejandro-Plata/Folio/issues>.
