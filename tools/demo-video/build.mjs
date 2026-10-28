// Edits the recorded clips and voice-overs into the finished video:
// ../../dist/RentPro-demo.mp4 (1080p, H.264/AAC, soft English subtitles) and ../../dist/RentPro-demo.srt
import ffmpegPath from "ffmpeg-static";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";

const XFADE = 0.6;        // transition length (s)
const HOLD = 0.7;         // freeze the last frame this long, so each scene can breathe before the next
const VOICE_DELAY = 0.25; // narration starts this long into its scene (title cards wait longer)
const OUT = "../../dist/RentPro-demo.mp4";
const SRT = "../../dist/RentPro-demo.srt";

const script = JSON.parse(fs.readFileSync("script.json", "utf8"));
const scenes = script.scenes;

// Real decoded length of a clip (webm screencasts carry no duration header).
function lengthOf(file) {
  const run = spawnSync(ffmpegPath, ["-hide_banner", "-i", file, "-f", "null", "-"], { encoding: "utf8" });
  const times = [...run.stderr.matchAll(/time=(\d+):(\d+):([\d.]+)/g)];
  const m = times[times.length - 1];
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}
function voiceLength(file) {
  const run = spawnSync(ffmpegPath, ["-hide_banner", "-i", file], { encoding: "utf8" });
  const m = run.stderr.match(/Duration: (\d+):(\d+):([\d.]+)/);
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

// A scene whose actions ran past its narration is sped up slightly, so no scene ends in a long silence.
const TAIL = 0.8;
const segs = scenes.map((s) => {
  const clip = `out/clips/${s.id}.webm`;
  if (!fs.existsSync(clip)) throw new Error("Missing clip " + clip + " (run record.mjs)");
  const raw = lengthOf(clip), voiceLen = voiceLength(`out/voice/${s.id}.mp3`);
  const target = voiceLen + TAIL;
  const speed = raw > target + 0.3 ? raw / target : 1;
  if (speed > 1) console.log(`  ${s.id}: sped up ${speed.toFixed(2)}x to match its narration`);
  return { ...s, clip, voice: `out/voice/${s.id}.mp3`, speed, length: raw / speed + HOLD, voiceLength: voiceLen };
});

// Timeline: each segment starts where the previous one's transition begins.
let t = 0;
segs.forEach((s, i) => {
  s.start = t;
  s.voiceAt = s.start + (s.card ? 0.9 : VOICE_DELAY) + (i === 0 ? 0 : XFADE / 2);
  t += s.length - XFADE;
});
const total = t + XFADE;

// Video: normalise every clip, then chain cross-fades. Cards fade through black; scenes slide.
const lines = [];
segs.forEach((s, i) => lines.push(`[${i}:v]${s.speed > 1 ? `setpts=PTS/${s.speed.toFixed(4)},` : ""}fps=30,scale=1920:1080:flags=lanczos,setsar=1,format=yuv420p,tpad=stop_mode=clone:stop_duration=${HOLD}[v${i}]`));
let last = "v0";
for (let i = 1; i < segs.length; i++) {
  const transition = segs[i].card || segs[i - 1].card ? "fadeblack" : "smoothleft";
  const offset = (segs[i].start).toFixed(3);
  const name = i === segs.length - 1 ? "vx" : `x${i}`;
  lines.push(`[${last}][v${i}]xfade=transition=${transition}:duration=${XFADE}:offset=${offset}[${name}]`);
  last = name;
}
lines.push(`[vx]fade=t=in:st=0:d=0.8,fade=t=out:st=${(total - 1.2).toFixed(3)}:d=1.2[vout]`);

// Audio: every narration placed on one track at its time, then gently levelled.
const a0 = segs.length;
segs.forEach((s, i) => lines.push(`[${a0 + i}:a]aresample=48000,adelay=${Math.round(s.voiceAt * 1000)}:all=1[a${i}]`));
lines.push(`${segs.map((_, i) => `[a${i}]`).join("")}amix=inputs=${segs.length}:normalize=0:dropout_transition=0,apad,atrim=0:${total.toFixed(3)},loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[aout]`);
fs.writeFileSync("out/filter.txt", lines.join(";\n"));

// Subtitles: one cue per sentence, timed in proportion to its length within the narration.
const stamp = (sec) => {
  const ms = Math.round(sec * 1000);
  const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
};
const cues = [];
segs.forEach((s) => {
  const sentences = s.narration.match(/[^.!?]+[.!?]+/g).map((x) => x.trim());
  const chars = sentences.reduce((n, x) => n + x.length, 0);
  let at = s.voiceAt;
  sentences.forEach((sentence) => {
    const len = (sentence.length / chars) * s.voiceLength;
    // Long sentences become two lines of roughly equal length.
    let text = sentence;
    if (sentence.length > 70) {
      const mid = sentence.indexOf(" ", Math.floor(sentence.length / 2) - 6);
      text = sentence.slice(0, mid) + "\n" + sentence.slice(mid + 1);
    }
    cues.push(`${cues.length + 1}\n${stamp(at)} --> ${stamp(at + len - 0.05)}\n${text}\n`);
    at += len;
  });
});
fs.mkdirSync("../../dist", { recursive: true });
fs.writeFileSync(SRT, cues.join("\n"));

const args = ["-hide_banner", "-y"];
segs.forEach((s) => args.push("-i", s.clip));
segs.forEach((s) => args.push("-i", s.voice));
args.push("-i", SRT);
args.push("-filter_complex_script", "out/filter.txt", "-map", "[vout]", "-map", "[aout]", "-map", `${segs.length * 2}:s`,
  "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-profile:v", "high", "-pix_fmt", "yuv420p",
  "-c:a", "aac", "-b:a", "160k", "-c:s", "mov_text", "-metadata:s:s:0", "language=eng",
  "-metadata", "title=RentPro – feature demo", "-movflags", "+faststart", OUT);
console.log(`Building ${segs.length} segments, ${total.toFixed(1)}s ...`);
execFileSync(ffmpegPath, args, { stdio: ["ignore", "ignore", "inherit"] });
console.log("Done:", OUT, (fs.statSync(OUT).size / 1048576).toFixed(1) + " MB");
