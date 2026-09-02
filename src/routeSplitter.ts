/**
 * 訪問順を保ったまま、1本あたり maxStopsPerRoute 件以内のルートへ分割する。
 * 分割の境目となる地点は前後どちらのルートにも含め、経路が途切れないようにする。
 */
export function splitIntoRoutes<T>(stops: readonly T[], maxStopsPerRoute: number): T[][] {
  if (maxStopsPerRoute < 2) {
    throw new Error('1ルートあたりの上限は2以上である必要があります。');
  }
  if (stops.length === 0) {
    return [];
  }
  if (stops.length <= maxStopsPerRoute) {
    return [[...stops]];
  }

  const routes: T[][] = [];
  for (let start = 0; start < stops.length - 1; start += maxStopsPerRoute - 1) {
    routes.push([...stops.slice(start, start + maxStopsPerRoute)]);
  }
  return routes;
}
