import { describe, expect, it, vi } from 'vitest';
import { createPatient } from '../src/patient';
import type { LocationDialog, Patient } from '../src/types';
import { renderLocationDialog, type LocationDialogHandlers } from '../src/views/locationDialog';

function patient(overrides: Partial<Patient> = {}): Patient {
  return {
    ...createPatient('山田 太郎', '東京都千代田区1-1', new Date('2026-09-01T00:00:00.000Z')),
    ...overrides,
  };
}

function registeredPatient(overrides: Partial<Patient> = {}): Patient {
  return patient({
    location: { lat: 35, lng: 139, accuracy: 8, recordedAt: '2026-09-22T01:00:00.000Z', source: 'gps' },
    ...overrides,
  });
}

function dialog(overrides: Partial<LocationDialog> = {}): LocationDialog {
  return {
    kind: 'location',
    id: 'p1',
    phase: 'idle',
    best: null,
    error: null,
    pasteText: '',
    pasteError: null,
    pasteOpen: false,
    previous: null,
    ...overrides,
  };
}

function handlers(): LocationDialogHandlers {
  return {
    onStartMeasuring: vi.fn(),
    onSaveMeasured: vi.fn(),
    onPasteChange: vi.fn(),
    onPasteToggle: vi.fn(),
    onSavePasted: vi.fn(),
    onRemove: vi.fn(),
    onUndo: vi.fn(),
    onClose: vi.fn(),
  };
}

function wrap(elements: HTMLElement[]): HTMLElement {
  const div = document.createElement('div');
  div.append(...elements);
  return div;
}

const q = <T extends HTMLElement = HTMLElement>(element: HTMLElement, testid: string): T =>
  element.querySelector<T>(`[data-testid="${testid}"]`)!;

describe('renderLocationDialog: 見出し・閉じる', () => {
  it('見出しは「◯◯の位置」', () => {
    const el = wrap(renderLocationDialog(patient(), dialog(), handlers()));
    expect(el.querySelector('#dialog-title')?.textContent).toBe('山田 太郎の位置');
  });

  it('閉じるボタンを出し、押すと onClose が呼ばれる', () => {
    const spies = handlers();
    const el = wrap(renderLocationDialog(patient(), dialog(), spies));
    q<HTMLButtonElement>(el, 'dialog-cancel').click();
    expect(spies.onClose).toHaveBeenCalledTimes(1);
  });
});

describe('renderLocationDialog: idle', () => {
  it('「今いる場所で登録」(primary)と注意書きを出し、押すと onStartMeasuring', () => {
    const spies = handlers();
    const el = wrap(renderLocationDialog(patient(), dialog({ phase: 'idle' }), spies));
    const button = q<HTMLButtonElement>(el, 'location-measure-button');
    expect(button.textContent).toBe('今いる場所で登録');
    expect(button.classList.contains('primary')).toBe(true);
    expect(el.textContent).toContain('停車してから押してください。車の外や屋外のほうが正確です。');
    button.click();
    expect(spies.onStartMeasuring).toHaveBeenCalledTimes(1);
  });

  it('measure-save ボタンは出さない', () => {
    const el = wrap(renderLocationDialog(patient(), dialog({ phase: 'idle' }), handlers()));
    expect(el.querySelector('[data-testid="location-save-button"]')).toBeNull();
  });
});

describe('renderLocationDialog: measuring', () => {
  it('誤差を出し、20m以内なら「登録できます」、保存ボタンが押せる', () => {
    const el = wrap(
      renderLocationDialog(patient(), dialog({ phase: 'measuring', best: { lat: 35, lng: 139, accuracy: 12 } }), handlers()),
    );
    expect(el.textContent).toContain('誤差 ±12m');
    expect(el.textContent).toContain('登録できます');
    expect(q<HTMLButtonElement>(el, 'location-save-button').disabled).toBe(false);
  });

  it('50m以上なら屋外でやり直す案内を出す', () => {
    const el = wrap(
      renderLocationDialog(patient(), dialog({ phase: 'measuring', best: { lat: 35, lng: 139, accuracy: 60 } }), handlers()),
    );
    expect(el.textContent).toContain('誤差 ±60m');
    expect(el.textContent).toContain('車の外や屋外で、もう一度試してください。');
    expect(el.textContent).not.toContain('登録できます');
  });

  it('best が無ければ「位置を取得しています…」だけを出し、保存ボタンは押せない', () => {
    const el = wrap(renderLocationDialog(patient(), dialog({ phase: 'measuring', best: null }), handlers()));
    expect(el.textContent).toContain('位置を取得しています…');
    expect(el.textContent).not.toContain('誤差');
    expect(q<HTMLButtonElement>(el, 'location-save-button').disabled).toBe(true);
  });

  it('保存ボタンを押すと onSaveMeasured が呼ばれる', () => {
    const spies = handlers();
    const el = wrap(
      renderLocationDialog(patient(), dialog({ phase: 'measuring', best: { lat: 35, lng: 139, accuracy: 12 } }), spies),
    );
    q<HTMLButtonElement>(el, 'location-save-button').click();
    expect(spies.onSaveMeasured).toHaveBeenCalledTimes(1);
  });

  it('もう一度測るボタンは、measuring では出さない', () => {
    const el = wrap(
      renderLocationDialog(patient(), dialog({ phase: 'measuring', best: { lat: 35, lng: 139, accuracy: 12 } }), handlers()),
    );
    expect([...el.querySelectorAll('[data-testid="location-measure-button"]')]).toHaveLength(0);
  });
});

