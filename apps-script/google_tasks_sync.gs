const CONFIG = {
  FIREBASE_DB_URL: 'https://seguimiento-tps-default-rtdb.firebaseio.com',
  FIREBASE_TASKS_PATH: '/objetivos',
  FIREBASE_STATE_PATH: '/integraciones/googleTasksSync/estado',
  INBOX_TASK_LIST_ID: '',
  INBOX_TASK_LIST_NAME: 'Mis tareas',
  DEFAULT_PRIORITY: 'media',
  DELETE_COMPLETED_IN_FIREBASE: true,
  LOG_PREFIX: '[GoogleTasksSync]',
  STATE_PROPERTY: 'GOOGLE_TASKS_SYNC_STATE',
  META_START: '[SYNC_META]',
  META_END: '[/SYNC_META]'
};

const SUBJECT_RULES = [
  {
    contexto: 'Electronica Aplicada II',
    aliases: ['electronica aplicada ii', 'electronica aplicada 2', 'electronica aplicada', 'aplicada ii', 'aplicada 2', 'aplicada', 'electronica', 'ea2']
  },
  {
    contexto: 'Medidas Electronicas I',
    aliases: ['medidas electronicas i', 'medidas electronicas 1', 'medidas electronicas', 'medidas', 'me1']
  },
  {
    contexto: 'Teoria de los Circuitos II',
    aliases: ['teoria de los circuitos ii', 'teoria de los circuitos 2', 'teoria de circuitos ii', 'teoria de circuitos 2', 'teoria de circuitos', 'circuitos ii', 'circuitos 2', 'circuitos', 'teoria ii', 'teoria 2', 'teoria', 'tc2']
  },
  {
    contexto: 'Maquinas e Instalaciones Electricas',
    aliases: ['maquinas e instalaciones electricas', 'maquinas e instalaciones', 'instalaciones electricas', 'maquinas electricas', 'maquinas', 'instalaciones', 'mie']
  },
  {
    contexto: 'Sistemas de Comunicaciones',
    aliases: ['sistemas de comunicaciones', 'sistemas comunicaciones', 'comunicaciones', 'sistemas', 'sc']
  },
  {
    contexto: 'Tecnicas Digitales II',
    aliases: ['tecnicas digitales ii', 'tecnicas digitales 2', 'tecnicas digitales', 'digitales ii', 'digitales 2', 'digitales', 'td2']
  },
  {
    contexto: 'Seguridad, Higiene y Medio Ambiente',
    aliases: ['seguridad higiene y medio ambiente', 'seguridad e higiene', 'seguridad y higiene', 'medio ambiente', 'higiene', 'seguridad', 'shma']
  }
];

const TASK_TYPE_RULES = [
  { tipo: 'trabajo practico', aliases: ['trabajo practico', 'tp'] },
  { tipo: 'parcial', aliases: ['parcial'] },
  { tipo: 'evaluacion', aliases: ['evaluacion'] },
  { tipo: 'final', aliases: ['final'] },
  { tipo: 'informe', aliases: ['informe'] },
  { tipo: 'guia', aliases: ['guia'] },
  { tipo: 'entrega', aliases: ['entrega', 'entregar'] },
  { tipo: 'coloquio', aliases: ['coloquio'] },
  { tipo: 'laboratorio', aliases: ['laboratorio', 'labo', 'lab'] },
  { tipo: 'exposicion', aliases: ['exposicion'] },
  { tipo: 'defensa', aliases: ['defensa'] }
];

