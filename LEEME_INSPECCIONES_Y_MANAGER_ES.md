# Care OS · Inspecciones y manager del turno

## Instalar
1. Reemplaza los archivos del repositorio por el contenido de este ZIP y despliega en Render como de costumbre. Conserva las variables de entorno actuales.
2. En Notion → Employees → Jose, cambia Role a `manager / inspector` (texto de una opción Select o combinación de opciones si Role es Multi-select). Mantén su código y Active activado.
3. José entra con su código habitual a `/shift-manager` o `/work`. Si ya estaba dentro, cierra sesión y vuelve a entrar para actualizar su rol. Pulsa Actualizar.

El rol manager existente permite ver todas las localidades y también revisar pagos/horarios. No es un rol limitado exclusivamente a supervisar. No se asigna permiso por nombre: se toma Role de Employees.

## Qué incluye
- Resumen diario de pendientes, limpiezas, unidades esperando inspección, inspecciones en curso y listas.
- Tabla por unidad con cleaner, inspector, estado, tiempo de limpieza, espera y tiempo de inspección. Los tiempos requieren las fechas registradas; no se inventan horas faltantes.
- Acceso a Órdenes y operaciones (`/requests`), solicitudes de problemas y suministros, horarios y ubicación del equipo que haya autorizado compartirla.
- Un manager puede iniciar/finalizar inspecciones, devolver a limpieza y resolver solicitudes. START/DONE de limpieza siguen correspondiendo al cleaner asignado.
- Filtros por fecha, localidad y estado. El manager ve todas las unidades del día; el inspector normal solo sus asignadas.

## Corrección de asignaciones
Se permite cambiar Assigned Inspector en Notion después de comenzar o terminar la limpieza, mientras no haya comenzado la inspección ni preinspección. Se conservan tiempos, eventos y pagos de limpieza.
No se cambia el responsable de una inspección ya comenzada o completada: aparece un aviso para revisión. Esto protege el historial y los pagos. El manager puede ver esas unidades aunque estén asignadas a otro inspector.

## Cleaning Status de Notion
- Not Started o vacío → Sin comenzar
- Started / In Progress → En limpieza
- Waiting for inspection / Cleaned - Awaiting Inspection → Para inspeccionar
- Inspection Started → Inspeccionando (la app puede crear esta opción en Select)
- Ready for Guest → Lista para huésped
- Re doit → En limpieza

Andres, Lili y MARCAR EN HOTSOS no son estados de limpieza reconocidos; usa campos de asignación o notas para esos valores. No necesitas borrar opciones existentes.

La sincronización respeta las opciones equivalentes existentes de Select/Status/Multi-select. El panel de manager indica cuántas asignaciones importó y muestra los errores por unidad cuando requieren revisión.

## Validación
Se agregaron pruebas de asignación de inspector después de terminar la limpieza, conservación de tiempos, bloqueo tras iniciar inspección, visibilidad del manager y estados actuales de Notion.
No se ha desplegado ni probado contra tus datos reales de Notion desde esta sesión.
