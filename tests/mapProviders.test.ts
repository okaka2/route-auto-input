import { describe, expect, it } from 'vitest';
import { buildGoogleMapsUrl } from '../src/googleMapsUrl';
import { DEFAULT_MAP_PROVIDER, googleMapsProvider } from '../src/mapProviders';

describe('googleMapsProvider', () => {
  it('idとラベルを持つ', () => {
    expect(googleMapsProvider.id).toBe('google');
    expect(googleMapsProvider.label).toBe('Googleマップ');
  });

  it('経路のURLは、これまでのURL生成と同じ', () => {
    const addresses = ['東京都千代田区1-1', '大阪市北区2-2', '京都市中京区3-3'];
    expect(googleMapsProvider.buildUrl(addresses)).toBe(buildGoogleMapsUrl(addresses));
  });

  it('1件のときは、地点検索のURLになる', () => {
    const url = new URL(googleMapsProvider.buildUrl(['東京都千代田区1-1']));
    expect(url.pathname).toBe('/maps/search/');
    expect(url.searchParams.get('query')).toBe('東京都千代田区1-1');
  });

  it('空の住所が含まれていれば、これまでと同じく例外を投げる', () => {
    expect(() => googleMapsProvider.buildUrl(['東京都', ' '])).toThrow();
  });
});

describe('DEFAULT_MAP_PROVIDER', () => {
  it('今はGoogleマップ', () => {
    expect(DEFAULT_MAP_PROVIDER).toBe(googleMapsProvider);
  });
});
