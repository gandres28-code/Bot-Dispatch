# Care OS · Idiomas por empleado · v6

## Uso

1. Entrar con el código de administrador o encargado.
2. Abrir Empleados / Employee Center.
3. En la tarjeta del empleado, elegir **Idioma de la app → Español o English** y tocar **Guardar idioma**.
4. El empleado debe entrar con su código o actualizar su app. La preferencia se guarda en su expediente y se recupera en otro teléfono al entrar con el mismo código.

La selección tiene un guardado independiente: no es necesario usar el botón de edición del expediente. El español es el valor inicial de los empleados existentes. El idioma no cambia roles, permisos, importes, estados operativos ni las claves de los artículos pedidos.

## Qué se traduce

- Interfaz de las vistas del proyecto: navegación, botones, etiquetas, campos, categorías y mensajes conocidos de Care OS.
- Limpieza, inspecciones, solicitudes, pedidos del runner, Time Clock y las vistas administrativas.
- Los 15 puntos completos del checklist regular, incluidos cafetera/tostadora/cables y bolsa completa del hide-a-bed.
- Los 84 puntos de Deep Clean, sus categorías, No aplica y motivos.
- Nombres visibles del catálogo de artículos; sus claves originales se conservan para inventario y sincronización.
- Avisos conocidos de conexión/confirmación y títulos conocidos de notificaciones. El service worker actualizado conserva el idioma del último usuario activo de ese teléfono.
- Fechas de presentación según el idioma; los identificadores de fechas y la zona operativa America/Chicago se conservan.

Los nombres, números de unidad, notas, motivos escritos y textos externos/IA se conservan en su idioma original. Esta entrega no agrega un servicio de traducción automática para mensajes libres, fotografías, PDFs o archivos Excel ya generados. Los textos nuevos que se incorporen a la app deben añadirse al catálogo de traducciones.

## Aplicación y conexión

La preferencia se obtiene al entrar y al cargar una vista. En sesiones abiertas también se revisa al volver a la pantalla y cada minuto; si hay conexión Socket.IO, se solicita actualizar al guardar un cambio. No hace falta recargar un checklist abierto para traducir sus etiquetas y no se borran sus selecciones ni el motivo escrito. Sin red se usa la última preferencia guardada para ese código en ese teléfono; la primera entrada sin preferencia local usa español.

El cambio no instala ni publica la app automáticamente.

## Instalación completa

1. Desplegar este proyecto completo en Render, incluyendo servidor, `db/schema.sql`, servicios, vistas y `public/js/care-i18n.js`.
2. Al iniciar, el esquema agrega `employees.app_language`, con valores `es` y `en` y español como predeterminado. No requiere crear una propiedad de idioma en Notion. La sincronización de empleados desde Notion conserva la preferencia local.
3. Actualizar las páginas abiertas y reiniciar la app instalada si usa una copia empaquetada. Si Capacitor lleva recursos locales, también hay que reconstruir ese paquete.
4. Actualizar el service worker mediante la carga normal de la app para que las notificaciones nuevas usen las traducciones. Confirmar en un teléfono físico.
5. Probar con un empleado de cada idioma: entrar, abrir su catálogo, enviar un pedido, iniciar/terminar una unidad, revisar el checklist regular y Deep Clean, y abrir inspecciones/Time Clock según sus permisos.

Solo un código activo con rol de encargado autorizado puede guardar la preferencia. El servidor verifica el rol; no confía en el rol enviado por el navegador. Si el guardado falla, se muestra un error y no se confirma como exitoso.

## Validación realizada

Pasaron `npm run verify`, las regresiones previas y las pruebas nuevas de idioma: cobertura de todos los títulos/instrucciones de los dos checklists, nombres de catálogo, mensajes dinámicos, validación de valores, acceso por rol, guardado, invalidación de caché, cambio de vuelta a español, error de base de datos y traducción de notificaciones en segundo plano.

Prueba en navegador con datos ficticios: guardar inglés desde Empleados, navegar a Limpieza, abrir catálogo y revisión de cantidades, abrir regular/Deep Clean e Inspecciones; cambiar a español con Deep Clean abierto conservó la casilla No aplica y el motivo escrito. Los nombres del personal permanecieron iguales.

No se ejecutó una migración contra tu base real ni se probó la conexión real con Notion, Render, push en un teléfono físico o el paquete nativo de Capacitor. La instalación y la prueba operativa en tu entorno siguen pendientes.

## Mantenimiento de traducciones

Fuentes: `translations/ui.es-en.txt`, `translations/checklists.en.json`, `translations/templates.json` y catálogo original de suministros. Ejecutar `node scripts/build-i18n.js` después de editar estas fuentes. El comando genera los diccionarios y el bundle `public/js/care-i18n.js` que cargan las vistas.

La traducción cambia únicamente la presentación. Las respuestas del servidor y los valores internos no se reescriben por traducir un texto visible.
