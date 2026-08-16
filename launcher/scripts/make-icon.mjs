/**
 * Generates the application icon.
 *
 * Written rather than drawn so the icon lives in version control as its definition, and so
 * there is no image dependency in the toolchain: Node can already deflate, which is the
 * only hard part of writing a PNG.
 *
 * Output is `build/icon.ico` holding every size Windows asks for. electron-builder rejects
 * an .ico below 256x256, and Windows picks a different entry for the taskbar, the title
 * bar and the file listing — each size is rendered fresh rather than downscaled, because
 * a 16px downscale of a 256px drawing turns to mush.
 */

import { deflateSync } from 'node:zlib';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const buildDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'build');

/** Matches the launcher's own palette, so the icon and the window agree. */
const BACKGROUND = [0x1e, 0x1e, 0x26];
const TOP_FACE = [0x9d, 0x90, 0xff];
const LEFT_FACE = [0x7c, 0x6c, 0xf5];
const RIGHT_FACE = [0x4f, 0x43, 0xb4];

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

/** Even-odd point-in-polygon. Points are [x, y] pairs in pixel space. */
function inside(polygon, x, y) {
  let result = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      result = !result;
    }
  }
  return result;
}

/** Signed-distance test for a rounded square, used for the plate behind the cube. */
function insideRoundedRect(x, y, size, inset, radius) {
  const dx = Math.abs(x - size / 2) - (size / 2 - inset - radius);
  const dy = Math.abs(y - size / 2) - (size / 2 - inset - radius);
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  return outside - radius + Math.min(Math.max(dx, dy), 0) <= 0;
}

/**
 * Renders the icon at one size into straight RGBA bytes.
 *
 * Coverage is sampled on a 4x4 grid per pixel. Real antialiasing matters more here than
 * anywhere else in the project: the 16px entry is three-quarters edge.
 */
function render(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const samples = 4;

  // An isometric cube, drawn as three rhombi sharing a centre vertex.
  const cx = size / 2;
  const cy = size / 2;
  const halfWidth = size * 0.29;
  const faceRise = halfWidth / 2; // 2:1 isometric
  const bodyHeight = size * 0.3;

  const topY = cy - bodyHeight / 2;
  const bottomY = cy + bodyHeight / 2;

  const top = [
    [cx, topY - faceRise],
    [cx + halfWidth, topY],
    [cx, topY + faceRise],
    [cx - halfWidth, topY],
  ];
  const left = [
    [cx - halfWidth, topY],
    [cx, topY + faceRise],
    [cx, bottomY + faceRise],
    [cx - halfWidth, bottomY],
  ];
  const right = [
    [cx + halfWidth, topY],
    [cx, topY + faceRise],
    [cx, bottomY + faceRise],
    [cx + halfWidth, bottomY],
  ];

  const inset = size * 0.05;
  const radius = size * 0.21;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let plate = 0;
      let topHits = 0;
      let leftHits = 0;
      let rightHits = 0;

      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const px = x + (sx + 0.5) / samples;
          const py = y + (sy + 0.5) / samples;

          if (insideRoundedRect(px, py, size, inset, radius)) plate++;
          // Faces are tested in draw order; the shared edges overlap by less than a
          // sample, so no seam appears between them.
          if (inside(top, px, py)) topHits++;
          else if (inside(left, px, py)) leftHits++;
          else if (inside(right, px, py)) rightHits++;
        }
      }

      const total = samples * samples;
      const offset = (y * size + x) * 4;

      // Composite over transparency: plate first, then whichever face covers the pixel.
      let r = BACKGROUND[0];
      let g = BACKGROUND[1];
      let b = BACKGROUND[2];
      let alpha = plate / total;

      const faceCoverage = (topHits + leftHits + rightHits) / total;
      if (faceCoverage > 0) {
        const [fr, fg, fb] =
          topHits >= leftHits && topHits >= rightHits
            ? TOP_FACE
            : leftHits >= rightHits
              ? LEFT_FACE
              : RIGHT_FACE;
        r = Math.round(r * (1 - faceCoverage) + fr * faceCoverage);
        g = Math.round(g * (1 - faceCoverage) + fg * faceCoverage);
        b = Math.round(b * (1 - faceCoverage) + fb * faceCoverage);
        alpha = Math.max(alpha, faceCoverage);
      }

      pixels[offset] = r;
      pixels[offset + 1] = g;
      pixels[offset + 2] = b;
      pixels[offset + 3] = Math.round(alpha * 255);
    }
  }

  return pixels;
}

// ---------------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** Encodes straight RGBA bytes as an 8-bit truecolour-with-alpha PNG. */
function encodePng(pixels, size) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  header[10] = 0; // deflate
  header[11] = 0; // adaptive filtering
  header[12] = 0; // no interlace

  // One filter byte per scanline. Filter 0 (none) keeps this readable; the images are
  // small and deflate already handles the flat background well.
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// ICO
// ---------------------------------------------------------------------------

/**
 * Packs PNGs into an .ico.
 *
 * PNG-compressed entries are legal at every size on Windows Vista and later, which is well
 * below anything that can run Electron 33, so there is no need for the BMP encoding the
 * format was originally built around.
 */
function encodeIco(images) {
  const directory = Buffer.alloc(6 + images.length * 16);
  directory.writeUInt16LE(0, 0); // reserved
  directory.writeUInt16LE(1, 2); // type: icon
  directory.writeUInt16LE(images.length, 4);

  let offset = directory.length;
  for (const [index, image] of images.entries()) {
    const entry = 6 + index * 16;
    directory[entry] = image.size >= 256 ? 0 : image.size; // 0 means 256
    directory[entry + 1] = image.size >= 256 ? 0 : image.size;
    directory[entry + 2] = 0; // palette size
    directory[entry + 3] = 0; // reserved
    directory.writeUInt16LE(1, entry + 4); // colour planes
    directory.writeUInt16LE(32, entry + 6); // bits per pixel
    directory.writeUInt32LE(image.png.length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += image.png.length;
  }

  return Buffer.concat([directory, ...images.map((image) => image.png)]);
}

// ---------------------------------------------------------------------------

const SIZES = [16, 24, 32, 48, 64, 128, 256];

await mkdir(buildDir, { recursive: true });

const images = SIZES.map((size) => ({ size, png: encodePng(render(size), size) }));
const ico = encodeIco(images);

await writeFile(path.join(buildDir, 'icon.ico'), ico);
// Kept alongside for Linux packaging and for anywhere a PNG is easier to consume.
await writeFile(path.join(buildDir, 'icon.png'), images.at(-1).png);

console.log(`build/icon.ico  ${SIZES.join(', ')}px  (${Math.round(ico.length / 1024)} KB)`);
console.log(`build/icon.png  256px`);
