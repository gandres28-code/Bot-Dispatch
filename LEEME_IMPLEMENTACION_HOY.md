# Versión actual: Idiomas por empleado v6

Consulta **LEEME_IDIOMAS_V6.md** para instalar esta versión y configurar inglés/español desde Empleados. Esta versión incluye también Deep Clean y todas las mejoras del checklist regular. Instalar frontend y servidor completos juntos.

---

# Checklist de salida v4

Al tocar Terminar en una unidad, el limpiador debe revisar 15 puntos y marcar cada uno. Confirmar se habilita al completar los 15; Volver cancela sin terminar. No hay selección masiva. Las áreas opcionales se revisan cuando existan.

El servidor rechaza DONE sin checklist completo. Guarda versión, texto de los puntos, empleado, unidad y hora del servidor dentro del registro de la acción. La unidad sigue pasando a espera de inspección; este checklist no reemplaza al inspector. No se añadió una pantalla de consulta del historial de checklists.

Instalar el proyecto completo, frontend y servidor juntos. Actualizar las páginas abiertas de los teléfonos: clientes anteriores deberán recargar para poder terminar unidades. Los DONE pendientes de versiones antiguas sin checklist serán rechazados y requerirán revisar la unidad y completar el nuevo flujo. No se marcan automáticamente como completos. No requiere nueva migración SQL adicional a las incluidas en v3.

Verificado: sintaxis, pruebas de regresión y validación del servidor, rechazo de selecciones incompletas/duplicadas y prueba en navegador del bloqueo, activación a 15/15 y cancelación. Falta prueba con PostgreSQL/Notion reales y teléfono físico después de instalar. Esta entrega no está desplegada en Render.

---

# Care OS · Catálogo por unidad y envíos ágiles v3

Proyecto completo actualizado desde Bot-Dispatch-main-19 y la primera entrega de autonomía. Conserva tus conexiones; no crea un app aparte. Esta entrega aún no está desplegada en tu alojamiento activo.


## Cambios de esta entrega v3

- Se retiró la barra verde permanente de “En línea”. Solo aparece un aviso discreto si hay un envío realmente pendiente o que necesita revisión.
- Cada unidad tiene **Pedir**: abre un catálogo con la habitación precargada. Cleaners e inspectores utilizan el mismo recorrido: elegir, revisar y enviar.
- Catálogo con artículos frecuentes, toallas, ropa de cama, consumibles, vajilla, cubiertos, cocina, sofá cama, paquetes de cama/toallas y herramientas/servicios. Los nombres de artículos existentes se conservan para los runners; las descripciones ayudan en español.
- Búsqueda por palabras en español o inglés, cantidades con botones grandes y resumen antes de enviar. Cada unidad conserva su selección de forma independiente mientras la pantalla está abierta. Los borradores del catálogo no se conservan al cerrar el navegador; los pedidos ya enviados sí se guardan en la cola local antes de salir.
- Desde Solicitudes → Nueva solicitud se utiliza ese mismo catálogo; ahí se elige primero la habitación.
- Al enviar un pedido o un mensaje de texto, se guarda primero en el dispositivo y la pantalla queda libre mientras se envía. “Enviando” no equivale a confirmación; la notificación de éxito llega después de la respuesta del servidor.
- Los mensajes se guardan en PostgreSQL y dejan el análisis de IA y la copia de Notion en una cola persistente. El envío ya no espera esos servicios externos. Las fotografías aún requieren subida y se procesan en lotes de hasta tres simultáneas.
- Esta entrega añade el procesador de cola `notion-report-create`: sube el servidor completo junto con los archivos públicos; no actualices únicamente el catálogo.

## Base de estabilidad incluida

- START/DONE y acciones del inspector confirman únicamente después del guardado transaccional en PostgreSQL. Notion se sincroniza mediante la cola persistente existente, sin bloquear esos botones.
- La lista del cleaner consulta la misma fuente PostgreSQL que inspecciones. Se conserva la última lista disponible si falla una actualización.
- Solicitudes se guardan sin esperar el reporte externo ni las notificaciones. La marca de un reporte convertido a solicitud queda en una cola persistente.
- Indicador de conexión y pendientes. Al tocarlo se puede revisar qué quedó pendiente o bloqueado.
- Acciones de habitaciones, mensajes de texto y creación de solicitudes se guardan en el dispositivo antes del primer envío. Los reintentos conservan el identificador para evitar duplicados si se pierde la respuesta.
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

`npm run verify` ejecuta sintaxis y nueve grupos: habitaciones, nómina, Excel, catálogo, Centro de Control, transporte/outbox, eventos y conciliación de nómina. Las bases y servicios externos de esos tests están aislados/simulados.

En navegador con datos ficticios se probaron START/DONE, inspecciones, solicitud con servicio caído, recuperación sin recargar y pérdida de respuesta después de guardar sin generar una solicitud duplicada. READY se mantuvo pendiente durante el fallo y solo contó como completado tras confirmarse.

No se ejecutó esta migración en tu PostgreSQL real, ni se probaron tus conexiones de Notion/HotSOS/alojamiento o carga con el equipo completo. Tampoco se midió latencia real. La descarga completa de dependencias en este entorno falló con HTTP 503 del repositorio de paquetes; las pruebas HTTP usaron Express aislado. El lock está sincronizado, pero debe completarse `npm ci` en el entorno de despliegue.

La revisión integral de autenticación/autorización de las rutas heredadas continúa pendiente; el Centro de Control sí verifica acceso en servidor. La IA conserva la configuración previa y no se certifica aquí su activación.

Los duplicados históricos no se borran automáticamente. Una relimpieza adicional pagada necesita un ajuste explícito: la deduplicación considera una unidad/persona/fecha como un trabajo por unidad. Usa la administración de Care OS para corregir los estados operativos; una edición vieja de Notion no los reemplaza durante el mismo turno.

## Reversión

Conserva el código anterior y respaldo de base. Las columnas/tablas nuevas son aditivas: no las elimines como parte de una reversión rápida. Revisa pendientes de los dispositivos y la cola de sincronización antes de volver a una versión antigua. No borres registros para resolver diferencias de nómina.

## Prueba de aceptación v3

1. En un teléfono, abre una unidad y toca Pedir. Debe aparecer esa habitación y ningún campo de responsable o prioridad que tengas que completar.
2. Agrega dos toallas, busca “sábana queen”, cambia de categoría y verifica que conserva las cantidades. Revisa el pedido antes de enviarlo.
3. Abre otra unidad: no debe heredar el pedido de la anterior. Confirma en el runner que unidad, artículos y cantidades coinciden.
4. Envía un mensaje sin fotografías. Comprueba primero “Enviando” y después la confirmación, sin esperar que termine la IA. El historial de Notion puede actualizarse después; la actividad ya está registrada en PostgreSQL.
5. Comprueba que no hay barra verde permanente. Con una interrupción simulada debe aparecer únicamente el aviso de envíos pendientes, que desaparece al confirmarse.

El catálogo se revisó en navegador y en un marco de 390 px de ancho con datos ficticios. No se midieron los tiempos de tu servidor real. Continúa aplicando las pruebas de despliegue y conexiones de esta guía.
