// GeoJSON 좌표는 [lng, lat] 순서다

const polygonsOf = (geometry) => (geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates);

function inRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// 첫 링은 외곽, 나머지는 구멍
const inPolygon = (lng, lat, [outer, ...holes]) => inRing(lng, lat, outer) && !holes.some((h) => inRing(lng, lat, h));

export const inFeature = (lng, lat, feature) => polygonsOf(feature.geometry).some((p) => inPolygon(lng, lat, p));

export function bboxOf(features) {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  for (const f of features) {
    for (const poly of polygonsOf(f.geometry)) {
      for (const [lng, lat] of poly[0]) {
        if (lng < b[0]) b[0] = lng;
        if (lat < b[1]) b[1] = lat;
        if (lng > b[2]) b[2] = lng;
        if (lat > b[3]) b[3] = lat;
      }
    }
  }
  return b;
}

export function distance(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}
