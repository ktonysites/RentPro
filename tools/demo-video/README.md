# RentPro demo video

Makes `dist/RentPro-demo.mp4` (1080p, about 6 minutes, Kenyan English voice-over, subtitles) and
`dist/RentPro-demo.srt` from a demo copy of the app filled with sample data. No real tenant data is used.

```bash
cd tools/demo-video
npm install                      # puppeteer-core, ffmpeg-static, msedge-tts (one time)
node voice.mjs                   # voice-over per scene (add --force after editing script.json)
node demo-server.cjs &           # demo copy of RentPro on http://localhost:5502
node record.mjs                  # records every scene in Chrome (or: node record.mjs tenants reports)
node build.mjs                   # edits clips + voice into the finished video
```

- **Narration and scene names:** `script.json` (voice `en-KE-AsiliaNeural`; `en-KE-ChilembaNeural` is the male voice).
- **What happens on screen:** the `SCENES` table in `record.mjs`; times are fractions of each scene's narration.
- **Sample data:** `demo-server.cjs`. Restart it before a full recording, since scenes change the data.
- **Review:** `node sheets.mjs` makes contact sheets in `out/sheets`; `node frames.mjs <video> <seconds>` saves stills.
- The voice comes from Microsoft Edge's online read-aloud service, so `voice.mjs` needs internet; only the script text is sent.
