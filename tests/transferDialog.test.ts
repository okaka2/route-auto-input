import { describe, expect, it, vi } from 'vitest';
import { createPatient } from '../src/patient';
import type { Patient, TransferSendDialog } from '../src/types';
import { renderTransferSendDialog, type TransferSendDialogHandlers } from '../src/views/transferDialog';

const handlers = (): TransferSendDialogHandlers => ({
  onSendDraft: vi.fn(),
  onSubmit: vi.fn(),
  onClose: vi.fn(),
});

function baseDialog(overrides: Partial<TransferSendDialog> = {}): TransferSendDialog {
  return {
    kind: 'transferSend',
    patientIds: ['p1'],
    includePhotos: true,
    includeSpots: false,
    useSharedSecret: false,
    password: '',
    passwordConfirm: '',
    saveAsShared: false,
    phase: 'form',
    error: null,
    shared: false,
    ...overrides,
  };
}

const q = <T extends HTMLElement = HTMLElement>(elements: HTMLElement[], testid: string): T | null => {
  for (const element of elements) {
    const found = element.matches(`[data-testid="${testid}"]`)
      ? (element as unknown as T)
      : element.querySelector<T>(`[data-testid="${testid}"]`);
    if (found) {
      return found;
    }
  }
  return null;
};

const render = (
  dialog: TransferSendDialog,
  options: {
    patients?: Patient[];
    hasPhotoCandidates?: boolean;
    spotCount?: number;
    hasSharedSecret?: boolean;
    handlers?: TransferSendDialogHandlers;
  } = {},
) =>
  renderTransferSendDialog(
    dialog,
    options.patients ?? [createPatient('山田 太郎', '東京都千代田区1-1')],
    options.hasPhotoCandidates ?? false,
    options.spotCount ?? 0,
    options.hasSharedSecret ?? false,
    options.handlers ?? handlers(),
  );

describe('renderTransferSendDialog: 見出し・注意書き', () => {
  it('訪問先を送るときは「(相手)を送る」', () => {
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    const elements = render(baseDialog(), { patients: [patient] });
    const title = elements.find((e) => e.id === 'dialog-title');
    expect(title?.textContent).toBe('山田 太郎様を送る');
  });

  it('お役立ち地点だけを送るときは「お役立ち地点を送る」', () => {
    const elements = render(baseDialog({ patientIds: [] }), { patients: [] });
    const title = elements.find((e) => e.id === 'dialog-title');
    expect(title?.textContent).toBe('お役立ち地点を送る');
  });

  it('注意書きは常に太字クラスで表示する', () => {
    const elements = render(baseDialog());
    const warning = elements.find((e) => e.classList.contains('transfer-warning'));
    expect(warning?.textContent).toBe('名前・住所・電話・位置・駐車・メモ(と、含めれば写真)が相手に渡ります。');
  });
});

describe('renderTransferSendDialog: 出し分け', () => {
  it('写真の候補がなければ「写真も含める」を出さない', () => {
    const elements = render(baseDialog(), { hasPhotoCandidates: false });
    expect(q(elements, 'transfer-include-photos')).toBeNull();
  });

  it('写真の候補があれば「写真も含める」を出す', () => {
    const elements = render(baseDialog({ includePhotos: true }), { hasPhotoCandidates: true });
    const checkbox = q<HTMLInputElement>(elements, 'transfer-include-photos');
    expect(checkbox).not.toBeNull();
    expect(checkbox!.checked).toBe(true);
  });

  it('地点が0件なら「お役立ち地点も含める」を出さない', () => {
    const elements = render(baseDialog(), { spotCount: 0 });
    expect(q(elements, 'transfer-include-spots')).toBeNull();
  });

  it('地点だけを送るとき(patients:0件)は、地点が1件以上あっても「お役立ち地点も含める」を出さない', () => {
    const elements = render(baseDialog({ patientIds: [] }), { patients: [], spotCount: 3 });
    expect(q(elements, 'transfer-include-spots')).toBeNull();
  });

  it('訪問先を送るときに地点が1件以上あれば、件数つきで出す', () => {
    const elements = render(baseDialog({ includeSpots: false }), { spotCount: 3 });
    const checkbox = q<HTMLInputElement>(elements, 'transfer-include-spots');
    expect(checkbox).not.toBeNull();
    expect(checkbox!.checked).toBe(false);
    expect(checkbox!.closest('label')?.textContent).toContain('お役立ち地点も含める(3件)');
  });

  it('合言葉が保存されていなければ「事業所の合言葉を使う」を出さず、パスワード欄を出す', () => {
    const elements = render(baseDialog(), { hasSharedSecret: false });
    expect(q(elements, 'transfer-use-shared')).toBeNull();
    expect(q(elements, 'transfer-password')).not.toBeNull();
    expect(q(elements, 'transfer-password-confirm')).not.toBeNull();
    expect(q(elements, 'transfer-save-shared')).not.toBeNull();
  });

  it('合言葉が保存されていてオンなら、チェックを出しパスワード欄は出さない', () => {
    const elements = render(baseDialog({ useSharedSecret: true }), { hasSharedSecret: true });
    const checkbox = q<HTMLInputElement>(elements, 'transfer-use-shared');
    expect(checkbox?.checked).toBe(true);
    expect(q(elements, 'transfer-password')).toBeNull();
  });

  it('合言葉はあるがオフにしていれば、パスワード欄を出す', () => {
    const elements = render(baseDialog({ useSharedSecret: false }), { hasSharedSecret: true });
    expect(q(elements, 'transfer-use-shared')).not.toBeNull();
    expect(q(elements, 'transfer-password')).not.toBeNull();
  });
});

