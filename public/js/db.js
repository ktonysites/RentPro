const Database = require('better-sqlite3');
const fs = require('fs');
const csv = require('csv-parse/lib/sync');

const dbFile = 'data.db';
const db = new Database(dbFile);

// Migration helper (run migrate.js to create tables)
function createInvoice(tenantId, amount, dueDate, description){
  // invoiceRef format: INV-YYYYMM-<random4>
  const now = new Date();
  const ym = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}`;
  const serial = Math.random().toString(36).substr(2,4).toUpperCase();
  const invoiceRef = `INV-${ym}-${serial}`;

  const stmt = db.prepare(`INSERT INTO invoices (tenant_id, invoice_ref, amount, due_date, description, status, created_at)
    VALUES (?, ?, ?, ?, ?, 'PENDING', datetime('now'))`);
  stmt.run(tenantId, invoiceRef, amount, dueDate || null, description || null);

  return invoiceRef;
}

function getInvoiceByRef(ref){
  const stmt = db.prepare('SELECT * FROM invoices WHERE invoice_ref = ?');
  const row = stmt.get(ref);
  return row;
}

function getAllInvoices(){
  const stmt = db.prepare('SELECT * FROM invoices ORDER BY created_at DESC');
  return stmt.all();
}

// Basic reconciliation from CSV file path
function reconcileCsv(filePath){
  const content = fs.readFileSync(filePath, 'utf8');
  const records = csv(content, { columns: true, skip_empty_lines: true });

  const matched = [];
  const unmatched = [];

  const updateStmt = db.prepare('UPDATE invoices SET status = ?, paid_amount = ?, paid_at = datetime(?) , transaction_id = ? WHERE invoice_ref = ?');

  for(const r of records){
    // assume AccountNo contains BUSINESS#INVOICEREF or just INVOICEREF
    const accountNo = (r.AccountNo || r['Account No'] || r.accountNo || '').trim();
    const amount = parseFloat((r.Amount || r.amount || '0').replace(/[, ]+/g,''));
    const txn = r.TransactionID || r.txn || r.transaction || '';

    // Extract invoiceRef: assume format BUS123#INV-...
    let invoiceRef = null;
    if (accountNo.includes('#')) {
      invoiceRef = accountNo.split('#')[1];
    } else {
      invoiceRef = accountNo;
    }

    if (!invoiceRef) {
      unmatched.push({ row: r });
      continue;
    }

    const inv = getInvoiceByRef(invoiceRef);
    if (inv) {
      // mark as paid
      updateStmt.run('PAID', amount, r.Date || r.date || new Date().toISOString(), txn, invoiceRef);
      matched.push({ invoiceRef, amount, txn });
    } else {
      unmatched.push({ invoiceRef, row: r });
    }
  }

  return { matched, unmatched };
}

module.exports = {
  createInvoice,
  getInvoiceByRef,
  getAllInvoices,
  reconcileCsv
};