function syncGoogleTasksToFirebase() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  const startedAt = new Date();
  const state = loadSyncState();
  const summary = {
    firebaseLeidas: 0,
    googleLeidas: 0,
    firebaseActualizadas: 0,
    firebaseCreadas: 0,
    firebaseEliminadas: 0,
    googleActualizadas: 0,
    googleCreadas: 0,
    googleEliminadas: 0,
    descartadas: 0,
    sinCambios: 0,
    errores: 0
  };

  try {
    const taskList = getInboxTaskList_();
    const firebaseTasks = loadFirebaseTasks_();
    const googleTasks = getTasksFromList_(taskList.id);
    const googleById = {};

    summary.firebaseLeidas = Object.keys(firebaseTasks).length;
    summary.googleLeidas = googleTasks.length;

    log('Inicio de sincronizacion', {
      taskListId: taskList.id,
      taskListName: taskList.title,
      firebaseTasks: summary.firebaseLeidas,
      googleTasks: summary.googleLeidas
    });

    googleTasks.forEach(function(task) {
      googleById[task.id] = task;
      const googleKey = buildGoogleStateKey_(taskList.id, task.id);

      if (shouldDeleteGoogleTask_(task)) {
        const firebaseIdToRemove = findFirebaseIdForGoogleTask_(firebaseTasks, state, taskList.id, task.id);
        if (firebaseIdToRemove && firebaseTasks[firebaseIdToRemove]) {
          delete firebaseTasks[firebaseIdToRemove];
          delete state.firebaseTasks[firebaseIdToRemove];
          summary.firebaseEliminadas += 1;
          log('Tarea eliminada en Firebase por estado en Google Tasks', {
            firebaseId: firebaseIdToRemove,
            googleTaskId: task.id,
            status: task.status || '',
            deleted: !!task.deleted
          });
        }
        delete state.googleTasks[googleKey];
        return;
      }

      const parsed = parseGoogleTask_(task, taskList);
      if (!parsed) {
        summary.descartadas += 1;
        log('Tarea descartada por no pertenecer a una materia valida', {
          googleTaskId: task.id,
          title: task.title || ''
        });
        return;
      }

      const firebaseId = parsed.id || findFirebaseIdForGoogleTask_(firebaseTasks, state, taskList.id, task.id) || generateFirebaseIdForGoogleTask_(taskList.id, task.id);
      const currentFirebaseTask = firebaseTasks[firebaseId];
      const googleFingerprint = buildGoogleFingerprint_(task);
      const googleState = state.googleTasks[googleKey];
      const googleChanged = !googleState || googleState.fingerprint !== googleFingerprint;
      const firebaseChanged = currentFirebaseTask ? hasFirebaseChangedSinceLastSync_(currentFirebaseTask, state) : false;
      const googleWins = !firebaseChanged || isFirstSourceNewer_(task.updated || '', currentFirebaseTask ? currentFirebaseTask.ultimaActualizacion : '');

      if (!currentFirebaseTask) {
        firebaseTasks[firebaseId] = mergeGoogleTaskIntoFirebase_(null, parsed, firebaseId);
        summary.firebaseCreadas += 1;
      } else if (googleChanged && googleWins) {
        firebaseTasks[firebaseId] = mergeGoogleTaskIntoFirebase_(currentFirebaseTask, parsed, firebaseId);
        summary.firebaseActualizadas += 1;
      } else if (!googleChanged) {
        summary.sinCambios += 1;
      }

      if (firebaseTasks[firebaseId] && googleWins) {
        state.firebaseTasks[firebaseId] = {
          fingerprint: buildFirebaseFingerprint_(firebaseTasks[firebaseId]),
          googleTaskId: task.id,
          googleTaskListId: taskList.id,
          updatedAt: firebaseTasks[firebaseId].ultimaActualizacion || ''
        };
      }

      state.googleTasks[googleKey] = {
        fingerprint: googleFingerprint,
        firebaseId: firebaseId,
        googleTaskId: task.id,
        googleTaskListId: taskList.id
      };
    });

    Object.keys(state.firebaseTasks).forEach(function(firebaseId) {
      if (firebaseTasks[firebaseId]) return;

      const previous = state.firebaseTasks[firebaseId];
      if (previous.googleTaskId) {
        deleteGoogleTask_(previous.googleTaskListId || taskList.id, previous.googleTaskId);
        delete state.googleTasks[buildGoogleStateKey_(previous.googleTaskListId || taskList.id, previous.googleTaskId)];
        summary.googleEliminadas += 1;
        log('Tarea eliminada en Google Tasks por borrado en Firebase', {
          firebaseId: firebaseId,
          googleTaskId: previous.googleTaskId
        });
      }

      delete state.firebaseTasks[firebaseId];
    });

    Object.keys(firebaseTasks).forEach(function(firebaseId) {
      const task = normalizeFirebaseTaskRecord_(firebaseId, firebaseTasks[firebaseId]);
      firebaseTasks[firebaseId] = task;

      if (!isValidSubject_(task.contexto)) {
        summary.descartadas += 1;
        log('Tarea en Firebase descartada para sync con Google Tasks por materia invalida', {
          firebaseId: firebaseId,
          contexto: task.contexto
        });
        return;
      }

      const firebaseFingerprint = buildFirebaseFingerprint_(task);
      const firebaseState = state.firebaseTasks[firebaseId];
      const firebaseChanged = !firebaseState || firebaseState.fingerprint !== firebaseFingerprint;
      const googleTask = task.googleTaskId ? googleById[task.googleTaskId] : null;
      const googleKey = task.googleTaskId ? buildGoogleStateKey_(task.googleTaskListId || taskList.id, task.googleTaskId) : '';
      const googleChanged = googleTask && (!state.googleTasks[googleKey] || state.googleTasks[googleKey].fingerprint !== buildGoogleFingerprint_(googleTask));
      const firebaseWins = !googleChanged || isFirstSourceNewer_(task.ultimaActualizacion || '', googleTask ? (googleTask.updated || '') : '');

      if (!task.googleTaskId) {
        const created = createGoogleTaskFromFirebase_(taskList.id, task, firebaseId);
        applyGoogleLinkToFirebaseTask_(task, created, taskList.id);
        googleById[created.id] = created;
        summary.googleCreadas += 1;
      } else if (!googleTask) {
        const recreated = createGoogleTaskFromFirebase_(taskList.id, task, firebaseId);
        applyGoogleLinkToFirebaseTask_(task, recreated, taskList.id);
        googleById[recreated.id] = recreated;
        summary.googleCreadas += 1;
      } else if (firebaseChanged && firebaseWins) {
        const updated = updateGoogleTaskFromFirebase_(task.googleTaskListId || taskList.id, task.googleTaskId, task, firebaseId);
        applyGoogleLinkToFirebaseTask_(task, updated, task.googleTaskListId || taskList.id);
        googleById[updated.id] = updated;
        summary.googleActualizadas += 1;
      } else if (!firebaseChanged) {
        summary.sinCambios += 1;
      }

      state.firebaseTasks[firebaseId] = {
        fingerprint: buildFirebaseFingerprint_(task),
        googleTaskId: task.googleTaskId || '',
        googleTaskListId: task.googleTaskListId || '',
        updatedAt: task.ultimaActualizacion || ''
      };

      if (task.googleTaskId) {
        state.googleTasks[buildGoogleStateKey_(task.googleTaskListId || taskList.id, task.googleTaskId)] = {
          fingerprint: buildGoogleFingerprint_(googleById[task.googleTaskId] || {
            id: task.googleTaskId,
            title: task.tarea,
            notes: buildGoogleNotes_(task, firebaseId),
            due: task.fecha || '',
            status: 'needsAction',
            updated: task.ultimaActualizacion || ''
          }),
          firebaseId: firebaseId,
          googleTaskId: task.googleTaskId,
          googleTaskListId: task.googleTaskListId || taskList.id
        };
      }
    });

    saveFirebaseTasks_(firebaseTasks);

    state.lastRunStartedAt = startedAt.toISOString();
    state.lastRunCompletedAt = new Date().toISOString();
    state.lastRunFailedAt = '';
    state.lastError = '';
    state.lastSummary = summary;
    saveSyncState(state);
    writeSyncStatusToFirebase_(state);

    log('Sincronizacion finalizada', summary);
  } catch (error) {
    summary.errores += 1;
    state.lastRunStartedAt = startedAt.toISOString();
    state.lastRunFailedAt = new Date().toISOString();
    state.lastError = String(error && error.stack ? error.stack : error);
    state.lastSummary = summary;
    saveSyncState(state);
    writeSyncStatusToFirebase_(state);
    log('Error en sincronizacion', { error: state.lastError });
    throw error;
  } finally {
    lock.releaseLock();
  }
}

