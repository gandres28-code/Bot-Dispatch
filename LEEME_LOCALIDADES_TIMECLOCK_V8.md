# Care OS v8 — Operación por localidad, Time Clock y ubicación del turno

## Qué cambia

### Operación por localidad: `/work`
- Programación de servicios para unidades nuevas del directorio: cliente → localidad → unidad → fecha, cleaners, inspector e instrucciones.
- START → limpieza → checklist asignado → DONE → inspección → READY. Deep Clean exige su checklist; no se puede sustituir por el regular.
- Dos unidades 101 en localidades distintas tienen servicios, estados, checklists, reportes, fotos y pagos independientes.
- El empleado ve sus asignaciones y la dirección/instrucciones de la propiedad. Al ingresar desde Launch, si tiene servicios nuevos del día, se abre esta vista. También hay accesos desde los paneles existentes.
- Un inspector asignado entrega la unidad; un problema abierto bloquea READY hasta que administración lo resuelva. El inspector puede devolver el trabajo a limpieza con motivo.
- Solicitudes de suministros y problemas con localidad y unidad. Runner ve la cola de suministros, administración ve ambos tipos; quedan registrados al resolverlos.
- Fotos privadas por servicio (Cloudinary existente), visibles al personal asignado o a administración. No se usan números de habitación como identidad.
- Historial del servicio y checklist completado consultables desde Abrir servicio.
- Pago total de cleaners e inspección por servicio; el total de cleaners se divide entre el equipo conservando los centavos. No es el precio de venta al cliente.
- Pagos de limpieza aparecen después de DONE; inspección después de READY. REWORK retira temporalmente el pago de limpieza hasta el nuevo DONE. No hay pago duplicado por pulsar o reenviar la misma acción.
- Administración puede corregir estos pagos con motivo, versión del registro y comprobación de semana abierta.
- Informe de pagos por localidad y CSV en `/work`. Los mismos pagos se suman a la nómina general y al Excel semanal, junto con los existentes del hotel.

### Time Clock: `/time-clock`
- Botón **Activar / probar ubicación**, ayuda de permisos, señal/precisión del GPS y consulta de turno activo.
- Entradas/salidas confirmadas primero en Care OS. La copia a Notion se reintenta después; si falla, no se pierden las horas locales.
- No admite dos entradas abiertas para el mismo empleado. Los reintentos conservan identificador y no crean otra entrada/salida.
- La hora efectiva se toma del servidor. GPS requiere coordenadas válidas y una señal reciente. No se acepta `null` convertido a cero.
- Geocerca al entrar si la localidad la exige. La salida conserva GPS y la localidad del turno abierto; no se exige volver al centro de la propiedad para finalizar el turno.
- Historial con horas, importe, tarifa pendiente y estado de copia a Notion.
- Importación al salir de una entrada antigua abierta en Notion (búsqueda paginada por Code). Si hay varias abiertas, se exige revisión en lugar de elegir una arbitrariamente.
- Horas cerradas se incluyen inmediatamente en la nómina general/Excel. Las entradas abiertas no se pagan todavía y generan advertencia.
- Los turnos que cruzan medianoche se reparten por día en America/Chicago; se prueba el cambio de horario. El importe se calcula con tiempo transcurrido, sin usar las horas redondeadas de pantalla.
- El historial de Notion sigue contribuyendo. Los turnos copiados desde Care OS se identifican y se excluyen de la segunda suma.
- Si falla la consulta del historial de Notion, se muestran las horas locales disponibles y una advertencia de información incompleta. No se debe aprobar la nómina incompleta.
- Revisión administrativa de turnos en `/work`: corregir tarifa de un turno o completar una salida faltante con fecha/hora y motivo. No se fabrican coordenadas GPS en una corrección manual.
- El cierre de nómina usa un resumen que incluye pagos por unidad y horas; las advertencias de horas o tarifas pendientes bloquean su aprobación. Los cambios de tarifa/pago revisan que la semana esté abierta.

## Antes de usar: configurar empleados en Notion

