const idx = Number(localStorage.getItem('selectedTenant'));
const tenants = JSON.parse(localStorage.getItem('tenants')) || [];
const payments = JSON.parse(localStorage.getItem('payments')) || [];
if (isNaN(idx) || !tenants[idx]) {
  document.getElementById('profileName').textContent = 'Tenant not found';
} else {
  const t = tenants[idx];
  document.getElementById('profileName').textContent = t.name;
  document.getElementById('profileApt').textContent = t.apt;
  document.getElementById('profileRent').textContent = t.rent;
  const his = payments.filter(p=>p.tenant===t.name);
  const body = document.getElementById('profilePayments');
  body.innerHTML = '';
  his.forEach(p=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${p.amount}</td><td>${new Date(p.date).toLocaleString()}</td>`;
    body.appendChild(tr);
  });
}
