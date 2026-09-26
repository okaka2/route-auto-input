import { describe, expect, it, vi } from 'vitest';
import { createPatient } from '../src/patient';
import type { PatientFormDraft } from '../src/types';
import { renderPatientForm, type PatientFormHandlers } from '../src/views/patientFormView';

const handlers = (): PatientFormHandlers => ({
  onSave: vi.fn(),
  onSaveAndContinue: vi.fn(),
  onCancel: vi.fn(),
  onAddPhoto: vi.fn(),
  onDeletePhoto: vi.fn(),
});

const q = <T extends HTMLElement = HTMLElement>(element: HTMLElement, testid: string): T =>
  element.querySelector<T>(`[data-testid="${testid}"]`)!;
const nameInput = (element: HTMLElement) => q<HTMLInputElement>(element, 'name-input');
const addressInput = (element: HTMLElement) => q<HTMLInputElement>(element, 'address-input');
const phoneInput = (element: HTMLElement) => q<HTMLInputElement>(element, 'phone-input');
const parkingSelect = (element: HTMLElement) => q<HTMLSelectElement>(element, 'parking-select');
const permitExpiresInput = (element: HTMLElement) => q<HTMLInputElement>(element, 'permit-expires-input');
const noteInput = (element: HTMLElement) => q<HTMLTextAreaElement>(element, 'note-input');
const permitField = (element: HTMLElement) => permitExpiresInput(element).closest('label')! as HTMLLabelElement;

