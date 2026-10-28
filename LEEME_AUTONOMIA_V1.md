# Care OS · Primera entrega para operación delegada

Base: Bot-Dispatch-main-19.zip. Esta entrega se instala sobre el mismo proyecto Node/Express; no es un sitio separado ni cambia tus conexiones por una base de ejemplo.

## Qué cambió

- Un solo apartado **Solicitudes** en `/requests`: selección de artículos/cantidades, cola de entregas y reportes/actividad dentro de la misma sección. Los reportes conservan su motor actual integrado, para no duplicar datos. Los runners conservan su pantalla móvil especializada con las mismas órdenes.
- Accesos antiguos `/service-orders` y Operations llevan a la nueva sección. Las rutas de API se conservan para no romper cleaners, runners ni notificaciones existentes.
- Menú más corto: se retiraron accesos repetidos y botones de chat, anuncios y configuración que solo mostraban “próximamente”. Calidad queda en Reportes. Las funciones históricas se conservan para compatibilidad; no se eliminaron registros.
- Nuevo **Centro de Control** en `/control-center`, accesible desde Operaciones: resumen, habitaciones, cola de inspección, delegación de solicitudes, pendientes, responsables/suplente, notas de relevo, administración e historial.
- Pendientes con responsable, prioridad, hora límite y estados pendiente/en curso/terminado. Los pendientes abiertos anteriores se conservan en el siguiente turno.
- Guardado compartido en PostgreSQL, registro de cambios y control de versión para evitar sobrescribir cambios hechos desde otro dispositivo.
- Las tareas usan un identificador de solicitud para evitar duplicarlas al repetir el guardado.
- La delegación permite registrar un responsable y un número externo de HotSOS. **No envía solicitudes a HotSOS**.
- Acceso al nuevo Centro de Control verificado en servidor con el código activo existente. Roles admitidos: admin, manager, owner, company owner, general manager, corporate, dispatch, operations y supervisor; también combinaciones separadas por `/`.
- Se sincronizó package-lock.json con las cinco dependencias faltantes, sin cambiar las versiones existentes.

## Instalación de prueba

1. Conserva un respaldo del proyecto desplegado y de PostgreSQL. Usa primero un entorno de prueba con copia de tus datos; no apuntes una prueba al servicio activo.
2. Sustituye el código por esta carpeta completa. Conserva las variables de entorno actuales de Notion, PostgreSQL, Cloudinary, OpenAI y notificaciones. El ZIP no incorpora claves nuevas.
3. Instala con Node 20 o superior y `npm ci`.
4. Ejecuta `npm run check`, `npm run test:core`, `npm run test:payroll`, `npm run test:control` y `node test/unitCatalog.test.js`.
5. Arranca con `npm start`. El inicializador existente ejecuta `db/schema.sql` y agrega las tablas `care_control_tasks`, `care_control_shifts`, `care_control_audit` y el campo `service_orders.hotsos_ticket`. La migración es aditiva y repetible; requiere permiso de creación/alteración de tablas.
6. Entra por `/launch` con el código de un encargado activo. Abre Care OS → Operaciones → Centro de Control. Solicitudes está en ese mismo menú.

## Prueba del turno

1. Asigna encargado y suplente diferentes; guarda y actualiza para comprobar persistencia.
2. Crea un pendiente, ábrelo desde otro dispositivo y cambia su estado. Un guardado con una versión antigua debe pedir actualizar.
3. Desde Solicitudes selecciona unidad, artículos y cantidades; envía una solicitud de prueba. Comprueba que el runner la recibe y cambia sus estados.
4. Abre Reportes y actividad en la misma sección. Convierte un reporte una sola vez y comprueba que no se duplica.
5. Desde el Centro de Control asigna una persona a esa solicitud y guarda el ticket de HotSOS si existe. Comprueba el historial.
6. Comprueba que DONE aparece para inspección y únicamente READY se cuenta como listo para el huésped.
7. Guarda las instrucciones del relevo. “Revisado” solo documenta el relevo; no libera habitaciones, no finaliza el día y no autoriza nómina.

## Validación realizada y límites

- Pasaron las pruebas existentes de RoomEngine, nómina/Excel y catálogo, además de las nuevas pruebas de acceso, privacidad de la respuesta, validación, reintentos, auditoría y conflictos concurrentes del Centro de Control.
- Se verificaron en navegador, con datos ficticios aislados: carga del centro, creación de pendiente, búsqueda de habitaciones, selección de artículos y reportes integrados.
- Se revisó la sintaxis de server.js, el módulo nuevo y los scripts de las vistas modificadas.
- Se validó la coherencia del lock mediante `npm ci --dry-run`. La instalación completa no pudo concluir en este entorno por errores 503 del repositorio de paquetes; las pruebas HTTP del módulo se ejecutaron con sus dependencias Express aisladas.
- No se ejecutó la migración sobre un PostgreSQL real ni se probaron Notion, HotSOS, notificaciones o pagos con tus credenciales. Es necesario probar estas conexiones en tu entorno antes de desplegar.
- La protección nueva cubre `/api/control-center`. El resto del sistema conserva los controles heredados; falta una revisión integral de permisos del servidor. El código personal sigue siendo la credencial existente, no una sesión nueva con MFA.
- No se implementaron todavía contratación, disponibilidad/reemplazos automáticos, inventario, emisión bancaria de cheques ni un nuevo motor fiscal de nómina. Administración abre las funciones existentes. La IA del proyecto conserva su configuración anterior; esta entrega no certifica que esté activa.
- No hay nueva automatización desatendida: los responsables atienden las señales y guardan las decisiones. Las fechas muestran el estado disponible de los registros, no una fotografía histórica inmutable.

## Archivos principales

`services/controlCenter.js`, `public/control-center.html`, `public/js/control-center.js`, `public/css/control-center.css`, `test/controlCenter.test.js`; integración en `server.js`, `db/schema.sql`, `public/app.html`, `public/service-orders.html`, `public/operations.html` y accesos relacionados.
