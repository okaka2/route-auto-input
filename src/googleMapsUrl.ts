const DIRECTIONS_BASE = 'https://www.google.com/maps/dir/';
const SEARCH_BASE = 'https://www.google.com/maps/search/';

/**
 * 訪問順に並んだ住所からGoogleマップ用のURLを作る。
 * 2件以上なら経路URL、1件なら地点検索URLを返す。
 * エンコードは URLSearchParams に任せる(日本語住所を壊さないため)。
 */
export function buildGoogleMapsUrl(addresses: readonly string[]): string {
  const trimmed = addresses.map((address) => address.trim());

  if (trimmed.length === 0) {
    throw new Error('地点が選ばれていません。');
  }
  if (trimmed.some((address) => address.length === 0)) {
    throw new Error('住所が空の地点があります。');
  }

  if (trimmed.length === 1) {
    const url = new URL(SEARCH_BASE);
    url.searchParams.set('api', '1');
    url.searchParams.set('query', trimmed[0]!);
    return url.toString();
  }

  const url = new URL(DIRECTIONS_BASE);
  url.searchParams.set('api', '1');
  url.searchParams.set('origin', trimmed[0]!);
  url.searchParams.set('destination', trimmed[trimmed.length - 1]!);

  const waypoints = trimmed.slice(1, -1);
  if (waypoints.length > 0) {
    url.searchParams.set('waypoints', waypoints.join('|'));
  }

  url.searchParams.set('travelmode', 'driving');
  return url.toString();
}
