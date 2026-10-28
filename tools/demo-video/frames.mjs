// Saves still frames for review: node frames.mjs <clip.webm|mp4> <seconds> [seconds ...] -> out/frames/<name>-<s>.jpg
import ffmpegPath from "ffmpeg-static";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const [file, ...times] = process.argv.slice(2);
fs.mkdirSync("out/frames", { recursive: true });
let info = "";
try { execFileSync(ffmpegPath, ["-hide_banner", "-i", file], { stdio: "pipe" }); } catch (error) { info = String(error.stderr); }
console.log((info.match(/Duration: [^,]+/) || [""])[0], (info.match(/Video: [^\n]+/) || [""])[0].slice(0, 90));
for (const t of times) {
  const out = `out/frames/${path.basename(file).replace(/\.\w+$/, "")}-${t}.jpg`;
  execFileSync(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-y", "-ss", t, "-i", file, "-frames:v", "1", "-vf", "scale=960:-2", "-q:v", "4", out]);
  console.log(out);
}
