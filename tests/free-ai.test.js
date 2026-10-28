// Tests for the free built-in assistant (no Claude key): every quick action and common questions,
// answered from realistic seeded data. Run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { createBackend } = require("./gas-harness");

const TOKEN = "secret-token";
const now = new Date();
const monthsAgo = (n, day = 3) => new Date(now.getFullYear(), now.getMonth() - n, day, 10, 0);
const iso = (d) => d.toISOString();
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthName = (n) => { const d = monthsAgo(n); return MONTHS[d.getMonth()] + " " + d.getFullYear(); };

// Quick actions exactly as the pages define them.
const panelSource = fs.readFileSync(path.join(__dirname, "..", "js", "ai-panel.js"), "utf8");
const ACTIONS = new Function("return " + panelSource.slice(panelSource.indexOf("const ACTIONS = {") + 16, panelSource.indexOf("\n    };", panelSource.indexOf("const ACTIONS")) + 6))();

function seeded() {
  const api = createBackend({ properties: { SMS_WEBHOOK_TOKEN: TOKEN }, urlFetch: () => { throw new Error("the free assistant must not call out"); } });
  api.get({ action: "addTenant", name: "Thadayo Brian Masika", phone: "0712345678", natID: "12345678", house: "7", rent: "8700", date: "5", nextOfKin: "Jane" });
  api.get({ action: "addTenant", name: "Mary Wambui", phone: "0722000111", natID: "22223333", house: "12", rent: "6500", date: "5" });
  api.get({ action: "addTenant", name: "Peter Otieno", phone: "0733000222", natID: "33334444", house: "3", rent: "5000", date: "5", nextOfKin: "Ann" });
  api.get({ action: "addTenant", name: "Grace Akinyi", phone: "0744000333", natID: "44445555", house: "9", rent: "7000", date: "5" });
  // Tenancies started 4 months ago; this month's amounts paid (Peter owes two months, Grace paid ahead).
  const paid = { "Thadayo Brian Masika": 8700, "Mary Wambui": 3000, "Peter Otieno": -5000, "Grace Akinyi": 9000 };
  api.sheetRows("Tenants").slice(1).forEach((row) => { row[8] = monthsAgo(4, 1); row[9] = paid[row[2]]; row[10] = row[6] - paid[row[2]]; });

  const pay = (n, day, amount, tenant, house, ref) => api.get({ action: "addPayment", date: iso(monthsAgo(n, day)), amount: String(amount), tenant, house, reference: ref, method: "M-Pesa" });
  [3, 2, 1].forEach((n) => pay(n, 3, 8700, "Thadayo Brian Masika", "7", "THA" + n));
  pay(0, 2, 8700, "Thadayo Brian Masika", "7", "THA0");
  pay(2, 4, 6500, "Mary Wambui", "12", "MAR2");
  pay(1, 20, 4000, "Mary Wambui", "12", "MAR1");
  pay(0, 1, 3000, "Mary Wambui", "12", "MAR0");
  pay(0, 1, 3000, "Mary Wambui", "12", "MAR0B"); // looks like a double payment
  pay(1, 2, 7000, "Grace Akinyi", "9", "GRA1");
  pay(0, 1, 9000, "Grace Akinyi", "9", "GRA0");

  // Unmatched: Peter paid to a mistyped account (house 33) and M-Pesa spells his name differently.
  api.post({ message: "Confirmed. KES. 5,000.00 to NANCYWANJIRUNGARI A/C Ref. No. 275515 33 Via MPESA Ref UNM1ATCH01 by PETER OTINO on 17-10-2026 at 15:38.Thank you." }, { action: "incoming_sms", token: TOKEN });

  const expense = (n, category, desc, amount, house) => api.get({ action: "addExpense", date: iso(monthsAgo(n, 10)), category, desc, amount: String(amount), house });
  expense(3, "Maintenance", "Fixed leaking pipe", 1500, "7");
  expense(2, "Maintenance", "Fixed leaking pipe", 1800, "7");
  expense(1, "Maintenance", "Fixed leaking pipe", 1600, "7");
  expense(1, "Maintenance", "Replaced main gate", 15000, "General");
  expense(0, "Salary", "Caretaker salary", 6000, "General");
  expense(0, "Cleaning", "Compound cleaning", 1200, "General");

  api.get({ action: "generateMonthlyUtilities" });
  api.get({ action: "addMeterReading", house: "12", currRead: "40", tenantName: "Mary Wambui" });
  api.get({ action: "addMeterReading", house: "7", currRead: "6", tenantName: "Thadayo Brian Masika" });
  api.get({ action: "addMeterReading", house: "9", currRead: "5", tenantName: "Grace Akinyi" });

  // A former tenant who left a balance.
  api.get({ action: "addTenant", name: "John Kamau", phone: "0755000444", natID: "55556666", house: "4", rent: "6000" });
  api.get({ action: "moveOut", tenantName: "John Kamau", houseNumber: "4", reason: "Got a job in Mombasa", depositStatus: "Kept for damages" });
  return api;
}

