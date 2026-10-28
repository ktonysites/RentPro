// Demo copy of RentPro for recording the walkthrough video: the real site files, with Code.gs running
// on an in-memory sheet filled with realistic sample data (no real tenants).
// Usage: node demo-server.cjs [port]   (default 5502). POST /demo/sms {message} simulates an M-Pesa SMS.
const http = require("http");
const fs = require("fs");
const path = require("path");
const { createBackend } = require("../../tests/gas-harness");

const ROOT = path.join(__dirname, "..", "..");
const PORT = Number(process.argv[2] || 5502);
const API_PATH = "/api/exec";
const SMS_TOKEN = "demo-token";

const backend = createBackend({ properties: { SMS_WEBHOOK_TOKEN: SMS_TOKEN } });
const now = new Date();
const at = (monthsAgo, day, hour = 10) => new Date(now.getFullYear(), now.getMonth() - monthsAgo, day, hour, 12).toISOString();
const ref = (seed) => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789";
  let out = "U", x = seed * 7919 + 17;
  for (let i = 0; i < 9; i++) { x = (x * 48271) % 2147483647; out += chars[x % chars.length]; }
  return out;
};

// name, house, rent, next of kin, profile: full | partial | arrears | credit | late
const TENANTS = [
  ["Thadayo Brian Masika", "7", 8700, "Ann Masika", "full"],
  ["Hannah Wahu", "1", 8500, "Joseph Wahu", "full"],
  ["James Mwangi", "2", 8000, "Ruth Mwangi", "full"],
  ["Peter Otieno", "3", 7000, "", "arrears"],
  ["Faith Chebet", "4", 6000, "Mercy Chebet", "late"],
  ["Kevin Ouma", "5", 7000, "Linet Ouma", "full"],
  ["Lucy Njeri", "6", 6500, "", "full"],
  ["Daniel Kiprop", "8", 9000, "Esther Kiprop", "full"],
  ["Grace Akinyi", "9", 7500, "Tom Akinyi", "credit"],
  ["Mary Wambui", "12", 6500, "", "partial"]
];

let seed = 1;
const pay = (monthsAgo, day, amount, name, house) => backend.get({
  action: "addPayment", date: at(monthsAgo, day), amount: String(amount), tenant: name, house, reference: ref(seed++), method: "M-Pesa"
});

TENANTS.forEach(([name, house, rent, kin], i) => backend.get({
  action: "addTenant", name, house, rent: String(rent), date: "5",
  phone: "07" + String(10000000 + i * 1234567).slice(0, 8), natID: String(30000000 + i * 1111),
  nextOfKin: kin, kinRelation: kin ? "Relative" : "", nextOfKinPhone: kin ? "0700" + String(100000 + i * 777).slice(0, 6) : ""
}));

const paidThisMonth = {};
TENANTS.forEach(([name, house, rent, , profile]) => {
  for (let m = 4; m >= 1; m--) {
    if (profile === "arrears" && m <= 2) continue;
    if (profile === "partial") pay(m, m === 1 ? 19 : 4, m === 1 ? 4000 : rent, name, house);
    else if (profile === "late") pay(m, m % 2 ? 14 : 9, rent, name, house);
    else pay(m, 2 + (house.length + m) % 3, rent, name, house);
  }
  if (profile === "full") { pay(0, 2 + house.length, rent, name, house); paidThisMonth[name] = rent; }
  if (profile === "partial") { pay(0, 3, 3000, name, house); paidThisMonth[name] = 3000; }
  if (profile === "credit") { pay(0, 1, 9000, name, house); paidThisMonth[name] = 9000; }
  if (profile === "arrears") paidThisMonth[name] = -rent;
  if (profile === "late") paidThisMonth[name] = 0;
});
// Tenancies started four months ago (with the first payments); AmountPaid is this month's position (negative = carried arrears).
backend.sheetRows("Tenants").slice(1).forEach((row) => {
  row[8] = new Date(now.getFullYear(), now.getMonth() - 4, 1);
  row[9] = paidThisMonth[row[2]] || 0;
  row[10] = row[6] - row[9];
});

const expense = (monthsAgo, day, category, desc, amount, house = "General") =>
  backend.get({ action: "addExpense", date: at(monthsAgo, day), category, desc, amount: String(amount), house });
