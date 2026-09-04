const API_URL = "https://script.google.com/macros/s/AKfycbzSn_UZUQBEwNruOIgjOWoJpCYP1x6eHEhB3iSDaEzjj04K3lqY3G4LFmHhIqlYp5qYsA/exec";

let tenants = [];
let payments = [];
let expenses = [];

// FETCH ALL DATA
async function loadData() {
    const response = await fetch(API_URL);
    const data = await response.json();

    tenants = data.tenants || [];
    payments = data.payments || [];
    expenses = data.expenses || [];
}

function exportCSV(filename, rows) {
    const csvContent = rows.map(e => e.join(",")).join("\n");
    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

// EXPORT BUTTONS
document.getElementById("exportAllTenantsCSV").onclick = () => {
    exportCSV("tenants.csv", [
        ["Name", "House", "Rent", "Phone", "ID"],
        ...tenants.map(t => [t.name, t.house, t.rent, t.phone, t.id])
    ]);
};

document.getElementById("exportAllPaymentsCSV").onclick = () => {
    exportCSV("payments.csv", [
        ["Tenant", "Amount", "Date"],
        ...payments.map(p => [p.tenant, p.amount, p.date])
    ]);
};

document.getElementById("exportAllExpensesCSV").onclick = () => {
    exportCSV("expenses.csv", [
        ["Title", "Amount", "Date"],
        ...expenses.map(e => [e.title, e.amount, e.date])
    ]);
};

// MONTHLY REPORT GENERATION
document.getElementById("generateMonthly").onclick = async () => {
    const month = document.getElementById("reportMonth").value;
    if (!month) return alert("Please choose a month first.");

    await loadData();

    const selectedYear = month.split("-")[0];
    const selectedMonth = month.split("-")[1];

    const monthlyPayments = payments.filter(p => p.date.startsWith(month));
    const monthlyExpenses = expenses.filter(e => e.date.startsWith(month));

    const expectedRent = tenants.reduce((sum, t) => sum + Number(t.rent), 0);
    const collected = monthlyPayments.reduce((sum, p) => sum + Number(p.amount), 0);
    const totalExpenses = monthlyExpenses.reduce((sum, e) => sum + Number(e.amount), 0);
    const outstanding = expectedRent - collected;

    const unpaidTenants = tenants.filter(t => {
        return !monthlyPayments.some(p => p.tenant === t.name);
    });

    // OUTPUT
    document.getElementById("monthlyReportArea").style.display = "block";
    document.getElementById("monthlyTitle").innerHTML = `Monthly Report — ${month}`;

    document.getElementById("monthlySummary").innerHTML = `
        <li><strong>Expected Rent:</strong> $${expectedRent}</li>
        <li><strong>Collected:</strong> $${collected}</li>
        <li><strong>Outstanding:</strong> $${outstanding}</li>
        <li><strong>Expenses:</strong> $${totalExpenses}</li>
        <li><strong>Net:</strong> $${collected - totalExpenses}</li>
    `;

    document.getElementById("monthlyUnpaidList").innerHTML =
        unpaidTenants.length === 0
            ? "<li>All tenants have paid.</li>"
            : unpaidTenants.map(t => `<li>${t.name} (${t.house})</li>`).join("");

    // Payments table
    document.getElementById("monthlyPaymentsTable").innerHTML =
        monthlyPayments.map(p => `
            <tr><td>${p.tenant}</td><td>$${p.amount}</td><td>${p.date}</td></tr>
        `).join("");

    // Expenses table
    document.getElementById("monthlyExpensesTable").innerHTML =
        monthlyExpenses.map(e => `
            <tr><td>${e.title}</td><td>$${e.amount}</td><td>${e.date}</td></tr>
        `).join("");

    document.getElementById("printMonthly").disabled = false;
};

// PRINT MONTHLY REPORT
document.getElementById("printMonthly").onclick = () => {
    window.print();
};

// PRINT ALL DATA
document.getElementById("exportFullReport").onclick = () => {
    window.print();
};
