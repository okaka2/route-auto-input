import 'fake-indexeddb/auto';
import { deleteDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_NAME } from '../src/appInfo';
import { serializeBackup } from '../src/backup';
import { unlock } from '../src/passwordGate';
import type { Patient } from '../src/types';

// window.location.href への実遷移を避ける(jsdomは未実装で警告を出すうえ、
// テスト間でナビゲーションが発生すると副作用が漏れる)。main.tsはopenUrlを
// './openRoute'から読み込んでいるので、そのモジュールごと差し替える。
vi.mock('../src/openRoute', () => ({ openUrl: vi.fn() }));

// 実際の画像の縮小(createImageBitmap/canvas)はjsdomに無いので、結合テストでは
// resizeImageの中身を差し替える。返す内容(縮小後のJPEG)だけ本物に近い形にしておく。
vi.mock('../src/imageResize', () => ({
  resizeImage: vi.fn(async () => new Blob(['x'], { type: 'image/jpeg' })),
}));

const SESSION_KEY = 'route-auto-input:session';

async function waitFor(assertion: () => void, timeout = 2000): Promise<void> {
  await vi.waitFor(assertion, { timeout, interval: 5 });
}

/**
 * 「地図を開く」を押すと、裏で今日の記録(IndexedDB: db.updateHistory → db.listHistory)が始まる。
 * それを待たずにテストが終わると、次のテストの beforeEach(接続を作り直す)と競合して
 * テスト全体が止まってしまうことがあるため、記録が実際に終わるまで待てるようにする。
 *
 * 書き込む内容が前回と同じ(同じ人を選び直しただけ、など)ケースでは、書き込み後の中身を
 * 比較するだけでは「今回の」書き込みが終わったのか判別できない。そこで、ボタンを押す前に
 * db.updateHistory/db.listHistory の呼び出しそのものを横取りする形でしかけておき(この関数)、
 * ボタンを押した後にその完了を待つ(戻り値の関数を呼んで、その結果をawaitする)。
 * 戻り値をそのままPromiseにしてしまうと、async関数からPromiseを返した時点で自動的に
 * その中身が解決されるまで待たれてしまい(仕掛けた直後、ボタンを押す前に固まってしまう)、
 * そのため、待つための関数(サンク)として返す。
 */
async function armHistoryRecordWait(): Promise<() => Promise<void>> {
  const db = await import('../src/db');
  let resolveDone: () => void = () => {};
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });
  const originalUpdate = db.updateHistory;
  const updateSpy = vi.spyOn(db, 'updateHistory').mockImplementation(async (date, update) => {
    updateSpy.mockRestore();
    const result = await originalUpdate(date, update);
    const originalList = db.listHistory;
    const listSpy = vi.spyOn(db, 'listHistory').mockImplementation(async () => {
      listSpy.mockRestore();
      const listResult = await originalList();
      resolveDone();
      return listResult;
    });
    return result;
  });
  return () => done;
}

/**
 * 設定画面を開くと裏で始まる読み込み(main.tsのloadSettingsInfo。db.getMeta('lastBackupAt')と
 * protection.isStoragePersistedの両方が終わってからrenderする)が終わるまで待てるようにする。
 * 待たずにテストが終わると、次のテストのbeforeEach(deleteDB)と競合して
 * toHaveLength(1)などが時々失敗することがあるため(armHistoryRecordWaitと同じ理由)。
 * 片方だけ待つと、もう片方がその後にrenderを呼ぶタイミングまでは待てず、同じ問題が残る。
 */
async function armSettingsLoadWait(): Promise<() => Promise<void>> {
  const db = await import('../src/db');
  const protection = await import('../src/protection');

  let resolveMeta: () => void = () => {};
  const metaDone = new Promise<void>((resolve) => {
    resolveMeta = resolve;
  });
  const originalGetMeta = db.getMeta;
  // loadSettingsInfo が読む 'lastBackupAt' の呼び出しだけを捕まえる
  // (起動時のloadRouteContextも別のキーでgetMetaを呼ぶため、キーで区別する)。
  const metaSpy = vi.spyOn(db, 'getMeta').mockImplementation(async (key: Parameters<typeof db.getMeta>[0]) => {
    if (key !== 'lastBackupAt') {
      return originalGetMeta(key);
    }
    metaSpy.mockRestore();
    const result = await originalGetMeta(key);
    resolveMeta();
    return result;
  });

  let resolvePersisted: () => void = () => {};
  const persistedDone = new Promise<void>((resolve) => {
    resolvePersisted = resolve;
  });
  const originalIsStoragePersisted = protection.isStoragePersisted;
  const persistedSpy = vi.spyOn(protection, 'isStoragePersisted').mockImplementation(async () => {
    persistedSpy.mockRestore();
    const result = await originalIsStoragePersisted();
    resolvePersisted();
    return result;
  });

  return () => Promise.all([metaDone, persistedDone]).then(() => undefined);
}

/**
 * 設定のお役立ち地点の「削除」(handleDeleteSpot: db.deleteSpot → db.listSpots → render)が
 * 終わるまで待てるようにする(armHistoryRecordWaitと同じ理由・同じ仕組み)。
 * 「まだありません」がDOMに出る前後で、この一連の書き込み・読み直しが完全に終わっている
 * 保証が無いと、次のテストのbeforeEach(deleteDB)と競合することがある。
 */
async function armSpotDeleteWait(): Promise<() => Promise<void>> {
  const db = await import('../src/db');
  let resolveDone: () => void = () => {};
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });
  const originalDeleteSpot = db.deleteSpot;
  const deleteSpy = vi.spyOn(db, 'deleteSpot').mockImplementation(async (id) => {
    deleteSpy.mockRestore();
    const result = await originalDeleteSpot(id);
    const originalListSpots = db.listSpots;
    const listSpy = vi.spyOn(db, 'listSpots').mockImplementation(async () => {
      listSpy.mockRestore();
      const listResult = await originalListSpots();
      resolveDone();
      return listResult;
    });
    return result;
  });
  return () => done;
}

/**
 * お役立ち地点の登録(saveSpot: db.putSpot → db.listSpots → render)が終わるまで待てるようにする
 * (armSpotDeleteWaitと同じ理由・同じ仕組み)。待たずに次のテストのbeforeEach(deleteDB)へ進むと、
 * まだ動いている読み込みが後からdb接続を開き直してしまうことがある。
 */
async function armSpotSaveWait(): Promise<() => Promise<void>> {
  const db = await import('../src/db');
  let resolveDone: () => void = () => {};
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });
  const originalPutSpot = db.putSpot;
  const putSpy = vi.spyOn(db, 'putSpot').mockImplementation(async (spot) => {
    putSpy.mockRestore();
    const result = await originalPutSpot(spot);
    const originalListSpots = db.listSpots;
    const listSpy = vi.spyOn(db, 'listSpots').mockImplementation(async () => {
      listSpy.mockRestore();
      const listResult = await originalListSpots();
      resolveDone();
      return listResult;
    });
    return result;
  });
  return () => done;
}

/**
 * フォームでの写真の追加(addPhotoFromFile)・削除(deleteFormPhoto)は、どちらも最後に
 * db.loadPhotoBytes(内部でdb.listAllPhotos)まで一連で読み直す。サムネイルの見た目が
 * 変わった時点ではまだこの最後の読み直しが終わっていないことがあるため、
 * armSpotSaveWaitと同じ仕組みで、その完了まで待てるようにする。
 */
async function armPhotoActionWait(): Promise<() => Promise<void>> {
  const db = await import('../src/db');
  let resolveDone: () => void = () => {};
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });
  const original = db.listAllPhotos;
  const spy = vi.spyOn(db, 'listAllPhotos').mockImplementation(async () => {
    spy.mockRestore();
    const result = await original();
    resolveDone();
    return result;
  });
  return () => done;
}

const el = <T extends HTMLElement = HTMLElement>(selector: string): T | null =>
  document.querySelector<T>(selector);

const rows = () => document.querySelectorAll('[data-testid="patient-row"]');

/** 一覧の上に出るお知らせ(ホーム画面の案内など)を閉じ、目的のお知らせが見える状態にする。 */
function dismissInstallNotice(): void {
  el<HTMLButtonElement>('[data-testid="notice-install-dismiss"]')?.click();
}

type WindowWithStartup = typeof window & { __routeAutoInputStartup?: Promise<void> };

// jsdomにはURL.createObjectURL/revokeObjectURLが無いので、テスト用に差し替える。
// カウンターで毎回違うURLを作る(同一URLだと、写真ごとの区別がテストできない)。
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;
let objectUrlCounter = 0;

beforeEach(async () => {
  document.body.innerHTML = '<div id="app"></div>';
  vi.resetModules();
  window.localStorage.clear();
  // ロック画面自体を検証するテスト以外は、ロックを経由せずアプリの中身を直接検証したいので、
  // 既定で解錠しておく。
  unlock();
  await deleteDB('route-auto-input');
  // vi.resetModules() はモジュールの読み込みキャッシュを消すだけで、
  // vi.mock('../src/openRoute', ...) が作ったモック関数の呼び出し履歴は
  // テストをまたいで残る。呼び出し回数を検証するテストのために、ここでクリアする。
  const { openUrl } = await import('../src/openRoute');
  vi.mocked(openUrl).mockClear();
  objectUrlCounter = 0;
  URL.createObjectURL = vi.fn(() => `blob:mock-${objectUrlCounter++}`);
  URL.revokeObjectURL = vi.fn();
  window.scrollTo = vi.fn();
  history.replaceState(null, '');
});

afterEach(async () => {
  // spyOn をテスト間に持ち越さない(持ち越すと、前のテストで記録された呼び出しのせいで、
  // 待つべき処理を待たずに検証が通ってしまう)。
  vi.restoreAllMocks();
  // main.tsの起動時の読み込み(古い履歴の削除→読み直しを含む)が終わるまで待つ。
  // 待たずに次のbeforeEachのdeleteDBへ進むと、まだ動いている読み込みが後から
  // 接続を開き直してしまい、そのdeleteDBがブロックされてしまうことがある。
  await (window as WindowWithStartup).__routeAutoInputStartup;
  // main.tsが内部で使っている(今のモジュールキャッシュ上の)db接続を閉じる。
  // 閉じないと次のbeforeEachのdeleteDBがブロックされる。
  const db = await import('../src/db');
  await db.closeDbForTest();
  URL.createObjectURL = originalCreateObjectURL;
  URL.revokeObjectURL = originalRevokeObjectURL;
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

    el<HTMLButtonElement>(`[data-testid="row-menu"][data-id="${patient.id}"]`)!.click();
    el<HTMLButtonElement>('[data-testid="dialog-edit"]')!.click();
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
    vi.spyOn(window, 'confirm').mockReturnValue(true);
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

  it('削除の確認で「削除」を連打しても、削除は1回だけで、標準の確認ダイアログは出ない', async () => {
    const { savePatient } = await import('../src/db');
    const { createPatient } = await import('../src/patient');
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    await savePatient(patient);

    await import('../src/main');
    await waitFor(() => expect(rows()).toHaveLength(1));

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    el<HTMLButtonElement>(`[data-testid="row-menu"][data-id="${patient.id}"]`)!.click();
    el<HTMLButtonElement>('[data-testid="dialog-delete"]')!.click();
    const confirmButton = el<HTMLButtonElement>('[data-testid="dialog-confirm-delete"]')!;
    confirmButton.click();
    confirmButton.click();

    await waitFor(() => expect(rows()).toHaveLength(0));
    expect(el('.message')?.textContent).toContain('削除しました');
    expect(confirmSpy).not.toHaveBeenCalled();
  });
});

describe('セッションの永続化(#1)', () => {
  it('選択・訪問順・開いたルートがlocalStorageに残り、再起動後に地図の画面から復元される', async () => {
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

    await waitFor(() => expect(el('[data-testid="open-map-button"]')).not.toBeNull());
    const historyRecorded = await armHistoryRecordWait();
    el<HTMLButtonElement>('[data-testid="open-map-button"]')!.click();
    await historyRecorded();
    await waitFor(() => expect(el('[data-testid="open-route"]')).not.toBeNull());
    el<HTMLButtonElement>('[data-testid="open-route"]')!.click();

    const raw = window.localStorage.getItem(SESSION_KEY);
    expect(raw).not.toBeNull();
    const record = JSON.parse(raw!);
    expect(record.selectedIds).toEqual([patientA.id, patientB.id]);
    expect(record.opened).toEqual([{ index: 0, at: expect.any(String) }]);
    // 氏名・住所は書き込まれない
    expect(raw).not.toContain('患者A');
    expect(raw).not.toContain('東京都');

    // iOSがPWAをメモリから追い出して再起動した状況を模す:
    // localStorageとIndexedDBのデータはそのまま、JS側だけを作り直す。
    // 先に、再起動前のインスタンスの起動時の読み込みを待ってからDB接続を閉じる
    // (待たずに閉じると、まだ動いている読み込みが後から接続を開き直してしまい、
    // 次のbeforeEachのdeleteDBがブロックされてしまう)。
    await (window as WindowWithStartup).__routeAutoInputStartup;
    const dbBeforeRestart = await import('../src/db');
    await dbBeforeRestart.closeDbForTest();
    document.body.innerHTML = '<div id="app"></div>';
    vi.resetModules();
    await import('../src/main');

    // 開いたルートがあるので、次に開くルートがすぐ分かるよう、地図の画面から始まる
    expect(el('h1')?.textContent).toBe('地図を開く');
    await waitFor(() => expect(document.querySelectorAll('[data-testid="route-card"]')).toHaveLength(1));
    expect(el('[data-testid="route-status"]')?.textContent).toContain('開きました');
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

    expect(el('h1')?.textContent).toBe(APP_NAME);
    expect(el('[data-testid="stop-row"]')).toBeNull();
    // 「次へ」は選択バーへ移り、未選択のときは出ないため、一覧画面が出ていることを
    // 「＋ 訪問先を登録」ボタンで確かめる。
    await waitFor(() => expect(el('[data-testid="new-button"]')).not.toBeNull());
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

describe('開いたルートの印(#6)', () => {
  /** 訪問先を count 件登録し、すべて選んで、地図の画面からルートを1つ開いた状態にする。 */
  async function openFirstRoute(count: number): Promise<{ ids: string[] }> {
    const { savePatient } = await import('../src/db');
    const { createPatient } = await import('../src/patient');
    const patients = Array.from({ length: count }, (_, i) =>
      createPatient(`場所${i + 1}`, `東京都千代田区${i + 1}-1`),
    );
    for (const patient of patients) {
      await savePatient(patient);
    }

    await import('../src/main');
    await waitFor(() => expect(rows()).toHaveLength(count));
    for (const patient of patients) {
      el<HTMLInputElement>(`input[data-id="${patient.id}"]`)!.click();
    }
    el<HTMLButtonElement>('[data-testid="next-button"]')!.click();
    await waitFor(() => expect(el('[data-testid="open-map-button"]')).not.toBeNull());
    const historyRecorded = await armHistoryRecordWait();
    el<HTMLButtonElement>('[data-testid="open-map-button"]')!.click();
    await historyRecorded();
    await waitFor(() => expect(el('[data-testid="open-route"]')).not.toBeNull());
    el<HTMLButtonElement>('[data-testid="open-route"]')!.click();

    expect(el('[data-testid="route-status"]')?.textContent).toContain('開きました');
    return { ids: patients.map((patient) => patient.id) };
  }

  it('訪問順へ戻って、もう一度地図を開いても、開いたルートの印は残る', async () => {
    await openFirstRoute(1);

    el<HTMLButtonElement>('[data-testid="back-button"]')!.click();
    expect(el('h1')?.textContent).toBe('訪問順を決める');
    const historyRecorded = await armHistoryRecordWait();
    el<HTMLButtonElement>('[data-testid="open-map-button"]')!.click();
    await historyRecorded();

    expect(el('[data-testid="route-status"]')?.textContent).toContain('開きました');
  });

  it('訪問先の選択を変えると、開いたルートの印が消える', async () => {
    const { ids } = await openFirstRoute(1);

    el<HTMLButtonElement>('[data-testid="back-button"]')!.click(); // 地図 → 訪問順
    el<HTMLButtonElement>('[data-testid="back-button"]')!.click(); // 訪問順 → 一覧
    el<HTMLInputElement>(`input[data-id="${ids[0]}"]`)!.click(); // 選択を外す
    el<HTMLInputElement>(`input[data-id="${ids[0]}"]`)!.click(); // 選び直す
    el<HTMLButtonElement>('[data-testid="next-button"]')!.click();
    const historyRecorded = await armHistoryRecordWait();
    el<HTMLButtonElement>('[data-testid="open-map-button"]')!.click();
    await historyRecorded();

    expect(el('[data-testid="route-status"]')).toBeNull();
    expect(el('[data-testid="route-card"]')?.getAttribute('data-state')).toBe('next');
  });

  it('訪問順を並べ替えると、開いたルートの印が消える', async () => {
    await openFirstRoute(2);

    el<HTMLButtonElement>('[data-testid="back-button"]')!.click(); // 地図 → 訪問順
    el<HTMLButtonElement>('[data-testid="move-down"]')!.click(); // 1件目を下へ
    const historyRecorded = await armHistoryRecordWait();
    el<HTMLButtonElement>('[data-testid="open-map-button"]')!.click();
    await historyRecorded();

    expect(el('[data-testid="route-status"]')).toBeNull();
  });

  it('先頭の▲は押せず、何も変わらないので、開いたルートの印は残る', async () => {
    await openFirstRoute(2);

    el<HTMLButtonElement>('[data-testid="back-button"]')!.click(); // 地図 → 訪問順
    // 先頭の▲は押せない(disabled)ので、押しても何も起きない。
    el<HTMLButtonElement>('[data-testid="move-up"]')!.click();
    const historyRecorded = await armHistoryRecordWait();
    el<HTMLButtonElement>('[data-testid="open-map-button"]')!.click();
    await historyRecorded();

    expect(el('[data-testid="route-status"]')?.textContent).toContain('開きました');
  });

  it('選択中の別の訪問先を削除すると、開いたルートの印が消える', async () => {
    const { ids } = await openFirstRoute(2);

    el<HTMLButtonElement>('[data-testid="back-button"]')!.click(); // 地図 → 訪問順
    el<HTMLButtonElement>('[data-testid="back-button"]')!.click(); // 訪問順 → 一覧

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    el<HTMLButtonElement>(`[data-testid="row-menu"][data-id="${ids[1]}"]`)!.click();
    el<HTMLButtonElement>('[data-testid="dialog-delete"]')!.click();
    el<HTMLButtonElement>('[data-testid="dialog-confirm-delete"]')!.click();
    await waitFor(() => expect(rows()).toHaveLength(1));
    confirmSpy.mockRestore();

    el<HTMLButtonElement>('[data-testid="next-button"]')!.click();
    const historyRecorded = await armHistoryRecordWait();
    el<HTMLButtonElement>('[data-testid="open-map-button"]')!.click();
    await historyRecorded();

    expect(el('[data-testid="route-status"]')).toBeNull();
  });

  it('選択中の訪問先の住所を編集すると、開いたルートの印が消える', async () => {
    const { ids } = await openFirstRoute(2);

    el<HTMLButtonElement>('[data-testid="back-button"]')!.click(); // 地図 → 訪問順
    el<HTMLButtonElement>('[data-testid="back-button"]')!.click(); // 訪問順 → 一覧

    el<HTMLButtonElement>(`[data-testid="row-menu"][data-id="${ids[0]}"]`)!.click();
    el<HTMLButtonElement>('[data-testid="dialog-edit"]')!.click();
    el<HTMLInputElement>('[data-testid="address-input"]')!.value = '東京都千代田区9-9';
    el<HTMLButtonElement>('[data-testid="save-button"]')!.click();
    await waitFor(() => expect(el('.message')?.textContent).toContain('保存しました'));

    el<HTMLButtonElement>('[data-testid="next-button"]')!.click();
    const historyRecorded = await armHistoryRecordWait();
    el<HTMLButtonElement>('[data-testid="open-map-button"]')!.click();
    await historyRecorded();

    expect(el('[data-testid="route-status"]')).toBeNull();
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
    const text = serializeBackup({ patients: [], photos: null, spots: [], meta: {} }); // 空データへの全置換
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
    expect(el('.message')?.textContent).toContain('名前を入力してください');

    // 読み込みが終わるのを待つ(fake-indexeddb は数ミリ秒で終わる)。
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(el('.message')?.textContent).toContain('名前を入力してください');
  });
});

describe('合言葉のロック画面', () => {
  // このdescribe内では、beforeEachのunlock()を打ち消して、未解錠から始める。
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('未解錠なら、ロック画面が出て、中身(一覧)は表示されない', async () => {
    await import('../src/main');
    expect(el('[data-testid="password-input"]')).not.toBeNull();
    expect(el('[data-testid="new-button"]')).toBeNull();
  });

  it('間違った合言葉では、エラーが出て、中身は表示されない', async () => {
    await import('../src/main');
    const input = el<HTMLInputElement>('[data-testid="password-input"]')!;
    input.value = 'ちがう';
    el<HTMLButtonElement>('[data-testid="password-submit"]')!.click();

    expect(el('.message')?.textContent).toBe('合言葉が違います。');
    expect(el('[data-testid="new-button"]')).toBeNull();
  });

  it('正しい合言葉を入れると、中身(一覧)が表示される', async () => {
    await import('../src/main');
    const input = el<HTMLInputElement>('[data-testid="password-input"]')!;
    input.value = 'houmon2026';
    el<HTMLButtonElement>('[data-testid="password-submit"]')!.click();

    await waitFor(() => expect(el('[data-testid="new-button"]')).not.toBeNull());
    expect(el('[data-testid="password-input"]')).toBeNull();
  });

  it('一度解錠すると、次に読み込んだとき(同じブラウザ)はロック画面を経由しない', async () => {
    await import('../src/main');
    const input = el<HTMLInputElement>('[data-testid="password-input"]')!;
    input.value = 'houmon2026';
    el<HTMLButtonElement>('[data-testid="password-submit"]')!.click();
    await waitFor(() => expect(el('[data-testid="new-button"]')).not.toBeNull());

    // 再起動を模して、モジュールを読み込み直す(localStorageはそのまま)。
    // 起動時の読み込みを待ってから今の接続を閉じる(閉じないと次のdeleteDBがブロックされる。
    // 待たずに閉じると、まだ動いている読み込みが後から接続を開き直してしまう)。
    await (window as WindowWithStartup).__routeAutoInputStartup;
    const dbBeforeRestart = await import('../src/db');
    await dbBeforeRestart.closeDbForTest();
    document.body.innerHTML = '<div id="app"></div>';
    vi.resetModules();
    await import('../src/main');

    expect(el('[data-testid="password-input"]')).toBeNull();
    await waitFor(() => expect(el('[data-testid="new-button"]')).not.toBeNull());
  });
});

describe('地図の画面からルートを共有', () => {
  async function openMapWithOnePatient(): Promise<void> {
    const { savePatient } = await import('../src/db');
    const { createPatient } = await import('../src/patient');
    const patient = createPatient('山田太郎', '東京都千代田区1-1');
    await savePatient(patient);
    window.localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        timestamp: new Date().toISOString(),
        selectedIds: [patient.id],
        opened: [{ index: 0, at: '' }],
      }),
    );
    await import('../src/main');
    await waitFor(() => expect(el('[data-testid="share-routes"]')).not.toBeNull());
    // 起動直後の読み込みで訪問先が反映されるまで待つ(ルートのカードに名前が出る)。
    await waitFor(() => expect(document.body.textContent).toContain('山田太郎'));
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('確認でキャンセルすると、共有しない', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...window.navigator, share });
    await openMapWithOnePatient();
    vi.spyOn(window, 'confirm').mockReturnValue(false);

    el<HTMLButtonElement>('[data-testid="share-routes"]')!.click();

    expect(window.confirm).toHaveBeenCalled();
    expect(share).not.toHaveBeenCalled();
  });

  it('確認で許可すると、住所入りのGoogleマップのURLを共有する(名前は含めない)', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...window.navigator, share });
    await openMapWithOnePatient();
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    el<HTMLButtonElement>('[data-testid="share-routes"]')!.click();

    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    const text = share.mock.calls[0]![0].text as string;
    expect(text).toContain('https://www.google.com/maps/dir/');
    expect(text).not.toContain('山田太郎');
  });

  it('「リンクをコピー」は、共有メニューがあっても使わずにコピーして案内する', async () => {
    const share = vi.fn();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...window.navigator, share, clipboard: { writeText } });
    await openMapWithOnePatient();
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    el<HTMLButtonElement>('[data-testid="copy-route-link"]')!.click();

    await waitFor(() => expect(el('.message')?.textContent).toContain('コピーしました'));
    expect(String(writeText.mock.calls[0]![0])).toContain('https://www.google.com/maps/dir/');
    expect(share).not.toHaveBeenCalled();
  });

  it('「リンクをコピー」も、確認でキャンセルするとコピーしない', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...window.navigator, clipboard: { writeText } });
    await openMapWithOnePatient();
    vi.spyOn(window, 'confirm').mockReturnValue(false);

    el<HTMLButtonElement>('[data-testid="copy-route-link"]')!.click();

    expect(window.confirm).toHaveBeenCalled();
    expect(writeText).not.toHaveBeenCalled();
  });

  it('共有メニューが無い端末では、コピーして案内する', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...window.navigator, share: undefined, clipboard: { writeText } });
    await openMapWithOnePatient();
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    el<HTMLButtonElement>('[data-testid="share-routes"]')!.click();

    await waitFor(() => expect(el('.message')?.textContent).toContain('コピーしました'));
    expect(writeText).toHaveBeenCalledTimes(1);
  });
});