describe('renderLocationDialog: measured', () => {
  it('保存ボタンと「もう一度測る」ボタンを出す', () => {
    const spies = handlers();
    const el = wrap(
      renderLocationDialog(patient(), dialog({ phase: 'measured', best: { lat: 35, lng: 139, accuracy: 12 } }), spies),
    );
    expect(el.textContent).toContain('誤差 ±12m');
    expect(el.textContent).toContain('登録できます');
    const remeasure = q<HTMLButtonElement>(el, 'location-measure-button');
    expect(remeasure.textContent).toBe('もう一度測る');
    remeasure.click();
    expect(spies.onStartMeasuring).toHaveBeenCalledTimes(1);
  });
});

describe('renderLocationDialog: error', () => {
  it('error を表示し、「もう一度測る」ボタンを出す', () => {
    const spies = handlers();
    const el = wrap(renderLocationDialog(patient(), dialog({ phase: 'error', error: '位置を取得できませんでした。' }), spies));
    expect(el.textContent).toContain('位置を取得できませんでした。');
    const button = q<HTMLButtonElement>(el, 'location-measure-button');
    expect(button.textContent).toBe('もう一度測る');
    button.click();
    expect(spies.onStartMeasuring).toHaveBeenCalledTimes(1);
  });

  it('保存ボタンは出さない', () => {
    const el = wrap(renderLocationDialog(patient(), dialog({ phase: 'error', error: 'x' }), handlers()));
    expect(el.querySelector('[data-testid="location-save-button"]')).toBeNull();
  });
});

describe('renderLocationDialog: saved', () => {
  it('地図で確かめる・元に戻す・閉じるを出す', () => {
    const spies = handlers();
    const saved = registeredPatient();
    const el = wrap(renderLocationDialog(saved, dialog({ phase: 'saved', previous: null }), spies));
    expect(el.textContent).toContain('登録しました(誤差 ±8m)');
    expect(el.querySelector('.location-status')?.classList.contains('good')).toBe(true);
    const link = q<HTMLAnchorElement>(el, 'location-check-link');
    expect(link.getAttribute('href')).toContain('api=1&query=35.000000%2C139.000000');
    expect(link.target).toBe('_blank');
    expect(link.rel).toContain('noreferrer');
    q<HTMLButtonElement>(el, 'location-undo-button').click();
    expect(spies.onUndo).toHaveBeenCalledTimes(1);
    q<HTMLButtonElement>(el, 'dialog-cancel').click();
    expect(spies.onClose).toHaveBeenCalledTimes(1);
  });

  it('saved のときは貼り付け欄と「位置を消す」を出さない', () => {
    const el = wrap(renderLocationDialog(registeredPatient(), dialog({ phase: 'saved' }), handlers()));
    expect(el.querySelector('[data-testid="location-paste-input"]')).toBeNull();
    expect(el.querySelector('[data-testid="location-remove-button"]')).toBeNull();
  });

  it('精度が分からない(貼り付け)ときは「誤差」を付けずに「登録しました(貼り付けた位置)」', () => {
    const saved = patient({
      location: { lat: 35, lng: 139, accuracy: null, recordedAt: '2026-09-22T01:00:00.000Z', source: 'paste' },
    });
    const el = wrap(renderLocationDialog(saved, dialog({ phase: 'saved' }), handlers()));
    expect(el.textContent).toContain('登録しました(貼り付けた位置)');
    expect(el.textContent).not.toContain('誤差');
  });

  it('精度が良くない(poor)ときは赤の表示にする', () => {
    const saved = patient({
      location: { lat: 35, lng: 139, accuracy: 60, recordedAt: '2026-09-22T01:00:00.000Z', source: 'gps' },
    });
    const el = wrap(renderLocationDialog(saved, dialog({ phase: 'saved' }), handlers()));
    expect(el.textContent).toContain('登録しました(誤差 ±60m)');
    expect(el.querySelector('.location-status')?.classList.contains('poor')).toBe(true);
  });

  it('精度がふつう(fair)のときは、goodにもpoorにもしない', () => {
    const saved = patient({
      location: { lat: 35, lng: 139, accuracy: 30, recordedAt: '2026-09-22T01:00:00.000Z', source: 'gps' },
    });
    const el = wrap(renderLocationDialog(saved, dialog({ phase: 'saved' }), handlers()));
    const status = el.querySelector('.location-status')!;
    expect(status.classList.contains('good')).toBe(false);
    expect(status.classList.contains('poor')).toBe(false);
  });
});

