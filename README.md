# Organizacion academica con Firebase y Google Tasks

Este proyecto tiene dos piezas principales:

- `index.html`: panel principal con horario y tareas editables.
- `apps-script/google_tasks_sync.gs`: puente bidireccional entre Google Tasks y Firebase Realtime Database.

## Modelo actual

- Firebase usa una sola coleccion canonica: `objetivos`.
- La web lee y edita directamente esa coleccion.
- Google Tasks funciona como otra interfaz del mismo sistema, no como importacion aparte.
- Cada tarea puede guardar:
  - materia
  - titulo
  - comentarios
  - fecha
  - prioridad
  - metadatos de sincronizacion con Google Tasks

## Web

La web ahora:

- muestra todas las tareas como editables
- usa un conjunto cerrado de materias
- agrega un campo de `Comentarios`
- guarda IDs estables para permitir sincronizacion bidireccional
- marca visualmente si una tarea ya esta vinculada con Google Tasks

## Google Apps Script

El archivo `apps-script/google_tasks_sync.gs` hace esto:

- trabaja sobre una sola lista objetivo de Google Tasks, por defecto `Facultad`
- crea esa lista si no existe
- lee Google Tasks y Firebase
- detecta cambios con fingerprints persistidos en `ScriptProperties`
- sincroniza en ambos sentidos con criterio simple de ultima edicion
- elimina en Google Tasks si una tarea vinculada desaparece de Firebase
- elimina en Firebase si una tarea de Google Tasks se completa o se borra
- descarta tareas que no coincidan con una de las materias validas
- usa `notes` de Google Tasks para guardar comentarios y un bloque minimo de metadata de sync

### Materias validas

Las materias admitidas son:

- `Tecnicas Digitales II`
- `Medidas Electronicas I`
- `Teoria de los Circuitos II`
- `Maquinas e Instalaciones Electricas`
- `Sistemas de Comunicaciones`
- `Electronica Aplicada II`
- `Seguridad, Higiene y Medio Ambiente`

### Pasos sugeridos

1. Abri tu proyecto de Apps Script.
2. Pega el contenido de `apps-script/google_tasks_sync.gs`.
3. Verifica que el servicio avanzado de Google Tasks este habilitado.
4. Ejecuta `previewGoogleTasksParsing()` para revisar como interpreta tus tareas reales.
5. Ejecuta `syncGoogleTasksToFirebase()` una vez para autorizar y probar.
6. Si el resultado te sirve, ejecuta `installGoogleTasksSyncTrigger()` para correrlo cada 15 minutos.

### Notas de diseno

- El parser prioriza tus materias reales y descarta lo que no entre en ese contexto.
- Los comentarios de la web se sincronizan con `notes` de Google Tasks.
- La metadata de sync viaja al final de `notes` entre marcadores para mantener el vinculo estable.
- Si editas una tarea desde la web, el cambio se empuja a Google Tasks en la siguiente corrida del script.
- Si editas una tarea en Google Tasks, el cambio baja a Firebase y se refleja en la web.

## Firebase

La base usada por la web y Apps Script es:

- `https://seguimiento-tps-default-rtdb.firebaseio.com`

Para un uso personal simple, podes trabajar con reglas abiertas o relajadas mientras haces pruebas.
