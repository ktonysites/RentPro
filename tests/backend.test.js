// Backend tests for google-apps-script/Code.gs. Run with: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const { createBackend } = require("./gas-harness");

const SAMPLE_SMS = "Confirmed. KES. 8,700.00 to NANCYWANJIRUNGARI A/C Ref. No. 275515 7 Via MPESA Ref UJH7UAL03Q by THADAYO BRIAN MASIKA on 17-10-2026 at 15:38.Thank you.";
const TOKEN = "secret-token";

function setup() {
  const api = createBackend({ properties: { SMS_WEBHOOK_TOKEN: TOKEN } });
  api.get({ action: "addTenant", name: "Thadayo Brian Masika", phone: "0712345678", natID: "12345678", house: "7", rent: "8700" });
  api.get({ action: "addTenant", name: "Mary Wambui", phone: "0722000111", natID: "22223333", house: "House 12", rent: "6500" });
  return api;
}

const tenants = (api) => api.get({ action: "getTenants" }).data;
const payments = (api) => api.get({ action: "getPayments" }).data;
const tenantIn = (api, house) => tenants(api).find((t) => String(t.House) === house);

test("parses the landlord's M-Pesa notification", () => {
  const api = createBackend();
  const parsed = api.context.parsePaymentSms(SAMPLE_SMS);
  assert.equal(parsed.amount, 8700);
  assert.equal(parsed.reference, "UJH7UAL03Q");
  assert.equal(parsed.account, "275515 7");
  assert.equal(parsed.house, "7");
  assert.equal(parsed.payer, "THADAYO BRIAN MASIKA");
  assert.equal(parsed.date.getFullYear(), 2026);
  assert.equal(parsed.date.getMonth(), 9);
  assert.equal(parsed.date.getDate(), 17);
  assert.equal(parsed.date.getHours(), 15);
  assert.equal(parsed.date.getMinutes(), 38);
});

test("parses account variants and the classic M-Pesa received format", () => {
  const api = createBackend();
  const { parsePaymentSms, houseFromAccount } = api.context;
  assert.equal(houseFromAccount("275515#7"), "7");
  assert.equal(houseFromAccount("275515 A4"), "A4");
  assert.equal(houseFromAccount("275515-House 12"), "12");
  // Tenants who type the account without a separator, or forget the prefix
  assert.equal(houseFromAccount("2755157"), "7");
  assert.equal(houseFromAccount("27551512"), "12");
  assert.equal(houseFromAccount("7"), "7");

  const classic = parsePaymentSms("UJK1ABC2DE Confirmed. You have received Ksh5,000.00 from JOHN DOE 0712345678 on 3/11/26 at 2:05 PM New M-PESA balance is Ksh9,000.00.");
  assert.equal(classic.amount, 5000);
  assert.equal(classic.reference, "UJK1ABC2DE");
  assert.equal(classic.payer, "JOHN DOE");
  assert.equal(classic.phone, "0712345678");
  assert.equal(classic.date.getHours(), 14);
});

test("incoming SMS credits the tenant in the house from the account", () => {
  const api = setup();
  const result = api.post({ message: SAMPLE_SMS }, { action: "incoming_sms", token: TOKEN });
  assert.equal(result.success, true, result.message);
  assert.equal(result.data.matched, true);
  assert.equal(result.data.balance, 0);

  const tenant = tenantIn(api, "7");
  assert.equal(tenant.AmountPaid, 8700);
  assert.equal(tenant.Balance, 0);

  const [payment] = payments(api);
  assert.equal(payment.Amount, 8700);
  assert.equal(payment.Reference, "UJH7UAL03Q");
  assert.equal(payment.Tenant, "Thadayo Brian Masika");
  assert.equal(payment.House, "7");
  assert.match(payment.Notes, /Auto-matched by house/);
  assert.equal(payment.SmsText, SAMPLE_SMS);
});

test("the same SMS forwarded twice is only counted once", () => {
  const api = setup();
  api.post({ message: SAMPLE_SMS }, { action: "incoming_sms", token: TOKEN });
  const second = api.post({ message: SAMPLE_SMS }, { action: "incoming_sms", token: TOKEN });
  assert.equal(second.success, true);
  assert.equal(second.data.duplicate, true);
  assert.equal(payments(api).length, 1);
  assert.equal(tenantIn(api, "7").AmountPaid, 8700);
});

