/**
 * Готовит иконки Android из public/icons/icon.svg.
 * Запуск: node scripts/make-icons.mjs
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import sharp from 'sharp';

const RES = join('android', 'app', 'src', 'main', 'res');
const svg = await readFile(join('public', 'icons', 'icon.svg'));

// плотности экранов Android
const DENSITIES = {
  'mipmap-mdpi': 48,
  'mipmap-hdpi': 72,
  'mipmap-xhdpi': 96,
  'mipmap-xxhdpi': 144,
  'mipmap-xxxhdpi': 192,
};

// foreground для адаптивных иконок: 108dp, логотип занимает ~60% площади
const FOREGROUND = {
  'mipmap-mdpi': 108,
  'mipmap-hdpi': 162,
  'mipmap-xhdpi': 216,
  'mipmap-xxhdpi': 324,
  'mipmap-xxxhdpi': 432,
};

async function write(path, buffer) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, buffer);
}

for (const [dir, size] of Object.entries(DENSITIES)) {
  const png = await sharp(svg, { density: 600 }).resize(size, size).png().toBuffer();
  await write(join(RES, dir, 'ic_launcher.png'), png);
  await write(join(RES, dir, 'ic_launcher_round.png'), png);
}

for (const [dir, size] of Object.entries(FOREGROUND)) {
  const inner = Math.round(size * 0.62);
  const logo = await sharp(svg, { density: 600 }).resize(inner, inner).png().toBuffer();
  const png = await sharp({
    create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: logo, gravity: 'center' }])
    .png()
    .toBuffer();
  await write(join(RES, dir, 'ic_launcher_foreground.png'), png);
}

console.log('иконки Android обновлены');
