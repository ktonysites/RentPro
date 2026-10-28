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

// The AI uses the free built-in assistant, as it does live without a Claude key.
// Set RENTPRO_FAKE_CLAUDE=1 to try the Claude path with canned replies instead (no key or spend needed).
const backend = createBackend({
  properties: Object.assign({ SMS_WEBHOOK_TOKEN: SMS_TOKEN }, process.env.RENTPRO_FAKE_CLAUDE ? { ANTHROPIC_API_KEY: "local-test" } : {}),
  urlFetch: (url, params) => {
    const body = JSON.parse(params.payload);
    const question = body.messages[body.messages.length - 1].content;
    const data = JSON.parse(body.system.split("Property data (JSON):\n")[1] || "{}");
    const reply = (text) => ({ code: 200, body: { stop_reason: "end_turn", content: [{ type: "text", text }] } });
    // Structured modes: simple rule-based guesses so the screens can be tried locally.
    const schema = body.output_config && body.output_config.format && body.output_config.format.schema;
    if (schema && schema.properties.suggestions) {
      const suggestions = (data.unmatched || []).map((p) => {
        const byName = data.tenants.find((t) => String(p.payer || "").toLowerCase().split(/\s+/).some((w) => w.length > 2 && t.name.toLowerCase().includes(w)));
        const byAmount = data.tenants.find((t) => Number(t.balance) === Number(p.amount) || Number(t.rent) === Number(p.amount));
        const pick = byName || byAmount;
        return { paymentId: p.paymentId, tenantId: pick ? pick.id : "", confidence: byName ? "high" : pick ? "medium" : "low",
          reason: byName ? `Payer name matches ${pick.name} (local test)` : pick ? `Amount matches ${pick.name}'s rent or balance (local test)` : "No clear match (local test)" };
      });
      return reply(JSON.stringify({ suggestions }));
    }
    if (schema && schema.properties.category) {
      const text = question.toLowerCase();
      const category = /pipe|leak|repair|fix|paint|door|lock/.test(text) ? "Maintenance" : /water|kplc|power|electric|garbage/.test(text) ? "Utilities"
        : /clean/.test(text) ? "Cleaning" : /tax|rate|kra/.test(text) ? "Tax" : /salary|wage|caretaker|guard/.test(text) ? "Salary" : "Other";
      const house = (text.match(/house\s*(\w+)/) || [])[1] || "General";
      return reply(JSON.stringify({ category, house, reason: `Guessed from keywords (local test)` }));
    }
    const pageLine = (body.system.match(/The landlord is (?:on|in|looking at|processing) ([^.]+)\./) || [])[1];
    const isReminder = /SMS rent reminder/.test(body.system);
    const isInsights = /dashboard briefing/.test(body.system);
    const text = isReminder
      ? (/Kiswahili/.test(body.system)
          ? "Habari, hii ni kumbukumbu ya kodi. Salio lako ni KES 3,500. Tafadhali lipa kupitia Equity paybill 247247, akaunti 275515 12. Asante! (local test reply)"
          : "Hi, a friendly reminder that your rent balance is KES 3,500. Please pay via Equity paybill 247247, account 275515 12. Thank you! (local test reply)")
      : isInsights
        ? "**This month:** KES 14,200 collected of KES 22,200 expected (64%).\n- **Mary Wambui** (House 12) still owes **KES 3,500**.\n- 1 payment is **unmatched** - assign it on the Unmatched page.\n- Expenses are steady at KES 5,700.\n\n**Next steps**\n- Send Mary a reminder.\n- Assign the unmatched KES 2,500.\n\n_(local test reply - not from Claude)_"
        : `You asked: "${question}". This is a **local test reply** - with your API key set in Apps Script, Claude answers from your real RentPro data.\n- Page focus: **${pageLine || "general"}**\n- Conversation turns sent: ${body.messages.length}` +
          (data.focusTenant ? `\n- Focused on **${data.focusTenant.name}** (balance KES ${Number(data.focusTenant.balance).toLocaleString()})` : "");
    return reply(text);
  }
});
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