for (let m = 4; m >= 0; m--) {
  expense(m, 28 - (m === 0 ? 3 : 0), "Salary", "Caretaker salary", 6000);
  expense(m, 15, "Cleaning", "Compound cleaning", 1200);
}
expense(3, 11, "Maintenance", "Fixed leaking pipe", 1500, "7");
expense(2, 9, "Maintenance", "Fixed leaking pipe", 1800, "7");
expense(1, 12, "Maintenance", "Fixed leaking pipe", 1600, "7");
expense(1, 20, "Maintenance", "Replaced main gate hinges", 15000);
expense(2, 6, "Utilities", "KPLC tokens for security lights", 2500);
expense(0, 6, "Utilities", "KPLC tokens for security lights", 2500);
expense(3, 18, "Tax", "County land rates", 4800);
expense(0, 17, "Maintenance", "Repainted door, house 2", 3200, "2");

// Utility bills: earlier months paid, this month's generated with a few meter readings.
backend.get({ action: "generateMonthlyUtilities" });
[["12", 42], ["7", 9], ["9", 7], ["1", 8], ["2", 10]].forEach(([house, reading]) => {
  const tenant = TENANTS.find((t) => t[1] === house);
  backend.get({ action: "addMeterReading", house, currRead: String(reading), tenantName: tenant[0] });
});
const bills = backend.sheetRows("UtilityBills");
bills.slice(1).forEach((row, i) => { if (["1", "2", "5", "8"].includes(String(row[2])) && i % 2 === 0) { row[6] = "Paid"; row[7] = at(0, 20); } });

// Two payments that couldn't be matched automatically.
const sms = (amount, account, payer, code) => backend.post({
  message: `Confirmed. KES. ${amount}.00 to NANCYWANJIRUNGARI A/C Ref. No. ${account} Via MPESA Ref ${code} by ${payer} on ${String(now.getDate() - 2).padStart(2, "0")}-${String(now.getMonth() + 1).padStart(2, "0")}-${now.getFullYear()} at 09:41.Thank you.`
}, { action: "incoming_sms", token: SMS_TOKEN });
sms("7,000", "275515 33", "PETER OTINO", "UKP4QW8ZT2");
sms("3,500", "275515 120", "M. WAMBUI", "UKR7HD2MX9");

// Former tenants.
backend.get({ action: "addTenant", name: "John Kamau", house: "10", rent: "6000", phone: "0755000444", natID: "29998877" });
backend.sheetRows("Tenants").forEach((row) => { if (row[2] === "John Kamau") row[8] = new Date(now.getFullYear(), now.getMonth() - 4, 1); });
[4, 3, 2].forEach((m) => pay(m, 6, 6000, "John Kamau", "10"));
backend.get({ action: "moveOut", tenantName: "John Kamau", houseNumber: "10", reason: "Got a job in Mombasa", depositStatus: "Kept for damages" });
backend.get({ action: "addTenant", name: "Sarah Achieng", house: "11", rent: "6500", phone: "0766000555", natID: "29997766" });
backend.sheetRows("Tenants").forEach((row) => { if (row[2] === "Sarah Achieng") { row[9] = 6500; row[10] = 0; } });
backend.get({ action: "moveOut", tenantName: "Sarah Achieng", houseNumber: "11", reason: "Rent too high, moved to a cheaper area", depositStatus: "Refunded" });

const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".json": "application/json", ".webp": "image/webp", ".ico": "image/x-icon" };

http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let body = "";
  req.on("data", (chunk) => { body += chunk; });
  req.on("end", () => {
    if (url.pathname === "/demo/sms") {
      const result = backend.post(body, { action: "incoming_sms", token: SMS_TOKEN });
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(result));
    }
    if (url.pathname === API_PATH) {
      const parameter = Object.fromEntries(url.searchParams);
      const output = req.method === "POST"
        ? backend.context.doPost({ parameter, postData: { contents: body } })
        : backend.context.doGet({ parameter });
      res.writeHead(200, { "Content-Type": output.mime === "javascript" ? "text/javascript" : "application/json", "Access-Control-Allow-Origin": "*" });
      return res.end(output.getContent());
    }
    const file = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname)));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404, { "Content-Type": "text/html" });
      return res.end(fs.readFileSync(path.join(ROOT, "404.html")));
    }
    let content = fs.readFileSync(file);
    if (path.basename(file) === "global.js") {
      content = content.toString().replace(/window\.API_URL = "[^"]*";/, `window.API_URL = "http://localhost:${PORT}${API_PATH}";`);
    }
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(content);
  });
}).listen(PORT, () => console.log(`RentPro demo: http://localhost:${PORT}`));
