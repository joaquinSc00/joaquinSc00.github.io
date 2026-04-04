# Organizacion academica con Firebase

Este proyecto tiene dos piezas principales:

- `index.html`: panel principal con horario, tareas manuales y tareas importadas.
- `apps-script/google_tasks_sync.gs`: puente desde Google Tasks hacia Firebase Realtime Database.

## Como funciona hoy

- La web guarda las tareas manuales en Firebase en `objetivos`.
- Las tareas importadas desde Google Tasks viven aparte en `integraciones/googleTasks/objetivos`.
- La pagina mezcla ambos origenes y los muestra juntos.
- Las tareas importadas aparecen como solo lectura para no mezclar la edicion manual con la sincronizacion automatica.

## Firebase

La web ya esta configurada con este Realtime Database:

- `https://seguimiento-tps-default-rtdb.firebaseio.com`

Si usas reglas abiertas para un proyecto personal, la web y Apps Script pueden leer y escribir sin una capa extra de autenticacion.

## Google Apps Script

El archivo `apps-script/google_tasks_sync.gs` hace esto:

- Lee todas tus listas de Google Tasks, o solo algunas si completas `TASK_LIST_IDS`.
- Detecta tareas nuevas o modificadas usando un fingerprint persistido en `ScriptProperties`.
- Evita reprocesar tareas sin cambios.
- Borra en Firebase las tareas completadas o eliminadas en Google Tasks.
- Parsea una primera version de `contexto`, `tarea`, `fecha` y `prioridad`.
- Escribe el resultado en Firebase para que la web lo muestre.

### Pasos sugeridos

1. Abri tu proyecto de Apps Script.
2. Pega el contenido de `apps-script/google_tasks_sync.gs`.
3. Verifica que el servicio avanzado de Google Tasks este habilitado.
4. Ejecuta `previewGoogleTasksParsing()` para ver como interpreta ejemplos reales.
5. Ejecuta `syncGoogleTasksToFirebase()` una vez para autorizar y probar.
6. Si te cierra el resultado, ejecuta `installGoogleTasksSyncTrigger()` para correrlo cada 15 minutos.

### Notas de diseno

- El parseo es deliberadamente simple y extensible.
- Las materias se detectan por palabras clave en el titulo y las notas.
- Si una tarea tiene fecha `due` en Google Tasks, se usa esa primero.
- Si no, intenta detectar fechas escritas como `2026-04-10`, `10/04`, `hoy`, `manana` o un dia de la semana.
- Si no encuentra materia, usa la lista de Google Tasks o `Facultad`.

## Publicacion

Para publicar la web con GitHub Pages:

1. Sube estos archivos a tu repo.
2. Activa GitHub Pages en `Settings > Pages`.
3. Abre tu URL publicada y verifica que las tareas aparezcan desde Firebase.