const tenantId = (api, name) => api.get({ action: "getTenants" }).data.find((t) => t.Name === name).ID;
const ask = (api, question, extra = {}) => {
  const result = api.get(Object.assign({ action: "aiAssist", mode: "ask", question }, extra));
  assert.equal(result.success, true, result.message);
  assert.equal(result.data.engine, "free");
  return result.data.text;
};

test("every quick action on every page gets a real, specific answer", () => {
  const api = seeded();
  const mary = tenantId(api, "Mary Wambui");
  const expect = {
    "Today's briefing": /briefing[\s\S]*Payments to check[\s\S]*1 unmatched payment \(KES 5,000\)[\s\S]*Do next/,
    "Who should I follow up with?": /Follow up[\s\S]*Peter Otieno[\s\S]*Mary Wambui/,
    "This month vs last month": /vs .*\n- Rent collected/,
    "Who is behind on rent?": /2 of 4 tenants owe KES 13,500/,
    "Reminders for everyone owing": /Reminders for the 2 tenants[\s\S]*Account 275515#3/,
    "Missing tenant details": /2 tenants are missing next-of-kin[\s\S]*Mary Wambui[\s\S]*Grace Akinyi/,
    "Summarise this tenant": /\*\*Mary Wambui \(House 12\)\*\*[\s\S]*KES 3,500 owed/,
    "Do they pay on time?": /Mary Wambui[\s\S]*⚠️ part/,
    "Reminder (English)": /Hello Mary, .*KES 3,500.*275515#12/,
    "Reminder (Kiswahili)": /Habari Mary, .*Salio lako ni KES 3,500.*Akaunti 275515#12/,
    "This month's payments": /Collected in this month.*KES 23,700\*\* from 4 payments/,
    "Unusual or duplicate payments": /Possible double payment: Mary Wambui paid KES 3,000 twice/,
    "Unmatched payments": /KES 5,000 from PETER OTINO[\s\S]*Peter Otieno \(House 3\)\*\*, high confidence/,
    "How should I match these?": /Payer name/,
    "Who hasn't paid utilities?": /owed in utilities/,
    "Highest water use": /House 12 \(Mary Wambui\): 40 units[\s\S]*Unusually high/,
    "Total owed": /owed in utilities\*\*: water KES [\d,]+, garbage KES [\d,]+/,
    "Spending by category": /By category[\s\S]*Maintenance[\s\S]*By house/,
    "Unusual spending": /"Fixed leaking pipe" was paid 3 times[\s\S]*House 7 needed 3 repairs/,
    "Where can I save?": /Maintenance: KES 19,900/,
    "Explain my numbers": /Income \(rent received\)[\s\S]*Profit/,
    "Collection rate": /Collection rate, last 3 months/,
    "What to improve": /Collect arrears[\s\S]*Clear unmatched payments/,
    "Unpaid balances": /John Kamau \(House 4\): \*\*KES 6,000\*\*/,
    "Why tenants leave": /Moved for work or school: 1/,
    "Payment instructions message": /Business number: \*\*247247\*\*[\s\S]*275515#<your house number>/,
    "Move-out checklist": /Move-out checklist[\s\S]*Collect all keys/,
    "Deposit refund message": /deposit was KES \[deposit\]/,
    "Goodbye message": /wish you all the best/
  };
  let checked = 0;
  Object.entries(ACTIONS).forEach(([page, config]) => config.items.forEach(([, label, prompt]) => {
    if (!prompt) return; // page-run actions (reconcile's suggest button) are covered below
    const text = ask(api, prompt, { page, tenantId: page === "tenant-profile" ? mary : "" });
    assert.ok(expect[label], "no expectation for quick action: " + label);
    assert.match(text, expect[label], label + "\n---\n" + text);
    assert.doesNotMatch(text, /not sure I understood/, label);
    checked++;
  }));
  assert.equal(checked, Object.keys(expect).length);
});

