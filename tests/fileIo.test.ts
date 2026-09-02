import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadTextFile } from '../src/fileIo';

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
