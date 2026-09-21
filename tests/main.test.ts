import 'fake-indexeddb/auto';
import { deleteDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { serializeBackup } from '../src/backup';

// window.location.href への実遷移を避ける(jsdomは未実装で警告を出すうえ、
// テスト間でナビゲーションが発生すると副作用が漏れる)。main.tsはopenUrlを
// './openRoute'から読み込んでいるので、そのモジュールごと差し替える。
vi.mock('../src/openRoute', () => ({ openUrl: vi.fn() }));

const SESSION_KEY = 'route-auto-input:session';

async function waitFor(assertion: () => void): Promise<void> {
  await vi.waitFor(assertion, { timeout: 2000, interval: 5 });
}

const el = <T extends HTMLElement = HTMLElement>(selector: string): T | null =>
  document.querySelector<T>(selector);

const rows = () => document.querySelectorAll('[data-testid="patient-row"]');

beforeEach(async () => {
  document.body.innerHTML = '<div id="app"></div>';
  vi.resetModules();
  window.localStorage.clear();
  await deleteDB('route-auto-input');
});

afterEach(async () => {
  // main.tsが内部で使っている(今のモジュールキャッシュ上の)db接続を閉じる。
  // 閉じないと次のbeforeEachのdeleteDBがブロックされる。
  const db = await import('../src/db');
  await db.closeDbForTest();
});

describe('入力内容の保持(#2)', () => {
  it('保存に失敗しても入力した氏名は画面に残る', async () => {
    await import('../src/main');
    await waitFor(() => expect(el('[data-testid="new-button"]')).not.toBeNull());

    el<HTMLButtonElement>('[data-testid="new-button"]')!.click();
    const nameInput = el<HTMLInputElement>('[data-testid="name-input"]')!;
    nameInput.value = '山田 太郎';
    // 住所は空のまま保存 → 検証エラーになる
    el<HTMLButtonElement>('[data-testid="save-button"]')!.click();

    expect(el<HTMLInputElement>('[data-testid="name-input"]')!.value).toBe('山田 太郎');
    expect(el('.message')?.textContent).toContain('住所を入力してください');
  });

  it('編集中の入力も保存に失敗すれば元の保存値に戻らず入力中の値が残る', async () => {
    const { savePatient } = await import('../src/db');
    const { createPatient } = await import('../src/patient');
    const patient = createPatient('鈴木 一郎', '大阪府大阪市1-1');
    await savePatient(patient);

    await import('../src/main');
    await waitFor(() => expect(rows()).toHaveLength(1));

    el<HTMLButtonElement>(`[data-testid="edit"][data-id="${patient.id}"]`)!.click();
    const nameInput = el<HTMLInputElement>('[data-testid="name-input"]')!;
    const addressInput = el<HTMLInputElement>('[data-testid="address-input"]')!;
    expect(nameInput.value).toBe('鈴木 一郎');
    nameInput.value = '鈴木 一郎(編集中)';
    addressInput.value = '';
    el<HTMLButtonElement>('[data-testid="save-button"]')!.click();

    expect(el<HTMLInputElement>('[data-testid="name-input"]')!.value).toBe('鈴木 一郎(編集中)');
    expect(el<HTMLInputElement>('[data-testid="address-input"]')!.value).toBe('');
  });

  it('新規登録に切り替えると前の失敗時の入力は引き継がない', async () => {
    await import('../src/main');
    await waitFor(() => expect(el('[data-testid="new-button"]')).not.toBeNull());

    el<HTMLButtonElement>('[data-testid="new-button"]')!.click();
    el<HTMLInputElement>('[data-testid="name-input"]')!.value = '途中の入力';
    el<HTMLButtonElement>('[data-testid="save-button"]')!.click(); // 住所なしで失敗

    el<HTMLButtonElement>('[data-testid="cancel-button"]')!.click();
    el<HTMLButtonElement>('[data-testid="new-button"]')!.click();

    expect(el<HTMLInputElement>('[data-testid="name-input"]')!.value).toBe('');
  });
});

describe('二重タップ防止(#7)', () => {
  it('保存ボタンを連打しても患者は1件しか作られない', async () => {
    await import('../src/main');
    await waitFor(() => expect(el('[data-testid="new-button"]')).not.toBeNull());

    el<HTMLButtonElement>('[data-testid="new-button"]')!.click();
    el<HTMLInputElement>('[data-testid="name-input"]')!.value = '山田 太郎';
    el<HTMLInputElement>('[data-testid="address-input"]')!.value = '東京都千代田区1-1';
    const saveButton = el<HTMLButtonElement>('[data-testid="save-button"]')!;
    saveButton.click();
    saveButton.click();

    await waitFor(() => expect(rows()).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(rows()).toHaveLength(1);
  });

  it('削除ボタンを連打しても確認ダイアログは一度しか出ない', async () => {
    const { savePatient } = await import('../src/db');
    const { createPatient } = await import('../src/patient');
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    await savePatient(patient);

    await import('../src/main');
    await waitFor(() => expect(rows()).toHaveLength(1));

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const deleteButton = el<HTMLButtonElement>(`[data-testid="delete"][data-id="${patient.id}"]`)!;
    deleteButton.click();
    deleteButton.click();

    await waitFor(() => expect(rows()).toHaveLength(0));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
  });
});

describe('セッションの永続化(#1)', () => {
  it('選択・訪問順・開いたルートがlocalStorageに残り、再起動後に訪問順の画面から復元される', async () => {
    const { savePatient } = await import('../src/db');
    const { createPatient } = await import('../src/patient');
    const patientA = createPatient('患者A', '東京都千代田区1-1');
    const patientB = createPatient('患者B', '大阪府大阪市2-2');
    await savePatient(patientA);
    await savePatient(patientB);

    await import('../src/main');
    await waitFor(() => expect(rows()).toHaveLength(2));

    el<HTMLInputElement>(`input[data-id="${patientA.id}"]`)!.click();
    el<HTMLInputElement>(`input[data-id="${patientB.id}"]`)!.click();
    el<HTMLButtonElement>('[data-testid="next-button"]')!.click();

    await waitFor(() => expect(el('[data-testid="open-route"]')).not.toBeNull());
    el<HTMLButtonElement>('[data-testid="open-route"]')!.click();

    const raw = window.localStorage.getItem(SESSION_KEY);
    expect(raw).not.toBeNull();
    const record = JSON.parse(raw!);
    expect(record.selectedIds).toEqual([patientA.id, patientB.id]);
    expect(record.openedRouteIndexes).toEqual([0]);
    // 氏名・住所は書き込まれない
    expect(raw).not.toContain('患者A');
    expect(raw).not.toContain('東京都');

    // iOSがPWAをメモリから追い出して再起動した状況を模す:
    // localStorageとIndexedDBのデータはそのまま、JS側だけを作り直す。
    // 先にこのテストで開いたDB接続を閉じておかないと、次のbeforeEachの
    // deleteDBが(閉じられていない接続のせいで)ブロックされてしまう。
    const dbBeforeRestart = await import('../src/db');
    await dbBeforeRestart.closeDbForTest();
    document.body.innerHTML = '<div id="app"></div>';
    vi.resetModules();
    await import('../src/main');

    // 復元直後は一覧画面ではなく訪問順の画面から始まる
    expect(el('h1')?.textContent).toBe('訪問順を決める');
    await waitFor(() => expect(document.querySelectorAll('[data-testid="stop-row"]')).toHaveLength(2));
    expect(el('[data-testid="open-route"]')?.textContent).toContain('✓');
  });

  it('12時間より古いセッションは復元せず一覧画面から始まる', async () => {
    window.localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        selectedIds: ['stale-id'],
        openedRouteIndexes: [],
        timestamp: new Date(Date.now() - 13 * 60 * 60 * 1000).toISOString(),
      }),
    );

    await import('../src/main');

    expect(el('h1')?.textContent).toBe('ルート自動入力');
    expect(el('[data-testid="stop-row"]')).toBeNull();
    await waitFor(() => expect(el('[data-testid="next-button"]')).not.toBeNull());
  });

  it('12時間以内のセッションは復元される', async () => {
    const { savePatient } = await import('../src/db');
    const { createPatient } = await import('../src/patient');
    const patient = createPatient('患者A', '東京都千代田区1-1');
    await savePatient(patient);
    window.localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        selectedIds: [patient.id],
        openedRouteIndexes: [],
        timestamp: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      }),
    );

    await import('../src/main');

    expect(el('h1')?.textContent).toBe('訪問順を決める');
    await waitFor(() => expect(document.querySelectorAll('[data-testid="stop-row"]')).toHaveLength(1));
  });

  it('選択を全て外すとセッション記録が消える', async () => {
    const { savePatient } = await import('../src/db');
    const { createPatient } = await import('../src/patient');
    const patient = createPatient('患者A', '東京都千代田区1-1');
    await savePatient(patient);

    await import('../src/main');
    await waitFor(() => expect(rows()).toHaveLength(1));

    // クリックのたびに画面全体が再描画されて要素が作り直されるため、
    // 都度クエリし直す(古い要素参照のままクリックしない)。
    el<HTMLInputElement>(`input[data-id="${patient.id}"]`)!.click();
    expect(window.localStorage.getItem(SESSION_KEY)).not.toBeNull();

    el<HTMLInputElement>(`input[data-id="${patient.id}"]`)!.click();
    expect(window.localStorage.getItem(SESSION_KEY)).toBeNull();
  });

  it('存在しなくなった患者idは復元時に選択から外れる(自己修復)', async () => {
    // DBには何もない状態で、患者idだけが記録されているケース。
    window.localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        selectedIds: ['deleted-id'],
        openedRouteIndexes: [],
        timestamp: new Date().toISOString(),
      }),
    );

    await import('../src/main');
    // 復元直後は(まだDBを読み込む前なので)訪問順の画面から始まる。
    expect(el('h1')?.textContent).toBe('訪問順を決める');
    // DBを読み込むと、存在しない患者idはwithPatientsによって選択から外れる。
    // 選択が0件になるとセッション記録も消える。画面はorderのままだが
    // 「一覧へ戻る」から戻れる。
    await waitFor(() => {
      expect(document.querySelectorAll('[data-testid="stop-row"]')).toHaveLength(0);
      expect(window.localStorage.getItem(SESSION_KEY)).toBeNull();
    });
  });
});

