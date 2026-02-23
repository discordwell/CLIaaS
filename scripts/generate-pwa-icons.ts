/**
 * Generate PWA icons for CLIaaS.
 * Creates simple but distinctive icons at 192px and 512px.
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ICONS_DIR = join(__dirname, '..', 'public', 'icons');

if (!existsSync(ICONS_DIR)) {
  mkdirSync(ICONS_DIR, { recursive: true });
}

function generateSvg(size: number, maskable: boolean): string {
  const padding = maskable ? Math.floor(size * 0.1) : 0;
  const innerSize = size - padding * 2;
  const cx = size / 2;
  const cy = size / 2;
  const fontSize = Math.floor(innerSize * 0.35);
  const subtitleSize = Math.floor(innerSize * 0.1);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="#09090b" rx="${maskable ? 0 : Math.floor(size * 0.15)}"/>
  <text x="${cx}" y="${cy - fontSize * 0.1}" text-anchor="middle" dominant-baseline="central" font-family="monospace" font-weight="bold" font-size="${fontSize}" fill="white">CLI</text>
  <text x="${cx}" y="${cy + fontSize * 0.7}" text-anchor="middle" dominant-baseline="central" font-family="monospace" font-weight="bold" font-size="${subtitleSize}" fill="#a1a1aa">aaS</text>
  <rect x="${padding + Math.floor(innerSize * 0.15)}" y="${cy + fontSize}" width="${Math.floor(innerSize * 0.7)}" height="2" fill="#a1a1aa"/>
</svg>`;
}

// Write SVG files and also raw PNG placeholders (SVG is supported by most PWA implementations)
const sizes = [192, 512];
for (const size of sizes) {
  // Regular icon
  const svg = generateSvg(size, false);
  writeFileSync(join(ICONS_DIR, `icon-${size}.svg`), svg);
  console.log(`Generated icon-${size}.svg`);

  // Maskable icon (with safe zone padding)
  const maskSvg = generateSvg(size, true);
  writeFileSync(join(ICONS_DIR, `icon-${size}-maskable.svg`), maskSvg);
  console.log(`Generated icon-${size}-maskable.svg`);
}

console.log('Done! Icons saved to public/icons/');
