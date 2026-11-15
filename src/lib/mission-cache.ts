import { getNASAImage } from './mission.functions';
const DB = 'ares-real-mission-v1';
type Entry<T> = { value: T; saved: number };
function openDB(): Promise<IDBDatabase> { return new Promise((resolve, reject) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore('responses'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); }
export async function readCache<T>(key: string): Promise<Entry<T> | undefined> {
  try { const db = await openDB(); return await new Promise((resolve, reject) => { const r = db.transaction('responses').objectStore('responses').get(key); r.onsuccess = () => { db.close(); resolve(r.result); }; r.onerror = () => { db.close(); reject(r.error); }; }); } catch { return undefined; }
}
export async function writeCache<T>(key: string, value: T) {
  try { const db = await openDB(); await new Promise<void>((resolve, reject) => { const tx = db.transaction('responses', 'readwrite'); tx.objectStore('responses').put({ value, saved: Date.now() }, key); tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => { db.close(); reject(tx.error); }; }); } catch { /* Storage denied or quota reached: network remains usable. */ }
}
export async function cachedBlob(url: string, signal?: AbortSignal): Promise<Blob> {
  const hit = await readCache<Blob>(url); if (hit) return hit.value;
  let blob: Blob;
  if (new URL(url).hostname === 'mars.nasa.gov') {
    const image = await getNASAImage({ data: { url } });
    const bytes = Uint8Array.from(atob(image.base64), c => c.charCodeAt(0)); blob = new Blob([bytes], { type: image.type });
  } else { const r = await fetch(url, { signal: signal ?? null }); if (!r.ok) throw new Error(`NASA tile unavailable (${r.status})`); blob = await r.blob(); }
  await writeCache(url, blob); return blob;
}