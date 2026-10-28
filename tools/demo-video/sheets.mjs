// Review sheets: three frames (25%, 55%, 85%) from each of two scenes per image -> out/sheets/NN.jpg
import ffmpegPath from "ffmpeg-static";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";

const ids = JSON.parse(fs.readFileSync("script.json", "utf8")).scenes.map((s) => s.id).filter((id) => !process.argv[2] || process.argv.slice(2).includes(id));
fs.mkdirSync("out/sheets/tmp", { recursive: true });
const lengthOf = (file) => {
  const m = [...spawnSync(ffmpegPath, ["-hide_banner", "-i", file, "-f", "null", "-"], { encoding: "utf8" }).stderr.matchAll(/time=(\d+):(\d+):([\d.]+)/g)].pop();
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
};
const frames = [];
for (const id of ids) {
  const file = `out/clips/${id}.webm`, len = lengthOf(file);
  for (const f of [0.25, 0.55, 0.85]) {
    const out = `out/sheets/tmp/${id}-${f}.jpg`;
    execFileSync(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-y", "-ss", (len * f).toFixed(2), "-i", file, "-frames:v", "1",
      "-vf", `scale=640:360,drawtext=text='${id} ${Math.round(f * 100)}%':x=8:y=8:fontsize=22:fontcolor=yellow:box=1:boxcolor=black@0.6:fontfile='C\\:/Windows/Fonts/arial.ttf'`, out]);
    frames.push(out);
  }
}
for (let i = 0; i < frames.length; i += 6) {
  const group = frames.slice(i, i + 6);
  while (group.length < 6) group.push(group[group.length - 1]);
  const out = `out/sheets/${String(i / 6 + 1).padStart(2, "0")}.jpg`;
  execFileSync(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-y", ...group.flatMap((g) => ["-i", g]),
    "-filter_complex", "xstack=inputs=6:layout=0_0|w0_0|w0+w1_0|0_h0|w0_h0|w0+w1_h0", "-q:v", "4", out]);
  console.log(out);
}
