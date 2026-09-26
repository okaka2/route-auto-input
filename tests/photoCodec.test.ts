import { describe, expect, it } from 'vitest';
import { blobToDataUrl, dataUrlToBlob } from '../src/photoCodec';

describe('blobToDataUrl / dataUrlToBlob', () => {
  it('Blob → data URL → Blob で、中身とtypeが同じに戻る', async () => {
    const original = new Blob(['写真のデータのふり'], { type: 'image/jpeg' });
    const dataUrl = await blobToDataUrl(original);
    expect(dataUrl.startsWith('data:image/jpeg;base64,')).toBe(true);
    const restored = dataUrlToBlob(dataUrl);
    expect(restored.type).toBe('image/jpeg');
    expect(await restored.text()).toBe(await original.text());
  });

  it('壊れたdata URLはErrorを投げる', () => {
    expect(() => dataUrlToBlob('not a data url')).toThrow('写真のデータが壊れています。');
    expect(() => dataUrlToBlob('data:image/jpeg,notbase64')).toThrow('写真のデータが壊れています。');
    expect(() => dataUrlToBlob('data:image/jpeg;base64,!!!not-base64!!!')).toThrow('写真のデータが壊れています。');
  });
});
