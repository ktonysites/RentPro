// ====================================================================
// ADD / EDIT LOGIC
// ====================================================================

const handleFormSubmit = async (e) => {
  e.preventDefault();
  
  const saveBtn = e.submitter;
  saveBtn.disabled = true;
  saveBtn.textContent = "Saving...";

  const tenant = {
    id: $("tenantId").value.trim(),
    name: $("tenantName").value.trim(),
    house: $("tenantHouse").value.trim(),
    // Use Number() for explicit type conversion
    rent: Number($("tenantRent").value.trim()) 
  };
  
  const isEdit = tenants.some(t => t.id === tenant.id);
  
  // Client-side validation for ID on Add mode
  if (!isEdit && tenants.some(t => t.id === tenant.id)) {
      alert("Error: Tenant ID already exists in the system.");
      saveBtn.disabled = false;
      saveBtn.textContent = "Save";
      return;
  }

  let res = isEdit 
    ? await apiPost({ action: "updateTenant", tenant })
    : await apiPost({ action: "addTenant", tenant });

  if (res.success) {
    // 1. ONLINE SUCCESS: Modal closes automatically here.
    getModalInstance("tenantModal")?.hide(); 
    loadTenants(); 
  } else if (res.isOffline) {
    // 2. OFFLINE SUCCESS: Handle changes locally
    if (isEdit) {
        // Update local record
        const index = tenants.findIndex(t => t.id === tenant.id);
        if (index !== -1) tenants[index] = tenant;
    } else {
        // Add new local record
        tenants.push(tenant);
    }
    
    saveTenantsLocally();
    renderTenantTable();
    // Modal closes automatically here.
    getModalInstance("tenantModal")?.hide(); 
    alert("Offline Save: Data saved successfully to your device. It will sync when you are back online.");
    
  } else {
    // API Failed for other reason
    alert("Error saving tenant to server: " + (res.message || "An unknown error occurred."));
  }

  saveBtn.disabled = false;
  saveBtn.textContent = "Save";
};