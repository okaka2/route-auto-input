import { describe, expect, it, vi } from 'vitest';
import { createPatient } from '../src/patient';
import { renderPatientForm, type PatientFormHandlers } from '../src/views/patientFormView';

const handlers = (): PatientFormHandlers => ({ onSave: vi.fn(), onCancel: vi.fn() });

const nameInput = (element: HTMLElement) =>
  element.querySelector<HTMLInputElement>('[data-testid="name-input"]')!;
const addressInput = (element: HTMLElement) =>
  element.querySelector<HTMLInputElement>('[data-testid="address-input"]')!;

describe('renderPatientForm', () => {
  it('新規登録では入力欄が空になる', () => {
    const element = renderPatientForm(null, null, null, handlers());
    expect(nameInput(element).value).toBe('');
    expect(addressInput(element).value).toBe('');
    expect(element.textContent).toContain('新規登録');
  });

  it('編集では既存の値が入る', () => {
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    const element = renderPatientForm(patient, null, null, handlers());
    expect(nameInput(element).value).toBe('山田 太郎');
    expect(addressInput(element).value).toBe('東京都千代田区1-1');
    expect(element.textContent).toContain('編集');
  });

  it('保存ボタンで入力値がonSaveに渡る', () => {
    const spies = handlers();
    const element = renderPatientForm(null, null, null, spies);
    nameInput(element).value = '鈴木 花子';
    addressInput(element).value = '大阪市北区2-2';
    element.querySelector<HTMLButtonElement>('[data-testid="save-button"]')?.click();
    expect(spies.onSave).toHaveBeenCalledWith('鈴木 花子', '大阪市北区2-2');
  });

  it('キャンセルボタンでonCancelが呼ばれる', () => {
    const spies = handlers();
    const element = renderPatientForm(null, null, null, spies);
    element.querySelector<HTMLButtonElement>('[data-testid="cancel-button"]')?.click();
    expect(spies.onCancel).toHaveBeenCalled();
  });

  it('住所が空のとき地図確認リンクは無効になる', () => {
    const element = renderPatientForm(null, null, null, handlers());
    const link = element.querySelector<HTMLAnchorElement>('[data-testid="map-check-link"]')!;
    expect(link.hasAttribute('href')).toBe(false);
  });

  it('住所を入力すると地図確認リンクが検索URLになる', () => {
    const element = renderPatientForm(null, null, null, handlers());
    const address = addressInput(element);
    address.value = '東京都千代田区1-1';
    address.dispatchEvent(new Event('input'));
    const link = element.querySelector<HTMLAnchorElement>('[data-testid="map-check-link"]')!;
    const url = new URL(link.href);
    expect(url.origin + url.pathname).toBe('https://www.google.com/maps/search/');
    expect(url.searchParams.get('query')).toBe('東京都千代田区1-1');
  });

  it('地図確認リンクにタップ領域確保用のクラスがつく', () => {
    const element = renderPatientForm(null, null, null, handlers());
    const link = element.querySelector<HTMLAnchorElement>('[data-testid="map-check-link"]')!;
    expect(link.classList.contains('map-check')).toBe(true);
  });

  it('メッセージがあれば表示する', () => {
    const element = renderPatientForm(null, null, { kind: 'error', text: '氏名を入力してください。' }, handlers());
    expect(element.querySelector('.message')?.textContent).toBe('氏名を入力してください。');
  });

  it('メッセージ領域はVoiceOverに読み上げられるようrole=statusを持つ', () => {
    const element = renderPatientForm(null, null, { kind: 'error', text: '氏名を入力してください。' }, handlers());
    expect(element.querySelector('.message')?.getAttribute('role')).toBe('status');
  });

  it('draftがあれば新規登録でもpatientより優先して表示する(入力内容を残す)', () => {
    const draft = { name: '入力途中の氏名', address: '入力途中の住所' };
    const element = renderPatientForm(null, draft, null, handlers());
    expect(nameInput(element).value).toBe('入力途中の氏名');
    expect(addressInput(element).value).toBe('入力途中の住所');
  });

  it('draftがあれば編集中の既存値より優先して表示する', () => {
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    const draft = { name: '編集途中の氏名', address: '' };
    const element = renderPatientForm(patient, draft, null, handlers());
    expect(nameInput(element).value).toBe('編集途中の氏名');
    expect(addressInput(element).value).toBe('');
    // タイトルはdraftではなくpatientの有無で決まる
    expect(element.textContent).toContain('編集');
  });
});