function installGoogleTasksSyncTrigger() {
  const handler = 'syncGoogleTasksToFirebase';
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === handler) {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  ScriptApp.newTrigger(handler)
    .timeBased()
    .everyMinutes(15)
    .create();

  log('Trigger creado', { handler: handler, cadaMinutos: 15 });
}

function resetGoogleTasksSyncState() {
  PropertiesService.getScriptProperties().deleteProperty(CONFIG.STATE_PROPERTY);
  log('Estado local eliminado');
}

function previewGoogleTasksParsing() {
  const taskList = getInboxTaskList_();
  const preview = getTasksFromList_(taskList.id).slice(0, 10).map(function(task) {
    return {
      title: task.title,
      notes: task.notes || '',
      parsed: parseGoogleTask_(task, taskList)
    };
  });

  log('Vista previa de parseo', preview);
  return preview;
}

function loadSyncState() {
  const raw = PropertiesService.getScriptProperties().getProperty(CONFIG.STATE_PROPERTY);
  if (!raw) {
    return {
      googleTasks: {},
      firebaseTasks: {},
      lastRunStartedAt: '',
      lastRunCompletedAt: '',
      lastRunFailedAt: '',
      lastError: '',
      lastSummary: {}
    };
  }

  try {
    const parsed = JSON.parse(raw);
    parsed.googleTasks = parsed.googleTasks || {};
    parsed.firebaseTasks = parsed.firebaseTasks || {};
    return parsed;
  } catch (error) {
    log('No se pudo leer el estado anterior, se reinicia', { error: String(error) });
    return {
      googleTasks: {},
      firebaseTasks: {}
    };
  }
}

