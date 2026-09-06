const DB_NAME = 'ekv-service-offline-v1';
const DB_VERSION = 1;
const MUTATIONS = 'mutations';
const DRAFTS = 'drafts';
const CHANGE_EVENT = 'ekv-service-offline-change';

const requestValue = (request) => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const openDatabase = () => new Promise((resolve, reject) => {
  if (!globalThis.indexedDB) return reject(new Error('Offline úložiště není v tomto prohlížeči dostupné.'));
  const request = indexedDB.open(DB_NAME, DB_VERSION);
  request.onupgradeneeded = () => {
    const database = request.result;
    if (!database.objectStoreNames.contains(MUTATIONS)) {
      const store = database.createObjectStore(MUTATIONS, { keyPath: 'id' });
      store.createIndex('case', 'serviceCaseId');
      store.createIndex('created', 'createdAt');
    }
    if (!database.objectStoreNames.contains(DRAFTS)) database.createObjectStore(DRAFTS, { keyPath: 'key' });
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const transaction = async (storeName, mode, action) => {
  const database = await openDatabase();
  try {
    const tx = database.transaction(storeName, mode);
    const result = await action(tx.objectStore(storeName));
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Offline operace byla přerušena.'));
    });
    return result;
  } finally {
    database.close();
  }
};

const notify = () => globalThis.dispatchEvent?.(new CustomEvent(CHANGE_EVENT));
const clone = (value) => JSON.parse(JSON.stringify(value));

export const serviceDraftKey = (serviceCaseId, visitId = 'new') => `${serviceCaseId}:${visitId || 'new'}`;

export const saveServiceOfflineDraft = async (key, snapshot) => {
  if (!key || !snapshot) return;
  await transaction(DRAFTS, 'readwrite', (store) => requestValue(store.put({ key, snapshot: clone(snapshot), savedAt: new Date().toISOString() })));
  notify();
};

export const loadServiceOfflineDraft = async (key) => transaction(DRAFTS, 'readonly', (store) => requestValue(store.get(key)));

export const removeServiceOfflineDraft = async (key) => {
  await transaction(DRAFTS, 'readwrite', (store) => requestValue(store.delete(key)));
  notify();
};

export const enqueueServiceVisit = async ({ serviceCaseId, visitId = null, payload }) => {
  const clientMutationId = payload.client_mutation_id || crypto.randomUUID();
  const row = {
    id: `visit:${clientMutationId}`,
    kind: 'visit',
    serviceCaseId,
    visitId,
    clientMutationId,
    payload: { ...clone(payload), client_mutation_id: clientMutationId, offline_synced_at: null },
    createdAt: new Date().toISOString(),
    attemptCount: 0,
    lastError: null,
  };
  await transaction(MUTATIONS, 'readwrite', (store) => requestValue(store.put(row)));
  notify();
  return row;
};

export const enqueueServicePhoto = async ({ serviceCaseId, serviceVisitId = null, visitMutationId = null, file }) => {
  const clientMutationId = crypto.randomUUID();
  const row = {
    id: `photo:${clientMutationId}`,
    kind: 'photo',
    serviceCaseId,
    serviceVisitId,
    visitMutationId,
    clientMutationId,
    file,
    fileName: file.name || `foto-${clientMutationId}.jpg`,
    mimeType: file.type || 'image/jpeg',
    sizeBytes: file.size,
    capturedAt: new Date(file.lastModified || Date.now()).toISOString(),
    createdAt: new Date().toISOString(),
    attemptCount: 0,
    lastError: null,
  };
  await transaction(MUTATIONS, 'readwrite', (store) => requestValue(store.put(row)));
  notify();
  return row;
};

const getMutations = () => transaction(MUTATIONS, 'readonly', (store) => requestValue(store.getAll()));

export const getServiceOfflineState = async (serviceCaseId = null) => {
  const rows = (await getMutations()).filter((row) => !serviceCaseId || row.serviceCaseId === serviceCaseId);
  return {
    pending: rows.length,
    visits: rows.filter((row) => row.kind === 'visit').length,
    photos: rows.filter((row) => row.kind === 'photo').length,
    errors: rows.filter((row) => row.lastError).length,
  };
};

const updateMutation = (row) => transaction(MUTATIONS, 'readwrite', (store) => requestValue(store.put(row)));
const deleteMutation = (id) => transaction(MUTATIONS, 'readwrite', (store) => requestValue(store.delete(id)));

export const syncServiceOfflineQueue = async ({ supabase, serviceCaseId = null, onProgress }) => {
  if (!navigator.onLine) return { synced: 0, failed: 0, offline: true };
  const allRows = (await getMutations()).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  const rows = allRows.filter((row) => !serviceCaseId || row.serviceCaseId === serviceCaseId);
  let synced = 0;
  let failed = 0;
  const resolvedVisitIds = new Map();
  for (const row of rows) {
    try {
      if (row.kind === 'visit') {
        const payload = { ...row.payload, offline_synced_at: new Date().toISOString() };
        const query = row.visitId
          ? supabase.from('service_visits').update(payload).eq('id', row.visitId).select('id').single()
          : supabase.from('service_visits').upsert(payload, { onConflict: 'client_mutation_id' }).select('id').single();
        const { data, error } = await query;
        if (error) throw error;
        resolvedVisitIds.set(row.clientMutationId, data.id);
        const dependentPhotos = allRows.filter((item) => item.kind === 'photo' && item.visitMutationId === row.clientMutationId && !item.serviceVisitId);
        await Promise.all(dependentPhotos.map((item) => updateMutation({ ...item, serviceVisitId: data.id })));
      } else if (row.kind === 'photo') {
        const { data: existing, error: existingError } = await supabase.from('service_attachments')
          .select('id').eq('client_mutation_id', row.clientMutationId).maybeSingle();
        if (existingError) throw existingError;
        if (!existing) {
          const safeName = String(row.fileName).replace(/[^a-zA-Z0-9._-]+/g, '_');
          const resolvedVisitId = row.serviceVisitId || resolvedVisitIds.get(row.visitMutationId) || null;
          const path = `${row.serviceCaseId}/${resolvedVisitId || 'case'}/${row.clientMutationId}-${safeName}`;
          const { error: uploadError } = await supabase.storage.from('service-photos').upload(path, row.file, { contentType: row.mimeType, upsert: true });
          if (uploadError) throw uploadError;
          const { error: insertError } = await supabase.from('service_attachments').upsert({
            service_case_id: row.serviceCaseId,
            service_visit_id: resolvedVisitId,
            category: 'during',
            file_name: row.fileName,
            storage_path: path,
            mime_type: row.mimeType,
            size_bytes: row.sizeBytes,
            captured_at: row.capturedAt,
            client_mutation_id: row.clientMutationId,
          }, { onConflict: 'client_mutation_id' });
          if (insertError) throw insertError;
        }
      }
      await deleteMutation(row.id);
      synced += 1;
      onProgress?.({ row, status: 'synced' });
    } catch (error) {
      failed += 1;
      await updateMutation({ ...row, attemptCount: Number(row.attemptCount || 0) + 1, lastError: error.message || String(error) });
      onProgress?.({ row, status: 'error', error });
    }
  }
  notify();
  return { synced, failed, offline: false };
};

export const compressServicePhoto = async (file, { maxDimension = 1920, quality = 0.82 } = {}) => {
  if (!file?.type?.startsWith('image/') || file.type === 'image/svg+xml') return file;
  const bitmap = await createImageBitmap(file);
  const ratio = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
  canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  if (!blob || blob.size >= file.size) return file;
  return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg', lastModified: file.lastModified });
};

export const subscribeServiceOfflineState = (listener) => {
  const handler = () => listener();
  globalThis.addEventListener?.(CHANGE_EVENT, handler);
  globalThis.addEventListener?.('online', handler);
  globalThis.addEventListener?.('offline', handler);
  return () => {
    globalThis.removeEventListener?.(CHANGE_EVENT, handler);
    globalThis.removeEventListener?.('online', handler);
    globalThis.removeEventListener?.('offline', handler);
  };
};

export const clearServiceOfflineData = async () => {
  if (!globalThis.indexedDB) return;
  await new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = request.onerror = request.onblocked = resolve;
  });
};
