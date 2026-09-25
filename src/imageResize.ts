/** 縮小後の長辺の最大サイズ(px)。 */
export const MAX_EDGE_PX = 1280;
/** JPEGへ書き出すときの画質(0〜1)。 */
export const JPEG_QUALITY = 0.8;

/** 長辺が maxEdge を超えるときだけ縮める(アスペクト比は保つ)。 */
export function fitWithin(
  width: number,
  height: number,
  maxEdge: number = MAX_EDGE_PX,
): { width: number; height: number } {
  const longEdge = Math.max(width, height);
  if (longEdge <= maxEdge) {
    return { width, height };
  }
  const scale = maxEdge / longEdge;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

export type ResizeDeps = {
  decode(file: Blob): Promise<{ width: number; height: number; source: CanvasImageSource; close?(): void }>;
  createCanvas(
    width: number,
    height: number,
  ): {
    getContext(type: '2d'): CanvasRenderingContext2D | null;
    toBlob(cb: (b: Blob | null) => void, type: string, quality: number): void;
  };
};

/** 既定の deps。テストでは差し替えるので、ここではブラウザのAPIを直接は呼ばない(呼ぶのは resizeImage の中だけ)。 */
const defaultDeps: ResizeDeps = {
  decode: async (file) => {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    return { width: bitmap.width, height: bitmap.height, source: bitmap, close: () => bitmap.close() };
  },
  createCanvas: (width, height) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  },
};

/** 縮小して JPEG の Blob にする(Canvas に描き直すので撮影場所などの情報は残らない)。 */
export async function resizeImage(file: Blob, deps: ResizeDeps = defaultDeps): Promise<Blob> {
  let decoded: Awaited<ReturnType<ResizeDeps['decode']>>;
  try {
    decoded = await deps.decode(file);
  } catch {
    throw new Error('写真を読み込めませんでした。');
  }
  try {
    const { width, height } = fitWithin(decoded.width, decoded.height);
    const canvas = deps.createCanvas(width, height);
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('写真を読み込めませんでした。');
    }
    context.drawImage(decoded.source, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY);
    });
    if (!blob) {
      throw new Error('写真を読み込めませんでした。');
    }
    return blob;
  } finally {
    decoded.close?.();
  }
}
