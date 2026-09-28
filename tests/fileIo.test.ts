import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { canShareFile, downloadFile, downloadLocationHint, shareFile } from '../src/fileIo';

const file = () => new File(['x'], 'a.txt', { type: 'text/plain' });

describe('canShareFile', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('navigator.canShareが無ければfalse', () => {
    vi.stubGlobal('navigator', { ...window.navigator, canShare: undefined });
    expect(canShareFile(file())).toBe(false);
  });

  it('navigator.canShareが偽を返せばfalse', () => {
    vi.stubGlobal('navigator', { ...window.navigator, canShare: vi.fn().mockReturnValue(false) });
    expect(canShareFile(file())).toBe(false);
  });

  it('navigator.canShareが真を返せばtrue', () => {
    vi.stubGlobal('navigator', { ...window.navigator, canShare: vi.fn().mockReturnValue(true) });
    expect(canShareFile(file())).toBe(true);
  });
});

describe('shareFile', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('呼び出しの直後、awaitより前に(同期で)navigator.shareを呼ぶ', () => {
    const share = vi.fn(() => new Promise<void>(() => {}));
    vi.stubGlobal('navigator', { ...window.navigator, share });

    void shareFile(file());

    expect(share).toHaveBeenCalledTimes(1);
  });

  it('渡すFileの中身は、渡したFileそのもの', () => {
    const share = vi.fn(() => new Promise<void>(() => {}));
    vi.stubGlobal('navigator', { ...window.navigator, share });

    const target = file();
    void shareFile(target);

    expect(share).toHaveBeenCalledWith({ files: [target] });
  });

  it('共有が終われば sharedを返す', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...window.navigator, share });

    await expect(shareFile(file())).resolves.toBe('shared');
  });

  it('共有メニューを閉じて取りやめたらcancelled', async () => {
    const share = vi.fn().mockRejectedValue(new DOMException('キャンセル', 'AbortError'));
    vi.stubGlobal('navigator', { ...window.navigator, share });

    await expect(shareFile(file())).resolves.toBe('cancelled');
  });

  it('取りやめ以外の理由で失敗したらfailed', async () => {
    const share = vi.fn().mockRejectedValue(new Error('何かの理由'));
    vi.stubGlobal('navigator', { ...window.navigator, share });

    await expect(shareFile(file())).resolves.toBe('failed');
  });

  it('前の共有がまだ開いている間に呼ばれた(InvalidStateError)ならcancelled(failedにすると、呼び出し側が共有シートを開いたままダウンロードしてしまう)', async () => {
    const share = vi.fn().mockRejectedValue(new DOMException('まだ共有中', 'InvalidStateError'));
    vi.stubGlobal('navigator', { ...window.navigator, share });

    await expect(shareFile(file())).resolves.toBe('cancelled');
  });
});

describe('downloadFile', () => {
  let createObjectURL: ReturnType<typeof vi.fn<(obj: Blob | MediaSource) => string>>;
  let revokeObjectURL: ReturnType<typeof vi.fn<(url: string) => void>>;

  beforeEach(() => {
    createObjectURL = vi.fn(() => 'blob:mock-url');
    revokeObjectURL = vi.fn();
    // jsdom does not implement URL.createObjectURL/revokeObjectURL.
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('呼び出し後、<a>要素がDOMに残らない', () => {
    downloadFile(file());
    expect(document.body.querySelector('a')).toBeNull();
  });

  it('click()が例外を投げてもanchorは削除される', () => {
    const originalClick = HTMLAnchorElement.prototype.click;
    let calls = 0;
    HTMLAnchorElement.prototype.click = function click() {
      calls += 1;
      throw new Error('click failed');
    };

    try {
      expect(() => downloadFile(file())).toThrow('click failed');
      expect(calls).toBe(1);
      expect(document.body.querySelector('a')).toBeNull();
    } finally {
      HTMLAnchorElement.prototype.click = originalClick;
    }
  });

  it('revokeObjectURLはclickと同じタックでは呼ばれず、タイマー後に呼ばれる', () => {
    vi.useFakeTimers();
    try {
      downloadFile(file());
      expect(revokeObjectURL).not.toHaveBeenCalled();
      vi.runAllTimers();
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('downloadLocationHint', () => {
  it('ios', () => {
    expect(downloadLocationHint('ios')).toBe('ファイルは「ファイル」アプリの「ダウンロード」に入ります。');
  });

  it('android', () => {
    expect(downloadLocationHint('android')).toBe('ファイルは「ダウンロード」に入ります。');
  });

  it('pc', () => {
    expect(downloadLocationHint('pc')).toBe('ファイルはダウンロードのフォルダに入ります。');
  });
});
