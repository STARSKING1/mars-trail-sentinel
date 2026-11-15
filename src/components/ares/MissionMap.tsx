import { useEffect, useRef, useState } from 'react';
import type { Map as GLMap, GeoJSONSource } from 'maplibre-gl';
import { Crosshair, Minus, Plus, RotateCcw, Satellite } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { trekTile } from '@/lib/trek-protocol';
import { SITES, TILE_LAYERS, emptyCollection, photoClusters, type BaseLayer, type Collection, type Photo, type Site } from '@/lib/mission';

type Props = { site: Site; layer: BaseLayer; route: Collection; waypoints: Collection; photos: Photo[]; geology: Collection; geologyOn: boolean; geologyColors: unknown[]; tilt: boolean; flying: boolean; target: [number, number] | null; focus: [number, number] | null; retry: number; onPhoto: (photo: Photo) => void; onStop: (feature: Record<string, unknown>) => void; onFlyEnd: () => void };
export default function MissionMap(p: Props) {
  const el = useRef<HTMLDivElement>(null), map = useRef<GLMap | null>(null), latest = useRef(p); latest.current = p;
  const [ready, setReady] = useState(false), [error, setError] = useState<string | null>(null), [coord, setCoord] = useState(''), [scale, setScale] = useState('');
  useEffect(() => {
    let cancelled = false; let instance: GLMap | undefined;
    void import('maplibre-gl').then(gl => {
      if (cancelled || !el.current) return;
      gl.addProtocol('trek', async (params, controller) => ({ data: await trekTile(params.url, controller.signal) }));
      const m = new gl.Map({ container: el.current, center: SITES[latest.current.site].center, zoom: 10, maxZoom: 19, attributionControl: false, style: { version: 8, sources: {}, layers: [{ id: 'space', type: 'background', paint: { 'background-color': getComputedStyle(document.documentElement).getPropertyValue('--background').trim() } }] } });
      instance = m; map.current = m;
      m.on('load', () => {
        for (const id of ['color', 'mola', 'ctx'] as BaseLayer[]) {
          m.addSource(id, { type: 'raster', tiles: [`trek://${id}/{z}/{x}/{y}`], tileSize: 256, maxzoom: TILE_LAYERS[id].max + 1, attribution: 'NASA/JPL-Caltech · Mars Trek' });
          m.addLayer({ id, type: 'raster', source: id, layout: { visibility: id === 'color' ? 'visible' : 'none' }, paint: { 'raster-fade-duration': 200 } });
        }
        m.addSource('geology', { type: 'geojson', data: emptyCollection() as any });
        m.addLayer({ id: 'geology-fill', type: 'fill', source: 'geology', paint: { 'fill-color': getComputedStyle(document.documentElement).getPropertyValue('--primary').trim(), 'fill-opacity': 0.35 } });
        m.addSource('route', { type: 'geojson', data: emptyCollection() as any });
        const tokens = getComputedStyle(document.documentElement), cyan = tokens.getPropertyValue('--accent').trim(), ochre = tokens.getPropertyValue('--primary').trim();
        m.addLayer({ id: 'route-halo', type: 'line', source: 'route', paint: { 'line-color': tokens.getPropertyValue('--background').trim(), 'line-width': 7 } });
        m.addLayer({ id: 'route-line', type: 'line', source: 'route', paint: { 'line-color': cyan, 'line-width': 2.5 } });
        m.addSource('stops', { type: 'geojson', data: emptyCollection() as any });
        m.addLayer({ id: 'stops', type: 'circle', source: 'stops', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 1, 14, 4], 'circle-color': ochre, 'circle-stroke-color': cyan, 'circle-stroke-width': 1 } });
        m.addSource('photos', { type: 'geojson', data: emptyCollection() as any });
        m.addLayer({ id: 'photos', type: 'circle', source: 'photos', paint: { 'circle-color': cyan, 'circle-radius': ['interpolate', ['linear'], ['get', 'count'], 1, 7, 60, 15], 'circle-stroke-color': ochre, 'circle-stroke-width': 2 } });
        m.addSource('focus', { type: 'geojson', data: emptyCollection() as any });
        m.addLayer({ id: 'focus', type: 'circle', source: 'focus', paint: { 'circle-radius': 9, 'circle-color': cyan, 'circle-opacity': 0.2, 'circle-stroke-color': cyan, 'circle-stroke-width': 2 } });
        m.on('click', 'photos', e => { const id = e.features?.[0]?.properties?.['imageId']; const photo = latest.current.photos.find(q => q.id === id); if (photo) latest.current.onPhoto(photo); });
        m.on('click', 'stops', e => { if (e.features?.[0]) latest.current.onStop(e.features[0].properties); });
        m.on('click', 'geology-fill', e => { if (latest.current.geologyOn && e.features?.[0]) latest.current.onStop({ ...e.features[0].properties, geology: true }); });
        m.on('mousemove', e => setCoord(`${e.lngLat.lat.toFixed(5)}°N  ${e.lngLat.lng.toFixed(5)}°E`));
        m.on('move', () => { const b = m.getBounds(), lat = m.getCenter().lat * Math.PI / 180, km = (b.getEast() - b.getWest()) * Math.PI / 180 * 3396.19 * Math.cos(lat) * 100 / Math.max(1, m.getCanvas().clientWidth); setScale(km >= 1 ? `${km.toFixed(1)} km` : `${Math.round(km * 1000)} m`); });
        setReady(true);
      });
      m.on('error', () => setError('A NASA tile could not load. Cached coverage remains visible.'));
      m.on('idle', () => { if (m.areTilesLoaded()) setError(null); });
    }).catch(() => setError('Map engine unavailable. Retry loading the map.'));
    return () => { cancelled = true; instance?.remove(); map.current = null; };
  }, []);
  useEffect(() => { const m = map.current; if (!m || !ready) return; setError(null); for (const id of ['color', 'mola', 'ctx']) m.setLayoutProperty(id, 'visibility', id === 'color' || id === p.layer ? 'visible' : 'none'); m.flyTo({ center: SITES[p.site].center, zoom: 10, pitch: 0, duration: 1800 }); }, [p.site, ready]);
  useEffect(() => { const m = map.current; if (!m || !ready) return; for (const id of ['color', 'mola', 'ctx']) m.setLayoutProperty(id, 'visibility', id === 'color' || id === p.layer ? 'visible' : 'none'); }, [p.layer, ready]);
  useEffect(() => { const m = map.current; if (!m || !ready) return; const set = (id: string, data: Collection) => (m.getSource(id) as GeoJSONSource)?.setData(data as any); set('route', p.route); set('stops', p.waypoints); set('photos', photoClusters(p.photos, p.waypoints)); set('geology', p.geology); m.setLayoutProperty('geology-fill', 'visibility', p.geologyOn ? 'visible' : 'none'); if (p.geologyColors.length) m.setPaintProperty('geology-fill', 'fill-color', p.geologyColors as any); }, [p.route, p.waypoints, p.photos, p.geology, p.geologyOn, p.geologyColors, ready]);
  useEffect(() => { map.current?.easeTo({ pitch: p.tilt ? 60 : 0, bearing: p.tilt ? -20 : 0, duration: 1400 }); }, [p.tilt, ready]);
  useEffect(() => { if (p.target) map.current?.flyTo({ center: p.target, zoom: 12, duration: 2000 }); }, [p.target, ready]);
  useEffect(() => { const m = map.current; if (!m || !ready) return; (m.getSource('focus') as GeoJSONSource)?.setData(p.focus ? { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: p.focus } } : emptyCollection() as any); }, [p.focus, ready]);
  useEffect(() => { if (p.retry && map.current) { setError(null); for (const id of ['color', 'mola', 'ctx']) { const source = map.current.getSource(id) as any; source?.setTiles([`trek://${id}/{z}/{x}/{y}`]); } } }, [p.retry]);
  useEffect(() => {
    const m = map.current; if (!m || !ready) return; if (!p.flying) { m.stop(); return; }
    const coords = p.waypoints.features.filter(f => f.geometry.type === 'Point').map(f => f.geometry.coordinates as [number, number]);
    if (!coords.length) { p.onFlyEnd(); return; }
    const step = Math.max(1, Math.floor(coords.length / 25)); let k = 0;
    const tick = () => { if (k >= coords.length) { latest.current.onFlyEnd(); return; } m.flyTo({ center: coords[k], zoom: 14, pitch: 60, bearing: k * 6, duration: 1700 }); k += step; };
    tick(); const timer = setInterval(tick, 1800); return () => { clearInterval(timer); m.stop(); };
  }, [p.flying, p.waypoints, ready]);
  return <div className="mission-map relative h-full min-h-[420px] bg-background"><div ref={el} className="absolute inset-0 h-full w-full" aria-label="NASA Mars Trek mission map" />
    {!ready && <div className="absolute inset-0 grid place-items-center font-mono text-xs text-accent"><Satellite className="mr-2 inline size-4" />CONNECTING TO MARS TREK…</div>}
    {error && <div role="status" className="absolute bottom-12 left-3 right-16 border border-warning/50 bg-background/90 p-2 text-xs text-warning">{error}</div>}
    <div className="absolute right-4 top-4 flex flex-col gap-1 rounded-md border border-border bg-background/85 p-1 backdrop-blur">
      <Button variant="ghost" size="icon" title="Zoom in" aria-label="Zoom in" onClick={() => map.current?.zoomIn()}><Plus /></Button>
      <Button variant="ghost" size="icon" title="Zoom out" aria-label="Zoom out" onClick={() => map.current?.zoomOut()}><Minus /></Button>
      <Button variant="ghost" size="icon" title="Fit rover traverse" aria-label="Fit rover traverse" onClick={() => { const points = p.waypoints.features.map(f => f.geometry.coordinates as number[]); if (!points.length) return; map.current?.fitBounds([[Math.min(...points.map(c => c[0])), Math.min(...points.map(c => c[1]))], [Math.max(...points.map(c => c[0])), Math.max(...points.map(c => c[1]))]], { padding: 60, duration: 1200 }); }}><Crosshair /></Button>
      <Button variant="ghost" size="icon" title="North up" aria-label="North up" onClick={() => map.current?.resetNorthPitch()}><RotateCcw /></Button>
    </div>
    <div className="pointer-events-none absolute bottom-3 left-4 bg-background/75 px-2 py-1 font-mono text-[10px] text-foreground">{coord || 'PLANETOCENTRIC · EAST POSITIVE'}{scale && <span className="ml-4">├──────┤ {scale}</span>}</div>
    <a className="absolute bottom-3 right-4 bg-background/75 px-2 py-1 text-[10px] text-muted-foreground" href="https://trek.nasa.gov/mars/" target="_blank" rel="noreferrer">NASA/JPL · Mars Trek ↗</a>
  </div>;
}