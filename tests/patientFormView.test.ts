import { describe, expect, it, vi } from 'vitest';
import { createPatient } from '../src/patient';
import { renderPatientForm, type PatientFormHandlers } from '../src/views/patientFormView';

const handlers = (): PatientFormHandlers => ({
  onSave: vi.fn(),
  onSaveAndContinue: vi.fn(),
  onCancel: vi.fn(),
});

const q = <T extends HTMLElement = HTMLElement>(element: HTMLElement, testid: string): T =>
  element.querySelector<T>(`[data-testid="${testid}"]`)!;
const nameInput = (element: HTMLElement) => q<HTMLInputElement>(element, 'name-input');
const addressInput = (element: HTMLElement) => q<HTMLInputElement>(element, 'address-input');
const phoneInput = (element: HTMLElement) => q<HTMLInputElement>(element, 'phone-input');

describe('renderPatientForm: 見出しと入力欄', () => {
  it('新規登録では、見出しが「訪問先を登録」で、入力欄が空になる', () => {
    const element = renderPatientForm(null, null, null, handlers());
    expect(element.querySelector('h1')?.textContent).toBe('訪問先を登録');
    expect(nameInput(element).value).toBe('');
    expect(addressInput(element).value).toBe('');
  });

  it('編集では、見出しが「訪問先を編集」で、既存の値が入る', () => {
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    const element = renderPatientForm(patient, null, null, handlers());
    expect(element.querySelector('h1')?.textContent).toBe('訪問先を編集');
    expect(nameInput(element).value).toBe('山田 太郎');
    expect(addressInput(element).value).toBe('東京都千代田区1-1');
  });

  it('入力欄は、名前・住所・電話番号の3つ', () => {
    const element = renderPatientForm(null, null, null, handlers());
    const inputs = [...element.querySelectorAll('input')];
    expect(inputs).toHaveLength(3);
    expect(inputs.map((input) => input.dataset.testid)).toEqual([
      'name-input',
      'address-input',
      'phone-input',
    ]);
  });

  it('名前と住所は、必須と分かる表示を持つ', () => {
    const element = renderPatientForm(null, null, null, handlers());
    expect(element.querySelectorAll('.required')).toHaveLength(2);
    expect(nameInput(element).getAttribute('aria-required')).toBe('true');
    expect(addressInput(element).getAttribute('aria-required')).toBe('true');
  });

  it('電話番号の入力欄は type=tel で、必須の表示を持たない', () => {
    const element = renderPatientForm(null, null, null, handlers());
    expect(phoneInput(element).type).toBe('tel');
    const labels = [...element.querySelectorAll('.field-label')];
    const phoneLabel = labels.find((label) => label.textContent?.includes('電話番号'));
    expect(phoneLabel?.querySelector('.required')).toBeNull();
    expect(phoneInput(element).hasAttribute('aria-required')).toBe(false);
  });

  it('入力欄のラベルは「名前」「住所」', () => {
    const element = renderPatientForm(null, null, null, handlers());
    const labels = [...element.querySelectorAll('.field-label')].map((label) => label.textContent);
    expect(labels[0]).toContain('名前');
    expect(labels[1]).toContain('住所');
  });

  it('プレースホルダーに入力例を出す', () => {
    const element = renderPatientForm(null, null, null, handlers());
    expect(nameInput(element).placeholder).toContain('山田');
    expect(addressInput(element).placeholder).toContain('東京都');
  });
});

