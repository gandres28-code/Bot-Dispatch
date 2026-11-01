# Care OS v10 — Un solo recorrido desde Notion

Esta versión sustituye la programación dentro de la app descrita en v9. Notion es la fuente de asignaciones, propiedades, empleados y tarifas. La app registra las acciones y conserva una copia duradera; devuelve estados y eventos a Notion en segundo plano.

## Lo que verá el equipo

- Inicio administrativo con cuatro accesos: Hoy, Equipo, Clientes y localidades, Pagos.
- Mi trabajo reúne hotel y propiedades externas. Cada empleado ve sus servicios asignados; administración ve todos y puede filtrar por propiedad y estado.
- Cada tarjeta indica cliente, propiedad, unidad y equipo. Abrirla muestra el siguiente botón: Comenzar, Terminar o Inspeccionar.
- Reportes, fotos e historial se abren solo al necesitarlos. El checklist sigue siendo obligatorio para terminar. Terminar no autoriza la entrada del huésped.
- La revisión inicial del inspector es independiente de la limpieza y exige Guest Out. No convierte la unidad en Lista para huésped.
- Clientes es un catálogo de consulta de las unidades vinculadas a asignaciones importadas. Tarifas explica dónde administrarlas en Notion. No existe una segunda programación editable en la app.

## Preparar Notion

Conserva la base Rooms / Asignaciones existente indicada por `NOTION_DATABASE_ID`. Comparte con la misma integración esa base, Employees, Daily Logs y las bases relacionadas. No necesitas duplicar cada cliente en una base de asignaciones diferente.

Cada servicio necesita:

| Campo | Tipo | Uso |
| --- | --- | --- |
| Name o Room Number | Título o texto | Unidad del hotel; conservar el formato con tipo, por ejemplo 101 (S), si usa la tarifa histórica |
| Date o Fecha | Fecha | Día del servicio |
| Assigned Cleaner | Relación a Employees, preferida | Uno o varios cleaners activos; también se aceptan nombres exactos y únicos |
| Assigned Inspector | Relación a Employees, preferida | Un inspector activo |
| Cleaning Status | Estado, selección o texto editable | Pending, In Progress, Cleaned - Awaiting Inspection, Inspection Started, Ready for Guest, Cancelled |
| Service Type | Selección o texto | Regular, Deep Clean o Touch Up |
| Unit o Unidad | Relación a Unidades | Recomendado para propiedades nuevas |
| Cleaner Pay | Número en dólares | Total de limpieza, dividido entre cleaners por defecto |
| Inspector Pay | Número en dólares | Pago al aprobar la unidad |
| Sale Price | Número en dólares | Precio al cliente; todavía no genera invoice |

Para crecer, usa estas relaciones:

1. **Clientes**: Name, Billing Name, Contact, Email, Phone, Active.
2. **Localidades**: Name, Client (una relación a Clientes), Address, Access Instructions, Active.
3. **Unidades**: Name, Location (una relación a Localidades), Room Type, Active.
4. **Asignaciones**: Unit (una relación a Unidades), fecha, cleaner, inspector, tipo y estado.

También se acepta texto o selección Client y Location directamente en la asignación. Usa nombres únicos y estables. Una propiedad externa necesita ambos; una unidad relacionada necesita su localidad. Los registros antiguos del hotel sin esos campos mantienen Still Waters como localidad.

Coordenadas opcionales en Localidades: Latitude y Longitude (número), Radius Meters (20–2000), Require Location (checkbox). El GPS identifica una propiedad aproximada, no habitaciones. Compartir ubicación requiere consentimiento, turno activo y la pantalla abierta. Esta versión no añade rastreo de teléfonos en segundo plano ni marcado automático de habitaciones.

Campos opcionales de revisión inicial: Guest Out (checkbox), Arrival (checkbox), Pre Inspection Required (checkbox), Pre Inspection (checkbox), Pre Inspection Pay (número). Para no pagar revisión inicial, definir explícitamente 0. Si existe revisión completada sin importe, nómina muestra advertencia.

Para conservar horas en Notion se pueden añadir Started At, Finished At, Inspection Started At, Ready At, Pre Inspection Started At y Pre Inspection Completed At, todos de tipo fecha con hora. Checklist Summary puede ser texto. Sin esos campos, el detalle y los tiempos siguen guardados en la app.

## Tarifas opcionales de Notion

Puedes poner los importes directamente en cada asignación o unidad. También puedes relacionar una asignación con **Rate / Tarifa**, o indicar una base con `NOTION_RATES_DATABASE_ID`.