describe('地図を開く画面', () => {
  async function seedOnePatient(): Promise<{ id: string }> {
    const { savePatient } = await import('../src/db');
    const { createPatient } = await import('../src/patient');
    const patient = createPatient('場所A', '東京都千代田区1-1');
    await savePatient(patient);
    return { id: patient.id };
  }

  function writeSession(record: object): void {
    window.localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ timestamp: new Date().toISOString(), ...record }),
    );
  }

  it('開いたルートが記録されていれば、地図の画面から始まり、開いた日時を表示する', async () => {
    const { id } = await seedOnePatient();
    writeSession({
      selectedIds: [id],
      opened: [{ index: 0, at: new Date(2026, 8, 21, 14, 32).toISOString() }],
    });

    await import('../src/main');

    expect(el('h1')?.textContent).toBe('地図を開く');
    await waitFor(() => expect(document.querySelectorAll('[data-testid="route-card"]')).toHaveLength(1));
    expect(el('[data-testid="route-status"]')?.textContent).toContain('9/21 14:32');
  });

  it('古い形式(番号だけ)の記録でも、開いたルートがあれば地図の画面から始まる', async () => {
    const { id } = await seedOnePatient();
    writeSession({ selectedIds: [id], openedRouteIndexes: [0] });

    await import('../src/main');

    expect(el('h1')?.textContent).toBe('地図を開く');
    await waitFor(() => expect(el('[data-testid="route-status"]')).not.toBeNull());
    expect(el('.route-time')).toBeNull();
  });

  it('開いたルートが無ければ、これまでどおり訪問順の画面から始まる', async () => {
    const { id } = await seedOnePatient();
    writeSession({ selectedIds: [id], opened: [] });

    await import('../src/main');

    expect(el('h1')?.textContent).toBe('訪問順を決める');
    await waitFor(() => expect(document.querySelectorAll('[data-testid="stop-row"]')).toHaveLength(1));
  });

  it('「もう一度開く」で、地図を開く遷移が呼ばれる', async () => {
    const { id } = await seedOnePatient();
    writeSession({ selectedIds: [id], opened: [{ index: 0, at: new Date().toISOString() }] });

    await import('../src/main');
    await waitFor(() => expect(el('[data-testid="open-route"]')).not.toBeNull());
    const { openUrl } = await import('../src/openRoute');

    el<HTMLButtonElement>('[data-testid="open-route"]')!.click();

    expect(openUrl).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(openUrl).mock.calls[0]?.[0])).toContain('google.com/maps');
  });

  it('戻るを押すと、訪問順の画面へ戻る', async () => {
    const { id } = await seedOnePatient();
    writeSession({ selectedIds: [id], opened: [{ index: 0, at: '' }] });

    await import('../src/main');
    await waitFor(() => expect(el('[data-testid="back-button"]')).not.toBeNull());
    el<HTMLButtonElement>('[data-testid="back-button"]')!.click();

    expect(el('h1')?.textContent).toBe('訪問順を決める');
  });

  it('選択がなくなっていても地図の画面が開け、「訪問先を選ぶ」から一覧へ進める', async () => {
    writeSession({ selectedIds: ['gone-id'], opened: [{ index: 0, at: '' }] });

    await import('../src/main');
    await waitFor(() => expect(el('[data-testid="choose-stops-button"]')).not.toBeNull());
    el<HTMLButtonElement>('[data-testid="choose-stops-button"]')!.click();

    // 一覧の画面へ移った(この時点の一覧は、まだ作り直していない古い画面)。
    await waitFor(() => expect(el('[data-testid="new-button"]')).not.toBeNull());
    expect(el('h1')?.textContent).not.toBe('地図を開く');
  });
});

describe('訪問先を選ぶ画面と下部のバー', () => {
  async function seedPlaces(count: number): Promise<string[]> {
    const { savePatient } = await import('../src/db');
    const { createPatient } = await import('../src/patient');
    const ids: string[] = [];
    for (let i = 1; i <= count; i += 1) {
      // 作成日時をミリ秒未満の粒度でも必ず増える値にする。createdAt が同じミリ秒になると、
      // listPatients() の並び順(createdAt降順、同値はUUID順にフォールバック)が不定になり、
      // 表示順を検証するテストが fake-indexeddb 上でまれに揺れるため。
      const patient = createPatient(`場所${i}`, `東京都千代田区${i}-1`, new Date(2026, 0, 1, 0, 0, i));
      await savePatient(patient);
      ids.push(patient.id);
    }
    return ids;
  }

  async function startWithPlaces(count: number): Promise<string[]> {
    const ids = await seedPlaces(count);
    await import('../src/main');
    await waitFor(() => expect(rows()).toHaveLength(count));
    return ids;
  }

  const checkbox = (id: string) => el<HTMLInputElement>(`input[data-id="${id}"]`)!;
  const openMenuFor = (id: string) =>
    el<HTMLButtonElement>(`[data-testid="row-menu"][data-id="${id}"]`)!.click();

  it('見出しにアプリ名を出す', async () => {
    // 起動直後のDB読み込みが終わるまで待つ(待たずに終えると、その読み込みが次のテストへ漏れる)。
    await startWithPlaces(1);
    expect(el('h1')?.textContent).toBe(APP_NAME);
  });

  it('行全体をタップして選択でき、選択バーに件数が出て、もう一度タップすると外れる', async () => {
    const ids = await startWithPlaces(2);
    // 一覧は新しく登録した訪問先が先頭に来る(tests/db.test.ts)ため、
    // 一番上の行は最後に登録した訪問先になる。
    const displayedFirst = ids[ids.length - 1];
    expect(el('[data-testid="selection-bar"]')).toBeNull();

    el<HTMLElement>('.place-name')!.click(); // 行の名前の部分をタップ

    expect(checkbox(displayedFirst!).checked).toBe(true);
    expect(rows()[0]!.classList.contains('selected')).toBe(true);
    expect(el('[data-testid="selection-count"]')?.textContent).toBe('1件選択中');

    el<HTMLElement>('.place-name')!.click();

    expect(el('[data-testid="selection-bar"]')).toBeNull();
  });

  it('選択バーの「訪問順を決める →」で、訪問順の画面へ進む', async () => {
    const [first] = await startWithPlaces(2);
    checkbox(first!).click();

    el<HTMLButtonElement>('[data-testid="next-button"]')!.click();

    expect(el('h1')?.textContent).toBe('訪問順を決める');
  });

  it('「⋯」を押すとメニューが開き、最初のボタンにフォーカスが移り、選択は変わらない', async () => {
    const [first] = await startWithPlaces(1);

    openMenuFor(first!);

    expect(el('[data-testid="dialog"]')).not.toBeNull();
    expect(document.activeElement).toBe(el('[data-testid="dialog-edit"]'));
    expect(checkbox(first!).checked).toBe(false);
    expect(document.body.classList.contains('dialog-open')).toBe(true);
  });

  it('メニューを「キャンセル」で閉じると、フォーカスが元の「⋯」へ戻り、背後のスクロール止めも外れる', async () => {
    const [first] = await startWithPlaces(1);
    openMenuFor(first!);

    el<HTMLButtonElement>('[data-testid="dialog-cancel"]')!.click();

    expect(el('[data-testid="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(el(`[data-testid="row-menu"][data-id="${first}"]`));
    expect(document.body.classList.contains('dialog-open')).toBe(false);
  });

  it('Escキーでメニューが閉じる', async () => {
    const [first] = await startWithPlaces(1);
    openMenuFor(first!);

    el('[data-testid="dialog-edit"]')!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );

    expect(el('[data-testid="dialog"]')).toBeNull();
  });

  it('ダイアログの背景側(フォーカスを持てない部分)を押してフォーカスが外れても、Escキーで閉じる', async () => {
    const [first] = await startWithPlaces(1);
    openMenuFor(first!);

    // フォーカスを持てない見出しなどをクリックすると、activeElement は document.body へ移る
    // (#app の外)。ここでは、その状況を blur() で再現し、Escキーを押しても閉じられることを
    // 確かめる。
    (document.activeElement as HTMLElement | null)?.blur();
    expect(document.activeElement).toBe(document.body);

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );

    expect(el('[data-testid="dialog"]')).toBeNull();
  });

  it('メニューの外側(背景)を押すと閉じる', async () => {
    const [first] = await startWithPlaces(1);
    openMenuFor(first!);

    el<HTMLElement>('[data-testid="dialog-overlay"]')!.click();

    expect(el('[data-testid="dialog"]')).toBeNull();
  });

  it('メニューの「編集」で、その訪問先の編集フォームが開き、名前と住所が入っている', async () => {
    const [first] = await startWithPlaces(1);
    openMenuFor(first!);

    el<HTMLButtonElement>('[data-testid="dialog-edit"]')!.click();

    expect(el<HTMLInputElement>('[data-testid="name-input"]')!.value).toBe('場所1');
    expect(el<HTMLInputElement>('[data-testid="address-input"]')!.value).toBe('東京都千代田区1-1');
    expect(el('[data-testid="dialog"]')).toBeNull();
  });

  it('メニューの「複製して登録」で、名前と住所を写した新規フォームが開き、保存すると別の訪問先として増える', async () => {
    const [first] = await startWithPlaces(1);
    openMenuFor(first!);

    el<HTMLButtonElement>('[data-testid="dialog-duplicate"]')!.click();

    expect(el<HTMLInputElement>('[data-testid="name-input"]')!.value).toBe('場所1');
    expect(el<HTMLInputElement>('[data-testid="address-input"]')!.value).toBe('東京都千代田区1-1');

    el<HTMLButtonElement>('[data-testid="save-button"]')!.click();
    // 名前・住所とも複製元と同じなので、同じ人の知らせが出る。「そのまま登録」で別の訪問先として保存する。
    await waitFor(() => expect(el('[data-testid="dialog-save-anyway"]')).not.toBeNull());
    el<HTMLButtonElement>('[data-testid="dialog-save-anyway"]')!.click();
    await waitFor(() => expect(rows()).toHaveLength(2));
    // 元の訪問先はそのまま残っている。
    expect(checkbox(first!)).not.toBeNull();
  });

  it('メニューの「削除」を押しても、すぐには削除せず、確認のダイアログが出る', async () => {
    const [first] = await startWithPlaces(1);
    openMenuFor(first!);

    el<HTMLButtonElement>('[data-testid="dialog-delete"]')!.click();

    expect(el('#dialog-title')?.textContent).toBe('この訪問先を削除しますか?');
    expect(rows()).toHaveLength(1);
  });

  it('削除の確認で「キャンセル」すると、削除されず、フォーカスは「⋯」へ戻る', async () => {
    const [first] = await startWithPlaces(1);
    openMenuFor(first!);
    el<HTMLButtonElement>('[data-testid="dialog-delete"]')!.click();

    el<HTMLButtonElement>('[data-testid="dialog-cancel"]')!.click();

    expect(el('[data-testid="dialog"]')).toBeNull();
    expect(rows()).toHaveLength(1);
    expect(document.activeElement).toBe(el(`[data-testid="row-menu"][data-id="${first}"]`));
  });

  it('削除の確認で「削除」を押すと、その訪問先が消えて、お知らせが出る', async () => {
    const [first, second] = await startWithPlaces(2);
    openMenuFor(first!);
    el<HTMLButtonElement>('[data-testid="dialog-delete"]')!.click();

    el<HTMLButtonElement>('[data-testid="dialog-confirm-delete"]')!.click();

    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(checkbox(second!)).not.toBeNull();
    expect(el('.message')?.textContent).toContain('削除しました');
    expect(el('[data-testid="dialog"]')).toBeNull();
  });

  it('検索で絞り込め、0件のときは案内が出て、クリアボタンで元に戻り、検索欄にフォーカスが戻る', async () => {
    await startWithPlaces(3);
    const search = () => el<HTMLInputElement>('[data-testid="search-input"]')!;

    search().value = '場所2';
    search().dispatchEvent(new Event('input'));
    expect(rows()).toHaveLength(1);

    search().value = 'どこにもない';
    search().dispatchEvent(new Event('input'));
    expect(rows()).toHaveLength(0);
    expect(el('[data-testid="empty-text"]')?.textContent).toBe('該当する訪問先がありません');

    el<HTMLButtonElement>('[data-testid="search-clear"]')!.click();

    expect(rows()).toHaveLength(3);
    expect(search().value).toBe('');
    expect(document.activeElement).toBe(search());
  });

  it('下部のタブは3つのステップを示し、訪問先を選ぶまでは、訪問順と地図のタブを押せない', async () => {
    const [first] = await startWithPlaces(1);
    expect(el('[data-testid="tab-list"]')?.getAttribute('aria-current')).toBe('step');
    expect(el<HTMLButtonElement>('[data-testid="tab-order"]')!.disabled).toBe(true);
    expect(el<HTMLButtonElement>('[data-testid="tab-map"]')!.disabled).toBe(true);

    checkbox(first!).click();

    expect(el<HTMLButtonElement>('[data-testid="tab-order"]')!.disabled).toBe(false);
    expect(el<HTMLButtonElement>('[data-testid="tab-map"]')!.disabled).toBe(false);
  });

  it('タブで、訪問順・地図・訪問先を選ぶ、の間を移動できる', async () => {
    const [first] = await startWithPlaces(1);
    checkbox(first!).click();

    el<HTMLButtonElement>('[data-testid="tab-order"]')!.click();
    expect(el('h1')?.textContent).toBe('訪問順を決める');
    expect(el('[data-testid="tab-order"]')?.getAttribute('aria-current')).toBe('step');

    el<HTMLButtonElement>('[data-testid="tab-map"]')!.click();
    expect(el('h1')?.textContent).toBe('地図を開く');

    el<HTMLButtonElement>('[data-testid="tab-list"]')!.click();
    expect(el('h1')?.textContent).toBe(APP_NAME);
  });

  it('タブで移動しても、開いたルートの印は消えない', async () => {
    const [first] = await startWithPlaces(1);
    checkbox(first!).click();
    el<HTMLButtonElement>('[data-testid="tab-map"]')!.click();
    el<HTMLButtonElement>('[data-testid="open-route"]')!.click();
    expect(el('[data-testid="route-status"]')?.textContent).toContain('開きました');

    el<HTMLButtonElement>('[data-testid="tab-list"]')!.click();
    el<HTMLButtonElement>('[data-testid="tab-map"]')!.click();

    expect(el('[data-testid="route-status"]')?.textContent).toContain('開きました');
  });

  it('設定・登録の画面には、下部のタブを出さない', async () => {
    await startWithPlaces(1);
    expect(el('[data-testid="tabbar"]')).not.toBeNull();

    el<HTMLButtonElement>('[data-testid="settings-button"]')!.click();
    expect(el('[data-testid="tabbar"]')).toBeNull();

    el<HTMLButtonElement>('[data-testid="back-button"]')!.click();
    expect(el('[data-testid="tabbar"]')).not.toBeNull();

    el<HTMLButtonElement>('[data-testid="new-button"]')!.click();
    expect(el('[data-testid="tabbar"]')).toBeNull();
  });

  it('選択バーは、訪問先を選んだ一覧の画面にだけ出て、訪問順の画面には出ない', async () => {
    const [first] = await startWithPlaces(1);
    checkbox(first!).click();
    expect(el('[data-testid="selection-bar"]')).not.toBeNull();

    el<HTMLButtonElement>('[data-testid="tab-order"]')!.click();

    expect(el('[data-testid="selection-bar"]')).toBeNull();
    expect(el('[data-testid="tabbar"]')).not.toBeNull();
  });

  it('選択バーとタブがあるとき、内容の下に十分な余白を取るクラスが付く', async () => {
    const [first] = await startWithPlaces(1);
    expect(el('.app-shell')?.classList.contains('with-tabbar')).toBe(true);

    checkbox(first!).click();

    expect(el('.app-shell')?.classList.contains('with-selection')).toBe(true);
  });

  describe('並び替え', () => {
    it('名前順にすると、あいうえお順の見出しに並び替わる', async () => {
      const { savePatient } = await import('../src/db');
      const { createPatient } = await import('../src/patient');
      await savePatient(createPatient('うえだ', 'x'));
      await savePatient(createPatient('あべ', 'y'));
      await import('../src/main');
      await waitFor(() => expect(rows()).toHaveLength(2));

      const select = el<HTMLSelectElement>('[data-testid="sort-select"]')!;
      select.value = 'name';
      select.dispatchEvent(new Event('change'));

      await waitFor(() =>
        expect([...document.querySelectorAll('.place-name')].map((e) => e.textContent)).toEqual([
          'あべ',
          'うえだ',
        ]),
      );
    });
  });

  describe('全選択・全解除', () => {
    it('「全選択」を押すと、表示中の全件が選択される', async () => {
      await startWithPlaces(3);

      el<HTMLButtonElement>('[data-testid="select-all-button"]')!.click();

      expect(el('[data-testid="selection-count"]')?.textContent).toBe('3件選択中');
    });

    it('全選択した後、もう一度押す(全解除)と選択が外れる', async () => {
      await startWithPlaces(2);
      el<HTMLButtonElement>('[data-testid="select-all-button"]')!.click();

      el<HTMLButtonElement>('[data-testid="select-all-button"]')!.click();

      expect(el('[data-testid="selection-bar"]')).toBeNull();
    });

    it('検索で絞り込んだ状態で全選択すると、絞り込んだ分だけ選ばれる', async () => {
      await startWithPlaces(3);
      const search = el<HTMLInputElement>('[data-testid="search-input"]')!;
      search.value = '場所2';
      search.dispatchEvent(new Event('input'));
      await waitFor(() => expect(rows()).toHaveLength(1));

      el<HTMLButtonElement>('[data-testid="select-all-button"]')!.click();

      expect(el('[data-testid="selection-count"]')?.textContent).toBe('1件選択中');
    });
  });

  describe('全解除の「元に戻す」(Task 12)', () => {
    it('3人選んで全解除すると知らせが出て、「元に戻す」で3人・同じ順番に戻る', async () => {
      await startWithPlaces(3);
      el<HTMLButtonElement>('[data-testid="select-all-button"]')!.click(); // 全選択
      const selectedOrder = [...document.querySelectorAll('input[data-id]')]
        .filter((c) => (c as HTMLInputElement).checked)
        .map((c) => (c as HTMLInputElement).dataset.id);

      el<HTMLButtonElement>('[data-testid="select-all-button"]')!.click(); // 全解除

      expect(el('[data-testid="undo-notice"]')?.textContent).toContain('選択を外しました');
      expect(el('[data-testid="selection-bar"]')).toBeNull();

      el<HTMLButtonElement>('[data-testid="undo-button"]')!.click();

      expect(el('[data-testid="undo-notice"]')).toBeNull();
      expect(el('[data-testid="selection-count"]')?.textContent).toBe('3件選択中');
      const restoredOrder = [...document.querySelectorAll('input[data-id]')]
        .filter((c) => (c as HTMLInputElement).checked)
        .map((c) => (c as HTMLInputElement).dataset.id);
      expect(restoredOrder).toEqual(selectedOrder);

      // 訪問順の並びも戻っている。
      el<HTMLButtonElement>('[data-testid="next-button"]')!.click();
      await waitFor(() => expect(el('[data-testid="stop-row"]')).not.toBeNull());
      const names = [...document.querySelectorAll('.stop-name')].map((e) => e.textContent);
      expect(names).toEqual(['場所3', '場所2', '場所1']);
    });

    it('外した後に別の人を選ぶと、知らせは消える', async () => {
      const ids = await startWithPlaces(3);
      el<HTMLButtonElement>('[data-testid="select-all-button"]')!.click();
      el<HTMLButtonElement>('[data-testid="select-all-button"]')!.click();
      expect(el('[data-testid="undo-notice"]')).not.toBeNull();

      checkbox(ids[0]!).click();

      expect(el('[data-testid="undo-notice"]')).toBeNull();
    });

    it('設定に移ると、知らせは消える', async () => {
      await startWithPlaces(3);
      el<HTMLButtonElement>('[data-testid="select-all-button"]')!.click();
      el<HTMLButtonElement>('[data-testid="select-all-button"]')!.click();
      expect(el('[data-testid="undo-notice"]')).not.toBeNull();

      el<HTMLButtonElement>('[data-testid="settings-button"]')!.click();

      expect(el('[data-testid="undo-notice"]')).toBeNull();
    });
  });

  describe('選択した複数件の一括削除', () => {
    it('選択バーの「⋯」→「削除」を押しても、すぐには削除せず、件数つきの確認ダイアログが出る', async () => {
      await startWithPlaces(2);
      el<HTMLButtonElement>('[data-testid="select-all-button"]')!.click();

      el<HTMLButtonElement>('[data-testid="selection-menu-button"]')!.click();
      el<HTMLButtonElement>('[data-testid="delete-selected-button"]')!.click();

      expect(el('#dialog-title')?.textContent).toBe('選択した2件を削除しますか?');
      expect(rows()).toHaveLength(2);
    });

    it('確認で「キャンセル」すると、削除されない', async () => {
      await startWithPlaces(2);
      el<HTMLButtonElement>('[data-testid="select-all-button"]')!.click();
      el<HTMLButtonElement>('[data-testid="selection-menu-button"]')!.click();
      el<HTMLButtonElement>('[data-testid="delete-selected-button"]')!.click();

      el<HTMLButtonElement>('[data-testid="dialog-cancel"]')!.click();

      expect(el('[data-testid="dialog"]')).toBeNull();
      expect(rows()).toHaveLength(2);
    });

    it('確認で「削除」すると、選択した分がまとめて削除され、選択も外れる', async () => {
      await startWithPlaces(3);
      el<HTMLButtonElement>('[data-testid="select-all-button"]')!.click();

      el<HTMLButtonElement>('[data-testid="selection-menu-button"]')!.click();
      el<HTMLButtonElement>('[data-testid="delete-selected-button"]')!.click();
      el<HTMLButtonElement>('[data-testid="dialog-confirm-delete-selected"]')!.click();

      await waitFor(() => expect(el('.message')?.textContent).toContain('3件を削除しました'));
      expect(rows()).toHaveLength(0);
      expect(el('[data-testid="selection-bar"]')).toBeNull();
    });

    it('一部だけ選んで削除すると、選んだ分だけ消え、残りは残る', async () => {
      const ids = await startWithPlaces(3);
      checkbox(ids[0]!).click();

      el<HTMLButtonElement>('[data-testid="selection-menu-button"]')!.click();
      el<HTMLButtonElement>('[data-testid="delete-selected-button"]')!.click();
      el<HTMLButtonElement>('[data-testid="dialog-confirm-delete-selected"]')!.click();

      await waitFor(() => expect(rows()).toHaveLength(2));
      expect(checkbox(ids[0]!)).toBeNull();
    });

    it('削除ボタンを連打しても、まとめて削除されるのは1回だけ', async () => {
      await startWithPlaces(2);
      el<HTMLButtonElement>('[data-testid="select-all-button"]')!.click();
      el<HTMLButtonElement>('[data-testid="selection-menu-button"]')!.click();
      el<HTMLButtonElement>('[data-testid="delete-selected-button"]')!.click();

      const confirmButton = el<HTMLButtonElement>('[data-testid="dialog-confirm-delete-selected"]')!;
      confirmButton.click();
      confirmButton.click();

      await waitFor(() => expect(rows()).toHaveLength(0));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(rows()).toHaveLength(0);
    });
  });
});

describe('ホーム画面への追加の案内', () => {
  it('タブで開いていると、ホーム画面への追加の案内が出て、閉じると消える', async () => {
    await import('../src/main');
    await waitFor(() => expect(el('[data-testid="install-notice"]')).not.toBeNull());
    el<HTMLButtonElement>('[data-testid="notice-install-dismiss"]')!.click();
    expect(el('[data-testid="install-notice"]')).toBeNull();
  });
});

