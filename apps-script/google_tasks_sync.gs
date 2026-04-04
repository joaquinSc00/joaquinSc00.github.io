const CONFIG = {
  FIREBASE_DB_URL: 'https://seguimiento-tps-default-rtdb.firebaseio.com',
  FIREBASE_IMPORT_PATH: '/integraciones/googleTasks/objetivos',
  FIREBASE_STATE_PATH: '/integraciones/googleTasks/estado',
  TASK_LIST_IDS: [],
  DEFAULT_CONTEXT: 'Facultad',
  DEFAULT_PRIORITY: 'media',
  SYNC_ONLY_INCOMPLETE: true,
  LOG_PREFIX: '[GoogleTasksSync]'
};

const SUBJECT_RULES = [
  {
    contexto: 'Electronica Aplicada II',
    aliases: [
      'electronica aplicada ii',
      'electronica aplicada 2',
      'electronica aplicada',
      'aplicada ii',
      'aplicada 2',
      'aplicada',
      'electronica',
      'ea2'
    ]
  },
  {
    contexto: 'Medidas Electronicas I',
    aliases: [
      'medidas electronicas i',
      'medidas electronicas 1',
      'medidas electronicas',
      'medidas',
      'me1'
    ]
  },
  {
    contexto: 'Teoria de los Circuitos II',
    aliases: [
      'teoria de los circuitos ii',
      'teoria de los circuitos 2',
      'teoria de circuitos ii',
      'teoria de circuitos 2',
      'teoria de circuitos',
      'circuitos ii',
      'circuitos 2',
      'circuitos',
      'teoria ii',
      'teoria 2',
      'teoria',
      'tc2'
    ]
  },
  {
    contexto: 'Maquinas e Instalaciones Electricas',
    aliases: [
      'maquinas e instalaciones electricas',
      'maquinas e instalaciones',
      'instalaciones electricas',
      'maquinas electricas',
      'maquinas',
      'instalaciones',
      'mie'
    ]
  },
  {
    contexto: 'Sistemas de Comunicaciones',
    aliases: [
      'sistemas de comunicaciones',
      'sistemas comunicaciones',
      'comunicaciones',
      'sistemas',
      'sc'
    ]
  },
  {
    contexto: 'Tecnicas Digitales II',
    aliases: [
      'tecnicas digitales ii',
      'tecnicas digitales 2',
      'tecnicas digitales',
      'digitales ii',
      'digitales 2',
      'digitales',
      'td2'
    ]
  },
  {
    contexto: 'Seguridad, Higiene y Medio Ambiente',
    aliases: [
      'seguridad higiene y medio ambiente',
      'seguridad e higiene',
      'seguridad y higiene',
      'medio ambiente',
      'higiene',
      'seguridad',
      'shma'
    ]
  }
];

const TASK_TYPE_RULES = [
  { tipo: 'trabajo practico', aliases: ['trabajo practico', 'trabajo práctico', 'tp'] },
  { tipo: 'parcial', aliases: ['parcial'] },
  { tipo: 'evaluacion', aliases: ['evaluacion', 'evaluación'] },
  { tipo: 'final', aliases: ['final'] },
  { tipo: 'informe', aliases: ['informe'] },
  { tipo: 'guia', aliases: ['guia', 'guía'] },
  { tipo: 'entrega', aliases: ['entrega', 'entregar'] },
  { tipo: 'coloquio', aliases: ['coloquio'] },
  { tipo: 'laboratorio', aliases: ['laboratorio', 'labo', 'lab'] },
  { tipo: 'exposicion', aliases: ['exposicion', 'exposición'] },
  { tipo: 'defensa', aliases: ['defensa'] }
];

