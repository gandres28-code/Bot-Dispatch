# Care OS · Estabilidad y operación delegada v2

Proyecto completo actualizado desde Bot-Dispatch-main-19 y la primera entrega de autonomía. Conserva tus conexiones; no crea un app aparte. Esta entrega aún no está desplegada en tu alojamiento activo.

## Cambios

- START/DONE y acciones del inspector confirman únicamente después del guardado transaccional en PostgreSQL. Notion se sincroniza mediante la cola persistente existente, sin bloquear esos botones.
- La lista del cleaner consulta la misma fuente PostgreSQL que inspecciones. Se conserva la última lista disponible si falla una actualización.
- Solicitudes se guardan sin esperar el reporte externo ni las notificaciones. La marca de un reporte convertido a solicitud queda en una cola persistente.
- Indicador de conexión y pendientes. Al tocarlo se puede revisar qué quedó pendiente o bloqueado.
- Acciones de habitaciones y creación de solicitudes se guardan en el dispositivo antes del primer envío. Los reintentos conservan el identificador para evitar duplicados si se pierde la respuesta.
- Los errores permanentes quedan visibles. No se borran silenciosamente ni se reintentan sin límite.
- Cambiar de usuario conserva el trabajo pendiente y no reenvía el de otra persona. Acciones de turnos anteriores requieren revisión antes de reenviarse; no se aplican al nuevo turno automáticamente.
- Reconexión, revisión al volver a la pantalla y actualización periódica de respaldo. Se evitan lecturas iguales concurrentes, cargas superpuestas y dobles toques en estados de solicitudes.
- Un estado de Notion atrasado no sustituye los estados/timestamps operativos registrados en PostgreSQL. Las asignaciones externas siguen sincronizándose.
- El servidor abre HTTP antes de esperar importaciones externas. Si PostgreSQL falla al arrancar, intenta recuperarlo sin impedir que la interfaz abra.
- Reparto por unidad con conservación de centavos y enlace entre el pago operativo y su copia importada de Notion. Repetir DONE no debe pagar de nuevo la misma unidad/persona/fecha. No se emiten pagos bancarios.

## Qué significa “al instante”

El toque recibe respuesta visual inmediata; “Confirmado” requiere respuesta de PostgreSQL. Sin conexión aparece “Pendiente”, sin inventar un éxito. Notion, fotos, IA y notificaciones dependen de servicios externos y no tienen garantía de ejecución instantánea.

Los pendientes locales necesitan que el app vuelva a estar abierto, el usuario correspondiente esté activo y haya conexión. No se garantiza sincronización con el navegador cerrado. No borres sus datos mientras queden pendientes. Fotos, pagos, ajustes de nómina y formularios administrativos siguen requiriendo conexión.

## Instalación hoy

1. Respalda el proyecto activo y PostgreSQL. Conserva las variables de entorno actuales: `DATABASENEW_URL` y las conexiones de Notion, Cloudinary, OpenAI y notificaciones.
2. Sube esta carpeta completa al repositorio del mismo servicio Node. Usa primero una copia de prueba con credenciales/datos separados.
3. Node 20 o superior. Instala con `npm ci`, valida con `npm run verify` y arranca con `npm start`.
4. El inicializador existente ejecuta `db/schema.sql`. Las migraciones son aditivas: Centro de Control, identificador único de solicitudes y timestamps operativos en Rooms. El usuario de PostgreSQL necesita permisos de migración.
5. Verifica que PostgreSQL tiene las habitaciones/asignaciones del día, empleados y tarifas correctas. Las acciones ya no usan un fallback directo a Notion; corrige cualquier unidad ausente en PostgreSQL antes del turno.
6. Entra por `/launch`; abre Centro de Control y Solicitudes. Recarga las pestañas abiertas con la versión anterior.
7. Prueba con una unidad de prueba y dos dispositivos antes de incorporar al equipo completo.

## Prueba corta en tu instalación

- Cleaner: START y DONE. El inspector debe ver el cambio sin recargar; DONE no debe contar como READY.
- Inspector: iniciar y terminar. Comprueba READY desde el otro dispositivo.
- Solicitudes: seleccionar artículos, aceptar, comenzar, entregar y completar. Un doble toque no debe crear otro evento o solicitud.
- Corte de conexión: enviar una acción, ver “Pendiente”, reconectar y comprobar una sola confirmación. Reabre el app con el pendiente y comprueba que se conserva.
- Cambio de usuario: la otra persona no debe reenviar ese pendiente.
- Notion temporalmente caído: habitaciones y solicitudes siguen guardándose en PostgreSQL. Revisa posteriormente la sincronización y los trabajos agotados de la cola.
- Nómina: compara una unidad individual y una compartida entre tres personas. Comprueba el total y que la importación de Notion no duplica el pago.

## Infraestructura

El código no evita que el proveedor suspenda el servidor ni restaura internet. Comprueba que el alojamiento permanezca activo durante el turno y que app/base tengan buena conectividad. No aumentes el pool sin revisar la capacidad de PostgreSQL.

## Verificación realizada y límites

`npm run verify` ejecuta sintaxis y ocho grupos: habitaciones, nómina, Excel, catálogo, Centro de Control, transporte/outbox, eventos y conciliación de nómina. Las bases y servicios externos de esos tests están aislados/simulados.

En navegador con datos ficticios se probaron START/DONE, inspecciones, solicitud con servicio caído, recuperación sin recargar y pérdida de respuesta después de guardar sin generar una solicitud duplicada. READY se mantuvo pendiente durante el fallo y solo contó como completado tras confirmarse.

No se ejecutó esta migración en tu PostgreSQL real, ni se probaron tus conexiones de Notion/HotSOS/alojamiento o carga con el equipo completo. Tampoco se midió latencia real. La descarga completa de dependencias en este entorno falló con HTTP 503 del repositorio de paquetes; las pruebas HTTP usaron Express aislado. El lock está sincronizado, pero debe completarse `npm ci` en el entorno de despliegue.

La revisión integral de autenticación/autorización de las rutas heredadas continúa pendiente; el Centro de Control sí verifica acceso en servidor. La IA conserva la configuración previa y no se certifica aquí su activación.

Los duplicados históricos no se borran automáticamente. Una relimpieza adicional pagada necesita un ajuste explícito: la deduplicación considera una unidad/persona/fecha como un trabajo por unidad. Usa la administración de Care OS para corregir los estados operativos; una edición vieja de Notion no los reemplaza durante el mismo turno.

## Reversión

Conserva el código anterior y respaldo de base. Las columnas/tablas nuevas son aditivas: no las elimines como parte de una reversión rápida. Revisa pendientes de los dispositivos y la cola de sincronización antes de volver a una versión antigua. No borres registros para resolver diferencias de nómina.
