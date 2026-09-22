import { describe, expect, it, vi } from 'vitest';
import { createPatient } from '../src/patient';
import { createInitialState } from '../src/state';
import { renderSettings, type SettingsHandlers } from '../src/views/settingsView';

const handlers = (): SettingsHandlers => ({
  onExport: vi.fn(),
  onImport: vi.fn(),
  onBack: vi.fn(),
});

const q = <T extends HTMLElement = HTMLElement>(element: HTMLElement, testid: string): T =>
  element.querySelector<T>(`[data-testid="${testid}"]`)!;

function attachFile(element: HTMLElement, file: File): void {
  Object.defineProperty(q(element, 'import-input'), 'files', { value: [file], configurable: true });
}

describe('renderSettings: 全体', () => {
  it('見出しは「設定」で、戻るボタンがある', () => {
    const spies = handlers();
    const element = renderSettings(createInitialState([]), spies);
    expect(element.querySelector('h1')?.textContent).toBe('設定');
    q<HTMLButtonElement>(element, 'back-button').click();
    expect(spies.onBack).toHaveBeenCalledTimes(1);
  });

  it('登録件数を「登録されている訪問先: N件」で表示する', () => {
    const state = createInitialState([createPatient('山田', '東京都'), createPatient('鈴木', '大阪府')]);
    const element = renderSettings(state, handlers());
    expect(element.textContent).toContain('登録されている訪問先: 2件');
  });

  it('メッセージがあれば表示する', () => {
    const state = { ...createInitialState([]), message: { kind: 'info' as const, text: '2件を取り込みました。' } };
    const element = renderSettings(state, handlers());
    expect(element.querySelector('.message')?.textContent).toBe('2件を取り込みました。');
  });

  it('メッセージ領域は VoiceOver に読み上げられるよう role=status を持つ', () => {
    const state = { ...createInitialState([]), message: { kind: 'info' as const, text: '2件を取り込みました。' } };
    const element = renderSettings(state, handlers());
    expect(element.querySelector('.message')?.getAttribute('role')).toBe('status');
  });
});

describe('renderSettings: 書き出し', () => {
  it('エクスポートボタンで onExport が呼ばれる', () => {
    const spies = handlers();
    const element = renderSettings(createInitialState([]), spies);
    q<HTMLButtonElement>(element, 'export-button').click();
    expect(spies.onExport).toHaveBeenCalled();
  });

  it('説明に「訪問先」の言葉を使う', () => {
    const element = renderSettings(createInitialState([]), handlers());
    expect(element.textContent).toContain('訪問先のデータをJSONファイルとして保存します。');
  });
});

describe('renderSettings: 読み込み', () => {
  it('ファイル未選択でインポートを押しても、何も起きない', () => {
    const spies = handlers();
    const element = renderSettings(createInitialState([]), spies);
    q<HTMLButtonElement>(element, 'import-button').click();
    expect(spies.onImport).not.toHaveBeenCalled();
  });

  it('既定では、今のデータを消して入れ替える(replace)モードでインポートする', () => {
    const spies = handlers();
    const element = renderSettings(createInitialState([]), spies);
    const file = new File(['{}'], 'backup.json', { type: 'application/json' });
    attachFile(element, file);
    q<HTMLButtonElement>(element, 'import-button').click();
    expect(spies.onImport).toHaveBeenCalledWith(file, 'replace');
  });

  it('追加(merge)モードを選ぶと、merge で呼ばれる', () => {
    const spies = handlers();
    const element = renderSettings(createInitialState([]), spies);
    const file = new File(['{}'], 'backup.json', { type: 'application/json' });
    attachFile(element, file);
    q<HTMLInputElement>(element, 'mode-merge').checked = true;
    q<HTMLButtonElement>(element, 'import-button').click();
    expect(spies.onImport).toHaveBeenCalledWith(file, 'merge');
  });

  it('読み込み方法の選択肢は、グループの名前(legend)を持つ', () => {
    const element = renderSettings(createInitialState([]), handlers());
    const group = element.querySelector('fieldset.modes')!;
    expect(group.querySelector('legend')?.textContent).toBe('読み込み方法');
    expect(group.querySelectorAll('input[type="radio"]')).toHaveLength(2);
  });

  it('ファイル選択欄に名前(aria-label)を付ける', () => {
    const element = renderSettings(createInitialState([]), handlers());
    expect(q(element, 'import-input').getAttribute('aria-label')).toBe('バックアップファイルを選ぶ');
  });
});
