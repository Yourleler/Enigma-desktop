import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

// Render repository-owned SVG sources; no raster editing or remote assets.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sharp = (await import(process.env.ENIGMA_SHARP_PATH || 'sharp')).default;
const assets = path.join(root, 'desktop/src/assets/enigma');
const mark = fs.readFileSync(path.join(assets, 'avatar.svg'), 'utf8');
// Keep the Dock silhouette optically aligned with neighboring macOS icons.
const appSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><svg x="80" y="80" width="864" height="864" viewBox="0 0 512 512">${mark.replace(/<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')}</svg></svg>`;
fs.writeFileSync(path.join(assets, 'app-icon.svg'), appSvg);
await sharp(Buffer.from(appSvg)).png().toFile(path.join(root, 'desktop/src/icon.png'));
const tray = fs.readFileSync(path.join(assets, 'tray-template.svg'));
await sharp(tray).resize(18, 18).png().toFile(path.join(assets, 'tray-template.png'));
await sharp(tray).resize(36, 36).png().toFile(path.join(assets, 'tray-template@2x.png'));
if (process.platform === 'darwin') {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'enigma-icon-'));
  const iconset = path.join(temp, 'Enigma.iconset'); fs.mkdirSync(iconset);
  for (const size of [16, 32, 128, 256, 512]) for (const scale of [1, 2]) {
    await sharp(Buffer.from(appSvg)).resize(size * scale, size * scale).png().toFile(path.join(iconset, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`));
  }
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', path.join(root, 'desktop/src/icon.icns')]);
  fs.rmSync(temp, { recursive: true });
}
execFileSync(process.execPath, [path.join(root, 'scripts/generate-windows-icon.cjs')], { stdio: 'inherit' });
console.log('Generated app icon with 80px inset and 18pt/36px template icons.');
