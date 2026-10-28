// Copies the site files the Android app needs into www/ (Capacitor's webDir).
// Tests, the Apps Script source, docs and old server code stay out of the app.
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "www");

const FILES = [
  "index.html", "dashboard.html", "tenants.html", "tenant-profile.html", "payments.html", "reconcile.html",
  "pay.html", "assistant.html", "utilities.html", "expenses.html", "reports.html", "archives.html", "moveout.html", "404.html",
  "global.js", "manifest.webmanifest",
  "js/dev-auth.js", "js/require-auth.js", "js/shell.js", "js/splash.js", "js/ai-panel.js", "js/report-math.js"
];
const DIRS = ["styles", "icons"];

fs.rmSync(OUT, { recursive: true, force: true });
for (const file of FILES) {
  const target = path.join(OUT, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(ROOT, file), target);
}
for (const dir of DIRS) fs.cpSync(path.join(ROOT, dir), path.join(OUT, dir), { recursive: true });

// Every local script and stylesheet a page references must be in the bundle.
const missing = [];
for (const file of FILES.filter((f) => f.endsWith(".html"))) {
  const html = fs.readFileSync(path.join(OUT, file), "utf8");
  for (const [, ref] of html.matchAll(/(?:src|href)="([^"#:?]+\.(?:js|css|png|webmanifest))"/g)) {
    if (!fs.existsSync(path.join(OUT, ref))) missing.push(`${file} -> ${ref}`);
  }
}
if (missing.length) {
  console.error("Missing from www/:\n  " + missing.join("\n  "));
  process.exit(1);
}
console.log(`www/ ready: ${FILES.length} files + ${DIRS.join(", ")}`);
