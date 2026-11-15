import { cachedBlob } from './mission-cache';
import { TILE_LAYERS, eqTileAt, type BaseLayer } from './mission';

// Reproject NASA's 2:1 EPSG:104905 EQ matrix into MapLibre's 1:1 Mercator matrix.
// Only the pixels are resampled; no relief, elevations or imagery are fabricated.
export async function trekTile(url: string, signal: AbortSignal): Promise<ArrayBuffer> {
  const match = url.match(/^trek:\/\/(color|ctx|mola)\/(\d+)\/(\d+)\/(\d+)$/);
  if (!match) throw new Error('Invalid Trek tile');
  const layer = TILE_LAYERS[match[1] as BaseLayer], z = Number(match[2]), x = Number(match[3]), y = Number(match[4]);
  const sourceZ = Math.min(layer.max, Math.max(0, z - 1)), h = 2 ** sourceZ, w = h * 2, dim = 256;
  const samples = new Map<string, { x: number; y: number }>();
  const location = (px: number, py: number) => {
    const lon = (x + (px + 0.5) / dim) / 2 ** z * 360 - 180;
    const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + (py + 0.5) / dim) / 2 ** z))) * 180 / Math.PI;
    const tile = eqTileAt(sourceZ, lon, lat);
    return { ...tile, px: Math.min(255, Math.floor(((lon + 180) / 360 * w - tile.x) * dim)), py: Math.min(255, Math.floor(((90 - lat) / 180 * h - tile.y) * dim)) };
  };
  for (let py = 0; py < dim; py++) for (let px = 0; px < dim; px++) { const l = location(px, py); samples.set(`${l.x}/${l.y}`, l); }
  const pixels = new Map<string, Uint8ClampedArray>();
  const entries = [...samples.entries()];
  // Bound NASA tile concurrency, including at high Mercator latitudes.
  for (let i = 0; i < entries.length; i += 4) await Promise.all(entries.slice(i, i + 4).map(async ([key, tile]) => {
    const uri = `https://trek.nasa.gov/tiles/Mars/EQ/${layer.id}/1.0.0/default/default028mm/${sourceZ}/${tile.y}/${tile.x}.${layer.ext}`;
    const blob = await cachedBlob(uri, signal), bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(dim, dim), ctx = canvas.getContext('2d');
    if (!ctx) { bitmap.close(); throw new Error('Tile rendering unavailable'); }
    ctx.drawImage(bitmap, 0, 0, dim, dim); bitmap.close(); pixels.set(key, ctx.getImageData(0, 0, dim, dim).data);
  }));
  const canvas = new OffscreenCanvas(dim, dim), ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Tile rendering unavailable');
  const output = ctx.createImageData(dim, dim);
  for (let py = 0; py < dim; py++) for (let px = 0; px < dim; px++) {
    const l = location(px, py), source = pixels.get(`${l.x}/${l.y}`); if (!source) continue;
    const a = (l.py * dim + l.px) * 4, b = (py * dim + px) * 4; output.data.set(source.subarray(a, a + 4), b);
  }
  ctx.putImageData(output, 0, 0); return (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer();
}