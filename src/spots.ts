import { distanceMeters } from './geoPoint';
import type { Spot, SpotKind } from './types';

export const SPOT_KINDS: { value: SpotKind; label: string }[] = [
  { value: 'toilet', label: 'トイレ' },
  { value: 'rest', label: '休憩' },
  { value: 'store', label: 'コンビニ' },
  { value: 'parking', label: 'コインパーキング' },
  { value: 'other', label: 'そのほか' },
];

/** お役立ち地点を「近く」とみなす距離(メートル)。 */
export const NEARBY_METERS = 500;

export function spotLabel(kind: SpotKind): string {
  return SPOT_KINDS.find((entry) => entry.value === kind)?.label ?? kind;
}

/**
 * 位置のある訪問先のどれかから NEARBY_METERS 以内の地点を、一番近い距離の順に返す。
 * 位置の無い訪問先は無視する(どの地点からも距離を測れないため)。
 */
export function nearbySpots(
  spots: readonly Spot[],
  stops: readonly { location?: { lat: number; lng: number } }[],
): { spot: Spot; meters: number }[] {
  const points = stops
    .map((stop) => stop.location)
    .filter((location): location is { lat: number; lng: number } => location !== undefined);

  const result: { spot: Spot; meters: number }[] = [];
  for (const spot of spots) {
    let nearest: number | null = null;
    for (const point of points) {
      const meters = distanceMeters(spot.location, point);
      if (nearest === null || meters < nearest) {
        nearest = meters;
      }
    }
    if (nearest !== null && nearest <= NEARBY_METERS) {
      result.push({ spot, meters: nearest });
    }
  }
  return result.sort((a, b) => a.meters - b.meters);
}
