// Draws the RentPro app icon (indigo tile with a white building) as PNG files.
// No dependencies: shapes are rasterised with 4x4 supersampling and encoded with zlib.
// Usage: node tools/make-icons.cjs [androidResDir]
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const ROOT = path.join(__dirname, "..");

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgba, height = size) {
  const raw = Buffer.alloc((size * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))
  ]);
}

const inRoundRect = (x, y, l, t, r, b, rad) => {
  if (x < l || x > r || y < t || y > b) return false;
  const cx = Math.min(Math.max(x, l + rad), r - rad), cy = Math.min(Math.max(y, t + rad), b - rad);
  return (x - cx) ** 2 + (y - cy) ** 2 <= rad * rad;
};

// Returns [r,g,b,a] for a point in unit coordinates (0..1).
// tile: draw the indigo background; corner: background corner radius; scale: building size (adaptive icons need more padding).
function sample(u, v, { tile, corner, scale }) {
  const W = [255, 255, 255, 255];
  const bx = (p) => 0.5 + (p - 0.5) * scale; // scale the building around the centre
  // Building body, windows and door, in 0..1 design space.
  const body = inRoundRect(u, v, bx(0.30), bx(0.24), bx(0.70), bx(0.78), 0.035 * scale);
  if (body) {
    const winW = 0.075, winH = 0.07, cols = [0.375, 0.545], rows = [0.33, 0.45, 0.57];
    for (const cx of cols) for (const cy of rows) {
      if (inRoundRect(u, v, bx(cx), bx(cy), bx(cx + winW), bx(cy + winH), 0.012 * scale)) return [79, 70, 229, 255];
    }
    if (inRoundRect(u, v, bx(0.455), bx(0.67), bx(0.545), bx(0.78), 0.012 * scale)) return [79, 70, 229, 255];
    return W;
  }
  // Ground line
  if (inRoundRect(u, v, bx(0.22), bx(0.775), bx(0.78), bx(0.81), 0.015 * scale)) return W;
  if (!tile) return [0, 0, 0, 0];
  if (corner > 0 && !inRoundRect(u, v, 0, 0, 1, 1, corner)) return [0, 0, 0, 0];
  // Diagonal gradient #6366f1 -> #4338ca with a violet glow top-right.
  const t = (u + v) / 2;
  let r = 99 + (67 - 99) * t, g = 102 + (56 - 102) * t, b = 241 + (202 - 241) * t;
  const glow = Math.max(0, 1 - Math.hypot(u - 1, v) / 0.9) * 0.45;
  r += (124 - r) * glow; g += (58 - g) * glow; b += (237 - b) * glow;
  return [r, g, b, 255];
}

function render(size, opts, height = size) {
  const out = Buffer.alloc(size * height * 4);
  const ss = opts.supersample || 4;
  for (let y = 0; y < height; y++) for (let x = 0; x < size; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
      const px = x + (sx + 0.5) / ss, py = y + (sy + 0.5) / ss;
      const p = opts.splash ? sampleSplash(px, py, size, height) : sample(px / size, py / size, opts);
      r += p[0] * p[3]; g += p[1] * p[3]; b += p[2] * p[3]; a += p[3];
    }
    const i = (y * size + x) * 4;
    out[i + 3] = Math.round(a / (ss * ss));
    if (a > 0) { out[i] = Math.round(r / a); out[i + 1] = Math.round(g / a); out[i + 2] = Math.round(b / a); }
  }
  return encodePng(size, out, height);
}

// Splash: dark navy screen with the app tile centred (tile is 28% of the shorter side).
function sampleSplash(px, py, width, height) {
  const tile = Math.min(width, height) * 0.28;
  const u = (px - (width - tile) / 2) / tile, v = (py - (height - tile) / 2) / tile;
  if (u >= 0 && u <= 1 && v >= 0 && v <= 1) {
    const p = sample(u, v, { tile: true, corner: 0.22, scale: 1 });
    if (p[3] > 0) return p;
  }
  return [12, 16, 34, 255];
}

const pngSize = (file) => { const b = fs.readFileSync(file); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };

function write(file, size, opts) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, render(size, opts));
  console.log("wrote", path.relative(ROOT, file), size + "px");
}

// Web app / PWA icons
write(path.join(ROOT, "icons", "icon-192.png"), 192, { tile: true, corner: 0.22, scale: 1 });
write(path.join(ROOT, "icons", "icon-512.png"), 512, { tile: true, corner: 0.22, scale: 1 });
write(path.join(ROOT, "icons", "icon-maskable-512.png"), 512, { tile: true, corner: 0, scale: 0.78 });

// Android launcher icons (Capacitor project), when the res directory is given.
const res = process.argv[2];
if (res) {
  const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
  for (const [name, mult] of Object.entries(densities)) {
    const dir = path.join(res, "mipmap-" + name);
    write(path.join(dir, "ic_launcher.png"), Math.round(48 * mult), { tile: true, corner: 0.22, scale: 1 });
    write(path.join(dir, "ic_launcher_round.png"), Math.round(48 * mult), { tile: true, corner: 0.5, scale: 0.9 });
    // Adaptive icon foreground: 108dp canvas, artwork kept inside the central 66dp safe zone.
    write(path.join(dir, "ic_launcher_foreground.png"), Math.round(108 * mult), { tile: false, corner: 0, scale: 0.62 });
  }
  // Replace Capacitor's default splash images, keeping each file's dimensions.
  for (const dir of fs.readdirSync(res).filter((d) => d.startsWith("drawable"))) {
    const file = path.join(res, dir, "splash.png");
    if (!fs.existsSync(file)) continue;
    const [w, h] = pngSize(file);
    fs.writeFileSync(file, render(w, { splash: true, supersample: 2 }, h));
    console.log("wrote", path.relative(ROOT, file), `${w}x${h}`);
  }
  // Adaptive icon background colour behind the white building.
  const bg = path.join(res, "values", "ic_launcher_background.xml");
  if (fs.existsSync(bg)) fs.writeFileSync(bg, fs.readFileSync(bg, "utf8").replace(/#[0-9A-Fa-f]{6}/, "#4F46E5"));
}
