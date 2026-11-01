# Care OS v7 — Clientes, localidades y unidades (base administrativa)

## Instalación
1. Respalda la base de datos antes de desplegar y conserva el ZIP anterior.
2. Sustituye el código por esta carpeta completa, conservando las variables actuales de Render. Ejecuta `npm ci` y `npm run verify` antes del despliegue.
3. Al iniciar, el sistema aplica `db/migrations/014_client_directory.sql` y vincula Rooms con el directorio. No elimina registros de nómina, reportes, fotos ni asignaciones.
4. Abre **Care OS → Clientes y localidades**, o `/clients`, e ingresa con un código activo de administración.
5. Revisa la pestaña Unidades, filtro **Solo pendientes de revisión**. Crea primero el cliente y localidad correctos y luego asigna cada unidad pendiente.

## Qué incluye
- Clientes: nombre, nombre de facturación, contacto, correo, teléfono, dirección y notas.
- Localidades por cliente: nombre, dirección e instrucciones de acceso.
- Unidades por localidad: identificador UUID permanente, nombre, tipo, edificio, recámaras, baños y notas.
- Dos unidades llamadas 101 pueden existir en localidades distintas. Se rechazan duplicados dentro de la misma localidad.
- Edición, desactivación e historial interno de cambios. No se borran entidades; un cliente/localidad con dependientes activos no puede desactivarse.
- Protección de cambios simultáneos: si otra persona guardó primero, debes actualizar antes de editar otra vez.
- Acceso verificado en servidor: admin, manager, owner, company owner, general manager, corporate y operations. Cleaner, inspector y dispatch sin otra función administrativa no pueden consultar el directorio.
- Interfaz ES/EN que toma el idioma del campo Select de Notion Employees, mediante el servicio de preferencias existente.

## Migración e identidad
- Still Waters se crea como cliente y localidad iniciales.
- Rooms anteriores con el mismo número normalizado comparten una unidad física en el directorio, conservando sus filas diarias y fechas.
- Registros sin metadatos de localidad se consideran del alcance hotelero actual (Still Waters). Esta es una suposición de migración que debes revisar.
- Si un número tiene una referencia explícita a otra propiedad, una relación de Notion sin resolver o un título Chateau, se marca para revisión y no se asigna automáticamente a Still Waters.
- Si varias propiedades ya compartieron el mismo número normalizado en el historial, la revisión se aplica al grupo completo. No se puede reconstruir automáticamente una mezcla histórica: requiere revisar las filas antes de dividir el grupo.
- La migración puede repetirse. El vínculo UUID no cambia por reiniciar. Tras sincronizar Rooms se vinculan los registros nuevos.
- Dos páginas de Notion distintas con la misma fecha/unidad se rechazan antes de la antigua fusión; no se elimina ninguna de ellas.

## Alcance y siguientes pasos
Esta entrega es el directorio maestro. Las localidades nuevas son registros administrativos; todavía no se agregan al trabajo diario.
Los endpoints heredados, catálogo de fotos, órdenes, nómina y reportes aún usan identificadores de habitación de la operación actual. No se ha cambiado su índice único (fecha + número normalizado), ni sus claves, ni se ha reasignado su historial a clientes nuevos.
No cargues asignaciones de propiedades nuevas a la base Rooms actual. Una propiedad externa explícita nueva es rechazada por el sincronizador, para evitar mezclarla con el hotel. El error aparece en el resultado de sincronización.

El siguiente paso debe llevar el UUID de unidad y localidad por TODO el recorrido: Notion → asignación → START/DONE → checklist → inspección → fotos/órdenes → nómina/reportes. Solo después se habilita la operación de localidades nuevas. Posteriormente vienen tarifas de venta/pago e invoices.

Los catálogos nuevos se guardan en la base actual de la app; todavía no tienen sincronización con bases nuevas de Notion. Employees e idioma conservan su fuente existente en Notion. No se crean bases de Notion ni se requiere una variable nueva para esta entrega.

## Verificación
- `npm run verify`: sintaxis y pruebas existentes, más pruebas del directorio.
- `node test/clientDirectory.test.js`: acceso, validación, duplicados, identidad por localidad, reintentos, conflictos y rollback.
- `test/clientDirectoryDb.test.js`: prueba aislada del esquema/migración/backfill con motor PostgreSQL PGlite. Instala `@electric-sql/pglite` fuera del proyecto y apunta `CARE_PGLITE_MODULE` al módulo para ejecutarla; no usa la base de producción.
- Antes de utilizar en producción: comprobar inicio/migración con una copia de la base real, acceso de administrador, idioma desde Notion, filas pendientes y que START/DONE/nómina del hotel sigan funcionando.

No hay despliegue a Render ni cambios en Notion realizados desde esta entrega.
