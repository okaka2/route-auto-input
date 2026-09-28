import { describe, expect, it, vi } from 'vitest';
import { createPatient } from '../src/patient';
import type { Patient, TransferReceiveDialog, TransferSendDialog } from '../src/types';
import {
  renderTransferReceiveDialog,
  renderTransferSendDialog,
  type TransferReceiveDialogHandlers,
  type TransferSendDialogHandlers,
} from '../src/views/transferDialog';

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

  it('パスワード欄を出すときは、10文字以上・つなげ言葉の例を案内する', () => {
    const elements = render(baseDialog(), { hasSharedSecret: false });
    expect(q(elements, 'transfer-password-hint')?.textContent).toBe(
      '10文字以上。言葉をつなげると覚えやすくなります(例: さくら訪問2026秋)',
    );
  });

  it('合言葉を使っていて(オン)パスワード欄が無いときは、案内も出さない', () => {
    const elements = render(baseDialog({ useSharedSecret: true }), { hasSharedSecret: true });
    expect(q(elements, 'transfer-password-hint')).toBeNull();
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

  it('チェックボックスのラベルはすべて.transfer-optionsの中/外を問わず.transfer-checkクラスを持つ(タップ領域44px)', () => {
    const elements = render(baseDialog(), { hasPhotoCandidates: true, spotCount: 3, hasSharedSecret: false });
    for (const testid of ['transfer-include-photos', 'transfer-include-spots', 'transfer-save-shared']) {
      const checkbox = q<HTMLInputElement>(elements, testid)!;
      const label = checkbox.closest('label');
      expect(label?.className, testid).toBe('transfer-check');
    }
  });

  it('合言葉が保存されていなければ、保存用チェックは「この合言葉を事業所の合言葉として保存する」', () => {
    const elements = render(baseDialog(), { hasSharedSecret: false });
    const label = q<HTMLInputElement>(elements, 'transfer-save-shared')!.closest('label');
    expect(label?.textContent).toContain('この合言葉を事業所の合言葉として保存する');
  });

  it('合言葉が保存されている(がオフにしている)ときは、保存用チェックは「事業所の合言葉を、このパスワードに変える」', () => {
    const elements = render(baseDialog({ useSharedSecret: false }), { hasSharedSecret: true });
    const label = q<HTMLInputElement>(elements, 'transfer-save-shared')!.closest('label');
    expect(label?.textContent).toContain('事業所の合言葉を、このパスワードに変える');
    expect(q<HTMLInputElement>(elements, 'transfer-save-shared')!.checked).toBe(false);
  });
});