describe('renderLocationDialog: 貼り付け欄', () => {
  it('値は dialog.pasteText、入力のたび onPasteChange、エラーがあれば表示する', () => {
    const spies = handlers();
    const el = wrap(
      renderLocationDialog(
        patient(),
        dialog({ pasteText: '35,139', pasteError: '座標またはGoogleマップのURLを読み取れませんでした。' }),
        spies,
      ),
    );
    const input = q<HTMLInputElement>(el, 'location-paste-input');
    expect(input.value).toBe('35,139');
    input.value = '35.1, 139.1';
    input.dispatchEvent(new Event('input'));
    expect(spies.onPasteChange).toHaveBeenCalledWith('35.1, 139.1');
    expect(el.textContent).toContain('座標またはGoogleマップのURLを読み取れませんでした。');
  });

  it('折りたたみの中に「貼り付けた位置で登録」を出し、押すと onSavePasted', () => {
    const spies = handlers();
    const el = wrap(renderLocationDialog(patient(), dialog(), spies));
    expect(el.textContent).toContain('座標やURLを貼り付けて登録');
    q<HTMLButtonElement>(el, 'location-paste-save').click();
    expect(spies.onSavePasted).toHaveBeenCalledTimes(1);
  });

  it('エラーが無ければ表示しない', () => {
    const el = wrap(renderLocationDialog(patient(), dialog({ pasteError: null }), handlers()));
    const details = el.querySelector('.location-paste')!;
    expect(details.querySelectorAll('p')).toHaveLength(0);
  });

  it('入力欄には名前(aria-label)と例のplaceholderを付ける', () => {
    const el = wrap(renderLocationDialog(patient(), dialog(), handlers()));
    const input = q<HTMLInputElement>(el, 'location-paste-input');
    expect(input.getAttribute('aria-label')).toBe('座標またはGoogleマップのURL');
    expect(input.placeholder).toBe('例) 35.68124, 139.76712');
  });

  it('pasteOpen/入力中/エラー中でなければ、折りたたみは閉じている', () => {
    const el = wrap(
      renderLocationDialog(patient(), dialog({ pasteOpen: false, pasteText: '', pasteError: null }), handlers()),
    );
    const details = el.querySelector<HTMLDetailsElement>('.location-paste')!;
    expect(details.open).toBe(false);
  });

  it('pasteOpen が true なら、入力が空でも開いたまま', () => {
    const el = wrap(renderLocationDialog(patient(), dialog({ pasteOpen: true }), handlers()));
    const details = el.querySelector<HTMLDetailsElement>('.location-paste')!;
    expect(details.open).toBe(true);
  });

  it('入力中(pasteText非空)やエラー中は、pasteOpenがfalseでも開いたまま', () => {
    const typing = wrap(renderLocationDialog(patient(), dialog({ pasteOpen: false, pasteText: '35' }), handlers()));
    expect(typing.querySelector<HTMLDetailsElement>('.location-paste')!.open).toBe(true);

    const erroring = wrap(
      renderLocationDialog(patient(), dialog({ pasteOpen: false, pasteError: '読み取れませんでした。' }), handlers()),
    );
    expect(erroring.querySelector<HTMLDetailsElement>('.location-paste')!.open).toBe(true);
  });

  it('開閉(toggle)すると onPasteToggle が呼ばれる', () => {
    const spies = handlers();
    const el = wrap(renderLocationDialog(patient(), dialog(), spies));
    const details = el.querySelector<HTMLDetailsElement>('.location-paste')!;
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
    expect(spies.onPasteToggle).toHaveBeenCalledWith(true);
  });
});

describe('renderLocationDialog: 登録済みの表示', () => {
  it('登録済みなら「位置を消す」と、登録日・誤差・地図で確かめるを出す', () => {
    const spies = handlers();
    const el = wrap(renderLocationDialog(registeredPatient(), dialog({ phase: 'idle' }), spies));
    expect(el.textContent).toContain('登録済み: 誤差 ±8m(9/22 登録)');
    expect(el.querySelector('[data-testid="location-check-link"]')).not.toBeNull();
    const remove = q<HTMLButtonElement>(el, 'location-remove-button');
    expect(remove.textContent).toBe('位置を消す');
    expect(remove.classList.contains('danger')).toBe(true);
    remove.click();
    expect(spies.onRemove).toHaveBeenCalledTimes(1);
  });

  it('未登録なら「位置を消す」も登録済みの表示も出さない', () => {
    const el = wrap(renderLocationDialog(patient(), dialog({ phase: 'idle' }), handlers()));
    expect(el.querySelector('[data-testid="location-remove-button"]')).toBeNull();
    expect(el.querySelector('[data-testid="location-check-link"]')).toBeNull();
    expect(el.textContent).not.toContain('登録済み');
  });
});
