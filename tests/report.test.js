// Unit tests for js/report-math.js (the numbers behind reports.html).
const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../js/report-math.js");

const NOW = new Date(2026, 9, 28); // 28 Oct 2026

const data = {
  tenants: [
    // Since January: 10 months of rent by October.
    { Name: "Mary Wambui", House: "12", Rent: 6500, AmountPaid: 3000, DateAdded: new Date(2026, 0, 5) },
    // Moved in mid-September: rent expected for Sep and Oct only.
    { Name: "Faith Mutua", House: "9", Rent: 6000, AmountPaid: 7500, DateAdded: new Date(2026, 8, 20) }
  ],
  former: [
    // Lived in house 3 Feb-Jun, then moved out.
    { Name: "Old Tenant", House: "3", Rent: 5000, AmountPaid: 25000, DateAdded: new Date(2026, 1, 1), ArchivedDate: new Date(2026, 5, 30) }
  ],
  payments: [
    { Date: new Date(2026, 9, 3), Amount: 6500, House: "12", Notes: "Auto-matched by house 12" },
    { Date: new Date(2026, 9, 10), Amount: 6000, House: "9", Notes: "Manual" },
    { Date: new Date(2026, 9, 21), Amount: 2500, House: "44", Notes: "Unmatched" },
    { Date: new Date(2026, 8, 25), Amount: 6000, House: "9", Notes: "Manual" },
    { Date: new Date(2026, 2, 2), Amount: 5000, House: "3", Notes: "Manual" },
    { Date: "2025-12-31T09:00:00.000Z", Amount: 999, House: "12", Notes: "Manual" }
  ],
  expenses: [
    { Date: new Date(2026, 9, 5), Amount: 1200, Category: "Maintenance", House: "12" },
    { Date: new Date(2026, 9, 6), Amount: 800, Category: "Utilities", House: "General" },
    { Date: new Date(2026, 8, 6), Amount: 500, Category: "Cleaning", House: "General" }
  ],
  utilities: [
    { Month: "Oct 2026", House: "12", Water: 1200, Garbage: 150, Status: "Paid" },
    { Month: "Oct 2026", House: "9", Water: 600, Garbage: 150, Status: "Unpaid" },
    { Month: "Sep 2026", House: "9", Water: 480, Garbage: 150, Status: "Paid" }
  ]
};

test("periods are whole calendar months", () => {
  const thisMonth = R.periodFor("this_month", NOW);
  assert.equal(thisMonth.label, "Oct 2026");
  assert.deepEqual([thisMonth.start.getDate(), thisMonth.end.getDate(), thisMonth.end.getMonth()], [1, 31, 9]);
  assert.equal(R.periodFor("last_month", NOW).label, "Sep 2026");
  assert.equal(R.periodFor("last_3_months", NOW).label, "Aug 2026 – Oct 2026");
  assert.equal(R.periodFor("this_year", NOW).months.length, 10, "January to October");
  assert.equal(R.periodFor("last_year", NOW).label, "Jan 2025 – Dec 2025");
  assert.equal(R.periodFor("custom", NOW, { from: "2026-06", to: "2026-03" }).label, "Mar 2026 – Jun 2026");
  assert.equal(R.periodFor("all_time", NOW, { earliestDate: new Date(2025, 11, 31) }).label, "Dec 2025 – Oct 2026");
  assert.equal(R.previousPeriod(R.periodFor("last_3_months", NOW)).label, "May 2026 – Jul 2026");
});

test("this month: expected rent counts only tenants in place", () => {
  const r = R.buildReport(data, R.periodFor("this_month", NOW), NOW);
  assert.equal(r.expected, 6500 + 6000, "Mary + Faith; the former tenant left in June");
  assert.equal(r.collected, 6500 + 6000 + 2500, "includes the unmatched payment");
  assert.equal(r.expenses, 2000);
  assert.equal(r.net, 13000);
  assert.equal(Math.round(r.collectionRate * 1000) / 1000, Math.round((15000 / 12500) * 1000) / 1000);
  assert.deepEqual(r.unmatched, { count: 1, amount: 2500 });
  assert.equal(r.paymentsCount, 3);
});

test("this year: rent from the month each tenant moved in, and former tenants while they lived there", () => {
  const r = R.buildReport(data, R.periodFor("this_year", NOW), NOW);
  // Mary Jan-Oct (10 x 6500) + Faith Sep-Oct (2 x 6000) + former Feb-Jun (5 x 5000)
  assert.equal(r.expected, 65000 + 12000 + 25000);
  // Every 2026 payment; the Dec 2025 one is outside the year.
  assert.equal(r.collected, 6500 + 6000 + 2500 + 6000 + 5000);
  assert.equal(r.monthly.length, 10);
  const sep = r.monthly.find((m) => m.label === "Sep 26");
  assert.deepEqual([sep.expected, sep.collected, sep.expenses], [6500 + 6000, 6000, 500]);
  const jul = r.monthly.find((m) => m.label === "Jul 26");
  assert.equal(jul.expected, 6500, "former tenant gone after June");
});

test("per-house breakdown, categories, arrears and utilities", () => {
  const r = R.buildReport(data, R.periodFor("this_month", NOW), NOW);
  const h12 = r.houses.find((h) => h.house === "12");
  assert.deepEqual([h12.tenant, h12.expected, h12.collected, h12.expenses, h12.net, h12.balance], ["Mary Wambui", 6500, 6500, 1200, 5300, 3500]);
  assert.ok(r.houses.find((h) => h.house === "44"), "unmatched payment's house still listed");
  assert.ok(!r.houses.find((h) => h.house === "3"), "former tenant's house not listed outside their stay");
  assert.deepEqual(r.houses.map((h) => h.house), ["9", "12", "44"], "numeric house order");
  assert.deepEqual(r.categories, [{ name: "Maintenance", amount: 1200 }, { name: "Utilities", amount: 800 }]);
  assert.deepEqual(r.currentArrears, { total: 3500, top: [{ name: "Mary Wambui", house: "12", balance: 3500 }], count: 1 });
  assert.deepEqual(r.utilities, { billed: 1350 + 750, paid: 1350, unpaidCount: 1 });
});

test("comparison and empty data are safe", () => {
  assert.equal(R.change(150, 100), 0.5);
  assert.equal(R.change(5, 0), null);
  const empty = R.buildReport({}, R.periodFor("this_month", NOW), NOW);
  assert.deepEqual([empty.expected, empty.collected, empty.collectionRate, empty.margin], [0, 0, null, null]);
  assert.equal(R.earliestDate(data).getFullYear(), 2025);
  assert.equal(R.parseMonthLabel("Oct 2026").getMonth(), 9);
  assert.equal(R.parseMonthLabel("nonsense"), null);
});
