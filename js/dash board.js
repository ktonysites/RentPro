// js/dashboard.js
const API_BASE = window.API_URL;

document.addEventListener("DOMContentLoaded", async () => {
  try {
    const [tenants, payments, expenses] = await Promise.all([
      fetchSheet("Tenants"),
      fetchSheet("Payments"),
      fetchSheet("Expenses")
    ]);

    // Persist backups
    localStorage.setItem("tenants", JSON.stringify(tenants));
    localStorage.setItem("payments", JSON.stringify(payments));
    localStorage.setItem("expenses", JSON.stringify(expenses));

    renderDashboard(tenants, payments, expenses);
  } catch (err) {
    console.warn("Dashboard: cloud load failed, using local backups.", err);
    const tenants = safeParse(localStorage.getItem("tenants"));
    const payments = safeParse(localStorage.getItem("payments"));
    const expenses = safeParse(localStorage.getItem("expenses"));
    renderDashboard(tenants, payments, expenses);
  }
});

async function fetchSheet(sheetName) {
  const url = `${API_BASE}?sheet=${encodeURIComponent(sheetName)}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Fetch ${sheetName} failed: ${res.status}`);
  try {
    const json = await res.json();
    return Array.isArray(json) ? json : [];
  } catch (e) {
    throw new Error("Invalid JSON from server for " + sheetName);
  }
}

function renderDashboard(tenants = [], payments = [], expenses = []) {
  // Normalize tenants for older/irregular rows
  tenants = tenants.map(normalizeTenant).filter(t => t.idNumber);

  safeSet("statTenants", tenants.length);

  const totalRent = tenants.reduce((s, t) => s + (Number(t.rentAmount) || 0), 0);
  safeSet("statTotalRent", `$${totalRent.toLocaleString()}`);

  const collected = (payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
  safeSet("statCollected", `$${collected.toLocaleString()}`);

  const totalExpenses = (expenses || []).reduce((s, e) => s + (Number(e.amount) || 0), 0);
  safeSet("statExpenses", `$${totalExpenses.toLocaleString()}`);

  const outstanding = totalRent - collected;
  safeSet("statOutstanding", `$${outstanding.toLocaleString()}`);

  // Late = tenants without payment in current month (by date string containing YYYY-MM)
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const lateCount = tenants.filter(t => {
    return !(payments || []).some(p => String(p.date || "").includes(ym) &&
      (String(p.tenant || "").trim() === String(t.fullName || "").trim() ||
       String(p.tenant || "").trim() === String(t.idNumber || "").trim()));
  }).length;
  safeSet("statLate", lateCount);

  buildRecentPayments(payments);
  buildRecentExpenses(expenses);
  buildUnpaidList(tenants, payments);
  buildPaidUnpaidChart(tenants, payments);
  buildCollectionsChart(payments);
}

/* --- helpers & UI builders --- */

function normalizeTenant(raw) {
  if (!raw) return {};
  return {
    idNumber: String(raw.id || raw.idNumber || raw.ID || raw.id_number || "").trim(),
    fullName: String(raw.fullName || raw.name || raw.tenant || "").trim(),
    propertyAddress: String(raw.propertyAddress || raw.house || raw.address || "").trim(),
    rentAmount: String(raw.rentAmount || raw.rent || raw.Rent || "").trim(),
    phone: String(raw.phone || raw.Phone || "").trim()
  };
}

function safeSet(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function safeParse(s) {
  try { return JSON.parse(s) || []; } catch { return []; }
}

/* Recent payments table */
function buildRecentPayments(payments = []) {
  const tbody = document.getElementById("recentPayments");
  if (!tbody) return;
  payments = (payments || []).slice().sort((a, b) => new Date(b.date) - new Date(a.date));
  if (payments.length === 0) {
    tbody.innerHTML = `<tr><td colspan="3" class="text-center text-muted">No payments</td></tr>`;
    return;
  }
  tbody.innerHTML = payments.slice(0, 6).map(p => `
    <tr>
      <td>${escapeHTML(p.tenant || p.id || "—")}</td>
      <td>$${Number(p.amount || 0).toLocaleString()}</td>
      <td>${escapeHTML(p.date || "")}</td>
    </tr>
  `).join("");
}

/* Recent expenses table */
function buildRecentExpenses(expenses = []) {
  const tbody = document.getElementById("recentExpenses");
  if (!tbody) return;
  expenses = (expenses || []).slice().sort((a, b) => new Date(b.date) - new Date(a.date));
  if (expenses.length === 0) {
    tbody.innerHTML = `<tr><td colspan="3" class="text-center text-muted">No expenses</td></tr>`;
    return;
  }
  tbody.innerHTML = expenses.slice(0, 6).map(e => `
    <tr>
      <td>${escapeHTML(e.title || "—")}</td>
      <td>$${Number(e.amount || 0).toLocaleString()}</td>
      <td>${escapeHTML(e.date || "")}</td>
    </tr>
  `).join("");
}

/* Unpaid list for current month */
function buildUnpaidList(tenants = [], payments = []) {
  const ul = document.getElementById("unpaidList");
  if (!ul) return;
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const unpaid = (tenants || []).filter(t => {
    return !(payments || []).some(p => String(p.date || "").includes(ym) &&
      (String(p.tenant || "").trim() === String(t.fullName || "").trim() ||
       String(p.tenant || "").trim() === String(t.idNumber || "").trim()));
  });
  if (unpaid.length === 0) {
    ul.innerHTML = `<li class="list-group-item text-center text-muted">No unpaid tenants for this month</li>`;
    return;
  }
  ul.innerHTML = unpaid.map(t => `<li class="list-group-item">${escapeHTML(t.fullName || t.idNumber)}</li>`).join("");
}

/* Charts */
function buildPaidUnpaidChart(tenants = [], payments = []) {
  const canvas = document.getElementById("chartPaidUnpaid");
  if (!canvas || typeof Chart === "undefined") return;

  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const paid = (tenants || []).filter(t => (payments || []).some(p => String(p.date || "").includes(ym) &&
    (String(p.tenant || "").trim() === String(t.fullName || "").trim() ||
     String(p.tenant || "").trim() === String(t.idNumber || "").trim()))).length;
  const unpaid = (tenants || []).length - paid;

  // destroy existing chart instance if present
  if (canvas._chartInstance) canvas._chartInstance.destroy();

  canvas._chartInstance = new Chart(canvas, {
    type: "doughnut",
    data: {
      labels: ["Paid", "Unpaid"],
      datasets: [{ data: [paid, unpaid] }]
    }
  });
}

function buildCollectionsChart(payments = []) {
  const canvas = document.getElementById("chartCollections");
  if (!canvas || typeof Chart === "undefined") return;

  const labels = [];
  const data = [];

  for (let i = 5; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    labels.push(d.toLocaleString(undefined, { month: "short" }));
    const total = (payments || []).filter(p => String(p.date || "").includes(ym)).reduce((s, p) => s + (Number(p.amount) || 0), 0);
    data.push(total);
  }

  if (canvas._chartInstance) canvas._chartInstance.destroy();

  canvas._chartInstance = new Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: [{ label: "Collected", data, fill: true }]
    },
    options: { responsive: true }
  });
}

function escapeHTML(s) {
  if (!s && s !== 0) return "";
  return String(s).replace(/[&<>"'`]/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;", "`":"&#x60;" })[c]);
}
