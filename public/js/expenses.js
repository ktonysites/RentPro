// js/expenses.js
const API_BASE = window.API_URL;

async function fetchExpenses() {
  try {
    const res = await fetch(`${API_BASE}?sheet=Expenses`, {cache:'no-store'});
    if (!res.ok) throw new Error("Fetch failed");
    const json = await res.json();
    localStorage.setItem('expenses', JSON.stringify(json));
    return json;
  } catch (e) {
    console.warn("fetchExpenses failed, using local", e);
    return JSON.parse(localStorage.getItem('expenses') || '[]');
  }
}

async function addExpense({ title, category, amount, date, note = '' }) {
  const body = {
    sheet: "Expenses",
    id: Date.now().toString(),
    title,
    category,
    amount,
    date,
    note
  };

  // local backup
  const local = JSON.parse(localStorage.getItem('expenses') || '[]');
  local.unshift(body);
  localStorage.setItem('expenses', JSON.stringify(local));

  // try cloud
  try {
    const res = await fetch(API_BASE, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error('Cloud add expense failed');
    try { return await res.json(); } catch { return { success: true }; }
  } catch (e) {
    console.warn("addExpense cloud failed", e);
    return { success: false };
  }
}