describe('renderTransferSendDialog: エラー・working・done', () => {
  it('errorがあれば赤系のメッセージで出す', () => {
    const elements = render(baseDialog({ error: 'パスワードは10文字以上にしてください。' }));
    const message = elements.find((e) => e.classList.contains('message'));
    expect(message?.classList.contains('error')).toBe(true);
    expect(message?.textContent).toBe('パスワードは10文字以上にしてください。');
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

// ===== 受け取りのダイアログ =====

const receiveHandlers = (): TransferReceiveDialogHandlers => ({
  onReceivePassword: vi.fn(),
  onReceiveSubmit: vi.fn(),
  onReceiveConfirm: vi.fn(),
  onReceiveConflict: vi.fn(),
  onClose: vi.fn(),
});

function receiveDialog(overrides: Partial<TransferReceiveDialog> = {}): TransferReceiveDialog {
  return {
    kind: 'transferReceive',
    fileText: '{"format":"houmon-transfer"}',
    phase: 'password',
    password: '',
    error: null,
    summary: '',
    conflictIndex: 0,
    conflicts: [],
    result: null,
    ...overrides,
  };
}

const texts = (elements: HTMLElement[]): string => elements.map((e) => e.textContent ?? '').join('\n');

describe('renderTransferReceiveDialog: パスワードの画面', () => {
  it('案内・パスワード欄(type password・自動入力なし)・「開く」・忘れたときの案内を出す', () => {
    const elements = renderTransferReceiveDialog(receiveDialog(), receiveHandlers());
    expect(texts(elements)).toContain('パスワードを入れてください。');
    expect(texts(elements)).toContain('パスワードを忘れると開けません。送った人に確かめてください。');
    const input = q<HTMLInputElement>(elements, 'receive-password')!;
    expect(input.type).toBe('password');
    expect(input.autocomplete).toBe('off');
    expect(input.hasAttribute('data-autofocus')).toBe(true);
    expect(q(elements, 'receive-password-submit')?.textContent).toBe('開く');
    expect(q(elements, 'dialog-cancel')?.textContent).toBe('やめる');
  });

  it('エラーがあれば出す', () => {
    const elements = renderTransferReceiveDialog(
      receiveDialog({ error: 'パスワードが違うか、ファイルが壊れています。何度でもやり直せます。' }),
      receiveHandlers(),
    );
    expect(texts(elements)).toContain('パスワードが違うか、ファイルが壊れています。何度でもやり直せます。');
  });

  it('入力で onReceivePassword、「開く」とEnterキーで onReceiveSubmit が呼ばれる', () => {
    const spies = receiveHandlers();
    const elements = renderTransferReceiveDialog(receiveDialog(), spies);
    const input = q<HTMLInputElement>(elements, 'receive-password')!;
    input.value = 'abcdef';
    input.dispatchEvent(new Event('input'));
    expect(spies.onReceivePassword).toHaveBeenCalledWith('abcdef');

    q<HTMLButtonElement>(elements, 'receive-password-submit')!.click();
    expect(spies.onReceiveSubmit).toHaveBeenCalledTimes(1);

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(spies.onReceiveSubmit).toHaveBeenCalledTimes(2);

    q<HTMLButtonElement>(elements, 'dialog-cancel')!.click();
    expect(spies.onClose).toHaveBeenCalledTimes(1);
  });

  it('日本語の変換中のEnterキーでは開かない', () => {
    const spies = receiveHandlers();
    const elements = renderTransferReceiveDialog(receiveDialog(), spies);
    q<HTMLInputElement>(elements, 'receive-password')!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', isComposing: true }),
    );
    expect(spies.onReceiveSubmit).not.toHaveBeenCalled();
  });
});

describe('renderTransferReceiveDialog: 確認・同じ人・処理中・完了', () => {
  it('確認: 「(summary)を名簿に追加しますか?」と「追加する」(最初にフォーカス)・「やめる」', () => {
    const spies = receiveHandlers();
    const elements = renderTransferReceiveDialog(
      receiveDialog({ phase: 'confirm', summary: '山田 太郎様ほか2人・お役立ち地点1件' }),
      spies,
    );
    expect(q(elements, 'receive-summary')?.textContent).toBe(
      '山田 太郎様ほか2人・お役立ち地点1件を名簿に追加しますか?',
    );
    const confirm = q<HTMLButtonElement>(elements, 'receive-confirm')!;
    expect(confirm.textContent).toBe('追加する');
    expect(confirm.hasAttribute('data-autofocus')).toBe(true);
    confirm.click();
    expect(spies.onReceiveConfirm).toHaveBeenCalledTimes(1);
    q<HTMLButtonElement>(elements, 'dialog-cancel')!.click();
    expect(spies.onClose).toHaveBeenCalledTimes(1);
    expect(q(elements, 'receive-password')).toBeNull();
  });

  it('同じ人: (N/M)の見出し、手元と受け取った人、3つの選び方', () => {
    const spies = receiveHandlers();
    const elements = renderTransferReceiveDialog(
      receiveDialog({
        phase: 'conflict',
        conflictIndex: 1,
        conflicts: [
          { incomingName: 'A', incomingAddress: 'a', existingName: 'A', existingAddress: 'a' },
          {
            incomingName: '山田 太郎',
            incomingAddress: '東京都千代田区1-1',
            existingName: '山田太郎',
            existingAddress: '東京都千代田区1ー1',
          },
        ],
      }),
      spies,
    );
    expect(elements.find((e) => e.id === 'dialog-title')?.textContent).toBe('同じ訪問先がすでにあります(2/2)');
    expect(q(elements, 'conflict-existing')?.textContent).toBe('手元: 山田太郎(東京都千代田区1ー1)');
    expect(q(elements, 'conflict-incoming')?.textContent).toBe('受け取った: 山田 太郎(東京都千代田区1-1)');
    const overwrite = q<HTMLButtonElement>(elements, 'conflict-overwrite')!;
    expect(overwrite.textContent).toBe('上書き');
    // 最初のフォーカスは「この人は追加しない」(Enterを続けて押しても上書きしない)。
    expect(overwrite.hasAttribute('data-autofocus')).toBe(false);
    expect(q(elements, 'conflict-add')?.textContent).toBe('別に追加');
    expect(q(elements, 'conflict-add')?.hasAttribute('data-autofocus')).toBe(false);
    expect(q(elements, 'conflict-skip')?.textContent).toBe('この人は追加しない');
    expect(q(elements, 'conflict-skip')?.hasAttribute('data-autofocus')).toBe(true);

    overwrite.click();
    q<HTMLButtonElement>(elements, 'conflict-add')!.click();
    q<HTMLButtonElement>(elements, 'conflict-skip')!.click();
    expect(vi.mocked(spies.onReceiveConflict).mock.calls).toEqual([['overwrite'], ['addNew'], ['skip']]);
  });

  it('処理中: 待つように案内し、押せるボタンもパスワード欄も出さない', () => {
    const elements = renderTransferReceiveDialog(receiveDialog({ phase: 'working' }), receiveHandlers());
    expect(q(elements, 'receive-working-text')?.textContent).toBe('少しお待ちください。');
    expect(elements.some((e) => e instanceof HTMLButtonElement || e.querySelector('button') !== null)).toBe(false);
    expect(q(elements, 'receive-password')).toBeNull();
  });

  it('完了: 結果の文と「閉じる」(最初にフォーカス)', () => {
    const spies = receiveHandlers();
    const elements = renderTransferReceiveDialog(
      receiveDialog({ phase: 'done', result: '2人を追加し、1人を上書きしました。' }),
      spies,
    );
    expect(q(elements, 'receive-done-text')?.textContent).toBe('2人を追加し、1人を上書きしました。');
    const close = q<HTMLButtonElement>(elements, 'dialog-cancel')!;
    expect(close.textContent).toBe('閉じる');
    expect(close.hasAttribute('data-autofocus')).toBe(true);
    close.click();
    expect(spies.onClose).toHaveBeenCalledTimes(1);
  });

  it('完了(失敗): エラーだけを出し、「閉じる」を出す', () => {
    const elements = renderTransferReceiveDialog(
      receiveDialog({ phase: 'done', result: null, error: '取り込めませんでした。' }),
      receiveHandlers(),
    );
    expect(texts(elements)).toContain('取り込めませんでした。');
    expect(q(elements, 'receive-done-text')).toBeNull();
    expect(q(elements, 'dialog-cancel')?.textContent).toBe('閉じる');
  });
});
