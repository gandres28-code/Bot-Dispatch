# Care OS v12 — Proyecto completo

## Cambios incluidos

- Inicio: cuatro accesos administrativos (Hoy, Equipo, Propiedades, Pagos). Los empleados ven Mi trabajo, Mi horario y Avisos. Los accesos dependen de la autorización recibida del servidor.
- Inicio disponible en español o inglés según el idioma del empleado recibido desde Notion.
- Sistema visual compartido: iconos vectoriales, tarjetas, controles, colores, cuadros de diálogo, foco de teclado y respuesta al pulsar. Respeta la preferencia de reducir movimiento.
- Navegación inferior en teléfono: Mi trabajo, Mi horario y Avisos. No se muestra en acceso ni dentro de módulos incrustados.
- Hoy / Mi trabajo: búsqueda por unidad, propiedad, cliente o empleado; filtros de estado, problemas y revisión inicial; recuento de resultados y avance por localidad. Las canceladas no cuentan en el avance.
- Cada tarjeta explica el siguiente paso. Al abrirla muestra las etapas de asignación, limpieza, inspección y entrega. Los permisos, Guest Out, checklist y aprobación de inspector siguen comprobándose con el servidor.
- Ubicación, revisión de horarios y pagos por localidad se despliegan bajo demanda para reducir el contenido inicial.
- Solicitudes de Mi trabajo: filtro por tipo (problemas o suministros) y localidad; conserva resolución y entregas existentes. La consulta devuelve ahora el identificador de localidad para filtrar incluso reportes de servicios de otros días.
- Mi horario: diferencia visual entre turno activo e inactivo, tiempo transcurrido desde entrada y tarjetas para el historial. El contador es orientativo; los importes y horas de nómina siguen calculándose en el servidor.
- Estilo común aplicado a las páginas que ya usan care-design, incluyendo equipo, propiedades, pagos, reportes, solicitudes y acceso. No se reemplazaron los módulos existentes por versiones incompletas.

## Qué se conserva

Notion sigue siendo la fuente de asignaciones, empleados y tarifas. Se mantienen las integraciones, migraciones, datos, checklist normal/deep clean, fotos, reportes, nómina e idioma. El trabajo de v12 no necesita una nueva base ni nuevas variables de entorno. Para instalaciones anteriores a v10, leer también LEEME_V10.md.

Solicitudes del hotel conserva su módulo existente y sus estados. La bandeja por localidad mantiene sus estados abierto/resuelto; no se añadió un estado intermedio de atención ni se mezclaron historiales de ambos sistemas. Ambos accesos están disponibles desde Reportes y herramientas.

## Instalación

1. Conserva un respaldo de la versión instalada y de los datos antes de reemplazar el proyecto.
2. Usa el contenido de la carpeta Care_OS_v12 como proyecto completo. Conserva las variables de entorno y credenciales existentes; no sustituyas datos de producción con archivos de prueba.
3. Ejecuta npm ci y reinicia con npm start, o realiza el despliegue habitual de tu repositorio en Render.
4. Recarga las pantallas abiertas para cargar la versión 12 de los estilos y scripts compartidos.
5. Antes de usarlo con todo el equipo, prueba una asignación: comenzar, checklist, terminar, inspeccionar y aprobar; confirma el estado en Notion y el pago en nómina. Prueba entrada/salida y permisos de ubicación en un teléfono real.

## Validación realizada

- scripts/verify.js completado: sintaxis y regresiones de horarios, directorio, motor de habitaciones, nómina y Excel, catálogo, centro de control, confiabilidad, reportes, checklist e idiomas.
- Pruebas DOM de Inicio y Mi trabajo: administrador/empleado × español/inglés; búsqueda, filtros, avance, apertura de detalle, acciones autorizadas y paneles por rol.
- Pruebas DOM de Mi horario con turno activo e inactivo: botones de entrada/salida, idioma y contador.
- HTML: identificadores únicos y referencias de recursos compartidos.

No hubo validación visual en un navegador real: la descarga de Chromium no estuvo disponible en este entorno. Las pruebas DOM no verifican tamaños, desbordamientos ni apariencia. Tampoco se modificó Notion real ni se desplegó en Render. La instalación limpia de dependencias en este entorno se interrumpió por un error 503 del registro; las pruebas anteriores sí pudieron ejecutarse con las dependencias disponibles. Requiere npm ci satisfactorio en el entorno de despliegue.

Los documentos v7–v11 se conservan como referencia histórica. Este documento describe la actualización actual.
