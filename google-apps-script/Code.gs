/*
 * RentPro backend for one property.
 * Paste this entire file into Google Apps Script, then deploy as a web app.
 */

var SHEET_TENANTS = "Tenants";
var SHEET_PAYMENTS = "Payments";
var SHEET_EXPENSES = "Expenses";
var SHEET_ARCHIVES = "Archives";
var SHEET_UTILITIES = "UtilityBills";

var WATER_RATE = 120;
var GARBAGE_FEE = 150;

function doGet(e) {
  return handleRequest(e);
}

function doPost(e) {
  return handleRequest(e);
}

function handleRequest(e) {
  try {
    initSheets();

    var params = readRequest(e);
    var action = String(params.action || "");
    if (!action) return response(false, "No action provided");

    switch (action) {
      case "getTenants": return getTenants();
      case "addTenant": return addTenant(params);
      case "editTenant": return editTenant(params);
      case "updateTenant": return editTenant(params);
      case "addBulkTenants": return addBulkTenants(params);
      case "deleteTenant": return deleteTenant(params);
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
      case "moveOut": return moveOut(params);
      case "getUnmatched": return getUnmatched();
      case "manualAssign": return manualAssign(params);
      default: return response(false, "Unknown action: " + action);
    }
  } catch (error) {
    return response(false, "Server Error: " + error.message);
  }
}

function readRequest(e) {
  if (e && e.postData && e.postData.contents) {
    var body = JSON.parse(e.postData.contents);
    return body || {};
  }
  return e && e.parameter ? e.parameter : {};
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
    value(data, ["date", "DueDate"], 5),
    new Date(),
    0,
    Number(value(data, ["rent", "Rent"], 0)),
    "Main Property"
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
      value(item, ["house", "House"], ""), Number(value(item, ["rent", "Rent"], 0)), 5,
      new Date(), 0, Number(value(item, ["rent", "Rent"], 0)), "Main Property"
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
      archiveTenantRow(values[i]);
      currentSheet.deleteRow(i + 1);
      return response(true, "Tenant archived");
    }
  }
  return response(false, "Tenant ID not found");
}

function getPayments() {
  return response(true, "Payments loaded", rowsAsObjects(SHEET_PAYMENTS));
}

function recordPayment(data) {
  var currentSheet = sheet(SHEET_TENANTS);
  var paymentSheet = sheet(SHEET_PAYMENTS);
  var values = currentSheet.getDataRange().getValues();
  var tenantId = value(data, ["id", "tenantId"], "");
  var amount = Number(value(data, ["amount"], 0));

  if (!amount || amount < 0) return response(false, "Invalid payment amount");

  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]) === String(tenantId)) {
      var paid = Number(values[i][9]) + amount;
      var balance = Number(values[i][6]) - paid;
      currentSheet.getRange(i + 1, 10, 1, 2).setValues([[paid, balance]]);
      paymentSheet.appendRow([
        new Date(), amount, values[i][2], value(data, ["message", "reference"], ""),
        value(data, ["method"], "Manual"), values[i][5], "Manual"
      ]);
      return response(true, "Payment recorded");
    }
  }
  return response(false, "Tenant not found");
}

