import { describe, expect, it, vi } from 'vitest';
import { createPatient } from '../src/patient';
import {
  closeDialog,
  createInitialState,
  openDeleteConfirm,
  openDeleteSelectedConfirm,
  openRowMenu,
  toggleSelection,
} from '../src/state';
import { renderDialog, type DialogHandlers } from '../src/views/dialogs';

const handlers = (): DialogHandlers => ({
  onEdit: vi.fn(),
  onDuplicate: vi.fn(),
  onRequestDelete: vi.fn(),
  onConfirmDelete: vi.fn(),
  onConfirmDeleteSelected: vi.fn(),
  onMoveToTop: vi.fn(),
  onMoveToBottom: vi.fn(),
  onSaveAnyway: vi.fn(),
  onOpenExisting: vi.fn(),
  onOpenLocation: vi.fn(),
  onStartMeasuring: vi.fn(),
  onSaveMeasured: vi.fn(),
  onPasteChange: vi.fn(),
  onPasteToggle: vi.fn(),
  onSavePasted: vi.fn(),
  onRemove: vi.fn(),
  onUndo: vi.fn(),
  onPhotoIndex: vi.fn(),
  onClose: vi.fn(),
});

const patient = createPatient('山田 太郎', '東京都千代田区1-1');
const base = () => createInitialState([patient]);

const button = (element: HTMLElement, testid: string) =>
  element.querySelector<HTMLButtonElement>(`[data-testid="${testid}"]`)!;

describe('renderDialog: 出さない場合', () => {
  it('ダイアログが開いていなければ null', () => {
    expect(renderDialog(base(), handlers())).toBeNull();
  });

  it('閉じた後は null', () => {
    expect(renderDialog(closeDialog(openRowMenu(base(), patient.id)), handlers())).toBeNull();
  });

  it('対象の訪問先が見つからなければ null', () => {
    expect(renderDialog(openRowMenu(base(), 'unknown-id'), handlers())).toBeNull();
  });
});

describe('renderDialog: 「⋯」メニュー', () => {
  const open = (spies = handlers()) => renderDialog(openRowMenu(base(), patient.id), spies)!;

  it('見出しに訪問先の名前を出す', () => {
    expect(open().querySelector('#dialog-title')?.textContent).toBe('山田 太郎');
  });

  it('編集・複製して登録・位置を登録・削除・キャンセルの5つのボタンを、この順に出す', () => {
    const element = open();
    const labels = ['dialog-edit', 'dialog-duplicate', 'dialog-location', 'dialog-delete', 'dialog-cancel'].map(
      (testid) => button(element, testid).textContent,
    );
    expect(labels).toEqual(['編集', '複製して登録', '位置を登録', '削除', 'キャンセル']);
    expect([...element.querySelectorAll('button')]).toHaveLength(5);
  });

  it('削除ボタンは赤(danger)で表示する', () => {
    expect(button(open(), 'dialog-delete').classList.contains('danger')).toBe(true);
  });

  it('編集を押すと、訪問先のidつきで onEdit が呼ばれる', () => {
    const spies = handlers();
    button(open(spies), 'dialog-edit').click();
    expect(spies.onEdit).toHaveBeenCalledWith(patient.id);
  });

  it('複製して登録を押すと、訪問先のidつきで onDuplicate が呼ばれる', () => {
    const spies = handlers();
    button(open(spies), 'dialog-duplicate').click();
    expect(spies.onDuplicate).toHaveBeenCalledWith(patient.id);
  });

  it('削除を押すと、この時点では削除せず、確認へ進むための onRequestDelete が呼ばれる', () => {
    const spies = handlers();
    button(open(spies), 'dialog-delete').click();
    expect(spies.onRequestDelete).toHaveBeenCalledWith(patient.id);
    expect(spies.onConfirmDelete).not.toHaveBeenCalled();
  });

  it('キャンセルを押すと onClose が呼ばれる', () => {
    const spies = handlers();
    button(open(spies), 'dialog-cancel').click();
    expect(spies.onClose).toHaveBeenCalledTimes(1);
  });

  it('位置が未登録なら「位置を登録」、押すと onOpenLocation が id つきで呼ばれる', () => {
    const spies = handlers();
    const element = open(spies);
    expect(button(element, 'dialog-location').textContent).toBe('位置を登録');
    button(element, 'dialog-location').click();
    expect(spies.onOpenLocation).toHaveBeenCalledWith(patient.id);
  });

  it('位置が登録済みなら「位置を確かめる・やり直す」', () => {
    const withLocation = { ...patient, location: { lat: 35, lng: 139, accuracy: 12, recordedAt: '2026-09-22T00:00:00.000Z', source: 'gps' as const } };
    const state = createInitialState([withLocation]);
    const element = renderDialog(openRowMenu(state, withLocation.id), handlers())!;
    expect(button(element, 'dialog-location').textContent).toBe('位置を確かめる・やり直す');
  });
});

