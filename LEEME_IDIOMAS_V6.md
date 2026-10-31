# Care OS · Idioma desde Notion Employees · v6.1

## Configuración en Notion

En la base **Employees** utilizada por Care OS:

1. Agregar una propiedad llamada **Idioma**.
2. Elegir el tipo **Select** (selección única).
3. Crear las opciones **Inglés** y **Español**.
4. Elegir una opción en la fila de cada empleado.

No crear otra base. Es la misma Employees que usa el acceso por código. El campo debe ser Select, no Text ni Multi-select. Si está vacío o no existe, se usa español. También se reconocen los valores Ingles, INGLES, English y en, para compatibilidad; la configuración recomendada es Inglés / Español.

La propiedad todavía debe crearse en tu Notion: esta entrega modifica el proyecto, no tiene acceso a tu cuenta para agregarla directamente.

## Comportamiento

- Notion Employees es la fuente del idioma.
- Al entrar, Care OS lee la preferencia del perfil de Notion. Las sesiones abiertas la revisan al recuperar visibilidad/conexión y periódicamente.
- Se usa una caché breve para evitar consultas excesivas. Un cambio puede tardar aproximadamente uno o dos minutos en aparecer en una sesión abierta. Recargar vuelve a consultar, sujeto a esa caché breve.
- Empleados muestra el idioma leído desde Notion y el aviso de que se cambia allí. Ya no hay un botón para guardar una preferencia local que contradiga Notion.
- Los clientes anteriores que intenten guardar el idioma desde la app recibirán un aviso: deben cambiarlo en Notion Employees, campo Idioma.
- La columna interna `employees.app_language` se conserva solo como copia durante la sincronización; la preferencia activa se consulta desde Notion, no desde esa columna.
- Sin conexión se conserva en ese teléfono el último idioma aplicado para el código del empleado. No se puede conocer un cambio nuevo de Notion hasta recuperar conexión.

Los campos llamados Language, App Language o Idioma de la app también son compatibles. Se recomienda mantener un solo campo Idioma para evitar ambigüedad; Idioma tiene prioridad si hay varios.

## Traducciones incluidas

Se conservan las traducciones de la v6: menús, botones, etiquetas, avisos conocidos, limpieza, inspecciones, catálogo, solicitudes, runner, registro de horas y vistas administrativas. Se incluyen los 15 puntos completos del checklist regular y los 84 de Deep Clean, categorías, No aplica y motivos. Se mantienen la revisión de cafetera/tostadora/cables y la bolsa completa del hide-a-bed.

Los nombres, códigos, números de unidad, notas, motivos escritos y textos externos/IA se conservan en su idioma original. No se agrega traducción automática de mensajes libres ni de PDFs/Excel ya generados. El idioma cambia la presentación, no los valores operativos, tarifas o claves del catálogo.

## Instalación

1. Desplegar el proyecto completo en Render: servidor, servicios, esquema, vistas y archivos de traducción.
2. Usar la integración y la base Employees de Notion ya configuradas. La integración debe poder leer los perfiles.
3. Crear el Select Idioma en Notion y elegir el idioma por empleado.
4. Actualizar las páginas abiertas. Si Capacitor contiene recursos locales, reconstruir e instalar también ese paquete.
5. Probar con dos empleados: uno en Inglés y otro en Español; entrar con cada código, revisar menús, pedidos y ambos checklists. Cambiar el Select de Notion y confirmar la actualización después del intervalo de caché.

La actualización no despliega Render ni crea propiedades de Notion por sí sola.

## Validación

Pasaron `npm run verify` y las pruebas de esta versión: lectura de Select con/sin acento, opciones vacías, rechazo de propiedades Text, cambios desde Notion en ambos sentidos después de la caché, fallo de Notion sin inventar una preferencia nueva, rechazo de las antiguas escrituras locales y copia del idioma en la sincronización normal de empleados. Se conservan las pruebas de traducción completa de ambos checklists, catálogo y notificaciones.

Estas pruebas usan perfiles simulados de Notion. No se realizó una consulta o migración contra tu Notion/Render reales ni se probó la aplicación nativa o push en un teléfono físico.

Fuentes de traducción: `translations/`. Regenerar el bundle con `node scripts/build-i18n.js` si se modifican los textos.