1. Employees debe conservar nombre, Code, Active y Role.
2. Para empleados por hora, configura **Hourly Rate** (Number) con la tarifa acordada. Se guarda una copia de esa tarifa al hacer Clock In. Si falta, el turno se conserva pero el pago queda pendiente de revisión.
3. Para empleados por unidad cuyo Time Clock sea solo asistencia, crea/usa **Pay Type** (Select) con `Unit`, `Per Unit`, `Por unidad`, `Attendance` o `Asistencia`. También se reconoce `Tipo de pago` como nombre del campo.
4. Si Pay Type no tiene uno de esos valores, el registro se considera por hora. No se adivina la modalidad por el rol.
5. Cambiar Hourly Rate en Notion afecta las entradas nuevas. Para corregir un turno anterior usa **Revisión de Time Clock → Revisar tarifa del turno**, con motivo. No cambia automáticamente un período ya cerrado. También puedes marcar un turno anterior como Solo asistencia, con motivo, para corregir una modalidad equivocada.
6. El idioma continúa viniendo de Employees → Idioma (Select), Inglés/Español.

## Configurar localidades y GPS

En **Clientes y localidades → Localidades → Editar** puedes configurar latitud, longitud, radio de la propiedad en metros y si se exige la geocerca al entrar. Verifica las coordenadas reales de cada propiedad.

La localidad inicial de Still Waters hereda los valores existentes de `HOTEL_LAT`, `HOTEL_LNG` y `HOTEL_RADIUS_FEET`, o los valores que ya tenía el código del hotel. Deben verificarse en el sitio; no son un levantamiento nuevo de la propiedad.

Las opciones heredadas Hotel, Chateau, Oficina, Lavandería y Otro siguen disponibles en Time Clock. Hotel conserva geocerca; las demás guardan GPS como evidencia. Selecciona una localidad registrada para que el turno tenga su identificador y cliente relacionados.

La app web requiere HTTPS y autorización de ubicación. No puede activar Location Services ni otorgarse permisos en nombre del empleado. La primera prueba debe hacerse en un teléfono real, aceptando la solicitud. Si fue denegada antes, se cambia desde los ajustes del teléfono/navegador.

Este ZIP contiene el proyecto web/servidor. No contiene un proyecto nativo iOS/Android para compilar. Si el contenedor de Capacitor no ofrece geolocalización o no tiene permisos nativos, habrá que revisar esa compilación; no se puede corregir un permiso del sistema operativo únicamente con este ZIP.

## Ubicación compartida durante el turno

- El empleado activa **Compartir ubicación durante mi turno**, además del permiso del teléfono.
- Requiere una entrada local activa de hasta 18 horas. Se actualiza mientras la pantalla Time Clock o Localidades esté abierta/visible.
- Administración ve el último punto aproximado, precisión en metros, hora de señal y enlace al mapa.
- La propiedad solo se identifica si una única geocerca contiene la señal con margen para su precisión. Si son ambiguas o no hay coordenadas configuradas, dice propiedad sin confirmar.
- No cambia el lugar de facturación/pago del turno automáticamente; una aproximación GPS no cambia información financiera.
- No identifica una habitación, piso o puerta, ni marca START automáticamente. Para ese objetivo falta una señal interior fiable y una integración específica: Bluetooth por unidad, o QR/NFC con intervención del empleado.
- El empleado puede desactivar compartir. Al salir del turno se elimina el punto compartido. No se guarda un recorrido continuo; solo el último punto. Los puntos sin actualizar por más de 15 minutos no se muestran; la consulta administrativa limpia los de más de 24 horas.
- Al cerrar/cambiar de pantalla se detiene la observación. En navegador o teléfono bloqueado no se promete seguimiento en segundo plano. No hay localización encubierta ni fuera del turno.
- GPS de entrada y salida se conserva como evidencia del registro de horas, separado del punto compartido.

## Notion Time Clock: copia e historial