describe('renderDialog: 削除の確認', () => {
  const open = (spies = handlers()) => renderDialog(openDeleteConfirm(base(), patient.id), spies)!;

  it('「この訪問先を削除しますか?」と、対象の名前を出す', () => {
    const element = open();
    expect(element.querySelector('#dialog-title')?.textContent).toBe('この訪問先を削除しますか?');
    expect(element.querySelector('[data-testid="dialog-target"]')?.textContent).toBe('山田 太郎');
  });

  it('キャンセルと削除の2つだけを出す', () => {
    const element = open();
    expect(button(element, 'dialog-cancel').textContent).toBe('キャンセル');
    expect(button(element, 'dialog-confirm-delete').textContent).toBe('削除');
    expect([...element.querySelectorAll('button')]).toHaveLength(2);
  });

  it('削除ボタンは赤(danger-fill)で表示する', () => {
    expect(button(open(), 'dialog-confirm-delete').classList.contains('danger-fill')).toBe(true);
  });

  it('削除を押すと、訪問先のidつきで onConfirmDelete が呼ばれる', () => {
    const spies = handlers();
    button(open(spies), 'dialog-confirm-delete').click();
    expect(spies.onConfirmDelete).toHaveBeenCalledWith(patient.id);
  });

  it('キャンセルを押すと、削除せずに onClose が呼ばれる', () => {
    const spies = handlers();
    button(open(spies), 'dialog-cancel').click();
    expect(spies.onClose).toHaveBeenCalledTimes(1);
    expect(spies.onConfirmDelete).not.toHaveBeenCalled();
  });
});

describe('renderDialog: 複数選択の一括削除の確認', () => {
  const stateWithTwoSelected = () => {
    const patients = [createPatient('山田 太郎', '東京都'), createPatient('鈴木 花子', '大阪府')];
    let state = createInitialState(patients);
    state = toggleSelection(state, patients[0]!.id);
    state = toggleSelection(state, patients[1]!.id);
    return openDeleteSelectedConfirm(state);
  };
  const open = (spies = handlers()) => renderDialog(stateWithTwoSelected(), spies)!;

  it('「選択した◯件を削除しますか?」と件数を出す', () => {
    expect(open().querySelector('#dialog-title')?.textContent).toBe('選択した2件を削除しますか?');
  });

  it('キャンセルと削除の2つだけを出す', () => {
    const element = open();
    expect(button(element, 'dialog-cancel').textContent).toBe('キャンセル');
    expect(button(element, 'dialog-confirm-delete-selected').textContent).toBe('削除');
    expect([...element.querySelectorAll('button')]).toHaveLength(2);
  });

  it('削除を押すと onConfirmDeleteSelected が呼ばれる', () => {
    const spies = handlers();
    button(open(spies), 'dialog-confirm-delete-selected').click();
    expect(spies.onConfirmDeleteSelected).toHaveBeenCalledTimes(1);
  });

  it('キャンセルを押すと、削除せずに onClose が呼ばれる', () => {
    const spies = handlers();
    button(open(spies), 'dialog-cancel').click();
    expect(spies.onClose).toHaveBeenCalledTimes(1);
    expect(spies.onConfirmDeleteSelected).not.toHaveBeenCalled();
  });
});