function syncGoogleTasksToFirebase() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  const startedAt = new Date();
  const state = loadSyncState();
  const seenKeys = {};
  const summary = {
    listas: 0,
    tareasLeidas: 0,
    tareasNuevasOModificadas: 0,
    tareasSinCambios: 0,
    tareasSubidas: 0,
    tareasEliminadas: 0,
    errores: 0
  };

  try {
    log('Inicio de sincronizacion', { startedAt: startedAt.toISOString() });

    const listas = getTaskLists_();
    summary.listas = listas.length;
    log('Listas detectadas', listas.map(function(lista) {
      return { id: lista.id, nombre: lista.title };
    }));

    listas.forEach(function(lista) {
      const tareas = getTasksFromList_(lista.id);
      log('Leyendo lista', { lista: lista.title, cantidad: tareas.length });

      tareas.forEach(function(task) {
        summary.tareasLeidas += 1;
        const taskKey = buildTaskKey_(lista.id, task.id);
        seenKeys[taskKey] = true;

        const currentFingerprint = buildFingerprint_(task);
        const previous = state.tasks[taskKey];
        if (previous && previous.fingerprint === currentFingerprint) {
          summary.tareasSinCambios += 1;
          return;
        }

        summary.tareasNuevasOModificadas += 1;

        if (shouldDeleteImportedTask_(task)) {
          deleteFirebaseTask_(taskKey);
          delete state.tasks[taskKey];
          summary.tareasEliminadas += 1;
          log('Tarea eliminada de Firebase', {
            lista: lista.title,
            taskId: task.id,
            titulo: task.title || ''
          });
          return;
        }

        const parsed = parseGoogleTask_(task, lista);
        upsertFirebaseTask_(taskKey, parsed);
        state.tasks[taskKey] = {
          fingerprint: currentFingerprint,
          updated: task.updated || '',
          status: task.status || 'needsAction',
          syncedAt: new Date().toISOString()
        };
        summary.tareasSubidas += 1;
        log('Tarea sincronizada', {
          firebaseKey: taskKey,
          titulo: parsed.tarea,
          contexto: parsed.contexto,
          fecha: parsed.fecha,
          prioridad: parsed.prioridad
        });
      });
    });

    Object.keys(state.tasks).forEach(function(taskKey) {
      if (seenKeys[taskKey]) return;
      deleteFirebaseTask_(taskKey);
      delete state.tasks[taskKey];
      summary.tareasEliminadas += 1;
      log('Tarea removida por ausencia en Google Tasks', { firebaseKey: taskKey });
    });

    state.lastRunStartedAt = startedAt.toISOString();
    state.lastRunCompletedAt = new Date().toISOString();
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
  const triggers = ScriptApp.getProjectTriggers();

  triggers.forEach(function(trigger) {
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
  PropertiesService.getScriptProperties().deleteProperty('GOOGLE_TASKS_SYNC_STATE');
  log('Estado local eliminado');
}

function previewGoogleTasksParsing() {
  const listas = getTaskLists_();
  const preview = [];

  listas.forEach(function(lista) {
    const tareas = getTasksFromList_(lista.id).slice(0, 5);
    tareas.forEach(function(task) {
      preview.push({
        lista: lista.title,
        original: task.title,
        parseado: parseGoogleTask_(task, lista)
      });
    });
  });

  log('Vista previa de parseo', preview);
  return preview;
}

function loadSyncState() {
  const raw = PropertiesService.getScriptProperties().getProperty('GOOGLE_TASKS_SYNC_STATE');
  if (!raw) {
    return {
      tasks: {},
      lastRunStartedAt: '',
      lastRunCompletedAt: '',
      lastRunFailedAt: '',
      lastError: '',
      lastSummary: {}
    };
  }

  try {
    const parsed = JSON.parse(raw);
    parsed.tasks = parsed.tasks || {};
    return parsed;
  } catch (error) {
    log('No se pudo leer el estado anterior, se reinicia', { error: String(error) });
    return {
      tasks: {}
    };
  }
}

function saveSyncState(state) {
  PropertiesService.getScriptProperties().setProperty(
    'GOOGLE_TASKS_SYNC_STATE',
    JSON.stringify(state)
  );
}

function getTaskLists_() {
  if (CONFIG.TASK_LIST_IDS && CONFIG.TASK_LIST_IDS.length > 0) {
    return CONFIG.TASK_LIST_IDS.map(function(listId) {
      const lista = Tasks.Tasklists.get(listId);
      return { id: lista.id, title: lista.title };
    });
  }

  const listas = [];
  let pageToken = null;

  do {
    const response = Tasks.Tasklists.list({
      maxResults: 100,
      pageToken: pageToken
    });

    (response.items || []).forEach(function(item) {
      listas.push({ id: item.id, title: item.title });
    });

    pageToken = response.nextPageToken || null;
  } while (pageToken);

  return listas;
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

function parseGoogleTask_(task, lista) {
  const text = [task.title || '', task.notes || ''].join(' ').trim();
  const subjectMatch = detectContext_(text, lista);
  const taskType = detectTaskType_(text);
  const contexto = subjectMatch.contexto || lista.title || CONFIG.DEFAULT_CONTEXT;
  const prioridad = detectPriority_(text);
  const fecha = detectDate_(task, text);

  return {
    contexto: contexto,
    tarea: cleanTaskTitle_(task.title || task.notes || 'Tarea sin titulo'),
    fecha: fecha,
    prioridad: prioridad,
    origen: 'google_tasks',
    editable: false,
    fuenteId: task.id,
    origenDetalle: 'Google Tasks',
    listaId: lista.id,
    listaNombre: lista.title || '',
    materiaDetectadaPor: subjectMatch.alias || '',
    tipoActividad: taskType.tipo || '',
    tipoActividadAlias: taskType.alias || '',
    taskUpdated: task.updated || '',
    taskStatus: task.status || 'needsAction',
    textoOriginal: text
  };
}

function detectContext_(text, lista) {
  const normalized = normalizeText_(text);
  const candidates = buildSubjectCandidates_(normalized, lista);
  if (candidates.length > 0) return candidates[0];

  const taskType = detectTaskType_(text);
  if (taskType.tipo) {
    return {
      contexto: lista && lista.title ? lista.title : CONFIG.DEFAULT_CONTEXT,
      alias: taskType.alias,
      score: 0
    };
  }

  return { contexto: '', alias: '', score: 0 };
}

function buildSubjectCandidates_(normalizedText, lista) {
  const candidates = [];

  for (let i = 0; i < SUBJECT_RULES.length; i += 1) {
    const rule = SUBJECT_RULES[i];
    for (let j = 0; j < rule.aliases.length; j += 1) {
      const alias = normalizeText_(rule.aliases[j]);
      if (!containsAlias_(normalizedText, alias)) continue;

      candidates.push({
        contexto: rule.contexto,
        alias: alias,
        score: buildAliasScore_(alias, normalizedText, lista)
      });
    }
  }

  candidates.sort(function(a, b) {
    if (b.score !== a.score) return b.score - a.score;
    if (b.alias.length !== a.alias.length) return b.alias.length - a.alias.length;
    return a.contexto.localeCompare(b.contexto);
  });

  return dedupeSubjectCandidates_(candidates);
}

function dedupeSubjectCandidates_(candidates) {
  const seen = {};
  return candidates.filter(function(candidate) {
    if (seen[candidate.contexto]) return false;
    seen[candidate.contexto] = true;
    return true;
  });
}

function containsAlias_(normalizedText, alias) {
  const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp('(^|\\W)' + escaped + '(\\W|$)');
  return regex.test(normalizedText);
}

function buildAliasScore_(alias, normalizedText, lista) {
  let score = alias.length;

  if (/\b(ii|2|i|1)\b/.test(alias)) score += 5;
  if (alias.indexOf(' ') !== -1) score += 3;
  if (lista && lista.title) {
    const normalizedList = normalizeText_(lista.title);
    if (normalizedList.indexOf(alias) !== -1) score += 2;
  }

  if (normalizedText.indexOf(alias) === 0) score += 1;
  return score;
}

function detectTaskType_(text) {
  const normalized = normalizeText_(text);

  for (let i = 0; i < TASK_TYPE_RULES.length; i += 1) {
    const rule = TASK_TYPE_RULES[i];
    for (let j = 0; j < rule.aliases.length; j += 1) {
      const alias = normalizeText_(rule.aliases[j]);
      if (containsAlias_(normalized, alias)) {
        return {
          tipo: rule.tipo,
          alias: alias
        };
      }
    }
  }

  const numberedTp = normalized.match(/\btp\s*\d+\b/);
  if (numberedTp) {
    return {
      tipo: 'trabajo practico',
      alias: numberedTp[0]
    };
  }

  return {
    tipo: '',
    alias: ''
  };
}

function detectPriority_(text) {
  const normalized = normalizeText_(text);
  if (/\b(urgente|alta prioridad|muy importante|asap|critico)\b/.test(normalized)) return 'alta';
  if (/\b(tranquilo|sin apuro|baja prioridad)\b/.test(normalized)) return 'baja';
  return CONFIG.DEFAULT_PRIORITY;
}

function detectDate_(task, text) {
  if (task.due) {
    return formatDateOnly_(new Date(task.due));
  }

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

  if (/\bpasado manana\b/.test(normalized)) {
    return shiftToday_(2, timezone);
  }
  if (/\bmanana\b/.test(normalized)) {
    return shiftToday_(1, timezone);
  }
  if (/\bhoy\b/.test(normalized)) {
    return shiftToday_(0, timezone);
  }

  const weekdayMap = {
    lunes: 1,
    martes: 2,
    miercoles: 3,
    jueves: 4,
    viernes: 5,
    sabado: 6,
    domingo: 0
  };

  const weekdayMatch = normalized.match(/\b(lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/);
  if (weekdayMatch) {
    return nextWeekday_(weekdayMap[weekdayMatch[1]], timezone);
  }

  return '';
}

function cleanTaskTitle_(title) {
  return String(title || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function shouldDeleteImportedTask_(task) {
  if (task.deleted) return true;
  if (!CONFIG.SYNC_ONLY_INCOMPLETE) return false;
  return task.status === 'completed';
}

function buildTaskKey_(listId, taskId) {
  const raw = listId + '__' + taskId;
  return Utilities.base64EncodeWebSafe(raw).replace(/=+$/g, '');
}

function buildFingerprint_(task) {
  return [
    task.title || '',
    task.notes || '',
    task.updated || '',
    task.due || '',
    task.status || '',
    task.deleted ? '1' : '0'
  ].join('||');
}

function upsertFirebaseTask_(firebaseKey, payload) {
  firebaseRequest_(
    CONFIG.FIREBASE_IMPORT_PATH + '/' + encodeURIComponent(firebaseKey),
    'put',
    payload
  );
}

function deleteFirebaseTask_(firebaseKey) {
  firebaseRequest_(
    CONFIG.FIREBASE_IMPORT_PATH + '/' + encodeURIComponent(firebaseKey),
    'delete'
  );
}

function writeSyncStatusToFirebase_(state) {
  firebaseRequest_(
    CONFIG.FIREBASE_STATE_PATH,
    'put',
    {
      lastRunStartedAt: state.lastRunStartedAt || '',
      lastRunCompletedAt: state.lastRunCompletedAt || '',
      lastRunFailedAt: state.lastRunFailedAt || '',
      lastError: state.lastError || '',
      lastSummary: state.lastSummary || {}
    }
  );
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
  if (status >= 200 && status < 300) return;

  throw new Error('Firebase respondio con ' + status + ' para ' + path + ': ' + response.getContentText());
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
  if (yearText.length === 2) return 2000 + year;
  return year;
}

function normalizeText_(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, ' ')
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
