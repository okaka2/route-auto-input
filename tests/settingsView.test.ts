import { describe, expect, it, vi } from 'vitest';
import { createPatient } from '../src/patient';
import { createInitialState } from '../src/state';
import { renderSettings, type SettingsHandlers, type SettingsInfo } from '../src/views/settingsView';

const handlers = (): SettingsHandlers => ({
  onExport: vi.fn(),
  onImport: vi.fn(),
  onThemeChange: vi.fn(),
  onBack: vi.fn(),
});

const info = (): SettingsInfo => ({ lastBackupAt: null, persisted: null, theme: 'auto' });

const q = <T extends HTMLElement = HTMLElement>(element: HTMLElement, testid: string): T =>
  element.querySelector<T>(`[data-testid="${testid}"]`)!;

function attachFile(element: HTMLElement, file: File): void {
  Object.defineProperty(q(element, 'import-input'), 'files', { value: [file], configurable: true });
}

describe('renderSettings: 全体', () => {
  it('見出しは「設定」で、戻るボタンがある', () => {
    const spies = handlers();
    const element = renderSettings(createInitialState([]), info(), spies);
    expect(element.querySelector('h1')?.textContent).toBe('設定');
    q<HTMLButtonElement>(element, 'back-button').click();
    expect(spies.onBack).toHaveBeenCalledTimes(1);
  });

  it('登録件数を「登録されている訪問先: N件」で表示する', () => {
    const state = createInitialState([createPatient('山田', '東京都'), createPatient('鈴木', '大阪府')]);
    const element = renderSettings(state, info(), handlers());
    expect(element.textContent).toContain('登録されている訪問先: 2件');
  });

  it('メッセージがあれば表示する', () => {
    const state = { ...createInitialState([]), message: { kind: 'info' as const, text: '2件を取り込みました。' } };
    const element = renderSettings(state, info(), handlers());
    expect(element.querySelector('.message')?.textContent).toBe('2件を取り込みました。');
  });

  it('メッセージ領域は VoiceOver に読み上げられるよう role=status を持つ', () => {
    const state = { ...createInitialState([]), message: { kind: 'info' as const, text: '2件を取り込みました。' } };
    const element = renderSettings(state, info(), handlers());
    expect(element.querySelector('.message')?.getAttribute('role')).toBe('status');
  });
});

describe('renderSettings: 書き出し', () => {
  it('エクスポートボタンで onExport が呼ばれる', () => {
    const spies = handlers();
    const element = renderSettings(createInitialState([]), info(), spies);
    q<HTMLButtonElement>(element, 'export-button').click();
    expect(spies.onExport).toHaveBeenCalled();
  });

  it('説明に「訪問先」の言葉を使う', () => {
    const element = renderSettings(createInitialState([]), info(), handlers());
    expect(element.textContent).toContain('訪問先のデータをバックアップのファイルとして保存します。');
  });
});

describe('renderSettings: 読み込み', () => {
  it('ファイル未選択でインポートを押しても、何も起きない', () => {
    const spies = handlers();
    const element = renderSettings(createInitialState([]), info(), spies);
    q<HTMLButtonElement>(element, 'import-button').click();
    expect(spies.onImport).not.toHaveBeenCalled();
  });

  it('既定では、今のデータを消して入れ替える(replace)モードでインポートする', () => {
    const spies = handlers();
    const element = renderSettings(createInitialState([]), info(), spies);
    const file = new File(['{}'], 'backup.json', { type: 'application/json' });
    attachFile(element, file);
    q<HTMLButtonElement>(element, 'import-button').click();
    expect(spies.onImport).toHaveBeenCalledWith(file, 'replace');
  });

  it('追加(merge)モードを選ぶと、merge で呼ばれる', () => {
    const spies = handlers();
    const element = renderSettings(createInitialState([]), info(), spies);
    const file = new File(['{}'], 'backup.json', { type: 'application/json' });
    attachFile(element, file);
    q<HTMLInputElement>(element, 'mode-merge').checked = true;
    q<HTMLButtonElement>(element, 'import-button').click();
    expect(spies.onImport).toHaveBeenCalledWith(file, 'merge');
  });

  it('読み込み方法の選択肢は、グループの名前(legend)を持つ', () => {
    const element = renderSettings(createInitialState([]), info(), handlers());
    const group = element.querySelector('fieldset.modes')!;
    expect(group.querySelector('legend')?.textContent).toBe('読み込み方法');
    expect(group.querySelectorAll('input[type="radio"]')).toHaveLength(2);
  });

  it('ファイル選択欄に名前(aria-label)を付ける', () => {
    const element = renderSettings(createInitialState([]), info(), handlers());
    expect(q(element, 'import-input').getAttribute('aria-label')).toBe('バックアップのファイルを選ぶ');
  });
});

