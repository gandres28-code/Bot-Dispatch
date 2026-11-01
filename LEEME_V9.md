# Care OS v9 — Diseño uniforme, teléfono/computadora y tarifas

## Qué verás diferente

- Una base visual compartida en todas las páginas: azul marino, blanco y gris claro; misma tipografía, bordes, botones, campos y tarjetas.
- Barra de navegación común: Inicio, Mi trabajo y Mi horario. En las pantallas del hotel, Mi trabajo conserva el acceso a su trabajo del hotel.
- Cleaner: tarjetas en una columna en teléfono; dos o tres columnas en pantallas grandes. Unidad, estado y acciones legibles, con botones táctiles.
- Inspector: contadores y pestañas acomodados para no comprimir palabras en el teléfono. Se conservan las acciones y los círculos de progreso.
- Estados con significado: azul claro durante el trabajo, verde al terminar/aprobar según la pantalla, gris pendiente y rojo para problemas/urgencias. No se cambia la autorización de huésped: DONE continúa pendiente de inspección.
- Formularios que desplazan sus campos y conservan visible Guardar. Campos ocultos que realmente permanecen ocultos.
- Tablas de horas/pagos convertidas en tarjetas con etiquetas cuando la pantalla es pequeña; en computadora conservan las columnas.
- Nómina presenta los importes, horas y advertencias. Se retiraron de la vista normal los paneles técnicos de fuentes/conexión; siguen los elementos requeridos por el código.
- Centro de Control usa un selector de sección en teléfono, en lugar de pestañas que se pierden fuera de la pantalla.
- No hay selector de tema por página: esta versión usa el mismo tema claro de Care OS.

## Programar una limpieza en dos pasos

Abre **Operación por localidad / Trabajo del día → Programar limpieza**.

1. **Trabajo:** cliente, propiedad, unidad, fecha y servicio.
2. **Equipo y pago:** marca los cleaners, elige inspector y comprueba los importes sugeridos.

Los cambios de importes e instrucciones están dentro de **Ajustar importes o instrucciones**. El pago de cleaners es TOTAL por servicio y se divide entre el equipo seleccionado.

La vista del empleado muestra sus unidades y las acciones de trabajo; no ofrece los enlaces administrativos de tarifas o clientes.

## Tarifas: precio al cliente y pago al equipo

Abre **Tarifas** desde Care OS o `/rates`.

- Elige la propiedad.
- Aplica la tarifa a toda la propiedad, un tipo de unidad (Motel, Studio, 1BR, 2BR, 3BR, House u otros tipos registrados) o una unidad específica.
- Selecciona regular, deep clean o touch up.
- Define cuánto cobras, el pago TOTAL de cleaners y el pago de inspección.
- Define la fecha de inicio; la fecha final es opcional.

Al programar un servicio nuevo se elige la tarifa vigente: **unidad específica → tipo de unidad → propiedad completa**. No se mezclan propiedades aunque compartan el mismo número de unidad.

El servicio guarda sus importes y una copia de la tarifa aplicada. Cambiar una tarifa no cambia los servicios ya programados. Una pantalla con una tarifa desactualizada debe actualizarla antes de guardar. Ajustar los importes sugeridos requiere motivo.

No se permite superponer dos tarifas activas para el mismo alcance, servicio y fechas. Para una subida futura, termina la anterior el día previo e inicia la nueva en su fecha correspondiente. Es posible mantener una tarifa general y otra por tipo/unidad, porque tienen distinta prioridad.

El saldo mostrado es precio menos pago de cleaners e inspección, **antes de materiales, traslados, lavandería y otros gastos**. No se presenta como utilidad neta.

Las tarifas no generan ni envían invoices. La siguiente etapa puede utilizar el precio guardado para preparar facturas por cliente/propiedad/período, sin recalcular servicios antiguos.

## Corrección adicional de horas manuales

El botón **Agregar horas** de Nómina ahora se conecta con el registro confirmado de horas. Requiere código administrativo, empleado activo, motivo, fecha/hora de Branson (Chicago) y semana abierta. Evita reintentos duplicados y cruces con turnos locales ya registrados. Antes de agregar horas antiguas, verifica que no estén en el historial anterior de Notion; esta validación de cruces cubre los turnos locales.

Las horas manuales son una corrección administrativa: no se inventa ubicación GPS. El registro queda auditado y se incluye en la nómina y en la copia a Notion. Para un turno nocturno usa el Time Clock normal o la revisión de salida; el formulario manual actual usa entrada y salida del mismo día.

## Instalación

1. Respalda la base de datos y conserva el ZIP anterior.
2. Sustituye el proyecto completo por esta carpeta; no necesitas instalar v7 y v8 por separado. Conserva las variables actuales de Render.
3. Ejecuta `npm ci` y `npm run verify`.
4. Al iniciar se aplican las migraciones existentes y `016_service_rates.sql`. No se requieren nuevas variables obligatorias.
5. Actualiza la página para cargar los estilos v9. En una app instalada, cierra y abre la pantalla; si conserva una copia anterior, actualiza su contenido web.
6. Configura una tarifa de prueba y programa una limpieza de prueba antes de usarla con el equipo completo.

No se ha desplegado este ZIP en Render ni se han cambiado las bases reales de Notion desde esta entrega.

## Se conserva el alcance de v8

- La operación histórica de Still Waters permanece en sus paneles y Rooms actuales; las propiedades nuevas se operan en Trabajo del día.
- Las tarifas nuevas se aplican al programar servicios nuevos en ese flujo. No sustituyen automáticamente los pagos históricos o las reglas de nómina del hotel.
- Tarifas, clientes y servicios nuevos se administran en Care OS; no se crean automáticamente bases de Notion para estos catálogos.
- Employees/idioma y el historial/copia de Time Clock conservan sus conexiones anteriores.
- Ubicación compartida es aproximada, voluntaria y durante turno activo con la pantalla abierta. No identifica habitaciones ni marca START automáticamente.
- Las opciones de reservas, invoices y detección interior por Bluetooth/NFC siguen pendientes.

## Verificación realizada

- `npm run verify`: regresiones existentes y sintaxis del código nuevo.
- `test/scopedWorkDb.test.js`: operación por localidad, nómina, Time Clock, horas manuales, ubicación consentida, duplicados y auditoría en un motor PostgreSQL aislado.
- `test/serviceRatesDb.test.js`: aislamiento por propiedad, prioridad por tipo/unidad, vigencia, solapamientos, copia de precios, reintentos y cambios simultáneos.
- Navegador Chromium con datos de prueba: revisión de 25 páginas a 320, 390 y 1440 píxeles; revisión adicional de cleaners/inspectores a 375 píxeles.
- Flujos de programación en dos pasos y creación de tarifas ejecutados a 320 y 1440 píxeles. Se comprobó que Guardar queda visible dentro del cuadro y que no aparece desplazamiento horizontal de página.

Las pruebas de escritorio con anchos móviles no equivalen a probar cada modelo de teléfono. Después de instalar, comprueba Safari/Chrome del equipo y la app nativa, permisos GPS, fotos y las conexiones reales de Notion. Los datos utilizados aquí para las vistas y pruebas no son registros del negocio.

Para pruebas de integración aisladas usa `CARE_PGLITE_MODULE=/ruta/a/@electric-sql/pglite node test/serviceRatesDb.test.js` o el archivo de operación equivalente. No requieren conectarse a la base real.
