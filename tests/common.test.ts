import { describe, expect, it, vi } from 'vitest';
import { renderMessage, renderScreenHeader } from '../src/views/common';

describe('renderScreenHeader', () => {
  it('見出しを h1 で表示する', () => {
    const header = renderScreenHeader('訪問順を決める');
    expect(header.querySelector('h1')?.textContent).toBe('訪問順を決める');
  });

  it('onBack を渡さなければ、戻るボタンは出ない', () => {
    const header = renderScreenHeader('訪問順を決める');
    expect(header.querySelector('[data-testid="back-button"]')).toBeNull();
  });

  it('onBack を渡すと戻るボタンが出て、押すと呼ばれる', () => {
    const onBack = vi.fn();
    const header = renderScreenHeader('訪問順を決める', { onBack });
    header.querySelector<HTMLButtonElement>('[data-testid="back-button"]')!.click();
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('戻るボタンには、目的が分かる名前(aria-label)を付ける', () => {
    const header = renderScreenHeader('訪問順を決める', { onBack: vi.fn() });
    expect(header.querySelector('[data-testid="back-button"]')?.getAttribute('aria-label')).toBe('戻る');
  });
});

describe('renderMessage', () => {
  it('種類のクラスと本文を持つ', () => {
    const message = renderMessage({ kind: 'error', text: '保存できませんでした。' });
    expect(message.classList.contains('message')).toBe(true);
    expect(message.classList.contains('error')).toBe(true);
    expect(message.textContent).toBe('保存できませんでした。');
  });

  it('お知らせは info のクラスを持つ', () => {
    const message = renderMessage({ kind: 'info', text: '保存しました。' });
    expect(message.classList.contains('info')).toBe(true);
  });

  it('VoiceOverに読み上げられるよう role=status を持つ', () => {
    expect(renderMessage({ kind: 'info', text: 'a' }).getAttribute('role')).toBe('status');
  });
});
