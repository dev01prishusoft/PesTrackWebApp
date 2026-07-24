import fs from 'fs';
import path from 'path';
import { Resvg } from '@resvg/resvg-js';

const svgPath = path.resolve('public/favicon.svg');
const originalSvg = fs.readFileSync(svgPath, 'utf8');

// Extract SVG inner paths
const innerElements = originalSvg
  .replace(/<\?xml[\s\S]*?\?>/g, '')
  .replace(/<svg[\s\S]*?>/, '')
  .replace(/<\/svg>/, '');

function createCompositeSvg({ targetSize, paddingRatio = 0.08, backgroundColor = '#ffffff' }) {
  const outerWidth = targetSize;
  const outerHeight = targetSize;
  const contentArea = targetSize * (1 - 2 * paddingRatio);
  
  // Original SVG viewBox is 0 0 1254 1254
  const scale = contentArea / 1254;
  const translateX = (outerWidth - 1254 * scale) / 2;
  const translateY = (outerHeight - 1254 * scale) / 2;

  const bgRect = `<rect width="${outerWidth}" height="${outerHeight}" fill="${backgroundColor}"/>`;

  return `<svg version="1.1" xmlns="http://www.w3.org/2000/svg" width="${outerWidth}" height="${outerHeight}" viewBox="0 0 ${outerWidth} ${outerHeight}">
  ${bgRect}
  <g transform="translate(${translateX.toFixed(3)}, ${translateY.toFixed(3)}) scale(${scale.toFixed(5)})">
    ${innerElements}
  </g>
</svg>`;
}

function createIco(pngBuffers) {
  const count = pngBuffers.length;
  const headerSize = 6;
  const dirEntrySize = 16;
  let offset = headerSize + count * dirEntrySize;

  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);

  const entries = [];
  const imageBuffers = [];

  for (const img of pngBuffers) {
    const entry = Buffer.alloc(dirEntrySize);
    entry.writeUInt8(img.width >= 256 ? 0 : img.width, 0);
    entry.writeUInt8(img.height >= 256 ? 0 : img.height, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(img.data.length, 8);
    entry.writeUInt32LE(offset, 12);

    entries.push(entry);
    imageBuffers.push(img.data);
    offset += img.data.length;
  }

  return Buffer.concat([header, ...entries, ...imageBuffers]);
}

const iconsToGenerate = [
  { name: 'pwa-192x192.png', size: 192, padding: 0.08, bg: '#ffffff' },
  { name: 'pwa-512x512.png', size: 512, padding: 0.08, bg: '#ffffff' },
  { name: 'pwa-64x64.png', size: 64, padding: 0.08, bg: '#ffffff' },
  { name: 'pwa-maskable-192x192.png', size: 192, padding: 0.15, bg: '#ffffff' },
  { name: 'pwa-maskable-512x512.png', size: 512, padding: 0.15, bg: '#ffffff' },
  { name: 'apple-touch-icon.png', size: 180, padding: 0.10, bg: '#ffffff' },
  { name: 'favicon-32x32.png', size: 32, padding: 0.04, bg: '#ffffff' },
  { name: 'favicon-16x16.png', size: 16, padding: 0.04, bg: '#ffffff' },
];

const generatedPngs = {};

for (const icon of iconsToGenerate) {
  const compositeSvg = createCompositeSvg({
    targetSize: icon.size,
    paddingRatio: icon.padding,
    backgroundColor: icon.bg
  });
  
  const resvg = new Resvg(compositeSvg, {
    fitTo: { mode: 'width', value: icon.size }
  });
  
  const pngBuffer = resvg.render().asPng();
  const destPath = path.join('public', icon.name);
  fs.writeFileSync(destPath, pngBuffer);
  generatedPngs[icon.name] = { width: icon.size, height: icon.size, data: pngBuffer };
  console.log(`Generated ${icon.name} (${icon.size}x${icon.size}) with solid background ${icon.bg}`);
}

// Generate favicon.ico
const icoBuffer = createIco([
  generatedPngs['favicon-16x16.png'],
  generatedPngs['favicon-32x32.png']
]);
fs.writeFileSync('public/favicon.ico', icoBuffer);
console.log('Generated public/favicon.ico with solid background');
