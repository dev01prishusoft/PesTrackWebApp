const IDB_NAME = 'pt_photo_db_v1';
const IDB_STORE = 'photos';

export function openPhotoDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = (e) => resolve((e.target as IDBOpenDBRequest).result);
    req.onerror = (e) => reject((e.target as IDBOpenDBRequest).error);
  });
}

export async function savePhotosToIdb(findings: any[]): Promise<void> {
  try {
    const db = await openPhotoDb();
    const tx = db.transaction(IDB_STORE, 'readwrite');
    const store = tx.objectStore(IDB_STORE);
    store.clear();
    findings.forEach((loc) => {
      loc.visits.forEach((v: any) => {
        if (v.photos && v.photos.length) {
          store.put(v.photos, v.visitId);
        }
      });
    });
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.warn('IDB photo save failed:', e);
  }
}

export async function loadPhotosFromIdb(findings: any[]): Promise<void> {
  try {
    const db = await openPhotoDb();
    const tx = db.transaction(IDB_STORE, 'readonly');
    const store = tx.objectStore(IDB_STORE);
    const photoMap: Record<string, string[]> = {};
    await new Promise<void>((resolve, reject) => {
      const req = store.openCursor();
      req.onsuccess = (e) => {
        const cursor = (e.target as IDBRequest<IDBCursorWithValue | null>).result;
        if (cursor) {
          photoMap[cursor.key as string] = cursor.value;
          cursor.continue();
        } else {
          resolve();
        }
      };
      req.onerror = () => reject(req.error);
    });
    findings.forEach((loc) => {
      loc.visits.forEach((v: any) => {
        if (photoMap[v.visitId]) {
          v.photos = photoMap[v.visitId];
        }
      });
    });
  } catch (e) {
    console.warn('IDB photo load failed:', e);
  }
}