function saveSyncState(state) {
  PropertiesService.getScriptProperties().setProperty(CONFIG.STATE_PROPERTY, JSON.stringify(state));
}

function getInboxTaskList_() {
  if (CONFIG.INBOX_TASK_LIST_ID) {
    const byId = Tasks.Tasklists.get(CONFIG.INBOX_TASK_LIST_ID);
    return { id: byId.id, title: byId.title };
  }

  const allLists = [];
  let pageToken = null;
  do {
    const response = Tasks.Tasklists.list({ maxResults: 100, pageToken: pageToken });
    (response.items || []).forEach(function(item) {
      allLists.push(item);
    });
    pageToken = response.nextPageToken || null;
  } while (pageToken);

  const byName = allLists.find(function(item) {
    return normalizeText_(item.title) === normalizeText_(CONFIG.INBOX_TASK_LIST_NAME);
  });
  if (byName) return { id: byName.id, title: byName.title };

  if (allLists.length > 0) {
    const inferred = allLists[0];
    log('No se encontro la lista configurada; se usa la primera lista disponible como inbox', {
      requestedName: CONFIG.INBOX_TASK_LIST_NAME,
      selectedId: inferred.id,
      selectedTitle: inferred.title
    });
    return { id: inferred.id, title: inferred.title };
  }

  throw new Error('No se encontro ninguna lista de Google Tasks para usar como inbox.');
}

function getTasksFromList_(taskListId) {
  const items = [];
  let pageToken = null;

  do {
    const response = Tasks.Tasks.list(taskListId, {
      maxResults: 100,
      pageToken: pageToken,
      showCompleted: true,
      showDeleted: true,
      showHidden: true
    });

    (response.items || []).forEach(function(task) {
      if (!task || !task.id) return;
      if (!task.title && !task.notes) return;
      items.push(task);
    });

    pageToken = response.nextPageToken || null;
  } while (pageToken);

  return items;
}

