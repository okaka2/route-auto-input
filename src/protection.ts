/**
 * ブラウザに「このサイトのデータは消さないで」と頼む(Storage API)。
 * 対応していない、または断られたときも例外は投げない。iPhoneの「7日間開かないと消える」決まりは
 * これでは防げないので、ホーム画面への追加の案内(installHint.ts)が本命。
 */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    const storage = window.navigator.storage;
    if (!storage || typeof storage.persist !== 'function') {
      return false;
    }
    return await storage.persist();
  } catch {
    return false;
  }
}

/** 保護されているか。確かめる手段が無ければ null。 */
export async function isStoragePersisted(): Promise<boolean | null> {
  try {
    const storage = window.navigator.storage;
    if (!storage || typeof storage.persisted !== 'function') {
      return null;
    }
    return await storage.persisted();
  } catch {
    return null;
  }
}
