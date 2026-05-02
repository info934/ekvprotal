// Simple IndexedDB wrapper for storing backup files since localStorage is too small (5MB limit)
const DB_NAME = 'AppBackupsDB';
const STORE_NAME = 'backups';
const DB_VERSION = 1;

const openDB = () => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = (event) => reject('IndexedDB error: ' + event.target.error);

    request.onsuccess = (event) => resolve(event.target.result);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'filename' });
      }
    };
  });
};

export const saveBackupToBrowser = async (backupDataString, filename) => {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    
    const backupItem = {
      filename,
      data: backupDataString,
      createdAt: new Date().toISOString(),
      size: new Blob([backupDataString]).size
    };

    return new Promise((resolve, reject) => {
      const request = store.put(backupItem);
      request.onsuccess = () => resolve(backupItem);
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('Failed to save to IndexedDB:', error);
    // Fallback logic could go here, but for now we just log it.
    // We still return the item metadata so UI can try to show it (even if content save failed)
    return {
      filename,
      createdAt: new Date().toISOString(),
      size: new Blob([backupDataString]).size,
      error: 'Storage failed'
    };
  }
};

export const getBackupsList = async () => {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);

    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => {
        // Return only metadata to keep UI lightweight
        const backups = request.result.map(item => ({
          filename: item.filename,
          createdAt: item.createdAt,
          size: item.size
        }));
        // Sort by date desc
        resolve(backups.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
      };
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('Error fetching backups list:', error);
    return [];
  }
};

export const getBackupContent = async (filename) => {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);

    return new Promise((resolve, reject) => {
      const request = store.get(filename);
      request.onsuccess = () => resolve(request.result?.data);
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('Error fetching backup content:', error);
    return null;
  }
};

export const deleteBackup = async (filename) => {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    return new Promise((resolve, reject) => {
      const request = store.delete(filename);
      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('Error deleting backup:', error);
    return false;
  }
};

export const triggerDownload = (jsonString, filename) => {
  const blob = new Blob([jsonString], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

export const downloadBackup = async (filename) => {
  const content = await getBackupContent(filename);
  if (content) {
    triggerDownload(content, filename);
    return true;
  }
  return false;
};