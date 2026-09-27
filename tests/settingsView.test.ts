import { describe, expect, it, vi } from 'vitest';
import { createPatient } from '../src/patient';
import { createInitialState } from '../src/state';
import { renderSettings, type SettingsHandlers, type SettingsInfo } from '../src/views/settingsView';

const handlers = (): SettingsHandlers => ({
  onExport: vi.fn(),
  onIncludePhotosChange: vi.fn(),
  onImport: vi.fn(),
  onThemeChange: vi.fn(),
  onBack: vi.fn(),
  onSaveOffice: vi.fn(),
  onClearOffice: vi.fn(),
  onClearHistory: vi.fn(),
  onDeleteSpot: vi.fn(),
  onSendSpots: vi.fn(),
  onSharedSecretDraftChange: vi.fn(),
  onSharedSecretSave: vi.fn(),
  onSharedSecretChange: vi.fn(),
  onSharedSecretClear: vi.fn(),
  onSharedSecretCancel: vi.fn(),
});

const info = (): SettingsInfo => ({
  lastBackupAt: null,
  persisted: null,
  theme: 'auto',
  office: null,
  spots: [],
  photoBytes: 0,
  includePhotos: true,
  hasSharedSecret: false,
  sharedSecretDraft: '',
  sharedSecretEditing: false,
});

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

  it('写真が無ければ「写真も含める」は出さず、onExport(true)で書き出す', () => {
    const spies = handlers();
    const element = renderSettings(createInitialState([]), { ...info(), photoBytes: 0 }, spies);
    expect(element.querySelector('[data-testid="include-photos"]')).toBeNull();
    q<HTMLButtonElement>(element, 'export-button').click();
    expect(spies.onExport).toHaveBeenCalledWith(true);
  });

  it('写真があれば「写真も含める(約N.NMB)」のチェック(既定でオン)を出す', () => {
    // 3MB相当のバイト数(data URL化で4/3になる分を見込んだ表示)。
    const bytes = 3 * 1024 * 1024 * (3 / 4);
    const element = renderSettings(createInitialState([]), { ...info(), photoBytes: bytes }, handlers());
    const checkbox = q<HTMLInputElement>(element, 'include-photos');
    expect(checkbox.checked).toBe(true);
    expect(element.textContent).toContain('写真も含める(約3.0MB)');
  });

  it('小さい写真は「約0.1MB未満」と出す', () => {
    const element = renderSettings(createInitialState([]), { ...info(), photoBytes: 1000 }, handlers());
    expect(element.textContent).toContain('写真も含める(約0.1MB未満)');
  });

  it('チェックを外して書き出すと onExport(false)', () => {
    const spies = handlers();
    const element = renderSettings(createInitialState([]), { ...info(), photoBytes: 1000 }, spies);
    q<HTMLInputElement>(element, 'include-photos').checked = false;
    q<HTMLButtonElement>(element, 'export-button').click();
    expect(spies.onExport).toHaveBeenCalledWith(false);
  });

  it('チェックを変えるたび onIncludePhotosChange を呼ぶ(Minor 7)', () => {
    const spies = handlers();
    const element = renderSettings(createInitialState([]), { ...info(), photoBytes: 1000 }, spies);
    const checkbox = q<HTMLInputElement>(element, 'include-photos');
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change'));
    expect(spies.onIncludePhotosChange).toHaveBeenCalledWith(false);
  });

  it('info.includePhotosがfalseなら、チェックは外れた状態で出る(Minor 7)', () => {
    const element = renderSettings(createInitialState([]), { ...info(), photoBytes: 1000, includePhotos: false }, handlers());
    expect(q<HTMLInputElement>(element, 'include-photos').checked).toBe(false);
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
    expect(q(element, 'import-input').getAttribute('aria-label')).toBe('バックアップか引き継ぎのファイルを選ぶ');
  });

  it('ファイルの種類(accept)で絞らない(引き継ぎのファイル .txt も選べるように)', () => {
    const element = renderSettings(createInitialState([]), info(), handlers());
    expect(q(element, 'import-input').hasAttribute('accept')).toBe(false);
  });

  it('引き継ぎのファイルもここから読み込める(今のデータに追加する)と案内する', () => {
    const element = renderSettings(createInitialState([]), info(), handlers());
    const note = q(element, 'import-transfer-note');
    expect(note.textContent).toBe('引き継ぎのファイル(.txt)もここから読み込めます。そのときは今のデータに追加します。');
    expect(note.classList.contains('hint')).toBe(true);
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
  it('見出しの順は 出発地・帰着地 → バックアップ → お役立ち地点 → 事業所の合言葉 → データの保存状態 → 表示 → このアプリについて', () => {
    const element = renderSettings(createInitialState([]), info(), handlers());
    const headings = [...element.querySelectorAll('h2')].map((h) => h.textContent);
    expect(headings).toEqual([
      '出発地・帰着地',
      'バックアップ',
      'お役立ち地点',
      '事業所の合言葉',
      'データの保存状態',
      '表示',
      'このアプリについて',
    ]);
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

describe('renderSettings: データの保存状態', () => {
  it('「データの保存状態」に「履歴をすべて消す」があり、押すと onClearHistory', () => {
    const spies = handlers();
    const element = renderSettings(createInitialState([]), info(), spies);
    q<HTMLButtonElement>(element, 'clear-history-button').click();
    expect(spies.onClearHistory).toHaveBeenCalled();
  });
});

describe('renderSettings: 出発地・帰着地', () => {
  it('見出しの先頭が「出発地・帰着地」になる', () => {
    const element = renderSettings(createInitialState([]), info(), handlers());
    expect(element.querySelector('h2')?.textContent).toBe('出発地・帰着地');
  });
  it('未登録なら入力欄と「保存」、登録済みなら名前・住所と「消す」を出す', () => {
    const none = renderSettings(createInitialState([]), info(), handlers());
    expect(q<HTMLInputElement>(none, 'office-name-input').value).toBe('');
    expect(q(none, 'office-save-button').textContent).toBe('保存');
    const saved = renderSettings(createInitialState([]), { ...info(), office: { name: '本店', address: '東京都中央区1-1' } }, handlers());
    expect(q<HTMLInputElement>(saved, 'office-name-input').value).toBe('本店');
    expect(q<HTMLInputElement>(saved, 'office-address-input').value).toBe('東京都中央区1-1');
    expect(q(saved, 'office-clear-button')).not.toBeNull();
  });
  it('「保存」で onSaveOffice(name, address)、「消す」で onClearOffice', () => {
    const spies = handlers();
    const element = renderSettings(createInitialState([]), { ...info(), office: { name: '本店', address: 'X' } }, spies);
    q<HTMLInputElement>(element, 'office-name-input').value = '支店';
    q<HTMLInputElement>(element, 'office-address-input').value = '大阪府';
    q<HTMLButtonElement>(element, 'office-save-button').click();
    expect(spies.onSaveOffice).toHaveBeenCalledWith('支店', '大阪府');
    q<HTMLButtonElement>(element, 'office-clear-button').click();
    expect(spies.onClearOffice).toHaveBeenCalled();
  });
  it('説明に、訪問順の画面で出発・帰着を選べることを書く', () => {
    const element = renderSettings(createInitialState([]), info(), handlers());
    expect(element.textContent).toContain('訪問順の画面で');
  });
});

describe('renderSettings: 事業所の合言葉', () => {
  it('未設定なら、入力欄(type=password、autocomplete=new-password)と「保存」を出す', () => {
    const element = renderSettings(createInitialState([]), info(), handlers());
    const input = q<HTMLInputElement>(element, 'shared-secret-input');
    expect(input.type).toBe('password');
    expect(input.autocomplete).toBe('new-password');
    expect(q(element, 'shared-secret-save').textContent).toBe('保存');
    expect(element.querySelector('[data-testid="shared-secret-status"]')).toBeNull();
    expect(element.querySelector('[data-testid="shared-secret-change"]')).toBeNull();
    expect(element.querySelector('[data-testid="shared-secret-clear"]')).toBeNull();
  });

  it('説明に6文字以上と書く(禁止語は使わない)', () => {
    const element = renderSettings(createInitialState([]), info(), handlers());
    expect(element.textContent).toContain('6文字以上');
  });

  it('入力欄の初期値はinfo.sharedSecretDraftで、入力するたびonSharedSecretDraftChange(Minor 7と同じやり方)', () => {
    const spies = handlers();
    const element = renderSettings(createInitialState([]), { ...info(), sharedSecretDraft: 'たね' }, spies);
    const input = q<HTMLInputElement>(element, 'shared-secret-input');
    expect(input.value).toBe('たね');
    input.value = 'たねひみつ';
    input.dispatchEvent(new Event('input'));
    expect(spies.onSharedSecretDraftChange).toHaveBeenCalledWith('たねひみつ');
  });

  it('「保存」を押すと、入力欄の今の値でonSharedSecretSaveが呼ばれる', () => {
    const spies = handlers();
    const element = renderSettings(createInitialState([]), info(), spies);
    const input = q<HTMLInputElement>(element, 'shared-secret-input');
    input.value = 'ひみつのあいことば';
    q<HTMLButtonElement>(element, 'shared-secret-save').click();
    expect(spies.onSharedSecretSave).toHaveBeenCalledWith('ひみつのあいことば');
  });

  it('設定済み(編集していない)なら「設定されています」と「変える」「消す」を出し、入力欄も合言葉そのものも出さない', () => {
    const spies = handlers();
    const element = renderSettings(createInitialState([]), { ...info(), hasSharedSecret: true }, spies);
    expect(q(element, 'shared-secret-status').textContent).toBe('設定されています');
    expect(element.querySelector('[data-testid="shared-secret-input"]')).toBeNull();
    q<HTMLButtonElement>(element, 'shared-secret-change').click();
    expect(spies.onSharedSecretChange).toHaveBeenCalled();
    q<HTMLButtonElement>(element, 'shared-secret-clear').click();
    expect(spies.onSharedSecretClear).toHaveBeenCalled();
  });

  it('設定済みで「変える」を押した後(sharedSecretEditing)は、入力欄と「保存」「やめる」を出す', () => {
    const spies = handlers();
    const element = renderSettings(
      createInitialState([]),
      { ...info(), hasSharedSecret: true, sharedSecretEditing: true },
      spies,
    );
    expect(q(element, 'shared-secret-input')).not.toBeNull();
    expect(q(element, 'shared-secret-save')).not.toBeNull();
    expect(element.querySelector('[data-testid="shared-secret-status"]')).toBeNull();
    expect(element.querySelector('[data-testid="shared-secret-change"]')).toBeNull();
    q<HTMLButtonElement>(element, 'shared-secret-cancel').click();
    expect(spies.onSharedSecretCancel).toHaveBeenCalled();
  });
});
