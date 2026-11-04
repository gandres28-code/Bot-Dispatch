# Care OS 14 · Personas, dispositivos e historial de acceso

## Estado de la entrega
Código preparado sobre la versión candidata 13. No está publicado en Render.
Antes de activar, comparar con el repositorio que ejecuta la app y probar en un entorno separado.
Conservar las instrucciones de activación de LEEME_ACCESO_V13_ES.md. La nueva versión sigue usando CARE_PUBLIC_ORIGIN, CARE_OWNER_SECRET y DATABASENEW_URL.

## Dónde verlo
En /access, entrar con la clave privada del propietario.
También se añade la tarjeta Personas y dispositivos al inicio administrativo; la tarjeta abre /access. Solo el propietario puede consultar el registro y gestionar permisos.
Un empleado normal verá la pantalla para solicitar su propio acceso, sin ver el historial de otras personas.

## Qué muestra
1. Personas de Employees, incluidas personas sin acceso registrado. Esas personas dicen Sin apertura registrada y no demuestran tener instalada la app.
2. Cantidad de credenciales de navegador autorizadas y solicitudes pendientes del equipo; no son un conteo fiable de teléfonos físicos.
3. Dispositivos/navegadores registrados: persona, nombre declarado del dispositivo, identificador, tipo de equipo reportado, sistema operativo y navegador aproximados.
4. Primera y última apertura registradas, fecha de solicitud, vencimiento, permisos y estado.
5. Historial con fecha y hora del servidor: apertura de página principal, regreso desde segundo plano, solicitud, autorización, bloqueo y cierre del acceso.
6. Intentos sin autorización desde navegadores que todavía presentan una credencial registrada, incluidos bloqueados. No se atribuye identidad a visitantes sin registro.
7. Filtros por persona y dispositivo. Más dispositivos / Más historial permiten recorrer registros más allá de los primeros 100.
8. Horarios mostrados en America/Chicago (Branson); la base de datos conserva instantes con zona horaria.
9. Actualización del panel cada 30 segundos mientras está visible. Se pausa al ampliar páginas de historial para no interrumpir la lectura; Actualizar vuelve al inicio de las listas.

## Qué cuenta como apertura
- El servidor registra peticiones de navegación de nivel superior que presentan Sec-Fetch-Dest: document. Las navegaciones internas a otra página pueden producir una apertura adicional; no son nuevas instalaciones.
- Volver a primer plano después de al menos 30 segundos registra Regresó a la app.
- Restaurar una página desde la caché de navegación también notifica el regreso.
- Las llamadas periódicas a APIs, recursos JS/CSS e iframes internos no se cuentan como aperturas humanas.
- Se limita el registro a 30 notificaciones por minuto por credencial para contener abuso.
- Es telemetría de peticiones/visibilidad, no una prueba de quién sostuvo el teléfono ni de horas trabajadas.
- Aperturas sin Internet, navegadores antiguos sin Fetch Metadata y navegaciones que no llegan al servidor pueden no registrarse. Los regresos requieren que el JavaScript de Care se ejecute.
- No existe historial retrospectivo anterior a la publicación.

## Autorizar y bloquear
- Cotejar el identificador de la solicitud con la persona por una vía conocida.
- Elegir Mi trabajo y horario para personal o Administración para personas autorizadas.
- Bloquear dispositivo revoca esa credencial para nuevas solicitudes inmediatamente después de confirmar la operación.
- Socket.IO vuelve a verificar cada 10 segundos; una conexión ya abierta puede tardar hasta ese intervalo en desconectarse. No elimina datos que ya se descargaron.
- El bloqueo no borra el historial.
- También se pueden bloquear otras sesiones del propietario; la sesión actual se cierra mediante Cerrar y retirar este acceso para evitar bloquearse por error.
- Una credencial bloqueada no puede emitir su propia solicitud de reemplazo. El propietario puede reautorizar una credencial de empleado aún no vencida si decide hacerlo.
- Borrar cookies o cambiar de navegador puede generar una solicitud nueva, que sigue necesitando aprobación. Esto no es una lista negra permanente del hardware.
- El nombre del equipo lo escribe la persona y el navegador reporta sistema/tipo; pueden ser inexactos o alterados. No se obtiene IMEI, número de serie ni modelo exacto.
- Una sesión abierta sigue representando a la persona con la que fue registrada. No demuestra la identidad de quien usa físicamente el equipo compartido.

## Datos y permisos
La tabla care_access_devices añade first_open_at, last_open_at y client_info.
La nueva tabla care_access_events conserva eventos, actor de una autorización y metadatos del navegador; no registra contraseñas, códigos, cookies, contenido de mensajes, fotografías, ubicación GPS ni direcciones IP en este historial.
Se conserva el user-agent, limitado a 500 caracteres. La interfaz muestra una identificación aproximada, no toda esa cadena.
El registro se almacena en PostgreSQL, fuera de las bases operativas de Notion. Employees sigue viniendo de Notion.
La cuenta de la base necesita CREATE TABLE, CREATE INDEX y ALTER TABLE para actualizar automáticamente la estructura en el primer acceso; si usa migraciones controladas, aplicar el SQL de services/accessGuard.js antes del despliegue.
Los registros se conservan hasta que el administrador implemente una política de retención; no se borran automáticamente en esta edición.
Se informa al equipo en la pantalla de acceso de qué actividad se registra.
No se afirma estado En línea; una apertura reciente no prueba que alguien continúe conectado.

## Verificación
Pasaron:
- Pruebas de autorización, aprobación, identidad vinculada, bloqueo y fallos cerrados.
- Registro de solicitudes, aperturas y regresos; los eventos usan la hora del servidor.
- Exclusión de consultas automáticas y recursos del historial de aperturas.
- Acceso exclusivo del propietario a personas e historial.
- Bloqueo de otras sesiones del propietario y protección frente al bloqueo accidental de la propia sesión.
- Conservación del historial después del bloqueo.
- Reutilización de solicitudes pendientes para evitar duplicados por reintento.
- Empleado inactivo no entra en un ciclo de redirecciones.
- Pruebas del JavaScript de regresos: umbral de tiempo, caché de navegación, exclusión de iframes, deduplicación y redirección tras revocación.
- Verificación de sintaxis del servidor, módulo, navegación y scripts de la pantalla.

Límites: las pruebas de persistencia usan una base simulada. La instalación de dependencias volvió a fallar por HTTP 503 del repositorio de paquetes; la suite general no se pudo completar. No se comprobó la interfaz en un navegador real ni la migración en PostgreSQL real.

## Prueba de aceptación antes de producción
1. Abrir dos navegadores diferentes con empleados de prueba y cotejar las solicitudes.
2. Aprobar uno y dejar el otro pendiente. Comprobar que solo el aprobado accede a sus datos.
3. Abrir Mi trabajo y Mi horario; comprobar los eventos y la hora de Branson.
4. Dejar la app en segundo plano más de 30 segundos y volver; verificar Regresó a la app.
5. Esperar varias sincronizaciones automáticas; no deben aparecer como nuevas aperturas.
6. Bloquear el acceso y comprobar que no lee nuevas APIs, que no puede reemplazar su propia credencial y que se mantiene el historial.
7. Comprobar en iPhone, Android, escritorio y app Capacitor: cookies seguras, origen, permisos y registro de apertura/regreso.
8. Probar paginación, filtros, solicitudes duplicadas, empleados inactivos y varias sesiones del propietario.
9. Completar las pruebas generales del proyecto, Notion y PostgreSQL antes de publicar.
