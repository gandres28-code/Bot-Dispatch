# CARE OS · Acceso persistente

Reemplaza los archivos del proyecto con el contenido de esta carpeta y publica
la actualización en Render. Conserva las variables que ya tienes configuradas.
Esta actualización incluye todos los archivos del programa.

Los dispositivos aprobados conservan su autorización hasta que el propietario
la retire o el empleado se desactive en Notion. Al iniciar, también se conserva
la aprobación anterior de registros aprobados que tenían fecha de vencimiento.
Las solicitudes pendientes siguen necesitando aprobación.

Los administradores se reconocen por los permisos que el programa ya obtiene
del rol en Notion Employees. Los roles administrativos con permiso total
(como Admin, Manager y Owner) entran con su código personal sin aprobación.
El ZIP no contiene la lista real de empleados, por lo que no permite identificar
tres códigos específicos por su posición. Verifica que los tres administradores
tengan su rol administrativo correcto en Employees.

La pantalla de entrada restaura al usuario del navegador aprobado. La cookie se
renueva al abrir la app, consultar el acceso o volver a primer plano. El navegador
puede eliminarla y tiene sus propias políticas de conservación. Si se borra o
cambia de navegador, los empleados solicitan aprobación una vez para ese acceso.
Los administradores vuelven a entrar con su código personal.

La sesión de la clave privada del propietario también conserva su autorización.
El botón Cerrar y retirar este acceso y el bloqueo de dispositivos siguen
retirando el permiso.

Después de publicar, prueba un administrador desde un navegador nuevo y un
empleado aprobado. Cierra y vuelve a abrir el navegador del empleado, y comprueba
que puedes bloquearlo desde Personas y dispositivos.

Verificación realizada
- Sintaxis del servidor, módulos y scripts de las páginas.
- Suite completa de verificación del proyecto.
- Acceso automático por permiso administrativo, restauración del usuario,
  renovación de cookies, migración de aprobaciones, bloqueo e inactividad.
- Las pruebas de acceso usan persistencia simulada. Falta comprobar el
  despliegue con PostgreSQL, Notion y un teléfono reales.
