import { splitIntoRoutes } from './routeSplitter';

export type Office = { name: string; address: string };
export type RouteStart = 'office' | 'current' | 'first';
export type RouteEnd = 'office' | 'last';
export type RouteEnds = { start: RouteStart; end: RouteEnd };

export const DEFAULT_ROUTE_ENDS: RouteEnds = { start: 'first', end: 'last' };

export type RouteContext = { ends: RouteEnds; office: Office | null };

/** 事業所が未登録なら、事業所を使う指定は「1件目の訪問先から」「最後の訪問先で終わる」に読み替える。 */
function effectiveEnds(ends: RouteEnds, office: Office | null): RouteEnds {
  if (office !== null) {
    return ends;
  }
  return { start: ends.start === 'office' ? 'first' : ends.start, end: 'last' };
}

/** 事業所を使う地点の数(0〜2)。事業所が未登録なら office の指定は無視して 0 と数える。 */
export function officeStopCount(ends: RouteEnds, office: Office | null): number {
  const e = effectiveEnds(ends, office);
  return (e.start === 'office' ? 1 : 0) + (e.end === 'office' ? 1 : 0);
}

/** 1ルートに入れられる訪問先の数。 */
export function stopsPerRoute(ends: RouteEnds, office: Office | null, maxStops: number): number {
  return maxStops - officeStopCount(ends, office);
}

export type RoutePlan<T> = {
  stops: T[]; // このルートの訪問先(分割の境目は前後に重なる)
  addresses: string[]; // 地図に渡す住所の並び(事業所を含む)
  fromCurrentLocation: boolean; // 1本目で「現在地から」のときだけ true
  startLabel: string; // '事業所から' | '現在地から' | ''(1件目の訪問先から)
  endLabel: string; // '事業所へ戻る' | ''
};

/**
 * 訪問順の訪問先を、出発地・帰着地を含めてルートごとに組み立てる。
 * 1本目だけ出発地を付け、最後の1本だけ帰着地を付ける。途中は前のルートの最後の訪問先から続く。
 */
export function buildRoutePlans<T extends { address: string }>(
  stops: readonly T[],
  ends: RouteEnds,
  office: Office | null,
  maxStops: number,
): RoutePlan<T>[] {
  const e = effectiveEnds(ends, office);
  const routes = splitIntoRoutes(stops, stopsPerRoute(e, office, maxStops));
  return routes.map((route, index) => {
    const first = index === 0;
    const last = index === routes.length - 1;
    const addresses = route.map((stop) => stop.address);
    if (first && e.start === 'office' && office) {
      addresses.unshift(office.address);
    }
    if (last && e.end === 'office' && office) {
      addresses.push(office.address);
    }
    return {
      stops: [...route],
      addresses,
      fromCurrentLocation: first && e.start === 'current',
      startLabel: first ? (e.start === 'office' ? '事業所から' : e.start === 'current' ? '現在地から' : '') : '',
      endLabel: last && e.end === 'office' ? '事業所へ戻る' : '',
    };
  });
}
