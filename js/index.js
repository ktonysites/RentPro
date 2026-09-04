const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });
const db = require('./db');

const app = express();
app.use(bodyParser.json());
app.use(express.static('public'));

// Create invoice
app.post('/api/invoices', (req, res) => {
  const { tenantId, amount, dueDate, description } = req.body;
  if (!tenantId || !amount) return res.status(400).json({ error: 'tenantId and amount required' });

  const invoiceRef = db.createInvoice(tenantId, amount, dueDate, description);
  const businessCode = 'BUS123'; // replace with your business code or Co-op assigned code
  const payAccount = `${businessCode}#${invoiceRef}`;
  res.json({ invoiceRef, payAccount });
});

// Get invoice and pay instructions
app.get('/api/invoices/:ref', (req, res) => {
  const ref = req.params.ref;
  const invoice = db.getInvoiceByRef(ref);
  if (!invoice) return res.status(404).json({ error: 'Not found' });
  const paybill = '400222';
  res.json({ invoice, paybill, payAccount: `${invoice.businessCode || 'BUS123'}#${invoice.invoiceRef}` });
});

// Admin upload reconciliation CSV (simple)
app.post('/api/reconcile/upload', upload.single('file'), async (req, res) => {
  // For simplicity, assume CSV columns: TransactionID,Date,Amount,PayerName,AccountNo,Mobile
  const filePath = req.file.path;
  try {
    const result = await db.reconcileCsv(filePath);
    res.json({ matched: result.matched, unmatched: result.unmatched });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Simple list invoices
app.get('/api/invoices', (req, res) => {
  const rows = db.getAllInvoices();
  res.json(rows);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=> console.log(`Server running on ${PORT}`));
