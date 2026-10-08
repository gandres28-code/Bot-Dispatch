# Care OS — prueba 1 del catálogo y revisión visual

Este ZIP contiene tu proyecto completo Bot-Dispatch-main-18 más el módulo nuevo. Conserva los módulos existentes. No reemplaces tus variables de Render ni tus bases Notion.

## Instalar
1. Haz respaldo de tu repositorio y base antes de actualizar.
2. Copia el contenido de esta carpeta a la raíz del repositorio que usa Render (server.js y package.json deben quedar en la raíz).
3. Conserva tus variables actuales. Este módulo requiere DATABASENEW_URL para PostgreSQL; CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY y CLOUDINARY_API_SECRET para fotos; OPENAI_API_KEY para revisión de IA. Revisa los nombres exactos usados por server.js si tu configuración ya está activa.
4. Opcional: CARE_VISION_MODEL=gpt-4o-mini. Puedes usar otro modelo compatible con imágenes y Chat Completions disponible en tu cuenta.
5. Render: comando de build npm ci; comando de inicio npm start. Publica el cambio. El arranque existente ejecuta db/schema.sql y crea care_unit_photos automáticamente. Si tu arranque falla antes de inicializar PostgreSQL, resuelve la conexión antes de usar el módulo.
6. Abre /unit-catalog en tu dominio HTTPS o “Mapa y catálogo” dentro de Habitaciones en /app. Accede con un código de empleado activo de tu base existente.

## Primera prueba
1. Confirma que aparecen las unidades. La lista toma la última fila conocida de cada unidad en rooms; no es un tablero de asignaciones del día. Para poblarla, usa la sincronización Notion → PostgreSQL existente.
2. Entra como inspector/admin, selecciona unidad y área, elige “Referencia de unidad terminada” y captura o sube una foto correcta.
3. Entra como cleaner, selecciona la misma unidad y área y captura evidencia. Permite la cámara. La cámara integrada usa video + canvas y envía la captura sin escribirla a la galería del teléfono. El navegador requiere HTTPS y permisos. “Subir foto existente” es una alternativa y sí usa archivos del dispositivo.
4. La evidencia se guarda primero y después se solicita la revisión IA. Si la IA falla o no tiene clave/crédito, la evidencia permanece y puedes volver a intentar con “Revisar con IA”.
5. Revisa problemas visibles, correcciones sugeridas y partes no verificables. El inspector puede aceptar la evidencia o solicitar corrección. Eso NO cambia el estado Ready Guest ni aprueba automáticamente la habitación completa.

## Permisos y datos
- Referencias: visibles para empleados autenticados; solo inspector/admin/manager/operations/supervisor/dispatch pueden crearlas.
- Evidencias: cada cleaner ve las suyas; los roles de inspección/gestión ven todas.
- Las fotografías se cargan a Cloudinary como authenticated y se sirven al navegador mediante una ruta autenticada. La IA recibe URL firmada del original.
- Las sesiones son tokens de 8 horas en memoria del servidor; al reiniciarse Render, se vuelve a iniciar sesión. Compatible con una instancia; múltiples instancias requieren almacén compartido de sesiones.
- Metadata, resultados IA y revisión humana viven en PostgreSQL. No se crean bases nuevas en Notion ni se guardan fotos como blobs allí.
- Historial muestra hasta 200 fotos recientes por unidad. No incluye eliminación/retención automática en esta primera prueba.
- Una revisión analiza una foto y hasta dos referencias de esa unidad y área. No comprueba olor, higiene microbiológica, temperatura, inventario fuera de la imagen ni zonas ocultas. Una foto sin problemas visibles no equivale a unidad aprobada.

## Alcance del mapa
La vista actual agrupa unidades reales por edificio y permite abrir su catálogo. No inventa posiciones geográficas ni recorridos. El plano físico del resort y los logos requieren los archivos correspondientes para añadirlos con precisión. No se incluyeron logos inventados.

## Archivos nuevos/cambiados
services/unitCatalog.js, public/unit-catalog.html, public/js/unit-catalog.js, test/unitCatalog.test.js; integración en server.js y public/app.html; nueva tabla en db/schema.sql.

## Verificación realizada
node --check de servidor, módulo y JavaScript de UI; pruebas existentes de RoomEngine y payroll; test/unitCatalog.test.js con servicios simulados. No se ejecutaron conexiones reales a tu Notion, PostgreSQL, Cloudinary o OpenAI ni despliegue a Render desde esta sesión.
