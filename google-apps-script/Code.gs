/*
 * RentPro backend for one property.
 * Paste this entire file into Google Apps Script, then deploy as a web app.
 */

var SHEET_TENANTS = "Tenants";
var SHEET_PAYMENTS = "Payments";
var SHEET_EXPENSES = "Expenses";
var SHEET_ARCHIVES = "Archives";
var SHEET_UTILITIES = "UtilityBills";
var SHEET_DELETED_PAYMENTS = "DeletedPayments";

// Cleared payments stay in DeletedPayments this long (about 3 months), then are removed for good.
var PAYMENT_RETENTION_DAYS = 90;
var PAYMENT_HEADERS = ["Date", "Amount", "Tenant", "Reference", "Method", "House", "Notes", "Payer", "SmsText", "ID"];
var PAYMENT_ID_COLUMN = 10;

var WATER_RATE = 120;
var GARBAGE_FEE = 150;

// Tenants pay with account "275515 <house>" (or "275515#<house>"); the prefix is stripped to find the house.
var PAYMENT_ACCOUNT_PREFIX = "275515";
// Script property holding the secret the SMS forwarder app must send as ?token=...
var SMS_TOKEN_PROPERTY = "SMS_WEBHOOK_TOKEN";

var READ_ACTIONS = {
  getTenants: true, getPayments: true, getExpenses: true, getUtilityBills: true,
  getArchivedData: true, getUnmatched: true, getDeletedPayments: true, aiAssist: true
};

function doGet(e) {
  var result = handleRequest(e);
  var callback = e && e.parameter ? String(e.parameter.callback || "") : "";
  if (!/^[A-Za-z_$][0-9A-Za-z_$]*$/.test(callback)) return result;

  return ContentService
    .createTextOutput(callback + "(" + result.getContent() + ");")
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function doPost(e) {
  return handleRequest(e);
}

function handleRequest(e) {
  var lock = null;
  try {
    var params = readRequest(e);
    var action = String(params.action || "");
    if (!action) return response(false, "No action provided");

    // Serialise writes so two payments arriving together cannot overwrite each other's balance.
    if (!READ_ACTIONS[action]) {
      lock = LockService.getScriptLock();
      lock.waitLock(20000);
    }
    initSheets();
    return routeAction(action, params);
  } catch (error) {
    return response(false, "Server Error: " + error.message);
  } finally {
    if (lock) lock.releaseLock();
  }
}

function routeAction(action, params) {
    switch (action) {
      case "getTenants": return getTenants();
      case "addTenant": return addTenant(params);
      case "setAllDueDates": return setAllDueDates(params);
      case "editTenant": return editTenant(params);
      case "updateTenant": return editTenant(params);
      case "addBulkTenants": return addBulkTenants(params);
      case "deleteTenant": return deleteTenant(params);
      case "deleteAllTenants": return deleteAllTenants();
      case "getPayments": return getPayments();
      case "addPayment": return addPayment(params);
      case "updatePayment": return updatePayment(params);
      case "recordPayment": return recordPayment(params);
      case "incoming_sms": return processIncomingPayment(params);
      case "stkPush": return handleStkPush(params);
      case "getExpenses": return getExpenses();
      case "addExpense": return addExpense(params);
      case "addBulkExpenses": return addBulkExpenses(params);
      case "deleteExpense": return deleteExpense(params);
      case "getUtilityBills": return getUtilityBills();
      case "generateMonthlyUtilities": return generateMonthlyUtilities();
      case "payUtilityBill": return payUtilityBill(params);
      case "addMeterReading": return addMeterReading(params);
      case "getArchivedData": return getArchivedData();
      case "deleteArchivedTenants": return deleteArchivedTenants(params);
      case "moveOut": return moveOut(params);
      case "getUnmatched": return getUnmatched();
      case "manualAssign": return manualAssign(params);
      case "deletePayments": return deletePayments(params);
      case "getDeletedPayments": return getDeletedPayments();
      case "restorePayments": return restorePayments(params);
      case "purgeDeletedPayments": return purgeDeletedPayments(params);
      case "aiAssist": return aiAssist(params);
      default: return response(false, "Unknown action: " + action);
    }
}

// Merges query-string parameters, an optional JSON "payload" parameter (used for
// nested data sent over GET) and a JSON POST body. Webhook apps POST a body
// without "action", so the action and token can live in the URL instead.
function readRequest(e) {
  var params = {};
  var query = (e && e.parameter) || {};
  Object.keys(query).forEach(function(key) { params[key] = query[key]; });

  if (typeof params.payload === "string" && params.payload) {
    var payload = JSON.parse(params.payload);
    delete params.payload;
    Object.keys(payload || {}).forEach(function(key) { params[key] = payload[key]; });
  }

  if (e && e.postData && e.postData.contents) {
    var body = null;
    try { body = JSON.parse(e.postData.contents); } catch (ignored) { body = null; }
    if (body && typeof body === "object") {
      Object.keys(body).forEach(function(key) { params[key] = body[key]; });
    } else if (!params.message && String(e.postData.type || "").indexOf("x-www-form-urlencoded") < 0) {
      // Automation apps such as MacroDroid can post the bare SMS text as the body.
      params.message = String(e.postData.contents);
    }
  }
  return params;
}

function response(success, message, data) {
  var result = {
    success: success,
    status: success ? "success" : "error",
    message: message || (success ? "OK" : "Request failed")
  };
  if (data !== undefined) result.data = data;
  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function sheet(name) {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
}

function rowsAsObjects(name) {
  var currentSheet = sheet(name);
  var values = currentSheet.getDataRange().getValues();
  if (values.length <= 1) return [];
  var headers = values[0];
  return values.slice(1).map(function(row) {
    var item = {};
    headers.forEach(function(header, index) {
      item[String(header)] = row[index];
    });
    return item;
  });
}

function value(data, names, fallback) {
  for (var i = 0; i < names.length; i++) {
    if (data[names[i]] !== undefined && data[names[i]] !== "") return data[names[i]];
  }
  return fallback;
}

function id(prefix) {
  return prefix + "-" + new Date().getTime() + "-" + Math.floor(Math.random() * 1000000);
}

function getTenants() {
  return response(true, "Tenants loaded", rowsAsObjects(SHEET_TENANTS));
}

function addTenant(data) {
  var currentSheet = sheet(SHEET_TENANTS);
  currentSheet.appendRow([
    id("T"),
    value(data, ["uid"], ""),
    value(data, ["name", "Name"], ""),
    textValue(value(data, ["phone", "Phone"], "")),
    textValue(value(data, ["natID", "NationalID"], "")),
    value(data, ["house", "House"], ""),
    Number(value(data, ["rent", "Rent"], 0)),
    value(data, ["date", "DueDate"], 15),
    new Date(),
    0,
    Number(value(data, ["rent", "Rent"], 0)),
    "Main Property",
    textValue(value(data, ["nextOfKin", "NextOfKin"], "")),
    textValue(value(data, ["kinRelation", "KinRelation", "Relation"], "")),
    textValue(value(data, ["nextOfKinPhone", "NextOfKinPhone"], ""))
  ]);
  return response(true, "Tenant added");
}

function editTenant(data) {
  var currentSheet = sheet(SHEET_TENANTS);
  var values = currentSheet.getDataRange().getValues();
  var tenantId = value(data, ["id", "ID"], "");

  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]) === String(tenantId)) {
      currentSheet.getRange(i + 1, 3, 1, 5).setValues([[
        value(data, ["name", "Name"], values[i][2]),
        textValue(value(data, ["phone", "Phone"], values[i][3])),
        textValue(value(data, ["natID", "NationalID"], values[i][4])),
        value(data, ["house", "House"], values[i][5]),
        Number(value(data, ["rent", "Rent"], values[i][6]))
      ]]);
      // Keep the stored balance consistent with a changed rent.
      var newRent = Number(value(data, ["rent", "Rent"], values[i][6]));
      currentSheet.getRange(i + 1, 11).setValue(newRent - (Number(values[i][9]) || 0));
      currentSheet.getRange(i + 1, 13, 1, 3).setValues([[
        textValue(value(data, ["nextOfKin", "NextOfKin"], values[i][12] || "")),
        textValue(value(data, ["kinRelation", "KinRelation", "Relation"], values[i][13] || "")),
        textValue(value(data, ["nextOfKinPhone", "NextOfKinPhone"], values[i][14] || ""))
      ]]);
      return response(true, "Tenant updated");
    }
  }
  return response(false, "Tenant ID not found");
}

function addBulkTenants(data) {
  var incoming = data.data || [];
  if (!incoming.length) return response(true, "No tenants to import");
  var currentSheet = sheet(SHEET_TENANTS);
  var output = incoming.map(function(item) {
    return [
      id("T"), value(item, ["uid"], ""), value(item, ["name", "Name"], ""),
      textValue(value(item, ["phone", "Phone"], "")), textValue(value(item, ["natID", "NationalID"], "")),
      value(item, ["house", "House"], ""), Number(value(item, ["rent", "Rent"], 0)), 15,
      new Date(), 0, Number(value(item, ["rent", "Rent"], 0)), "Main Property",
      textValue(value(item, ["nextOfKin", "NextOfKin"], "")),
      textValue(value(item, ["kinRelation", "KinRelation", "Relation"], "")),
      textValue(value(item, ["nextOfKinPhone", "NextOfKinPhone"], ""))
    ];
  });
  currentSheet.getRange(currentSheet.getLastRow() + 1, 1, output.length, output[0].length).setValues(output);
  return response(true, "Imported " + output.length + " tenants");
}

function deleteTenant(data) {
  var currentSheet = sheet(SHEET_TENANTS);
  var values = currentSheet.getDataRange().getValues();
  var tenantId = value(data, ["id", "ID"], "");

  for (var i = values.length - 1; i >= 1; i--) {
    if (String(values[i][0]) === String(tenantId)) {
      currentSheet.deleteRow(i + 1);
      return response(true, "Tenant permanently deleted");
    }
  }
  return response(false, "Tenant ID not found");
}

function setAllDueDates(data) {
  var currentSheet = sheet(SHEET_TENANTS);
  var lastRow = currentSheet.getLastRow();
  var dueDate = Number(value(data || {}, ["date", "DueDate"], 15));
  if (!dueDate || dueDate < 1 || dueDate > 31) return response(false, "Due date must be between 1 and 31");
  if (lastRow <= 1) return response(true, "No tenants to update", { updated: 0, dueDate: dueDate });

  var dueDates = Array(lastRow - 1).fill([dueDate]);
  currentSheet.getRange(2, 8, lastRow - 1, 1).setValues(dueDates);
  return response(true, "All tenant due dates updated", { updated: lastRow - 1, dueDate: dueDate });
}

function deleteAllTenants() {
  var currentSheet = sheet(SHEET_TENANTS);
  var lastRow = currentSheet.getLastRow();
  if (lastRow <= 1) return response(true, "No tenants to delete", { deleted: 0 });

  var deleted = lastRow - 1;
  currentSheet.deleteRows(2, deleted);
  return response(true, "All tenants permanently deleted", { deleted: deleted });
}

function getPayments() {
  maintainPayments();
  return response(true, "Payments loaded", rowsAsObjects(SHEET_PAYMENTS));
}

// Appends a payment row, padded to the full width, with a fresh ID in the last column.
function appendPayment(values) {
  var row = values.slice(0, PAYMENT_ID_COLUMN - 1);
  while (row.length < PAYMENT_ID_COLUMN - 1) row.push("");
  row.push(id("PAY"));
  sheet(SHEET_PAYMENTS).appendRow(row);
}

/* ---------- Payment history: clear, restore, and the 3-month bin ---------- */

// Housekeeping run when payments are read: give older rows an ID and drop bin entries past retention.
// Reads skip the script lock, so this only runs when the lock is free right now.
function maintainPayments() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(0)) return;
  try {
    ensurePaymentIds();
    purgeExpiredPayments();
  } finally {
    lock.releaseLock();
  }
}

function ensurePaymentIds() {
  var paymentSheet = sheet(SHEET_PAYMENTS);
  var lastRow = paymentSheet.getLastRow();
  if (lastRow <= 1) return;
  var ids = paymentSheet.getRange(2, PAYMENT_ID_COLUMN, lastRow - 1, 1).getValues();
  var changed = false;
  ids.forEach(function(cell) {
    if (!String(cell[0]).trim()) { cell[0] = id("PAY"); changed = true; }
  });
  if (changed) paymentSheet.getRange(2, PAYMENT_ID_COLUMN, ids.length, 1).setValues(ids);
}

// All data rows of a sheet, each padded to the given width.
function dataRows(name, width) {
  var currentSheet = sheet(name);
  var lastRow = currentSheet.getLastRow();
  if (lastRow <= 1) return [];
  return currentSheet.getRange(2, 1, lastRow - 1, width).getValues();
}

// Replaces a sheet's data rows in one write (much faster than deleting rows one by one).
function replaceRows(name, rows, width) {
  var currentSheet = sheet(name);
  var lastRow = currentSheet.getLastRow();
  if (lastRow > 1) currentSheet.getRange(2, 1, lastRow - 1, width).clearContent();
  if (rows.length) currentSheet.getRange(2, 1, rows.length, width).setValues(rows);
}

function idSet(data) {
  var wanted = {};
  String(value(data || {}, ["ids"], "")).split(",").forEach(function(item) {
    var trimmed = item.trim();
    if (trimmed) wanted[trimmed] = true;
  });
  return wanted;
}

// Moves the selected payments to the bin. Tenant balances are not changed: this only tidies the history.
function deletePayments(data) {
  var wanted = idSet(data);
  if (!Object.keys(wanted).length) return response(false, "No payments selected");
  ensurePaymentIds();

  var width = PAYMENT_HEADERS.length;
  var kept = [];
  var moved = [];
  var now = new Date();
  dataRows(SHEET_PAYMENTS, width).forEach(function(row) {
    if (wanted[String(row[PAYMENT_ID_COLUMN - 1])]) moved.push(row.concat([now]));
    else kept.push(row);
  });
  if (!moved.length) return response(false, "Those payments were not found. Refresh and try again.");

  var bin = sheet(SHEET_DELETED_PAYMENTS);
  bin.getRange(bin.getLastRow() + 1, 1, moved.length, width + 1).setValues(moved);
  replaceRows(SHEET_PAYMENTS, kept, width);
  return response(true, moved.length + " payment" + (moved.length === 1 ? "" : "s") + " moved to Recently deleted", { deleted: moved.length });
}

function getDeletedPayments() {
  maintainPayments();
  var dayMs = 24 * 60 * 60 * 1000;
  var items = rowsAsObjects(SHEET_DELETED_PAYMENTS).map(function(item) {
    var deletedAt = new Date(item.DeletedAt);
    var purgeOn = new Date(deletedAt.getTime() + PAYMENT_RETENTION_DAYS * dayMs);
    item.PurgeOn = purgeOn;
    item.DaysLeft = Math.max(0, Math.ceil((purgeOn.getTime() - Date.now()) / dayMs));
    return item;
  });
  return response(true, "Deleted payments loaded", items);
}

function restorePayments(data) {
  var wanted = idSet(data);
  if (!Object.keys(wanted).length) return response(false, "No payments selected");
  var width = PAYMENT_HEADERS.length;
  var kept = [];
  var restored = [];
  dataRows(SHEET_DELETED_PAYMENTS, width + 1).forEach(function(row) {
    if (wanted[String(row[PAYMENT_ID_COLUMN - 1])]) restored.push(row.slice(0, width));
    else kept.push(row);
  });
  if (!restored.length) return response(false, "Those payments were not found in Recently deleted");

  var paymentSheet = sheet(SHEET_PAYMENTS);
  paymentSheet.getRange(paymentSheet.getLastRow() + 1, 1, restored.length, width).setValues(restored);
  replaceRows(SHEET_DELETED_PAYMENTS, kept, width + 1);
  return response(true, restored.length + " payment" + (restored.length === 1 ? "" : "s") + " restored", { restored: restored.length });
}

// Permanently removes the selected bin entries now instead of waiting for the 3 months.
function purgeDeletedPayments(data) {
  var wanted = idSet(data);
  if (!Object.keys(wanted).length) return response(false, "No payments selected");
  var width = PAYMENT_HEADERS.length + 1;
  var rows = dataRows(SHEET_DELETED_PAYMENTS, width);
  var kept = rows.filter(function(row) { return !wanted[String(row[PAYMENT_ID_COLUMN - 1])]; });
  var removed = rows.length - kept.length;
  if (!removed) return response(false, "Those payments were not found in Recently deleted");
  replaceRows(SHEET_DELETED_PAYMENTS, kept, width);
  return response(true, removed + " payment" + (removed === 1 ? "" : "s") + " permanently deleted", { purged: removed });
}

function purgeExpiredPayments() {
  var width = PAYMENT_HEADERS.length + 1;
  var rows = dataRows(SHEET_DELETED_PAYMENTS, width);
  if (!rows.length) return 0;
  var cutoff = Date.now() - PAYMENT_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  var kept = rows.filter(function(row) {
    var deletedAt = new Date(row[width - 1]).getTime();
    return isNaN(deletedAt) || deletedAt > cutoff;
  });
  if (kept.length !== rows.length) replaceRows(SHEET_DELETED_PAYMENTS, kept, width);
  return rows.length - kept.length;
}

function recordPayment(data) {
  var tenantId = value(data, ["id", "tenantId"], "");
  var amount = Number(value(data, ["amount"], 0));
  var reference = String(value(data, ["message", "reference"], "")).trim();

  if (!amount || amount < 0) return response(false, "Invalid payment amount");
  var mpesaCode = findMpesaCode(reference);
  if (mpesaCode && paymentReferenceExists(mpesaCode)) {
    return response(false, "Payment " + mpesaCode + " is already recorded");
  }

  var tenant = creditTenant(function(row) { return String(row[0]) === String(tenantId); }, amount);
  if (!tenant) return response(false, "Tenant not found");
  appendPayment([
    new Date(), amount, tenant.name, reference,
    value(data, ["method"], "Manual"), tenant.house, "Manual"
  ]);
  return response(true, "Payment recorded");
}

// Adds a payment to the first tenant whose row satisfies matches(row).
// Balance stays Rent - AmountPaid, as everywhere else in the app.
function creditTenant(matches, amount) {
  var currentSheet = sheet(SHEET_TENANTS);
  var values = currentSheet.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (matches(values[i])) {
      var paid = (Number(values[i][9]) || 0) + amount;
      var balance = (Number(values[i][6]) || 0) - paid;
      currentSheet.getRange(i + 1, 10, 1, 2).setValues([[paid, balance]]);
      return { id: values[i][0], name: values[i][2], house: values[i][5], balance: balance };
    }
  }
  return null;
}

