$('paymentForm').addEventListener('submit', async e=>{
  e.preventDefault();
  
  const saveBtn = e.submitter;
  saveBtn.disabled = true;
  saveBtn.textContent = "Saving...";

  const id = $('paymentId').value || null;
  const selectedTenantId = $('paymentTenant').value;
  
  const selectedTenant = tenants.find(t => t.id === selectedTenantId);
  
  if (!selectedTenant) {
      alert("Please select a valid tenant.");
      saveBtn.disabled = false;
      saveBtn.textContent = "Save";
      return;
  }

  const payment = {
    // Note: The payment ID is set here, either existing or null for new payments
    id: id,
    tenantId: selectedTenant.id, 
    name: selectedTenant.name, 
    house: selectedTenant.house, 
    amount: Number($('paymentAmount').value),
    date: $('paymentDate').value,
    method: $('paymentMethod').value.trim(),
    note: $('paymentNote').value.trim()
  };
  
  let res;
  
  try {
      // 1. Attempt to communicate with the live API
      if (!id) {
          res = await apiPost({ action:'addPayment', payment });
      } else {
          res = await apiPost({ action:'updatePayment', id, payment });
      }

      if (res.success) {
          // ONLINE SUCCESS
          getModalInstance('paymentModal')?.hide(); 
          loadPayments();
      } else if (res.isOffline) {
          // 2. OFFLINE SUCCESS: Handle locally
          
          if (!id) {
              // Add New Payment Offline: Generate a temporary ID
              payment.id = 'OFFLINE-' + Date.now();
              payments.push(payment);
          } else {
              // Edit Existing Payment Offline: Update the payment in the local array
              const index = payments.findIndex(p => p.id === id);
              if (index !== -1) payments[index] = payment;
          }
          
          savePaymentsLocally();
          loadPayments(); // Reloads data from local storage to update the table
          getModalInstance('paymentModal')?.hide(); 
          alert("Offline Save: Payment recorded locally. Sync when back online.");
          
      } else {
          // 3. API Failed for other (non-offline) reason
          alert(`Error saving payment: ${res.message || 'An unknown API error occurred.'}`);
      }
  } catch (error) {
      console.error("Payment Form Submission Error:", error);
      alert("An unexpected error occurred during submission. Check the console for details.");
  } finally {
      // Ensure the button is enabled and reset, ALWAYS.
      saveBtn.disabled = false;
      saveBtn.textContent = "Save";
  }
});