Cada tarifa necesita Location o Unit (relación), Service Type, Active, Effective From y, opcionalmente, Effective To y Room Type. Importes: Sale Price, Cleaner Pay, Inspector Pay y Pre Inspection Pay. Se aceptan números, fórmulas numéricas o rollups numéricos.

Prioridad: importe de asignación → tarifa relacionada/vigente → importe de unidad → tarifa histórica del hotel cuando corresponda. Entre tarifas vigentes se prefiere unidad, después tipo de unidad, después localidad. Empates necesitan revisión. No se reutilizan las tarifas editadas anteriormente en la app como una segunda fuente.

`Pay Split Mode` puede ser `equal` (total dividido, conservando centavos) o `full_each` (el importe completo para cada cleaner). El hotel conserva `PAYROLL_SPLIT_MODE` cuando no existe ese campo. Los trabajos terminados conservan los importes confirmados; se pueden completar importes que antes estaban vacíos si la semana sigue abierta.

## Instalar y probar antes de cambiar la operación

1. Respaldar PostgreSQL y conservar el ZIP anterior. Instalar este proyecto completo con `npm ci` y reiniciar el servicio. La migración 017 se aplica después de 014–016 al iniciar; añade campos e índices y no elimina registros históricos.
2. Conservar `DATABASENEW_URL`, `NOTION_API_KEY` o `NOTION_TOKEN`, `NOTION_DATABASE_ID`, `NOTION_EMPLOYEES_DATABASE_ID`, `NOTION_TIME_CLOCK_DATABASE_ID` y las demás credenciales existentes. Daily Logs usa `NOTION_LOG_DATABASE_ID` o su alias existente. Configurar imágenes si se subirán fotos.
3. Preparar en Notion una asignación de prueba de cada propiedad con nombres y roles activos. Abrir Hoy y tocar Actualizar. Resolver los avisos de cliente/localidad/empleado o duplicados antes de seguir.
4. En teléfono real: entrada con ubicación, abrir Mi trabajo, comenzar, completar checklist, terminar; con inspector, inspeccionar y aprobar. Confirmar que el estado y Daily Logs se reflejan en Notion y que el pago aparece una sola vez. Confirmar horas y salida en Mi horario.
5. Revisar la nómina de transición y las semanas cerradas. No cerrar nómina con avisos sin resolver. Para consultar/importar otro día, administración cambia la fecha en Hoy y actualiza; no se importa todo el historial automáticamente.
6. Actualizar las pantallas abiertas de los empleados. Los enlaces antiguos de limpieza/inspección redirigen a Mi trabajo; las acciones de clientes antiguos se rechazan para evitar dos escritores.

## Protección e historial

- Identidad por página de Notion + fecha; permite reutilizar la página al día siguiente sin reemplazar la limpieza anterior. Una unidad admite un servicio por fecha en esta versión; un segundo servicio el mismo día requiere una ampliación futura.
- Dos páginas para la misma unidad/fecha generan revisión. Dos propiedades con una unidad 101 tienen identidades distintas.
- Una sincronización no borra el avance iniciado en la app. Cambiar unidad, tipo o equipo después de iniciar, o modificar importes confirmados al terminar, requiere revisar y corregir la asignación de origen.
- Semanas cerradas no se migran silenciosamente ni aceptan cambios al historial. No se borran fotos, reportes, eventos ni nómina anterior.
- Las filas centrales de nómina de servicios importados se sustituyen en la lectura por el cálculo de Mi trabajo, usando página + fecha. Las entradas manuales y horas siguen agregándose una vez.
- Si Notion falla, permanecen los registros ya guardados y un aviso de actualización pendiente. Las acciones se confirman tras guardarse en PostgreSQL; la copia de estados/eventos a Notion se reintenta. Daily Logs usa un marcador por evento para evitar creaciones repetidas.

## Validación y alcance

Verificación general, pruebas con PostgreSQL embebido (PGlite) de trabajo, horario, directorio y tarifas; nuevas pruebas de sincronización simulada de Notion, identidades por localidad, reintentos, importes, protección de trabajos terminados y semanas cerradas. Pruebas de navegador de administrador/cleaner/inspector a 320, 390 y 1440 px, sin desbordamiento ni errores de scripts en las vistas revisadas.

No se modificó la cuenta real de Notion ni se desplegó el servidor. Aún se requiere la prueba de integración real y teléfono real indicada arriba. Invoices por cliente/localidad, más de un servicio de una unidad en el mismo día y ubicación automática dentro de habitaciones no forman parte de v10.

Documentos v7–v9 incluidos: referencia histórica. Para el recorrido actual usar este documento y GUIA_RAPIDA_CARE.md.
