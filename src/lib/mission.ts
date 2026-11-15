export type Site = 'gale' | 'jezero';
export type BaseLayer = 'color' | 'ctx' | 'mola';
export const SITES = {
  gale: { name: 'Gale Crater', region: 'Lower Mount Sharp · Boxwork Ridge', rover: 'Curiosity', mission: 'MSL', category: 'msl', center: [137.4, -4.6] as [number, number] },
  jezero: { name: 'Jezero Crater', region: 'Neretva Vallis · Delta Front', rover: 'Perseverance', mission: 'M20', category: 'mars2020', center: [77.45, 18.44] as [number, number] },
} as const;
export const TILE_LAYERS = {
  color: { name: 'Viking global color', id: 'Mars_Viking_MDIM21_ClrMosaic_global_232m', ext: 'jpg', max: 7 },
  ctx: { name: 'Gale CTX mosaic', id: 'Gale_CTX_BlockAdj_dd', ext: 'png', max: 13 },
  mola: { name: 'MOLA shaded relief', id: 'Mars_MGS_MOLA_ClrShade_merge_global_463m', ext: 'jpg', max: 6 },
} as const;
export type Feature = { type: 'Feature'; properties: Record<string, unknown>; geometry: { type: string; coordinates: any } };
export type Collection = { type: 'FeatureCollection'; features: Feature[] };
export const emptyCollection = (): Collection => ({ type: 'FeatureCollection', features: [] });
export type Photo = { id: string; sol: number; camera: string; date: string; thumb: string; full: string; credit: string; caption: string; site: number | null; drive: number | null; telemetry: Record<string, unknown> };
export type ImageFeed = { photos: Photo[]; total: number | null; matches: number | null; latest: number | null; provider: string };
export function nasaImage(value: unknown): string {
  if (typeof value !== 'string') return '';
  try { const u = new URL(value); return u.protocol === 'https:' && (u.hostname === 'mars.nasa.gov' || u.hostname.endsWith('.nasa.gov')) ? u.href : ''; } catch { return ''; }
}
export function normalizeImages(raw: any, provider = 'NASA JPL'): ImageFeed {
  const rows = Array.isArray(raw.images) ? raw.images : Array.isArray(raw.photos) ? raw.photos : [];
  const photos: Photo[] = rows.flatMap((r: any) => {
    const full = nasaImage(r.image_files?.full_res ?? r.img_src), thumb = nasaImage(r.image_files?.small ?? r.img_src);
    if (!full || !thumb || !Number.isFinite(Number(r.sol))) return [];
    return [{ id: String(r.imageid ?? r.id), sol: Number(r.sol), camera: String(r.camera?.instrument ?? r.camera?.name ?? 'Unknown'), date: String(r.date_taken_utc ?? r.earth_date ?? ''), thumb, full, credit: String(r.credit ?? 'NASA/JPL-Caltech'), caption: String(r.caption ?? ''), site: r.site == null ? null : Number(r.site), drive: r.drive == null ? null : Number(r.drive), telemetry: { ...r.extended, model: r.camera?.camera_model_type, position: r.camera?.camera_position, filter: r.camera?.filter_name } }];
  });
  return { photos, total: Number.isFinite(Number(raw.total_images)) ? Number(raw.total_images) : null, matches: Number.isFinite(Number(raw.total_results)) ? Number(raw.total_results) : null, latest: photos.length ? Math.max(...photos.map(p => p.sol)) : null, provider };
}
export function photoLocation(photo: Photo, waypoints: Collection): Feature | undefined {
  if (photo.site == null || photo.drive == null) return undefined;
  return waypoints.features.find(f => Number(f.properties.site) === photo.site && Number(f.properties.drive) === photo.drive && f.geometry.type === 'Point');
}
export function photoClusters(photos: Photo[], waypoints: Collection): Collection {
  const groups = new Map<string, Feature>();
  for (const p of photos) { const w = photoLocation(p, waypoints); if (!w) continue; const key = `${p.site}_${p.drive}`; const group = groups.get(key); if (group) group.properties.count = Number(group.properties.count) + 1; else groups.set(key, { type: 'Feature', geometry: w.geometry, properties: { count: 1, imageId: p.id, sol: p.sol, site: p.site, drive: p.drive } }); }
  return { type: 'FeatureCollection', features: [...groups.values()] };
}
export function routeProfile(route: Collection): { distance: number; elevation: number | null; lon: number; lat: number }[] {
  const output: ReturnType<typeof routeProfile> = []; let distance = 0; let previous: number[] | undefined;
  for (const f of route.features) {
    const lines = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : [];
    for (const line of lines) for (const c of line as number[][]) {
      if (previous) { const rad = Math.PI / 180; const dl = (c[0] - previous[0]) * rad, da = (c[1] - previous[1]) * rad; const h = Math.sin(da / 2) ** 2 + Math.cos(c[1] * rad) * Math.cos(previous[1] * rad) * Math.sin(dl / 2) ** 2; distance += 2 * 3396190 * Math.asin(Math.sqrt(Math.min(1, h))); }
      output.push({ distance, elevation: Number.isFinite(c[2]) && c[2] > -9000 ? c[2] : null, lon: c[0], lat: c[1] }); previous = c;
    }
  }
  return output;
}
export function eqTileAt(z: number, lon: number, lat: number) {
  const height = 2 ** z, width = height * 2;
  return { x: Math.min(width - 1, Math.max(0, Math.floor((lon + 180) / 360 * width))), y: Math.min(height - 1, Math.max(0, Math.floor((90 - lat) / 180 * height))) };
}