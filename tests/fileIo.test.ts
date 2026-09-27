import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadTextFile, shareOrDownloadFile } from '../src/fileIo';

describe('downloadTextFile', () => {
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
    downloadTextFile('backup.json', '{}');
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
      expect(() => downloadTextFile('backup.json', '{}')).toThrow('click failed');
      expect(calls).toBe(1);
      expect(document.body.querySelector('a')).toBeNull();
    } finally {
      HTMLAnchorElement.prototype.click = originalClick;
    }
  });

  it('revokeObjectURLはclickと同じタックでは呼ばれず、タイマー後に呼ばれる', () => {
    vi.useFakeTimers();
    try {
      downloadTextFile('backup.json', '{}');
      expect(revokeObjectURL).not.toHaveBeenCalled();
      vi.runAllTimers();
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('shareOrDownloadFile', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const file = () => new File(['x'], 'a.txt', { type: 'text/plain' });

  it('canShare/shareが使えれば、共有メニューで共有する(sharedを返す)', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const canShare = vi.fn().mockReturnValue(true);
    vi.stubGlobal('navigator', { ...window.navigator, share, canShare });

    await expect(shareOrDownloadFile(file())).resolves.toBe('shared');
  });

  it('共有メニューに渡すFileの中身は、渡したFileそのもの', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const canShare = vi.fn().mockReturnValue(true);
    vi.stubGlobal('navigator', { ...window.navigator, share, canShare });

    const target = file();
    await shareOrDownloadFile(target);
    expect(share).toHaveBeenCalledWith({ files: [target] });
  });

  it('canShareがfalseを返せば、共有を試さずダウンロードする(downloadedを返す)', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const canShare = vi.fn().mockReturnValue(false);
    const createObjectURL = vi.fn(() => 'blob:mock-url');
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = vi.fn();
    vi.stubGlobal('navigator', { ...window.navigator, share, canShare });

    expect(await shareOrDownloadFile(file())).toBe('downloaded');
    expect(share).not.toHaveBeenCalled();
    expect(createObjectURL).toHaveBeenCalledTimes(1);
  });

  it('canShare/shareが無い環境では、ダウンロードする(downloadedを返す)', async () => {
    const createObjectURL = vi.fn(() => 'blob:mock-url');
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = vi.fn();
    vi.stubGlobal('navigator', { ...window.navigator, share: undefined, canShare: undefined });

    expect(await shareOrDownloadFile(file())).toBe('downloaded');
    expect(createObjectURL).toHaveBeenCalledTimes(1);
  });

  it('共有メニューを閉じて取りやめたらcancelled(ダウンロードにフォールバックしない)', async () => {
    const share = vi.fn().mockRejectedValue(new DOMException('キャンセル', 'AbortError'));
    const canShare = vi.fn().mockReturnValue(true);
    const createObjectURL = vi.fn(() => 'blob:mock-url');
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = vi.fn();
    vi.stubGlobal('navigator', { ...window.navigator, share, canShare });

    expect(await shareOrDownloadFile(file())).toBe('cancelled');
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('共有が取りやめ以外の理由で失敗したら、ダウンロードにフォールバックする', async () => {
    const share = vi.fn().mockRejectedValue(new Error('何かの理由'));
    const canShare = vi.fn().mockReturnValue(true);
    const createObjectURL = vi.fn(() => 'blob:mock-url');
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = vi.fn();
    vi.stubGlobal('navigator', { ...window.navigator, share, canShare });

    expect(await shareOrDownloadFile(file())).toBe('downloaded');
    expect(createObjectURL).toHaveBeenCalledTimes(1);
  });
});
