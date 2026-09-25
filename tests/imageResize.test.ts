import { describe, expect, it, vi } from 'vitest';
import { fitWithin, JPEG_QUALITY, MAX_EDGE_PX, resizeImage, type ResizeDeps } from '../src/imageResize';

describe('fitWithin', () => {
  it('長辺が上限を超えるとき、比率を保って縮める', () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 1280, height: 960 });
  });

  it('縦長でも、長辺(この場合は高さ)を基準に縮める', () => {
    expect(fitWithin(3000, 4000)).toEqual({ width: 960, height: 1280 });
  });

  it('上限以下ならそのまま', () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it('上限を指定できる', () => {
    expect(fitWithin(2000, 1000, 500)).toEqual({ width: 500, height: 250 });
  });
});

describe('resizeImage', () => {
  const fakeBlob = (): Blob => new Blob(['x'], { type: 'image/jpeg' });

  function fakeDeps(overrides: {
    width?: number;
    height?: number;
    close?: () => void;
    getContext?: () => CanvasRenderingContext2D | null;
    toBlobResult?: Blob | null;
  } = {}): { deps: ResizeDeps; drawImage: ReturnType<typeof vi.fn>; toBlob: ReturnType<typeof vi.fn> } {
    const close = overrides.close ?? vi.fn();
    const drawImage = vi.fn();
    const toBlob = vi.fn((cb: (b: Blob | null) => void, _type: string, _quality: number) => {
      cb(overrides.toBlobResult === undefined ? fakeBlob() : overrides.toBlobResult);
    });
    const context = { drawImage } as unknown as CanvasRenderingContext2D;
    const getContext = overrides.getContext ?? (() => context);
    const deps: ResizeDeps = {
      decode: async () => ({
        width: overrides.width ?? 4000,
        height: overrides.height ?? 3000,
        source: {} as CanvasImageSource,
        close,
      }),
      createCanvas: vi.fn((width: number, height: number) => ({
        getContext: () => getContext(),
        toBlob,
      })) as unknown as ResizeDeps['createCanvas'],
    };
    return { deps, drawImage, toBlob };
  }

  it('fitWithin どおりの大きさで canvas を作る', async () => {
    const { deps } = fakeDeps({ width: 4000, height: 3000 });
    await resizeImage(fakeBlob(), deps);
    expect(deps.createCanvas).toHaveBeenCalledWith(1280, 960);
  });

  it('toBlob に image/jpeg と JPEG_QUALITY(0.8)が渡る', async () => {
    const { deps, toBlob } = fakeDeps();
    await resizeImage(fakeBlob(), deps);
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', JPEG_QUALITY);
    expect(JPEG_QUALITY).toBe(0.8);
    expect(MAX_EDGE_PX).toBe(1280);
  });

  it('成功しても失敗しても close() が呼ばれる', async () => {
    const close = vi.fn();
    const { deps } = fakeDeps({ close });
    await resizeImage(fakeBlob(), deps);
    expect(close).toHaveBeenCalledTimes(1);

    const close2 = vi.fn();
    const { deps: deps2 } = fakeDeps({ close: close2, getContext: () => null });
    await expect(resizeImage(fakeBlob(), deps2)).rejects.toThrow('写真を読み込めませんでした。');
    expect(close2).toHaveBeenCalledTimes(1);
  });

  it('getContext が null なら「写真を読み込めませんでした。」', async () => {
    const { deps } = fakeDeps({ getContext: () => null });
    await expect(resizeImage(fakeBlob(), deps)).rejects.toThrow('写真を読み込めませんでした。');
  });

  it('toBlob が null を返しても「写真を読み込めませんでした。」', async () => {
    const { deps } = fakeDeps({ toBlobResult: null });
    await expect(resizeImage(fakeBlob(), deps)).rejects.toThrow('写真を読み込めませんでした。');
  });

  it('decodeが失敗しても「写真を読み込めませんでした。」', async () => {
    const deps: ResizeDeps = {
      decode: async () => {
        throw new Error('boom');
      },
      createCanvas: vi.fn() as unknown as ResizeDeps['createCanvas'],
    };
    await expect(resizeImage(fakeBlob(), deps)).rejects.toThrow('写真を読み込めませんでした。');
  });
});