test("webhook rejects a missing or wrong token and refuses when not set up", () => {
  const api = setup();
  assert.equal(api.get({ action: "incoming_sms", message: SAMPLE_SMS }).success, false);
  assert.equal(api.get({ action: "incoming_sms", message: SAMPLE_SMS, token: "wrong" }).success, false);
  assert.equal(payments(api).length, 0);

  const unconfigured = createBackend();
  const result = unconfigured.get({ action: "incoming_sms", message: SAMPLE_SMS, token: "" });
  assert.equal(result.success, false);
  assert.match(result.message, /setupSmsWebhook/);
});

test("accepts the payload shapes used by common forwarder apps", () => {
  const api = setup();
  // SMS Gateway for Android (sms-gate.app)
  let result = api.post({ event: "sms:received", payload: { message: SAMPLE_SMS, phoneNumber: "MPESA" } }, { action: "incoming_sms", token: TOKEN });
  assert.equal(result.data.matched, true);
  // SMS Forwarder style {from, text}, with a different code so it is not a duplicate
  result = api.post({ from: "MPESA", text: SAMPLE_SMS.replace("UJH7UAL03Q", "UJH7UAL04R").replace("275515 7", "275515 12") }, { action: "incoming_sms", token: TOKEN });
  assert.equal(result.data.matched, true);
  assert.equal(result.data.tenant, "Mary Wambui");
});

test("accepts the bare SMS text as a plain-text POST body (MacroDroid)", () => {
  const api = setup();
  const result = api.post(SAMPLE_SMS, { action: "incoming_sms", token: TOKEN });
  assert.equal(result.success, true, result.message);
  assert.equal(result.data.matched, true);
  assert.equal(result.data.house, "7");
});

test("non-payment SMS is ignored without an error", () => {
  const api = setup();
  const result = api.get({ action: "incoming_sms", token: TOKEN, message: "Your data bundle expires today." });
  assert.equal(result.success, true);
  assert.equal(result.data.ignored, true);
  assert.equal(payments(api).length, 0);
});

test("unknown house falls back to payer name, else saves as unmatched", () => {
  const api = setup();
  const byName = api.get({ action: "incoming_sms", token: TOKEN, message: SAMPLE_SMS.replace("275515 7", "275515 99") });
  assert.equal(byName.data.matched, true);
  assert.equal(byName.data.tenant, "Thadayo Brian Masika");

  const stranger = SAMPLE_SMS.replace("275515 7", "275515 99").replace("UJH7UAL03Q", "UJH7ZZZ99Z").replace("THADAYO BRIAN MASIKA", "PETER OTIENO");
  const unmatched = api.get({ action: "incoming_sms", token: TOKEN, message: stranger });
  assert.equal(unmatched.success, true);
  assert.equal(unmatched.data.matched, false);

  const list = api.get({ action: "getUnmatched" });
  assert.equal(list.success, true);
  assert.equal(list.data.length, 1);
  assert.equal(list.data[0].Tenant, "PETER OTIENO");
  assert.equal(list.data[0].Amount, 8700);
  assert.ok(list.data[0].rowIndex >= 2);
});

test("manual assignment credits the chosen tenant once", () => {
  const api = setup();
  const stranger = SAMPLE_SMS.replace("275515 7", "275515 99").replace("THADAYO BRIAN MASIKA", "PETER OTIENO");
  api.get({ action: "incoming_sms", token: TOKEN, message: stranger });
  const [item] = api.get({ action: "getUnmatched" }).data;
  const mary = tenantIn(api, "House 12");

  const assigned = api.get({ action: "manualAssign", rowIndex: item.rowIndex, tenantId: mary.ID });
  assert.equal(assigned.success, true, assigned.message);
  assert.equal(tenantIn(api, "House 12").AmountPaid, 8700);
  assert.equal(api.get({ action: "getUnmatched" }).data.length, 0);
  assert.equal(payments(api)[0].Tenant, "Mary Wambui");

  const again = api.get({ action: "manualAssign", rowIndex: item.rowIndex, tenantId: mary.ID });
  assert.equal(again.success, false);
  assert.equal(tenantIn(api, "House 12").AmountPaid, 8700);
});