describe('ホーム画面に追加した後、Safariのデータを読み込む案内(#Task9)', () => {
  const IPHONE_UA =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
  const originalUA = window.navigator.userAgent;
  const scrollIntoViewSpy = vi.fn();
  // jsdomにはElement.prototype.scrollIntoViewが無いので、テスト用に足す。
  Element.prototype.scrollIntoView = scrollIntoViewSpy;

  function stubUserAgent(value: string): void {
    Object.defineProperty(window.navigator, 'userAgent', { value, configurable: true });
  }
  function stubStandalone(value: boolean | undefined): void {
    Object.defineProperty(window.navigator, 'standalone', { value, configurable: true });
  }

  beforeEach(() => {
    scrollIntoViewSpy.mockClear();
  });

  afterEach(() => {
    stubUserAgent(originalUA);
    stubStandalone(undefined);
  });

  it('iPhoneのホーム画面アプリを0件で開くと案内が出て、「読み込む画面へ」で設定が開きスクロールする', async () => {
    stubUserAgent(IPHONE_UA);
    stubStandalone(true);
    await import('../src/main');
    await waitFor(() => expect(el('[data-testid="moved-data-notice"]')).not.toBeNull());
    expect(el('[data-testid="moved-data-notice"]')?.textContent).toContain('バックアップのファイルを読み込むと');

    el<HTMLButtonElement>('[data-testid="notice-moved-import"]')!.click();

    await waitFor(() => expect(el('[data-testid="backup-section"]')).not.toBeNull());
    expect(scrollIntoViewSpy).toHaveBeenCalledWith({ block: 'start' });
  });

  it('「閉じる」を押すと消え、以後は出ない', async () => {
    stubUserAgent(IPHONE_UA);
    stubStandalone(true);
    await import('../src/main');
    await waitFor(() => expect(el('[data-testid="moved-data-notice"]')).not.toBeNull());

    el<HTMLButtonElement>('[data-testid="notice-moved-dismiss"]')!.click();
    expect(el('[data-testid="moved-data-notice"]')).toBeNull();

    // 別の操作で再描画されても、閉じた後は出てこない。
    el<HTMLButtonElement>('[data-testid="new-button"]')!.click();
    expect(el('[data-testid="moved-data-notice"]')).toBeNull();
  });

  it('1件以上あれば出さない', async () => {
    const { savePatient } = await import('../src/db');
    const { createPatient } = await import('../src/patient');
    await savePatient(createPatient('場所1', '東京都1-1'));

    stubUserAgent(IPHONE_UA);
    stubStandalone(true);
    await import('../src/main');
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(el('[data-testid="moved-data-notice"]')).toBeNull();
  });

  it('Safari(タブ)で1件以上なら、ホーム画面追加の手順の小窓にバックアップの案内が入る', async () => {
    const { savePatient } = await import('../src/db');
    const { createPatient } = await import('../src/patient');
    await savePatient(createPatient('場所1', '東京都1-1'));

    stubUserAgent(IPHONE_UA);
    stubStandalone(false);
    await import('../src/main');
    await waitFor(() => expect(rows()).toHaveLength(1));
    await waitFor(() => expect(el('[data-testid="notice-install-steps"]')).not.toBeNull());
    el<HTMLButtonElement>('[data-testid="notice-install-steps"]')!.click();

    await waitFor(() => expect(el('[data-testid="dialog"]')).not.toBeNull());
    expect(el('[data-testid="dialog"]')?.textContent).toContain('バックアップを書き出す');
  });
});

describe('バックアップのお知らせ', () => {
  it('5件登録すると、お知らせが出て「あとで」で消える', async () => {
    await import('../src/main');
    await waitFor(() => expect(el('[data-testid="new-button"]')).not.toBeNull());
    // ホーム画面への追加の案内が優先して出るので、先に閉じておく。
    dismissInstallNotice();
    for (let i = 1; i <= 5; i += 1) {
      el<HTMLButtonElement>('[data-testid="new-button"]')!.click();
      el<HTMLInputElement>('[data-testid="name-input"]')!.value = `場所${i}`;
      el<HTMLInputElement>('[data-testid="address-input"]')!.value = `東京都${i}`;
      el<HTMLButtonElement>('[data-testid="save-button"]')!.click();
      await waitFor(() => expect(rows()).toHaveLength(i));
    }
    await waitFor(() => expect(el('[data-testid="backup-notice"]')).not.toBeNull());
    el<HTMLButtonElement>('[data-testid="notice-later"]')!.click();
    expect(el('[data-testid="backup-notice"]')).toBeNull();
  });

  it('設定の読み込みが終わる前は、昨日バックアップ済みでも「まだバックアップがありません」を出さない', async () => {
    const dbModule = await import('../src/db');
    const { savePatient, setMeta, closeDbForTest } = dbModule;
    const { createPatient } = await import('../src/patient');
    for (let i = 1; i <= 5; i += 1) {
      await savePatient(createPatient(`場所${i}`, `東京都${i}`));
    }
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await setMeta('lastBackupAt', yesterday);
    // main.tsが自分で接続を開き直せるよう、いったん閉じておく。
    await closeDbForTest();

    // reloadPatients(listPatients) と loadSettingsInfo(getMeta) は並行に走る。
    // getMetaをテスト側で保留にして、一覧が先に描画される状況を確実に作る
    // (リークするタイマーを避けるため、確定的に自分でresolveする)。
    let resolveMeta: (value: string | undefined) => void = () => {};
    const pendingMeta = new Promise<string | undefined>((resolve) => {
      resolveMeta = resolve;
    });
    vi.spyOn(dbModule, 'getMeta').mockImplementation(((key: string) =>
      key === 'lastBackupAt' ? pendingMeta : Promise.resolve(undefined)) as typeof dbModule.getMeta);

    await import('../src/main');
    // reloadPatientsは先に終わって一覧が5件描画されるが、loadSettingsInfoはまだ
    // 完了していない(getMetaが保留中の)状態で、誤ったお知らせが出ていないか確認する。
    await waitFor(() => expect(rows()).toHaveLength(5));
    dismissInstallNotice();
    expect(el('[data-testid="backup-notice"]')).toBeNull();

    // 設定の読み込みを完了させ、正しい最終バックアップ日時が反映された後も出ないことを確認する。
    resolveMeta(yesterday);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(el('[data-testid="backup-notice"]')).toBeNull();
  });

  it('最後のバックアップから31日たっていれば、お知らせに日数が出る', async () => {
    const { savePatient } = await import('../src/db');
    const { createPatient } = await import('../src/patient');
    const { setMeta, closeDbForTest } = await import('../src/db');
    for (let i = 1; i <= 5; i += 1) {
      await savePatient(createPatient(`場所${i}`, `東京都${i}`));
    }
    const monthAgo = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    await setMeta('lastBackupAt', monthAgo);
    await closeDbForTest();

    await import('../src/main');
    await waitFor(() => expect(rows()).toHaveLength(5));
    dismissInstallNotice();
    await waitFor(() => expect(el('[data-testid="backup-notice"]')).not.toBeNull());
    expect(el('[data-testid="backup-notice"]')?.textContent).toContain('31日');
  });
});

describe('ホーム画面への追加ボタンは使い終わると消える', () => {
  it('「ホーム画面に追加」を押すとpromptが呼ばれ、案内が「やり方を見る」に変わる', async () => {
    await import('../src/main');
    await waitFor(() => expect(el('[data-testid="new-button"]')).not.toBeNull());

    const prompt = vi.fn().mockResolvedValue(undefined);
    const event = new Event('beforeinstallprompt');
    Object.assign(event, { prompt });
    window.dispatchEvent(event);

    await waitFor(() => expect(el('[data-testid="notice-install"]')).not.toBeNull());
    el<HTMLButtonElement>('[data-testid="notice-install"]')!.click();

    expect(prompt).toHaveBeenCalledOnce();
    await waitFor(() => expect(el('[data-testid="notice-install"]')).toBeNull());
    expect(el('[data-testid="notice-install-steps"]')).not.toBeNull();
    expect(() => el<HTMLButtonElement>('[data-testid="notice-install-steps"]')!.click()).not.toThrow();
  });
});

describe('保存して続けて登録・同じ人の知らせ', () => {
  it('保存して続けて登録すると、フォームが空のまま残り、件数のお知らせが出る', async () => {
    await import('../src/main');
    await waitFor(() => expect(el('[data-testid="new-button"]')).not.toBeNull());
    dismissInstallNotice();
    el<HTMLButtonElement>('[data-testid="new-button"]')!.click();
    el<HTMLInputElement>('[data-testid="name-input"]')!.value = '山田';
    el<HTMLInputElement>('[data-testid="address-input"]')!.value = '東京都1';
    el<HTMLButtonElement>('[data-testid="save-continue-button"]')!.click();
    await waitFor(() => expect(el('.message')?.textContent).toContain('山田様を登録しました(続けて1人目)'));
    expect(el<HTMLInputElement>('[data-testid="name-input"]')!.value).toBe('');
  });

  it('同じ住所があれば知らせ、「そのまま登録」で保存される', async () => {
    await import('../src/main');
    await waitFor(() => expect(el('[data-testid="new-button"]')).not.toBeNull());
    dismissInstallNotice();
    let count = 0;
    for (const name of ['山田', '佐藤']) {
      await waitFor(() => expect(rows()).toHaveLength(count));
      el<HTMLButtonElement>('[data-testid="new-button"]')!.click();
      el<HTMLInputElement>('[data-testid="name-input"]')!.value = name;
      el<HTMLInputElement>('[data-testid="address-input"]')!.value = '東京都１－２－３';
      el<HTMLButtonElement>('[data-testid="save-button"]')!.click();
      if (name === '佐藤') {
        await waitFor(() => expect(el('[data-testid="dialog-save-anyway"]')).not.toBeNull());
        el<HTMLButtonElement>('[data-testid="dialog-save-anyway"]')!.click();
      }
      count += 1;
      await waitFor(() => expect(el('[data-testid="new-button"]')).not.toBeNull());
    }
    await waitFor(() => expect(rows()).toHaveLength(2));
  });
});

describe('駐車情報とメモ', () => {
  it('駐車「コインパーキング」とメモを入れて保存すると、地図のカードに出る', async () => {
    await import('../src/main');
    await waitFor(() => expect(el('[data-testid="new-button"]')).not.toBeNull());
    dismissInstallNotice();
    el<HTMLButtonElement>('[data-testid="new-button"]')!.click();
    el<HTMLInputElement>('[data-testid="name-input"]')!.value = '山田 太郎';
    el<HTMLInputElement>('[data-testid="address-input"]')!.value = '東京都千代田区1-1';
    const parkingSelect = el<HTMLSelectElement>('[data-testid="parking-select"]')!;
    parkingSelect.value = 'coin';
    parkingSelect.dispatchEvent(new Event('change'));
    el<HTMLTextAreaElement>('[data-testid="note-input"]')!.value = '駐車場: 北側のコインパーキング';
    el<HTMLButtonElement>('[data-testid="save-button"]')!.click();
    await waitFor(() => expect(rows()).toHaveLength(1));

    el<HTMLInputElement>('input[data-id]')!.click();
    el<HTMLButtonElement>('[data-testid="next-button"]')!.click();
    await waitFor(() => expect(el('[data-testid="open-map-button"]')).not.toBeNull());
    const historyRecorded = await armHistoryRecordWait();
    el<HTMLButtonElement>('[data-testid="open-map-button"]')!.click();
    await historyRecorded();

    await waitFor(() => expect(el('[data-testid="route-stop-info"]')).not.toBeNull());
    const badge = el('[data-testid="parking-badge"]')!;
    expect(badge.textContent).toBe('P');
    expect(el('[data-testid="route-stop-info"]')?.textContent).toContain('コインP');
    expect(el('[data-testid="route-stop-info"]')?.textContent).toContain('駐車場: 北側のコインパーキング');
  });

  it('許可証の期限が近い訪問先があると、お知らせが出て「閉じる」で消える', async () => {
    const { savePatient } = await import('../src/db');
    const { createPatient } = await import('../src/patient');
    const soon = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const patient = {
      ...createPatient('山田 太郎', '東京都千代田区1-1'),
      parking: { type: 'street_permit' as const, permitExpires: soon },
    };
    await savePatient(patient);

    await import('../src/main');
    await waitFor(() => expect(rows()).toHaveLength(1));
    dismissInstallNotice();

    await waitFor(() => expect(el('[data-testid="permit-notice"]')).not.toBeNull());
    expect(el('[data-testid="permit-notice"]')?.textContent).toContain('許可証の期限が近い訪問先: 1件');
    el<HTMLButtonElement>('[data-testid="notice-permit-dismiss"]')!.click();
    expect(el('[data-testid="permit-notice"]')).toBeNull();
  });

  it('「閉じる」から7日以上たつと、許可証の期限のお知らせが再び出る', async () => {
    const { savePatient } = await import('../src/db');
    const { createPatient } = await import('../src/patient');
    const soon = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const patient = {
      ...createPatient('山田 太郎', '東京都千代田区1-1'),
      parking: { type: 'street_permit' as const, permitExpires: soon },
    };
    await savePatient(patient);
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    window.localStorage.setItem('route-auto-input:permit-dismissed', eightDaysAgo);

    await import('../src/main');
    await waitFor(() => expect(rows()).toHaveLength(1));
    dismissInstallNotice();

    await waitFor(() => expect(el('[data-testid="permit-notice"]')).not.toBeNull());
    expect(el('[data-testid="permit-notice"]')?.textContent).toContain('許可証の期限が近い訪問先: 1件');
  });

  it('許可証の期限を入れてから駐車の種類を未設定に戻してキャンセルしても、確認は出ない(隠れた期限は無視する)', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await import('../src/main');
    await waitFor(() => expect(el('[data-testid="new-button"]')).not.toBeNull());
    dismissInstallNotice();
    el<HTMLButtonElement>('[data-testid="new-button"]')!.click();

    const parkingSelect = el<HTMLSelectElement>('[data-testid="parking-select"]')!;
    parkingSelect.value = 'street_permit';
    parkingSelect.dispatchEvent(new Event('change'));
    el<HTMLInputElement>('[data-testid="permit-expires-input"]')!.value = '2027-03-31';
    // 未設定に戻す(期限の欄は隠れるが、入力した値は消えずに残ったまま)。
    parkingSelect.value = '';
    parkingSelect.dispatchEvent(new Event('change'));

    el<HTMLButtonElement>('[data-testid="cancel-button"]')!.click();

    // 名前・住所・電話番号・駐車の種類・メモはすべて最初のまま。隠れて残った permitExpires
    // だけを理由に「入力中の内容を捨てますか?」の確認が出てはいけない。
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(el('h1')?.textContent).not.toBe('訪問先を登録');
  });
});

describe('出発・帰着の選択', () => {
  it('事業所から出発を選ぶと、地図のURLの origin が事業所の住所になる', async () => {
    const { savePatient, setMeta, closeDbForTest } = await import('../src/db');
    const { createPatient } = await import('../src/patient');
    const patientA = createPatient('場所A', '東京都千代田区1-1');
    const patientB = createPatient('場所B', '大阪府大阪市2-2');
    await savePatient(patientA);
    await savePatient(patientB);
    await setMeta('office', { name: '本店', address: '東京都中央区1-1' });
    await setMeta('routeEnds', { start: 'office', end: 'last' });
    await closeDbForTest();

    await import('../src/main');
    await waitFor(() => expect(rows()).toHaveLength(2));

    el<HTMLInputElement>(`input[data-id="${patientA.id}"]`)!.click();
    el<HTMLInputElement>(`input[data-id="${patientB.id}"]`)!.click();
    el<HTMLButtonElement>('[data-testid="next-button"]')!.click();
    await waitFor(() => expect(el('[data-testid="open-map-button"]')).not.toBeNull());
    const historyRecorded = await armHistoryRecordWait();
    el<HTMLButtonElement>('[data-testid="open-map-button"]')!.click();
    await historyRecorded();
    await waitFor(() => expect(el('[data-testid="open-route"]')).not.toBeNull());
    el<HTMLButtonElement>('[data-testid="open-route"]')!.click();

    const { openUrl } = await import('../src/openRoute');
    const url = new URL(vi.mocked(openUrl).mock.calls[0]![0]);
    expect(url.searchParams.get('origin')).toBe('東京都中央区1-1');
  });
});

describe('事業所の登録', () => {
  it('設定で事業所を保存すると、開き直しても残る', async () => {
    await import('../src/main');
    await waitFor(() => expect(el('[data-testid="settings-button"]')).not.toBeNull());
    el<HTMLButtonElement>('[data-testid="settings-button"]')!.click();
    await waitFor(() => expect(el('[data-testid="office-name-input"]')).not.toBeNull());
    el<HTMLInputElement>('[data-testid="office-name-input"]')!.value = '本店';
    el<HTMLInputElement>('[data-testid="office-address-input"]')!.value = '東京都中央区1-1';
    el<HTMLButtonElement>('[data-testid="office-save-button"]')!.click();
    await waitFor(() => expect(el('.message')?.textContent).toContain('事業所を保存しました'));
    const db = await import('../src/db');
    expect(await db.getMeta('office')).toEqual({ name: '本店', address: '東京都中央区1-1' });
  });
});

describe('事業所の合言葉', () => {
  it('保存するとDBに残り、画面には「設定されています」とだけ出て、合言葉そのものはどこにも出ない', async () => {
    await import('../src/main');
    await waitFor(() => expect(el('[data-testid="settings-button"]')).not.toBeNull());
    el<HTMLButtonElement>('[data-testid="settings-button"]')!.click();
    await waitFor(() => expect(el('[data-testid="shared-secret-input"]')).not.toBeNull());
    const input = el<HTMLInputElement>('[data-testid="shared-secret-input"]')!;
    input.value = 'ひみつのあいことばだよ';
    input.dispatchEvent(new Event('input'));
    el<HTMLButtonElement>('[data-testid="shared-secret-save"]')!.click();
    await waitFor(() => expect(el('.message')?.textContent).toContain('事業所の合言葉を保存しました'));
    const db = await import('../src/db');
    expect(await db.getMeta('sharedSecret')).toBe('ひみつのあいことばだよ');
    expect(el('[data-testid="shared-secret-status"]')?.textContent).toBe('設定されています');
    expect(document.body.innerHTML).not.toContain('ひみつのあいことばだよ');
  });

  it('10文字未満なら保存せず「10文字以上にしてください。」を出す', async () => {
    await import('../src/main');
    await waitFor(() => expect(el('[data-testid="settings-button"]')).not.toBeNull());
    el<HTMLButtonElement>('[data-testid="settings-button"]')!.click();
    await waitFor(() => expect(el('[data-testid="shared-secret-input"]')).not.toBeNull());
    const input = el<HTMLInputElement>('[data-testid="shared-secret-input"]')!;
    input.value = 'abcd';
    input.dispatchEvent(new Event('input'));
    el<HTMLButtonElement>('[data-testid="shared-secret-save"]')!.click();
    await waitFor(() => expect(el('.message')?.textContent).toContain('10文字以上にしてください'));
    const db = await import('../src/db');
    expect(await db.getMeta('sharedSecret')).toBeUndefined();
  });

  it('長さの数え方は送るダイアログと同じ(前後の空白も数える): 空白で始まる10文字は保存、9文字は保存しない', async () => {
    await import('../src/main');
    await waitFor(() => expect(el('[data-testid="settings-button"]')).not.toBeNull());
    el<HTMLButtonElement>('[data-testid="settings-button"]')!.click();
    await waitFor(() => expect(el('[data-testid="shared-secret-input"]')).not.toBeNull());
    const db = await import('../src/db');

    const short = el<HTMLInputElement>('[data-testid="shared-secret-input"]')!;
    short.value = 'abcdefghi';
    short.dispatchEvent(new Event('input'));
    el<HTMLButtonElement>('[data-testid="shared-secret-save"]')!.click();
    await waitFor(() => expect(el('.message')?.textContent).toContain('10文字以上にしてください'));
    expect(await db.getMeta('sharedSecret')).toBeUndefined();

    const input = el<HTMLInputElement>('[data-testid="shared-secret-input"]')!;
    input.value = ' abcdefghi';
    input.dispatchEvent(new Event('input'));
    el<HTMLButtonElement>('[data-testid="shared-secret-save"]')!.click();
    await waitFor(() => expect(el('.message')?.textContent).toContain('事業所の合言葉を保存しました'));
    expect(await db.getMeta('sharedSecret')).toBe(' abcdefghi');
  });

  it('「変える」で入力欄を出して保存し直せる。「やめる」は保存せず引っ込める', async () => {
    const { setMeta, closeDbForTest } = await import('../src/db');
    await setMeta('sharedSecret', 'もとのあいことば');
    await closeDbForTest();

    await import('../src/main');
    await waitFor(() => expect(el('[data-testid="settings-button"]')).not.toBeNull());
    el<HTMLButtonElement>('[data-testid="settings-button"]')!.click();
    await waitFor(() => expect(el('[data-testid="shared-secret-status"]')?.textContent).toBe('設定されています'));

    el<HTMLButtonElement>('[data-testid="shared-secret-change"]')!.click();
    await waitFor(() => expect(el('[data-testid="shared-secret-input"]')).not.toBeNull());
    expect(el('[data-testid="shared-secret-cancel"]')).not.toBeNull();

    el<HTMLButtonElement>('[data-testid="shared-secret-cancel"]')!.click();
    await waitFor(() => expect(el('[data-testid="shared-secret-status"]')?.textContent).toBe('設定されています'));
    const db = await import('../src/db');
    expect(await db.getMeta('sharedSecret')).toBe('もとのあいことば');

    el<HTMLButtonElement>('[data-testid="shared-secret-change"]')!.click();
    await waitFor(() => expect(el('[data-testid="shared-secret-input"]')).not.toBeNull());
    const input = el<HTMLInputElement>('[data-testid="shared-secret-input"]')!;
    input.value = 'あたらしいあいことば';
    input.dispatchEvent(new Event('input'));
    el<HTMLButtonElement>('[data-testid="shared-secret-save"]')!.click();
    await waitFor(() => expect(el('.message')?.textContent).toContain('事業所の合言葉を保存しました'));
    expect(await db.getMeta('sharedSecret')).toBe('あたらしいあいことば');
  });

  it('「消す」は確認してから消す(cancel/confirm)', async () => {
    const { setMeta, closeDbForTest } = await import('../src/db');
    await setMeta('sharedSecret', 'きえるあいことば');
    await closeDbForTest();

    await import('../src/main');
    await waitFor(() => expect(el('[data-testid="settings-button"]')).not.toBeNull());
    el<HTMLButtonElement>('[data-testid="settings-button"]')!.click();
    await waitFor(() => expect(el('[data-testid="shared-secret-clear"]')).not.toBeNull());

    const db = await import('../src/db');
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    el<HTMLButtonElement>('[data-testid="shared-secret-clear"]')!.click();
    expect(window.confirm).toHaveBeenCalledWith('事業所の合言葉を消しますか?');
    expect(await db.getMeta('sharedSecret')).toBe('きえるあいことば');

    vi.spyOn(window, 'confirm').mockReturnValue(true);
    el<HTMLButtonElement>('[data-testid="shared-secret-clear"]')!.click();
    await waitFor(() => expect(el('.message')?.textContent).toContain('事業所の合言葉を消しました'));
    expect(await db.getMeta('sharedSecret')).toBeUndefined();
    expect(el('[data-testid="shared-secret-input"]')).not.toBeNull();
  });
});

