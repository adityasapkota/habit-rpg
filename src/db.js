// IndexedDB wrapper using idb (loaded from CDN, cached by the service worker
// on first online load so the app keeps working offline).
//
// Stores match the schema in 02_DESIGN_DAY1.md.
import { openDB } from 'https://cdn.jsdelivr.net/npm/idb@8/+esm';

const DB_NAME = 'habit-rpg';
const DB_VERSION = 1;

let _dbPromise = null;

export function getDB() {
  if (!_dbPromise) {
    _dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          const habits = db.createObjectStore('habits', { keyPath: 'id' });
          habits.createIndex('archived', 'archived');

          const completions = db.createObjectStore('completions', { keyPath: 'id' });
          completions.createIndex('habitId-date', ['habitId', 'date'], { unique: true });
          completions.createIndex('date', 'date');

          db.createObjectStore('userState', { keyPath: 'id' });

          db.createObjectStore('jars', { keyPath: 'id' });
          const deposits = db.createObjectStore('jarDeposits', { keyPath: 'id' });
          deposits.createIndex('jarId', 'jarId');
        }
      },
      blocked() {
        console.warn('[db] blocked: another tab is holding an old version');
      },
    });
  }
  return _dbPromise;
}

export async function ensureUserState() {
  const db = await getDB();
  const existing = await db.get('userState', 'singleton');
  if (existing) return existing;
  const seed = {
    id: 'singleton',
    totalCoinsEarned: 0,
    coinBalance: 0,
    streakFreezesAvailable: 0,
    notificationsEnabled: false,
    createdAt: Date.now(),
  };
  await db.put('userState', seed);
  return seed;
}

export async function getUserState() {
  const db = await getDB();
  return (await db.get('userState', 'singleton')) || ensureUserState();
}

export async function setUserState(patch) {
  const db = await getDB();
  const current = (await db.get('userState', 'singleton')) || (await ensureUserState());
  const next = { ...current, ...patch };
  await db.put('userState', next);
  return next;
}

export async function resetAllData() {
  if (_dbPromise) {
    try {
      const db = await _dbPromise;
      db.close();
    } catch {}
    _dbPromise = null;
  }
  await new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(new Error('Database delete failed.'));
    req.onblocked = () => reject(new Error(
      'Reset blocked: another tab has the app open. Close it and try again.'
    ));
  });
}

export function newId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}
