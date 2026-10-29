// Monthly statement tests (buildStatement in google-apps-script/Code.gs). Run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const { createBackend } = require("./gas-harness");

// Settings with every optional charge off, so each test turns on only what it checks.
const plain = { startDay: 16, garbageFee: 0, tenancyFee: 0, depositMonths: 0, caretakerFee: 0, rentalTaxPercent: 0, managementPercent: 0, vatPercent: 0 };

function backend(settings) {
  const api = createBackend();
  api.get({ action: "saveStatementSettings", settings: JSON.stringify({ ...plain, ...settings }) });
  return api;
}
const setAdded = (api, name, date) => api.sheetRows("Tenants").forEach((row) => { if (row[2] === name) row[8] = date; });
const pay = (api, name, house, amount, date) => api.get({ action: "addPayment", tenant: name, house, amount: String(amount), date: date.toISOString() });
const statement = (api, period) => api.get({ action: "getStatement", period }).data;

test("billing periods run from the 16th to the 15th and are named by the month they end in", () => {
  const api = backend({});
  const s = statement(api, "2026-10");
  assert.equal(s.period.start, "2026-09-16");
  assert.equal(s.period.end, "2026-10-15");
  assert.equal(s.period.label, "16 Sep – 15 Oct 2026");
  assert.equal(api.context.statementKeyFor(new Date(2026, 9, 29), 16), "2026-11");
  assert.equal(api.context.statementKeyFor(new Date(2026, 9, 15), 16), "2026-10");
  assert.equal(statement(backend({ startDay: 1 }), "2026-10").period.end, "2026-10-31");
});

test("settlement matches the agent's October 2026 statement", () => {
  // Their figures: balance 253,300 → 10% tax 25,330 → 227,970 → 7% fee 15,957.90 → VAT 2,553.26.
  const api = backend({ caretakerFee: 5000, rentalTaxPercent: 10, managementPercent: 7, vatPercent: 16 });
  api.get({ action: "addTenant", name: "Big Tenant", house: "1", rent: "258300" });
  setAdded(api, "Big Tenant", new Date(2026, 7, 1));
  pay(api, "Big Tenant", "1", 258300, new Date(2026, 9, 1));
  const s = statement(api, "2026-10").settlement;
  assert.equal(s.collected, 258300);
  assert.equal(s.rentBase, 253300);
  assert.equal(s.rentalTax, 25330);
  assert.equal(s.afterTax, 227970);
  assert.equal(s.managementFee, 15957.9);
  assert.equal(s.vat, 2553.26);
  assert.equal(s.netToLandlord, 227970 - 15957.9 - 2553.26);
});

test("payments clear arrears first, then rent, garbage and water; balances carry forward", () => {
  const api = backend({ garbageFee: 150, openingBalances: { "7": 1000 }, firstPeriod: "2026-10" });
  api.get({ action: "addTenant", name: "Mary Wanjiku", house: "7", rent: "9500" });
  setAdded(api, "Mary Wanjiku", new Date(2026, 5, 1));
  pay(api, "Mary Wanjiku", "7", 10000, new Date(2026, 9, 2));
  const october = statement(api, "2026-10").lines[0];
  assert.equal(october.broughtForward, 1000);
  assert.equal(october.totalDue, 1000 + 9500 + 150);
  assert.equal(october.allocated.arrears, 1000);
  assert.equal(october.allocated.rent, 9000);
  assert.equal(october.allocated.garbage, 0);
  assert.equal(october.balance, 650);
  assert.deepEqual(october.paidDates, ["2026-10-02"]);

  // Next period starts with the 650 still owed.
  pay(api, "Mary Wanjiku", "7", 10300, new Date(2026, 9, 20));
  const november = statement(api, "2026-11").lines[0];
  assert.equal(november.broughtForward, 650);
  assert.equal(november.balance, 0);
});

test("new tenants owe a deposit and tenancy fee, kept out of the rent the landlord is taxed on", () => {
  const api = backend({ depositMonths: 1, tenancyFee: 500, rentalTaxPercent: 10, firstPeriod: "2026-10" });
  api.get({ action: "addTenant", name: "Juliet Kanyoro", house: "10", rent: "9500" });
  setAdded(api, "Juliet Kanyoro", new Date(2026, 9, 20));
  pay(api, "Juliet Kanyoro", "10", 19500, new Date(2026, 9, 20));
  const s = statement(api, "2026-11");
  const line = s.lines[0];
  assert.equal(line.isNew, true);
  assert.equal(line.deposit, 9500);
  assert.equal(line.tenancyFee, 500);
  assert.equal(line.balance, 0);
  assert.equal(s.settlement.deductions.deposits, 9500);
  assert.equal(s.settlement.deductions.tenancyFees, 500);
  assert.equal(s.settlement.rentBase, 9500);
  assert.equal(s.settlement.rentalTax, 950);
  assert.deepEqual(s.newTenants, [{ house: "10", tenant: "Juliet Kanyoro" }]);
});

test("utility bills set the water and garbage due; repairs and caretaker pay come from expenses", () => {
  const api = backend({ caretakerFee: 5000, firstPeriod: "2026-10" });
  api.get({ action: "addTenant", name: "Peter Kamau", house: "12", rent: "8500" });
  setAdded(api, "Peter Kamau", new Date(2026, 5, 1));
  api.sheetRows("UtilityBills").push(["UTIL-1", "Oct 2026", "12", "Peter Kamau", 300, 150, "Unpaid", "", "", "", 0]);
  pay(api, "Peter Kamau", "12", 8950, new Date(2026, 9, 3));
  api.get({ action: "addExpense", date: new Date(2026, 9, 5).toISOString(), category: "Maintenance", desc: "Shower repair", amount: "1500", house: "12" });
  api.get({ action: "addExpense", date: new Date(2026, 9, 6).toISOString(), category: "Salary", desc: "Caretaker", amount: "6000" });
  const s = statement(api, "2026-10");
  assert.equal(s.lines[0].water, 300);
  assert.equal(s.lines[0].garbage, 150);
  assert.equal(s.lines[0].balance, 0);
  assert.equal(s.settlement.deductions.water, 300);
  assert.equal(s.settlement.deductions.caretaker, 6000);
  assert.equal(s.settlement.repairs, 1500);
  assert.equal(s.settlement.rentBase, 8950 - 300 - 150 - 6000);
});

