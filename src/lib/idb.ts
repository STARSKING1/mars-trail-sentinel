import { generateTerrain, SEED, type Terrain } from "./terrain";
const DB = "ares-nav", STORE = "spatial", KEY = `gale-boxwork-v1-${SEED}`;

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
/** Load terrain from the IndexedDB spatial cache, generating + caching on first run. */
export async function loadTerrain(): Promise<{ terrain: Terrain; source: "cache" | "generated" }> {
  try {
    const db = await open();
    const hit = await new Promise<Terrain | undefined>((res) => { const q = db.transaction(STORE).objectStore(STORE).get(KEY); q.onsuccess = () => res(q.result); q.onerror = () => res(undefined); });
    if (hit?.elev) return { terrain: hit, source: "cache" };
    const terrain = generateTerrain();
    await new Promise((res) => { const tx = db.transaction(STORE, "readwrite"); tx.objectStore(STORE).put(terrain, KEY); tx.oncomplete = res; tx.onerror = res; });
    return { terrain, source: "generated" };
  } catch { return { terrain: generateTerrain(), source: "generated" }; }
}
export async function clearCache() { const db = await open(); db.transaction(STORE, "readwrite").objectStore(STORE).clear(); }