const emptyDraft: PatientFormDraft = { name: '', address: '', phone: '', parkingType: '', permitExpires: '', note: '' };

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

  it('input要素は、名前・住所・電話番号・許可証の期限の4つ', () => {
    const element = renderPatientForm(null, null, null, handlers());
    const inputs = [...element.querySelectorAll('input')];
    expect(inputs.map((input) => input.dataset.testid)).toEqual([
      'name-input',
      'address-input',
      'phone-input',
      'permit-expires-input',
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

  it('保存ボタンで、入力値のまとまりが onSave に渡る', () => {
    const spies = handlers();
    const element = renderPatientForm(null, null, null, spies);
    nameInput(element).value = '鈴木 花子';
    addressInput(element).value = '大阪市北区2-2';
    phoneInput(element).value = '03-1234-5678';
    q<HTMLButtonElement>(element, 'save-button').click();
    expect(spies.onSave).toHaveBeenCalledWith(
      expect.objectContaining({ name: '鈴木 花子', address: '大阪市北区2-2', phone: '03-1234-5678' }),
    );
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
    expect(spies.onSaveAndContinue).toHaveBeenCalledWith(
      expect.objectContaining({ name: '山田', address: '東京都', phone: '' }),
    );
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
    expect(spies.onCancel).toHaveBeenCalledWith(
      expect.objectContaining({ name: '途中', address: '', phone: '' }),
    );
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
    const draft: PatientFormDraft = { ...emptyDraft, name: '入力途中の名前', address: '入力途中の住所', phone: '090-0000-0000' };
    const element = renderPatientForm(null, draft, null, handlers());
    expect(nameInput(element).value).toBe('入力途中の名前');
    expect(addressInput(element).value).toBe('入力途中の住所');
    expect(phoneInput(element).value).toBe('090-0000-0000');
  });

  it('draft があれば、編集中の既存値より優先して表示する', () => {
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    const draft: PatientFormDraft = { ...emptyDraft, name: '編集途中の名前' };
    const element = renderPatientForm(patient, draft, null, handlers());
    expect(nameInput(element).value).toBe('編集途中の名前');
    expect(addressInput(element).value).toBe('');
    // 見出しは draft ではなく patient の有無で決まる
    expect(element.querySelector('h1')?.textContent).toBe('訪問先を編集');
  });
});

describe('renderPatientForm: 訪問のための情報(駐車・メモ)', () => {
  it('見出し「訪問のための情報」を出す', () => {
    const element = renderPatientForm(null, null, null, handlers());
    expect(element.querySelector('.visit-info h2')?.textContent).toBe('訪問のための情報');
  });

  it('駐車の選択肢に、未設定・敷地内OK・コインパーキング・路上(許可証あり)・管理会社に許可済み・不明を持つ', () => {
    const element = renderPatientForm(null, null, null, handlers());
    const options = [...parkingSelect(element).options].map((option) => option.textContent);
    expect(options).toEqual(['未設定', '敷地内OK', 'コインパーキング', '路上(許可証あり)', '管理会社に許可済み', '不明']);
  });

  it('既定は未設定で、許可証の期限は隠れている', () => {
    const element = renderPatientForm(null, null, null, handlers());
    expect(parkingSelect(element).value).toBe('');
    expect(permitField(element).hidden).toBe(true);
  });

  it('駐車を「路上(許可証あり)」にすると、許可証の期限の欄が現れる', () => {
    const element = renderPatientForm(null, null, null, handlers());
    parkingSelect(element).value = 'street_permit';
    parkingSelect(element).dispatchEvent(new Event('change'));
    expect(permitField(element).hidden).toBe(false);
    expect(permitExpiresInput(element).type).toBe('date');
  });

  it('別の駐車の種類に変えても、許可証の期限に入力した値は保たれる(隠れるだけ)', () => {
    const element = renderPatientForm(null, null, null, handlers());
    parkingSelect(element).value = 'street_permit';
    parkingSelect(element).dispatchEvent(new Event('change'));
    permitExpiresInput(element).value = '2027-03-31';
    parkingSelect(element).value = 'coin';
    parkingSelect(element).dispatchEvent(new Event('change'));
    expect(permitField(element).hidden).toBe(true);
    expect(permitExpiresInput(element).value).toBe('2027-03-31');
  });

  it('編集中の患者に路上(許可証あり)が登録されていれば、最初から期限の欄が見える', () => {
    const patient = { ...createPatient('山田', '東京都'), parking: { type: 'street_permit' as const, permitExpires: '2027-03-31' } };
    const element = renderPatientForm(patient, null, null, handlers());
    expect(permitField(element).hidden).toBe(false);
    expect(permitExpiresInput(element).value).toBe('2027-03-31');
  });

  it('メモは textarea で、プレースホルダーを持つ', () => {
    const element = renderPatientForm(null, null, null, handlers());
    expect(noteInput(element).rows).toBe(4);
    expect(noteInput(element).placeholder).toContain('駐車場');
  });

  it('メモの上に見出しボタン(駐車場・入口・インターホン・鍵・注意)がある', () => {
    const element = renderPatientForm(null, null, null, handlers());
    const headings = ['駐車場', '入口', 'インターホン', '鍵', '注意'];
    for (const heading of headings) {
      expect(q<HTMLButtonElement>(element, `note-heading-${heading}`).textContent).toBe(heading);
    }
  });

  it('見出しボタンを押すと、メモの末尾に「見出し: 」が足され、textareaにフォーカスが移り、カーソルは末尾に来る', () => {
    const element = renderPatientForm(null, null, null, handlers());
    document.body.append(element);
    q<HTMLButtonElement>(element, 'note-heading-駐車場').click();
    expect(noteInput(element).value).toBe('駐車場: ');
    expect(document.activeElement).toBe(noteInput(element));
    expect(noteInput(element).selectionStart).toBe(noteInput(element).value.length);
    element.remove();
  });

  it('メモのキャプションは textarea だけに結び付く(見出しボタンではない)', () => {
    const element = renderPatientForm(null, null, null, handlers());
    document.body.append(element);
    expect(noteInput(element).labels?.length).toBe(1);
    expect(noteInput(element).labels?.[0]?.textContent).toBe('メモ');
    noteInput(element).labels?.[0]?.click();
    // キャプションを押しても、最初の見出しボタン(駐車場)が押された扱いにならない。
    expect(noteInput(element).value).toBe('');
    element.remove();
  });

  it('すでに入力がある場合、改行を足してから見出しを加える(末尾がすでに改行ならそのまま)', () => {
    const draft: PatientFormDraft = { ...emptyDraft, note: '入口: 正面' };
    const element = renderPatientForm(null, draft, null, handlers());
    q<HTMLButtonElement>(element, 'note-heading-駐車場').click();
    expect(noteInput(element).value).toBe('入口: 正面\n駐車場: ');

    const draft2: PatientFormDraft = { ...emptyDraft, note: '入口: 正面\n' };
    const element2 = renderPatientForm(null, draft2, null, handlers());
    q<HTMLButtonElement>(element2, 'note-heading-駐車場').click();
    expect(noteInput(element2).value).toBe('入口: 正面\n駐車場: ');
  });

  it('駐車の選択とメモも onSave に渡る', () => {
    const spies = handlers();
    const element = renderPatientForm(null, null, null, spies);
    nameInput(element).value = '山田';
    addressInput(element).value = '東京都';
    parkingSelect(element).value = 'street_permit';
    parkingSelect(element).dispatchEvent(new Event('change'));
    permitExpiresInput(element).value = '2027-03-31';
    noteInput(element).value = '駐車場: 北側';
    q<HTMLButtonElement>(element, 'save-button').click();
    expect(spies.onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        parkingType: 'street_permit',
        permitExpires: '2027-03-31',
        note: '駐車場: 北側',
      }),
    );
  });

  it('編集中の既存の駐車情報・メモが入力欄に入る', () => {
    const patient = { ...createPatient('山田', '東京都'), parking: { type: 'coin' as const }, note: '北側の月極' };
    const element = renderPatientForm(patient, null, null, handlers());
    expect(parkingSelect(element).value).toBe('coin');
    expect(noteInput(element).value).toBe('北側の月極');
  });
});