function loadFirebaseTasks_() {
  const response = firebaseRequest_(CONFIG.FIREBASE_TASKS_PATH, 'get');
  const raw = response || {};
  const tasks = {};

  Object.keys(raw).forEach(function(firebaseId) {
    tasks[firebaseId] = normalizeFirebaseTaskRecord_(firebaseId, raw[firebaseId]);
  });

  return tasks;
}

function saveFirebaseTasks_(tasks) {
  const payload = {};
  Object.keys(tasks).forEach(function(firebaseId) {
    const task = normalizeFirebaseTaskRecord_(firebaseId, tasks[firebaseId]);
    payload[firebaseId] = {
      contexto: task.contexto,
      tarea: task.tarea,
      fecha: task.fecha,
      comentarios: task.comentarios,
      prioridad: task.prioridad,
      origen: task.origen,
      fuenteId: task.fuenteId,
      listaId: task.listaId,
      googleTaskId: task.googleTaskId,
      googleTaskListId: task.googleTaskListId,
      tipoActividad: task.tipoActividad,
      ultimaActualizacion: task.ultimaActualizacion,
      sincronizadoEn: task.sincronizadoEn
    };
  });

  firebaseRequest_(CONFIG.FIREBASE_TASKS_PATH, 'put', payload);
}

function normalizeFirebaseTaskRecord_(firebaseId, item) {
  const raw = item || {};
  return {
    id: firebaseId,
    contexto: typeof raw.contexto === 'string' ? raw.contexto : '',
    tarea: typeof raw.tarea === 'string' ? raw.tarea : '',
    fecha: typeof raw.fecha === 'string' ? raw.fecha : '',
    comentarios: typeof raw.comentarios === 'string' ? raw.comentarios : '',
    prioridad: raw.prioridad === 'alta' || raw.prioridad === 'media' || raw.prioridad === 'baja' ? raw.prioridad : CONFIG.DEFAULT_PRIORITY,
    origen: typeof raw.origen === 'string' ? raw.origen : 'web',
    fuenteId: typeof raw.fuenteId === 'string' ? raw.fuenteId : '',
    listaId: typeof raw.listaId === 'string' ? raw.listaId : '',
    googleTaskId: typeof raw.googleTaskId === 'string' ? raw.googleTaskId : (typeof raw.fuenteId === 'string' ? raw.fuenteId : ''),
    googleTaskListId: typeof raw.googleTaskListId === 'string' ? raw.googleTaskListId : (typeof raw.listaId === 'string' ? raw.listaId : ''),
    tipoActividad: typeof raw.tipoActividad === 'string' ? raw.tipoActividad : '',
    ultimaActualizacion: typeof raw.ultimaActualizacion === 'string' ? raw.ultimaActualizacion : '',
    sincronizadoEn: typeof raw.sincronizadoEn === 'string' ? raw.sincronizadoEn : ''
  };
}

function parseGoogleTask_(task, taskList) {
  const notesInfo = parseGoogleNotes_(task.notes || '');
  const metadata = notesInfo.metadata;
  const text = [task.title || '', notesInfo.userNotes || '', metadata.contexto || '', metadata.tipoActividad || ''].join(' ').trim();
  const subjectMatch = metadata.contexto && isValidSubject_(metadata.contexto)
    ? { contexto: metadata.contexto, alias: 'metadata' }
    : detectContext_(text, taskList);

  if (!subjectMatch.contexto || !isValidSubject_(subjectMatch.contexto)) {
    return null;
  }

  const taskType = metadata.tipoActividad
    ? { tipo: metadata.tipoActividad, alias: 'metadata' }
    : detectTaskType_(text);

  return {
    id: metadata.firebaseId || '',
    contexto: subjectMatch.contexto,
    tarea: cleanTaskTitle_(task.title || notesInfo.userNotes || 'Tarea sin titulo'),
    fecha: detectDate_(task, text, metadata),
    comentarios: notesInfo.userNotes || '',
    prioridad: metadata.prioridad || detectPriority_(text),
    tipoActividad: taskType.tipo || '',
    fuenteId: task.id,
    listaId: taskList.id,
    googleTaskId: task.id,
    googleTaskListId: taskList.id,
    googleUpdatedAt: task.updated || '',
    materiaDetectadaPor: subjectMatch.alias || '',
    textoOriginal: text
  };
}

