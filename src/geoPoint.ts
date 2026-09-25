export const GOOD_ACCURACY_M = 20;
export const POOR_ACCURACY_M = 50;

type LatLng = { lat: number; lng: number };

function valid(lat: number, lng: number): LatLng | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

const NUM = '(-?\\d{1,3}(?:\\.\\d+)?)';

export function isShortMapsUrl(text: string): boolean {
  return /(^|\/\/)(maps\.app\.goo\.gl|goo\.gl\/maps)\//.test(text.trim());
}

/** 「35.68, 139.76」、Googleマップの長いURL(@lat,lng / !3dlat!4dlng / q= または query=lat,lng)から座標を読む。読めなければ null。短いURL(maps.app.goo.gl / goo.gl/maps)は null。 */
export function parseLocationText(text: string): LatLng | null {
  const raw = text.trim();
  if (raw === '' || isShortMapsUrl(raw)) return null;
  let decoded = raw;
  try { decoded = decodeURIComponent(raw); } catch { /* そのまま使う */ }
  const patterns = [
    new RegExp(`!3d${NUM}!4d${NUM}`),
    new RegExp(`@${NUM},${NUM}`),
    new RegExp(`[?&](?:q|query)=${NUM},\\s*${NUM}`),
    new RegExp(`^${NUM}\\s*,\\s*${NUM}$`),
  ];
  for (const pattern of patterns) {
    const match = decoded.match(pattern);
    if (match) return valid(Number(match[1]), Number(match[2]));
  }
  return null;
}

/** 2点間の距離(メートル、ハバースイン)。 */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** 地図に渡す地点。位置があれば '35.681240,139.767120'(小数6桁)、なければ住所。 */
export function pointOf(stop: { address: string; location?: LatLng }): string {
  return stop.location ? `${stop.location.lat.toFixed(6)},${stop.location.lng.toFixed(6)}` : stop.address;
}

/** 'good'(20m以内)/ 'fair' / 'poor'(50m以上)。 */
export function accuracyLevel(accuracy: number): 'good' | 'fair' | 'poor' {
  if (accuracy <= GOOD_ACCURACY_M) return 'good';
  if (accuracy >= POOR_ACCURACY_M) return 'poor';
  return 'fair';
}