function addPayment(data) {
  var payment = data.payment || data;
  sheet(SHEET_PAYMENTS).appendRow([
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

  tenantRows.forEach(function(tenant) {
    var alreadyExists = existing.some(function(bill) {
      return String(bill.Month) === month && String(bill.House) === String(tenant.House);
    });
    if (!alreadyExists) {
      output.push([id("UTIL"), month, tenant.House, tenant.Name, WATER_RATE, GARBAGE_FEE, "Unpaid", "", "", "", 0]);
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
  var previous = Number(value(data, ["prevRead"], 0));
  var current = Number(value(data, ["currRead"], 0));
  var units = Math.max(0, current - previous);
  var water = units * Number(value(data, ["waterRate"], WATER_RATE));
  sheet(SHEET_UTILITIES).appendRow([
    id("UTIL"), Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "MMM yyyy"),
    value(data, ["house"], ""), value(data, ["tenantName"], ""), water,
    Number(value(data, ["garbageFee"], GARBAGE_FEE)), "Unpaid", "", previous, current, units
  ]);
  return response(true, "Meter reading saved");
}

function archiveTenantRow(row, reason, depositStatus) {
  var archiveRow = row.slice(0, 12);
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

function archiveResponse(archives) {
  return ContentService
    .createTextOutput(JSON.stringify({ success: true, status: "success", archives: archives }))
    .setMimeType(ContentService.MimeType.JSON);
}

function moveOut(data) {
  var tenants = sheet(SHEET_TENANTS);
  var values = tenants.getDataRange().getValues();
  var name = String(value(data, ["tenantName"], "")).toLowerCase();
  var house = String(value(data, ["houseNumber"], ""));

  for (var i = values.length - 1; i >= 1; i--) {
    var sameName = name && String(values[i][2]).toLowerCase() === name;
    var sameHouse = house && String(values[i][5]) === house;
    if (sameName || sameHouse) {
      archiveTenantRow(values[i], value(data, ["reason"], "Move out"), value(data, ["depositStatus"], ""));
      tenants.deleteRow(i + 1);
      return response(true, "Tenant archived successfully");
    }
  }
  return response(false, "Tenant was not found");
}

function getUnmatched() {
  var payments = rowsAsObjects(SHEET_PAYMENTS);
  var unmatched = payments.filter(function(payment) {
    var notes = String(payment.Notes || payment.Status || "").toLowerCase();
    return notes.indexOf("unmatched") >= 0 || notes.indexOf("unassigned") >= 0;
  });
  return ContentService
    .createTextOutput(JSON.stringify(unmatched))
    .setMimeType(ContentService.MimeType.JSON);
}

function manualAssign(data) {
  var currentSheet = sheet(SHEET_PAYMENTS);
  var rowNumber = Number(value(data, ["rowIndex"], 0));
  var house = value(data, ["houseNumber"], "");
  if (!rowNumber || rowNumber < 2 || rowNumber > currentSheet.getLastRow()) return response(false, "Payment row not found");
  currentSheet.getRange(rowNumber, 6).setValue(house);
  currentSheet.getRange(rowNumber, 7).setValue("Assigned");
  return response(true, "Payment assigned");
}

function processIncomingPayment(data) {
  sheet(SHEET_PAYMENTS).appendRow([
    value(data, ["date"], new Date()), Number(value(data, ["amount"], 0)),
    value(data, ["tenant", "sender"], ""), value(data, ["message", "reference"], ""),
    value(data, ["method"], "M-Pesa"), "", "Unmatched"
  ]);
  return response(true, "Incoming payment saved");
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
    { name: SHEET_TENANTS, headers: ["ID", "UID", "Name", "Phone", "NationalID", "House", "Rent", "DueDate", "DateAdded", "AmountPaid", "Balance", "Property"] },
    { name: SHEET_PAYMENTS, headers: ["Date", "Amount", "Tenant", "Reference", "Method", "House", "Notes"] },
    { name: SHEET_EXPENSES, headers: ["ID", "UID", "Date", "Category", "Description", "Amount", "House"] },
    { name: SHEET_ARCHIVES, headers: ["ID", "UID", "Name", "Phone", "NationalID", "House", "Rent", "DueDate", "DateAdded", "AmountPaid", "Balance", "Property", "MoveOutReason", "DepositStatus", "ArchivedDate"] },
    { name: SHEET_UTILITIES, headers: ["ID", "Month", "House", "TenantName", "Water", "Garbage", "Status", "DatePaid", "PrevRead", "CurrRead", "UnitsUsed"] }
  ];

  definitions.forEach(function(definition) {
    var currentSheet = spreadsheet.getSheetByName(definition.name);
    if (!currentSheet) {
      currentSheet = spreadsheet.insertSheet(definition.name);
      currentSheet.getRange(1, 1, 1, definition.headers.length).setValues([definition.headers]);
    } else if (currentSheet.getLastRow() === 0) {
      currentSheet.getRange(1, 1, 1, definition.headers.length).setValues([definition.headers]);
    }
  });
}
