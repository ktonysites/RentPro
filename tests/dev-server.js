// Local preview: serves the site and answers API calls with Code.gs running on an
// in-memory sheet, so every page can be tried without the live Google Sheet.
// Usage: node tests/dev-server.js [port]   then sign in with the local dev account.
const http = require("http");
const fs = require("fs");
const path = require("path");
const { createBackend } = require("./gas-harness");

const ROOT = path.join(__dirname, "..");
const PORT = Number(process.argv[2] || process.env.PORT || 5501);
const API_PATH = "/api/exec";
const SMS_TOKEN = "dev-token";

const backend = createBackend({ properties: { SMS_WEBHOOK_TOKEN: SMS_TOKEN } });
[
  { name: "Thadayo Brian Masika", phone: "0712345678", natID: "30111222", house: "7", rent: 8700, nextOfKin: "Ann Masika", kinRelation: "Sister", nextOfKinPhone: "0700111222" },
  { name: "Mary Wambui", phone: "0722000111", natID: "28999000", house: "12", rent: 6500 },
  { name: "Peter O'Brien", phone: "0733444555", natID: "31555666", house: "3", rent: 7000 }
].forEach((tenant) => backend.get(Object.assign({ action: "addTenant" }, tenant)));
backend.get({ action: "addExpense", date: "2026-10-05", category: "Maintenance", desc: "Fix gate lock", amount: 1200, house: "7" });

const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".json": "application/json" };

function handleApi(req, res, url) {
  const parameter = Object.fromEntries(url.searchParams);
  let body = "";
  req.on("data", (chunk) => { body += chunk; });
  req.on("end", () => {
    const output = req.method === "POST"
      ? backend.context.doPost({ parameter, postData: { contents: body } })
      : backend.context.doGet({ parameter });
    const isJsonp = output.mime === "javascript";
    res.writeHead(200, { "Content-Type": isJsonp ? "text/javascript" : "application/json", "Access-Control-Allow-Origin": "*" });
    res.end(output.getContent());
  });
}

http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname === API_PATH) return handleApi(req, res, url);

  const file = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname)));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { "Content-Type": "text/html" });
    return res.end(fs.readFileSync(path.join(ROOT, "404.html")));
  }
  let content = fs.readFileSync(file);
  if (path.basename(file) === "global.js") {
    // Point the site at this local API instead of the deployed Apps Script.
    content = content.toString().replace(/window\.API_URL = "[^"]*";/, `window.API_URL = "http://localhost:${PORT}${API_PATH}";`);
  }
  res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
  res.end(content);
}).listen(PORT, () => {
  console.log(`RentPro local preview: http://localhost:${PORT}  (sign in as dev@rentpro.local)`);
  console.log(`Simulate a payment SMS: POST http://localhost:${PORT}${API_PATH}?action=incoming_sms&token=${SMS_TOKEN}  body {"message": "..."}`);
});
