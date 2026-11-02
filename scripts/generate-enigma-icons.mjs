import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

// Render repository-owned SVG sources; no raster editing or remote assets.
// avatar.svg is the master mark; avatar-small.svg / avatar-micro.svg carry the same
// silhouette with optically thickened strokes so the thin ring survives at 16–48px.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sharp = (await import(process.env.ENIGMA_SHARP_PATH || 'sharp')).default;
const assets = path.join(root, 'desktop/src/assets/enigma');
const read = (name) => fs.readFileSync(path.join(assets, name), 'utf8');
const marks = { full: read('avatar.svg'), small: read('avatar-small.svg'), micro: read('avatar-micro.svg') };
const markFor = (px) => (px <= 20 ? marks.micro : px <= 64 ? marks.small : marks.full);
const render = (svg, size) => sharp(Buffer.from(svg), { density: 72 * Math.max(1, size / 512) * 2 }).resize(size, size).png();

await render(marks.full, 512).toFile(path.join(assets, 'avatar.png'));

// Keep the Dock silhouette optically aligned with neighboring macOS icons.
const appSvgFrom = (mark) => `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><svg x="80" y="80" width="864" height="864" viewBox="0 0 512 512">${mark.replace(/<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')}</svg></svg>`;
const appSvg = appSvgFrom(marks.full);
fs.writeFileSync(path.join(assets, 'app-icon.svg'), `${appSvg}\n`);
await render(appSvg, 1024).toFile(path.join(root, 'desktop/src/icon.png'));

// Full-bleed square for iOS home screen / PWA install; platforms apply their own mask.
const touch = read('touch-icon.svg');
await render(touch, 180).toFile(path.join(assets, 'touch-icon-180.png'));
await render(touch, 512).toFile(path.join(assets, 'touch-icon-512.png'));
await render(marks.small, 32).toFile(path.join(assets, 'favicon-32.png'));

// macOS menu bar template icons (black + alpha); @2x has its own heavier-hinted source.
await render(read('tray-template.svg'), 18).toFile(path.join(assets, 'tray-template.png'));
await render(read('tray-template@2x.svg'), 36).toFile(path.join(assets, 'tray-template@2x.png'));

if (process.platform === 'darwin') {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'enigma-icon-'));
  const iconset = path.join(temp, 'Enigma.iconset'); fs.mkdirSync(iconset);
  for (const size of [16, 32, 128, 256, 512]) for (const scale of [1, 2]) {
    const px = size * scale;
    await render(appSvgFrom(markFor(px)), px).toFile(path.join(iconset, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`));
  }
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', path.join(root, 'desktop/src/icon.icns')]);
  fs.rmSync(temp, { recursive: true });
}
// Windows: per-size layers rendered from the matching optical weight instead of downsampling 1024px.
const { createIco } = createRequire(import.meta.url)('./generate-windows-icon.cjs');
const icoLayers = async (sizes) => Promise.all(sizes.map(async (size) => ({ size, data: await render(markFor(size), size).toBuffer() })));
fs.writeFileSync(path.join(root, 'desktop/src/icon.ico'), createIco(await icoLayers([256, 128, 64, 48, 32, 24, 16])));
fs.writeFileSync(path.join(assets, 'tray.ico'), createIco(await icoLayers([48, 32, 24, 16])));
console.log('Generated Enigma app, avatar, touch, favicon, tray template and Windows icons.');
