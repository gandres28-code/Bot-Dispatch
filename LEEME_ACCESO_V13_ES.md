# Care OS · Acceso controlado · versión candidata 13

## Estado
Cambios preparados sobre Care_OS_Completo_v12.zip (versión 15 del archivo). No se han publicado en Render. Hay que comparar este paquete con el código actualmente desplegado antes de reemplazarlo: podría haber cambios posteriores en producción.
No afirma control físico del teléfono ni seguridad absoluta. Es aprobación de navegador mediante una credencial aleatoria protegida, asociada a un empleado activo de Notion.

## Qué cambia
- Barrera global antes de todas las rutas Express, archivos estáticos y exportaciones.
- Cierre por defecto si faltan las variables obligatorias o no se puede verificar el acceso.
- Solicitud con código exacto de empleado activo. Escribir un nombre ya no permite pasar la barrera.
- Solicitud pendiente hasta que el propietario la autorice.
- Pantalla /access para aprobar, bloquear y elegir permisos.
- Personal: Mi trabajo y Mi horario; las APIs correspondientes conservan sus comprobaciones por rol y asignación.
- Administración: permite atravesar la barrera hacia las pantallas administrativas. Otorgar solo a personas de confianza; las rutas modernas también exigen el rol adecuado en Employees.
- Solo la clave del propietario permite gestionar autorizaciones.
- Token de 256 bits, hash SHA-256 en la tabla care_access_devices; cookie Secure, HttpOnly, SameSite=Strict y __Host-. No se guarda el código de empleado en esa tabla.
- Códigos suministrados a la app deben corresponder al empleado vinculado al navegador.
- Conexiones Socket.IO restringidas a administración y propietario: los eventos globales existentes contienen información de todo el negocio. Personal conserva las consultas de Mi trabajo. Una conexión existente se vuelve a verificar cada 10 segundos.
- Rechazo de operaciones de escritura con origen distinto del configurado.
- Solicitudes y acceso del propietario limitados a 10 intentos por IP cada 15 minutos y por proceso.
- Mejoras pequeñas de presentación: marca CARE en lugar del emoji de hotel, enlace de acceso y navegación móvil hacia Mi acceso.

## Activación en Render
1. Conservar copia del despliegue actual y respaldar la base de datos.
2. Comparar este código con el repositorio actualmente conectado a Render.
3. Configurar CARE_PUBLIC_ORIGIN=https://bot-dispatch.onrender.com (sin barra final).
4. Configurar CARE_OWNER_SECRET con al menos 32 caracteres aleatorios. Generarla y guardarla en un gestor de contraseñas. No mandarla por chat, no ponerla en Notion ni subirla al repositorio.
5. Conservar DATABASENEW_URL y todas las variables de Notion existentes. PostgreSQL conserva únicamente las autorizaciones de seguridad; Notion sigue siendo la fuente de empleados y operación.
6. La cuenta de PostgreSQL necesita permiso CREATE TABLE; la tabla se crea en el primer uso. En entornos con migraciones controladas, crear la tabla antes con el SQL de services/accessGuard.js.
7. Publicar primero en un entorno de prueba con su propio CARE_PUBLIC_ORIGIN.
8. Abrir /access, entrar como propietario y verificar que se puede abrir la app.
9. Desde otro navegador, solicitar acceso con un empleado de prueba, cotejar el identificador y aprobar como personal. Verificar Mi trabajo, inspección, horario, GPS, carga de fotos y checklists.
10. Comprobar que un navegador sin autorización no lee APIs ni exportaciones; que un cleaner no abre nómina; que bloquearlo corta nuevas peticiones y desconecta Socket.IO en hasta 10 segundos.
11. Publicar en producción solo tras completar estas verificaciones. Configurar el health check de Render como /health/access. No indica disponibilidad de todas las dependencias.
12. No retirar la barrera para resolver un error: corregir configuración desde Render.

## Uso diario
Empleado: abrir enlace → código personal y nombre del dispositivo → Solicitar acceso → compartir identificador con Andrés → Comprobar autorización → login habitual.
Propietario: /access → Acceso del propietario → clave privada → cotejar solicitud → Autorizar o Bloquear.
No aprobar basándose solo en el nombre declarado del teléfono: se puede escribir cualquier nombre.
La autorización dura 7 días desde la solicitud. El acceso del propietario dura 8 horas. Borrar cookies, cambiar de navegador o reinstalar obliga a solicitar nuevamente.
Cerrar y retirar este acceso revoca la credencial del navegador actual.
Para desactivar a una persona, desactivarla en Employees y bloquear todos sus dispositivos. El cambio en Notion se observa según la caché existente; el bloqueo en /access se consulta en cada petición nueva.
Ante pérdida de la clave del propietario: cambiarla en Render y revocar las filas access_level='owner' en care_access_devices por el administrador de base de datos; cambiar la clave por sí solo no invalida cookies ya emitidas.

## Límites y siguiente endurecimiento
- El token identifica un navegador, no el hardware. Quien controle una sesión abierta o copie una cookie puede usarla hasta revocación/caducidad. HttpOnly reduce exposición a JavaScript, no elimina todos los ataques.
- Para exigir equipos físicos concretos hacen falta certificados de cliente, dispositivos administrados (MDM) o autenticadores ligados al equipo con una política de atestación adecuada. Una passkey sincronizada por sí sola no demuestra un equipo específico.
- La clave del propietario es una credencial portadora; falta MFA/passkey del propietario. No puede presentarse esta edición como la protección máxima posible.
- El límite de intentos es por proceso; varios servidores o reinicios requieren un limitador compartido en la siguiente etapa.
- No se ha hecho una auditoría completa de las numerosas rutas administrativas antiguas, ni una búsqueda exhaustiva de XSS o secretos. El nuevo control no sustituye esa auditoría.
- La app Capacitor y cualquier integración servidor a servidor necesitan validación/adaptación: ya no se permite acceso solo con código desde un origen externo.
- No elimina copias anteriores, enlaces públicos de terceros, accesos a Notion/Render/GitHub ni aplicaciones externas como el Apps Script revisado.
- Dependencias antiguas, incluido Multer 1.x, deben actualizarse con pruebas específicas antes de considerar cerrado el endurecimiento.
- La política está preparada para el proxy de Render (trust proxy=1). Revisarla si cambia el hosting.
- La clave de Notion permanece exclusivamente en el servidor; no añadir secretos a public/ ni al paquete.

## Validación realizada
- node --check del servidor y del módulo de acceso.
- test/accessGuard.test.js prueba acceso anónimo, archivos privados, APIs tempranas, código incorrecto, origen ajeno, pendiente, aprobación, permisos de personal, identidad ajena, sockets, empleado inactivo, revocación, vencimiento y cierre por fallo de configuración/base de datos.
- Estas pruebas usan persistencia simulada, no PostgreSQL ni Notion reales.
- npm run verify: las verificaciones de sintaxis y las pruebas de acceso pasaron; la siguiente prueba no pudo arrancar por falta de express. La suite completa no terminó.
- Instalación completa de dependencias bloqueada por un error 503 del repositorio de paquetes. Registrar resultado de npm run verify por separado; no asumir que toda la aplicación está validada.