describe('訪問順画面の再入場(#6)', () => {
  it('一覧へ戻ってから次へをもう一度押すと開いたルートの印が消える', async () => {
    const { savePatient } = await import('../src/db');
    const { createPatient } = await import('../src/patient');
    const patient = createPatient('患者A', '東京都千代田区1-1');
    await savePatient(patient);

    await import('../src/main');
    await waitFor(() => expect(rows()).toHaveLength(1));

    el<HTMLInputElement>(`input[data-id="${patient.id}"]`)!.click();
    el<HTMLButtonElement>('[data-testid="next-button"]')!.click();
    await waitFor(() => expect(el('[data-testid="open-route"]')).not.toBeNull());
    el<HTMLButtonElement>('[data-testid="open-route"]')!.click();
    expect(el('[data-testid="open-route"]')?.textContent).toContain('✓');

    el<HTMLButtonElement>('[data-testid="back-button"]')!.click();
    el<HTMLButtonElement>('[data-testid="next-button"]')!.click();

    expect(el('[data-testid="open-route"]')?.textContent).not.toContain('✓');
  });
});

describe('インポートの確認(cancel/confirm)', () => {
  async function seedOnePatientAndOpenSettings(): Promise<{ id: string }> {
    const { savePatient } = await import('../src/db');
    const { createPatient } = await import('../src/patient');
    const patient = createPatient('既存患者', '東京都千代田区1-1');
    await savePatient(patient);

    await import('../src/main');
    await waitFor(() => expect(rows()).toHaveLength(1));

    el<HTMLButtonElement>('[data-testid="settings-button"]')!.click();
    await waitFor(() => expect(el('[data-testid="import-input"]')).not.toBeNull());
    return { id: patient.id };
  }

  function attachBackupFile(): void {
    const text = serializeBackup([]); // 空データへの全置換
    const file = new File([text], 'backup.json', { type: 'application/json' });
    const input = el<HTMLInputElement>('[data-testid="import-input"]')!;
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
  }

  it('確認でキャンセルすると取り込まれない', async () => {
    await seedOnePatientAndOpenSettings();
    attachBackupFile();
    vi.spyOn(window, 'confirm').mockReturnValue(false);

    el<HTMLButtonElement>('[data-testid="import-button"]')!.click();
    await waitFor(() => expect(window.confirm).toHaveBeenCalled());

    el<HTMLButtonElement>('[data-testid="back-button"]')!.click();
    expect(rows()).toHaveLength(1);
  });

  it('確認で許可すると取り込まれる(全置換で0件になる)', async () => {
    await seedOnePatientAndOpenSettings();
    attachBackupFile();
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    el<HTMLButtonElement>('[data-testid="import-button"]')!.click();
    await waitFor(() => expect(el('.message')?.textContent).toContain('取り込みました'));

    el<HTMLButtonElement>('[data-testid="back-button"]')!.click();
    expect(rows()).toHaveLength(0);
  });
});

describe('起動直後の読み込み', () => {
  it('読み込みが終わっても、操作の結果として表示中のメッセージを消さない', async () => {
    await import('../src/main');
    // 起動直後のDB読み込みは、まだ終わっていない。この間に、すぐエラーが出る操作をする。
    el<HTMLButtonElement>('[data-testid="new-button"]')!.click();
    el<HTMLButtonElement>('[data-testid="save-button"]')!.click();
    expect(el('.message')?.textContent).toContain('氏名を入力してください');

    // 読み込みが終わるのを待つ(fake-indexeddb は数ミリ秒で終わる)。
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(el('.message')?.textContent).toContain('氏名を入力してください');
  });
});
