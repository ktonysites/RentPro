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
  getArchivedData: true, getUnmatched: true, getDeletedPayments: true
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
  return prefix + "-" + new Date().getTime() + "-" + Math.floor(Math.random() * 1000);
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