function parseGoogleNotes_(notes) {
  const value = String(notes || '');
  const startIndex = value.lastIndexOf(CONFIG.META_START);
  const endIndex = value.lastIndexOf(CONFIG.META_END);

  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    return { userNotes: value.trim(), metadata: {} };
  }

  const userNotes = value.slice(0, startIndex).trim();
  const metaBlock = value.slice(startIndex + CONFIG.META_START.length, endIndex).trim();
  const metadata = {};

  metaBlock.split('\n').forEach(function(line) {
    const separator = line.indexOf(':');
    if (separator === -1) return;
    const key = line.slice(0, separator).trim();
    const data = line.slice(separator + 1).trim();
    metadata[key] = data;
  });

  return { userNotes: userNotes, metadata: metadata };
}

function buildGoogleNotes_(task, firebaseId) {
  const notes = cleanMultilineText_(task.comentarios || '');
  const lines = [
    CONFIG.META_START,
    'firebaseId: ' + firebaseId,
    'contexto: ' + task.contexto,
    'prioridad: ' + task.prioridad,
    'fecha: ' + (task.fecha || ''),
    'tipoActividad: ' + (task.tipoActividad || ''),
    CONFIG.META_END
  ];

  if (!notes) return lines.join('\n');
  return notes + '\n\n' + lines.join('\n');
}

function mergeGoogleTaskIntoFirebase_(currentTask, parsedTask, firebaseId) {
  const now = new Date().toISOString();
  return {
    id: firebaseId,
    contexto: parsedTask.contexto,
    tarea: parsedTask.tarea,
    fecha: parsedTask.fecha,
    comentarios: parsedTask.comentarios,
    prioridad: parsedTask.prioridad,
    origen: 'google_tasks',
    fuenteId: parsedTask.googleTaskId,
    listaId: parsedTask.googleTaskListId,
    googleTaskId: parsedTask.googleTaskId,
    googleTaskListId: parsedTask.googleTaskListId,
    tipoActividad: parsedTask.tipoActividad || (currentTask ? currentTask.tipoActividad : ''),
    ultimaActualizacion: parsedTask.googleUpdatedAt || now,
    sincronizadoEn: now
  };
}

function createGoogleTaskFromFirebase_(taskListId, task, firebaseId) {
  return Tasks.Tasks.insert({
    title: task.tarea,
    notes: buildGoogleNotes_(task, firebaseId),
    due: toGoogleDueDate_(task.fecha)
  }, taskListId);
}

function updateGoogleTaskFromFirebase_(taskListId, googleTaskId, task, firebaseId) {
  return Tasks.Tasks.patch({
    title: task.tarea,
    notes: buildGoogleNotes_(task, firebaseId),
    due: toGoogleDueDate_(task.fecha),
    status: 'needsAction'
  }, taskListId, googleTaskId);
}

function deleteGoogleTask_(taskListId, googleTaskId) {
  Tasks.Tasks.remove(taskListId, googleTaskId);
}

function applyGoogleLinkToFirebaseTask_(task, googleTask, taskListId) {
  task.googleTaskId = googleTask.id;
  task.googleTaskListId = taskListId;
  task.fuenteId = googleTask.id;
  task.listaId = taskListId;
  task.sincronizadoEn = new Date().toISOString();
}

function detectContext_(text, taskList) {
  const normalized = normalizeText_(text);
  const candidates = [];

  SUBJECT_RULES.forEach(function(rule) {
    rule.aliases.forEach(function(alias) {
      const normalizedAlias = normalizeText_(alias);
      if (!containsAlias_(normalized, normalizedAlias)) return;
      candidates.push({
        contexto: rule.contexto,
        alias: normalizedAlias,
        score: buildAliasScore_(normalizedAlias, normalized, taskList)
      });
    });
  });

  candidates.sort(function(a, b) {
    if (b.score !== a.score) return b.score - a.score;
    if (b.alias.length !== a.alias.length) return b.alias.length - a.alias.length;
    return a.contexto.localeCompare(b.contexto);
  });

  return candidates[0] || { contexto: '', alias: '' };
}