describe('送る', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function fillPassword(password: string): void {
    const input = el<HTMLInputElement>('[data-testid="transfer-password"]')!;
    input.value = password;
    input.dispatchEvent(new Event('input'));
    const confirmInput = el<HTMLInputElement>('[data-testid="transfer-password-confirm"]')!;
    confirmInput.value = password;
    confirmInput.dispatchEvent(new Event('input'));
  }

  it('一覧の「⋯」から1人を送ると、「ファイルを作る」→「LINEなどで送る」で、共有の偽物に渡ったFileが暗号化されており、同じパスワードで名前・メモ・位置・写真が読める', async () => {
    const db = await import('../src/db');
    const { createPatient } = await import('../src/patient');
    const patient = {
      ...createPatient('山田 太郎', '東京都千代田区1-1'),
      note: '駐車場は裏手にあります',
      location: {
        lat: 35.68,
        lng: 139.76,
        accuracy: 10,
        recordedAt: '2026-09-22T00:00:00.000Z',
        source: 'gps' as const,
      },
    };
    await db.savePatient(patient);
    // fake-indexeddb はBlobをstructuredCloneすると中身が失われることがあるため、
    // 本物のBlobを持つ写真をlistPhotosの戻りとして直接与える(バックアップの結合テストと同じやり方)。
    vi.spyOn(db, 'listPhotos').mockResolvedValue([
      { id: 'photo-1', patientId: patient.id, blob: new Blob(['x'], { type: 'image/jpeg' }), createdAt: 't1' },
    ]);

    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...window.navigator, share, canShare: () => true });

    await import('../src/main');
    await waitFor(() => expect(rows()).toHaveLength(1));

    el<HTMLButtonElement>(`[data-testid="row-menu"][data-id="${patient.id}"]`)!.click();
    el<HTMLButtonElement>('[data-testid="dialog-send"]')!.click();
    await waitFor(() => expect(el('[data-testid="transfer-password"]')).not.toBeNull());

    fillPassword('sakura-2026');
    el<HTMLButtonElement>('[data-testid="transfer-send-button"]')!.click();

    await waitFor(() => expect(el('[data-testid="transfer-share-button"]')).not.toBeNull());
    expect(share).not.toHaveBeenCalled();
    el<HTMLButtonElement>('[data-testid="transfer-share-button"]')!.click();

    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    const file = share.mock.calls[0]![0].files[0] as File;
    expect(file.type).toBe('text/plain');
    const text = await file.text();
    expect(text).not.toContain('山田 太郎');

    const { decryptText } = await import('../src/crypto');
    const { parsePayload } = await import('../src/transfer');
    const payload = parsePayload(await decryptText(text, 'sakura-2026'));
    expect(payload.patients).toHaveLength(1);
    expect(payload.patients[0]!.name).toBe('山田 太郎');
    expect(payload.patients[0]!.note).toBe('駐車場は裏手にあります');
    expect(payload.patients[0]!.location?.lat).toBe(35.68);
    expect(payload.photos).toHaveLength(1);

    await waitFor(() => expect(el('[data-testid="transfer-done-text"]')?.textContent).toBe('送りました。'));
  }, 10_000);

  it('共有できない端末では、readyで「ファイルを保存」と保存先の案内を出す', async () => {
    const db = await import('../src/db');
    const { createPatient } = await import('../src/patient');
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    await db.savePatient(patient);
    const downloadSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    vi.stubGlobal('navigator', { ...window.navigator, share: undefined, canShare: undefined });

    await import('../src/main');
    await waitFor(() => expect(rows()).toHaveLength(1));

    el<HTMLButtonElement>(`[data-testid="row-menu"][data-id="${patient.id}"]`)!.click();
    el<HTMLButtonElement>('[data-testid="dialog-send"]')!.click();
    await waitFor(() => expect(el('[data-testid="transfer-password"]')).not.toBeNull());
    fillPassword('sakura-2026');
    el<HTMLButtonElement>('[data-testid="transfer-send-button"]')!.click();

    await waitFor(() => expect(el('[data-testid="transfer-save-button"]')).not.toBeNull());
    expect(el('[data-testid="transfer-save-hint"]')).not.toBeNull();
    expect(el('[data-testid="transfer-share-button"]')).toBeNull();
    el<HTMLButtonElement>('[data-testid="transfer-save-button"]')!.click();

    await waitFor(() => expect(el('[data-testid="transfer-done-text"]')?.textContent).toBe(
      'ファイルを保存しました。LINE などで送ってください。',
    ));
    expect(downloadSpy).toHaveBeenCalledTimes(1);
  }, 10_000);

  it('パスワードが10文字未満なら、送らずエラーを出す', async () => {
    const db = await import('../src/db');
    const { createPatient } = await import('../src/patient');
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    await db.savePatient(patient);
    const share = vi.fn();
    vi.stubGlobal('navigator', { ...window.navigator, share, canShare: () => true });

    await import('../src/main');
    await waitFor(() => expect(rows()).toHaveLength(1));

    el<HTMLButtonElement>(`[data-testid="row-menu"][data-id="${patient.id}"]`)!.click();
    el<HTMLButtonElement>('[data-testid="dialog-send"]')!.click();
    await waitFor(() => expect(el('[data-testid="transfer-password"]')).not.toBeNull());
    fillPassword('abc');

    el<HTMLButtonElement>('[data-testid="transfer-send-button"]')!.click();

    expect(el('.message')?.textContent).toContain('10文字以上にしてください');
    expect(share).not.toHaveBeenCalled();
  });

  it('確認用パスワードが一致しなければ、送らずエラーを出す', async () => {
    const db = await import('../src/db');
    const { createPatient } = await import('../src/patient');
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    await db.savePatient(patient);

    await import('../src/main');
    await waitFor(() => expect(rows()).toHaveLength(1));

    el<HTMLButtonElement>(`[data-testid="row-menu"][data-id="${patient.id}"]`)!.click();
    el<HTMLButtonElement>('[data-testid="dialog-send"]')!.click();
    await waitFor(() => expect(el('[data-testid="transfer-password"]')).not.toBeNull());
    el<HTMLInputElement>('[data-testid="transfer-password"]')!.value = 'sakura-2026';
    el('[data-testid="transfer-password"]')!.dispatchEvent(new Event('input'));
    el<HTMLInputElement>('[data-testid="transfer-password-confirm"]')!.value = 'sakura-2027';
    el('[data-testid="transfer-password-confirm"]')!.dispatchEvent(new Event('input'));

    el<HTMLButtonElement>('[data-testid="transfer-send-button"]')!.click();

    expect(el('.message')?.textContent).toContain('確認のパスワードが一致しません');
  });

  it('事業所の合言葉が保存されていれば、それを使って送れる(パスワード欄は出ない)', async () => {
    const db = await import('../src/db');
    await db.setMeta('sharedSecret', 'jimusho-no-aikotoba');
    await db.closeDbForTest();
    const { createPatient } = await import('../src/patient');
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    await db.savePatient(patient);

    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...window.navigator, share, canShare: () => true });

    await import('../src/main');
    await waitFor(() => expect(rows()).toHaveLength(1));

    el<HTMLButtonElement>(`[data-testid="row-menu"][data-id="${patient.id}"]`)!.click();
    el<HTMLButtonElement>('[data-testid="dialog-send"]')!.click();
    await waitFor(() => expect(el('[data-testid="transfer-use-shared"]')).not.toBeNull());
    expect(el<HTMLInputElement>('[data-testid="transfer-use-shared"]')!.checked).toBe(true);
    expect(el('[data-testid="transfer-password"]')).toBeNull();

    el<HTMLButtonElement>('[data-testid="transfer-send-button"]')!.click();
    await waitFor(() => expect(el('[data-testid="transfer-share-button"]')).not.toBeNull());
    el<HTMLButtonElement>('[data-testid="transfer-share-button"]')!.click();

    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    const file = share.mock.calls[0]![0].files[0] as File;
    const { decryptText } = await import('../src/crypto');
    await expect(decryptText(await file.text(), 'jimusho-no-aikotoba')).resolves.toEqual(expect.any(String));
  }, 10_000);

  it('設定のお役立ち地点から、地点だけを送れる', async () => {
    const db = await import('../src/db');
    await db.putSpot({
      id: 'spot-1',
      kind: 'toilet',
      note: 'きれいなトイレ',
      location: { lat: 35, lng: 139, accuracy: 10, recordedAt: '2026-09-22T00:00:00.000Z', source: 'gps' },
      createdAt: '2026-09-22T00:00:00.000Z',
    });
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...window.navigator, share, canShare: () => true });

    await import('../src/main');
    await waitFor(() => expect(el('[data-testid="settings-button"]')).not.toBeNull());
    el<HTMLButtonElement>('[data-testid="settings-button"]')!.click();
    await waitFor(() => expect(el('[data-testid="send-spots-button"]')).not.toBeNull());

    el<HTMLButtonElement>('[data-testid="send-spots-button"]')!.click();
    await waitFor(() => expect(el('[data-testid="transfer-password"]')).not.toBeNull());
    expect(el('#dialog-title')?.textContent).toBe('お役立ち地点を送る');
    fillPassword('sakura-2026');

    el<HTMLButtonElement>('[data-testid="transfer-send-button"]')!.click();
    await waitFor(() => expect(el('[data-testid="transfer-share-button"]')).not.toBeNull());
    el<HTMLButtonElement>('[data-testid="transfer-share-button"]')!.click();

    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    const file = share.mock.calls[0]![0].files[0] as File;
    const { decryptText } = await import('../src/crypto');
    const { parsePayload } = await import('../src/transfer');
    const payload = parsePayload(await decryptText(await file.text(), 'sakura-2026'));
    expect(payload.patients).toHaveLength(0);
    expect(payload.spots).toHaveLength(1);
    expect(payload.spots[0]!.note).toBe('きれいなトイレ');
  }, 10_000);

  it('選択バーの「⋯」→「送る」で、選択中の全員を送れる', async () => {
    const db = await import('../src/db');
    const { createPatient } = await import('../src/patient');
    const a = createPatient('山田 太郎', '東京都千代田区1-1');
    const b = createPatient('鈴木 花子', '東京都千代田区2-2');
    await db.savePatient(a);
    await db.savePatient(b);
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...window.navigator, share, canShare: () => true });

    await import('../src/main');
    await waitFor(() => expect(rows()).toHaveLength(2));
    el<HTMLInputElement>(`[data-testid="patient-checkbox"][data-id="${a.id}"]`)!.click();
    el<HTMLInputElement>(`[data-testid="patient-checkbox"][data-id="${b.id}"]`)!.click();

    await waitFor(() => expect(el('[data-testid="selection-menu-button"]')).not.toBeNull());
    el<HTMLButtonElement>('[data-testid="selection-menu-button"]')!.click();
    await waitFor(() => expect(el('[data-testid="send-selected-button"]')).not.toBeNull());
    el<HTMLButtonElement>('[data-testid="send-selected-button"]')!.click();
    await waitFor(() => expect(el('[data-testid="transfer-password"]')).not.toBeNull());
    expect(el('#dialog-title')?.textContent).toBe('山田 太郎様ほか1人を送る');
    fillPassword('sakura-2026');

    el<HTMLButtonElement>('[data-testid="transfer-send-button"]')!.click();
    await waitFor(() => expect(el('[data-testid="transfer-share-button"]')).not.toBeNull());
    el<HTMLButtonElement>('[data-testid="transfer-share-button"]')!.click();

    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    const file = share.mock.calls[0]![0].files[0] as File;
    const { decryptText } = await import('../src/crypto');
    const { parsePayload } = await import('../src/transfer');
    const payload = parsePayload(await decryptText(await file.text(), 'sakura-2026'));
    expect(payload.patients).toHaveLength(2);
  }, 10_000);

  it('合言葉として保存して送ったあと、同じセッションでもう一度送ると「事業所の合言葉を使う」が出てチェックされている', async () => {
    const db = await import('../src/db');
    const { createPatient } = await import('../src/patient');
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    await db.savePatient(patient);
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...window.navigator, share, canShare: () => true });

    await import('../src/main');
    await waitFor(() => expect(rows()).toHaveLength(1));

    el<HTMLButtonElement>(`[data-testid="row-menu"][data-id="${patient.id}"]`)!.click();
    el<HTMLButtonElement>('[data-testid="dialog-send"]')!.click();
    await waitFor(() => expect(el('[data-testid="transfer-password"]')).not.toBeNull());
    fillPassword('sakura-2026');
    el<HTMLInputElement>('[data-testid="transfer-save-shared"]')!.click();
    el<HTMLButtonElement>('[data-testid="transfer-send-button"]')!.click();
    await waitFor(() => expect(el('[data-testid="transfer-share-button"]')).not.toBeNull());
    el<HTMLButtonElement>('[data-testid="transfer-share-button"]')!.click();

    await waitFor(() => expect(el('[data-testid="transfer-done-text"]')).not.toBeNull());
    expect(await db.getMeta('sharedSecret')).toBe('sakura-2026');
    el<HTMLButtonElement>('[data-testid="dialog-cancel"]')!.click();

    el<HTMLButtonElement>(`[data-testid="row-menu"][data-id="${patient.id}"]`)!.click();
    el<HTMLButtonElement>('[data-testid="dialog-send"]')!.click();
    await waitFor(() => expect(el('[data-testid="transfer-use-shared"]')).not.toBeNull());
    expect(el<HTMLInputElement>('[data-testid="transfer-use-shared"]')!.checked).toBe(true);
    expect(el('[data-testid="transfer-password"]')).toBeNull();
  }, 10_000);

  it('ファイルを作っている間(working)はEscキーで閉じない。readyになれば閉じられる', async () => {
    const db = await import('../src/db');
    const { createPatient } = await import('../src/patient');
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    await db.savePatient(patient);
    // listPhotos(写真の変換より前)を止めて、working中であることを確実に保つ。
    let releasePhotos: (photos: Awaited<ReturnType<typeof db.listPhotos>>) => void = () => {};
    const photosPromise = new Promise<Awaited<ReturnType<typeof db.listPhotos>>>((resolve) => {
      releasePhotos = resolve;
    });
    vi.spyOn(db, 'listPhotos').mockReturnValue(photosPromise);
    vi.stubGlobal('navigator', { ...window.navigator, share: vi.fn(), canShare: () => true });

    await import('../src/main');
    await waitFor(() => expect(rows()).toHaveLength(1));

    el<HTMLButtonElement>(`[data-testid="row-menu"][data-id="${patient.id}"]`)!.click();
    el<HTMLButtonElement>('[data-testid="dialog-send"]')!.click();
    await waitFor(() => expect(el('[data-testid="transfer-password"]')).not.toBeNull());
    fillPassword('sakura-2026');
    el<HTMLButtonElement>('[data-testid="transfer-send-button"]')!.click();

    await waitFor(() => expect(el('[data-testid="transfer-working-text"]')).not.toBeNull());
    expect(el<HTMLButtonElement>('[data-testid="transfer-send-button"]')?.disabled).toBe(true);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(el('[data-testid="dialog"]')).not.toBeNull();

    // 背景(overlay)を押しても、working中は閉じない。
    el('[data-testid="dialog-overlay"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(el('[data-testid="dialog"]')).not.toBeNull();

    releasePhotos([]);
    await waitFor(() => expect(el('[data-testid="transfer-share-button"]')).not.toBeNull());

    // readyになれば、Escキーで閉じられる。
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(el('[data-testid="dialog"]')).toBeNull();
  }, 10_000);

  it('選択バーの「⋯」の小窓から開いた送るダイアログを閉じると、フォーカスが「⋯」へ戻る', async () => {
    const db = await import('../src/db');
    const { createPatient } = await import('../src/patient');
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    await db.savePatient(patient);

    await import('../src/main');
    await waitFor(() => expect(rows()).toHaveLength(1));
    el<HTMLInputElement>(`[data-testid="patient-checkbox"][data-id="${patient.id}"]`)!.click();
    await waitFor(() => expect(el('[data-testid="selection-menu-button"]')).not.toBeNull());

    el<HTMLButtonElement>('[data-testid="selection-menu-button"]')!.click();
    await waitFor(() => expect(el('[data-testid="send-selected-button"]')).not.toBeNull());
    el<HTMLButtonElement>('[data-testid="send-selected-button"]')!.click();
    await waitFor(() => expect(el('[data-testid="dialog"]')).not.toBeNull());
    el<HTMLButtonElement>('[data-testid="dialog-cancel"]')!.click();

    expect(el('[data-testid="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(el('[data-testid="selection-menu-button"]'));
  });

  it('選択バーの「⋯」の小窓を「キャンセル」で閉じると、フォーカスが「⋯」へ戻る', async () => {
    const db = await import('../src/db');
    const { createPatient } = await import('../src/patient');
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    await db.savePatient(patient);

    await import('../src/main');
    await waitFor(() => expect(rows()).toHaveLength(1));
    el<HTMLInputElement>(`[data-testid="patient-checkbox"][data-id="${patient.id}"]`)!.click();
    await waitFor(() => expect(el('[data-testid="selection-menu-button"]')).not.toBeNull());

    el<HTMLButtonElement>('[data-testid="selection-menu-button"]')!.click();
    await waitFor(() => expect(el('[data-testid="dialog"]')).not.toBeNull());
    el<HTMLButtonElement>('[data-testid="dialog-cancel"]')!.click();

    expect(el('[data-testid="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(el('[data-testid="selection-menu-button"]'));
  });

  it('選択バーの「⋯」→「削除」の確認を「キャンセル」で閉じると、フォーカスが「⋯」へ戻る', async () => {
    const db = await import('../src/db');
    const { createPatient } = await import('../src/patient');
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    await db.savePatient(patient);

    await import('../src/main');
    await waitFor(() => expect(rows()).toHaveLength(1));
    el<HTMLInputElement>(`[data-testid="patient-checkbox"][data-id="${patient.id}"]`)!.click();
    await waitFor(() => expect(el('[data-testid="selection-menu-button"]')).not.toBeNull());

    el<HTMLButtonElement>('[data-testid="selection-menu-button"]')!.click();
    el<HTMLButtonElement>('[data-testid="delete-selected-button"]')!.click();
    await waitFor(() => expect(el('[data-testid="dialog"]')).not.toBeNull());
    el<HTMLButtonElement>('[data-testid="dialog-cancel"]')!.click();

    expect(el('[data-testid="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(el('[data-testid="selection-menu-button"]'));
  });

  it('設定の「お役立ち地点を送る」から開いた送るダイアログを閉じると、フォーカスが「お役立ち地点を送る」ボタンへ戻る', async () => {
    const db = await import('../src/db');
    await db.putSpot({
      id: 'spot-1',
      kind: 'toilet',
      note: 'きれいなトイレ',
      location: { lat: 35, lng: 139, accuracy: 10, recordedAt: '2026-09-22T00:00:00.000Z', source: 'gps' },
      createdAt: '2026-09-22T00:00:00.000Z',
    });

    await import('../src/main');
    await waitFor(() => expect(el('[data-testid="settings-button"]')).not.toBeNull());
    el<HTMLButtonElement>('[data-testid="settings-button"]')!.click();
    await waitFor(() => expect(el('[data-testid="send-spots-button"]')).not.toBeNull());

    el<HTMLButtonElement>('[data-testid="send-spots-button"]')!.click();
    await waitFor(() => expect(el('[data-testid="dialog"]')).not.toBeNull());
    el<HTMLButtonElement>('[data-testid="dialog-cancel"]')!.click();

    expect(el('[data-testid="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(el('[data-testid="send-spots-button"]'));
  });
});

describe('履歴から選ぶ', () => {
  it('地図を開くと今日の記録ができ、履歴の画面から同じ人を選び直せる', async () => {
    await import('../src/main');
    await waitFor(() => expect(el('[data-testid="new-button"]')).not.toBeNull());
    dismissInstallNotice();

    // 2件登録
    el<HTMLButtonElement>('[data-testid="new-button"]')!.click();
    el<HTMLInputElement>('[data-testid="name-input"]')!.value = '山田 太郎';
    el<HTMLInputElement>('[data-testid="address-input"]')!.value = '東京都千代田区1-1';
    el<HTMLButtonElement>('[data-testid="save-button"]')!.click();
    await waitFor(() => expect(rows()).toHaveLength(1));

    el<HTMLButtonElement>('[data-testid="new-button"]')!.click();
    el<HTMLInputElement>('[data-testid="name-input"]')!.value = '佐藤 花子';
    el<HTMLInputElement>('[data-testid="address-input"]')!.value = '大阪府大阪市2-2';
    el<HTMLButtonElement>('[data-testid="save-button"]')!.click();
    await waitFor(() => expect(rows()).toHaveLength(2));

    // 全選択 → 訪問順 → 「この順番で地図を開く」
    el<HTMLButtonElement>('[data-testid="select-all-button"]')!.click();
    el<HTMLButtonElement>('[data-testid="next-button"]')!.click();
    await waitFor(() => expect(el('[data-testid="open-map-button"]')).not.toBeNull());
    el<HTMLButtonElement>('[data-testid="open-map-button"]')!.click();

    const db = await import('../src/db');
    await waitFor(async () => expect((await db.listHistory()).length).toBe(1));

    // 一覧へ戻り、選択を解除してから履歴で選び直す
    el<HTMLButtonElement>('[data-testid="tab-list"]')!.click();
    el<HTMLButtonElement>('[data-testid="select-all-button"]')!.click(); // 全解除
    el<HTMLButtonElement>('[data-testid="history-button"]')!.click();
    await waitFor(() => expect(el('[data-testid="history-row"]')).not.toBeNull());
    el<HTMLButtonElement>('[data-testid="history-row"]')!.click();
    el<HTMLButtonElement>('[data-testid="history-pick"]')!.click();
    await waitFor(() => expect(el('[data-testid="stop-row"]')).not.toBeNull());
    expect(document.querySelectorAll('[data-testid="stop-row"]')).toHaveLength(2);
    const [entry] = await db.listHistory();
    await waitFor(async () => expect(await db.getMeta('routeEnds')).toEqual(entry!.routeEnds));
  });

  it('記録の訪問先が全員名簿から消えていたら、選ばずに履歴の画面に留まりエラーを出す', async () => {
    const db = await import('../src/db');
    await db.putHistory({
      date: '2026-09-18',
      ids: ['gone-1', 'gone-2'],
      routeEnds: { start: 'first', end: 'last' },
      visited: {},
    });

    await import('../src/main');
    await waitFor(() => expect(el('[data-testid="new-button"]')).not.toBeNull());
    dismissInstallNotice();

    el<HTMLButtonElement>('[data-testid="history-button"]')!.click();
    await waitFor(() => expect(el('[data-testid="history-row"]')).not.toBeNull());
    el<HTMLButtonElement>('[data-testid="history-row"]')!.click();
    el<HTMLButtonElement>('[data-testid="history-pick"]')!.click();

    await waitFor(() =>
      expect(el('.message')?.textContent).toContain('記録の訪問先は、すべて名簿にないため選べませんでした'),
    );
    expect(el('[data-testid="history-row"]')).not.toBeNull();
    expect(el('[data-testid="stop-row"]')).toBeNull();
  });

  describe('選び直しの「元に戻す」(Task 12)', () => {
    it('選択があるときに履歴から選び直すと「選択を置き換えました」の知らせが出て、「元に戻す」で前の選択・順番・出発帰着・開いたルートの印が戻る', async () => {
      const { createPatient } = await import('../src/patient');
      const patientA = createPatient('山田 太郎', '東京都千代田区1-1');
      const patientB = createPatient('佐藤 花子', '大阪府大阪市2-2');
      const patientC = createPatient('鈴木 次郎', '東京都新宿区3-3');
      const db = await import('../src/db');
      await db.savePatient(patientA);
      await db.savePatient(patientB);
      await db.savePatient(patientC);
      await db.putHistory({
        date: '2026-09-18',
        ids: [patientC.id],
        routeEnds: { start: 'current', end: 'last' },
        visited: {},
      });
      await db.closeDbForTest();

      await import('../src/main');
      await waitFor(() => expect(rows()).toHaveLength(3));
      dismissInstallNotice();

      // 山田→佐藤の順に選び、訪問順の画面で地図を開いて、ルートに開いた印をつける。
      el<HTMLInputElement>(`input[data-id="${patientA.id}"]`)!.click();
      el<HTMLInputElement>(`input[data-id="${patientB.id}"]`)!.click();
      el<HTMLButtonElement>('[data-testid="next-button"]')!.click();
      await waitFor(() => expect(el('[data-testid="open-map-button"]')).not.toBeNull());
      expect(el<HTMLSelectElement>('[data-testid="route-start-select"]')!.value).toBe('first');
      el<HTMLButtonElement>('[data-testid="open-map-button"]')!.click();
      await waitFor(() => expect(el('[data-testid="route-card"]')).not.toBeNull());
      el<HTMLButtonElement>('[data-testid="open-route"][data-id="0"]')!.click();
      await waitFor(() => expect(el('[data-testid="route-card"]')?.getAttribute('data-state')).toBe('done'));
      // 「地図を開く」で今日の記録もできるので、その書き込みが終わるまで待つ
      // (待たないと、次のbeforeEachのdeleteDBと競合することがある)。
      await waitFor(async () => expect((await db.listHistory()).length).toBe(2));

      // 一覧へ戻り、履歴から選び直す(鈴木さんだけの記録に置き換わる。今日の記録(山田・佐藤)ではない方を選ぶ)。
      el<HTMLButtonElement>('[data-testid="tab-list"]')!.click();
      el<HTMLButtonElement>('[data-testid="history-button"]')!.click();
      await waitFor(() => expect(document.querySelectorAll('[data-testid="history-row"]')).toHaveLength(2));
      const targetRow = [...document.querySelectorAll<HTMLButtonElement>('[data-testid="history-row"]')].find((row) =>
        row.textContent?.includes('1人'),
      )!;
      targetRow.click();
      el<HTMLButtonElement>('[data-testid="history-pick"]')!.click();

      await waitFor(() => expect(el('[data-testid="stop-row"]')).not.toBeNull());
      expect(document.querySelectorAll('[data-testid="stop-row"]')).toHaveLength(1);
      expect(el('[data-testid="undo-notice"]')?.textContent).toContain('選択を置き換えました');

      el<HTMLButtonElement>('[data-testid="undo-button"]')!.click();

      // 画面は訪問順のまま、選択・順番が戻る。
      expect(el('[data-testid="undo-notice"]')).toBeNull();
      await waitFor(() => expect(document.querySelectorAll('[data-testid="stop-row"]')).toHaveLength(2));
      const names = [...document.querySelectorAll('.stop-name')].map((e) => e.textContent);
      expect(names).toEqual(['山田 太郎', '佐藤 花子']);
      // 出発・帰着も戻る。
      expect(el<HTMLSelectElement>('[data-testid="route-start-select"]')!.value).toBe('first');
      expect(el<HTMLSelectElement>('[data-testid="route-end-select"]')!.value).toBe('last');
      await waitFor(async () => expect(await db.getMeta('routeEnds')).toEqual({ start: 'first', end: 'last' }));

      // 開いたルートの印(「済」ではなく「もう一度開く」表示)も戻る。
      const historyRecorded = await armHistoryRecordWait();
      el<HTMLButtonElement>('[data-testid="open-map-button"]')!.click();
      await waitFor(() => expect(el('[data-testid="route-card"]')?.getAttribute('data-state')).toBe('done'));
      // 「地図を開く」で今日の記録もできるので、次のテストのbeforeEach(deleteDB)と
      // 競合しないよう、その書き込みが終わるまで待つ。
      await historyRecorded();
    });

    it('選択が無いときに履歴から選ぶと、知らせは出ない', async () => {
      const { createPatient } = await import('../src/patient');
      const patient = createPatient('山田 太郎', '東京都千代田区1-1');
      const db = await import('../src/db');
      await db.savePatient(patient);
      await db.putHistory({
        date: '2026-09-18',
        ids: [patient.id],
        routeEnds: { start: 'first', end: 'last' },
        visited: {},
      });
      await db.closeDbForTest();

      await import('../src/main');
      await waitFor(() => expect(rows()).toHaveLength(1));
      dismissInstallNotice();

      el<HTMLButtonElement>('[data-testid="history-button"]')!.click();
      await waitFor(() => expect(el('[data-testid="history-row"]')).not.toBeNull());
      el<HTMLButtonElement>('[data-testid="history-row"]')!.click();
      el<HTMLButtonElement>('[data-testid="history-pick"]')!.click();

      await waitFor(() => expect(el('[data-testid="stop-row"]')).not.toBeNull());
      expect(el('[data-testid="undo-notice"]')).toBeNull();
    });
  });
});

describe('訪問済みと時刻・履歴のコピー・古い履歴の削除', () => {
  it('地図の画面で「済」を押すと、履歴に時刻が残り、もう一度押すと消える', async () => {
    const { createPatient } = await import('../src/patient');
    const patientA = createPatient('山田 太郎', '東京都千代田区1-1');
    const patientB = createPatient('佐藤 花子', '大阪府大阪市2-2');
    const { savePatient, closeDbForTest } = await import('../src/db');
    await savePatient(patientA);
    await savePatient(patientB);
    await closeDbForTest();

    await import('../src/main');
    await waitFor(() => expect(rows()).toHaveLength(2));
    dismissInstallNotice();

    el<HTMLButtonElement>('[data-testid="select-all-button"]')!.click();
    el<HTMLButtonElement>('[data-testid="next-button"]')!.click();
    await waitFor(() => expect(el('[data-testid="open-map-button"]')).not.toBeNull());
    const historyRecorded = await armHistoryRecordWait();
    el<HTMLButtonElement>('[data-testid="open-map-button"]')!.click();
    await historyRecorded();
    await waitFor(() => expect(el('[data-testid="visited-toggle"]')).not.toBeNull());

    el<HTMLButtonElement>('[data-testid="visited-toggle"]')!.click();
    const db = await import('../src/db');
    await waitFor(async () => expect(Object.keys((await db.listHistory())[0]!.visited)).toHaveLength(1));
    await waitFor(() => expect(el('[data-testid="visited-toggle"]')!.textContent).toMatch(/^済 \d+:\d{2}$/));

    el<HTMLButtonElement>('[data-testid="visited-toggle"]')!.click();
    await waitFor(async () => expect(Object.keys((await db.listHistory())[0]!.visited)).toHaveLength(0));
  });

  it('訪問の記録の保存に失敗したら、黙らず「地図を開く」でも「済」でも同じ文でエラーを知らせる', async () => {
    const { createPatient } = await import('../src/patient');
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    const db = await import('../src/db');
    await db.savePatient(patient);
    await db.closeDbForTest();
    // 前のテスト(地図の画面で選択中のまま終わるもの)の、fire-and-forgetのtoggleVisited
    // の後始末(loadHistory→render→セッション保存)が、ここへ来るまでのawaitの間に
    // 完了しきらず、前回の選択をlocalStorageのセッション記録へ書き戻すことがある。
    // このテストは選択なしの一覧から始めたいので、そのキーだけ念のためもう一度消す
    // (unlock()が書いた合言葉解錠の記録は残す。clear()だとそれも消えてロック画面に戻ってしまう)。
    window.localStorage.removeItem('route-auto-input:session');

    await import('../src/main');
    await waitFor(() => expect(rows()).toHaveLength(1));
    dismissInstallNotice();

    vi.spyOn(db, 'updateHistory').mockRejectedValue(new Error('x'));

    el<HTMLButtonElement>('[data-testid="select-all-button"]')!.click();
    el<HTMLButtonElement>('[data-testid="next-button"]')!.click();
    await waitFor(() => expect(el('[data-testid="open-map-button"]')).not.toBeNull());
    el<HTMLButtonElement>('[data-testid="open-map-button"]')!.click();

    await waitFor(() => expect(el('.message')?.textContent).toBe('訪問の記録を保存できませんでした。'));

    el<HTMLButtonElement>('[data-testid="visited-toggle"]')!.click();
    await waitFor(() => expect(el('.message')?.textContent).toBe('訪問の記録を保存できませんでした。'));
  });

  it('起動時に56日より古い履歴を消す', async () => {
    const db = await import('../src/db');
    await db.putHistory({ date: '2020-01-01', ids: [], routeEnds: { start: 'first', end: 'last' }, visited: {} });
    await db.closeDbForTest();

    await import('../src/main');
    await waitFor(async () => expect(await db.listHistory()).toEqual([]));
  });

  it('起動時に、名簿に無い訪問先を指す持ち主のいない写真を片付ける', async () => {
    const db = await import('../src/db');
    const { createPatient } = await import('../src/patient');
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    await db.savePatient(patient);
    await db.addPhoto({
      id: 'kept',
      patientId: patient.id,
      blob: new Blob(['x'], { type: 'image/jpeg' }),
      createdAt: '2026-09-20T00:00:00.000Z',
    });
    await db.addPhoto({
      id: 'orphan',
      patientId: 'gone',
      blob: new Blob(['x'], { type: 'image/jpeg' }),
      createdAt: '2026-09-20T00:00:00.000Z',
    });
    await db.closeDbForTest();

    await import('../src/main');
    await waitFor(async () => expect((await db.listAllPhotos()).map((p) => p.id)).toEqual(['kept']));
  });

  it('履歴の「コピー」を押すと、訪問した時刻と名前がクリップボードにコピーされる', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
    const { createPatient } = await import('../src/patient');
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    const db = await import('../src/db');
    await db.savePatient(patient);
    await db.putHistory({
      date: '2026-09-22',
      ids: [patient.id],
      routeEnds: { start: 'first', end: 'last' },
      visited: { [patient.id]: new Date(2026, 8, 22, 9, 12).toISOString() },
    });
    await db.closeDbForTest();

    await import('../src/main');
    await waitFor(() => expect(el('[data-testid="new-button"]')).not.toBeNull());
    dismissInstallNotice();

    el<HTMLButtonElement>('[data-testid="history-button"]')!.click();
    await waitFor(() => expect(el('[data-testid="history-row"]')).not.toBeNull());
    el<HTMLButtonElement>('[data-testid="history-row"]')!.click();
    await waitFor(() => expect(el('[data-testid="history-copy"]')).not.toBeNull());
    el<HTMLButtonElement>('[data-testid="history-copy"]')!.click();

    await waitFor(() => expect(el('.message')?.textContent).toContain('コピーしました'));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('山田 太郎'));
  });

  it('設定の「履歴をすべて消す」で確認すると、履歴が消える', async () => {
    const db = await import('../src/db');
    await db.putHistory({ date: '2026-09-20', ids: [], routeEnds: { start: 'first', end: 'last' }, visited: {} });
    await db.closeDbForTest();

    await import('../src/main');
    await waitFor(() => expect(el('[data-testid="settings-button"]')).not.toBeNull());
    dismissInstallNotice();
    el<HTMLButtonElement>('[data-testid="settings-button"]')!.click();
    await waitFor(() => expect(el('[data-testid="clear-history-button"]')).not.toBeNull());

    vi.spyOn(window, 'confirm').mockReturnValue(true);
    el<HTMLButtonElement>('[data-testid="clear-history-button"]')!.click();

    await waitFor(async () => expect(await db.listHistory()).toEqual([]));
  });
});

describe('位置の登録', () => {
  function fakeGeolocation() {
    let success: PositionCallback = () => {};
    const geolocation = {
      watchPosition: vi.fn((s: PositionCallback) => {
        success = s;
        return 1;
      }),
      clearWatch: vi.fn(),
      getCurrentPosition: vi.fn(),
    } as unknown as Geolocation;
    const emit = (lat: number, lng: number, accuracy: number) =>
      success({ coords: { latitude: lat, longitude: lng, accuracy } } as GeolocationPosition);
    return { geolocation, emit };
  }

  afterEach(() => {
    delete (navigator as { geolocation?: Geolocation }).geolocation;
  });

  it('今いる場所で登録: 精度15mで自動的に測り終え、保存するとDBのsourceがgpsになる。元に戻すと消える', async () => {
    const { geolocation, emit } = fakeGeolocation();
    Object.defineProperty(navigator, 'geolocation', { value: geolocation, configurable: true });

    const { savePatient, listPatients } = await import('../src/db');
    const { createPatient } = await import('../src/patient');
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    await savePatient(patient);

    await import('../src/main');
    await waitFor(() => expect(rows()).toHaveLength(1));
    dismissInstallNotice();

    el<HTMLButtonElement>(`[data-testid="row-menu"][data-id="${patient.id}"]`)!.click();
    await waitFor(() => expect(el('[data-testid="dialog-location"]')).not.toBeNull());
    expect(el('[data-testid="dialog-location"]')?.textContent).toBe('位置を登録');
    el<HTMLButtonElement>('[data-testid="dialog-location"]')!.click();
    await waitFor(() => expect(el('[data-testid="location-measure-button"]')).not.toBeNull());

    el<HTMLButtonElement>('[data-testid="location-measure-button"]')!.click();
    await waitFor(() => expect(geolocation.watchPosition).toHaveBeenCalledTimes(1));

    emit(35.1, 139.1, 15);
    await waitFor(() => expect(el<HTMLButtonElement>('[data-testid="location-save-button"]')?.disabled).toBe(false));
    expect(el('body')?.textContent).toContain('誤差 ±15m');

    el<HTMLButtonElement>('[data-testid="location-save-button"]')!.click();
    await waitFor(async () => {
      const saved = (await listPatients()).find((p) => p.id === patient.id);
      expect(saved?.location).toEqual({ lat: 35.1, lng: 139.1, accuracy: 15, recordedAt: expect.any(String), source: 'gps' });
    });
    await waitFor(() => expect(el('[data-testid="location-undo-button"]')).not.toBeNull());

    el<HTMLButtonElement>('[data-testid="location-undo-button"]')!.click();
    await waitFor(async () => {
      const reverted = (await listPatients()).find((p) => p.id === patient.id);
      expect(reverted && 'location' in reverted).toBe(false);
    });
  });

  it('貼り付けでも登録できる(source: paste)', async () => {
    const { savePatient, listPatients } = await import('../src/db');
    const { createPatient } = await import('../src/patient');
    const patient = createPatient('鈴木 花子', '大阪府大阪市1-1');
    await savePatient(patient);

    await import('../src/main');
    await waitFor(() => expect(rows()).toHaveLength(1));
    dismissInstallNotice();

    el<HTMLButtonElement>(`[data-testid="row-menu"][data-id="${patient.id}"]`)!.click();
    el<HTMLButtonElement>('[data-testid="dialog-location"]')!.click();
    await waitFor(() => expect(el('[data-testid="location-paste-input"]')).not.toBeNull());

    const input = el<HTMLInputElement>('[data-testid="location-paste-input"]')!;
    input.value = '35.1, 139.1';
    input.dispatchEvent(new Event('input'));
    el<HTMLButtonElement>('[data-testid="location-paste-save"]')!.click();

    await waitFor(async () => {
      const saved = (await listPatients()).find((p) => p.id === patient.id);
      expect(saved?.location).toEqual({ lat: 35.1, lng: 139.1, accuracy: null, recordedAt: expect.any(String), source: 'paste' });
    });
  });

  /** 患者を1人登録し、位置の登録ダイアログを開いて「今いる場所で登録」を押し、watchPositionが呼ばれるまで待つ。 */
  async function setupMeasuring(): Promise<{
    patient: Patient;
    geolocation: Geolocation & { watchPosition: ReturnType<typeof vi.fn>; clearWatch: ReturnType<typeof vi.fn> };
    emit: (lat: number, lng: number, accuracy: number) => void;
  }> {
    const { geolocation, emit } = fakeGeolocation();
    Object.defineProperty(navigator, 'geolocation', { value: geolocation, configurable: true });

    const { savePatient } = await import('../src/db');
    const { createPatient } = await import('../src/patient');
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    await savePatient(patient);

    await import('../src/main');
    await waitFor(() => expect(rows()).toHaveLength(1));
    dismissInstallNotice();

    el<HTMLButtonElement>(`[data-testid="row-menu"][data-id="${patient.id}"]`)!.click();
    el<HTMLButtonElement>('[data-testid="dialog-location"]')!.click();
    await waitFor(() => expect(el('[data-testid="location-measure-button"]')).not.toBeNull());
    el<HTMLButtonElement>('[data-testid="location-measure-button"]')!.click();
    await waitFor(() => expect(geolocation.watchPosition).toHaveBeenCalledTimes(1));

    return {
      patient,
      geolocation: geolocation as unknown as Geolocation & {
        watchPosition: ReturnType<typeof vi.fn>;
        clearWatch: ReturnType<typeof vi.fn>;
      },
      emit,
    };
  }

  it('測定中に保存すると、そこで測定を止める。保存後の遅れて来た更新はsavedを上書きしない', async () => {
    const { geolocation, emit } = await setupMeasuring();

    // 35m(fair)は自動では終わらない値。まだ測定中のまま保存する。
    emit(35.1, 139.1, 35);
    await waitFor(() => expect(el<HTMLButtonElement>('[data-testid="location-save-button"]')?.disabled).toBe(false));

    el<HTMLButtonElement>('[data-testid="location-save-button"]')!.click();
    await waitFor(() => expect(el('[data-testid="location-undo-button"]')).not.toBeNull());
    await waitFor(() => expect(geolocation.clearWatch).toHaveBeenCalled());

    // 止め終わった後に(遅れて)来た更新は無視され、saved のままでなければならない。
    emit(35.2, 139.2, 25);
    expect(el('[data-testid="location-undo-button"]')).not.toBeNull();
  });

  it('保存すると、フォーカスが「地図で確かめる」へ移る(Enterキーで誤って元に戻すのを防ぐ、Minor 5)', async () => {
    const { emit } = await setupMeasuring();
    emit(35.1, 139.1, 15);
    await waitFor(() => expect(el<HTMLButtonElement>('[data-testid="location-save-button"]')?.disabled).toBe(false));

    el<HTMLButtonElement>('[data-testid="location-save-button"]')!.click();
    await waitFor(() => expect(el('[data-testid="location-undo-button"]')).not.toBeNull());
    expect(document.activeElement).toBe(el('[data-testid="location-check-link"]'));
  });

  it('位置ピンから開いて新しく登録し閉じると、ピンが無くなっていても「開く」ボタンへフォーカスが戻る(Minor 5)', async () => {
    const { savePatient } = await import('../src/db');
    const { createPatient } = await import('../src/patient');
    const patient = createPatient('場所A', '東京都千代田区1-1');
    await savePatient(patient);

    await import('../src/main');
    await waitFor(() => expect(rows()).toHaveLength(1));
    dismissInstallNotice();

    el<HTMLInputElement>(`input[data-id="${patient.id}"]`)!.click();
    el<HTMLButtonElement>('[data-testid="next-button"]')!.click();
    await waitFor(() => expect(el('[data-testid="open-map-button"]')).not.toBeNull());
    const historyRecorded = await armHistoryRecordWait();
    el<HTMLButtonElement>('[data-testid="open-map-button"]')!.click();
    await historyRecorded();

    await waitFor(() => expect(el('[data-testid="location-pin"]')).not.toBeNull());
    el<HTMLButtonElement>('[data-testid="location-pin"]')!.click();
    await waitFor(() => expect(el('[data-testid="location-paste-input"]')).not.toBeNull());

    const input = el<HTMLInputElement>('[data-testid="location-paste-input"]')!;
    input.value = '35.1, 139.1';
    input.dispatchEvent(new Event('input'));
    el<HTMLButtonElement>('[data-testid="location-paste-save"]')!.click();
    await waitFor(() => expect(el('[data-testid="location-check-link"]')).not.toBeNull());

    el<HTMLButtonElement>('[data-testid="dialog-cancel"]')!.click();
    await waitFor(() => expect(el('[data-testid="dialog"]')).toBeNull());

    // 位置が登録されたので、位置ピン自体が(このカードからは)無くなっている。
    expect(el('[data-testid="location-pin"]')).toBeNull();
    expect(document.activeElement).toBe(el('[data-testid="open-route"]'));
  });

  it('ダイアログをキャンセルで閉じると、測定中なら止める(clearWatch)', async () => {
    const { geolocation } = await setupMeasuring();

    el<HTMLButtonElement>('[data-testid="dialog-cancel"]')!.click();

    await waitFor(() => expect(geolocation.clearWatch).toHaveBeenCalledTimes(1));
  });

  it('Escapeで閉じると、測定中なら止める(clearWatch)', async () => {
    const { geolocation } = await setupMeasuring();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

    await waitFor(() => expect(geolocation.clearWatch).toHaveBeenCalledTimes(1));
  });

  it('画面を移ると、測定中なら止める(clearWatch)', async () => {
    const { geolocation } = await setupMeasuring();

    el<HTMLButtonElement>('[data-testid="settings-button"]')!.click();

    await waitFor(() => expect(geolocation.clearWatch).toHaveBeenCalledTimes(1));
  });

  it('貼り付けで2回登録してから元に戻すと、1回目の位置にきっちり戻る', async () => {
    const { savePatient, listPatients } = await import('../src/db');
    const { createPatient } = await import('../src/patient');
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    await savePatient(patient);

    await import('../src/main');
    await waitFor(() => expect(rows()).toHaveLength(1));
    dismissInstallNotice();

    const registerByPaste = async (text: string) => {
      el<HTMLButtonElement>(`[data-testid="row-menu"][data-id="${patient.id}"]`)!.click();
      el<HTMLButtonElement>('[data-testid="dialog-location"]')!.click();
      await waitFor(() => expect(el('[data-testid="location-paste-input"]')).not.toBeNull());
      const input = el<HTMLInputElement>('[data-testid="location-paste-input"]')!;
      input.value = text;
      input.dispatchEvent(new Event('input'));
      el<HTMLButtonElement>('[data-testid="location-paste-save"]')!.click();
      await waitFor(() => expect(el('[data-testid="location-undo-button"]')).not.toBeNull());
    };

    await registerByPaste('35.1, 139.1');
    const firstLocation = (await listPatients()).find((p) => p.id === patient.id)!.location!;

    el<HTMLButtonElement>('[data-testid="dialog-cancel"]')!.click();
    await waitFor(() => expect(el('[data-testid="dialog"]')).toBeNull());

    await registerByPaste('35.2, 139.2');
    const secondLocation = (await listPatients()).find((p) => p.id === patient.id)!.location!;
    expect(secondLocation).not.toEqual(firstLocation);

    el<HTMLButtonElement>('[data-testid="location-undo-button"]')!.click();
    await waitFor(async () => {
      const reverted = (await listPatients()).find((p) => p.id === patient.id)!.location;
      expect(reverted).toEqual(firstLocation);
    });
  });

  it('貼り付け欄を開いて入力すると、再描画のたびにフォーカスと開いた状態を保つ。読めない入力は開いたままエラーを出す', async () => {
    const { savePatient } = await import('../src/db');
    const { createPatient } = await import('../src/patient');
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    await savePatient(patient);

    await import('../src/main');
    await waitFor(() => expect(rows()).toHaveLength(1));
    dismissInstallNotice();

    el<HTMLButtonElement>(`[data-testid="row-menu"][data-id="${patient.id}"]`)!.click();
    el<HTMLButtonElement>('[data-testid="dialog-location"]')!.click();
    await waitFor(() => expect(el('[data-testid="location-paste-input"]')).not.toBeNull());

    const details = () => el<HTMLDetailsElement>('.location-paste')!;
    expect(details().open).toBe(false);

    // 折りたたみを手で開く(toggleイベント)。
    details().open = true;
    details().dispatchEvent(new Event('toggle'));
    await waitFor(() => expect(details().open).toBe(true));

    const text = 'これは座標ではない';
    for (let i = 1; i <= text.length; i += 1) {
      const input = el<HTMLInputElement>('[data-testid="location-paste-input"]')!;
      input.focus();
      input.value = text.slice(0, i);
      input.dispatchEvent(new Event('input'));
      expect(document.activeElement).toBe(el('[data-testid="location-paste-input"]'));
      expect(details().open).toBe(true);
    }

    el<HTMLButtonElement>('[data-testid="location-paste-save"]')!.click();
    await waitFor(() => expect(el('body')?.textContent).toContain('座標またはGoogleマップのURLを読み取れませんでした。'));
    expect(details().open).toBe(true);
    expect(details().contains(el('[data-testid="location-paste-input"]'))).toBe(true);
  });

  it('地図のカードの「位置」から開いたダイアログを閉じると、フォーカスが位置ボタンへ戻る', async () => {
    const { savePatient } = await import('../src/db');
    const { createPatient } = await import('../src/patient');
    const patient = createPatient('場所A', '東京都千代田区1-1');
    await savePatient(patient);
    window.localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        timestamp: new Date().toISOString(),
        selectedIds: [patient.id],
        opened: [{ index: 0, at: '' }],
      }),
    );

    await import('../src/main');
    await waitFor(() => expect(el('[data-testid="location-pin"]')).not.toBeNull());

    el<HTMLButtonElement>('[data-testid="location-pin"]')!.click();
    await waitFor(() => expect(el('[data-testid="dialog"]')).not.toBeNull());

    el<HTMLButtonElement>('[data-testid="dialog-cancel"]')!.click();

    expect(el('[data-testid="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(el(`[data-testid="location-pin"][data-id="${patient.id}"]`));
  });

  it('本物のブラウザのように、details.openを立て直すだけでtoggleが飛んでも、無限に再描画しない', async () => {
    const { savePatient } = await import('../src/db');
    const { createPatient } = await import('../src/patient');
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    await savePatient(patient);

    await import('../src/main');
    await waitFor(() => expect(rows()).toHaveLength(1));
    dismissInstallNotice();

    el<HTMLButtonElement>(`[data-testid="row-menu"][data-id="${patient.id}"]`)!.click();
    el<HTMLButtonElement>('[data-testid="dialog-location"]')!.click();
    await waitFor(() => expect(el('[data-testid="location-paste-input"]')).not.toBeNull());

    // テキストを入れると details.open が(パース中のsetStateとは別に)立って開いたままになる。
    // このinput イベントの再描画で入力欄自体も作り直されるので、以降の比較のために
    // 基準となる要素は、この再描画が終わったあとで取り直す。
    el<HTMLInputElement>('[data-testid="location-paste-input"]')!.value = '35.1, 139.1';
    el<HTMLInputElement>('[data-testid="location-paste-input"]')!.dispatchEvent(new Event('input'));

    const details = el<HTMLDetailsElement>('.location-paste')!;
    const input = el<HTMLInputElement>('[data-testid="location-paste-input"]')!;
    expect(details.open).toBe(true);

    // 本物のブラウザでは、再描画のたびに details.open = true を立て直す処理そのものが
    // toggleイベントを飛ばす。jsdomは自動では飛ばさないので、ここで直接シミュレートする。
    // ガードが無ければ、1回ごとにonPasteToggle→setState→再描画→新しいdetails要素…と
    // 無限ループになる(このテストはタイムアウトするはず)。ガードがあれば、見た目
    // (open=true)がすでに一致しているので、setStateも再描画も起きない。
    details.dispatchEvent(new Event('toggle'));
    details.dispatchEvent(new Event('toggle'));
    details.dispatchEvent(new Event('toggle'));

    // 再描画していなければ、同じdetails要素のまま(root.replaceChildrenは呼ばれていない)。
    expect(el<HTMLDetailsElement>('.location-paste')).toBe(details);
    // 入力欄の値も、打った内容のまま(作り直されていれば別のinput要素になっている)。
    expect(el<HTMLInputElement>('[data-testid="location-paste-input"]')).toBe(input);
    expect(input.value).toBe('35.1, 139.1');
  });
});

describe('写真', () => {
  it('編集フォームで写真を追加するとDBに保存されフォームにサムネイルが出て、訪問先を削除すると写真も消える', async () => {
    const { savePatient, listPhotos } = await import('../src/db');
    const { createPatient } = await import('../src/patient');
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    await savePatient(patient);

    await import('../src/main');
    await waitFor(() => expect(rows()).toHaveLength(1));
    dismissInstallNotice();

    el<HTMLButtonElement>(`[data-testid="row-menu"][data-id="${patient.id}"]`)!.click();
    el<HTMLButtonElement>('[data-testid="dialog-edit"]')!.click();
    await waitFor(() => expect(el('[data-testid="photo-input"]')).not.toBeNull());

    const file = new File(['x'], 'photo.jpg', { type: 'image/jpeg' });
    const input = el<HTMLInputElement>('[data-testid="photo-input"]')!;
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));

    await waitFor(() => expect(el('[data-testid="photo-thumb"]')).not.toBeNull());
    expect(await listPhotos(patient.id)).toHaveLength(1);
    expect(el<HTMLInputElement>('[data-testid="photo-input"]')!.value).toBe('');

    // フォームを離れると、formPhotosのobject URLが片付く(setState一箇所のrevoke)。
    const revokeCallsBeforeLeavingForm = vi.mocked(URL.revokeObjectURL).mock.calls.length;
    el<HTMLButtonElement>('[data-testid="cancel-button"]')!.click();
    await waitFor(() => expect(el('[data-testid="new-button"]')).not.toBeNull());
    expect(vi.mocked(URL.revokeObjectURL).mock.calls.length).toBeGreaterThan(revokeCallsBeforeLeavingForm);

    el<HTMLButtonElement>(`[data-testid="row-menu"][data-id="${patient.id}"]`)!.click();
    el<HTMLButtonElement>('[data-testid="dialog-delete"]')!.click();
    el<HTMLButtonElement>('[data-testid="dialog-confirm-delete"]')!.click();

    await waitFor(() => expect(rows()).toHaveLength(0));
    expect(await listPhotos(patient.id)).toEqual([]);
  });

  it('編集フォームで名前とメモを打ちかけたまま写真を追加/削除しても、入力中の内容が消えない', async () => {
    const { savePatient, listPhotos } = await import('../src/db');
    const { createPatient } = await import('../src/patient');
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    await savePatient(patient);

    await import('../src/main');
    await waitFor(() => expect(rows()).toHaveLength(1));
    dismissInstallNotice();

    el<HTMLButtonElement>(`[data-testid="row-menu"][data-id="${patient.id}"]`)!.click();
    el<HTMLButtonElement>('[data-testid="dialog-edit"]')!.click();
    await waitFor(() => expect(el('[data-testid="photo-input"]')).not.toBeNull());

    const nameInput = el<HTMLInputElement>('[data-testid="name-input"]')!;
    nameInput.value = '山田 次郎';
    nameInput.dispatchEvent(new Event('input'));
    const noteInput = el<HTMLTextAreaElement>('[data-testid="note-input"]')!;
    noteInput.value = '打ちかけのメモ';
    noteInput.dispatchEvent(new Event('input'));

    const file = new File(['x'], 'photo.jpg', { type: 'image/jpeg' });
    const input = el<HTMLInputElement>('[data-testid="photo-input"]')!;
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    const addDone = await armPhotoActionWait();
    input.dispatchEvent(new Event('change'));

    await waitFor(() => expect(el('[data-testid="photo-thumb"]')).not.toBeNull());
    await addDone();
    expect(await listPhotos(patient.id)).toHaveLength(1);
    // 写真が増えてフォームが作り直されても、打ちかけの入力はそのまま。
    expect(el<HTMLInputElement>('[data-testid="name-input"]')!.value).toBe('山田 次郎');
    expect(el<HTMLTextAreaElement>('[data-testid="note-input"]')!.value).toBe('打ちかけのメモ');

    const deleteDone = await armPhotoActionWait();
    el<HTMLButtonElement>('[data-testid="photo-delete"]')!.click();
    await waitFor(async () => expect(await listPhotos(patient.id)).toHaveLength(0));
    await deleteDone();
    expect(el<HTMLInputElement>('[data-testid="name-input"]')!.value).toBe('山田 次郎');
    expect(el<HTMLTextAreaElement>('[data-testid="note-input"]')!.value).toBe('打ちかけのメモ');
  });

  it('写真を3枚登録すると追加ボタンが消え、地図のカードに「写真 N」が出て押すと見られる', async () => {
    const { savePatient, listPhotos } = await import('../src/db');
    const { createPatient } = await import('../src/patient');
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    await savePatient(patient);

    await import('../src/main');
    await waitFor(() => expect(rows()).toHaveLength(1));
    dismissInstallNotice();

    el<HTMLButtonElement>(`[data-testid="row-menu"][data-id="${patient.id}"]`)!.click();
    el<HTMLButtonElement>('[data-testid="dialog-edit"]')!.click();
    await waitFor(() => expect(el('[data-testid="photo-input"]')).not.toBeNull());

    for (let i = 0; i < 3; i += 1) {
      const file = new File(['x'], `photo${i}.jpg`, { type: 'image/jpeg' });
      const input = el<HTMLInputElement>('[data-testid="photo-input"]')!;
      Object.defineProperty(input, 'files', { value: [file], configurable: true });
      input.dispatchEvent(new Event('change'));
      await waitFor(() => expect(document.querySelectorAll('[data-testid="photo-thumb"]')).toHaveLength(i + 1));
    }
    expect(await listPhotos(patient.id)).toHaveLength(3);
    expect(el('[data-testid="photo-input"]')).toBeNull();

    el<HTMLButtonElement>('[data-testid="cancel-button"]')!.click();
    await waitFor(() => expect(rows()).toHaveLength(1));

    el<HTMLInputElement>(`input[data-id="${patient.id}"]`)!.click();
    el<HTMLButtonElement>('[data-testid="next-button"]')!.click();
    await waitFor(() => expect(el('[data-testid="open-map-button"]')).not.toBeNull());
    const historyRecorded = await armHistoryRecordWait();
    el<HTMLButtonElement>('[data-testid="open-map-button"]')!.click();
    await historyRecorded();

    await waitFor(() => expect(el('[data-testid="photo-count"]')).not.toBeNull());
    expect(el('[data-testid="photo-count"]')?.textContent).toBe('写真 3');
    expect(el('[data-testid="photo-count"]')?.getAttribute('aria-label')).toBe('山田 太郎の写真(3枚)');
    el<HTMLButtonElement>('[data-testid="photo-count"]')!.click();

    await waitFor(() => expect(el('[data-testid="photo-view"]')).not.toBeNull());
    expect(el('[data-testid="dialog"]')?.textContent).toContain('1 / 3');
    // 端(先頭)なので「前」は押せず、代わりに押せる最初のボタン(「次」)にフォーカスが移る。
    expect(el<HTMLButtonElement>('[data-testid="photo-prev"]')?.disabled).toBe(true);
    expect(document.activeElement).toBe(el('[data-testid="photo-next"]'));

    // 「次」を末尾まで押すと、直前までフォーカスしていた「次」ボタン自体が disabled になる。
    // その場合は「見つからなかった」ものとして扱い、押せる最初のボタンへフォーカスが回る。
    el<HTMLButtonElement>('[data-testid="photo-next"]')!.click();
    el<HTMLButtonElement>('[data-testid="photo-next"]')!.click();
    expect(el('[data-testid="dialog"]')?.textContent).toContain('3 / 3');
    expect(el<HTMLButtonElement>('[data-testid="photo-next"]')?.disabled).toBe(true);
    expect(document.activeElement).not.toBe(el('[data-testid="photo-next"]'));
    expect((document.activeElement as HTMLButtonElement).disabled).toBe(false);

    // 閉じると、写真のダイアログが持っていたobject URLが片付く(setState一箇所のrevoke)。
    const revokeCallsBeforeClosingDialog = vi.mocked(URL.revokeObjectURL).mock.calls.length;
    el<HTMLButtonElement>('[data-testid="dialog-cancel"]')!.click();
    expect(el('[data-testid="dialog"]')).toBeNull();
    expect(vi.mocked(URL.revokeObjectURL).mock.calls.length).toBeGreaterThan(revokeCallsBeforeClosingDialog);
  });

  it('写真の追加に失敗しても、知らない形のエラーは生のメッセージを出さず汎用メッセージにする', async () => {
    const { savePatient } = await import('../src/db');
    const { createPatient } = await import('../src/patient');
    const { resizeImage } = await import('../src/imageResize');
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    await savePatient(patient);

    await import('../src/main');
    await waitFor(() => expect(rows()).toHaveLength(1));
    dismissInstallNotice();

    el<HTMLButtonElement>(`[data-testid="row-menu"][data-id="${patient.id}"]`)!.click();
    el<HTMLButtonElement>('[data-testid="dialog-edit"]')!.click();
    await waitFor(() => expect(el('[data-testid="photo-input"]')).not.toBeNull());

    // 生の(英語/技術的な)メッセージを持つ失敗を1回だけ起こす。
    vi.mocked(resizeImage).mockRejectedValueOnce(new DOMException('Failed to execute createImageBitmap'));
    const file = new File(['x'], 'photo.jpg', { type: 'image/jpeg' });
    const input = el<HTMLInputElement>('[data-testid="photo-input"]')!;
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));

    await waitFor(() => expect(el('.message')).not.toBeNull());
    expect(el('.message')?.textContent).toBe('写真を追加できませんでした。');
    expect(el('.message')?.textContent).not.toContain('createImageBitmap');
  });

  it('訪問先を消すと写真も消える', async () => {
    const db = await import('../src/db');
    const { createPatient } = await import('../src/patient');
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    await db.savePatient(patient);
    await db.addPhoto({
      id: 'photo-1',
      patientId: patient.id,
      blob: new Blob(['x'], { type: 'image/jpeg' }),
      createdAt: '2026-09-20T00:00:00.000Z',
    });

    await import('../src/main');
    await waitFor(() => expect(rows()).toHaveLength(1));
    dismissInstallNotice();

    el<HTMLButtonElement>(`[data-testid="row-menu"][data-id="${patient.id}"]`)!.click();
    el<HTMLButtonElement>('[data-testid="dialog-delete"]')!.click();
    el<HTMLButtonElement>('[data-testid="dialog-confirm-delete"]')!.click();

    await waitFor(() => expect(rows()).toHaveLength(0));
    expect(el('.message')?.textContent).toContain('削除しました');
    expect(await db.listPhotos(patient.id)).toEqual([]);
  });
});

