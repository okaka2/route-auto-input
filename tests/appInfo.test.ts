import { describe, expect, it } from 'vitest';
import { APP_DESCRIPTION, APP_NAME } from '../src/appInfo';

const FORBIDDEN_WORDS = ['患者', '薬局', '在宅', '医療', '利用者'];

describe('appInfo', () => {
  it('アプリ名は「訪問ルート作成」', () => {
    expect(APP_NAME).toBe('訪問ルート作成');
  });

  it('アプリ名と説明に、業種特有の表現を含めない', () => {
    for (const word of FORBIDDEN_WORDS) {
      expect(APP_NAME).not.toContain(word);
      expect(APP_DESCRIPTION).not.toContain(word);
    }
  });
});