describe('renderPatientForm: 保存とキャンセル', () => {
  it('見出しの行の左に「キャンセル」、右に「保存」がある', () => {
    const element = renderPatientForm(null, null, null, handlers());
    const header = element.querySelector('.form-header')!;
    expect(header.firstElementChild).toBe(q(element, 'cancel-button'));
    expect(header.lastElementChild).toBe(q(element, 'save-button'));
    expect(q(element, 'cancel-button').textContent).toBe('キャンセル');
    expect(q(element, 'save-button').textContent).toBe('保存');
  });

  it('保存ボタンで、入力値が onSave に渡る', () => {
    const spies = handlers();
    const element = renderPatientForm(null, null, null, spies);
    nameInput(element).value = '鈴木 花子';
    addressInput(element).value = '大阪市北区2-2';
    phoneInput(element).value = '03-1234-5678';
    q<HTMLButtonElement>(element, 'save-button').click();
    expect(spies.onSave).toHaveBeenCalledWith('鈴木 花子', '大阪市北区2-2', '03-1234-5678');
  });

  it('キャンセルボタンで onCancel が呼ばれる', () => {
    const spies = handlers();
    const element = renderPatientForm(null, null, null, spies);
    q<HTMLButtonElement>(element, 'cancel-button').click();
    expect(spies.onCancel).toHaveBeenCalled();
  });

  it('新規のときだけ「保存して続けて登録」を入力欄の下に出し、押すと onSaveAndContinue', () => {
    const spies = handlers();
    const element = renderPatientForm(null, null, null, spies);
    nameInput(element).value = '山田';
    addressInput(element).value = '東京都';
    q<HTMLButtonElement>(element, 'save-continue-button').click();
    expect(spies.onSaveAndContinue).toHaveBeenCalledWith('山田', '東京都', '');
    expect(
      renderPatientForm(createPatient('a', 'b'), null, null, handlers()).querySelector(
        '[data-testid="save-continue-button"]',
      ),
    ).toBeNull();
  });

  it('キャンセルは、入力中の値を渡す', () => {
    const spies = handlers();
    const element = renderPatientForm(null, null, null, spies);
    nameInput(element).value = '途中';
    q<HTMLButtonElement>(element, 'cancel-button').click();
    expect(spies.onCancel).toHaveBeenCalledWith('途中', '', '');
  });
});

describe('renderPatientForm: 住所の地図での確認', () => {
  it('住所が空のとき、地図確認リンクは無効になる(href が無い)', () => {
    const element = renderPatientForm(null, null, null, handlers());
    expect(q<HTMLAnchorElement>(element, 'map-check-link').hasAttribute('href')).toBe(false);
  });

  it('住所を入力すると、地図確認リンクが検索URLになる', () => {
    const element = renderPatientForm(null, null, null, handlers());
    const address = addressInput(element);
    address.value = '東京都千代田区1-1';
    address.dispatchEvent(new Event('input'));
    const url = new URL(q<HTMLAnchorElement>(element, 'map-check-link').href);
    expect(url.origin + url.pathname).toBe('https://www.google.com/maps/search/');
    expect(url.searchParams.get('query')).toBe('東京都千代田区1-1');
  });

  it('リンクの文言は、地図サービスの名前から作る', () => {
    const element = renderPatientForm(null, null, null, handlers());
    expect(q(element, 'map-check-link').textContent).toBe('この住所をGoogleマップで確認');
  });

  it('地図確認リンクにタップ領域確保用のクラスがつく', () => {
    const element = renderPatientForm(null, null, null, handlers());
    expect(q(element, 'map-check-link').classList.contains('map-check')).toBe(true);
  });
});

describe('renderPatientForm: メッセージと下書き', () => {
  it('メッセージがあれば表示する', () => {
    const element = renderPatientForm(null, null, { kind: 'error', text: '名前を入力してください。' }, handlers());
    expect(element.querySelector('.message')?.textContent).toBe('名前を入力してください。');
  });

  it('メッセージ領域は VoiceOver に読み上げられるよう role=status を持つ', () => {
    const element = renderPatientForm(null, null, { kind: 'error', text: '名前を入力してください。' }, handlers());
    expect(element.querySelector('.message')?.getAttribute('role')).toBe('status');
  });

  it('draft があれば、新規登録でも patient より優先して表示する(入力内容を残す)', () => {
    const draft = { name: '入力途中の名前', address: '入力途中の住所', phone: '090-0000-0000' };
    const element = renderPatientForm(null, draft, null, handlers());
    expect(nameInput(element).value).toBe('入力途中の名前');
    expect(addressInput(element).value).toBe('入力途中の住所');
    expect(phoneInput(element).value).toBe('090-0000-0000');
  });

  it('draft があれば、編集中の既存値より優先して表示する', () => {
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    const draft = { name: '編集途中の名前', address: '', phone: '' };
    const element = renderPatientForm(patient, draft, null, handlers());
    expect(nameInput(element).value).toBe('編集途中の名前');
    expect(addressInput(element).value).toBe('');
    // 見出しは draft ではなく patient の有無で決まる
    expect(element.querySelector('h1')?.textContent).toBe('訪問先を編集');
  });
});