describe('お役立ち地点の登録', () => {
  function fakeGeolocation() {
    let success: PositionCallback = () => {};
    const geolocation = {
      watchPosition: vi.fn((s: PositionCallback) => {
        success = s;
        return 1;
      }),
      clearWatch: vi.fn(),
      getCurrentPosition: vi.fn(),
    } as unknown as Geolocation;
    const emit = (lat: number, lng: number, accuracy: number) =>
      success({ coords: { latitude: lat, longitude: lng, accuracy } } as GeolocationPosition);
    return { geolocation, emit };
  }

  afterEach(() => {
    delete (navigator as { geolocation?: Geolocation }).geolocation;
  });

  it('地点を登録 → 設定に出る → 位置のある訪問先の近くに出る → 設定で削除', async () => {
    const { geolocation, emit } = fakeGeolocation();
    Object.defineProperty(navigator, 'geolocation', { value: geolocation, configurable: true });

    const { savePatient, listSpots } = await import('../src/db');
    const { createPatient } = await import('../src/patient');
    const patient = {
      ...createPatient('山田 太郎', '東京都千代田区1-1'),
      location: { lat: 35, lng: 139, accuracy: 10, recordedAt: '2026-09-22T00:00:00.000Z', source: 'gps' as const },
    };
    await savePatient(patient);

    await import('../src/main');
    await waitFor(() => expect(rows()).toHaveLength(1));
    dismissInstallNotice();

    // 位置のある訪問先を選んで、地図を開く画面まで進む。
    el<HTMLInputElement>(`input[data-id="${patient.id}"]`)!.click();
    el<HTMLButtonElement>('[data-testid="next-button"]')!.click();
    await waitFor(() => expect(el('[data-testid="open-map-button"]')).not.toBeNull());
    const historyRecorded = await armHistoryRecordWait();
    el<HTMLButtonElement>('[data-testid="open-map-button"]')!.click();
    await historyRecorded();

    // まだ地点が1つも無いので、見出しは「お役立ち地点」で登録ボタンだけ出る。
    await waitFor(() => expect(el('[data-testid="spot-add-button"]')).not.toBeNull());
    expect(el('[data-testid="nearby-spots"]')?.querySelector('h2')?.textContent).toBe('お役立ち地点');
    expect(el('[data-testid="nearby-spots"] ul')).toBeNull();

    el<HTMLButtonElement>('[data-testid="spot-add-button"]')!.click();
    await waitFor(() => expect(el('[data-testid="location-measure-button"]')).not.toBeNull());

    // 種類とメモを、測る前に入力しておく(値が保たれるか確かめる)。前後の空白は保存時に取り除かれる。
    const select = el<HTMLSelectElement>('[data-testid="spot-kind-select"]')!;
    select.value = 'toilet';
    select.dispatchEvent(new Event('change'));
    const note = el<HTMLInputElement>('[data-testid="spot-note-input"]')!;
    note.value = '  きれいなトイレ  ';
    note.dispatchEvent(new Event('input'));

    el<HTMLButtonElement>('[data-testid="location-measure-button"]')!.click();
    await waitFor(() => expect(geolocation.watchPosition).toHaveBeenCalledTimes(1));
    emit(35.0001, 139.0001, 15);
    await waitFor(() => expect(el<HTMLButtonElement>('[data-testid="spot-save-button"]')?.disabled).toBe(false));

    // 入力した種類・メモは、測定中の再描画をまたいで保たれている(メモはまだ前後の空白付き)。
    expect(el<HTMLSelectElement>('[data-testid="spot-kind-select"]')!.value).toBe('toilet');
    expect(el<HTMLInputElement>('[data-testid="spot-note-input"]')!.value).toBe('  きれいなトイレ  ');

    el<HTMLButtonElement>('[data-testid="spot-save-button"]')!.click();
    await waitFor(async () => {
      const saved = await listSpots();
      expect(saved).toHaveLength(1);
      // 保存した内容: 種類・前後の空白を取り除いたメモ・測った精度・source: 'gps'。
      expect(saved[0]).toMatchObject({
        kind: 'toilet',
        note: 'きれいなトイレ',
        location: { lat: 35.0001, lng: 139.0001, accuracy: 15, source: 'gps' },
      });
    });
    await waitFor(() => expect(el('body')?.textContent).toContain('登録しました'));
    // 保存したら測定は止まっている。
    await waitFor(() => expect(geolocation.clearWatch).toHaveBeenCalled());

    el<HTMLButtonElement>('[data-testid="dialog-cancel"]')!.click();
    await waitFor(() => expect(el('[data-testid="dialog"]')).toBeNull());

    // 測った位置は訪問先のすぐそばなので、近くのお役立ち地点として出る。
    await waitFor(() => expect(el('[data-testid="nearby-spots"] ul')).not.toBeNull());
    expect(el('[data-testid="nearby-spots"]')?.querySelector('h2')?.textContent).toBe('近くのお役立ち地点');
    expect(el('[data-testid="nearby-spots"] li a')?.textContent).toContain('トイレ');
    expect(el('[data-testid="nearby-spots"] li a')?.textContent).toContain('きれいなトイレ');

    // 設定にも出る(一覧の画面からしか開けないので、タブで一覧へ戻ってから開く)。
    // 設定を開くと裏でloadSettingsInfoが始まるので、次のテストのbeforeEach(deleteDB)と
    // 競合しないよう、テストを終える前にその読み込みが終わるのを待つ。
    const settingsLoaded = await armSettingsLoadWait();
    el<HTMLButtonElement>('[data-testid="tab-list"]')!.click();
    await waitFor(() => expect(el('[data-testid="settings-button"]')).not.toBeNull());
    el<HTMLButtonElement>('[data-testid="settings-button"]')!.click();
    await waitFor(() => expect(el('body')?.textContent).toContain('きれいなトイレ'));
    expect(el('body')?.textContent).toContain('登録)');
    await settingsLoaded();

    // 削除する(確認してから)。次のテストのbeforeEach(deleteDB)と競合しないよう、
    // 削除→読み直し→renderの一連が完全に終わるまで待ってからテストを終える。
    const spotDeleted = await armSpotDeleteWait();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    el<HTMLButtonElement>('[data-testid="spot-delete"]')!.click();
    expect(window.confirm).toHaveBeenCalledWith('この地点を消しますか?');
    await spotDeleted();
    await waitFor(() => expect(el('body')?.textContent).toContain('まだありません'));
    await waitFor(async () => expect(await listSpots()).toEqual([]));
  });

  /** 訪問先を1人登録し、選んで地図を開く画面まで進み、お役立ち地点の登録ダイアログで測定を始めるところまで。 */
  async function setupSpotMeasuring(): Promise<{
    geolocation: Geolocation & { watchPosition: ReturnType<typeof vi.fn>; clearWatch: ReturnType<typeof vi.fn> };
    emit: (lat: number, lng: number, accuracy: number) => void;
  }> {
    const { geolocation, emit } = fakeGeolocation();
    Object.defineProperty(navigator, 'geolocation', { value: geolocation, configurable: true });

    const { savePatient } = await import('../src/db');
    const { createPatient } = await import('../src/patient');
    const patient = {
      ...createPatient('山田 太郎', '東京都千代田区1-1'),
      location: { lat: 35, lng: 139, accuracy: 10, recordedAt: '2026-09-22T00:00:00.000Z', source: 'gps' as const },
    };
    await savePatient(patient);

    await import('../src/main');
    await waitFor(() => expect(rows()).toHaveLength(1));
    dismissInstallNotice();

    el<HTMLInputElement>(`input[data-id="${patient.id}"]`)!.click();
    el<HTMLButtonElement>('[data-testid="next-button"]')!.click();
    await waitFor(() => expect(el('[data-testid="open-map-button"]')).not.toBeNull());
    const historyRecorded = await armHistoryRecordWait();
    el<HTMLButtonElement>('[data-testid="open-map-button"]')!.click();
    await historyRecorded();

    await waitFor(() => expect(el('[data-testid="spot-add-button"]')).not.toBeNull());
    el<HTMLButtonElement>('[data-testid="spot-add-button"]')!.click();
    await waitFor(() => expect(el('[data-testid="location-measure-button"]')).not.toBeNull());
    el<HTMLButtonElement>('[data-testid="location-measure-button"]')!.click();
    await waitFor(() => expect(geolocation.watchPosition).toHaveBeenCalledTimes(1));

    return {
      geolocation: geolocation as unknown as Geolocation & {
        watchPosition: ReturnType<typeof vi.fn>;
        clearWatch: ReturnType<typeof vi.fn>;
      },
      emit,
    };
  }

  it('測定中にダイアログを閉じると測定を止め(clearWatch)、「今いる場所をお役立ち地点に登録」へフォーカスが戻る', async () => {
    const { geolocation } = await setupSpotMeasuring();

    el<HTMLButtonElement>('[data-testid="dialog-cancel"]')!.click();

    await waitFor(() => expect(geolocation.clearWatch).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(el('[data-testid="dialog"]')).toBeNull());
    expect(document.activeElement).toBe(el('[data-testid="spot-add-button"]'));
  });

  it('「この位置で登録」を連打しても、1件しか登録しない', async () => {
    const { geolocation, emit } = await setupSpotMeasuring();
    emit(35.0001, 139.0001, 15);
    await waitFor(() => expect(el<HTMLButtonElement>('[data-testid="spot-save-button"]')?.disabled).toBe(false));

    const { listSpots } = await import('../src/db');
    const saveButton = el<HTMLButtonElement>('[data-testid="spot-save-button"]')!;
    // 1回目のクリックでDBへの書き込み(await putSpot)が始まった時点で二重実行防止の
    // フラグが立つので、そのまま連打しても2回目は何もしない(1回目の完了を待つ必要は無い)。
    // 次のテストのbeforeEach(deleteDB)と競合しないよう、登録の一連が完全に終わるまで待つ。
    const spotSaved = await armSpotSaveWait();
    saveButton.click();
    saveButton.click();
    await spotSaved();

    expect(await listSpots()).toHaveLength(1);
    expect(geolocation.clearWatch).toHaveBeenCalled();
  });

  it('地点メモの変換中(IME)にGPSの読み取りが来ても、変換中の内容とフォーカスを保つ(再描画を見送る)。変換確定でまとめて1回描画する', async () => {
    const { emit } = await setupSpotMeasuring();

    const note = el<HTMLInputElement>('[data-testid="spot-note-input"]')!;
    note.focus();
    note.dispatchEvent(new Event('compositionstart'));
    note.value = 'にゅうりょく';
    note.dispatchEvent(new Event('input'));

    // 変換中にGPSの読み取り更新(reading→精度15mでdoneまで一気に進む)が来ても、
    // 画面は作り直されない。同じinput要素のまま、変換中の文字とフォーカスを保つ。
    emit(35.0001, 139.0001, 15);
    expect(el('[data-testid="spot-note-input"]')).toBe(note);
    expect(note.value).toBe('にゅうりょく');
    expect(document.activeElement).toBe(note);
    expect(el('body')?.textContent).not.toContain('誤差 ±15m');

    note.dispatchEvent(new Event('compositionend'));

    // 変換の確定で、見送っていた再描画がまとめて1回行われ、確定した文字と
    // 測定結果(見送っていたGPSの更新)の両方が反映される。
    await waitFor(() => expect(el<HTMLButtonElement>('[data-testid="spot-save-button"]')?.disabled).toBe(false));
    expect(el<HTMLInputElement>('[data-testid="spot-note-input"]')!.value).toBe('にゅうりょく');
    expect(el('body')?.textContent).toContain('誤差 ±15m');
  });

  it('位置の貼り付け欄の変換中(IME)にGPSの読み取りが来ても、変換中の内容とフォーカスを保つ。変換確定でまとめて1回描画する', async () => {
    const { savePatient } = await import('../src/db');
    const { createPatient } = await import('../src/patient');
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    await savePatient(patient);

    const geolocation = {
      watchPosition: vi.fn((success: PositionCallback) => {
        (geolocation as unknown as { success: PositionCallback }).success = success;
        return 1;
      }),
      clearWatch: vi.fn(),
      getCurrentPosition: vi.fn(),
    } as unknown as Geolocation & { success: PositionCallback };
    Object.defineProperty(navigator, 'geolocation', { value: geolocation, configurable: true });
    const emit = (lat: number, lng: number, accuracy: number) =>
      geolocation.success({ coords: { latitude: lat, longitude: lng, accuracy } } as GeolocationPosition);

    await import('../src/main');
    await waitFor(() => expect(rows()).toHaveLength(1));
    dismissInstallNotice();

    el<HTMLButtonElement>(`[data-testid="row-menu"][data-id="${patient.id}"]`)!.click();
    el<HTMLButtonElement>('[data-testid="dialog-location"]')!.click();
    await waitFor(() => expect(el('[data-testid="location-measure-button"]')).not.toBeNull());
    el<HTMLButtonElement>('[data-testid="location-measure-button"]')!.click();
    await waitFor(() => expect(geolocation.watchPosition).toHaveBeenCalledTimes(1));

    const input = el<HTMLInputElement>('[data-testid="location-paste-input"]')!;
    input.focus();
    input.dispatchEvent(new Event('compositionstart'));
    input.value = 'にゅうりょく';
    input.dispatchEvent(new Event('input'));

    emit(35.1, 139.1, 15);
    expect(el('[data-testid="location-paste-input"]')).toBe(input);
    expect(input.value).toBe('にゅうりょく');
    expect(document.activeElement).toBe(input);
    expect(el('body')?.textContent).not.toContain('誤差 ±15m');

    input.dispatchEvent(new Event('compositionend'));

    await waitFor(() => expect(el<HTMLButtonElement>('[data-testid="location-save-button"]')?.disabled).toBe(false));
    expect(el<HTMLInputElement>('[data-testid="location-paste-input"]')!.value).toBe('にゅうりょく');
    expect(el('body')?.textContent).toContain('誤差 ±15m');

    delete (navigator as { geolocation?: Geolocation }).geolocation;
  });

  it('変換中にダイアログを閉じると、変換中フラグを引きずらない(閉じる操作はそのまま反映され、次の描画も普通に行われる)', async () => {
    await setupSpotMeasuring();

    const note = el<HTMLInputElement>('[data-testid="spot-note-input"]')!;
    note.focus();
    note.dispatchEvent(new Event('compositionstart'));
    note.value = 'にゅうりょく';
    note.dispatchEvent(new Event('input'));

    el<HTMLButtonElement>('[data-testid="dialog-cancel"]')!.click();

    // 変換中フラグに引きずられて再描画が止まらず、閉じる操作そのものはきちんと反映される。
    expect(el('[data-testid="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(el('[data-testid="spot-add-button"]'));

    // フラグが尾を引いていないので、次に開き直したときも普通に描画される。
    el<HTMLButtonElement>('[data-testid="spot-add-button"]')!.click();
    await waitFor(() => expect(el('[data-testid="location-measure-button"]')).not.toBeNull());
  });
});

describe('バックアップ v2(写真・お役立ち地点・事業所)', () => {
  it('「書き出す」→ 小窓 →「保存する」で、ファイルの中身がDBの内容になり、「最後のバックアップ」が変わる', async () => {
    const db = await import('../src/db');
    const { createPatient } = await import('../src/patient');
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    await db.savePatient(patient);
    // fake-indexeddb(jsdomのBlobをstructuredCloneすると中身が失われる)を避けるため、
    // 写真の一覧そのものをスパイして、本物のBlobを持つ写真を返す(main.ts側の
    // 合計サイズの計算・書き出しのロジックだけを検証する)。
    vi.spyOn(db, 'listAllPhotos').mockResolvedValue([
      {
        id: 'photo-1',
        patientId: patient.id,
        blob: new Blob(['x'], { type: 'image/jpeg' }),
        createdAt: '2026-09-01T00:00:00.000Z',
      },
    ]);

    const fileIo = await import('../src/fileIo');
    const downloadSpy = vi.spyOn(fileIo, 'downloadFile').mockImplementation(() => {});

    await import('../src/main');
    await waitFor(() => expect(rows()).toHaveLength(1));
    dismissInstallNotice();

    el<HTMLButtonElement>('[data-testid="settings-button"]')!.click();
    await waitFor(() => expect(el('[data-testid="include-photos"]')).not.toBeNull());
    expect(el('[data-testid="last-backup"]')?.textContent).toContain('まだありません');

    // 書き出す → 小窓(ready)。この時点ではまだファイルを保存していない。
    el<HTMLButtonElement>('[data-testid="export-button"]')!.click();
    await waitFor(() => expect(el('[data-testid="backup-save-button"]')).not.toBeNull());
    expect(downloadSpy).not.toHaveBeenCalled();

    // 「保存する」で、DBの内容(写真つき)がファイルになり、「最後のバックアップ」が変わる。
    el<HTMLButtonElement>('[data-testid="backup-save-button"]')!.click();
    await waitFor(() => expect(el('[data-testid="backup-done-text"]')).not.toBeNull());
    expect(downloadSpy).toHaveBeenCalledTimes(1);
    const withPhotos = JSON.parse(await (downloadSpy.mock.calls[0]![0] as File).text());
    expect(withPhotos.patients).toHaveLength(1);
    expect(withPhotos.patients[0].id).toBe(patient.id);
    expect(Array.isArray(withPhotos.photos)).toBe(true);
    expect(withPhotos.photos).toHaveLength(1);
    expect(el('[data-testid="last-backup"]')?.textContent).toContain('今日');

    el<HTMLButtonElement>('[data-testid="dialog-cancel"]')!.click();
    await waitFor(() => expect(el('[data-testid="dialog"]')).toBeNull());

    // 「写真も含める」を外して書き出すと、photosがnullになる。
    el<HTMLInputElement>('[data-testid="include-photos"]')!.checked = false;
    el<HTMLButtonElement>('[data-testid="export-button"]')!.click();
    await waitFor(() => expect(el('[data-testid="backup-save-button"]')).not.toBeNull());
    el<HTMLButtonElement>('[data-testid="backup-save-button"]')!.click();
    await waitFor(() => expect(downloadSpy).toHaveBeenCalledTimes(2));
    const withoutPhotos = JSON.parse(await (downloadSpy.mock.calls[1]![0] as File).text());
    expect(withoutPhotos.photos).toBeNull();
  });

  it('一覧のお知らせの「今すぐバックアップ」でも小窓が開く', async () => {
    const { savePatient } = await import('../src/db');
    const { createPatient } = await import('../src/patient');
    for (let i = 1; i <= 5; i += 1) {
      await savePatient(createPatient(`場所${i}`, `東京都${i}`));
    }
    const fileIo = await import('../src/fileIo');
    vi.spyOn(fileIo, 'downloadFile').mockImplementation(() => {});

    await import('../src/main');
    await waitFor(() => expect(rows()).toHaveLength(5));
    dismissInstallNotice();
    await waitFor(() => expect(el('[data-testid="backup-notice"]')).not.toBeNull());

    el<HTMLButtonElement>('[data-testid="notice-backup"]')!.click();
    await waitFor(() => expect(el('[data-testid="backup-save-button"]')).not.toBeNull());

    el<HTMLButtonElement>('[data-testid="dialog-cancel"]')!.click();
    await waitFor(() => expect(el('[data-testid="dialog"]')).toBeNull());
  });

  it('「写真も含める」のチェックを外した状態は、テーマ変更などの再描画をまたいでも保たれる(Minor 7)', async () => {
    const db = await import('../src/db');
    const { createPatient } = await import('../src/patient');
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    await db.savePatient(patient);
    vi.spyOn(db, 'listAllPhotos').mockResolvedValue([
      {
        id: 'photo-1',
        patientId: patient.id,
        blob: new Blob(['x'], { type: 'image/jpeg' }),
        createdAt: '2026-09-01T00:00:00.000Z',
      },
    ]);

    await import('../src/main');
    await waitFor(() => expect(rows()).toHaveLength(1));
    dismissInstallNotice();

    el<HTMLButtonElement>('[data-testid="settings-button"]')!.click();
    await waitFor(() => expect(el('[data-testid="include-photos"]')).not.toBeNull());

    const checkbox = el<HTMLInputElement>('[data-testid="include-photos"]')!;
    expect(checkbox.checked).toBe(true);
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change'));

    // テーマの変更は、settingsInfoを更新してrender()を直接呼ぶ(=設定画面を作り直す)。
    // 「写真も含める」のチェックは、その再描画をまたいでも外れたままでなければならない。
    el<HTMLInputElement>('[data-testid="theme-dark"]')!.click();
    await waitFor(() => expect(el<HTMLInputElement>('[data-testid="theme-dark"]')?.checked).toBe(true));

    expect(el<HTMLInputElement>('[data-testid="include-photos"]')!.checked).toBe(false);
  });

  it('写真なしのファイルを「入れ替える」で読み込んでも、既存の写真は残る', async () => {
    const { savePatient, addPhoto, listPhotos } = await import('../src/db');
    const { createPatient } = await import('../src/patient');
    const { serializeBackup } = await import('../src/backup');
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    await savePatient(patient);
    await addPhoto({
      id: 'photo-1',
      patientId: patient.id,
      blob: new Blob(['x'], { type: 'image/jpeg' }),
      createdAt: '2026-09-01T00:00:00.000Z',
    });

    await import('../src/main');
    await waitFor(() => expect(rows()).toHaveLength(1));
    dismissInstallNotice();

    el<HTMLButtonElement>('[data-testid="settings-button"]')!.click();
    await waitFor(() => expect(el('[data-testid="import-input"]')).not.toBeNull());

    // 同じ訪問先(id)を含み、写真は含めない(=null)バックアップ。
    const text = serializeBackup({ patients: [patient], photos: null, spots: [], meta: {} });
    const file = new File([text], 'backup.json', { type: 'application/json' });
    const input = el<HTMLInputElement>('[data-testid="import-input"]')!;
    Object.defineProperty(input, 'files', { value: [file], configurable: true });

    vi.spyOn(window, 'confirm').mockReturnValue(true);
    el<HTMLButtonElement>('[data-testid="import-button"]')!.click();
    await waitFor(() => expect(el('.message')?.textContent).toContain('取り込みました'));

    expect(await listPhotos(patient.id)).toHaveLength(1);
  });

  it('v2のファイルを読み込むと、お役立ち地点と事業所が入る', async () => {
    const { serializeBackup } = await import('../src/backup');

    await import('../src/main');
    await waitFor(() => expect(el('[data-testid="new-button"]')).not.toBeNull());
    dismissInstallNotice();

    el<HTMLButtonElement>('[data-testid="settings-button"]')!.click();
    await waitFor(() => expect(el('[data-testid="import-input"]')).not.toBeNull());

    const spot = {
      id: 's1',
      kind: 'toilet' as const,
      note: 'きれいなトイレ',
      location: { lat: 35, lng: 139, accuracy: null, recordedAt: '2026-09-01T00:00:00.000Z', source: 'gps' as const },
      createdAt: '2026-09-01T00:00:00.000Z',
    };
    const text = serializeBackup({
      patients: [],
      photos: null,
      spots: [spot],
      meta: { office: { name: '本店', address: '東京都中央区1-2-3' }, routeEnds: { start: 'office', end: 'last' } },
    });
    const file = new File([text], 'backup.json', { type: 'application/json' });
    const input = el<HTMLInputElement>('[data-testid="import-input"]')!;
    Object.defineProperty(input, 'files', { value: [file], configurable: true });

    vi.spyOn(window, 'confirm').mockReturnValue(true);
    el<HTMLButtonElement>('[data-testid="import-button"]')!.click();
    await waitFor(() => expect(el('.message')?.textContent).toContain('取り込みました'));

    expect(el<HTMLInputElement>('[data-testid="office-name-input"]')?.value).toBe('本店');
    expect(el('body')?.textContent).toContain('きれいなトイレ');
  });

  it('写真つきのv2ファイルを「入れ替える」で読み込むと、古い訪問先の写真は消え、新しい写真が入る', async () => {
    const { savePatient, addPhoto, listPhotos } = await import('../src/db');
    const { createPatient } = await import('../src/patient');
    const { serializeBackup } = await import('../src/backup');
    const oldPatient = createPatient('山田 太郎', '東京都千代田区1-1');
    await savePatient(oldPatient);
    await addPhoto({
      id: 'old-photo',
      patientId: oldPatient.id,
      blob: new Blob(['x'], { type: 'image/jpeg' }),
      createdAt: '2026-09-01T00:00:00.000Z',
    });

    await import('../src/main');
    await waitFor(() => expect(rows()).toHaveLength(1));
    dismissInstallNotice();

    el<HTMLButtonElement>('[data-testid="settings-button"]')!.click();
    await waitFor(() => expect(el('[data-testid="import-input"]')).not.toBeNull());

    // 入れ替え先のファイルは別の訪問先(id)だけを含む。入れ替え(replace)なので
    // 古い訪問先自体が居なくなり、その写真は孤立して片付けられるはず。
    const newPatient = createPatient('鈴木 花子', '大阪市北区2-2');
    const text = serializeBackup({
      patients: [newPatient],
      photos: [{ id: 'new-photo', patientId: newPatient.id, dataUrl: 'data:image/jpeg;base64,AAA=', createdAt: 't1' }],
      spots: [],
      meta: {},
    });
    const file = new File([text], 'backup.json', { type: 'application/json' });
    const input = el<HTMLInputElement>('[data-testid="import-input"]')!;
    Object.defineProperty(input, 'files', { value: [file], configurable: true });

    vi.spyOn(window, 'confirm').mockReturnValue(true);
    el<HTMLButtonElement>('[data-testid="import-button"]')!.click();
    await waitFor(() => expect(el('.message')?.textContent).toContain('取り込みました'));

    expect(await listPhotos(oldPatient.id)).toHaveLength(0);
    expect(await listPhotos(newPatient.id)).toHaveLength(1);
  });

  it('同じ訪問先に3枚ある状態で、その訪問先ぶん3枚を含むファイルを「入れ替える」と、上限を超えず新しい3枚だけになる', async () => {
    const { savePatient, addPhoto, listPhotos } = await import('../src/db');
    const { createPatient } = await import('../src/patient');
    const { serializeBackup } = await import('../src/backup');
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    await savePatient(patient);
    for (let i = 0; i < 3; i += 1) {
      await addPhoto({
        id: `old-${i}`,
        patientId: patient.id,
        blob: new Blob(['x'], { type: 'image/jpeg' }),
        createdAt: `2026-09-0${i + 1}T00:00:00.000Z`,
      });
    }

    await import('../src/main');
    await waitFor(() => expect(rows()).toHaveLength(1));
    dismissInstallNotice();

    el<HTMLButtonElement>('[data-testid="settings-button"]')!.click();
    await waitFor(() => expect(el('[data-testid="import-input"]')).not.toBeNull());

    // 同じ訪問先(同じid)ぶんの写真を3枚(既存とは別のid)含む入れ替え用ファイル。
    const text = serializeBackup({
      patients: [patient],
      photos: [
        { id: 'new-0', patientId: patient.id, dataUrl: 'data:image/jpeg;base64,AAA=', createdAt: 't1' },
        { id: 'new-1', patientId: patient.id, dataUrl: 'data:image/jpeg;base64,AAA=', createdAt: 't2' },
        { id: 'new-2', patientId: patient.id, dataUrl: 'data:image/jpeg;base64,AAA=', createdAt: 't3' },
      ],
      spots: [],
      meta: {},
    });
    const file = new File([text], 'backup.json', { type: 'application/json' });
    const input = el<HTMLInputElement>('[data-testid="import-input"]')!;
    Object.defineProperty(input, 'files', { value: [file], configurable: true });

    vi.spyOn(window, 'confirm').mockReturnValue(true);
    el<HTMLButtonElement>('[data-testid="import-button"]')!.click();
    await waitFor(() => expect(el('.message')?.textContent).toContain('取り込みました'));

    const stored = await listPhotos(patient.id);
    expect(stored).toHaveLength(3);
    expect(stored.map((p) => p.id).sort()).toEqual(['new-0', 'new-1', 'new-2']);
  });

  it('追加する形式で読み込むと、手元にいる人の写真はそのままで、新しい人の写真は1人につき上限3枚までしか増えない', async () => {
    const { savePatient, addPhoto, listPhotos } = await import('../src/db');
    const { createPatient } = await import('../src/patient');
    const { serializeBackup } = await import('../src/backup');
    const existing = createPatient('山田 太郎', '東京都千代田区1-1');
    await savePatient(existing);
    await addPhoto({
      id: 'old-0',
      patientId: existing.id,
      blob: new Blob(['x'], { type: 'image/jpeg' }),
      createdAt: '2026-09-01T00:00:00.000Z',
    });
    await addPhoto({
      id: 'old-1',
      patientId: existing.id,
      blob: new Blob(['x'], { type: 'image/jpeg' }),
      createdAt: '2026-09-02T00:00:00.000Z',
    });

    await import('../src/main');
    await waitFor(() => expect(rows()).toHaveLength(1));
    dismissInstallNotice();

    el<HTMLButtonElement>('[data-testid="settings-button"]')!.click();
    await waitFor(() => expect(el('[data-testid="import-input"]')).not.toBeNull());

    // ファイルには、手元にいる人(existing、写真2枚のせて来る=手元は増やさないはず)と、
    // 手元にいない新しい人(写真4枚=1人の上限3枚を超える)を入れる。
    const fresh = createPatient('鈴木 花子', '大阪市北区2-2');
    const text = serializeBackup({
      patients: [existing, fresh],
      photos: [
        { id: 'existing-new-0', patientId: existing.id, dataUrl: 'data:image/jpeg;base64,AAA=', createdAt: 't1' },
        { id: 'fresh-0', patientId: fresh.id, dataUrl: 'data:image/jpeg;base64,AAA=', createdAt: 't1' },
        { id: 'fresh-1', patientId: fresh.id, dataUrl: 'data:image/jpeg;base64,AAA=', createdAt: 't2' },
        { id: 'fresh-2', patientId: fresh.id, dataUrl: 'data:image/jpeg;base64,AAA=', createdAt: 't3' },
        { id: 'fresh-3', patientId: fresh.id, dataUrl: 'data:image/jpeg;base64,AAA=', createdAt: 't4' },
      ],
      spots: [],
      meta: {},
    });
    const file = new File([text], 'backup.json', { type: 'application/json' });
    const input = el<HTMLInputElement>('[data-testid="import-input"]')!;
    Object.defineProperty(input, 'files', { value: [file], configurable: true });

    vi.spyOn(window, 'confirm').mockReturnValue(true);
    el<HTMLButtonElement>('[data-testid="mode-merge"]')!.click();
    el<HTMLButtonElement>('[data-testid="import-button"]')!.click();
    await waitFor(() => expect(el('.message')?.textContent).toContain('追加しました'));

    // 手元にいた人(existing)の写真は変わらない(ファイルの写真は入らない)。
    const existingPhotos = await listPhotos(existing.id);
    expect(existingPhotos.map((p) => p.id)).toEqual(['old-0', 'old-1']);

    // 新しい人(fresh)は、ファイルの順で上限3枚までしか増えない。
    const freshPhotos = await listPhotos(fresh.id);
    expect(freshPhotos).toHaveLength(3);
    expect(freshPhotos.map((p) => p.id)).toEqual(['fresh-0', 'fresh-1', 'fresh-2']);
  });

  it('壊れた写真(base64の中身が壊れている)を含むファイルは、確認より前に中断して何も変わらない', async () => {
    const { savePatient, listPatients } = await import('../src/db');
    const { createPatient } = await import('../src/patient');
    const { serializeBackup } = await import('../src/backup');
    const existing = createPatient('山田 太郎', '東京都千代田区1-1');
    await savePatient(existing);

    await import('../src/main');
    await waitFor(() => expect(rows()).toHaveLength(1));
    dismissInstallNotice();

    el<HTMLButtonElement>('[data-testid="settings-button"]')!.click();
    await waitFor(() => expect(el('[data-testid="import-input"]')).not.toBeNull());

    // dataUrlの形(data:<type>;base64,...)自体はtoBackupPhotoの検査を通るが、
    // base64の中身(@@@)が壊れているため、dataUrlToBlobでの事前デコードが失敗する。
    const fromFile = createPatient('鈴木 花子', '大阪市北区2-2');
    const text = serializeBackup({
      patients: [fromFile],
      photos: [{ id: 'p1', patientId: fromFile.id, dataUrl: 'data:image/jpeg;base64,@@@', createdAt: 't1' }],
      spots: [],
      meta: {},
    });
    const file = new File([text], 'backup.json', { type: 'application/json' });
    const input = el<HTMLInputElement>('[data-testid="import-input"]')!;
    Object.defineProperty(input, 'files', { value: [file], configurable: true });

    // 入れ替え(replace)は既定のモード。確認ダイアログより前に中断するはずなので、
    // confirmが呼ばれないことも合わせて確認する。
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    el<HTMLButtonElement>('[data-testid="import-button"]')!.click();
    await waitFor(() =>
      expect(el('.message')?.textContent).toContain('バックアップのファイルの写真が壊れています。'),
    );

    expect(confirmSpy).not.toHaveBeenCalled();
    expect((await listPatients()).map((p) => p.id)).toEqual([existing.id]);
  });

  it('確認の文の写真枚数は、実際に取り込まれる訪問先ぶんだけを数える(孤立した写真は数えない)', async () => {
    const { serializeBackup } = await import('../src/backup');
    const { createPatient } = await import('../src/patient');

    await import('../src/main');
    await waitFor(() => expect(el('[data-testid="new-button"]')).not.toBeNull());
    dismissInstallNotice();

    el<HTMLButtonElement>('[data-testid="settings-button"]')!.click();
    await waitFor(() => expect(el('[data-testid="import-input"]')).not.toBeNull());

    // ファイルの訪問先は1件だけなのに、写真は2枚(うち1枚は訪問先がファイルに無い=孤立)。
    // 入れ替え(replace)では、実際に残るのはファイルの訪問先ぶんの写真だけなので、
    // 確認の文には「写真1枚」とだけ出るはず。
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    const text = serializeBackup({
      patients: [patient],
      photos: [
        { id: 'p1', patientId: patient.id, dataUrl: 'data:image/jpeg;base64,AAA=', createdAt: 't1' },
        { id: 'p2', patientId: 'not-in-file', dataUrl: 'data:image/jpeg;base64,AAA=', createdAt: 't1' },
      ],
      spots: [],
      meta: {},
    });
    const file = new File([text], 'backup.json', { type: 'application/json' });
    const input = el<HTMLInputElement>('[data-testid="import-input"]')!;
    Object.defineProperty(input, 'files', { value: [file], configurable: true });

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    el<HTMLButtonElement>('[data-testid="import-button"]')!.click();
    await waitFor(() => expect(confirmSpy).toHaveBeenCalled());

    expect(confirmSpy.mock.calls[0]![0]).toContain('写真1枚');
    expect(confirmSpy.mock.calls[0]![0]).not.toContain('写真2枚');
  });

  it('確認後、書き込みが始まってから失敗すると、生のエラーではなく案内文を出し、画面を最新の内容に合わせる(Minor 9)', async () => {
    const db = await import('../src/db');
    const { serializeBackup } = await import('../src/backup');
    const { createPatient } = await import('../src/patient');
    const existing = createPatient('山田 太郎', '東京都千代田区1-1');
    await db.savePatient(existing);

    await import('../src/main');
    await waitFor(() => expect(rows()).toHaveLength(1));
    dismissInstallNotice();

    el<HTMLButtonElement>('[data-testid="settings-button"]')!.click();
    await waitFor(() => expect(el('[data-testid="import-input"]')).not.toBeNull());

    const fromFile = createPatient('鈴木 花子', '大阪市北区2-2');
    const text = serializeBackup({ patients: [fromFile], photos: null, spots: [], meta: {} });
    const file = new File([text], 'backup.json', { type: 'application/json' });
    const input = el<HTMLInputElement>('[data-testid="import-input"]')!;
    Object.defineProperty(input, 'files', { value: [file], configurable: true });

    // 訪問先・写真・地点・metaは1つのトランザクション(applyImport)で書くので、
    // その途中で技術的な(利用者に見せたくない)エラーが起きれば、何も変わらない。
    vi.spyOn(db, 'applyImport').mockRejectedValueOnce(new TypeError('Failed to execute structuredClone'));

    vi.spyOn(window, 'confirm').mockReturnValue(true);
    el<HTMLButtonElement>('[data-testid="import-button"]')!.click();

    await waitFor(() =>
      expect(el('.message')?.textContent).toBe('取り込みの途中で失敗しました。画面を最新の内容に合わせました。'),
    );
    expect(el('.message')?.textContent).not.toContain('structuredClone');

    // applyImportが失敗しているので、訪問先の件数は変わらない(既存のままで、ファイルの内容は入らない)。
    expect((await db.listPatients()).map((p) => p.id)).toEqual([existing.id]);
  });
});

describe('受け取る(引き継ぎのファイルを読み込む)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const SPOT = {
    id: 'spot-from-file',
    kind: 'toilet' as const,
    note: '受け取ったトイレ',
    location: { lat: 35, lng: 139, accuracy: null, recordedAt: '2026-09-01T00:00:00.000Z', source: 'gps' as const },
    createdAt: '2026-09-01T00:00:00.000Z',
  };

  /** テスト用の引き継ぎファイル(回数を少なくして速くする)。 */
  async function makeTransferText(
    password: string,
    content: {
      patients?: Patient[];
      photos?: { id: string; patientId: string; dataUrl: string; createdAt: string }[] | null;
      spots?: (typeof SPOT)[];
    },
  ): Promise<string> {
    const { encryptText } = await import('../src/crypto');
    const { serializePayload } = await import('../src/transfer');
    const plain = serializePayload({
      sentAt: '2026-09-27T00:00:00.000Z',
      patients: content.patients ?? [],
      photos: content.photos ?? null,
      spots: content.spots ?? [],
    });
    return encryptText(plain, password, 1000);
  }

  async function openSettings(): Promise<void> {
    dismissInstallNotice();
    el<HTMLButtonElement>('[data-testid="settings-button"]')!.click();
    await waitFor(() => expect(el('[data-testid="import-input"]')).not.toBeNull());
  }

  /** 読み込むのファイル欄にファイルを入れて「読み込む」を押す(画面を描き直すと欄も作り直されるので、毎回入れ直す)。 */
  function importText(text: string, filename: string, mode: 'replace' | 'merge' = 'replace'): void {
    const file = new File([text], filename, { type: filename.endsWith('.json') ? 'application/json' : 'text/plain' });
    const input = el<HTMLInputElement>('[data-testid="import-input"]')!;
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    el<HTMLInputElement>(`[data-testid="mode-${mode}"]`)!.click();
    el<HTMLButtonElement>('[data-testid="import-button"]')!.click();
  }

  function typeReceivePassword(password: string): void {
    const input = el<HTMLInputElement>('[data-testid="receive-password"]')!;
    input.value = password;
    input.dispatchEvent(new Event('input'));
  }

  const doneText = () => el('[data-testid="receive-done-text"]')?.textContent;

  it('「送る」で作ったファイルを読み込む → パスワード違い → やり直し → 確認 → 別に追加で、新しい id で写真・位置・メモが入る', async () => {
    const db = await import('../src/db');
    const { createPatient } = await import('../src/patient');
    const patient = {
      ...createPatient('山田 太郎', '東京都千代田区1-1'),
      note: '駐車場は裏手にあります',
      location: {
        lat: 35.68,
        lng: 139.76,
        accuracy: 10,
        recordedAt: '2026-09-22T00:00:00.000Z',
        source: 'gps' as const,
      },
    };
    await db.savePatient(patient);
    // fake-indexeddb はBlobの中身を保てないことがあるので、送る側の写真は listPhotos の戻りとして与える。
    const listPhotosSpy = vi.spyOn(db, 'listPhotos').mockResolvedValue([
      { id: 'photo-1', patientId: patient.id, blob: new Blob(['x'], { type: 'image/jpeg' }), createdAt: 't1' },
    ]);
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...window.navigator, share, canShare: () => true });

    await import('../src/main');
    await waitFor(() => expect(rows()).toHaveLength(1));

    // 送る(Task 5)。
    el<HTMLButtonElement>(`[data-testid="row-menu"][data-id="${patient.id}"]`)!.click();
    el<HTMLButtonElement>('[data-testid="dialog-send"]')!.click();
    await waitFor(() => expect(el('[data-testid="transfer-password"]')).not.toBeNull());
    for (const testid of ['transfer-password', 'transfer-password-confirm']) {
      const input = el<HTMLInputElement>(`[data-testid="${testid}"]`)!;
      input.value = 'sakura-2026';
      input.dispatchEvent(new Event('input'));
    }
    const confirmSpy = vi.spyOn(window, 'confirm');
    el<HTMLButtonElement>('[data-testid="transfer-send-button"]')!.click();
    // 既定の回数(PBKDF2_ITERATIONS)での暗号化・復号を、このテストの中で3回(送信の暗号化、
    // パスワード違いでの復号の失敗、正しいパスワードでの復号)行うため、1回あたりの待ち時間を延ばす
    // (待ち時間を固定するのではなく、vi.waitForの上限だけを延ばす)。
    await waitFor(() => expect(el('[data-testid="transfer-share-button"]')).not.toBeNull(), 10_000);
    el<HTMLButtonElement>('[data-testid="transfer-share-button"]')!.click();
    await waitFor(() => expect(el('[data-testid="transfer-done-text"]')).not.toBeNull(), 10_000);
    const sentText = await (share.mock.calls[0]![0].files[0] as File).text();
    el<HTMLButtonElement>('[data-testid="dialog-cancel"]')!.click();
    listPhotosSpy.mockRestore();

    // 受け取る(同じ端末なので、同じ人として聞かれる)。
    await openSettings();
    importText(sentText, '訪問先の引き継ぎ_2026-09-27.txt');
    await waitFor(() => expect(el('[data-testid="receive-password"]')).not.toBeNull());
    expect(document.activeElement).toBe(el('[data-testid="receive-password"]'));

    typeReceivePassword('wrong-password');
    el<HTMLButtonElement>('[data-testid="receive-password-submit"]')!.click();
    await waitFor(
      () =>
        expect(el('[data-testid="dialog"]')?.textContent).toContain(
          'パスワードが違うか、ファイルが壊れています。何度でもやり直せます。',
        ),
      10_000,
    );
    expect(el<HTMLInputElement>('[data-testid="receive-password"]')!.value).toBe('');

    typeReceivePassword('sakura-2026');
    el<HTMLInputElement>('[data-testid="receive-password"]')!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );
    await waitFor(
      () => expect(el('[data-testid="receive-summary"]')?.textContent).toBe('山田 太郎様を名簿に追加しますか?'),
      10_000,
    );
    expect(document.activeElement).toBe(el('[data-testid="receive-confirm"]'));

    el<HTMLButtonElement>('[data-testid="receive-confirm"]')!.click();
    await waitFor(() =>
      expect(el('#dialog-title')?.textContent).toBe('同じ訪問先がすでにあります(1/1)'),
    );
    el<HTMLButtonElement>('[data-testid="conflict-add"]')!.click();
    await waitFor(() => expect(doneText()).toBe('1人を追加しました。'));
    // バックアップ用の確認(window.confirm)は出ない。
    expect(confirmSpy).not.toHaveBeenCalled();

    const saved = await db.listPatients();
    expect(saved).toHaveLength(2);
    const added = saved.find((p) => p.id !== patient.id)!;
    expect(added.name).toBe('山田 太郎');
    expect(added.note).toBe('駐車場は裏手にあります');
    expect(added.location?.lat).toBe(35.68);
    expect(await db.listPhotos(added.id)).toHaveLength(1);

    el<HTMLButtonElement>('[data-testid="dialog-cancel"]')!.click();
    expect(el('[data-testid="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(el('[data-testid="import-button"]'));
  }, 20_000);

  it('事業所の合言葉で開けるファイルなら、パスワードの画面を飛ばして確認へ進む', async () => {
    const db = await import('../src/db');
    await db.setMeta('sharedSecret', 'jimusho-aikotoba');
    const { createPatient } = await import('../src/patient');
    const text = await makeTransferText('jimusho-aikotoba', {
      patients: [createPatient('鈴木 花子', '大阪府大阪市2-2'), createPatient('佐藤 次郎', '京都府京都市3-3')],
      spots: [SPOT],
    });

    await import('../src/main');
    await waitFor(() => expect(el('[data-testid="settings-button"]')).not.toBeNull());
    await openSettings();
    importText(text, 'transfer.txt');

    await waitFor(() =>
      expect(el('[data-testid="receive-summary"]')?.textContent).toBe(
        '鈴木 花子様ほか1人・お役立ち地点1件を名簿に追加しますか?',
      ),
    );
    expect(el('[data-testid="receive-password"]')).toBeNull();

    el<HTMLButtonElement>('[data-testid="receive-confirm"]')!.click();
    await waitFor(() => expect(doneText()).toBe('2人とお役立ち地点1件を追加しました。'));
    expect(await db.listPatients()).toHaveLength(2);
  });

  it('同じ人が2人いれば1人ずつ聞き、「上書き」と「この人は追加しない」に従う', async () => {
    const db = await import('../src/db');
    const { createPatient } = await import('../src/patient');
    const first = { ...createPatient('山田 太郎', '東京都千代田区1-1'), note: '古いメモ' };
    const second = { ...createPatient('鈴木 花子', '大阪府大阪市2-2'), note: '手元のメモ' };
    await db.savePatient(first);
    await db.savePatient(second);
    const text = await makeTransferText('abcdef', {
      patients: [
        { ...createPatient('山田 太郎', '東京都千代田区1-1'), note: '新しいメモ' },
        { ...createPatient('鈴木 花子', '大阪府大阪市2-2'), note: '入らないメモ' },
      ],
    });

    await import('../src/main');
    await waitFor(() => expect(rows()).toHaveLength(2));
    await openSettings();
    importText(text, 'transfer.txt');
    await waitFor(() => expect(el('[data-testid="receive-password"]')).not.toBeNull());
    typeReceivePassword('abcdef');
    el<HTMLButtonElement>('[data-testid="receive-password-submit"]')!.click();
    await waitFor(() => expect(el('[data-testid="receive-confirm"]')).not.toBeNull());
    el<HTMLButtonElement>('[data-testid="receive-confirm"]')!.click();

    await waitFor(() => expect(el('#dialog-title')?.textContent).toBe('同じ訪問先がすでにあります(1/2)'));
    expect(el('[data-testid="conflict-existing"]')?.textContent).toBe('手元: 山田 太郎(東京都千代田区1-1)');
    // 最初のフォーカスは「この人は追加しない」(Enterを続けて押しても、上書きしない)。
    expect(document.activeElement).toBe(el('[data-testid="conflict-skip"]'));
    el<HTMLButtonElement>('[data-testid="conflict-overwrite"]')!.click();

    await waitFor(() => expect(el('#dialog-title')?.textContent).toBe('同じ訪問先がすでにあります(2/2)'));
    expect(document.activeElement).toBe(el('[data-testid="conflict-skip"]'));
    expect(el('[data-testid="conflict-incoming"]')?.textContent).toBe('受け取った: 鈴木 花子(大阪府大阪市2-2)');
    el<HTMLButtonElement>('[data-testid="conflict-skip"]')!.click();

    await waitFor(() => expect(doneText()).toBe('1人を上書きしました。'));
    expect(document.activeElement).toBe(el('[data-testid="dialog-cancel"]'));
    const saved = await db.listPatients();
    expect(saved).toHaveLength(2);
    expect(saved.find((p) => p.id === first.id)?.note).toBe('新しいメモ');
    expect(saved.find((p) => p.id === second.id)?.note).toBe('手元のメモ');
  });

  it('写真を含まないファイルで上書きしても、手元の写真は残る', async () => {
    const db = await import('../src/db');
    const { createPatient } = await import('../src/patient');
    const existing = createPatient('山田 太郎', '東京都千代田区1-1');
    await db.savePatient(existing);
    await db.addPhoto({
      id: 'mine',
      patientId: existing.id,
      blob: new Blob(['x'], { type: 'image/jpeg' }),
      createdAt: '2026-09-01T00:00:00.000Z',
    });
    const text = await makeTransferText('abcdef', {
      patients: [{ ...createPatient('山田 太郎', '東京都千代田区1-1'), note: '新しいメモ' }],
      photos: null,
    });

    await import('../src/main');
    await waitFor(() => expect(rows()).toHaveLength(1));
    await openSettings();
    importText(text, 'transfer.txt');
    await waitFor(() => expect(el('[data-testid="receive-password"]')).not.toBeNull());
    typeReceivePassword('abcdef');
    el<HTMLButtonElement>('[data-testid="receive-password-submit"]')!.click();
    await waitFor(() => expect(el('[data-testid="receive-confirm"]')).not.toBeNull());
    el<HTMLButtonElement>('[data-testid="receive-confirm"]')!.click();
    await waitFor(() => expect(el('[data-testid="conflict-overwrite"]')).not.toBeNull());
    el<HTMLButtonElement>('[data-testid="conflict-overwrite"]')!.click();
    await waitFor(() => expect(doneText()).toBe('1人を上書きしました。'));

    expect((await db.listPhotos(existing.id)).map((photo) => photo.id)).toEqual(['mine']);
    expect((await db.listPatients())[0]!.note).toBe('新しいメモ');
  });

  it('「入れ替える」を選んでいても、引き継ぎのファイルは今のデータを消さずに追加する', async () => {
    const db = await import('../src/db');
    const { createPatient } = await import('../src/patient');
    const existing = createPatient('山田 太郎', '東京都千代田区1-1');
    await db.savePatient(existing);
    const text = await makeTransferText('abcdef', { patients: [createPatient('鈴木 花子', '大阪府大阪市2-2')] });

    await import('../src/main');
    await waitFor(() => expect(rows()).toHaveLength(1));
    await openSettings();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    importText(text, 'transfer.txt', 'replace');
    await waitFor(() => expect(el('[data-testid="receive-password"]')).not.toBeNull());
    typeReceivePassword('abcdef');
    el<HTMLButtonElement>('[data-testid="receive-password-submit"]')!.click();
    await waitFor(() => expect(el('[data-testid="receive-confirm"]')).not.toBeNull());
    el<HTMLButtonElement>('[data-testid="receive-confirm"]')!.click();
    await waitFor(() => expect(doneText()).toBe('1人を追加しました。'));

    expect(confirmSpy).not.toHaveBeenCalled();
    expect((await db.listPatients()).map((p) => p.name).sort()).toEqual(['山田 太郎', '鈴木 花子'].sort());
    el<HTMLButtonElement>('[data-testid="dialog-cancel"]')!.click();
    el<HTMLButtonElement>('[data-testid="back-button"]')!.click();
    expect(rows()).toHaveLength(2);
  });

  it('途中で閉じてから読み込み直すと、最初(パスワードの画面)から始まる', async () => {
    const db = await import('../src/db');
    const text = await makeTransferText('abcdef', { spots: [SPOT] });

    await import('../src/main');
    await waitFor(() => expect(el('[data-testid="settings-button"]')).not.toBeNull());
    await openSettings();
    importText(text, 'transfer.txt');
    await waitFor(() => expect(el('[data-testid="receive-password"]')).not.toBeNull());
    typeReceivePassword('abcdef');
    el<HTMLButtonElement>('[data-testid="receive-password-submit"]')!.click();
    await waitFor(() => expect(el('[data-testid="receive-confirm"]')).not.toBeNull());

    // 確認の画面で「やめる」。
    el<HTMLButtonElement>('[data-testid="dialog-cancel"]')!.click();
    expect(el('[data-testid="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(el('[data-testid="import-button"]'));

    importText(text, 'transfer.txt');
    await waitFor(() => expect(el('[data-testid="receive-password"]')).not.toBeNull());
    expect(el<HTMLInputElement>('[data-testid="receive-password"]')!.value).toBe('');
    expect(el('[data-testid="receive-confirm"]')).toBeNull();
    expect(el('[data-testid="dialog"] .message')).toBeNull();

    // Escキーでも閉じられ、何も取り込まれていない。
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(el('[data-testid="dialog"]')).toBeNull();
    expect(await db.listSpots()).toHaveLength(0);
  });

  it('お役立ち地点だけのファイルも取り込め、設定の一覧に出る', async () => {
    const text = await makeTransferText('abcdef', { spots: [SPOT] });

    await import('../src/main');
    await waitFor(() => expect(el('[data-testid="settings-button"]')).not.toBeNull());
    await openSettings();
    importText(text, 'transfer.txt');
    await waitFor(() => expect(el('[data-testid="receive-password"]')).not.toBeNull());
    typeReceivePassword('abcdef');
    el<HTMLButtonElement>('[data-testid="receive-password-submit"]')!.click();
    await waitFor(() =>
      expect(el('[data-testid="receive-summary"]')?.textContent).toBe('お役立ち地点1件を名簿に追加しますか?'),
    );
    el<HTMLButtonElement>('[data-testid="receive-confirm"]')!.click();
    await waitFor(() => expect(doneText()).toBe('お役立ち地点1件を追加しました。'));
    el<HTMLButtonElement>('[data-testid="dialog-cancel"]')!.click();

    expect(el('body')?.textContent).toContain('受け取ったトイレ');
  });

  it('普通のバックアップ(JSON)は、今までどおり確認して取り込む(受け取りのダイアログは出ない)', async () => {
    const db = await import('../src/db');
    const { createPatient } = await import('../src/patient');
    await db.savePatient(createPatient('山田 太郎', '東京都千代田区1-1'));
    const text = serializeBackup({
      patients: [createPatient('鈴木 花子', '大阪府大阪市2-2')],
      photos: null,
      spots: [],
      meta: {},
    });

    await import('../src/main');
    await waitFor(() => expect(rows()).toHaveLength(1));
    await openSettings();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    importText(text, 'backup.json', 'merge');
    await waitFor(() => expect(el('.message')?.textContent).toContain('1人を追加しました。'));

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(el('[data-testid="dialog"]')).toBeNull();
    expect(await db.listPatients()).toHaveLength(2);
  });

  it('手元で位置・メモ・許可証の期限を変えたあと、同じ人を含むバックアップを「追加する」で読むと、手元の値は残り、新しい人だけ増える', async () => {
    const db = await import('../src/db');
    const { createPatient } = await import('../src/patient');
    const base = createPatient('山田 太郎', '東京都千代田区1-1');
    // ファイル(バックアップ)には、変える前の古い状態を入れる。
    const backedUp = { ...base, note: '古いメモ', parking: { type: 'street_permit' as const, permitExpires: '2026-01-01' } };
    // 手元は、バックアップのあとに値を変えて保存する。
    const changed = {
      ...base,
      note: '新しいメモ',
      parking: { type: 'street_permit' as const, permitExpires: '2027-12-31' },
      location: { lat: 35.1, lng: 139.1, accuracy: 5, recordedAt: '2026-09-25T00:00:00.000Z', source: 'gps' as const },
    };
    await db.savePatient(changed);
    const fresh = createPatient('鈴木 花子', '大阪府大阪市2-2');
    const text = serializeBackup({ patients: [backedUp, fresh], photos: null, spots: [], meta: {} });

    await import('../src/main');
    await waitFor(() => expect(rows()).toHaveLength(1));
    await openSettings();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    importText(text, 'backup.json', 'merge');
    await waitFor(() => expect(el('.message')?.textContent).toContain('追加しました'));

    expect(confirmSpy.mock.calls[0]![0]).toBe('1人を追加します(手元にいる1人はそのまま)。よろしいですか?');

    const stored = await db.listPatients();
    expect(stored).toHaveLength(2);
    const kept = stored.find((p) => p.id === base.id);
    expect(kept?.note).toBe('新しいメモ');
    expect(kept?.parking).toEqual({ type: 'street_permit', permitExpires: '2027-12-31' });
    expect(kept?.location).toEqual(changed.location);
    expect(stored.some((p) => p.id === fresh.id)).toBe(true);
  });

  it('追加する人が1人もいなければ、確認を出さず知らせだけ出す', async () => {
    const db = await import('../src/db');
    const { createPatient } = await import('../src/patient');
    const existing = createPatient('山田 太郎', '東京都千代田区1-1');
    await db.savePatient(existing);
    const text = serializeBackup({ patients: [existing], photos: null, spots: [], meta: {} });

    await import('../src/main');
    await waitFor(() => expect(rows()).toHaveLength(1));
    await openSettings();
    const confirmSpy = vi.spyOn(window, 'confirm');
    importText(text, 'backup.json', 'merge');
    await waitFor(() =>
      expect(el('.message')?.textContent).toBe('追加する訪問先はありませんでした(手元にいる1人はそのまま)。'),
    );

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(await db.listPatients()).toHaveLength(1);
  });

  it('事業所が設定済みのとき、追加する読み込みではファイルの事業所で上書きされない', async () => {
    const db = await import('../src/db');
    const { createPatient } = await import('../src/patient');
    await db.setMeta('office', { name: '既存事業所', address: '東京都千代田区9-9' });
    const fresh = createPatient('鈴木 花子', '大阪府大阪市2-2');
    const text = serializeBackup({
      patients: [fresh],
      photos: null,
      spots: [],
      meta: { office: { name: 'ファイルの事業所', address: '大阪府大阪市1-1' } },
    });

    await import('../src/main');
    await waitFor(() => expect(el('[data-testid="new-button"]')).not.toBeNull());
    await openSettings();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    importText(text, 'backup.json', 'merge');
    await waitFor(() => expect(el('.message')?.textContent).toContain('追加しました'));

    expect(await db.getMeta('office')).toEqual({ name: '既存事業所', address: '東京都千代田区9-9' });
  });
});

describe('端末の戻るボタンと、画面を移ったら一番上から', () => {
  // 自分の history.go が(jsdomでは次のタスクで)popstate を起こし、後のテストへ漏れないよう止めておく。
  beforeEach(() => {
    vi.spyOn(history, 'go').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const back = (nav: number): void => {
    window.dispatchEvent(new PopStateEvent('popstate', { state: { nav } }));
  };

  async function startWithOne(): Promise<Patient> {
    const { savePatient } = await import('../src/db');
    const { createPatient } = await import('../src/patient');
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    await savePatient(patient);
    await import('../src/main');
    await waitFor(() => expect(rows()).toHaveLength(1));
    return patient;
  }

  async function goToOrder(patient: Patient): Promise<void> {
    el<HTMLInputElement>(`[data-testid="patient-checkbox"][data-id="${patient.id}"]`)!.click();
    el<HTMLButtonElement>('[data-testid="next-button"]')!.click();
    await waitFor(() => expect(el('[data-testid="open-map-button"]')).not.toBeNull());
  }

  it('一覧で「⋯」を開いて戻ると、小窓が閉じて一覧のまま', async () => {
    const patient = await startWithOne();
    el<HTMLButtonElement>(`[data-testid="row-menu"][data-id="${patient.id}"]`)!.click();
    expect(el('[data-testid="dialog"]')).not.toBeNull();

    back(0);

    expect(el('[data-testid="dialog"]')).toBeNull();
    expect(el('[data-testid="new-button"]')).not.toBeNull();
  });

  it('訪問順で戻ると一覧へ、地図で戻ると訪問順へ', async () => {
    const patient = await startWithOne();
    await goToOrder(patient);

    back(0);
    expect(el('[data-testid="new-button"]')).not.toBeNull();

    el<HTMLButtonElement>('[data-testid="next-button"]')!.click();
    await waitFor(() => expect(el('[data-testid="open-map-button"]')).not.toBeNull());
    const historyRecorded = await armHistoryRecordWait();
    el<HTMLButtonElement>('[data-testid="open-map-button"]')!.click();
    await historyRecorded();
    expect(el('h1')?.textContent).toBe('地図を開く');

    back(1);
    expect(el('h1')?.textContent).toBe('訪問順を決める');
  });

  it('登録で入力中に戻ると「入力中の内容を捨てますか?」。いいえならとどまり記録を積み直し、はいなら一覧へ', async () => {
    await import('../src/main');
    await waitFor(() => expect(el('[data-testid="new-button"]')).not.toBeNull());
    el<HTMLButtonElement>('[data-testid="new-button"]')!.click();
    el<HTMLInputElement>('[data-testid="name-input"]')!.value = '途中の入力';
    const pushSpy = vi.spyOn(history, 'pushState');
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

    back(0);

    expect(confirmSpy).toHaveBeenCalledWith('入力中の内容を捨てますか?');
    expect(el<HTMLInputElement>('[data-testid="name-input"]')?.value).toBe('途中の入力');
    expect(pushSpy).toHaveBeenCalledTimes(1);
    expect(pushSpy).toHaveBeenCalledWith({ nav: 1 }, '');

    confirmSpy.mockReturnValue(true);
    back(0);

    expect(el('[data-testid="name-input"]')).toBeNull();
    expect(el('[data-testid="new-button"]')).not.toBeNull();
  });

  it('送るのファイルを作っている間(working)は、戻っても小窓を閉じず記録を積み直す', async () => {
    const db = await import('../src/db');
    const patient = await startWithOne();
    let releasePhotos: (photos: Awaited<ReturnType<typeof db.listPhotos>>) => void = () => {};
    vi.spyOn(db, 'listPhotos').mockReturnValue(
      new Promise((resolve) => {
        releasePhotos = resolve;
      }),
    );
    vi.stubGlobal('navigator', { ...window.navigator, share: vi.fn(), canShare: () => true });

    el<HTMLButtonElement>(`[data-testid="row-menu"][data-id="${patient.id}"]`)!.click();
    el<HTMLButtonElement>('[data-testid="dialog-send"]')!.click();
    await waitFor(() => expect(el('[data-testid="transfer-password"]')).not.toBeNull());
    for (const testid of ['transfer-password', 'transfer-password-confirm']) {
      const input = el<HTMLInputElement>(`[data-testid="${testid}"]`)!;
      input.value = 'sakura-2026';
      input.dispatchEvent(new Event('input'));
    }
    el<HTMLButtonElement>('[data-testid="transfer-send-button"]')!.click();
    await waitFor(() => expect(el('[data-testid="transfer-working-text"]')).not.toBeNull());
    const pushSpy = vi.spyOn(history, 'pushState');

    back(0);

    expect(el('[data-testid="transfer-working-text"]')).not.toBeNull();
    expect(pushSpy).toHaveBeenCalledWith({ nav: 1 }, '');

    releasePhotos([]);
    await waitFor(() => expect(el('[data-testid="transfer-share-button"]')).not.toBeNull());
  }, 10_000);

  it('訪問順の「戻る」ボタンでは history.go(-1) を1回だけ呼び、続く { nav: 0 } の popstate では何も起きない', async () => {
    const patient = await startWithOne();
    await goToOrder(patient);
    const goSpy = vi.mocked(history.go);
    goSpy.mockClear();
    const pushSpy = vi.spyOn(history, 'pushState');

    el<HTMLButtonElement>('[data-testid="back-button"]')!.click();
    expect(goSpy).toHaveBeenCalledTimes(1);
    expect(goSpy).toHaveBeenCalledWith(-1);
    expect(el('[data-testid="new-button"]')).not.toBeNull();

    back(0);

    expect(goSpy).toHaveBeenCalledTimes(1);
    expect(pushSpy).not.toHaveBeenCalled();
    expect(el('[data-testid="new-button"]')).not.toBeNull();
  });

  it('一覧から設定へ移ると一番上から出し、一覧で行を選んでも動かさない', async () => {
    const patient = await startWithOne();
    const scrollTo = vi.mocked(window.scrollTo);
    scrollTo.mockClear();

    el<HTMLInputElement>(`[data-testid="patient-checkbox"][data-id="${patient.id}"]`)!.click();
    expect(scrollTo).not.toHaveBeenCalled();

    const settingsLoaded = await armSettingsLoadWait();
    el<HTMLButtonElement>('[data-testid="settings-button"]')!.click();
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
    await settingsLoaded();
  });
});
