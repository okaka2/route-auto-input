import { describe, expect, it, vi } from 'vitest';
import { createPatient } from '../src/patient';
import { createInitialState } from '../src/state';
import { renderSettings, type SettingsHandlers } from '../src/views/settingsView';

const handlers = (): SettingsHandlers => ({
  onExport: vi.fn(),
  onImport: vi.fn(),
  onBack: vi.fn(),
});

function attachFile(element: HTMLElement, file: File): void {
  const input = element.querySelector<HTMLInputElement>('[data-testid="import-input"]')!;
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
}

describe('renderSettings', () => {
  it('登録件数を表示する', () => {
    const state = createInitialState([createPatient('山田', '東京都'), createPatient('鈴木', '大阪府')]);
    const element = renderSettings(state, handlers());
    expect(element.textContent).toContain('2件');
  });

  it('エクスポートボタンでonExportが呼ばれる', () => {
    const spies = handlers();
    const element = renderSettings(createInitialState([]), spies);
    element.querySelector<HTMLButtonElement>('[data-testid="export-button"]')?.click();
    expect(spies.onExport).toHaveBeenCalled();
  });

  it('ファイル未選択でインポートを押すと何も起きない', () => {
    const spies = handlers();
    const element = renderSettings(createInitialState([]), spies);
    element.querySelector<HTMLButtonElement>('[data-testid="import-button"]')?.click();
    expect(spies.onImport).not.toHaveBeenCalled();
  });

  it('既定では全置換モードでインポートする', () => {
    const spies = handlers();
    const element = renderSettings(createInitialState([]), spies);
    const file = new File(['{}'], 'backup.json', { type: 'application/json' });
    attachFile(element, file);
    element.querySelector<HTMLButtonElement>('[data-testid="import-button"]')?.click();
    expect(spies.onImport).toHaveBeenCalledWith(file, 'replace');
  });

  it('追記モードを選ぶとmergeで呼ばれる', () => {
    const spies = handlers();
    const element = renderSettings(createInitialState([]), spies);
    const file = new File(['{}'], 'backup.json', { type: 'application/json' });
    attachFile(element, file);
    element.querySelector<HTMLInputElement>('[data-testid="mode-merge"]')!.checked = true;
    element.querySelector<HTMLButtonElement>('[data-testid="import-button"]')?.click();
    expect(spies.onImport).toHaveBeenCalledWith(file, 'merge');
  });

  it('戻るボタンでonBackが呼ばれる', () => {
    const spies = handlers();
    const element = renderSettings(createInitialState([]), spies);
    element.querySelector<HTMLButtonElement>('[data-testid="back-button"]')?.click();
    expect(spies.onBack).toHaveBeenCalled();
  });

  it('メッセージがあれば表示する', () => {
    const state = { ...createInitialState([]), message: { kind: 'info' as const, text: '2件を取り込みました。' } };
    const element = renderSettings(state, handlers());
    expect(element.querySelector('.message')?.textContent).toBe('2件を取り込みました。');
  });
});
