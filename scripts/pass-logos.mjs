import fs from "node:fs";
import zlib from "node:zlib";

function chunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, crc]);
}

function png(width, height, pixel) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixel(x, y, width, height);
      const i = row + 1 + x * 4;
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
      raw[i + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const teal = [42, 166, 160, 255];
const white = [255, 255, 255, 255];

function logoPixel(x, y, w, h) {
  const gx = w * 0.06;
  const gy = h * 0.18;
  const gw = h * 1.15;
  const gh = h * 0.64;
  const radius = gh * 0.22;
  if (x < gx || y < gy || x > gx + gw || y > gy + gh) return teal;
  const dx = x < gx + radius ? gx + radius - x : x > gx + gw - radius ? x - (gx + gw - radius) : 0;
  const dy = y < gy + radius ? gy + radius - y : y > gy + gh - radius ? y - (gy + gh - radius) : 0;
  return dx * dx + dy * dy <= radius * radius ? white : teal;
}

const dir = new URL("../model/fidelite.pass/", import.meta.url);
fs.writeFileSync(new URL("logo.png", dir), png(160, 50, logoPixel));
fs.writeFileSync(new URL("logo@2x.png", dir), png(320, 100, logoPixel));
fs.writeFileSync(new URL("logo@3x.png", dir), png(480, 150, logoPixel));
