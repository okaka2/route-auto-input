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
});