// M-Pesa transaction codes are 10 characters mixing letters and digits, e.g. UJH7UAL03Q.
function findMpesaCode(text) {
  var words = String(text || "").toUpperCase().match(/\b[A-Z0-9]{10}\b/g) || [];
  for (var i = 0; i < words.length; i++) {
    if (/[A-Z]/.test(words[i]) && /\d/.test(words[i])) return words[i];
  }
  return "";
}

// True when any payment's Reference contains this code (manual entries may hold the full SMS).
// Cleared payments still count, so a re-sent SMS for a payment in the bin is not credited twice.
function paymentReferenceExists(reference) {
  var wanted = String(reference || "").trim().toUpperCase();
  if (!wanted) return false;
  return [SHEET_PAYMENTS, SHEET_DELETED_PAYMENTS].some(function(name) {
    var values = sheet(name).getDataRange().getValues();
    for (var i = 1; i < values.length; i++) {
      if (String(values[i][3]).toUpperCase().indexOf(wanted) >= 0) return true;
    }
    return false;
  });
}

function addPayment(data) {
  var payment = data.payment || data;
  appendPayment([
    value(payment, ["date", "Date"], new Date()), Number(value(payment, ["amount", "Amount"], 0)),
    value(payment, ["tenant", "Tenant", "tenantName"], ""), value(payment, ["reference", "Reference"], ""),
    value(payment, ["method", "Method"], "Manual"), value(payment, ["house", "House"], ""), "Manual"
  ]);
  return response(true, "Payment added");
}

function updatePayment(data) {
  return response(false, "Payment editing is not supported by this backend");
}

function getExpenses() {
  return response(true, "Expenses loaded", rowsAsObjects(SHEET_EXPENSES));
}

function addExpense(data) {
  sheet(SHEET_EXPENSES).appendRow([
    id("EXP"), value(data, ["uid"], ""), value(data, ["date", "Date"], new Date()),
    value(data, ["category", "Category"], "Other"), value(data, ["desc", "Description"], ""),
    Number(value(data, ["amount", "Amount"], 0)), value(data, ["house", "House"], "General")
  ]);
  return response(true, "Expense saved");
}

function addBulkExpenses(data) {
  var incoming = data.data || [];
  if (!incoming.length) return response(true, "No expenses to add");
  var output = incoming.map(function(item) {
    return [
      id("EXP"), value(item, ["uid"], ""), value(item, ["date", "Date"], new Date()),
      value(item, ["category", "Category"], "Other"), value(item, ["desc", "Description"], ""),
      Number(value(item, ["amount", "Amount"], 0)), value(item, ["house", "House"], "General")
    ];
  });
  var currentSheet = sheet(SHEET_EXPENSES);
  currentSheet.getRange(currentSheet.getLastRow() + 1, 1, output.length, output[0].length).setValues(output);
  return response(true, "Expenses added");
}

function deleteExpense(data) {
  var currentSheet = sheet(SHEET_EXPENSES);
  var values = currentSheet.getDataRange().getValues();
  var expenseId = value(data, ["id", "ID"], "");
  for (var i = values.length - 1; i >= 1; i--) {
    if (String(values[i][0]) === String(expenseId)) {
      currentSheet.deleteRow(i + 1);
      return response(true, "Expense deleted");
    }
  }
  return response(false, "Expense ID not found");
}

function getUtilityBills() {
  var bills = rowsAsObjects(SHEET_UTILITIES);
  bills.reverse();
  return response(true, "Utility bills loaded", bills);
}

function generateMonthlyUtilities() {
  var tenantRows = rowsAsObjects(SHEET_TENANTS);
  var utilitySheet = sheet(SHEET_UTILITIES);
  var month = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "MMM yyyy");
  var existing = rowsAsObjects(SHEET_UTILITIES);
  var output = [];
  var billedHouses = {};

  existing.forEach(function(bill) {
    if (String(bill.Month) === month) billedHouses[String(bill.House)] = true;
  });

  tenantRows.forEach(function(tenant) {
    var house = String(tenant.House || "").trim();
    if (house && !billedHouses[house]) {
      output.push([id("UTIL"), month, tenant.House, tenant.Name, WATER_RATE, GARBAGE_FEE, "Unpaid", "", "", "", 0]);
      billedHouses[house] = true;
    }
  });

  if (output.length) {
    utilitySheet.getRange(utilitySheet.getLastRow() + 1, 1, output.length, output[0].length).setValues(output);
  }
  return response(true, "Generated " + output.length + " utility bills");
}

function payUtilityBill(data) {
  var currentSheet = sheet(SHEET_UTILITIES);
  var values = currentSheet.getDataRange().getValues();
  var billId = value(data, ["id", "ID"], "");
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]) === String(billId)) {
      currentSheet.getRange(i + 1, 7).setValue("Paid");
      currentSheet.getRange(i + 1, 8).setValue(new Date());
      return response(true, "Utility bill paid");
    }
  }
  return response(false, "Utility bill not found");
}

function addMeterReading(data) {
  var house = String(value(data, ["house"], "")).trim();
  var previous = latestReadingForHouse(house);
  var current = Number(value(data, ["currRead"], 0));
  if (!house) return response(false, "House is required");
  if (current < previous) return response(false, "Current reading cannot be below the previous reading");
  var units = Math.max(0, current - previous);
  var water = units * Number(value(data, ["waterRate"], WATER_RATE));
  sheet(SHEET_UTILITIES).appendRow([
    id("UTIL"), Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "MMM yyyy"),
    house, value(data, ["tenantName"], ""), water,
    Number(value(data, ["garbageFee"], GARBAGE_FEE)), "Unpaid", "", previous, current, units
  ]);
  return response(true, "Meter reading saved");
}

function latestReadingForHouse(house) {
  if (!house) return 0;
  var readings = rowsAsObjects(SHEET_UTILITIES).filter(function(item) {
    return String(item.House || "").trim() === house && item.CurrRead !== "" && item.CurrRead !== undefined;
  });
  if (!readings.length) return 0;
  readings.sort(function(a, b) { return String(b.ID).localeCompare(String(a.ID)); });
  return Number(readings[0].CurrRead) || 0;
}

function archiveTenantRow(row, reason, depositStatus) {
  var archiveRow = row.slice(0, 15);
  while (archiveRow.length < 15) archiveRow.push("");
  archiveRow.push(reason || "", depositStatus || "", new Date());
  sheet(SHEET_ARCHIVES).appendRow(archiveRow);
}

function getArchivedData() {
  var currentSheet = sheet(SHEET_ARCHIVES);
  var values = currentSheet.getDataRange().getValues();
  if (values.length <= 1) return archiveResponse([]);
  var headers = values[0];
  var archived = values.slice(1).map(function(row) {
    var item = {};
    headers.forEach(function(header, index) { item[String(header)] = row[index]; });
    return item;
  });
  return archiveResponse(archived);
}

function deleteArchivedTenants(data) {
  var currentSheet = sheet(SHEET_ARCHIVES);
  var requestedIds = String(value(data || {}, ["ids"], "")).split(",").filter(Boolean);
  if (!requestedIds.length) return response(false, "No archived tenants selected");

  var wanted = {};
  requestedIds.forEach(function(tenantId) { wanted[String(tenantId)] = true; });
  var values = currentSheet.getDataRange().getValues();
  var deleted = 0;
  for (var i = values.length - 1; i >= 1; i--) {
    if (wanted[String(values[i][0])]) {
      currentSheet.deleteRow(i + 1);
      deleted++;
    }
  }
  return response(true, "Archived tenants permanently deleted", { deleted: deleted });
}

function archiveResponse(archives) {
  // Payments are included so the archive page can show a former tenant's history.
  return ContentService
    .createTextOutput(JSON.stringify({ success: true, status: "success", archives: archives, payments: rowsAsObjects(SHEET_PAYMENTS) }))
    .setMimeType(ContentService.MimeType.JSON);
}

function moveOut(data) {
  var tenants = sheet(SHEET_TENANTS);
  var values = tenants.getDataRange().getValues();
  var tenantId = String(value(data, ["id", "tenantId"], ""));
  var name = String(value(data, ["tenantName"], "")).trim().toLowerCase();
  var house = String(value(data, ["houseNumber"], "")).trim();
  if (!tenantId && !name && !house) return response(false, "Enter the tenant name or house number");

  // Every detail given must match, so a typo cannot archive a different tenant.
  for (var i = values.length - 1; i >= 1; i--) {
    var matches = tenantId
      ? String(values[i][0]) === tenantId
      : (!name || String(values[i][2]).trim().toLowerCase() === name) &&
        (!house || normalizeHouse(values[i][5]) === normalizeHouse(house));
    if (matches) {
      archiveTenantRow(values[i], value(data, ["reason"], "Move out"), value(data, ["depositStatus"], ""));
      tenants.deleteRow(i + 1);
      return response(true, values[i][2] + " archived successfully");
    }
  }
  return response(false, "No tenant matches those details");
}

function getUnmatched() {
  var values = sheet(SHEET_PAYMENTS).getDataRange().getValues();
  var headers = values[0] || [];
  var unmatched = [];
  for (var i = 1; i < values.length; i++) {
    var notes = String(values[i][6] || "").toLowerCase();
    if (notes.indexOf("unmatched") < 0 && notes.indexOf("unassigned") < 0) continue;
    var item = { rowIndex: i + 1 };
    headers.forEach(function(header, index) { item[String(header)] = values[i][index]; });
    unmatched.push(item);
  }
  return response(true, "Unmatched payments loaded", unmatched);
}

function manualAssign(data) {
  var currentSheet = sheet(SHEET_PAYMENTS);
  var rowNumber = Number(value(data, ["rowIndex"], 0));
  // Prefer the payment ID: row numbers shift when payments are cleared.
  var paymentId = String(value(data, ["paymentId"], ""));
  if (paymentId) {
    var paymentIds = currentSheet.getLastRow() > 1 ? currentSheet.getRange(2, PAYMENT_ID_COLUMN, currentSheet.getLastRow() - 1, 1).getValues() : [];
    rowNumber = 0;
    for (var p = 0; p < paymentIds.length; p++) {
      if (String(paymentIds[p][0]) === paymentId) { rowNumber = p + 2; break; }
    }
  }
  var tenantId = String(value(data, ["tenantId", "id"], ""));
  var house = String(value(data, ["houseNumber"], ""));
  if (!rowNumber || rowNumber < 2 || rowNumber > currentSheet.getLastRow()) return response(false, "Payment row not found");

  var row = currentSheet.getRange(rowNumber, 1, 1, 7).getValues()[0];
  if (String(row[6]).toLowerCase().indexOf("unmatched") < 0 && String(row[6]).toLowerCase().indexOf("unassigned") < 0) {
    return response(false, "This payment has already been assigned");
  }
  var amount = Number(row[1]) || 0;
  var tenant = creditTenant(function(tenantRow) {
    return tenantId ? String(tenantRow[0]) === tenantId : normalizeHouse(tenantRow[5]) === normalizeHouse(house);
  }, amount);
  if (!tenant) return response(false, "Tenant not found");

  currentSheet.getRange(rowNumber, 3).setValue(tenant.name);
  currentSheet.getRange(rowNumber, 6).setValue(tenant.house);
  currentSheet.getRange(rowNumber, 7).setValue("Assigned manually");
  return response(true, "Payment assigned to " + tenant.name);
}

/*
 * SMS payment listener. An SMS forwarder app on the landlord's Android phone posts
 * every payment SMS here: <web app url>?action=incoming_sms&token=<SMS_WEBHOOK_TOKEN>
 * The message text is parsed, matched to a tenant by the house in the account
 * reference (falling back to the payer's name), and credited to that tenant.
 * Payments that cannot be matched are saved as "Unmatched" for reconcile.html.
 */
function processIncomingPayment(data) {
  var expectedToken = PropertiesService.getScriptProperties().getProperty(SMS_TOKEN_PROPERTY);
  if (!expectedToken) return response(false, "SMS webhook is not set up. Run setupSmsWebhook() in Apps Script first.");
  if (String(value(data, ["token"], "")) !== expectedToken) return response(false, "Invalid SMS webhook token");

  var text = smsText(data);
  var parsed = parsePaymentSms(text);
  // Older forwarders may send the fields separately instead of the raw SMS.
  if (!parsed.amount) parsed.amount = Number(String(value(data, ["amount"], 0)).replace(/,/g, "")) || 0;
  if (!parsed.reference) parsed.reference = findMpesaCode(value(data, ["reference"], ""));
  if (!parsed.payer) parsed.payer = String(value(data, ["tenant", "payer"], "")).trim();

  if (!parsed.amount || !parsed.reference) {
    // Answer with success so the forwarder does not retry a message that is not a payment.
    return response(true, "Ignored: not a payment SMS", { ignored: true });
  }
  if (paymentReferenceExists(parsed.reference)) {
    return response(true, "Duplicate: payment " + parsed.reference + " is already recorded", { duplicate: true, reference: parsed.reference });
  }

  var match = findTenantForPayment(parsed);
  var tenant = null;
  if (match) {
    tenant = creditTenant(function(row) { return String(row[0]) === String(match.id); }, parsed.amount);
  }

  appendPayment([
    parsed.date || new Date(),
    parsed.amount,
    tenant ? tenant.name : parsed.payer,
    parsed.reference,
    "M-Pesa (SMS)",
    tenant ? tenant.house : parsed.house,
    tenant ? "Auto-matched by " + match.by : "Unmatched",
    parsed.payer,
    text
  ]);

  return response(true, tenant ? "Payment credited to " + tenant.name : "Payment saved as unmatched", {
    reference: parsed.reference,
    amount: parsed.amount,
    house: parsed.house,
    payer: parsed.payer,
    matched: !!tenant,
    tenant: tenant ? tenant.name : "",
    balance: tenant ? tenant.balance : null
  });
}

// Forwarder apps name the message field differently; accept the common shapes.
function smsText(data) {
  var nested = data.payload && typeof data.payload === "object" ? data.payload : {};
  var text = value(data, ["message", "text", "msg", "body", "sms", "content"], "") || value(nested, ["message", "text", "body"], "");
  return String(text || "").replace(/\s+/g, " ").trim();
}

/*
 * Reads an M-Pesa payment notification. Supported formats include:
 *   Confirmed. KES. 8,700.00 to NANCYWANJIRUNGARI A/C Ref. No. 275515 7 Via MPESA Ref UJH7UAL03Q
 *   by THADAYO BRIAN MASIKA on 17-10-2026 at 15:38.Thank you.
 *   UJH7UAL03Q Confirmed. You have received Ksh8,700.00 from JOHN DOE 0712345678 on 17/10/26 at 3:38 PM ...
 */
