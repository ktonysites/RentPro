const Database = require('better-sqlite3');
const db = new Database('data.db');

db.exec(`
CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT,
  invoice_ref TEXT UNIQUE,
  amount REAL,
  due_date TEXT,
  description TEXT,
  status TEXT,
  paid_amount REAL,
  paid_at TEXT,
  transaction_id TEXT,
  businessCode TEXT,
  created_at TEXT
);
`);
console.log('Migration done.');