test("settings are cleaned before saving", () => {
  const api = createBackend();
  const saved = api.get({ action: "saveStatementSettings", settings: JSON.stringify({ startDay: 40, rentalTaxPercent: "7.5", firstPeriod: "bad", openingBalances: { " 4 ": "13700", "5": 0, "": 5 } }) }).data;
  assert.equal(saved.startDay, 28);
  assert.equal(saved.rentalTaxPercent, 7.5);
  assert.equal(saved.firstPeriod, "");
  assert.deepEqual(saved.openingBalances, { "4": 13700 });
  assert.equal(api.get({ action: "getStatementSettings" }).data.managementPercent, 7);
});

test("old or renamed sheet headers still read as RentPro's own columns", () => {
  const api = createBackend();
  api.get({ action: "addTenant", name: "Praxides Anyona", house: "1", rent: "9500" });
  api.get({ action: "addPayment", tenant: "Praxides Anyona", house: "1", amount: "9550", reference: "UJTFPBW3D5" });
  api.sheetRows("Payments")[0] = ["Date", "Amount", "M-Pesa Name", "Ref Code", "Match Status", "House No", "Raw Message", "OwnerID", "SmsText", "ID"];
  api.sheetRows("Tenants")[0][10] = "Column 1";
  const payment = api.get({ action: "getPayments" }).data[0];
  assert.equal(payment.Tenant, "Praxides Anyona");
  assert.equal(payment.House, "1");
  assert.equal(payment.Reference, "UJTFPBW3D5");
  assert.equal(api.get({ action: "getTenants" }).data[0].Balance, 9500);
});

test("the free assistant explains the statement", () => {
  const api = backend({ caretakerFee: 5000, rentalTaxPercent: 10, managementPercent: 7, vatPercent: 16 });
  api.get({ action: "addTenant", name: "Batuli Majid", house: "26", rent: "16000" });
  setAdded(api, "Batuli Majid", new Date(2025, 0, 1));
  pay(api, "Batuli Majid", "26", 16450, new Date());
  const ask = (question) => api.get({ action: "aiAssist", mode: "ask", question }).data.text;
  const text = ask("How much will I get after the management fee and tax?");
  assert.match(text, /\*\*Statement for \d+ \w{3}/);
  assert.match(text, /Rental income tax \(10%\)/);
  assert.match(text, /Management fee \(7%\)/);
  assert.match(text, /Net to you: KES/);
  assert.match(ask("show me last month's statement"), /Statement for/);
});

test("expense rows in the older id/date/category layout are read alongside current rows", () => {
  const api = createBackend();
  api.get({ action: "addExpense", date: "2026-02-06T00:00:00.000Z", category: "Utilities", desc: "Monthly Garbage Fee - House 1", amount: "150", house: "1" });
  const rows = api.sheetRows("Expenses");
  rows[0] = ["id", "date", "category", "description", "amount", "OwnerID", ""];
  rows.push(["a8d3", new Date(2025, 10, 26), "Maintenance", "plumber fix", 8500, "", ""]);
  const list = api.get({ action: "getExpenses" }).data;
  assert.equal(list.length, 2);
  assert.deepEqual([list[0].Category, list[0].Description, list[0].Amount, list[0].House], ["Utilities", "Monthly Garbage Fee - House 1", 150, "1"]);
  assert.deepEqual([list[1].Category, list[1].Description, list[1].Amount, list[1].House], ["Maintenance", "plumber fix", 8500, "General"]);
  assert.equal(new Date(list[1].Date).getFullYear(), 2025);
});

test("former tenants read correctly even under an old Archives header row", () => {
  const api = createBackend();
  api.get({ action: "addTenant", name: "Repher Anekeya", house: "23", rent: "16000" });
  api.get({ action: "moveOut", tenantName: "Repher Anekeya", reason: "Moved out", depositStatus: "To be refunded: KES 10,150" });
  api.sheetRows("Archives")[0] = ["ID", "UID", "Name", "Phone", "NationalID", "House", "Rent", "DueDate", "DateAdded", "AmountPaid", "Balance", "ArchivedDate", "", "DepositStatus"];
  const former = api.get({ action: "getArchivedData" }).archives[0];
  assert.equal(former.MoveOutReason, "Moved out");
  assert.equal(former.DepositStatus, "To be refunded: KES 10,150");
  assert.ok(former.ArchivedDate);
});

test("a house is charged once when one tenant moves out and another moves in that period", () => {
  const api = backend({ firstPeriod: "2026-11" });
  api.get({ action: "addTenant", name: "Ann Wanjiku", house: "10", rent: "9500" });
  setAdded(api, "Ann Wanjiku", new Date(2026, 8, 7));
  api.get({ action: "moveOut", tenantName: "Ann Wanjiku", reason: "Moved out" });
  api.get({ action: "addTenant", name: "Juliet Kanyoro", house: "10", rent: "9500" });
  const s = statement(api, "2026-11");
  assert.deepEqual(s.lines.map((l) => l.tenant), ["Juliet Kanyoro"]);
  assert.equal(s.totals.rent, 9500);
});