describe('renderTransferSendDialog: エラー・working・done', () => {
  it('errorがあれば赤系のメッセージで出す', () => {
    const elements = render(baseDialog({ error: 'パスワードは6文字以上にしてください。' }));
    const message = elements.find((e) => e.classList.contains('message'));
    expect(message?.classList.contains('error')).toBe(true);
    expect(message?.textContent).toBe('パスワードは6文字以上にしてください。');
  });

  it('working のときは送る・やめるの両方を押せなくする', () => {
    const elements = render(baseDialog({ phase: 'working' }), { hasSharedSecret: false });
    expect(q<HTMLButtonElement>(elements, 'transfer-send-button')!.disabled).toBe(true);
    expect(q<HTMLButtonElement>(elements, 'dialog-cancel')!.disabled).toBe(true);
    expect(q<HTMLInputElement>(elements, 'transfer-password')!.disabled).toBe(true);
  });

  it('done(共有できた)は「送りました。」と閉じるボタンだけ', () => {
    const elements = render(baseDialog({ phase: 'done', shared: true }));
    expect(q(elements, 'transfer-done-text')?.textContent).toBe('送りました。');
    expect(q(elements, 'dialog-cancel')?.textContent).toBe('閉じる');
    expect(q(elements, 'transfer-send-button')).toBeNull();
    expect(q(elements, 'transfer-password')).toBeNull();
  });

  it('done(保存した)は「ファイルを保存しました。LINE などで送ってください。」', () => {
    const elements = render(baseDialog({ phase: 'done', shared: false }));
    expect(q(elements, 'transfer-done-text')?.textContent).toBe(
      'ファイルを保存しました。LINE などで送ってください。',
    );
  });
});

describe('renderTransferSendDialog: 操作', () => {
  it('パスワード欄の入力で onSendDraft({ password }) が呼ばれる', () => {
    const spies = handlers();
    const elements = render(baseDialog(), { handlers: spies });
    const input = q<HTMLInputElement>(elements, 'transfer-password')!;
    input.value = 'abcdef';
    input.dispatchEvent(new Event('input'));
    expect(spies.onSendDraft).toHaveBeenCalledWith({ password: 'abcdef' });
  });

  it('確認用パスワード欄の入力で onSendDraft({ passwordConfirm }) が呼ばれる', () => {
    const spies = handlers();
    const elements = render(baseDialog(), { handlers: spies });
    const input = q<HTMLInputElement>(elements, 'transfer-password-confirm')!;
    input.value = 'abcdef';
    input.dispatchEvent(new Event('input'));
    expect(spies.onSendDraft).toHaveBeenCalledWith({ passwordConfirm: 'abcdef' });
  });

  it('写真も含めるチェックの切り替えで onSendDraft({ includePhotos }) が呼ばれる', () => {
    const spies = handlers();
    const elements = render(baseDialog({ includePhotos: true }), { handlers: spies, hasPhotoCandidates: true });
    const checkbox = q<HTMLInputElement>(elements, 'transfer-include-photos')!;
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change'));
    expect(spies.onSendDraft).toHaveBeenCalledWith({ includePhotos: false });
  });

  it('事業所の合言葉を使うチェックの切り替えで onSendDraft({ useSharedSecret }) が呼ばれる', () => {
    const spies = handlers();
    const elements = render(baseDialog({ useSharedSecret: true }), { handlers: spies, hasSharedSecret: true });
    const checkbox = q<HTMLInputElement>(elements, 'transfer-use-shared')!;
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change'));
    expect(spies.onSendDraft).toHaveBeenCalledWith({ useSharedSecret: false });
  });

  it('「送る」を押すと onSubmit が呼ばれる', () => {
    const spies = handlers();
    const elements = render(baseDialog(), { handlers: spies });
    q<HTMLButtonElement>(elements, 'transfer-send-button')!.click();
    expect(spies.onSubmit).toHaveBeenCalledTimes(1);
  });

  it('「やめる」を押すと onClose が呼ばれる', () => {
    const spies = handlers();
    const elements = render(baseDialog(), { handlers: spies });
    q<HTMLButtonElement>(elements, 'dialog-cancel')!.click();
    expect(spies.onClose).toHaveBeenCalledTimes(1);
  });

  it('done の「閉じる」を押すと onClose が呼ばれる', () => {
    const spies = handlers();
    const elements = render(baseDialog({ phase: 'done' }), { handlers: spies });
    q<HTMLButtonElement>(elements, 'dialog-cancel')!.click();
    expect(spies.onClose).toHaveBeenCalledTimes(1);
  });
});
