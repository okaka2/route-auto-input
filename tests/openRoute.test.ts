import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/platform', () => ({ shouldOpenMapInNewTab: vi.fn() }));

import { shouldOpenMapInNewTab } from '../src/platform';
import { openUrl } from '../src/openRoute';

const URL = 'https://www.google.com/maps/dir/?api=1&destination=x';

describe('openUrl', () => {
  let openSpy: ReturnType<typeof vi.spyOn>;
  const originalLocation = window.location;
  // jsdomは異なるオリジンへの実際の遷移(location.hrefへの代入)を実装しておらず、
  // 代入しても読み戻せない。差し替え可能な素のオブジェクトに置き換えて確かめる。
  let fakeLocation: { href: string };

  beforeEach(() => {
    openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    fakeLocation = { href: 'https://example.com/' };
    Object.defineProperty(window, 'location', { value: fakeLocation, writable: true, configurable: true });
  });

  afterEach(() => {
    vi.mocked(shouldOpenMapInNewTab).mockReset();
    openSpy.mockRestore();
    Object.defineProperty(window, 'location', { value: originalLocation, writable: true, configurable: true });
  });

  it('別タブで開くべきとき(PCのブラウザ)は、window.openで新しいタブに開く', () => {
    vi.mocked(shouldOpenMapInNewTab).mockReturnValue(true);
    openUrl(URL);
    expect(openSpy).toHaveBeenCalledWith(URL, '_blank', 'noopener');
    expect(fakeLocation.href).toBe('https://example.com/');
  });

  it('それ以外(モバイル・アプリ)は、これまで通り同じ画面で遷移する', () => {
    vi.mocked(shouldOpenMapInNewTab).mockReturnValue(false);
    openUrl(URL);
    expect(openSpy).not.toHaveBeenCalled();
    expect(fakeLocation.href).toBe(URL);
  });
});