function parsePaymentSms(text) {
  var message = String(text || "").replace(/\s+/g, " ").trim();
  var result = { amount: 0, reference: "", account: "", house: "", payer: "", phone: "", date: null };
  if (!message) return result;

  var amount = message.match(/(?:KES|KSH)\.?\s*([\d,]+(?:\.\d{1,2})?)/i);
  if (amount) result.amount = Number(amount[1].replace(/,/g, "")) || 0;

  var reference = message.match(/MPESA\s+Ref\.?\s*(?:No\.?\s*)?([A-Z0-9]{10})\b/i) ||
    message.match(/^([A-Z0-9]{10})\s+Confirmed/i);
  result.reference = reference ? reference[1].toUpperCase() : findMpesaCode(message);

  var account = message.match(/A\/C\s*(?:Ref\.?\s*)?(?:No\.?\s*)?[:.]?\s*(.+?)\s+Via\b/i) ||
    message.match(/for account\s+(.+?)(?:\s+on\s+\d|\.\s|$)/i) ||
    message.match(/Account(?:\s+(?:Number|No\.?))?\s*[:.]?\s*([A-Z0-9#\- ]+?)(?:\s+(?:on|by|from)\b|\.\s|$)/i);
  if (account) {
    result.account = account[1].trim();
    result.house = houseFromAccount(result.account);
  }

  var payer = message.match(/\bby\s+(.+?)\s+on\s+\d/i) ||
    message.match(/\bfrom\s+(.+?)\s+(?:\+?254|0)?[17]\d{8}\b/i) ||
    message.match(/\bfrom\s+(.+?)\s+on\s+\d/i);
  if (payer) result.payer = payer[1].replace(/[.,]+$/, "").trim();

  var phone = message.match(/(?:\+?254|\b0)([17]\d{8})\b/);
  if (phone) result.phone = "0" + phone[1];

  var when = message.match(/\bon\s+(\d{1,2})[-\/](\d{1,2})[-\/](\d{2,4})(?:\s+at\s+(\d{1,2}):(\d{2})\s*(AM|PM)?)?/i);
  if (when) {
    var year = Number(when[3]);
    if (year < 100) year += 2000;
    var hour = Number(when[4] || 0);
    if (when[6] && /pm/i.test(when[6]) && hour < 12) hour += 12;
    if (when[6] && /am/i.test(when[6]) && hour === 12) hour = 0;
    var parsedDate = new Date(year, Number(when[2]) - 1, Number(when[1]), hour, Number(when[5] || 0));
    if (!isNaN(parsedDate.getTime())) result.date = parsedDate;
  }
  return result;
}

// "275515 7", "275515#7" and "275515-A4" all become the house after the prefix.
function houseFromAccount(account) {
  var cleaned = String(account || "").trim();
  if (cleaned.indexOf(PAYMENT_ACCOUNT_PREFIX) === 0) cleaned = cleaned.slice(PAYMENT_ACCOUNT_PREFIX.length);
  return cleaned.replace(/^[\s#\-_.:\/]+/, "").replace(/^(house|hse|hs)\s*/i, "").trim();
}

// Lets "House 07", "7" and "h-7" compare equal.
function normalizeHouse(house) {
  return String(house || "").toLowerCase()
    .replace(/\b(house|hse|hs|no)\b\.?/g, "")
    .replace(/[^a-z0-9]/g, "")
    .replace(/^0+(?=\d)/, "");
}

function findTenantForPayment(parsed) {
  var tenants = sheet(SHEET_TENANTS).getDataRange().getValues().slice(1);
  var house = normalizeHouse(parsed.house);
  if (house) {
    var byHouse = tenants.filter(function(row) { return normalizeHouse(row[5]) === house; });
    if (byHouse.length === 1) return { id: byHouse[0][0], by: "house " + parsed.house };
  }

  var phone = String(parsed.phone || "").replace(/\D/g, "").slice(-9);
  if (phone) {
    var byPhone = tenants.filter(function(row) { return String(row[3]).replace(/\D/g, "").slice(-9) === phone; });
    if (byPhone.length === 1) return { id: byPhone[0][0], by: "phone" };
  }

  // Name fallback only when every word of exactly one tenant's name appears in the payer's name.
  var payerWords = nameWords(parsed.payer);
  if (payerWords.length) {
    var byName = tenants.filter(function(row) {
      var words = nameWords(row[2]);
      return words.length >= 2 && words.every(function(word) { return payerWords.indexOf(word) >= 0; });
    });
    if (byName.length === 1) return { id: byName[0][0], by: "name" };
  }
  return null;
}

function nameWords(name) {
  return String(name || "").toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter(function(word) { return word.length > 1; });
}

/*
 * Run this once from the Apps Script editor (select it and click Run). It creates the
 * secret token and logs the exact URL to paste into the SMS forwarder app.
 * Run it again with regenerate=true only if the URL leaks; then update the phone.
 */
function setupSmsWebhook(regenerate) {
  var properties = PropertiesService.getScriptProperties();
  var token = properties.getProperty(SMS_TOKEN_PROPERTY);
  if (!token || regenerate === true) {
    token = Utilities.getUuid().replace(/-/g, "");
    properties.setProperty(SMS_TOKEN_PROPERTY, token);
  }
  var url = ScriptApp.getService().getUrl() + "?action=incoming_sms&token=" + token;
  Logger.log("Paste this webhook URL into the SMS forwarder app: " + url);
  return url;
}

// Run from the editor if the webhook URL leaks. The phone app must then get the new URL.
function rotateSmsWebhookToken() {
  return setupSmsWebhook(true);
}

function handleStkPush(data) {
  return response(false, "STK Push is not configured. Add your payment provider credentials before enabling it.");
}

function textValue(input) {
  return input === "" || input === null || input === undefined ? "" : "'" + String(input);
}

function initSheets() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var definitions = [
    { name: SHEET_TENANTS, headers: ["ID", "UID", "Name", "Phone", "NationalID", "House", "Rent", "DueDate", "DateAdded", "AmountPaid", "Balance", "Property", "NextOfKin", "KinRelation", "NextOfKinPhone"] },
    { name: SHEET_PAYMENTS, headers: PAYMENT_HEADERS },
    { name: SHEET_DELETED_PAYMENTS, headers: PAYMENT_HEADERS.concat(["DeletedAt"]) },
    { name: SHEET_EXPENSES, headers: ["ID", "UID", "Date", "Category", "Description", "Amount", "House"] },
    { name: SHEET_ARCHIVES, headers: ["ID", "UID", "Name", "Phone", "NationalID", "House", "Rent", "DueDate", "DateAdded", "AmountPaid", "Balance", "Property", "NextOfKin", "KinRelation", "NextOfKinPhone", "MoveOutReason", "DepositStatus", "ArchivedDate"] },
    { name: SHEET_UTILITIES, headers: ["ID", "Month", "House", "TenantName", "Water", "Garbage", "Status", "DatePaid", "PrevRead", "CurrRead", "UnitsUsed"] }
  ];

  definitions.forEach(function(definition) {
    var currentSheet = spreadsheet.getSheetByName(definition.name);
    if (!currentSheet) {
      currentSheet = spreadsheet.insertSheet(definition.name);
      currentSheet.getRange(1, 1, 1, definition.headers.length).setValues([definition.headers]);
    } else if (currentSheet.getLastRow() === 0) {
      currentSheet.getRange(1, 1, 1, definition.headers.length).setValues([definition.headers]);
    } else if (currentSheet.getLastColumn() < definition.headers.length) {
      var missingHeaders = definition.headers.slice(currentSheet.getLastColumn());
      currentSheet.getRange(1, currentSheet.getLastColumn() + 1, 1, missingHeaders.length).setValues([missingHeaders]);
    }
  });
}

/* ---------- AI assistant ----------
 * Free by default: the built-in assistant (freeAssistant, below) answers from the sheet data with no API key.
 * Optional upgrades, in Apps Script → Project Settings → Script properties, for free-form questions:
 *   GEMINI_API_KEY    - Google Gemini (free tier from aistudio.google.com)
 *   ANTHROPIC_API_KEY - Claude (paid; used instead of Gemini when both are set)
 * Keys stay on Google's side; the website and app never see them. If the model fails, the free assistant answers.
 * Tenant phone numbers, ID numbers and raw SMS text are never sent to the model.
 *
 * Modes:
 *   ask          - answer a question; tailored to the page the landlord is on (data.page)
 *   insights     - short briefing for the dashboard
 *   reminder     - one SMS rent reminder (English or Kiswahili)
 *   matchSuggest - structured: likely tenant for each unmatched payment
 *   categorize   - structured: expense category for a description
 */
var AI_MODEL = "claude-opus-5-5";
var EXPENSE_CATEGORIES = ["Maintenance", "Utilities", "Cleaning", "Tax", "Salary", "Other"];

// What the assistant should focus on, per RentPro page.
var AI_PAGE_GUIDES = {
  dashboard: "The landlord is on the Dashboard. Focus on the overall picture: this month's collection against expected rent, who is behind, unmatched payments and the most useful next steps.",
  tenants: "The landlord is on the Tenants list. Focus on tenants: who is behind and by how much, who is paid up, missing next-of-kin details, and drafting messages to groups of tenants.",
  "tenant-profile": "The landlord is looking at one tenant (focusTenant in the data). Answer about that tenant: balance, payment history and how regularly they pay, utility bills, and drafting messages to them.",
  payments: "The landlord is on the Payments history. Focus on payments: totals by month, trends, unusual or possibly duplicate payments, and unmatched payments.",
  reconcile: "The landlord is on Unmatched payments. Work out which tenant each unmatched payment most likely belongs to, using the payer name, the house in the account reference, the amount compared with rent and balances, and past payments.",
  utilities: "The landlord is on Utilities (water and garbage bills). Focus on unpaid bills, totals owed, water usage per house and unusually high usage.",
  expenses: "The landlord is on Expenses. Focus on spending: totals by category and house, unusual or repeated costs, and practical ways to save.",
  reports: "The landlord is on Reports. Explain the finances clearly: income against expenses, profit, collection rate and how periods compare.",
  archives: "The landlord is on Former tenants. Focus on tenants who moved out: balances they left unpaid, reasons for leaving and patterns.",
  pay: "The landlord is on Payment lookup. Help prepare clear payment instructions for tenants using the paybill and account format.",
  moveout: "The landlord is processing a move-out. Help with a move-out checklist, the tenant's final balance, deposit decisions and a polite message to the tenant.",
  assistant: "The landlord is in the full AI Assistant. Answer any question about the property."
};

function aiAssist(data) {
  var properties = PropertiesService.getScriptProperties();
  var apiKey = properties.getProperty("ANTHROPIC_API_KEY");
  var geminiKey = apiKey ? "" : properties.getProperty("GEMINI_API_KEY");
  // engine=free asks for the built-in assistant (the app does this when the model is too slow).
  var engine = String(value(data, ["engine"], "")) === "free" ? "free" : apiKey ? "claude" : geminiKey ? "gemini" : "free";
  var engineName = engine === "claude" ? "Claude" : "Gemini";
  var mode = String(value(data, ["mode"], "ask"));
  if (["ask", "insights", "reminder", "matchSuggest", "categorize"].indexOf(mode) < 0) return response(false, "Unknown AI mode");
  var page = AI_PAGE_GUIDES[String(value(data, ["page"], ""))] ? String(data.page) : "assistant";
  var question = String(value(data, ["question"], "")).slice(0, 2000);
  if (mode === "categorize" && !question) return response(false, "Enter a description first");
  var context = aiContext(String(value(data, ["tenantId"], "")));
  if (mode === "matchSuggest" && !context.unmatched.length) return response(true, "No unmatched payments", { suggestions: [], engine: engine });
  var language = String(value(data, ["language"], "")).toLowerCase() === "kiswahili" ? "Kiswahili" : "English";

  var answerFree = function(notice) {
    var result = freeAssistant(mode, page, question, context, language, aiHistory(data));
    result.engine = "free";
    if (notice) result.notice = notice;
    return response(true, "OK", result);
  };
  if (engine === "free") return answerFree();

  var base = "You are RentPro's assistant for a Kenyan landlord managing one property. Amounts are in KES. " +
    "Use only the property data provided; if it doesn't contain the answer, say so plainly. Be concise and practical: keep answers under about 200 words unless asked for more detail. " +
    "The 'calculated' section holds exact figures worked out by RentPro (late payments, due dates, totals): prefer them over your own arithmetic. " +
    "If asked how to use the app, answer from the 'appHelp' notes.";
  var request;
  if (mode === "ask") {
    request = {
      system: base + " " + AI_PAGE_GUIDES[page] + " Format answers with short paragraphs, **bold** for key figures and '- ' bullet lists.",
      question: question || "What should I know about this page?"
    };
  } else if (mode === "insights") {
    request = {
      system: base + " Give a short dashboard briefing: collection status this month, tenants behind on rent, unmatched payments, unusual payments or expenses, and 2-3 practical next steps. Use **bold** and short '- ' bullets.",
      question: question || "Give me today's briefing."
    };
  } else if (mode === "reminder") {
    request = {
      system: base + " Write one polite, friendly SMS rent reminder (under 300 characters) for the tenant named in the request" +
        (context.focusTenant ? " (focusTenant in the data)" : "") + ", including their balance and the paybill details. Language: " + language + ". Output only the message text.",
      question: question || "Write the reminder."
    };
  } else if (mode === "matchSuggest") {
    request = {
      system: base + " " + AI_PAGE_GUIDES.reconcile + " Return one suggestion per unmatched payment, using the tenant's id from the tenants list. " +
        "Use an empty tenantId and confidence \"low\" when nothing fits. Keep each reason under 120 characters.",
      question: "Suggest the tenant for each unmatched payment.",
      maxTokens: 3000,
      schema: {
        type: "object",
        properties: {
          suggestions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                paymentId: { type: "string" },
                tenantId: { type: "string" },
                confidence: { type: "string", enum: ["high", "medium", "low"] },
                reason: { type: "string" }
              },
              required: ["paymentId", "tenantId", "confidence", "reason"],
              additionalProperties: false
            }
          }
        },
        required: ["suggestions"],
        additionalProperties: false
      }
    };
  } else {
    request = {
      system: base + " Classify one property expense. Pick the best category; for the house, use the house number mentioned in the description, " +
        "or \"General\" for shared costs. Keep the reason under 80 characters.",
      question: "Expense description: " + question,
      maxTokens: 1000,
      schema: {
        type: "object",
        properties: {
          category: { type: "string", enum: EXPENSE_CATEGORIES },
          house: { type: "string" },
          reason: { type: "string" }
        },
        required: ["category", "house", "reason"],
        additionalProperties: false
      }
    };
  }

  // Exact figures from the built-in calculator, so the model doesn't have to do the arithmetic itself.
  var calculated = {};
  if (mode === "ask" || mode === "insights") {
    calculated.briefing = freeBriefing(freeFacts(context));
    var help = mode === "ask" && freeAppHelp(question.toLowerCase());
    if (help) calculated.appHelp = help;
  }
  var system = request.system + "\n\nProperty data (JSON):\n" + JSON.stringify(aiModelContext(context)) +
    (calculated.briefing ? "\n\ncalculated (JSON):\n" + JSON.stringify(calculated) : "");
  var history = mode === "ask" ? aiHistory(data) : [];

  var reply;
  try {
    if (engine === "claude") {
      var body = {
        model: AI_MODEL,
        max_tokens: request.maxTokens || 4000,
        output_config: { effort: "low" },
        fallbacks: "default",
        system: system,
        messages: history.concat([{ role: "user", content: request.question }])
      };
      if (request.schema) body.output_config.format = { type: "json_schema", schema: request.schema };
      reply = callClaude(apiKey, body);
    } else {
      reply = callGemini(geminiKey, system, history, request.question, request.schema, request.maxTokens || 2000);
    }
  } catch (error) {
    reply = { ok: false, message: "Couldn't reach " + engineName + "." };
  }
  if (!reply.ok) return answerFree(reply.message + " Answered with the free assistant instead.");
  if (!request.schema) return response(true, "OK", { text: reply.text, engine: engine });

  var parsed;
  try { parsed = JSON.parse(reply.text.replace(/^```(?:json)?\s*|\s*```$/g, "")); } catch (error) { parsed = null; }
  if (!parsed || typeof parsed !== "object") return answerFree(engineName + "'s reply couldn't be read. Answered with the free assistant instead.");
  if (mode === "matchSuggest") {
    // Keep only suggestions that point at real unmatched payments and real tenants.
    var tenantIds = {};
    context.tenants.forEach(function(t) { tenantIds[t.id] = t; });
    var paymentIds = {};
    context.unmatched.forEach(function(p) { paymentIds[p.paymentId] = true; });
    parsed.suggestions = (parsed.suggestions || []).filter(function(s) { return paymentIds[s.paymentId]; }).map(function(s) {
      var tenant = tenantIds[s.tenantId];
      return { paymentId: s.paymentId, tenantId: tenant ? s.tenantId : "", tenantName: tenant ? tenant.name : "", house: tenant ? tenant.house : "",
        confidence: tenant && ["high", "medium", "low"].indexOf(s.confidence) >= 0 ? s.confidence : "low", reason: String(s.reason || "") };
    });
  }
  if (mode === "categorize") {
    if (EXPENSE_CATEGORIES.indexOf(parsed.category) < 0) parsed.category = "Other";
    parsed = { category: parsed.category, house: String(parsed.house || "General"), reason: String(parsed.reason || "") };
  }
  parsed.engine = engine;
  return response(true, "OK", parsed);
}

// The property data the assistant sees. Personal identifiers (phone, national ID) and raw SMS text are left out.
function aiContext(tenantId) {
  var tenants = rowsAsObjects(SHEET_TENANTS);
  var payments = rowsAsObjects(SHEET_PAYMENTS);
  var utilities = rowsAsObjects(SHEET_UTILITIES);
  var shortPayment = function(p) {
    return { date: p.Date, amount: p.Amount, tenant: p.Tenant, payer: p.Payer, house: p.House, method: p.Method, reference: p.Reference, status: p.Notes };
  };
  var context = {
    today: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd"),
    paybill: "Equity paybill 247247, account 275515#<house number>",
    tenants: tenants.map(function(t) {
      return { id: String(t.ID), name: t.Name, house: t.House, rent: t.Rent, paid: t.AmountPaid, balance: t.Balance,
        dueDay: t.DueDate, since: t.DateAdded, hasNextOfKin: !!String(t.NextOfKin || "").trim() };
    }),
    payments: payments.slice(-300).map(shortPayment),
    unmatched: payments.filter(function(p) { return /unmatched|unassigned/i.test(String(p.Notes || "")); }).slice(-50).map(function(p) {
      return { paymentId: String(p.ID), date: p.Date, amount: p.Amount, payer: p.Payer || p.Tenant, accountHouse: p.House, reference: p.Reference };
    }),
    expenses: rowsAsObjects(SHEET_EXPENSES).slice(-200).map(function(e) {
      return { date: e.Date, category: e.Category, description: e.Description, amount: e.Amount, house: e.House };
    }),
    utilities: utilities.slice(-200).map(function(u) {
      return { month: u.Month, house: u.House, tenant: u.TenantName, water: u.Water, garbage: u.Garbage, status: u.Status, unitsUsed: u.UnitsUsed };
    }),
    formerTenants: rowsAsObjects(SHEET_ARCHIVES).slice(-50).map(function(a) {
      return { name: a.Name, house: a.House, rent: a.Rent, balance: a.Balance, reason: a.MoveOutReason, deposit: a.DepositStatus, since: a.DateAdded, movedOut: a.ArchivedDate };
    })
  };
  var focus = tenantId && tenants.filter(function(t) { return String(t.ID) === tenantId; })[0];
  if (focus) {
    var name = String(focus.Name || "").trim().toLowerCase();
    context.focusTenant = {
      id: String(focus.ID), name: focus.Name, house: focus.House, rent: focus.Rent, paid: focus.AmountPaid, balance: focus.Balance,
      dueDay: focus.DueDate, since: focus.DateAdded,
      payments: payments.filter(function(p) { return String(p.Tenant || "").trim().toLowerCase() === name; }).map(shortPayment),
      utilityBills: utilities.filter(function(u) { return String(u.House) === String(focus.House); }).map(function(u) {
        return { month: u.Month, water: u.Water, garbage: u.Garbage, status: u.Status, unitsUsed: u.UnitsUsed };
      })
    };
  }
  return context;
}

// A compact copy of the data for Gemini/Claude: smaller prompts answer much faster.
// Recent records (about 4 months) in full, plus monthly totals for the last 12 months.
// The calculated briefing already covers the detailed sums.
function aiModelContext(context) {
  var tz = Session.getScriptTimeZone();
  var now = new Date();
  var cutoff = new Date(now.getFullYear(), now.getMonth() - 3, 1);
  var day = function(v) { var d = aiDate(v); return d ? Utilities.formatDate(d, tz, "yyyy-MM-dd") : String(v || ""); };
  var recent = function(v) { var d = aiDate(v); return !d || d >= cutoff; };
  var monthKey = function(v) { var d = aiDate(v); return d ? Utilities.formatDate(d, tz, "yyyy-MM") : ""; };

  var totals = {};
  for (var i = 11; i >= 0; i--) totals[Utilities.formatDate(new Date(now.getFullYear(), now.getMonth() - i, 1), tz, "yyyy-MM")] = { collected: 0, expenses: 0 };
  context.payments.forEach(function(p) { var t = totals[monthKey(p.date)]; if (t && !/unmatched|unassigned/i.test(String(p.status || ""))) t.collected += aiNum(p.amount); });
  context.expenses.forEach(function(e) { var t = totals[monthKey(e.date)]; if (t) t.expenses += aiNum(e.amount); });

  var payment = function(p) {
    var out = { date: day(p.date), amount: aiNum(p.amount), tenant: p.tenant, house: p.house, method: p.method, reference: p.reference };
    if (/unmatched|unassigned/i.test(String(p.status || ""))) { out.status = "unmatched"; out.payer = p.payer; }
    return out;
  };
  var compact = {
    today: context.today,
    paybill: context.paybill,
    tenants: context.tenants.map(function(t) {
      return { id: t.id, name: t.name, house: t.house, rent: aiNum(t.rent), paid: aiNum(t.paid), balance: aiNum(t.rent) - aiNum(t.paid),
        dueDay: t.dueDay, since: day(t.since), hasNextOfKin: t.hasNextOfKin };
    }),
    monthlyTotals: Object.keys(totals).map(function(k) { return { month: k, collected: totals[k].collected, expenses: totals[k].expenses }; }),
    recentPayments: context.payments.filter(function(p) { return recent(p.date); }).slice(-120).map(payment),
    unmatched: context.unmatched.slice(-30).map(function(p) {
      return { paymentId: p.paymentId, date: day(p.date), amount: aiNum(p.amount), payer: p.payer, accountHouse: p.accountHouse, reference: p.reference };
    }),
    recentExpenses: context.expenses.filter(function(e) { return recent(e.date); }).slice(-60).map(function(e) {
      return { date: day(e.date), category: e.category, description: e.description, amount: aiNum(e.amount), house: e.house };
    }),
    utilities: context.utilities.filter(function(u) { return u.status !== "Paid"; }).concat(context.utilities.slice(-30).filter(function(u) { return u.status === "Paid"; })).slice(-80).map(function(u) {
      return { month: u.month, house: u.house, tenant: u.tenant, water: aiNum(u.water), garbage: aiNum(u.garbage), status: u.status, unitsUsed: aiNum(u.unitsUsed) };
    }),
    formerTenants: context.formerTenants.slice(-20).map(function(a) {
      return { name: a.name, house: a.house, rent: aiNum(a.rent), balance: aiNum(a.balance), reason: a.reason, deposit: a.deposit, movedOut: day(a.movedOut) };
    })
  };
  if (context.focusTenant) {
    var f = context.focusTenant;
    compact.focusTenant = { id: f.id, name: f.name, house: f.house, rent: aiNum(f.rent), paid: aiNum(f.paid), balance: aiNum(f.rent) - aiNum(f.paid),
      dueDay: f.dueDay, since: day(f.since), payments: f.payments.slice(-24).map(payment), utilityBills: f.utilityBills.slice(-12) };
  }
  return compact;
}

// One Messages API call. Returns { ok, text } or { ok: false, message }.
function callClaude(apiKey, body) {
  var res = UrlFetchApp.fetch("https://api.anthropic.com/v1/messages", {
    method: "post",
    contentType: "application/json",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2026-10-21",
      "anthropic-beta": "server-side-fallback-2026-07-01"
    },
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  });
  var result;
  try { result = JSON.parse(res.getContentText()); } catch (error) { return { ok: false, message: "AI service returned an unexpected reply (" + res.getResponseCode() + ")" }; }
  if (res.getResponseCode() !== 200) return { ok: false, message: "AI error: " + ((result.error && result.error.message) || res.getResponseCode()) };
  if (result.stop_reason === "refusal") return { ok: false, message: "The AI declined this request. Try rephrasing it." };
  if (result.stop_reason === "max_tokens") return { ok: false, message: "The AI reply was too long. Try a narrower question." };
  var text = (result.content || []).filter(function(b) { return b.type === "text"; }).map(function(b) { return b.text; }).join("\n").trim();
  return { ok: true, text: text };
}

