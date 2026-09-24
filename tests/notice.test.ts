import { describe, expect, it, vi } from 'vitest';
import { renderNotice } from '../src/views/notice';

describe('renderNotice', () => {
  it('文と、ボタンを出す。ボタンを押すと onClick が呼ばれる', () => {
    const onClick = vi.fn();
    const element = renderNotice({
      testid: 'backup-notice',
      text: '最後のバックアップから35日たちました。',
      actions: [{ label: '今すぐバックアップ', testid: 'notice-backup', onClick, primary: true }],
    });
    expect(element.dataset.testid).toBe('backup-notice');
    expect(element.getAttribute('role')).toBe('status');
    expect(element.textContent).toContain('35日');
    const button = element.querySelector<HTMLButtonElement>('[data-testid="notice-backup"]')!;
    expect(button.className).toContain('primary');
    button.click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