describe('renderDialog: アクセシビリティ', () => {
  it('role=dialog、aria-modal=true で、見出しが名前になる', () => {
    const element = renderDialog(openRowMenu(base(), patient.id), handlers())!;
    const dialog = element.querySelector('[data-testid="dialog"]')!;
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const labelledBy = dialog.getAttribute('aria-labelledby')!;
    expect(element.querySelector(`#${labelledBy}`)?.textContent).toBe('山田 太郎');
  });

  it('Tabキーでフォーカスがダイアログの外へ出ない(最後の次は最初へ)', () => {
    const element = renderDialog(openRowMenu(base(), patient.id), handlers())!;
    document.body.append(element);
    try {
      const buttons = [...element.querySelectorAll<HTMLButtonElement>('button')];
      const last = buttons[buttons.length - 1]!;
      last.focus();
      const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
      last.dispatchEvent(event);
      expect(document.activeElement).toBe(buttons[0]);
      expect(event.defaultPrevented).toBe(true);
    } finally {
      element.remove();
    }
  });

  it('Shift+Tabで、最初の前は最後へ戻る', () => {
    const element = renderDialog(openRowMenu(base(), patient.id), handlers())!;
    document.body.append(element);
    try {
      const buttons = [...element.querySelectorAll<HTMLButtonElement>('button')];
      const first = buttons[0]!;
      first.focus();
      const event = new KeyboardEvent('keydown', {
        key: 'Tab',
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      });
      first.dispatchEvent(event);
      expect(document.activeElement).toBe(buttons[buttons.length - 1]);
      expect(event.defaultPrevented).toBe(true);
    } finally {
      element.remove();
    }
  });

  it('途中のボタンでのTabキーは、そのまま(ブラウザの動作に任せる)', () => {
    const element = renderDialog(openRowMenu(base(), patient.id), handlers())!;
    document.body.append(element);
    try {
      const buttons = [...element.querySelectorAll<HTMLButtonElement>('button')];
      buttons[1]!.focus();
      const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
      buttons[1]!.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    } finally {
      element.remove();
    }
  });
});

describe('renderDialog: 訪問順の「⋯」', () => {
  it('訪問順の「⋯」: 先頭へ / 最後へ / キャンセル', () => {
    const patients = [createPatient('山田 太郎', '東京都'), createPatient('鈴木 花子', '大阪府')];
    const state = {
      ...createInitialState(patients),
      selectedIds: patients.map((p) => p.id),
      dialog: { kind: 'stopMenu' as const, id: patients[1]!.id },
    };
    const spies = handlers();
    const element = renderDialog(state, spies)!;
    element.querySelector<HTMLButtonElement>('[data-testid="dialog-move-top"]')!.click();
    expect(spies.onMoveToTop).toHaveBeenCalledWith(patients[1]!.id);
    element.querySelector<HTMLButtonElement>('[data-testid="dialog-move-bottom"]')!.click();
    expect(spies.onMoveToBottom).toHaveBeenCalledWith(patients[1]!.id);
  });
});

describe('renderDialog: 同じ人の知らせ', () => {
  it('同じ人の知らせ: 見つかった人を出し、そのまま登録/登録済みを開く/戻って直す', () => {
    const existing = createPatient('山田 太郎', '東京都1-2-3');
    const state = {
      ...createInitialState([existing]),
      dialog: {
        kind: 'similar' as const,
        input: { name: '山田太郎', address: '大阪府', phone: '', parkingType: '' as const, permitExpires: '', note: '' },
        matchIds: [existing.id],
        continueAfter: false,
      },
    };
    const spies = handlers();
    const element = renderDialog(state, spies)!;
    expect(element.textContent).toContain('同じ名前か住所の訪問先があります');
    expect(element.textContent).toContain('山田 太郎');
    element.querySelector<HTMLButtonElement>('[data-testid="dialog-save-anyway"]')!.click();
    expect(spies.onSaveAnyway).toHaveBeenCalled();
    element.querySelector<HTMLButtonElement>('[data-testid="dialog-open-existing"]')!.click();
    expect(spies.onOpenExisting).toHaveBeenCalledWith(existing.id);
    element.querySelector<HTMLButtonElement>('[data-testid="dialog-cancel"]')!.click();
    expect(spies.onClose).toHaveBeenCalled();
  });
});