test("answers questions in the landlord's own words, with periods, names and houses", () => {
  const api = seeded();
  assert.match(ask(api, "Who hasn't paid rent this month?"), /Peter Otieno \(House 3\): \*\*KES 10,000\*\*, nothing paid yet/);
  assert.match(ask(api, "How much did I collect last month?"), new RegExp("Collected in last month \\(" + monthName(1) + "\\): KES 19,700"));
  assert.match(ask(api, "Which tenants owe more than one month of rent?"), /Peter Otieno \(House 3\): KES 10,000, about \*\*2 months\*\*/);
  assert.match(ask(api, "Which tenants have only paid part of their rent?"), /Mary Wambui \(House 12\): paid KES 3,000 of KES 6,500/);
  assert.match(ask(api, "Summarise this month's expenses"), /Expenses for this month.*KES 7,200/);
  assert.match(ask(api, "How is rent collection trending over the last 3 months?"), /Collection rate, last 3 months/);
  assert.match(ask(api, "How much does house 7 owe?"), /Thadayo Brian Masika \(House 7\)\*\*[\s\S]*fully paid/);
  api.get({ action: "addTenant", name: "Ken O'Brien", phone: "0766000555", natID: "66667777", house: "15", rent: "5000" });
  assert.match(ask(api, "How much does O’Brien owe?"), /\*\*Ken O'Brien \(House 15\)\*\*/);
  api.get({ action: "deleteTenant", id: tenantId(api, "Ken O'Brien") });
  assert.match(ask(api, "tell me about grace"),/Grace Akinyi \(House 9\)[\s\S]*KES 2,000 in credit/);
  assert.match(ask(api, "who has paid ahead?"), /Grace Akinyi \(House 9\): KES 2,000 ahead/);
  assert.match(ask(api, "nani anadaiwa?"), /2 of 4 tenants owe/);
  assert.match(ask(api, "how many tenants do i have"), /You have 4 tenants/);
  assert.match(ask(api, "Draft a reminder for Peter in Kiswahili"), /Habari Peter, .*KES 10,000/);
  assert.match(ask(api, "Expenses in " + MONTHS[monthsAgo(1).getMonth()]), /Expenses for .*KES 16,600/);
});

test("follow-up questions use the tenant from earlier in the conversation", () => {
  const api = seeded();
  const history = [{ role: "user", content: "Tell me about Mary" }, { role: "assistant", content: "**Mary Wambui (House 12)** ..." }];
  assert.match(ask(api, "Does she pay on time?", { history: JSON.stringify(history) }), /Mary Wambui (usually|often)/);
});

test("unknown questions get a page overview plus suggestions instead of an error", () => {
  const api = seeded();
  const text = ask(api, "What colour is the sky?", { page: "utilities" });
  assert.match(text, /owed in utilities/);
  assert.match(text, /Try asking/);
  assert.match(ask(api, "hello"), /built-in assistant/);
});

test("free dashboard insights and reminders", () => {
  const api = seeded();
  const insights = api.get({ action: "aiAssist", mode: "insights" }).data;
  assert.equal(insights.engine, "free");
  const has = (part) => assert.ok(insights.text.includes(part), "missing: " + part + "\n---\n" + insights.text);
  has("You've collected **KES 23,700 of KES 33,200** expected rent (71%). That's ahead of last month");
  has("**✅ Do next**\n1. Assign the unmatched payment on the Unmatched page (likely Peter).");
  has("**⚠️ Watch list**\n- Peter Otieno owes about 2 months of rent");
  has("Grace Akinyi (KES 2,000) paid ahead");
  has("2 tenants have no next of kin: Mary, Grace");
  has("Former tenants left KES 6,000 unpaid");
  if (now.getDate() > 5) {
    has("**🔴 Late payments**\n- Peter Otieno (House 3): **KES 10,000**, ");
    has(" days late (due on the 5th). Late or short in 3 of the last 3 months\n- Mary Wambui (House 12)");
  } else {
    has("**🟡 Due in the next 7 days**\n- Mary Wambui");
  }

  const peter = tenantId(api, "Peter Otieno");
  const sw = api.get({ action: "aiAssist", mode: "reminder", tenantId: peter, language: "Kiswahili" }).data.text;
  assert.match(sw, /^Habari Peter, .*Salio lako ni KES 10,000\. Tafadhali lipa kupitia Equity Paybill 247247, Akaunti 275515#3\. Asante!$/);
  assert.ok(sw.length < 300, "fits in an SMS-sized message");
});

test("free match suggestions use payer name, account typo and amount", () => {
  const api = seeded();
  const result = api.get({ action: "aiAssist", mode: "matchSuggest" });
  assert.equal(result.data.engine, "free");
  const [s] = result.data.suggestions;
  assert.equal(s.paymentId, api.get({ action: "getUnmatched" }).data[0].ID);
  assert.deepEqual([s.tenantName, s.house, s.confidence], ["Peter Otieno", "3", "high"]);
  assert.match(s.reason, /shares the name Peter.*typo for house 3.*equals their rent/i);
});

test("free expense categories understand English and Kiswahili", () => {
  const api = createBackend();
  const categorize = (question) => api.get({ action: "aiAssist", mode: "categorize", question }).data;
  assert.deepEqual([categorize("Fixed leaking pipe in house 7").category, categorize("Fixed leaking pipe in house 7").house], ["Maintenance", "7"]);
  assert.equal(categorize("KPLC tokens for security lights").category, "Utilities");
  assert.equal(categorize("Mshahara wa askari").category, "Salary");
  assert.equal(categorize("Fundi wa nyumba 4 door lock").house, "4");
  assert.equal(categorize("County land rates").category, "Tax");
  assert.equal(categorize("Fumigation").category, "Cleaning");
  assert.deepEqual(categorize("Bought a gift"), { category: "Other", house: "General", reason: "No category keyword found", engine: "free" });
});

test("free assistant works on an empty property", () => {
  const api = createBackend();
  assert.match(ask(api, "Who owes rent?"), /no tenants yet/);
  assert.match(api.get({ action: "aiAssist", mode: "insights" }).data.text, /No tenants yet[\s\S]*1\. Add your first tenant/);
  assert.match(ask(api, "Summarise my expenses"), /No expenses recorded/);
  assert.match(ask(api, "Who hasn't paid utilities?"), /No utility bills yet/);
  assert.deepEqual(api.get({ action: "aiAssist", mode: "matchSuggest" }).data.suggestions, []);
});

test("late payers, due dates, reliable tenants and the watch list", () => {
  const api = seeded();
  const late = ask(api, "Who is late with rent?");
  assert.match(late, /Peter Otieno \(House 3\): \*\*KES 10,000\*\*, \d+ days late \(due on the 5th\)/);
  if (now.getDate() > 5) assert.match(late, /2 tenants are late, KES 13,500 overdue/);
  assert.match(ask(api, "Who is due this week?"), /Rent due days:\*\*\n- The 5th: Thadayo Brian Masika \(House 7\), Mary Wambui/);
  const reliable = ask(api, "Who are my most reliable tenants?");
  assert.match(reliable, /Thadayo Brian Masika \(House 7\): 3 of 3 months ⭐/);
  assert.match(reliable, /Peter Otieno \(House 3\): 0 of 3 months/);
  assert.match(ask(api, "Any tenants I should worry about?"), /Peter Otieno\*\* \(House 3\) owes KES 10,000/);
});

test("payments: reference lookup, latest payments and methods", () => {
  const api = seeded();
  assert.match(ask(api, "Find payment MAR2 please"), /./); // short refs fall through to normal answers
  assert.match(ask(api, "where is UNM1ATCH01?"), /\*\*UNM1ATCH01\*\*: KES 5,000 .* from PETER OTINO\. It is \*\*unmatched\*\*/);
  assert.match(ask(api, "check ZZZ1234567"), /No payment with reference \*\*ZZZ1234567\*\*/);
  const recent = ask(api, "Show the latest payments");
  assert.match(recent, /Latest payments:\*\*\n- \d\d \w{3}: KES 5,000 from PETER OTINO \(unmatched\)/);
  assert.match(ask(api, "How did tenants pay this month, by method?"), /M-Pesa: KES 23,700 \(4 payments, 100%\)/);
});

test("one tenant's payments, category spending and other everyday questions", () => {
  const api = seeded();
  assert.match(ask(api, "how much did house 12 pay last month"), /Mary Wambui \(House 12\) paid KES 4,000 in last month[\s\S]*KES 4,000 · M-Pesa · MAR1/);
  assert.match(ask(api, "show me thadayo's payments"), /Thadayo Brian Masika \(House 7\) paid KES 34,800 in the last 12 months\*\* \(4 payments\)/);
  assert.match(ask(api, "show me peter's payments"), /Peter Otieno \(House 3\) made no payments[\s\S]*owe KES 10,000/);
  assert.match(ask(api, "what did I spend on maintenance"), /Maintenance in this year .*: KES 19,900\*\* \(73% of all spending\)/);
  assert.match(ask(api, "what should I focus on today"), /briefing[\s\S]*Do next/);
  assert.match(ask(api, "nani hajalipa kodi"), /2 of 4 tenants owe/);
  assert.match(ask(api, "write a thank you message to grace"), /^Hello Grace, thank you/);
  assert.match(ask(api, "what's the paybill"), /247247/);
});

test("how-do-I questions explain the real screens", () => {
  const api = seeded();
  const help = (q) => ask(api, q, { page: "assistant" });
  assert.match(help("How do I add a tenant?"), /Add New Tenant[\s\S]*Save Tenant/);
  assert.match(help("how do i record a cash payment"), /tap \*\*Pay\*\* next to the tenant[\s\S]*Confirm Payment/);
  assert.match(help("How can I restore a deleted payment?"), /Recently deleted[\s\S]*Restore/);
  assert.match(help("how to clear payments"), /Select all[\s\S]*Clear/);
  assert.match(help("How do I move a tenant out?"), /Confirm & Archive Tenant/);
  assert.match(help("how do I generate water bills"), /Generate This Month's Bills/);
  assert.match(help("How do I add a meter reading?"), /Reading/);
  assert.match(help("how do I export reports"), /Print \/ PDF[\s\S]*CSV/);
  assert.match(help("how do I assign unmatched payments"), /AI suggest[\s\S]*Confirm Assignment/);
  assert.match(help("how do payments get recorded automatically from sms"), /MacroDroid/);
  assert.match(help("How do I change a tenant's rent due date?"), /15th[\s\S]*DueDate/);
  assert.match(help("how do I edit a tenant's phone number"), /Edit[\s\S]*Save Changes/);
  assert.match(help("how do I install the app on my phone"), /RentPro\.apk/);
  assert.match(help("How do I send a reminder?"), /Reminder[\s\S]*WhatsApp/);
  // Data and drafting questions are not hijacked by the how-to help.
  assert.match(help("How can I improve my income?"), /What would help most/);
  assert.match(help("How much did I collect last month?"), /Collected in last month/);
  assert.match(ask(api, "Write a short message I can send any tenant explaining how to pay rent with the paybill and their house account number.", { page: "pay" }), /Business number: \*\*247247\*\*/);
  assert.match(help("what can you do"), /I can help with:[\s\S]*Using RentPro/);
});
