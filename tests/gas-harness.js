// Runs google-apps-script/Code.gs inside Node with an in-memory fake spreadsheet,
// so the backend can be tested without touching the live Google Sheet.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const CODE_PATH = path.join(__dirname, "..", "google-apps-script", "Code.gs");

function createSheet(name) {
  let rows = [];
  const width = () => rows.reduce((max, row) => Math.max(max, row.length), 0);
  const store = (input) => (typeof input === "string" && input.startsWith("'") ? input.slice(1) : input);
  const ensure = (row, col) => {
    while (rows.length < row) rows.push([]);
    const target = rows[row - 1];
    while (target.length < col) target.push("");
  };
  const range = (row, col, numRows = 1, numCols = 1) => ({
    getValues: () => {
      const out = [];
      for (let r = 0; r < numRows; r++) {
        const line = [];
        for (let c = 0; c < numCols; c++) line.push(((rows[row - 1 + r] || [])[col - 1 + c]) ?? "");
        out.push(line);
      }
      return out;
    },
    setValues: (values) => {
      if (values.length !== numRows || values.some((line) => line.length !== numCols)) {
        throw new Error("Range dimensions do not match data");
      }
      values.forEach((line, r) => line.forEach((cell, c) => {
        ensure(row + r, col + c);
        rows[row - 1 + r][col - 1 + c] = store(cell);
      }));
    },
    setValue: (cell) => { ensure(row, col); rows[row - 1][col - 1] = store(cell); }
  });

  return {
    name,
    rows: () => rows,
    getName: () => name,
    getLastRow: () => rows.length,
    getLastColumn: () => width(),
    getDataRange: () => {
      const w = width();
      return { getValues: () => rows.map((line) => { const copy = line.slice(); while (copy.length < w) copy.push(""); return copy; }) };
    },
    getRange: range,
    appendRow: (line) => { rows.push(line.map(store)); },
    deleteRow: (row) => { rows.splice(row - 1, 1); },
    deleteRows: (row, count) => { rows.splice(row - 1, count); }
  };
}

function formatDate(date, tz, pattern) {
  const d = new Date(date);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const pad = (n) => String(n).padStart(2, "0");
  return pattern
    .replace("yyyy", d.getFullYear())
    .replace("MMM", months[d.getMonth()])
    .replace("MM", pad(d.getMonth() + 1))
    .replace("dd", pad(d.getDate()))
    .replace("HH", pad(d.getHours()))
    .replace("mm", pad(d.getMinutes()));
}

function createBackend(options = {}) {
  const sheets = {};
  const properties = Object.assign({}, options.properties || {});
  const logs = [];

  const spreadsheet = {
    getSheetByName: (name) => sheets[name] || null,
    insertSheet: (name) => (sheets[name] = createSheet(name))
  };

  const textOutput = (content) => {
    const output = { content, mime: null, getContent: () => content, setMimeType: (mime) => { output.mime = mime; return output; } };
    return output;
  };

  const context = {
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet },
    ContentService: { createTextOutput: textOutput, MimeType: { JSON: "json", JAVASCRIPT: "javascript" } },
    Utilities: {
      formatDate,
      getUuid: () => require("crypto").randomUUID()
    },
    Session: { getScriptTimeZone: () => "Africa/Nairobi" },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key) => (key in properties ? properties[key] : null),
        setProperty: (key, val) => { properties[key] = String(val); },
        deleteProperty: (key) => { delete properties[key]; }
      })
    },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, tryLock: () => true, releaseLock: () => {} }) },
    ScriptApp: { getService: () => ({ getUrl: () => "https://script.google.com/macros/s/TEST/exec" }) },
    Logger: { log: (...args) => logs.push(args.join(" ")) },
    console
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(CODE_PATH, "utf8"), context, { filename: "Code.gs" });

  function parse(output) {
    const text = output.getContent();
    const jsonp = text.match(/^[A-Za-z_$][\w$]*\(([\s\S]*)\);$/);
    return JSON.parse(jsonp ? jsonp[1] : text);
  }

  return {
    context,
    sheets,
    properties,
    logs,
    get: (params) => parse(context.doGet({ parameter: Object.assign({}, params) })),
    post: (body, query = {}) => parse(context.doPost({
      parameter: Object.assign({}, query),
      postData: { contents: typeof body === "string" ? body : JSON.stringify(body) }
    })),
    rawGet: (params) => context.doGet({ parameter: Object.assign({}, params) }),
    sheetRows: (name) => (sheets[name] ? sheets[name].rows() : [])
  };
}

module.exports = { createBackend };