describe('renderDialog: 位置の登録ダイアログ', () => {
  it('location ダイアログが描かれ、見出しは名前つき', () => {
    const state = {
      ...base(),
      dialog: {
        kind: 'location' as const,
        id: patient.id,
        phase: 'idle' as const,
        best: null,
        error: null,
        pasteText: '',
        pasteError: null,
        pasteOpen: false,
        previous: null,
      },
    };
    const element = renderDialog(state, handlers())!;
    expect(element.querySelector('#dialog-title')?.textContent).toBe('山田 太郎の位置');
    expect(element.querySelector('[data-testid="location-measure-button"]')).not.toBeNull();
  });

  it('対象の訪問先が見つからなければ null', () => {
    const state = {
      ...base(),
      dialog: {
        kind: 'location' as const,
        id: 'unknown-id',
        phase: 'idle' as const,
        best: null,
        error: null,
        pasteText: '',
        pasteError: null,
        pasteOpen: false,
        previous: null,
      },
    };
    expect(renderDialog(state, handlers())).toBeNull();
  });
});

describe('renderDialog: 写真のダイアログ', () => {
  const open = (index: number, urls: string[] = ['blob:1', 'blob:2', 'blob:3'], spies = handlers()) =>
    renderDialog(
      { ...base(), dialog: { kind: 'photos' as const, patientId: patient.id, urls, index } },
      spies,
    )!;

  it('urls[index] を photo-view に出す', () => {
    const element = open(1);
    expect(element.querySelector<HTMLImageElement>('[data-testid="photo-view"]')?.src).toBe('blob:2');
  });

  it('「N / M」の件数表示と、閉じるボタンを出す', () => {
    const element = open(1);
    expect(element.textContent).toContain('2 / 3');
    expect(button(element, 'dialog-cancel').textContent).toBe('閉じる');
    button(element, 'dialog-cancel').click();
  });

  it('前/次を押すと、隣のindexで onPhotoIndex が呼ばれる', () => {
    const spies = handlers();
    const element = open(1, undefined, spies);
    button(element, 'photo-prev').click();
    expect(spies.onPhotoIndex).toHaveBeenCalledWith(0);
    button(element, 'photo-next').click();
    expect(spies.onPhotoIndex).toHaveBeenCalledWith(2);
  });

  it('先頭では前が、末尾では次が押せない', () => {
    const first = open(0);
    expect(button(first, 'photo-prev').disabled).toBe(true);
    expect(button(first, 'photo-next').disabled).toBe(false);
    const last = open(2);
    expect(button(last, 'photo-next').disabled).toBe(true);
    expect(button(last, 'photo-prev').disabled).toBe(false);
  });
});

describe('renderDialog: 背景', () => {
  it('ダイアログの外側(背景)を押すと onClose が呼ばれる', () => {
    const spies = handlers();
    const element = renderDialog(openRowMenu(base(), patient.id), spies)!;
    element.click();
    expect(spies.onClose).toHaveBeenCalledTimes(1);
  });

  it('ダイアログの内側を押しても、閉じない', () => {
    const spies = handlers();
    const element = renderDialog(openRowMenu(base(), patient.id), spies)!;
    element.querySelector<HTMLElement>('#dialog-title')!.click();
    element.querySelector<HTMLElement>('[data-testid="dialog"]')!.click();
    expect(spies.onClose).not.toHaveBeenCalled();
  });
});
