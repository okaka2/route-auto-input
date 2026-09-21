import { describe, expect, it } from 'vitest';
import indexHtml from '../index.html?raw';

const doc = new DOMParser().parseFromString(indexHtml, 'text/html');

describe('index.html', () => {
  it('検索エンジンに載らないよう noindex を指定している', () => {
    const robots = doc.querySelector('meta[name="robots"]');
    expect(robots?.getAttribute('content')).toContain('noindex');
  });

  it('リンクをたどらせない nofollow も指定している', () => {
    const robots = doc.querySelector('meta[name="robots"]');
    expect(robots?.getAttribute('content')).toContain('nofollow');
  });

  it('タイトルは APP_NAME に置き換わるプレースホルダーで、名前を直接書かない', () => {
    expect(doc.querySelector('title')?.textContent).toBe('%APP_NAME%');
  });

  it('ホーム画面用の名前も、同じプレースホルダーにする', () => {
    const title = doc.querySelector('meta[name="apple-mobile-web-app-title"]');
    expect(title?.getAttribute('content')).toBe('%APP_NAME%');
  });
});
