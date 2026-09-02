import { mkdir } from 'node:fs/promises';
import sharp from 'sharp';

const SOURCE = 'assets/icon.svg';
const OUTPUTS = [
  { path: 'public/pwa-192.png', size: 192 },
  { path: 'public/pwa-512.png', size: 512 },
  // iOSのホーム画面用。透過なしの正方形が必要。
  // icon.svgの角丸(rx=96)の外側は透過になるため、背景色で塗りつぶして不透明にする。
  { path: 'public/apple-touch-icon.png', size: 180, flatten: true },
];

await mkdir('public', { recursive: true });

for (const { path, size, flatten } of OUTPUTS) {
  let pipeline = sharp(SOURCE).resize(size, size);
  if (flatten) {
    pipeline = pipeline.flatten({ background: '#0b57d0' });
  }
  await pipeline.png().toFile(path);
  console.log(`generated ${path}`);
}