Conserva `NOTION_TIME_CLOCK_DATABASE_ID` y comparte esa base con la integración actual. Para la copia necesita una propiedad de título, **Clock In** y **Clock Out** (Date). Se escriben los campos compatibles que existan: Employee, Code, Role, Hourly Rate, Hours, Total, Status, Location Status y coordenadas/precisión.

Los títulos de las copias incluyen `CARE-CLOCK:<identificador>`. No elimines ese marcador: permite recuperar una copia tras una interrupción y evitar duplicarla en nómina.

Si Notion no está configurado, el Time Clock local funciona y la copia queda pendiente. Si sí está configurado pero no responde al comprobar una posible entrada antigua, el inicio se bloquea hasta verificarla para evitar un doble turno. Una entrada local ya activa puede cerrarse aunque falle Notion.

## Instalación

1. Respalda la base de datos y conserva la versión anterior.
2. Sustituye la carpeta del proyecto por este ZIP completo. Mantén las variables de entorno actuales en Render.
3. Ejecuta `npm ci` y `npm run verify`.
4. Al iniciar se aplican las migraciones 014 y 015 de forma repetible; no se borra la operación anterior del hotel.
5. Revisa Employees (Hourly Rate/Pay Type), coordenadas/geocercas y permisos en un teléfono real.
6. Crea un cliente/localidad de prueba y dos unidades del mismo número en localidades distintas. Programa un servicio, completa START/DONE/checklist/inspección y comprueba su nómina antes de usarlo con el equipo completo.
7. Prueba Clock In/Out con una tarifa conocida y revisa `/payroll`, el Excel y la copia en Notion.

No se ha desplegado esta versión en Render ni se han modificado tus bases de Notion desde esta entrega.

## Alcance que se conserva separado

Las unidades que ya tienen historial en Rooms y la localidad hotelera inicial continúan en los paneles actuales. No se permite programarlas de nuevo en `/work`, para evitar duplicar trabajos o pagos. Para mover ese historial a la nueva operación hace falta una migración específica por registro.

Los servicios nuevos se programan en Care OS; no se crean ni importan automáticamente en Notion Rooms. Employees e idioma siguen en Notion. El nuevo Time Clock sí tiene copia a Notion. No mezcles asignaciones de localidades nuevas en la base Rooms heredada.

Los paneles ejecutivos/estadísticas antiguos mantienen su alcance hotelero; la vista operativa y los reportes nuevos por localidad están en `/work`. Los pagos se consolidan en la nómina general. No hay integración nueva de reservas, inventario, mapas interiores, invoices ni precios de venta en esta entrega.

La nueva tabla de servicios admite una limpieza por unidad/fecha. Cancelar deja historial; no la borres para programar otra con distinto importe. Múltiples servicios en la misma unidad y día requieren ampliar el modelo en otra versión.

## Pruebas realizadas

- Verificaciones existentes: motor de habitaciones, nómina/Excel, catálogo, órdenes, reportes, fiabilidad, checklist e idiomas.
- Motor PostgreSQL aislado (PGlite): esquema completo, repetición de migraciones, dos unidades 101, permisos, flujos START/DONE/inspección, bloqueo por problema abierto, división exacta de pagos y separación por localidad.
- Time Clock: GPS nulo/vencido/impreciso, turno único, reintentos, horas confirmadas sin Notion, copia repetible sin doble suma, modalidad solo asistencia, salida manual con auditoría, cambio de tarifa y bloqueo de ajustes en semana cerrada.
- Horas atravesando medianoche/cambio de horario America/Chicago.
- Interfaz DOM: permisos denegados sin enviar entrada, solicitud GPS, entradas/salidas, asignación por localidad, acciones y texto seguro.

Para repetir la prueba de integración: instala `@electric-sql/pglite` en un directorio de pruebas aislado y ejecuta `CARE_PGLITE_MODULE=/ruta/al/modulo node test/scopedWorkDb.test.js`. No apunta a la base de producción. Las pruebas de GPS real, app nativa, fotos reales y Notion del negocio quedan para la instalación; no se simula una confirmación de esos servicios.