function detectTaskType_(text) {
  const normalized = normalizeText_(text);

  for (let i = 0; i < TASK_TYPE_RULES.length; i += 1) {
    const rule = TASK_TYPE_RULES[i];
    for (let j = 0; j < rule.aliases.length; j += 1) {
      const alias = normalizeText_(rule.aliases[j]);
      if (containsAlias_(normalized, alias)) {
        return { tipo: rule.tipo, alias: alias };
      }
    }
  }

  const numberedTp = normalized.match(/\btp\s*\d+\b/);
  if (numberedTp) return { tipo: 'trabajo practico', alias: numberedTp[0] };

  return { tipo: '', alias: '' };
}

function detectPriority_(text) {
  const normalized = normalizeText_(text);
  if (/\b(urgente|alta prioridad|muy importante|asap|critico)\b/.test(normalized)) return 'alta';
  if (/\b(tranquilo|sin apuro|baja prioridad)\b/.test(normalized)) return 'baja';
  return CONFIG.DEFAULT_PRIORITY;
}

function detectDate_(task, text, metadata) {
  if (task.due) return formatDateOnly_(new Date(task.due));
  if (metadata && metadata.fecha) return metadata.fecha;

  const normalized = normalizeText_(text);
  const timezone = Session.getScriptTimeZone();

  const isoMatch = normalized.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (isoMatch) return isoMatch[0];

  const shortMatch = normalized.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (shortMatch) {
    const day = Number(shortMatch[1]);
    const month = Number(shortMatch[2]) - 1;
    const year = shortMatch[3] ? normalizeYear_(shortMatch[3]) : new Date().getFullYear();
    return formatDateOnly_(new Date(year, month, day));
  }

  if (/\bpasado manana\b/.test(normalized)) return shiftToday_(2, timezone);
  if (/\bmanana\b/.test(normalized)) return shiftToday_(1, timezone);
  if (/\bhoy\b/.test(normalized)) return shiftToday_(0, timezone);

  const weekdayMap = { lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6, domingo: 0 };
  const weekdayMatch = normalized.match(/\b(lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/);
  if (weekdayMatch) return nextWeekday_(weekdayMap[weekdayMatch[1]], timezone);

  return '';
}

function shouldDeleteGoogleTask_(task) {
  if (task.deleted) return true;
  if (!CONFIG.DELETE_COMPLETED_IN_FIREBASE) return false;
  return task.status === 'completed';
}

function hasFirebaseChangedSinceLastSync_(task, state) {
  const currentFingerprint = buildFirebaseFingerprint_(task);
  const previous = state.firebaseTasks[task.id];
  return !previous || previous.fingerprint !== currentFingerprint;
}

function findFirebaseIdForGoogleTask_(firebaseTasks, state, taskListId, googleTaskId) {
  const byTask = Object.keys(firebaseTasks).find(function(firebaseId) {
    const task = firebaseTasks[firebaseId];
    return task.googleTaskId === googleTaskId && (task.googleTaskListId || taskListId) === taskListId;
  });
  if (byTask) return byTask;

  const stateEntry = state.googleTasks[buildGoogleStateKey_(taskListId, googleTaskId)];
  return stateEntry ? stateEntry.firebaseId : '';
}

function generateFirebaseIdForGoogleTask_(taskListId, googleTaskId) {
  return 'gt-' + Utilities.base64EncodeWebSafe(taskListId + '__' + googleTaskId).replace(/=+$/g, '');
}

function buildGoogleStateKey_(taskListId, googleTaskId) {
  return taskListId + '__' + googleTaskId;
}

function buildFirebaseFingerprint_(task) {
  return [
    task.contexto || '',
    task.tarea || '',
    task.fecha || '',
    task.comentarios || '',
    task.prioridad || '',
    task.tipoActividad || '',
    task.googleTaskId || ''
  ].join('||');
}

function buildGoogleFingerprint_(task) {
  return [
    task.title || '',
    task.notes || '',
    task.updated || '',
    task.due || '',
    task.status || '',
    task.deleted ? '1' : '0'
  ].join('||');
}

function isFirstSourceNewer_(firstTimestamp, secondTimestamp) {
  const first = Date.parse(firstTimestamp || '');
  const second = Date.parse(secondTimestamp || '');
  if (Number.isNaN(first) && Number.isNaN(second)) return true;
  if (Number.isNaN(first)) return false;
  if (Number.isNaN(second)) return true;
  return first >= second;
}

function isValidSubject_(contexto) {
  return SUBJECT_RULES.some(function(rule) {
    return rule.contexto === contexto;
  });
}

function containsAlias_(normalizedText, alias) {
  const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp('(^|\\W)' + escaped + '(\\W|$)');
  return regex.test(normalizedText);
}

function buildAliasScore_(alias, normalizedText, taskList) {
  let score = alias.length;
  if (/\b(ii|2|i|1)\b/.test(alias)) score += 5;
  if (alias.indexOf(' ') !== -1) score += 3;
  if (normalizedText.indexOf(alias) === 0) score += 1;
  if (taskList && normalizeText_(taskList.title).indexOf(alias) !== -1) score += 2;
  return score;
}

function toGoogleDueDate_(fecha) {
  if (!fecha) return null;
  return fecha + 'T12:00:00.000Z';
}

function cleanTaskTitle_(title) {
  return String(title || '').replace(/\s+/g, ' ').trim();
}

function cleanMultilineText_(text) {
  return String(text || '').replace(/\r/g, '').trim();
}

function firebaseRequest_(path, method, payload) {
  const url = CONFIG.FIREBASE_DB_URL.replace(/\/$/, '') + path + '.json';
  const options = {
    method: method,
    muteHttpExceptions: true,
    contentType: 'application/json'
  };

  if (typeof payload !== 'undefined') {
    options.payload = JSON.stringify(payload);
  }

  const response = UrlFetchApp.fetch(url, options);
  const status = response.getResponseCode();
  const body = response.getContentText();

  if (status < 200 || status >= 300) {
    throw new Error('Firebase respondio con ' + status + ' para ' + path + ': ' + body);
  }

  return body ? JSON.parse(body) : null;
}

function writeSyncStatusToFirebase_(state) {
  firebaseRequest_(CONFIG.FIREBASE_STATE_PATH, 'put', {
    lastRunStartedAt: state.lastRunStartedAt || '',
    lastRunCompletedAt: state.lastRunCompletedAt || '',
    lastRunFailedAt: state.lastRunFailedAt || '',
    lastError: state.lastError || '',
    lastSummary: state.lastSummary || {}
  });
}

function nextWeekday_(targetDay, timezone) {
  const now = new Date();
  const currentDay = Number(Utilities.formatDate(now, timezone, 'u')) % 7;
  let diff = targetDay - currentDay;
  if (diff < 0) diff += 7;
  if (diff === 0) diff = 7;
  const target = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diff);
  return formatDateOnly_(target);
}

function shiftToday_(days, timezone) {
  const nowString = Utilities.formatDate(new Date(), timezone, 'yyyy/MM/dd');
  const parts = nowString.split('/').map(Number);
  const target = new Date(parts[0], parts[1] - 1, parts[2] + days);
  return formatDateOnly_(target);
}

function formatDateOnly_(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function normalizeYear_(yearText) {
  const year = Number(yearText);
  if (String(yearText).length === 2) return 2000 + year;
  return year;
}

function normalizeText_(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function log(message, data) {
  if (typeof data === 'undefined') {
    Logger.log('%s %s', CONFIG.LOG_PREFIX, message);
    return;
  }

  Logger.log('%s %s %s', CONFIG.LOG_PREFIX, message, JSON.stringify(data));
}
