import { describe, expect, it } from 'vitest';
import { eqTileAt, nasaImage, normalizeImages, photoLocation, photoClusters, routeProfile, type Collection, type Photo } from './mission';
describe('real mission source rules', () => {
  it('accepts NASA HTTPS image URLs, rejects placeholder and non-NASA URLs', () => {
    expect(nasaImage('https://mars.nasa.gov/real-frame.png')).toBe('https://mars.nasa.gov/real-frame.png');
    expect(nasaImage('https://example.com/placeholder.jpg')).toBe('');
    expect(nasaImage('http://mars.nasa.gov/frame.jpg')).toBe('');
  });
  it('uses the archive count supplied by NASA rather than the requested 1,070,000 claim', () => {
    expect(normalizeImages({ total_images: 1055868, images: [] }).total).toBe(1055868);
    expect(normalizeImages({ images: [] }).total).toBeNull();
  });
  it('maps native NASA EQ zoom zero to a 2 by 1 tile matrix', () => {
    expect(eqTileAt(0, 137.4, -4.6)).toEqual({ x: 1, y: 0 });
    expect(eqTileAt(0, -90, 30)).toEqual({ x: 0, y: 0 });
    expect(eqTileAt(1, 77.45, 18.44)).toEqual({ x: 2, y: 0 });
  });
  const waypoints: Collection = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { site: 93, drive: 0 }, geometry: { type: 'Point', coordinates: [77.23322287, 18.43559434, -1936.366943] } }] };
  const photo = { id: 'real-frame', site: 93, drive: 0, sol: 2031 } as Photo;
  it('localizes photos only by an exact mission site and drive match, never by nearby Sol', () => {
    expect(photoLocation(photo, waypoints)?.geometry.coordinates).toEqual([77.23322287, 18.43559434, -1936.366943]);
    expect(photoLocation({ ...photo, drive: 1 }, waypoints)).toBeUndefined();
    expect(photoLocation({ ...photo, site: null }, waypoints)).toBeUndefined();
  });
  it('aggregates exact same-location frames without fabricating unmatched markers', () => {
    const groups = photoClusters([photo, { ...photo, id: 'second' }, { ...photo, drive: 5 }], waypoints);
    expect(groups.features).toHaveLength(1);
    expect(groups.features[0].properties.count).toBe(2);
  });
  it('preserves real elevations and treats missing or sentinel elevations as unavailable', () => {
    const result = routeProfile({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[137.4, -4.6, -4180], [137.401, -4.6], [137.402, -4.6, -9999]] } }] });
    expect(result.map(p => p.elevation)).toEqual([-4180, null, null]);
    expect(result[1].distance).toBeCloseTo(59.08, 1);
  });
});