describe('renderPatientForm: 写真', () => {
  const patient = createPatient('山田', '東京都');
  const photos = [
    { id: 'p1', url: 'blob:1' },
    { id: 'p2', url: 'blob:2' },
  ];

  it('新規登録では、案内だけ出て、サムネイルや追加は出ない', () => {
    const element = renderPatientForm(null, null, null, handlers());
    expect(element.textContent).toContain('保存したあと、編集から写真を追加できます。');
    expect(element.querySelector('[data-testid="photo-thumb"]')).toBeNull();
    expect(element.querySelector('[data-testid="photo-input"]')).toBeNull();
  });

  it('編集では、サムネイルと削除ボタンを写真の数だけ出す', () => {
    const element = renderPatientForm(patient, null, null, handlers(), photos);
    const thumbs = [...element.querySelectorAll<HTMLImageElement>('[data-testid="photo-thumb"]')];
    expect(thumbs.map((img) => img.src)).toEqual(['blob:1', 'blob:2']);
    expect(thumbs.map((img) => img.alt)).toEqual(['写真1', '写真2']);
    expect(element.querySelectorAll('[data-testid="photo-delete"]')).toHaveLength(2);
  });

  it('3枚未満なら追加ボタン(file input)を出す。押して選ぶと onAddPhoto(file, 今の入力値)', () => {
    const spies = handlers();
    const element = renderPatientForm(patient, null, null, spies, photos);
    // 保存前の入力(打ちかけの名前)。写真の追加でこの値が消えないよう、
    // onAddPhotoには今のフォームの入力値もあわせて渡される(Critical 1)。
    nameInput(element).value = '山田 次郎';
    const input = element.querySelector<HTMLInputElement>('[data-testid="photo-input"]')!;
    expect(input).not.toBeNull();
    expect(input.accept).toBe('image/*');
    expect(input.getAttribute('capture')).toBe('environment');
    const file = new File(['x'], 'photo.jpg', { type: 'image/jpeg' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));
    expect(spies.onAddPhoto).toHaveBeenCalledWith(file, {
      name: '山田 次郎',
      address: '東京都',
      phone: '',
      parkingType: '',
      permitExpires: '',
      note: '',
    });
    expect(input.value).toBe('');
  });

  it('3枚あれば追加ボタンは出ない', () => {
    const three = [...photos, { id: 'p3', url: 'blob:3' }];
    const element = renderPatientForm(patient, null, null, handlers(), three);
    expect(element.querySelector('[data-testid="photo-input"]')).toBeNull();
  });

  it('削除ボタンを押すと onDeletePhoto(id, 今の入力値)', () => {
    const spies = handlers();
    const element = renderPatientForm(patient, null, null, spies, photos);
    noteInput(element).value = '打ちかけのメモ';
    q<HTMLButtonElement>(element, 'photo-delete').click();
    expect(spies.onDeletePhoto).toHaveBeenCalledWith('p1', {
      name: '山田',
      address: '東京都',
      phone: '',
      parkingType: '',
      permitExpires: '',
      note: '打ちかけのメモ',
    });
  });

  it('撮影時の注意を出す', () => {
    const element = renderPatientForm(patient, null, null, handlers(), photos);
    expect(element.textContent).toContain('表札や人が写らないようにしてください。');
  });
});