describe('renderSettings: 言葉と並び', () => {
  it('ボタンは「書き出す」「読み込む」で、JSONという言葉を使わない', () => {
    const element = renderSettings(createInitialState([]), info(), handlers());
    expect(q(element, 'export-button').textContent).toBe('書き出す');
    expect(q(element, 'import-button').textContent).toBe('読み込む');
    expect(element.textContent).not.toContain('JSON');
    expect(element.textContent).not.toContain('エクスポート');
    expect(element.textContent).not.toContain('インポート');
  });
  it('見出しの順は バックアップ → データの保存状態 → 表示 → このアプリについて', () => {
    const element = renderSettings(createInitialState([]), info(), handlers());
    const headings = [...element.querySelectorAll('h2')].map((h) => h.textContent);
    expect(headings).toEqual(['バックアップ', 'データの保存状態', '表示', 'このアプリについて']);
  });
  it('最後のバックアップが無ければ「まだありません」、あれば日付と何日前か', () => {
    const none = renderSettings(createInitialState([]), info(), handlers());
    expect(none.textContent).toContain('最後のバックアップ: まだありません');
    const done = renderSettings(
      createInitialState([]),
      { ...info(), lastBackupAt: '2026-09-20T09:00:00.000Z' },
      handlers(),
      new Date('2026-09-24T09:00:00.000Z'),
    );
    expect(done.textContent).toContain('最後のバックアップ: 9月20日(4日前)');
  });
  it('データの保存状態は 保護されています / 通常 / 確認中', () => {
    const on = renderSettings(createInitialState([]), { ...info(), persisted: true }, handlers());
    expect(q(on, 'persist-status').textContent).toBe('保護されています');
    const off = renderSettings(createInitialState([]), { ...info(), persisted: false }, handlers());
    expect(q(off, 'persist-status').textContent).toBe('通常');
    const unknown = renderSettings(createInitialState([]), info(), handlers());
    expect(q(unknown, 'persist-status').textContent).toBe('確認中');
  });
  it('表示の切り替えは 自動/明るい/暗い の3択で、選ぶと onThemeChange が呼ばれる', () => {
    const spies = handlers();
    const element = renderSettings(createInitialState([]), { ...info(), theme: 'auto' }, spies);
    // jsdomではラジオボタンがdocumentに接続されていないとchangeイベントが発火しないため、
    // 操作の前に一時的にdocument.bodyへ入れる。
    document.body.append(element);
    const radios = [...element.querySelectorAll<HTMLInputElement>('input[name="theme"]')];
    expect(radios.map((r) => r.value)).toEqual(['auto', 'light', 'dark']);
    expect(radios[0]!.checked).toBe(true);
    radios[2]!.click();
    expect(spies.onThemeChange).toHaveBeenCalledWith('dark');
    element.remove();
  });
  it('このアプリについて に版の番号を出す', () => {
    const element = renderSettings(createInitialState([]), info(), handlers());
    expect(element.textContent).toContain('版:');
  });
});
