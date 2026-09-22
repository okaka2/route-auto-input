import { afterEach, describe, expect, it, vi } from 'vitest';
import { isMobileDevice, isStandaloneDisplay, shouldOpenMapInNewTab } from '../src/platform';

const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';

function stubUserAgent(value: string): void {
  Object.defineProperty(window.navigator, 'userAgent', { value, configurable: true });
}

function stubMatchMedia(matches: boolean): void {
  window.matchMedia = vi.fn().mockReturnValue({ matches }) as unknown as typeof window.matchMedia;
}

function stubNavigatorStandalone(value: boolean | undefined): void {
  Object.defineProperty(window.navigator, 'standalone', { value, configurable: true });
}

afterEach(() => {
  stubUserAgent(DESKTOP_UA);
  stubMatchMedia(false);
  stubNavigatorStandalone(undefined);
});

describe('isStandaloneDisplay', () => {
  it('display-mode: standalone に一致すればtrue', () => {
    stubMatchMedia(true);
    expect(isStandaloneDisplay()).toBe(true);
  });

  it('一致しなければfalse', () => {
    stubMatchMedia(false);
    expect(isStandaloneDisplay()).toBe(false);
  });

  it('iOSのnavigator.standalone=trueでもtrue(display-modeが使えないSafari向け)', () => {
    stubMatchMedia(false);
    stubNavigatorStandalone(true);
    expect(isStandaloneDisplay()).toBe(true);
  });
});

describe('isMobileDevice', () => {
  it('iPhoneのUAならtrue', () => {
    stubUserAgent(IPHONE_UA);
    expect(isMobileDevice()).toBe(true);
  });

  it('AndroidのUAならtrue', () => {
    stubUserAgent(ANDROID_UA);
    expect(isMobileDevice()).toBe(true);
  });

  it('PC(Windows Chrome)のUAならfalse', () => {
    stubUserAgent(DESKTOP_UA);
    expect(isMobileDevice()).toBe(false);
  });
});

describe('shouldOpenMapInNewTab', () => {
  it('PCのブラウザ(スタンドアロンでない・モバイルでない)ならtrue', () => {
    stubUserAgent(DESKTOP_UA);
    stubMatchMedia(false);
    expect(shouldOpenMapInNewTab()).toBe(true);
  });

  it('モバイル端末(ブラウザで開いている場合も)ならfalse', () => {
    stubUserAgent(IPHONE_UA);
    stubMatchMedia(false);
    expect(shouldOpenMapInNewTab()).toBe(false);
  });

  it('PCでもホーム画面に追加した状態(スタンドアロン)ならfalse', () => {
    stubUserAgent(DESKTOP_UA);
    stubMatchMedia(true);
    expect(shouldOpenMapInNewTab()).toBe(false);
  });
});
