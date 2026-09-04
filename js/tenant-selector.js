// Centralized Tenant Selector Script
// Provides modal-based tenant selection across all pages

;(function(){
  const KEYS = ['rentpro_tenants_v2','tenants','rentpro_tenants'];
  let tenantsCache = null;
  const $ = id => document.getElementById(id);

  async function fetchTenantsForSelector(){
    if (tenantsCache) return tenantsCache;
    let list = [];
    try{
      for(const k of KEYS){ const raw = localStorage.getItem(k); if(raw){ const arr = JSON.parse(raw); if(Array.isArray(arr)) list = list.concat(arr); } }
    }catch(e){ console.warn('local read failed', e); }

    const endpoint = window.API_URL || window.GOOGLE_SCRIPT_URL || null;
    if(endpoint && navigator.onLine){
      try{
        const url = new URL(endpoint);
        url.searchParams.append('action','getTenants');
        const res = await fetch(url);
        const data = await res.json();
        if(data){ if(Array.isArray(data)) list = list.concat(data); else if(Array.isArray(data.data)) list = list.concat(data.data); }
      }catch(e){ /* ignore */ }
    }

    // Deduplicate by id, prefer later entries (server appended last)
    const map = new Map();
    for(const t of list){ if(t && (t.id || t.ID || t.Id)){ const id = String(t.id || t.ID || t.Id); if(!map.has(id)) map.set(id, t); } }
    tenantsCache = Array.from(map.values());
    return tenantsCache;
  }

  function renderSuggestions(list, query){
    const container = $('tenantSuggestList');
    if(!container) return;
    container.innerHTML = '';
    const q = (query||'').toLowerCase().trim();
    const filtered = list.filter(t => {
      const id = String(t.id||t.ID||t.Id||'');
      const name = String(t.name||t.fullName||t.full_name||'').toLowerCase();
      return id.toLowerCase().includes(q) || name.includes(q);
    }).slice(0,80);
    if(filtered.length === 0){ container.innerHTML = '<div class="text-center text-muted py-3">No tenants found.</div>'; return; }
    for(const t of filtered){
      const id = t.id || t.ID || t.Id || '';
      const name = t.name || t.fullName || t.full_name || '';
      const row = document.createElement('div');
      row.className = 'p-2 border-bottom d-flex justify-content-between align-items-center';
      row.style.cursor = 'pointer';
      row.innerHTML = `<div><div class="fw-bold small">${id}</div><div class="small text-muted">${name}</div></div><div class="text-muted small">Open</div>`;
      row.addEventListener('click', ()=>{ selectTenant(id); });
      container.appendChild(row);
    }
  }

  function selectTenant(id){
    const modalEl = document.getElementById('tenantSelectorModal');
    const bs = bootstrap.Modal.getInstance(modalEl);
    if(bs) bs.hide();
    if(id) window.location.href = 'tenant profile.html?id=' + encodeURIComponent(id);
  }

  async function openTenantSelectorModal(){
    const modalEl = document.getElementById('tenantSelectorModal');
    const bs = new bootstrap.Modal(modalEl);
    bs.show();
    const input = $('tenantSelectorInput');
    const list = await fetchTenantsForSelector();
    renderSuggestions(list,'');
    input.value = '';
    input.focus();
    const onKey = (e) => { renderSuggestions(list, input.value); if(e.key === 'Enter'){ const first = list.filter(t=>{ const id=String(t.id||t.ID||t.Id||''); const name=String(t.name||t.fullName||t.full_name||'').toLowerCase(); const q=input.value.toLowerCase(); return id.toLowerCase().includes(q)||name.includes(q); })[0]; if(first){ selectTenant(first.id||first.ID||first.Id); } } };
    input.removeEventListener('keyup', onKey);
    input.addEventListener('keyup', onKey);
  }

  // Expose globally
  window.openTenantSelectorModal = openTenantSelectorModal;
  window.openTenantProfile = function(e){ if(e && e.preventDefault) e.preventDefault(); openTenantSelectorModal(); };
})();