// Gemini generateContent (Google AI Studio key; the free tier covers both models).
// The fastest model goes first; the larger one is tried when it is busy or over its limit.
var GEMINI_MODEL = "gemini-3.5-flash-lite";
var GEMINI_BACKUP_MODEL = "gemini-3.8-flash";
// Least thinking each model allows, for speed.
var GEMINI_THINKING = { "gemini-3.5-flash-lite": "minimal", "gemini-3.8-flash": "low" };

// history uses the Claude roles (user/assistant); Gemini calls the assistant "model".
// Returns { ok, text } or { ok: false, message }.
function callGemini(apiKey, system, history, question, schema, maxTokens) {
  var reply = callGeminiModel(GEMINI_MODEL, apiKey, system, history, question, schema, maxTokens, true);
  if (!reply.ok && reply.busy) reply = callGeminiModel(GEMINI_BACKUP_MODEL, apiKey, system, history, question, schema, maxTokens, true);
  // If a model rejects the thinking setting, ask again without it.
  if (!reply.ok && reply.badThinking) reply = callGeminiModel(reply.model, apiKey, system, history, question, schema, maxTokens, false);
  return reply;
}

function callGeminiModel(model, apiKey, system, history, question, schema, maxTokens, lowThinking) {
  var contents = history.map(function(turn) {
    return { role: turn.role === "assistant" ? "model" : "user", parts: [{ text: turn.content }] };
  }).concat([{ role: "user", parts: [{ text: question }] }]);
  var body = {
    systemInstruction: { parts: [{ text: system + (schema ? "\n\nReply with JSON only, matching this JSON schema:\n" + JSON.stringify(schema) : "") }] },
    contents: contents,
    generationConfig: { maxOutputTokens: maxTokens || 4000 }
  };
  if (schema) body.generationConfig.responseMimeType = "application/json";
  // Low thinking keeps answers quick; the data and calculated figures do the heavy lifting.
  if (lowThinking) body.generationConfig.thinkingConfig = { thinkingLevel: GEMINI_THINKING[model] || "low" };
  var res = UrlFetchApp.fetch("https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent", {
    method: "post",
    contentType: "application/json",
    headers: { "x-goog-api-key": apiKey },
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  var result;
  try { result = JSON.parse(res.getContentText()); } catch (error) { return { ok: false, message: "Gemini returned an unexpected reply (" + code + ")" }; }
  var errorMessage = String((result.error && result.error.message) || code);
  if (code === 429) return { ok: false, busy: true, model: model, message: "Gemini's free limit is used up for now." };
  if (code === 500 || code === 503 || code === 504) return { ok: false, busy: true, model: model, message: "Gemini is busy right now (" + errorMessage + ")" };
  if (code === 400 && /thinking/i.test(errorMessage)) return { ok: false, badThinking: true, model: model, message: "Gemini error: " + errorMessage };
  if (code !== 200) return { ok: false, model: model, message: "Gemini error: " + errorMessage };
  if (result.promptFeedback && result.promptFeedback.blockReason) return { ok: false, message: "Gemini declined this request. Try rephrasing it." };
  var candidate = (result.candidates || [])[0];
  var text = candidate && candidate.content ? (candidate.content.parts || []).filter(function(p) { return typeof p.text === "string" && !p.thought; })
    .map(function(p) { return p.text; }).join("").trim() : "";
  if (!text) {
    var reason = candidate && candidate.finishReason;
    return { ok: false, message: reason === "MAX_TOKENS" ? "Gemini's reply was too long. Try a narrower question." : "Gemini returned no answer" + (reason ? " (" + reason + ")" : "") + "." };
  }
  return { ok: true, text: text };
}

// Earlier turns of an assistant conversation (sent by the page), so follow-up questions have context.
// Kept short: the last 6 messages, 1,500 characters each, starting with a user turn and alternating roles.
function aiHistory(data) {
  var history = data.history;
  if (typeof history === "string") {
    try { history = JSON.parse(history); } catch (error) { history = []; }
  }
  if (!Array.isArray(history)) return [];
  var cleaned = [];
  history.slice(-6).forEach(function(turn) {
    var role = turn && (turn.role === "assistant" ? "assistant" : turn.role === "user" ? "user" : "");
    var content = turn && String(turn.content || "").slice(0, 1500).trim();
    if (!role || !content) return;
    if (!cleaned.length && role !== "user") return;
    if (cleaned.length && cleaned[cleaned.length - 1].role === role) return;
    cleaned.push({ role: role, content: content });
  });
  // The new question is a user turn, so the history must end with the assistant.
  if (cleaned.length && cleaned[cleaned.length - 1].role === "user") cleaned.pop();
  return cleaned;
}

/* ---------- Free built-in assistant ----------
 * Answers from the sheet data with rules and calculations: no API key, no cost, and nothing leaves Google.
 * Used whenever ANTHROPIC_API_KEY isn't set, and as a backup if a Claude call fails.
 * Returns the same shapes as the Claude path: { text }, { suggestions } or { category, house, reason }.
 */
var PAYBILL_NUMBER = "247247";
var PAYBILL_ACCOUNT_PREFIX = "275515#";
var AI_MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function freeAssistant(mode, page, question, context, language, history) {
  var f = freeFacts(context);
  if (mode === "insights") return { text: freeBriefing(f) };
  if (mode === "reminder") {
    var tenant = freeFindTenant(f, question.toLowerCase(), []);
    return { text: tenant ? freeReminder(f, tenant, language) : "Open a tenant's profile to draft their reminder." };
  }
  if (mode === "matchSuggest") return { suggestions: freeMatchSuggestions(f) };
  if (mode === "categorize") return freeCategorize(question);
  return { text: freeAnswer(f, page, question, history || []) };
}

/* -- Data, cleaned once per request -- */

function aiNum(input) {
  if (typeof input === "number") return input;
  return Number(String(input === null || input === undefined ? "" : input).replace(/[^0-9.\-]/g, "")) || 0;
}

function aiDate(input) {
  if (input instanceof Date) return isNaN(input.getTime()) ? null : input;
  if (input === "" || input === null || input === undefined) return null;
  var date = new Date(input);
  return isNaN(date.getTime()) ? null : date;
}

function aiMonth(date) { return date.getFullYear() * 12 + date.getMonth(); }
function aiMonthName(index) { return AI_MONTH_NAMES[index % 12] + " " + Math.floor(index / 12); }

function kes(amount) {
  var rounded = Math.round(Math.abs(amount));
  return (amount < 0 ? "-" : "") + "KES " + String(rounded).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function aiPercent(part, whole) { return whole ? Math.round(part / whole * 100) + "%" : "–"; }
function aiBullets(lines) { return lines.map(function(line) { return "- " + line; }).join("\n"); }
function aiSum(items, field) { return items.reduce(function(total, item) { return total + item[field]; }, 0); }
function aiHouseLabel(house) { return house ? "House " + house : "No house"; }
function aiNameKey(name) { return String(name || "").trim().toLowerCase().replace(/\s+/g, " "); }
function aiFirstName(name) { return String(name || "").trim().split(/\s+/)[0] || "there"; }

function freeFacts(context) {
  var now = new Date();
  var tenants = (context.tenants || []).map(function(t) {
    var rent = aiNum(t.rent), paid = aiNum(t.paid);
    return { id: String(t.id), name: String(t.name || "").trim(), house: String(t.house || "").trim(), rent: rent, paid: paid,
      balance: rent - paid, dueDay: aiNum(t.dueDay), since: aiDate(t.since), hasNextOfKin: !!t.hasNextOfKin };
  });
  var payments = (context.payments || []).map(function(p) {
    return { date: aiDate(p.date), amount: aiNum(p.amount), tenant: String(p.tenant || "").trim(), house: String(p.house || "").trim(),
      payer: String(p.payer || "").trim(), reference: String(p.reference || "").trim(), method: String(p.method || "").trim(),
      unmatched: /unmatched|unassigned/i.test(String(p.status || "")) };
  }).filter(function(p) { return p.date; });
  var focus = context.focusTenant && tenants.filter(function(t) { return t.id === String(context.focusTenant.id); })[0];
  return {
    now: now,
    month: aiMonth(now),
    tenants: tenants,
    payments: payments,
    received: payments.filter(function(p) { return !p.unmatched; }),
    unmatched: (context.unmatched || []).map(function(p) {
      return { paymentId: String(p.paymentId), date: aiDate(p.date), amount: aiNum(p.amount), payer: String(p.payer || "").trim(),
        house: String(p.accountHouse || "").trim(), reference: String(p.reference || "") };
    }),
    expenses: (context.expenses || []).map(function(e) {
      return { date: aiDate(e.date), category: String(e.category || "Other"), description: String(e.description || "").trim(),
        amount: aiNum(e.amount), house: String(e.house || "").trim() || "General" };
    }),
    utilities: (context.utilities || []).map(function(u) {
      return { month: String(u.month || ""), house: String(u.house || "").trim(), tenant: String(u.tenant || ""), water: aiNum(u.water),
        garbage: aiNum(u.garbage), paid: u.status === "Paid", units: aiNum(u.unitsUsed) };
    }),
    former: (context.formerTenants || []).map(function(a) {
      return { name: String(a.name || "").trim(), house: String(a.house || "").trim(), rent: aiNum(a.rent), balance: aiNum(a.balance),
        reason: String(a.reason || "").trim(), deposit: String(a.deposit || "").trim(), since: aiDate(a.since), movedOut: aiDate(a.movedOut) };
    }),
    focus: focus || null
  };
}

function aiOwing(f) {
  return f.tenants.filter(function(t) { return t.balance > 0; }).sort(function(a, b) { return b.balance - a.balance; });
}

// Rent expected in one month: everyone who occupied a house that month (current and former tenants).
function aiExpectedRent(f, month) {
  var occupied = function(t, end) {
    var from = t.since ? aiMonth(t.since) : -Infinity;
    return from <= month && month <= end;
  };
  return aiSum(f.tenants.filter(function(t) { return occupied(t, Infinity); }), "rent") +
    aiSum(f.former.filter(function(a) { return occupied(a, a.movedOut ? aiMonth(a.movedOut) : -Infinity); }), "rent");
}

function aiInMonths(date, first, last) {
  if (!date) return false;
  var month = aiMonth(date);
  return month >= first && month <= last;
}

// "last month", "last 3 months", "this year", "in September"... Returns null when the question names no period.
function freePeriod(q, f) {
  var m = f.month, year = f.now.getFullYear();
  var make = function(first, last, label) { return { first: first, last: last, label: label }; };
  if (/last month|previous month|mwezi uliopita/.test(q)) return make(m - 1, m - 1, "last month (" + aiMonthName(m - 1) + ")");
  var words = { two: 2, three: 3, four: 4, six: 6, twelve: 12 };
  var span = q.match(/(?:last|past)\s+(\d+|two|three|four|six|twelve)\s+months/);
  if (span) {
    var n = Math.max(1, Math.min(24, Number(span[1]) || words[span[1]]));
    return make(m - n + 1, m, "the last " + n + " months (" + aiMonthName(m - n + 1) + " – " + aiMonthName(m) + ")");
  }
  if (/this year|mwaka huu/.test(q)) return make(year * 12, m, "this year (" + year + ")");
  if (/last year|mwaka uliopita/.test(q)) return make((year - 1) * 12, (year - 1) * 12 + 11, "last year (" + (year - 1) + ")");
  if (/all time|\bever\b|so far|since the start|altogether/.test(q)) return make(0, m, "all time");
  for (var i = 0; i < 12; i++) {
    var name = AI_MONTH_NAMES[i].toLowerCase();
    var pattern = i === 4 ? /\b(in|for|during|of|since) may\b|\bmay \d{4}\b/ : new RegExp("\\b(" + name + "|" + name.slice(0, 3) + ")\\b");
    if (pattern.test(q)) {
      var index = year * 12 + i;
      if (index > m) index -= 12;
      return make(index, index, aiMonthName(index));
    }
  }
  if (/this month|mwezi huu|today|now/.test(q)) return make(m, m, "this month (" + aiMonthName(m) + ")");
  return null;
}

function aiThisMonth(f) { return { first: f.month, last: f.month, label: "this month (" + aiMonthName(f.month) + ")" }; }

// A tenant named in the question ("Mary", "house 7"), else the one whose profile is open,
// else (for "she"/"they" follow-ups) the last tenant mentioned in the conversation.
function freeFindTenant(f, q, history) {
  var house = q.match(/\b(?:house|hse|nyumba|unit|door|no\.?)\s*#?\s*([a-z]?\d+[a-z]?)\b/i) || q.match(/#\s*(\d+[a-z]?)\b/i);
  if (house) {
    var byHouse = f.tenants.filter(function(t) { return t.house.toLowerCase() === house[1].toLowerCase(); })[0];
    if (byHouse) return byHouse;
  }
  var best = null, bestScore = 0;
  var plain = function(text) { return " " + String(text).toLowerCase().replace(/['’]s\b/g, "").replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ") + " "; };
  var words = plain(q);
  f.tenants.forEach(function(t) {
    var key = plain(t.name).trim();
    var score = key && words.indexOf(" " + key + " ") >= 0 ? 10 : 0;
    key.split(" ").forEach(function(word) {
      if (word.length >= 3 && words.indexOf(" " + word + " ") >= 0) score += 1;
    });
    if (score > bestScore) { best = t; bestScore = score; }
  });
  if (best) return best;
  if (f.focus) return f.focus;
  if (/\b(she|he|her|his|him|they|their|them)\b/.test(q)) {
    for (var i = history.length - 1; i >= 0; i--) {
      var earlier = freeFindTenant({ tenants: f.tenants, focus: null }, String(history[i].content || "").toLowerCase(), []);
      if (earlier) return earlier;
    }
  }
  return null;
}

/* -- Questions -- */

function freeAnswer(f, page, question, history) {
  var q = String(question || "").toLowerCase().replace(/[’`]/g, "'");
  var tenant = freeFindTenant(f, q, history);
  var has = function(pattern) { return pattern.test(q); };

  if (!q.trim() || has(/^(hi|hello|hey|habari|mambo|help|what can you do|what can i ask)\b/) || has(/^(help|what can you do)/)) return freeHelp(f, page);

  // "How do I…" questions about using RentPro
  if (has(/how (do|can|to|should) (i |we )?(add|record|enter|edit|change|update|delete|remove|clear|restore|undo|recover|move|assign|generate|send|export|download|print|install|sign|log|set ?up|use|find|see|create|register|archive|mark|pay|get)|how to |where (do|can|is|are)|^can i |steps to|guide me|show me how|what does .* button/) &&
      !has(/how (do|can) i (improve|increase|save|reduce|grow)/) && !has(/\b(write|draft|compose)\b/)) {
    var help = freeAppHelp(q);
    if (help) return help;
  }

  // An M-Pesa reference such as UJH7UAL03Q
  var reference = String(question || "").toUpperCase().match(/\b(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{10}\b/);
  if (reference) return freeReferenceLookup(f, reference[0]);

  // Messages to draft
  if (has(/remind|kumbusha/)) {
    var language = has(/kiswahili|swahili/) ? "Kiswahili" : "English";
    if (tenant && !has(/\b(each|every|all|everyone)\b/)) return "Here's a reminder you can send" + (tenant.balance > 0 ? "" : " (they don't owe anything right now)") + ":\n\n" + freeReminder(f, tenant, language);
    return freeAllReminders(f, language);
  }
  if (has(/goodbye|farewell|kwaheri/)) return freeGoodbye(tenant);
  if (has(/thank|appreciat|asante/) && has(/message|draft|write|sms|note|send/)) return freeThankYou(tenant);
  if (has(/deposit/) && has(/message|draft|write|refund|explain/)) return freeDepositMessage(tenant);
  if (has(/how to pay|payment instruction|paybill|account number/) && has(/message|write|draft|send|explain|instruction/)) return freePayInstructions(tenant);
  if (has(/paybill|account number|business number|till/)) return freePayInstructions(tenant);

  // Former tenants
  if (has(/former|archiv|moved out|move-out reason|ex-tenant|previous tenant|tenants (who )?(left|leave)|why .*(leave|left)/)) {
    return has(/why|reason|pattern/) ? freeMoveOutReasons(f) : freeFormerBalances(f);
  }
  if (has(/checklist|move.?out|moving (a tenant )?out|vacat/)) return freeMoveOutChecklist(f, tenant);

  // The tenant whose profile is open, or one named in the question
  if (tenant && has(/payments|paid|pay\b|malipo|lipa/) && !has(/\b(tenants|everyone|all|who|which)\b|on time|regular|in full/)) return freeTenantPayments(f, tenant, freePeriod(q, f));
  if (tenant && has(/\b(this tenant|they|their|she|he|her|his)\b|summar|on time|regular|late|history/) && !has(/\b(tenants|everyone|all)\b/)) {
    return has(/on time|regular|late|punctual|in full|consistent/) && !has(/summar/) ? freePunctuality(f, tenant) : freeTenantSummary(f, tenant);
  }

  if (has(/next.?of.?kin|missing|incomplete|details/)) return freeMissingDetails(f);

  if (has(/water|garbage|utilit|maji|taka|meter|units/)) {
    return has(/most|highest|usage|\buse\b|consum|high|unusual/) ? freeWaterUsage(f) : freeUnpaidUtilities(f);
  }

  if (has(/unmatched|unassigned|belong|\bmatch/)) return has(/how (should|do|can) i|explain how|decide/) ? freeMatchingGuide(f) : freeUnmatchedAnswer(f);

  var expenseWords = /expens|spend|spent|cost|matumizi|bills? paid/;
  if (has(/briefing|attention|what('s| is) happening|overview|how am i doing|insight|summary of everything|status|focus|today's|priorit/)) return freeBriefing(f);
  if (has(/\blate\b|overdue|past due|defaulter|wamechelewa|kuchelewa/) && !tenant) return freeLateAnswer(f);
  if (has(/due (soon|this week|next|date|day)|upcoming|who is due|when .*due|due on/)) return freeDueDates(f);
  if (has(/reliable|best tenant|good tenant|always pay|pays? on time|never (miss|late)|trust/) && !tenant) return freeReliability(f);
  if (has(/risk|worr|concern|problem tenant|watch list|keep an eye|trouble/)) return freeWatchList(f);
  if (has(/recent|latest|last (few |10 |ten )?payments|newest/) && has(/payment|paid|transaction|malipo/)) return freeRecentPayments(f);
  if (has(/method|by cash|in cash|m-?pesa vs|how (did|do) (they|tenants) pay|bank/) && has(/payment|paid|pay/)) return freePaymentMethods(f, freePeriod(q, f) || aiThisMonth(f));
  if (has(/follow.?up|chase|who should i (call|contact|remind)|priority/)) return freeFollowUps(f);
  if (has(/compare|\bvs\.?\b|versus|against last/)) return freeCompareMonths(f);
  if (has(/improve|increase|grow|what should i do|useful things|advice|tips|recommend/)) return freeImprovementTips(f);
  if (has(/save|saving|cut (my )?cost|reduce|cheaper/)) return freeSavings(f, freePeriod(q, f));
  if (has(/duplicate|unusual|odd|suspicious|strange|very large|very small/) && !has(expenseWords)) return freePaymentAnomalies(f);
  if (has(/profit|my numbers|financ|income and expens/)) return freeFinancialSummary(f, freePeriod(q, f));
  var category = EXPENSE_CATEGORIES.filter(function(c) { return c !== "Other" && new RegExp("\\b" + c.toLowerCase()).test(q); })[0] ||
    (has(/repair|fundi|plumb/) ? "Maintenance" : has(/caretaker|guard|wage|mshahara/) ? "Salary" : "");
  if (has(expenseWords) || (category && has(/spen|cost|paid for|how much/))) {
    if (category && !has(/categor/)) return freeCategorySpend(f, category, freePeriod(q, f));
    return has(/unusual|repeat|odd|duplicate|strange|high/) ? freeUnusualExpenses(f) : freeExpenseSummary(f, freePeriod(q, f), has(/house/));
  }
  if (has(/profit|income|\bnet\b|my numbers|financ|earn|explain/)) return freeFinancialSummary(f, freePeriod(q, f));
  if (has(/\brate\b|trend|percentage|how well/)) return freeCollectionTrend(f, 3);

  if (has(/more than (one|1|a) month|two months|2 months|months? behind|several months/)) return freeLongArrears(f);
  if (has(/\bpart(ly|ial|ially)?\b|half|some of|not (paid )?in full|underpaid/)) return freePartialPayers(f);
  if (has(/owe|owing|behind|arrear|balance|debt|deni|anadaiwa|hajalipa|hawajalipa|haven't paid|hasn't paid|not paid|unpaid|outstanding|\blate\b/)) {
    return tenant && !has(/tenants|who|everyone|which/) ? freeTenantSummary(f, tenant) : freeOwing(f);
  }
  if (has(/credit|overpaid|paid (too much|extra|ahead)|advance/)) return freeCredits(f);
  if (has(/collect|receiv|paid|payment|malipo|income|got|made|rent in|how much/)) return freeCollections(f, freePeriod(q, f) || aiThisMonth(f));
  if (has(/vacan|empty|occup|how many (tenants|houses)|tenants do i have|list (of )?tenants|total rent|rent roll|monthly rent|expected rent/)) return freeOccupancy(f);
  if (tenant) return freeTenantSummary(f, tenant);
  var anyHelp = freeAppHelp(q);
  if (anyHelp && has(/\b(how|where|can i|steps|button|page|screen)\b/)) return anyHelp;

  return freePageOverview(f, page) + "\n\n" + freeHelp(f, page, true);
}

function freeHelp(f, page, short) {
  var examples = {
    dashboard: ["Today's briefing", "Who is late with rent?", "Who is due this week?", "Compare this month with last month"],
    tenants: ["Who is behind on rent?", "Who are my most reliable tenants?", "Reminders for everyone owing", "How do I add a tenant?"],
    "tenant-profile": ["Summarise this tenant", "Do they pay on time?", "Reminder in Kiswahili"],
    payments: ["How much did I collect last month?", "Latest payments", "Find payment UJH7UAL03Q", "How do I restore a deleted payment?"],
    reconcile: ["Who might the unmatched payments belong to?", "How should I match these?"],
    utilities: ["Who hasn't paid utilities?", "Highest water use", "Total owed in utilities"],
    expenses: ["Expenses this year by category", "Unusual spending", "Where can I save?"],
    reports: ["Explain my numbers", "Collection rate over the last 6 months", "What should I improve?"],
    archives: ["Unpaid balances of former tenants", "Why do tenants leave?"],
    pay: ["Payment instructions message"],
    moveout: ["Move-out checklist", "Deposit refund message", "Goodbye message"]
  }[page] || ["Who is late with rent?", "How much did I collect last month?", "Summarise this year's expenses", "Who hasn't paid water?", "Tell me about house 7", "How do I record a cash payment?"];
  return (short ? "**Try asking:**" : "I'm RentPro's built-in assistant. I work out answers from your own records, free.\n\n" +
    "**I can help with:**\n" + aiBullets([
      "**Rent:** who is late or due soon, who owes, part payments, arrears, reliable tenants, collections for any month, collection rate",
      "**Tenants:** a summary of any tenant or house, payment record, missing details, tenants to watch",
      "**Payments:** latest payments, find an M-Pesa reference, duplicates, unmatched payments and who they belong to",
      "**Money:** expenses by category or house, unusual spending, where to save, profit, month-by-month comparisons",
      "**Utilities & former tenants:** unpaid bills, water use, balances left, why tenants leave",
      "**Messages:** reminders (English or Kiswahili), payment instructions, deposit and goodbye messages, move-out checklist",
      "**Using RentPro:** _how do I…_ add a tenant, record a payment, assign, restore, export, generate bills…"
    ]) + "\n\n**Try asking:**") + "\n" + aiBullets(examples) +
    (short ? "" : "\n\nName a tenant or house (_\"how much does house 7 owe?\"_) and a period (\"in September\", \"last 3 months\", \"this year\") any time.");
}

function freePageOverview(f, page) {
  if (page === "utilities") return freeUnpaidUtilities(f);
  if (page === "expenses") return freeExpenseSummary(f, null, false);
  if (page === "archives") return freeFormerBalances(f);
  if (page === "reconcile") return freeUnmatchedAnswer(f);
  if (page === "payments") return freeCollections(f, aiThisMonth(f));
  if (page === "tenant-profile" && f.focus) return freeTenantSummary(f, f.focus);
  if (page === "reports") return freeFinancialSummary(f, null);
  if (page === "moveout") return freeMoveOutChecklist(f, f.focus);
  return "I'm not sure I understood that, so here's the overall picture.\n\n" + freeBriefing(f);
}

// Day of the month rent is due for a tenant (DueDate column; new tenants get the 15th).
function aiDueDay(t) { return t.dueDay >= 1 && t.dueDay <= 31 ? Math.floor(t.dueDay) : 15; }

// Months among the last 3 finished ones where the tenant paid short or after the due day.
function aiLateMonths(f, t) {
  var due = aiDueDay(t);
  var months = freeMonthlyHistory(f, t, 4).filter(function(m) { return m.month < f.month; }).slice(-3);
  return { late: months.filter(function(m) { return m.paid < m.rent || (m.firstDay && m.firstDay > due); }).length, of: months.length };
}

// Tenants with a balance whose due day has passed this month, most days late first.
function freeLateList(f) {
  var day = f.now.getDate();
  return aiOwing(f).filter(function(t) { return day > aiDueDay(t) || (t.rent && t.balance > t.rent); }).map(function(t) {
    var monthsBehind = t.rent ? Math.floor((t.balance - 1) / t.rent) : 0;
    return { tenant: t, days: Math.max(0, day - aiDueDay(t)) + monthsBehind * 30, history: aiLateMonths(f, t) };
  }).sort(function(a, b) { return b.days - a.days || b.tenant.balance - a.tenant.balance; });
}

// Tenants with a balance whose due day is in the next 7 days.
function freeDueSoonList(f) {
  var day = f.now.getDate();
  return aiOwing(f).filter(function(t) { var due = aiDueDay(t); return due >= day && due - day <= 7 && !(t.rent && t.balance > t.rent); })
    .map(function(t) { return { tenant: t, inDays: aiDueDay(t) - day }; })
    .sort(function(a, b) { return a.inDays - b.inDays; });
}

function aiLateLine(item) {
  var t = item.tenant;
  return t.name + " (" + aiHouseLabel(t.house) + "): **" + kes(t.balance) + "**, " + item.days + " day" + (item.days === 1 ? "" : "s") + " late" +
    " (due on the " + aiDueDay(t) + aiOrdinal(aiDueDay(t)) + ")" +
    (t.paid > 0 ? ", paid " + kes(t.paid) + " so far" : "") +
    (item.history.of && item.history.late >= 2 ? ". Late or short in " + item.history.late + " of the last " + item.history.of + " months" : "");
}

function freeLateAnswer(f) {
  var late = freeLateList(f), soon = freeDueSoonList(f);
  if (!late.length && !soon.length) return "No one is late with rent right now 👍";
  var text = late.length ? "**" + late.length + " tenant" + (late.length === 1 ? " is" : "s are") + " late, " + kes(aiSum(late.map(function(i) { return i.tenant; }), "balance")) + " overdue:**\n" + aiBullets(late.map(aiLateLine)) : "No one is late yet.";
  if (soon.length) text += "\n\n**Due in the next 7 days:**\n" + aiBullets(soon.map(function(i) { return i.tenant.name + " (" + aiHouseLabel(i.tenant.house) + "): " + kes(i.tenant.balance) + (i.inDays ? ", due in " + i.inDays + " day" + (i.inDays === 1 ? "" : "s") : ", due today"); }));
  return text + "\n\nAsk _\"reminders for everyone owing\"_ to draft their SMS messages.";
}

function freeDueDates(f) {
  if (!f.tenants.length) return "There are no tenants yet.";
  var soon = freeDueSoonList(f);
  var byDay = {};
  f.tenants.forEach(function(t) { (byDay[aiDueDay(t)] = byDay[aiDueDay(t)] || []).push(t.name + " (" + aiHouseLabel(t.house) + ")"); });
  return (soon.length ? "**Due in the next 7 days:**\n" + aiBullets(soon.map(function(i) { return i.tenant.name + ": " + kes(i.tenant.balance) + (i.inDays ? " in " + i.inDays + " day(s)" : " today"); })) + "\n\n" : "Nobody with a balance is due in the next 7 days.\n\n") +
    "**Rent due days:**\n" + aiBullets(Object.keys(byDay).sort(function(a, b) { return a - b; }).map(function(d) { return "The " + d + aiOrdinal(Number(d)) + ": " + byDay[d].join(", "); }));
}

// Best payers first: months paid in full and on time over the last 3 finished months.
function freeReliability(f) {
  var rows = f.tenants.map(function(t) { var h = aiLateMonths(f, t); return { t: t, good: h.of - h.late, of: h.of }; }).filter(function(r) { return r.of; });
  if (!rows.length) return "Not enough payment history yet. Ask again after a full month.";
  rows.sort(function(a, b) { return b.good / b.of - a.good / a.of || a.t.balance - b.t.balance; });
  var star = rows.filter(function(r) { return r.good === r.of && r.t.balance <= 0; });
  return "**Most reliable tenants** (paid in full and on time, last 3 months):\n" + aiBullets(rows.map(function(r) {
    return r.t.name + " (" + aiHouseLabel(r.t.house) + "): " + r.good + " of " + r.of + " months" + (r.good === r.of ? " ⭐" : "");
  })) + (star.length ? "\n\n" + star.map(function(r) { return aiFirstName(r.t.name); }).join(", ") + " never missed. A thank-you message keeps good tenants." : "");
}

// Tenants needing attention, with the reason.
function freeWatchList(f) {
  var notes = [];
  aiOwing(f).forEach(function(t) {
    var h = aiLateMonths(f, t);
    if (t.rent && t.balance > t.rent) notes.push("**" + t.name + "** (" + aiHouseLabel(t.house) + ") owes " + kes(t.balance) + ", about " + (Math.round(t.balance / t.rent * 10) / 10) + " months of rent");
    else if (h.late >= 2) notes.push("**" + t.name + "** (" + aiHouseLabel(t.house) + ") was late or short in " + h.late + " of the last " + h.of + " months");
  });
  f.tenants.forEach(function(t) {
    var unpaid = f.utilities.filter(function(u) { return u.house === t.house && !u.paid; });
    if (unpaid.length >= 2) notes.push("**" + t.name + "** has " + unpaid.length + " unpaid utility bills (" + kes(aiSum(unpaid, "water") + aiSum(unpaid, "garbage")) + ")");
  });
  return notes.length ? "**Tenants to keep an eye on:**\n" + aiBullets(notes) : "No tenant is a concern right now 👍";
}

// Possible duplicate or odd payments in the last 6 months (unmatched payments are reported separately).
function freePaymentIssues(f) {
  var recent = f.payments.filter(function(p) { return aiMonth(p.date) > f.month - 6; });
  var notes = [], seen = {};
  recent.forEach(function(p) {
    if (p.reference && seen[p.reference]) notes.push("Same M-Pesa reference **" + p.reference + "** appears twice (" + kes(p.amount) + ")");
    if (p.reference) seen[p.reference] = true;
  });
  recent.forEach(function(p, i) {
    recent.slice(i + 1).forEach(function(o) {
      if (p.tenant && aiNameKey(o.tenant) === aiNameKey(p.tenant) && o.amount === p.amount && o.reference !== p.reference && Math.abs(o.date - p.date) <= 2 * 86400000) {
        notes.push("Possible double payment: " + p.tenant + " paid " + kes(p.amount) + " twice within 2 days");
      }
    });
  });
  var rents = {};
  f.tenants.forEach(function(t) { rents[aiNameKey(t.name)] = t.rent; });
  recent.forEach(function(p) {
    var rent = rents[aiNameKey(p.tenant)];
    if (rent && p.amount > rent * 2) notes.push("Large payment: " + p.tenant + " paid " + kes(p.amount) + " (rent is " + kes(rent) + ")");
    if (rent && p.amount < rent * 0.1) notes.push("Very small payment: " + p.tenant + " paid " + kes(p.amount));
  });
  return notes;
}

function freeBriefing(f) {
  var day = f.now.getDate();
  var collected = aiSum(f.received.filter(function(p) { return aiMonth(p.date) === f.month; }), "amount");
  var expected = aiExpectedRent(f, f.month);
  var lastByNow = aiSum(f.received.filter(function(p) { return aiMonth(p.date) === f.month - 1 && p.date.getDate() <= day; }), "amount");
  var owing = aiOwing(f), late = freeLateList(f), soon = freeDueSoonList(f);
  var sections = [], steps = [];
  var section = function(title, lines) { if (lines.length) sections.push("**" + title + "**\n" + aiBullets(lines)); };

  var pace = lastByNow || collected ? (collected >= lastByNow ? " That's ahead of last month at this point (" + kes(lastByNow) + " by the " + day + aiOrdinal(day) + ")."
    : " That's behind last month at this point (" + kes(lastByNow) + " by the " + day + aiOrdinal(day) + ").") : "";
  var headline = !f.tenants.length ? "No tenants yet. Add them on the Tenants page to start tracking rent."
    : "You've collected **" + kes(collected) + " of " + kes(expected) + "** expected rent (" + aiPercent(collected, expected) + ")." + pace +
      (owing.length ? " " + owing.length + " tenant" + (owing.length === 1 ? " still owes" : "s still owe") + " " + kes(aiSum(owing, "balance")) + "." : " Everyone is paid up 🎉");

  section("🔴 Late payments", late.slice(0, 6).map(aiLateLine).concat(late.length > 6 ? ["…and " + (late.length - 6) + " more"] : []));
  if (late.length) steps.push("Send reminders to " + late.slice(0, 3).map(function(i) { return aiFirstName(i.tenant.name); }).join(", ") + (late.length > 3 ? " and " + (late.length - 3) + " more" : "") + ". Ask me for **reminders for everyone owing** to draft them.");

  section("🟡 Due in the next 7 days", soon.map(function(i) { return i.tenant.name + " (" + aiHouseLabel(i.tenant.house) + "): " + kes(i.tenant.balance) + (i.inDays ? ", due in " + i.inDays + " day" + (i.inDays === 1 ? "" : "s") : ", due today"); }));
  if (soon.length) steps.push("Send a friendly heads-up to " + soon.map(function(i) { return aiFirstName(i.tenant.name); }).join(", ") + " before their due date.");

  var watch = [];
  late.filter(function(i) { return i.tenant.rent && i.tenant.balance > i.tenant.rent; }).forEach(function(i) {
    watch.push(i.tenant.name + " owes about " + (Math.round(i.tenant.balance / i.tenant.rent * 10) / 10) + " months of rent. Agree a payment plan in writing");
  });
  f.tenants.forEach(function(t) {
    var h = aiLateMonths(f, t);
    if (h.late >= 2 && h.late === h.of && t.balance <= 0) watch.push(t.name + " is paid up now but was late or short in all of the last " + h.of + " months");
  });
  var credit = f.tenants.filter(function(t) { return t.balance < 0; });
  if (credit.length) watch.push(credit.map(function(t) { return t.name + " (" + kes(-t.balance) + ")"; }).join(", ") + " paid ahead, carried into next month");
  section("⚠️ Watch list", watch);

  var issues = freePaymentIssues(f).slice(0, 3);
  if (f.unmatched.length) {
    issues.unshift(f.unmatched.length + " unmatched payment" + (f.unmatched.length === 1 ? "" : "s") + " (" + kes(aiSum(f.unmatched, "amount")) + ") not credited to anyone yet");
    var guesses = freeMatchSuggestions(f).filter(function(s) { return s.tenantId && s.confidence !== "low"; });
    steps.unshift("Assign the unmatched payment" + (f.unmatched.length === 1 ? "" : "s") + " on the Unmatched page" + (guesses.length ? " (" + guesses.slice(0, 2).map(function(s) { return "likely " + aiFirstName(s.tenantName); }).join(", ") + ")" : "") + ".");
  }
  section("💳 Payments to check", issues);

  var unpaid = f.utilities.filter(function(u) { return !u.paid; });
  var thisLabel = Utilities.formatDate(f.now, Session.getScriptTimeZone(), "MMM yyyy");
  var overdueBills = unpaid.filter(function(u) { return u.month && u.month !== thisLabel; });
  var util = [];
  if (unpaid.length) util.push(unpaid.length + " unpaid bill" + (unpaid.length === 1 ? "" : "s") + ", " + kes(aiSum(unpaid, "water") + aiSum(unpaid, "garbage")) + (overdueBills.length ? " (" + overdueBills.length + " from earlier months)" : ""));
  var readings = f.utilities.filter(function(u) { return u.units > 0; });
  if (readings.length >= 3) {
    var avg = aiSum(readings, "units") / readings.length;
    var high = readings.filter(function(u) { return u.month === thisLabel && u.units > avg * 1.5; });
    high.forEach(function(u) { util.push(aiHouseLabel(u.house) + " used " + u.units + " units this month, well above the " + Math.round(avg) + "-unit average. Check for a leak"); });
  }
  section("💧 Utilities", util);
  if (overdueBills.length) steps.push("Collect the " + overdueBills.length + " older utility bill" + (overdueBills.length === 1 ? "" : "s") + ".");

  var spentNow = aiSum(f.expenses.filter(function(e) { return e.date && aiMonth(e.date) === f.month; }), "amount");
  var spentBefore = [1, 2, 3].map(function(n) { return aiSum(f.expenses.filter(function(e) { return e.date && aiMonth(e.date) === f.month - n; }), "amount"); });
  var avgSpent = aiSum(spentBefore.map(function(v) { return { v: v }; }), "v") / 3;
  var exp = [];
  if (spentNow) exp.push("Spent " + kes(spentNow) + " this month, net so far " + kes(collected - spentNow) + (avgSpent ? " (usual month: about " + kes(avgSpent) + ")" : ""));
  if (avgSpent && spentNow > avgSpent * 1.5) {
    var big = f.expenses.filter(function(e) { return e.date && aiMonth(e.date) === f.month; }).sort(function(a, b) { return b.amount - a.amount; })[0];
    exp.push("That's higher than usual. Biggest item: " + (big.description || big.category) + ", " + kes(big.amount));
  }
  section("🧾 Expenses", exp);

  var records = [];
  var missing = f.tenants.filter(function(t) { return !t.hasNextOfKin; });
  if (missing.length) records.push(missing.length + " tenant" + (missing.length === 1 ? " has" : "s have") + " no next of kin: " + missing.map(function(t) { return aiFirstName(t.name); }).join(", "));
  var formerDebt = f.former.filter(function(a) { return a.balance > 0; });
  if (formerDebt.length) records.push("Former tenants left " + kes(aiSum(formerDebt, "balance")) + " unpaid (" + formerDebt.length + ")");
  section("🗂️ Records", records);
  if (missing.length) steps.push("Add next-of-kin details for " + missing.length + " tenant" + (missing.length === 1 ? "" : "s") + ".");

  if (!f.tenants.length) steps.unshift("Add your first tenant on the Tenants page.");
  if (!steps.length) steps.push("Nothing urgent. Everything looks up to date 🎉");
  return "**" + aiMonthName(f.month) + " briefing**\n" + headline + (sections.length ? "\n\n" + sections.join("\n\n") : "") +
    "\n\n**✅ Do next**\n" + steps.slice(0, 4).map(function(s, i) { return (i + 1) + ". " + s; }).join("\n");
}

// Recent payments, newest first.
function freeRecentPayments(f) {
  var list = f.payments.slice().sort(function(a, b) { return b.date - a.date; }).slice(0, 10);
  if (!list.length) return "No payments recorded yet.";
  return "**Latest payments:**\n" + aiBullets(list.map(function(p) {
    return Utilities.formatDate(p.date, Session.getScriptTimeZone(), "dd MMM") + ": " + kes(p.amount) + " " + (p.unmatched ? "from " + (p.payer || "unknown") + " (unmatched)" : (p.tenant || "unknown") + (p.house ? " (" + aiHouseLabel(p.house) + ")" : "")) + (p.method ? " · " + p.method : "") + (p.reference ? " · " + p.reference : "");
  }));
}

// Find a payment by its M-Pesa reference (e.g. UJH7UAL03Q).
function freeReferenceLookup(f, reference) {
  var p = f.payments.filter(function(x) { return x.reference.toUpperCase() === reference; })[0];
  if (!p) return "No payment with reference **" + reference + "** is recorded. If the tenant has the M-Pesa message, check the reference and amount, or look in Payments → Recently deleted.";
  return "**" + reference + "**: " + kes(p.amount) + " on " + Utilities.formatDate(p.date, Session.getScriptTimeZone(), "dd MMM yyyy") +
    (p.unmatched ? " from " + (p.payer || "an unknown payer") + ". It is **unmatched**: assign it on the Unmatched page." : ", credited to **" + (p.tenant || "unknown") + "**" + (p.house ? " (" + aiHouseLabel(p.house) + ")" : "") + (p.method ? " via " + p.method : "") + ".");
}

function freePaymentMethods(f, period) {
  var list = f.received.filter(function(p) { return aiInMonths(p.date, period.first, period.last); });
  if (!list.length) return "No payments recorded for " + period.label + ".";
  var by = {};
  list.forEach(function(p) { var k = p.method || "Other"; by[k] = by[k] || { n: 0, amount: 0 }; by[k].n++; by[k].amount += p.amount; });
  var total = aiSum(list, "amount");
  return "**How tenants paid in " + period.label + ":**\n" + aiBullets(Object.keys(by).sort(function(a, b) { return by[b].amount - by[a].amount; }).map(function(k) {
    return k + ": " + kes(by[k].amount) + " (" + by[k].n + " payment" + (by[k].n === 1 ? "" : "s") + ", " + aiPercent(by[k].amount, total) + ")";
  }));
}

// How to do things in the app. Returns null when the question isn't about using RentPro.
function freeAppHelp(q) {
  var topics = [
    [/restore|undo|recover|recently deleted|\bbin\b/, "**Restore a deleted payment**\n1. Open **Payments** and choose the **Recently deleted** tab.\n2. Tick the payment(s) and tap **Restore**.\nDeleted payments are kept for 3 months, then removed for good."],
    [/(delete|clear|remove).*(payment)|payment.*(delete|clear|remove)/, "**Clear payments**\n1. Open **Payments → History**.\n2. Tick the payments (or **Select all**) and tap **Clear**.\nThey move to **Recently deleted** for 3 months, so you can restore them."],
    [/(delete|remove).*(tenant)|tenant.*(delete|remove)/, "**Remove a tenant**\n- If they're leaving, use **Move Out** on their profile instead: it keeps their history under Former tenants.\n- To delete a tenant added by mistake, tap the 🗑️ button on their row in **Tenants** (no history is kept).\n- **Delete all tenants** is under **Tenants → More** and asks you to type DELETE."],
    [/move.?out|mov(e|ing) (a |the |my )?(tenant|\w+) out|tenant (is )?leaving|archive/,"**Move a tenant out**\n1. Open the tenant's profile and tap **Move Out** (or go to **Process Move-Out**).\n2. Enter the reason and deposit status, then **Confirm & Archive Tenant**.\nThey appear under **Former tenants** with their final balance. Ask me for a _move-out checklist_ first."],
    [/sms|automatic|macrodroid|webhook|m-?pesa message|record .*automatic/, "**Automatic payments from M-Pesa SMS**\n- The landlord's Android phone runs **MacroDroid**: when an SMS containing _MPESA Ref_ arrives, it sends it to RentPro.\n- RentPro reads the amount, reference and account **275515#house** and credits that house's tenant.\n- If the house or name can't be matched, the payment goes to **Unmatched** for you to assign."],
    [/unmatched|assign/, "**Assign an unmatched payment**\n1. Open **Unmatched** (Payments → Unmatched).\n2. Tap **AI suggest** to see the likely tenant for each one.\n3. Tap **Assign**, check the tenant and **Confirm Assignment**. Their balance updates straight away."],
    [/meter|reading/, "**Add a water meter reading**\n1. Open the tenant's profile.\n2. Tap **Reading**, enter the current meter reading and save.\nThe bill (units × rate + garbage fee) is added to **Utilities** as unpaid."],
    [/utilit|water bill|garbage|generate (the )?bills?/, "**Utility bills**\n- **Utilities → Generate This Month's Bills** creates water and garbage bills for every tenant.\n- Meter readings from a tenant's profile create bills by units used.\n- Tap **Mark Paid** when a tenant pays a bill."],
    [/expense/, "**Record an expense**\n1. Open **Expenses**.\n2. Type the description, then tap **Suggest category & house** to fill those in.\n3. Enter the amount and date and tap **Save Expense**."],
    [/report|export|csv|pdf|print|download|statement/, "**Reports and exports**\n- **Reports** shows income, expenses, profit and collection rate for any period, by house and by month.\n- **Print / PDF** saves the report; tables export to **CSV**.\n- **Tenants → More → Export to CSV** downloads the tenant list.\n- A tenant's profile can produce their statement PDF."],
    [/(record|add|enter|receive).*(payment|cash|rent)|cash payment/, "**Record a payment by hand** (e.g. cash)\n1. Open **Tenants** and tap **Pay** next to the tenant (or **Record Payment** on their profile).\n2. Enter the amount and method and **Confirm Payment**.\nM-Pesa payments with the right account are recorded automatically."],
    [/due date|due day|when rent is due/, "**Rent due dates**\nNew tenants are due on the **15th** of each month. There's no screen to change it yet: edit the tenant's **DueDate** column (a day number, e.g. 5) in the Google Sheet. Late-payment insights and reminders use this day."],
    [/(edit|change|update|correct).*(tenant|phone|name|rent|house|kin)/, "**Edit a tenant**\nOpen the tenant's profile, tap **Edit**, make the change (phone, rent, house, next of kin…) and tap **Save Changes**."],
    [/(add|new|register|create).*(tenant)|tenant.*(add|new)/, "**Add a tenant**\n1. Open **Tenants** and use **Add New Tenant**.\n2. Enter name, phone (07… or +254…), ID, house number and rent, plus next of kin.\n3. Tap **Save Tenant**. RentPro warns you if the house is already occupied."],
    [/remind|send (an )?sms|whatsapp/, "**Send a rent reminder**\n1. Open the tenant's profile and tap **Reminder**.\n2. Pick English or Kiswahili and tap **Draft**.\n3. Tap **SMS** or **WhatsApp** to send it from your phone.\nOr ask me for _reminders for everyone owing_."],
    [/former|old tenants/, "**Former tenants**\nOpen **Former tenants** (Tenants → Former tenants) to see everyone who moved out, their final balance, reason and deposit status."],
    [/sign ?in|log ?in|password|access|account|google/, "**Signing in**\nUse **Sign in with Google** with an allowed account (ken05462@gmail.com or nancyngari2@gmail.com). Other accounts are refused for safety."],
    [/install|apk|app on (my )?phone|android|download the app/, "**Install the Android app**\nCopy **RentPro.apk** to the phone, open it and allow installing from this source. Sign in with an allowed Google account; it uses the same data as the website."],
    [/tenant pay|payment lookup|pay page|how (do )?tenants pay|paybill/, "**How tenants pay**\nM-Pesa → Lipa na M-Pesa → Pay Bill → business **247247**, account **275515#<house>**. The **Payment Lookup** page shows a tenant their account number. Ask me for a _payment instructions message_."],
    [/\bai\b|assistant|you do/, "**Using the AI**\nTap **Ask AI** on any page for quick actions about that page, or open **AI Assistant** to chat. Ask in plain words, e.g. _who is late?_, _tell me about house 7_, _expenses last month_, _how do I add a tenant?_"]
  ];
  for (var i = 0; i < topics.length; i++) if (topics[i][0].test(q)) return topics[i][1];
  return null;
}

function freeOwing(f) {
  var owing = aiOwing(f);
  if (!f.tenants.length) return "There are no tenants yet. Add tenants on the Tenants page.";
  if (!owing.length) return "Everyone is paid up 🎉 No tenant has a balance right now.";
  return "**" + owing.length + " of " + f.tenants.length + " tenants owe " + kes(aiSum(owing, "balance")) + " in total** (highest first):\n" +
    aiBullets(owing.map(function(t) {
      return t.name + " (" + aiHouseLabel(t.house) + "): **" + kes(t.balance) + "**" + (t.paid > 0 ? ", paid " + kes(t.paid) + " of " + kes(t.rent) : ", nothing paid yet");
    }));
}

function freeLongArrears(f) {
  var long = aiOwing(f).filter(function(t) { return t.rent > 0 && t.balance > t.rent; });
  if (!long.length) return "No tenant owes more than one month's rent. " + (aiOwing(f).length ? "Those with balances owe less than a month each." : "Everyone is paid up.");
  return "**" + long.length + " tenant" + (long.length === 1 ? " owes" : "s owe") + " more than a month's rent:**\n" + aiBullets(long.map(function(t) {
    return t.name + " (" + aiHouseLabel(t.house) + "): " + kes(t.balance) + ", about **" + (Math.round(t.balance / t.rent * 10) / 10) + " months**";
  }));
}

function freePartialPayers(f) {
  var partial = f.tenants.filter(function(t) { return t.paid > 0 && t.balance > 0; }).sort(function(a, b) { return b.balance - a.balance; });
  var none = f.tenants.filter(function(t) { return t.paid <= 0 && t.rent > 0; });
  var text = partial.length ? "**" + partial.length + " tenant" + (partial.length === 1 ? " has" : "s have") + " paid part of their rent:**\n" + aiBullets(partial.map(function(t) {
    return t.name + " (" + aiHouseLabel(t.house) + "): paid " + kes(t.paid) + " of " + kes(t.rent) + ", **" + kes(t.balance) + " left**";
  })) : "Nobody has a part-payment right now.";
  if (none.length) text += "\n\n**Not paid anything yet:** " + none.map(function(t) { return t.name + " (" + aiHouseLabel(t.house) + ")"; }).join(", ");
  return text;
}

function freeCredits(f) {
  var credit = f.tenants.filter(function(t) { return t.balance < 0; });
  if (!credit.length) return "No tenant has paid ahead right now.";
  return "**Tenants in credit (paid ahead):**\n" + aiBullets(credit.map(function(t) { return t.name + " (" + aiHouseLabel(t.house) + "): " + kes(-t.balance) + " ahead"; }));
}

function freeCollections(f, period) {
  var paid = f.received.filter(function(p) { return aiInMonths(p.date, period.first, period.last); });
  var expected = 0;
  for (var m = Math.max(period.first, f.month - 120); m <= Math.min(period.last, f.month); m++) expected += aiExpectedRent(f, m);
  if (!paid.length) return "No payments were recorded for " + period.label + ".";
  var byTenant = {};
  paid.forEach(function(p) {
    var key = p.tenant || "Unknown";
    byTenant[key] = byTenant[key] || { name: key, house: p.house, amount: 0, count: 0 };
    byTenant[key].amount += p.amount;
    byTenant[key].count += 1;
  });
  var payers = Object.keys(byTenant).map(function(k) { return byTenant[k]; }).sort(function(a, b) { return b.amount - a.amount; });
  var total = aiSum(paid, "amount");
  var unmatched = f.unmatched.filter(function(p) { return aiInMonths(p.date, period.first, period.last); });
  return "**Collected in " + period.label + ": " + kes(total) + "** from " + paid.length + " payment" + (paid.length === 1 ? "" : "s") +
    (expected ? " (" + aiPercent(total, expected) + " of " + kes(expected) + " expected rent)" : "") + ".\n\n**Who paid:**\n" +
    aiBullets(payers.slice(0, 15).map(function(p) { return p.name + (p.house ? " (" + aiHouseLabel(p.house) + ")" : "") + ": " + kes(p.amount) + (p.count > 1 ? " in " + p.count + " payments" : ""); })) +
    (payers.length > 15 ? "\n- …and " + (payers.length - 15) + " more" : "") +
    (unmatched.length ? "\n\nPlus " + unmatched.length + " unmatched payment" + (unmatched.length === 1 ? "" : "s") + " (" + kes(aiSum(unmatched, "amount")) + ") not yet assigned to a tenant." : "");
}

function freeCompareMonths(f) {
  var row = function(month) {
    var paid = f.received.filter(function(p) { return aiMonth(p.date) === month; });
    return { collected: aiSum(paid, "amount"), count: paid.length, expected: aiExpectedRent(f, month),
      spent: aiSum(f.expenses.filter(function(e) { return e.date && aiMonth(e.date) === month; }), "amount") };
  };
  var now = row(f.month), before = row(f.month - 1);
  var diff = function(a, b) {
    if (!b) return a ? "(none last month)" : "(same)";
    var change = Math.round((a - b) / b * 100);
    return change === 0 ? "(same)" : "(" + (change > 0 ? "▲ " : "▼ ") + Math.abs(change) + "%)";
  };
  return "**" + aiMonthName(f.month) + " vs " + aiMonthName(f.month - 1) + "**\n" + aiBullets([
    "Rent collected: **" + kes(now.collected) + "** vs " + kes(before.collected) + " " + diff(now.collected, before.collected),
    "Payments: " + now.count + " vs " + before.count,
    "Collection rate: " + aiPercent(now.collected, now.expected) + " vs " + aiPercent(before.collected, before.expected),
    "Expenses: " + kes(now.spent) + " vs " + kes(before.spent) + " " + diff(now.spent, before.spent),
    "Net: **" + kes(now.collected - now.spent) + "** vs " + kes(before.collected - before.spent)
  ]) + "\n\n_This month is still in progress, so it may catch up._";
}

function freeCollectionTrend(f, months) {
  var rows = [];
  for (var m = f.month - months + 1; m <= f.month; m++) {
    var collected = aiSum(f.received.filter(function(p) { return aiMonth(p.date) === m; }), "amount");
    rows.push({ month: m, collected: collected, expected: aiExpectedRent(f, m) });
  }
  var rates = rows.filter(function(r) { return r.expected; }).map(function(r) { return r.collected / r.expected; });
  var trend = rates.length >= 2 ? (rates[rates.length - 1] > rates[0] + 0.05 ? "improving 📈" : rates[rates.length - 1] < rates[0] - 0.05 ? "falling 📉" : "steady") : "not enough history yet";
  var totalCollected = aiSum(rows, "collected"), totalExpected = aiSum(rows, "expected");
  return "**Collection rate, last " + months + " months: " + aiPercent(totalCollected, totalExpected) + "** (" + trend + ")\n" +
    aiBullets(rows.map(function(r) { return aiMonthName(r.month) + ": " + kes(r.collected) + " of " + kes(r.expected) + " (" + aiPercent(r.collected, r.expected) + ")"; })) +
    "\n\n_The current month is still in progress._";
}

function freeFinancialSummary(f, period) {
  period = period || { first: f.now.getFullYear() * 12, last: f.month, label: "this year (" + f.now.getFullYear() + ")" };
  var income = aiSum(f.received.filter(function(p) { return aiInMonths(p.date, period.first, period.last); }), "amount");
  var spent = aiSum(f.expenses.filter(function(e) { return aiInMonths(e.date, period.first, period.last); }), "amount");
  var expected = 0;
  for (var m = Math.max(period.first, f.month - 120); m <= Math.min(period.last, f.month); m++) expected += aiExpectedRent(f, m);
  var net = income - spent;
  return "**Your numbers for " + period.label + "**\n" + aiBullets([
    "**Income (rent received): " + kes(income) + "**. Rent due was " + kes(expected) + ", so you collected " + aiPercent(income, expected) + " of it.",
    "**Expenses: " + kes(spent) + "**, money spent on the property.",
    "**Profit: " + kes(net) + "**: income minus expenses" + (income ? ", so you keep about " + aiPercent(net, income) + " of every shilling collected." : "."),
    "**Still owed today: " + kes(aiSum(aiOwing(f), "balance")) + "** across " + aiOwing(f).length + " tenant(s)."
  ]) + (net < 0 ? "\n\nYou spent more than you collected in this period. Check large expenses and follow up on unpaid rent." : "");
}

function freeImprovementTips(f) {
  var tips = [];
  var owing = aiOwing(f);
  if (owing.length) tips.push("**Collect arrears:** " + owing.length + " tenant(s) owe " + kes(aiSum(owing, "balance")) + ". Send reminders a few days before the due date, starting with " + owing[0].name + ".");
  if (f.unmatched.length) tips.push("**Clear unmatched payments:** " + kes(aiSum(f.unmatched, "amount")) + " isn't credited to anyone yet. Remind tenants to use account 275515#<house number>.");
  var unpaid = f.utilities.filter(function(u) { return !u.paid; });
  if (unpaid.length) tips.push("**Collect utilities:** " + unpaid.length + " bill(s) worth " + kes(aiSum(unpaid, "water") + aiSum(unpaid, "garbage")) + " are unpaid.");
  var cats = freeExpenseCategories(f.expenses.filter(function(e) { return e.date && aiMonth(e.date) > f.month - 6; }));
  if (cats.length) tips.push("**Watch " + cats[0].name + " costs:** your biggest expense in the last 6 months (" + kes(cats[0].amount) + "). Get two quotes before big jobs.");
  var late = f.tenants.filter(function(t) { return freeMonthlyHistory(f, t, 6).filter(function(m) { return m.paid < m.rent; }).length >= 2; });
  if (late.length) tips.push("**Talk to repeat late payers:** " + late.map(function(t) { return t.name; }).join(", ") + " fell short in 2+ of the last 6 months.");
  if (!tips.length) tips.push("Things look healthy: rent is collected and nothing is outstanding. Keep sending reminders before the due date.");
  return "**What would help most next month:**\n" + aiBullets(tips.slice(0, 3));
}

function freeFollowUps(f) {
  var owing = aiOwing(f);
  var lines = owing.slice(0, 8).map(function(t) {
    var history = freeMonthlyHistory(f, t, 6);
    var short = history.filter(function(m) { return m.paid < m.rent; }).length;
    var why = t.paid <= 0 ? "nothing paid this month" : "paid " + kes(t.paid) + " of " + kes(t.rent);
    if (t.rent && t.balance > t.rent) why = "owes over " + Math.floor(t.balance / t.rent) + " month(s) of rent";
    return t.name + " (" + aiHouseLabel(t.house) + "): **" + kes(t.balance) + "**, " + why + (short >= 2 ? "; short in " + short + " of the last 6 months" : "");
  });
  if (f.unmatched.length) lines.push("Also check the " + f.unmatched.length + " unmatched payment(s): one may belong to a tenant above.");
  return lines.length ? "**Follow up with these tenants this week** (highest balance first):\n" + aiBullets(lines) : "No one needs a follow-up: everyone is paid up 🎉";
}

/* -- One tenant -- */

// Rent due vs paid per month, for the tenant's most recent months.
function freeMonthlyHistory(f, tenant, months) {
  var key = aiNameKey(tenant.name);
  var paidIn = {};
  f.received.forEach(function(p) {
    if (aiNameKey(p.tenant) !== key) return;
    var m = aiMonth(p.date);
    paidIn[m] = paidIn[m] || { paid: 0, firstDay: 99 };
    paidIn[m].paid += p.amount;
    paidIn[m].firstDay = Math.min(paidIn[m].firstDay, p.date.getDate());
  });
  var start = Math.max(f.month - months + 1, tenant.since ? aiMonth(tenant.since) : f.month - months + 1);
  var rows = [];
  for (var m = start; m <= f.month; m++) rows.push({ month: m, rent: tenant.rent, paid: (paidIn[m] || {}).paid || 0, firstDay: (paidIn[m] || {}).firstDay || null });
  return rows;
}

function freeTenantSummary(f, t) {
  var history = freeMonthlyHistory(f, t, 6);
  var bills = f.utilities.filter(function(u) { return u.house === t.house; });
  var unpaidBills = bills.filter(function(u) { return !u.paid; });
  var payments = f.received.filter(function(p) { return aiNameKey(p.tenant) === aiNameKey(t.name); });
  var last = payments.sort(function(a, b) { return b.date - a.date; })[0];
  var full = history.filter(function(m) { return m.paid >= m.rent; }).length;
  var lines = [
    "**Balance:** " + (t.balance > 0 ? kes(t.balance) + " owed" : t.balance < 0 ? kes(-t.balance) + " in credit" : "fully paid") + " (rent " + kes(t.rent) + ", paid " + kes(t.paid) + " this month)",
    "**Last payment:** " + (last ? kes(last.amount) + " on " + Utilities.formatDate(last.date, Session.getScriptTimeZone(), "dd MMM yyyy") + (last.method ? " via " + last.method : "") : "none recorded"),
    "**Paid in full:** " + full + " of the last " + history.length + " month(s)",
    "**Utilities:** " + (unpaidBills.length ? unpaidBills.length + " unpaid bill(s), " + kes(aiSum(unpaidBills, "water") + aiSum(unpaidBills, "garbage")) : bills.length ? "all paid" : "no bills yet"),
    "**Tenant since:** " + (t.since ? Utilities.formatDate(t.since, Session.getScriptTimeZone(), "dd MMM yyyy") : "unknown") + (t.hasNextOfKin ? "" : " · ⚠️ no next of kin recorded")
  ];
  var watch = t.balance > t.rent && t.rent ? "They owe more than a month's rent. Follow up soon." : t.balance > 0 ? "Send a reminder before the due date." : "Nothing to worry about right now.";
  return "**" + t.name + " (" + aiHouseLabel(t.house) + ")**\n" + aiBullets(lines) + "\n\n" + watch;
}

// One tenant's payments, for a period or the last 12 months.
function freeTenantPayments(f, t, period) {
  period = period || { first: f.month - 11, last: f.month, label: "the last 12 months" };
  var list = f.received.filter(function(p) { return aiNameKey(p.tenant) === aiNameKey(t.name) && aiInMonths(p.date, period.first, period.last); })
    .sort(function(a, b) { return b.date - a.date; });
  if (!list.length) return t.name + " (" + aiHouseLabel(t.house) + ") made no payments in " + period.label + "." + (t.balance > 0 ? " They currently owe " + kes(t.balance) + "." : "");
  return "**" + t.name + " (" + aiHouseLabel(t.house) + ") paid " + kes(aiSum(list, "amount")) + " in " + period.label + "** (" + list.length + " payment" + (list.length === 1 ? "" : "s") + "):\n" +
    aiBullets(list.slice(0, 15).map(function(p) {
      return Utilities.formatDate(p.date, Session.getScriptTimeZone(), "dd MMM yyyy") + ": " + kes(p.amount) + (p.method ? " · " + p.method : "") + (p.reference ? " · " + p.reference : "");
    })) + "\n\nBalance now: " + (t.balance > 0 ? kes(t.balance) + " owed" : t.balance < 0 ? kes(-t.balance) + " in credit" : "fully paid") + ".";
}

function freeThankYou(t) {
  return "Hello " + (t ? aiFirstName(t.name) : "<name>") + ", thank you for always paying your rent on time" + (t ? " for House " + t.house : "") +
    ". We really appreciate having you as a tenant. If you ever need anything fixed, just let us know. Best regards!";
}

// Spending in one expense category, item by item.
function freeCategorySpend(f, category, period) {
  period = period || { first: f.now.getFullYear() * 12, last: f.month, label: "this year (" + f.now.getFullYear() + ")" };
  var list = f.expenses.filter(function(e) { return e.category === category && aiInMonths(e.date, period.first, period.last); }).sort(function(a, b) { return b.date - a.date; });
  if (!list.length) return "No " + category + " expenses recorded for " + period.label + ".";
  var all = aiSum(f.expenses.filter(function(e) { return aiInMonths(e.date, period.first, period.last); }), "amount");
  return "**" + category + " in " + period.label + ": " + kes(aiSum(list, "amount")) + "** (" + aiPercent(aiSum(list, "amount"), all) + " of all spending)\n" +
    aiBullets(list.slice(0, 15).map(function(e) {
      return (e.date ? Utilities.formatDate(e.date, Session.getScriptTimeZone(), "dd MMM") + ": " : "") + (e.description || category) + ", " + kes(e.amount) + (e.house !== "General" ? " (" + aiHouseLabel(e.house) + ")" : "");
    }));
}

function freePunctuality(f, t) {
  var history = freeMonthlyHistory(f, t, 6).filter(function(m) { return m.month < f.month || m.paid > 0; });
  if (!history.length) return t.name + " has no payment history yet to judge from.";
  var full = history.filter(function(m) { return m.paid >= m.rent; }).length;
  var onTime = t.dueDay ? history.filter(function(m) { return m.firstDay && m.firstDay <= t.dueDay; }).length : null;
  var verdict = full === history.length ? "pays in full every month 👍" : full >= history.length / 2 ? "usually pays in full, with some short months" : "often pays less than the full rent";
  return "**" + t.name + " " + verdict + ".**\n" + aiBullets(history.map(function(m) {
    var status = m.paid >= m.rent ? "✅ full" : m.paid > 0 ? "⚠️ part" : "❌ nothing";
    return aiMonthName(m.month) + ": " + kes(m.paid) + " of " + kes(m.rent) + " " + status + (m.firstDay ? " (first payment on the " + m.firstDay + aiOrdinal(m.firstDay) + ")" : "");
  })) + (onTime !== null ? "\n\nPaid by the due day (the " + t.dueDay + aiOrdinal(t.dueDay) + ") in " + onTime + " of " + history.length + " months." : "");
}

function aiOrdinal(n) { return n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"; }

function freeMissingDetails(f) {
  var missing = f.tenants.filter(function(t) { return !t.hasNextOfKin; });
  if (!missing.length) return "Every tenant has next-of-kin details recorded 👍";
  return "**" + missing.length + " tenant" + (missing.length === 1 ? " is" : "s are") + " missing next-of-kin details:**\n" +
    aiBullets(missing.map(function(t) { return t.name + " (" + aiHouseLabel(t.house) + ")"; })) + "\n\nOpen each tenant's profile and tap Edit to add them.";
}

function freeOccupancy(f) {
  var houses = f.tenants.map(function(t) { return t.house; }).filter(Boolean).sort(function(a, b) { return a.localeCompare(b, undefined, { numeric: true }); });
  return "**You have " + f.tenants.length + " tenant" + (f.tenants.length === 1 ? "" : "s") + "**, paying " + kes(aiSum(f.tenants, "rent")) + " a month in total.\n" +
    aiBullets(["Occupied houses: " + (houses.join(", ") || "none"), "Paid up: " + f.tenants.filter(function(t) { return t.balance <= 0; }).length, "Owing: " + aiOwing(f).length]);
}

/* -- Messages -- */

function freeReminder(f, t, language) {
  var account = PAYBILL_ACCOUNT_PREFIX + t.house;
  var amount = t.balance > 0 ? t.balance : t.rent;
  if (language === "Kiswahili") {
    return "Habari " + aiFirstName(t.name) + ", hii ni kumbusho la kodi ya nyumba " + t.house + ". " +
      (t.balance > 0 ? "Salio lako ni " + kes(amount) + ". " : "Kodi ya mwezi ni " + kes(amount) + ". ") +
      "Tafadhali lipa kupitia Equity Paybill " + PAYBILL_NUMBER + ", Akaunti " + account + ". Asante!";
  }
  return "Hello " + aiFirstName(t.name) + ", this is a friendly reminder about rent for House " + t.house + ". " +
    (t.balance > 0 ? "Your balance is " + kes(amount) + ". " : "Monthly rent is " + kes(amount) + ". ") +
    "Please pay via Equity Paybill " + PAYBILL_NUMBER + ", Account " + account + ". Thank you!";
}

function freeAllReminders(f, language) {
  var owing = aiOwing(f);
  if (!owing.length) return "No one owes rent right now, so there are no reminders to send 🎉";
  return "**Reminders for the " + owing.length + " tenant" + (owing.length === 1 ? "" : "s") + " with a balance.** Copy each one into an SMS:\n\n" +
    owing.map(function(t) { return "**" + t.name + " (" + aiHouseLabel(t.house) + ")**\n" + freeReminder(f, t, language); }).join("\n\n");
}

function freePayInstructions(t) {
  var account = PAYBILL_ACCOUNT_PREFIX + (t ? t.house : "<your house number>");
  return (t ? "Hello " + aiFirstName(t.name) + ", " : "Hello, ") + "here's how to pay rent by M-Pesa:\n" + aiBullets([
    "Go to M-Pesa → Lipa na M-Pesa → Pay Bill",
    "Business number: **" + PAYBILL_NUMBER + "** (Equity)",
    "Account number: **" + account + "**" + (t ? "" : ", e.g. 275515#7 for House 7"),
    "Enter the amount and your M-Pesa PIN, then confirm"
  ]) + "\nUsing your house number in the account means your payment is recorded automatically. Thank you!";
}

function freeDepositMessage(t) {
  var name = t ? aiFirstName(t.name) : "<name>";
  return "Here's a template. Fill in the amounts in brackets:\n\n" +
    "Hello " + name + ", thank you for staying with us" + (t ? " at House " + t.house : "") + ". Following the move-out inspection, your deposit was KES [deposit]. " +
    "Deductions: [item, e.g. repainting] KES [amount]" + (t && t.balance > 0 ? ", unpaid rent " + kes(t.balance) : "") + ". " +
    "Your refund of KES [refund] will be sent to your M-Pesa number by [date]. Please reach out if you have any questions. Best wishes!";
}

function freeGoodbye(t) {
  return "Hello " + (t ? aiFirstName(t.name) : "<name>") + ", thank you for being a great tenant" + (t ? " at House " + t.house : "") +
    ". It has been a pleasure having you. We wish you all the best in your new home, and you're always welcome back. Kind regards!";
}

function freeMoveOutChecklist(f, t) {
  var steps = [
    "Confirm the move-out date in writing" + (t ? " with " + t.name : ""),
    "Final rent balance: " + (t ? (t.balance > 0 ? "**" + kes(t.balance) + " owed**" : t.balance < 0 ? kes(-t.balance) + " in credit, refund or offset it" : "fully paid ✅") : "check the tenant's profile"),
    "Utilities: " + (t ? (function() {
      var unpaid = f.utilities.filter(function(u) { return u.house === t.house && !u.paid; });
      return unpaid.length ? "**" + kes(aiSum(unpaid, "water") + aiSum(unpaid, "garbage")) + " unpaid** (" + unpaid.length + " bill(s))" : "all paid ✅";
    })() : "take a final water meter reading and settle any unpaid bills"),
    "Inspect the house with the tenant: walls, doors, locks, taps, sockets and windows; take photos",
    "Agree on deductions and work out the deposit refund",
    "Collect all keys and any gate cards",
    "Record the move-out in RentPro (reason and deposit status) so the house shows as free"
  ];
  return "**Move-out checklist" + (t ? " for " + t.name + " (" + aiHouseLabel(t.house) + ")" : "") + "**\n" + steps.map(function(s, i) { return (i + 1) + ". " + s; }).join("\n");
}

/* -- Payments -- */

function freePaymentAnomalies(f) {
  var notes = freePaymentIssues(f).slice(0, 12);
  if (f.unmatched.length) notes.push(f.unmatched.length + " unmatched payment(s) worth " + kes(aiSum(f.unmatched, "amount")) + " still need assigning");
  return notes.length ? "**Worth checking (last 6 months):**\n" + aiBullets(notes) : "Nothing unusual in the last 6 months: no duplicate references, double payments or odd amounts.";
}

function freeUnmatchedAnswer(f) {
  if (!f.unmatched.length) return "There are no unmatched payments. Every payment is assigned to a tenant 👍";
  var suggestions = freeMatchSuggestions(f);
  return "**" + f.unmatched.length + " unmatched payment" + (f.unmatched.length === 1 ? "" : "s") + ":**\n" + aiBullets(f.unmatched.map(function(p, i) {
    var s = suggestions[i];
    return kes(p.amount) + " from " + (p.payer || "unknown payer") + (p.house ? " (account house " + p.house + ")" : "") + " → " +
      (s.tenantId ? "probably **" + s.tenantName + " (" + aiHouseLabel(s.house) + ")**, " + s.confidence + " confidence: " + s.reason : "no clear match. " + s.reason);
  })) + "\n\nOpen the Unmatched page and tap **Suggest a tenant for each payment** to assign them.";
}

function freeMatchingGuide(f) {
  return "**How to decide who an unmatched payment belongs to:**\n" + aiBullets([
    "**Payer name:** does it match a tenant, or someone who has paid for that tenant before (e.g. a spouse)?",
    "**Account number:** tenants should use 275515#<house>. A typo (e.g. 275515#71 instead of 7) usually points to the right house",
    "**Amount:** an amount equal to a tenant's rent or exact balance is a strong hint",
    "**Timing:** who usually pays around this date and hasn't paid yet this month?",
    "If unsure, call the payer on the number in the M-Pesa message before assigning"
  ]) + (f.unmatched.length ? "\n\nTap **Suggest a tenant for each payment** and I'll apply these checks to the " + f.unmatched.length + " waiting payment(s)." : "");
}

// Scores every tenant for each unmatched payment: payer name, past payments by the same payer,
// house in the account reference, and amount vs rent/balance.
function freeMatchSuggestions(f) {
  var payerHistory = {};
  f.received.forEach(function(p) {
    if (p.payer && p.tenant) payerHistory[aiNameKey(p.payer)] = p.tenant;
  });
  return f.unmatched.map(function(p) {
    var payerWords = aiNameKey(p.payer).split(" ").filter(function(w) { return w.length >= 3; });
    var best = null;
    f.tenants.forEach(function(t) {
      var score = 0, reasons = [];
      var shared = aiNameKey(t.name).split(" ").filter(function(w) { return w.length >= 3 && payerWords.indexOf(w) >= 0; });
      if (shared.length >= 2) { score += 6; reasons.push("payer name matches"); }
      else if (shared.length === 1) { score += 3; reasons.push("shares the name " + shared[0].charAt(0).toUpperCase() + shared[0].slice(1)); }
      if (payerHistory[aiNameKey(p.payer)] && aiNameKey(payerHistory[aiNameKey(p.payer)]) === aiNameKey(t.name)) { score += 5; reasons.push("this payer paid for them before"); }
      if (p.house && t.house && p.house.toLowerCase() === t.house.toLowerCase()) { score += 5; reasons.push("account is their house"); }
      else if (p.house && t.house && p.house.length > t.house.length && p.house.indexOf(t.house) === 0) { score += 1; reasons.push("account " + p.house + " may be a typo for house " + t.house); }
      if (t.balance > 0 && p.amount === t.balance) { score += 3; reasons.push("amount equals their balance"); }
      else if (p.amount === t.rent) { score += 2; reasons.push("amount equals their rent"); }
      if (score && (!best || score > best.score)) best = { tenant: t, score: score, reasons: reasons };
    });
    if (!best || best.score < 2) return { paymentId: p.paymentId, tenantId: "", tenantName: "", house: "", confidence: "low", reason: "No tenant's name, house or amount fits this payment." };
    var reason = best.reasons.join(", ");
    return { paymentId: p.paymentId, tenantId: best.tenant.id, tenantName: best.tenant.name, house: best.tenant.house,
      confidence: best.score >= 6 ? "high" : best.score >= 3 ? "medium" : "low", reason: reason.charAt(0).toUpperCase() + reason.slice(1) };
  });
}

/* -- Utilities -- */

function freeUnpaidUtilities(f) {
  var unpaid = f.utilities.filter(function(u) { return !u.paid; });
  if (!f.utilities.length) return "No utility bills yet. Generate this month's bills on the Utilities page.";
  if (!unpaid.length) return "All water and garbage bills are paid 👍";
  var byHouse = {};
  unpaid.forEach(function(u) {
    var h = byHouse[u.house] = byHouse[u.house] || { house: u.house, tenant: u.tenant, water: 0, garbage: 0, months: [] };
    h.water += u.water; h.garbage += u.garbage; h.months.push(u.month);
  });
  var rows = Object.keys(byHouse).map(function(k) { return byHouse[k]; }).sort(function(a, b) { return (b.water + b.garbage) - (a.water + a.garbage); });
  var water = aiSum(unpaid, "water"), garbage = aiSum(unpaid, "garbage");
  return "**" + kes(water + garbage) + " owed in utilities**: water " + kes(water) + ", garbage " + kes(garbage) + ".\n" +
    aiBullets(rows.map(function(h) {
      return aiHouseLabel(h.house) + (h.tenant ? " (" + h.tenant + ")" : "") + ": **" + kes(h.water + h.garbage) + "** (water " + kes(h.water) + ", garbage " + kes(h.garbage) + "), " + h.months.join(", ");
    }));
}

function freeWaterUsage(f) {
  var withUnits = f.utilities.filter(function(u) { return u.units > 0; });
  if (!withUnits.length) return "No meter readings recorded yet, so I can't compare water use. Add readings on the Utilities page.";
  var byHouse = {};
  withUnits.forEach(function(u) {
    var h = byHouse[u.house] = byHouse[u.house] || { house: u.house, tenant: u.tenant, units: 0, months: 0, latest: 0 };
    h.units += u.units; h.months += 1; h.latest = u.units;
  });
  var rows = Object.keys(byHouse).map(function(k) { var h = byHouse[k]; h.average = h.units / h.months; return h; }).sort(function(a, b) { return b.average - a.average; });
  var overall = aiSum(withUnits, "units") / withUnits.length;
  var high = rows.filter(function(h) { return h.average > overall * 1.5; });
  return "**Water use by house** (average units per month; overall average " + Math.round(overall * 10) / 10 + "):\n" +
    aiBullets(rows.slice(0, 10).map(function(h) { return aiHouseLabel(h.house) + (h.tenant ? " (" + h.tenant + ")" : "") + ": " + Math.round(h.average * 10) / 10 + " units"; })) +
    "\n\n" + (high.length ? "⚠️ Unusually high (over 1.5× average): " + high.map(function(h) { return aiHouseLabel(h.house); }).join(", ") + ". Check for leaks or a faulty meter." : "No house is unusually high.");
}

/* -- Expenses -- */

function freeExpenseCategories(expenses) {
  var totals = {};
  expenses.forEach(function(e) { totals[e.category] = (totals[e.category] || 0) + e.amount; });
  return Object.keys(totals).map(function(k) { return { name: k, amount: totals[k] }; }).sort(function(a, b) { return b.amount - a.amount; });
}

function freeExpenseSummary(f, period, byHouse) {
  period = period || { first: f.now.getFullYear() * 12, last: f.month, label: "this year (" + f.now.getFullYear() + ")" };
  var list = f.expenses.filter(function(e) { return aiInMonths(e.date, period.first, period.last); });
  if (!list.length) return "No expenses recorded for " + period.label + ".";
  var total = aiSum(list, "amount");
  var houses = {};
  list.forEach(function(e) { houses[e.house] = (houses[e.house] || 0) + e.amount; });
  var houseRows = Object.keys(houses).map(function(k) { return { name: k, amount: houses[k] }; }).sort(function(a, b) { return b.amount - a.amount; });
  var biggest = list.slice().sort(function(a, b) { return b.amount - a.amount; })[0];
  return "**Expenses for " + period.label + ": " + kes(total) + "** (" + list.length + " item" + (list.length === 1 ? "" : "s") + ")\n\n**By category**\n" +
    aiBullets(freeExpenseCategories(list).map(function(c) { return c.name + ": " + kes(c.amount) + " (" + aiPercent(c.amount, total) + ")"; })) +
    "\n\n**By house**\n" + aiBullets(houseRows.slice(0, byHouse ? 20 : 6).map(function(h) { return (h.name === "General" ? "General / shared" : aiHouseLabel(h.name)) + ": " + kes(h.amount); })) +
    "\n\nBiggest single expense: " + (biggest.description || biggest.category) + ", " + kes(biggest.amount) + ".";
}

function freeUnusualExpenses(f) {
  var recent = f.expenses.filter(function(e) { return e.date && aiMonth(e.date) > f.month - 6; });
  if (!recent.length) return "No expenses in the last 6 months to check.";
  var notes = [];
  var cats = {};
  recent.forEach(function(e) { (cats[e.category] = cats[e.category] || []).push(e.amount); });
  recent.forEach(function(e) {
    var amounts = cats[e.category].slice().sort(function(a, b) { return a - b; });
    var median = amounts[Math.floor(amounts.length / 2)];
    if (amounts.length >= 3 && e.amount > median * 2.5) notes.push("**" + kes(e.amount) + "** for " + (e.description || e.category) + " is much higher than your usual " + e.category + " cost (" + kes(median) + ")");
  });
  var repeats = {};
  recent.forEach(function(e) {
    var key = e.description.toLowerCase().replace(/[^a-z ]/g, "").trim();
    if (key) (repeats[key] = repeats[key] || []).push(e);
  });
  Object.keys(repeats).forEach(function(k) {
    var items = repeats[k];
    if (items.length >= 3) notes.push("\"" + items[0].description + "\" was paid " + items.length + " times (" + kes(aiSum(items, "amount")) + "). If it's a repair, a permanent fix may be cheaper");
    else if (items.length === 2 && items[0].amount === items[1].amount && Math.abs(items[0].date - items[1].date) <= 3 * 86400000) notes.push("\"" + items[0].description + "\" (" + kes(items[0].amount) + ") was entered twice within 3 days. Possibly a duplicate");
  });
  var houseCounts = {};
  recent.filter(function(e) { return e.category === "Maintenance" && e.house !== "General"; }).forEach(function(e) { houseCounts[e.house] = (houseCounts[e.house] || 0) + 1; });
  Object.keys(houseCounts).forEach(function(h) { if (houseCounts[h] >= 3) notes.push(aiHouseLabel(h) + " needed " + houseCounts[h] + " repairs in 6 months. Worth inspecting"); });
  return notes.length ? "**Spending to look into (last 6 months):**\n" + aiBullets(notes.slice(0, 10)) : "Nothing unusual: no unusually large, repeated or duplicate expenses in the last 6 months 👍";
}

function freeSavings(f, period) {
  period = period || { first: f.month - 5, last: f.month, label: "the last 6 months" };
  var list = f.expenses.filter(function(e) { return aiInMonths(e.date, period.first, period.last); });
  if (!list.length) return "No expenses in " + period.label + " to look at yet.";
  var tips = {
    Maintenance: "Fix recurring problems properly once, keep a trusted fundi on a fixed rate, and charge tenants for damage they cause.",
    Utilities: "Check for leaks and compare the water bill with the tenants' meter readings, so everything used is billed.",
    Cleaning: "Agree a fixed monthly cleaning rate instead of paying per visit.",
    Salary: "Review duties and hours. One caretaker can often cover cleaning and security together.",
    Tax: "Keep receipts for all expenses so you only pay tax on real profit (KRA monthly rental income tax).",
    Other: "Look through 'Other' costs and cut anything that isn't needed."
  };
  var cats = freeExpenseCategories(list);
  return "**Where your money went in " + period.label + ":** " + kes(aiSum(list, "amount")) + "\n" + aiBullets(cats.slice(0, 3).map(function(c) {
    return "**" + c.name + ": " + kes(c.amount) + "**. " + (tips[c.name] || tips.Other);
  })) + "\n\nAsk _\"any unusual spending?\"_ to spot repeated or one-off large costs.";
}

// Expense category from keywords (English and Kiswahili), plus a house number if one is mentioned.
function freeCategorize(description) {
  var d = String(description || "").toLowerCase();
  var rules = [
    ["Salary", /salar|wage|caretaker|watchm|guard|askari|mshahara|pay(ment)? for staff|staff/],
    ["Tax", /\btax|kra|county rate|land rate|\brates?\b|license|licence|permit|ushuru/],
    ["Cleaning", /clean|sweep|detergent|mop|fumigat|pest|usafi|slash|garden|compound/],
    ["Utilities", /water bill|nairobi water|kplc|token|electric|power|umeme|garbage|takataka|internet|wifi|security light|maji/],
    ["Maintenance", /repair|fix|leak|pipe|plumb|paint|door|lock|window|roof|tile|toilet|tap|socket|bulb|gate|fundi|cement|weld|replace|broken|maintenance|ukarabati/]
  ];
  var match = rules.filter(function(r) { return r[1].test(d); })[0];
  var house = d.match(/\b(?:house|hse|nyumba|unit|no\.?)\s*#?\s*([a-z]?\d+[a-z]?)\b/i) || d.match(/#\s*(\d+[a-z]?)\b/);
  return {
    category: match ? match[0] : "Other",
    house: house ? house[1].toUpperCase() : "General",
    reason: match ? "Matched \"" + (d.match(match[1]) || [""])[0] + "\"" + (house ? " for house " + house[1].toUpperCase() : ", a shared cost") : "No category keyword found"
  };
}

/* -- Former tenants -- */

function freeFormerBalances(f) {
  if (!f.former.length) return "No former tenants yet.";
  var owed = f.former.filter(function(a) { return a.balance > 0; }).sort(function(a, b) { return b.balance - a.balance; });
  if (!owed.length) return "All " + f.former.length + " former tenants left with nothing owed 👍";
  return "**" + owed.length + " former tenant" + (owed.length === 1 ? "" : "s") + " left " + kes(aiSum(owed, "balance")) + " unpaid:**\n" + aiBullets(owed.map(function(a) {
    return a.name + " (" + aiHouseLabel(a.house) + "): **" + kes(a.balance) + "**" + (a.movedOut ? ", moved out " + Utilities.formatDate(a.movedOut, Session.getScriptTimeZone(), "MMM yyyy") : "") + (a.deposit ? ", deposit: " + a.deposit : "");
  })) + "\n\nTip: settle balances against the deposit before a tenant leaves.";
}

function freeMoveOutReasons(f) {
  if (!f.former.length) return "No former tenants yet, so there are no move-out reasons to look at.";
  var groups = [["Rent too high / money", /rent|expens|afford|money|cost|price/], ["Moved for work or school", /job|work|transfer|school|study|relocat/],
    ["Bought or built a home", /bought|built|own home|own house|building/], ["Needed more space / family", /space|bigger|family|marri|baby|child/],
    ["Problems with the house", /repair|leak|water|noise|security|maintenance|broken|dirty|insecur/], ["Evicted / arrears", /evict|arrear|default|unpaid/]];
  var counts = {}, other = 0;
  f.former.forEach(function(a) {
    var g = groups.filter(function(x) { return x[1].test(a.reason.toLowerCase()); })[0];
    if (g) counts[g[0]] = (counts[g[0]] || 0) + 1; else other += 1;
  });
  var rows = Object.keys(counts).map(function(k) { return [k, counts[k]]; }).sort(function(a, b) { return b[1] - a[1]; });
  if (other) rows.push(["Other / not recorded", other]);
  var advice = rows.length && rows[0][0] === "Problems with the house" ? "The most common reason is problems with the house. Fixing repairs quickly could keep tenants longer."
    : rows.length && rows[0][0] === "Rent too high / money" ? "Cost is the top reason. Consider flexible payment dates or a small loyalty discount for long-staying tenants."
    : "Most reasons are personal (work, family). Keeping houses in good repair and responding quickly still helps tenants stay.";
  return "**Why " + f.former.length + " tenant" + (f.former.length === 1 ? "" : "s") + " moved out:**\n" + aiBullets(rows.map(function(r) { return r[0] + ": " + r[1]; })) + "\n\n" + advice;
}

/*
 * Run this once from the Apps Script editor (select it, click Run) after adding GEMINI_API_KEY (or ANTHROPIC_API_KEY).
 * It makes one tiny Claude call and writes the result to the Execution log.
 */
function testAiConnection() {
  var properties = PropertiesService.getScriptProperties();
  var apiKey = properties.getProperty("ANTHROPIC_API_KEY");
  var geminiKey = properties.getProperty("GEMINI_API_KEY");
  if (!apiKey && geminiKey) {
    var gemini = callGemini(geminiKey, "You are a connection test.", [], "Reply with exactly: RentPro AI is connected to Gemini.", null, 200);
    Logger.log(gemini.ok ? "✅ " + gemini.text : "❌ " + gemini.message);
    return gemini.ok ? "connected" : gemini.message;
  }
  if (!apiKey) {
    Logger.log("ℹ️ No AI key set, so RentPro uses the free built-in assistant. To use Gemini, add GEMINI_API_KEY under Project Settings → Script properties.");
    return "missing key";
  }
  var reply = callClaude(apiKey, {
    model: AI_MODEL,
    max_tokens: 200,
    output_config: { effort: "low" },
    fallbacks: "default",
    messages: [{ role: "user", content: "Reply with exactly: RentPro AI is connected." }]
  });
  Logger.log(reply.ok ? "✅ " + reply.text : "❌ " + reply.message);
  return reply.ok ? "connected" : reply.message;
}
