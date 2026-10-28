// Generates the voice-over for every scene in script.json: out/voice/<id>.mp3, plus out/voice/durations.json.
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import ffmpegPath from "ffmpeg-static";
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const script = JSON.parse(fs.readFileSync("script.json", "utf8"));
fs.mkdirSync("out/voice", { recursive: true });

const escapeXml = (text) => text.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]));

// ffmpeg prints "Duration: 00:00:12.34" for the input.
export function durationOf(file) {
  let text = "";
  try { execFileSync(ffmpegPath, ["-hide_banner", "-i", file], { stdio: "pipe" }); } catch (error) { text = String(error.stderr); }
  const m = text.match(/Duration: (\d+):(\d+):([\d.]+)/);
  if (!m) throw new Error("No duration for " + file);
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

const durations = {};
for (const scene of script.scenes) {
  const file = `out/voice/${scene.id}.mp3`;
  if (!fs.existsSync(file) || process.argv.includes("--force")) {
    const tts = new MsEdgeTTS();
    await tts.setMetadata(script.voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
    const { audioStream } = tts.toStream(escapeXml(scene.narration), { rate: script.rate });
    await new Promise((resolve, reject) => {
      const out = fs.createWriteStream(file);
      audioStream.pipe(out);
      audioStream.on("error", reject);
      out.on("finish", resolve);
    });
    tts.close();
  }
  durations[scene.id] = durationOf(file);
  console.log(scene.id.padEnd(14), durations[scene.id].toFixed(1) + "s");
}
fs.writeFileSync("out/voice/durations.json", JSON.stringify(durations, null, 2));
console.log("total", Object.values(durations).reduce((a, b) => a + b, 0).toFixed(1) + "s");