test("manual payment updates balance and blocks an already-recorded M-Pesa code", () => {
  const api = setup();
  const mary = tenantIn(api, "House 12");
  const first = api.get({ action: "recordPayment", id: mary.ID, amount: "2000", method: "Cash", message: "" });
  assert.equal(first.success, true);
  assert.equal(tenantIn(api, "House 12").Balance, 4500);

  api.post({ message: SAMPLE_SMS }, { action: "incoming_sms", token: TOKEN });
  const duplicate = api.get({ action: "recordPayment", id: mary.ID, amount: "8700", method: "M-Pesa", message: "UJH7UAL03Q" });
  assert.equal(duplicate.success, false);
  assert.match(duplicate.message, /already recorded/);
  assert.equal(api.get({ action: "recordPayment", id: mary.ID, amount: "-5" }).success, false);
});

test("editing rent keeps the balance consistent", () => {
  const api = setup();
  const mary = tenantIn(api, "House 12");
  api.get({ action: "recordPayment", id: mary.ID, amount: "1500" });
  api.get({ action: "editTenant", id: mary.ID, rent: "7000" });
  const updated = tenantIn(api, "House 12");
  assert.equal(updated.Rent, 7000);
  assert.equal(updated.Balance, 5500);
});

test("bulk expenses sent over GET as a JSON payload are saved", () => {
  const api = setup();
  const bills = [1, 2, 3].map((house) => ({ date: "2026-10-01", category: "Utilities", desc: `Garbage House ${house}`, amount: 150, house }));
  const result = api.get({ payload: JSON.stringify({ action: "addBulkExpenses", data: bills }) });
  assert.equal(result.success, true, result.message);
  assert.equal(api.get({ action: "getExpenses" }).data.length, 3);
});

test("move out requires every given detail to match", () => {
  const api = setup();
  const wrong = api.get({ action: "moveOut", tenantName: "Mary Wambui", houseNumber: "7" });
  assert.equal(wrong.success, false);
  assert.equal(tenants(api).length, 2);

  const moved = api.get({ action: "moveOut", tenantName: "mary wambui", houseNumber: "12", reason: "Relocated", depositStatus: "Yes" });
  assert.equal(moved.success, true, moved.message);
  assert.equal(tenants(api).length, 1);

  const archived = api.get({ action: "getArchivedData" });
  assert.equal(archived.archives.length, 1);
  assert.equal(archived.archives[0].Name, "Mary Wambui");
  assert.ok(archived.archives[0].ArchivedDate);
  assert.ok(Array.isArray(archived.payments));
});

test("JSONP callback wraps responses for GET reads", () => {
  const api = setup();
  const output = api.rawGet({ action: "getTenants", callback: "cb_1" });
  assert.match(output.getContent(), /^cb_1\(\{.*\}\);$/s);
  const unsafe = api.rawGet({ action: "getTenants", callback: "alert(1)//" });
  assert.match(unsafe.getContent(), /^\{/);
});

test("utilities: monthly bills and meter readings", () => {
  const api = setup();
  assert.match(api.get({ action: "generateMonthlyUtilities" }).message, /Generated 2/);
  assert.match(api.get({ action: "generateMonthlyUtilities" }).message, /Generated 0/);
  assert.equal(api.get({ action: "addMeterReading", house: "7", currRead: "10" }).success, true);
  assert.equal(api.get({ action: "addMeterReading", house: "7", currRead: "5" }).success, false);
  const bill = api.get({ action: "getUtilityBills" }).data[0];
  assert.equal(bill.Water, 1200);
  assert.equal(api.get({ action: "payUtilityBill", id: bill.ID }).success, true);
});

test("setupSmsWebhook creates a token once and logs the URL", () => {
  const api = createBackend();
  const url = api.context.setupSmsWebhook();
  const token = api.properties.SMS_WEBHOOK_TOKEN;
  assert.ok(token && token.length >= 32);
  assert.ok(url.endsWith(`?action=incoming_sms&token=${token}`));
  assert.equal(api.context.setupSmsWebhook(), url);
  assert.notEqual(api.context.setupSmsWebhook(true), url);
  const before = api.properties.SMS_WEBHOOK_TOKEN;
  api.context.rotateSmsWebhookToken();
  assert.notEqual(api.properties.SMS_WEBHOOK_TOKEN, before);
});
