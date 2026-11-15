import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { SITES, normalizeImages, type Collection, type Site } from './mission';

async function fetchJSON(url: string) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try { const r = await fetch(url, { signal: AbortSignal.timeout(18000), headers: { Accept: 'application/json' } }); if (!r.ok) throw new Error('Source unavailable'); return await r.json(); } catch (e) { if (attempt === 1) throw e; }
  }
}
export const getImages = createServerFn({ method: 'GET' }).inputValidator(z.object({ site: z.enum(['gale', 'jezero']), sol: z.number().int().min(0).max(20000).nullable(), camera: z.string().max(40), page: z.number().int().min(0).max(10000) })).handler(async ({ data }) => {
  const url = new URL('https://mars.nasa.gov/rss/api/');
  const params: Record<string, string> = { ver: '1.2', feed: 'raw_images', feedtype: 'json', category: SITES[data.site].category, num: '60', page: String(data.page), order: 'sol desc' };
  if (data.sol != null) params['condition_2'] = `${data.sol}:sol:eq`;
  if (data.camera) params['search'] = `|${data.camera}`;
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  try { const raw = await fetchJSON(url.href); if (!Array.isArray(raw.images)) throw new Error('Invalid feed'); return { data: normalizeImages(raw), error: null, source: url.href }; }
  catch {
    if (data.site === 'jezero' && data.sol != null && !data.camera) {
      const fallback = `https://rovers.nebulum.one/api/v1/rovers/perseverance/photos?sol=${data.sol}&page=${data.page + 1}`;
      try { const raw = await fetchJSON(fallback); if (!Array.isArray(raw.photos)) throw new Error('Invalid mirror'); return { data: normalizeImages(raw, 'Nebulum · NASA image mirror'), error: null, source: fallback }; } catch { /* Preserve unavailable state. */ }
    }
    return { data: null, error: 'NASA raw images are unreachable. Retry or use a previously cached Sol.', source: url.href };
  }
});
export const getTraverse = createServerFn({ method: 'GET' }).inputValidator(z.object({ site: z.enum(['gale', 'jezero']) })).handler(async ({ data }) => {
  const m = SITES[data.site as Site].mission, base = `https://mars.nasa.gov/mmgis-maps/${m}/Layers/json/${m}`;
  try { const [route, waypoints] = await Promise.all([fetchJSON(`${base}_traverse.json`), fetchJSON(`${base}_waypoints.json`)]); if (route.type !== 'FeatureCollection' || waypoints.type !== 'FeatureCollection') throw new Error('Invalid mission geometry'); return { data: { route: route as Collection, waypoints: waypoints as Collection }, error: null, source: base }; }
  catch { return { data: null, error: 'NASA traverse is unavailable. No substitute waypoints are shown.', source: base }; }
});
export const getGeology = createServerFn({ method: 'GET' }).inputValidator(z.object({ site: z.enum(['gale', 'jezero']) })).handler(async ({ data }) => {
  const source = 'https://services.arcgis.com/v01gqwM5QqNysAAi/arcgis/rest/services/Tanaka_et_al_2014_Mars_Global_Map_Features/FeatureServer/3';
  const wkt = 'GEOGCS["GCS_Mars_2000_Sphere",DATUM["D_Mars_2000",SPHEROID["Mars_2000",3396190.0,0.0]],PRIMEM["Reference_Meridian",0.0],UNIT["Degree",0.0174532925199433]]';
  const [lon, lat] = SITES[data.site].center;
  const url = new URL(`${source}/query`);
  Object.entries({ f: 'json', where: '1=1', outFields: '*', geometry: `${lon - 0.6},${lat - 0.6},${lon + 0.6},${lat + 0.6}`, geometryType: 'esriGeometryEnvelope', inSR: JSON.stringify({ wkt }), outSR: JSON.stringify({ wkt }), spatialRel: 'esriSpatialRelIntersects', returnGeometry: 'true', maxAllowableOffset: '0.002', resultRecordCount: '1000' }).forEach(([k, v]) => url.searchParams.set(k, v));
  try {
    const [raw, schema] = await Promise.all([fetchJSON(url.href), fetchJSON(`${source}?f=json`)]);
    if (!Array.isArray(raw.features) || raw.error || raw.exceededTransferLimit) throw new Error('Incomplete geology');
    const features = raw.features.flatMap((f: any) => f.geometry?.rings ? [{ type: 'Feature', properties: f.attributes, geometry: { type: 'Polygon', coordinates: f.geometry.rings } }] : []);
    const colors: any[] = ['match', ['get', 'Unit']];
    for (const entry of schema.drawingInfo?.renderer?.uniqueValueInfos ?? []) { const c = entry.symbol?.color; if (Array.isArray(c)) colors.push(entry.value, `rgb(${c[0]},${c[1]},${c[2]})`); }
    colors.push('rgba(0,0,0,0)');
    return { data: { units: { type: 'FeatureCollection', features } as Collection, colors }, error: null, source };
  } catch { return { data: null, error: 'USGS SIM 3292 is unavailable. No inferred geologic units are substituted.', source }; }
});