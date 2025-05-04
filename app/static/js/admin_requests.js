/**
 * Initialize the admin requests module
 */
function initAdminRequestsModule() {
  loadAllRequests();
  setupAdminRequestControls();
}

/**
 * Load all rental requests and admin events
 */
function loadAllRequests() {
  showLoadingState(true);
  
  Promise.all([
    fetch('/api/admin/requests').then(handleResponse),
    fetch('/api/admin/events').then(handleResponse)
  ])
  .then(([requestsData, eventsData]) => {
    const requests = Array.isArray(requestsData.requests) ? requestsData.requests : [];
    const pending = requests.filter(r => r.request_status === 'pending');
    const acceptedRequests = requests.filter(r => r.request_status === 'approved' || r.request_status === 'admin');
    const declined = requests.filter(r => r.request_status === 'declined');
    
    const adminEvents = Array.isArray(eventsData.events) ? eventsData.events : [];
    const acceptedEvents = adminEvents.map(event => ({
      ...event,
      request_id: event.event_id,
      request_status: 'admin', 
      is_admin_event: true
    }));

    const allAccepted = [...acceptedRequests, ...acceptedEvents].sort((a, b) => {
      return new Date(a.start_date) - new Date(b.start_date);
    });

    renderAdminRequests(pending, 'pendingRequests');
    renderAdminRequests(allAccepted, 'acceptedRequests');
    renderAdminDeclinedRequests(declined, 'declinedRequests');

    // Apply initial filtering to all containers after rendering
    filterRequests('pendingRequests');
    filterRequests('acceptedRequests');
    filterRequests('declinedRequests');
    
    updateRequestCounters(pending.length, allAccepted.length, declined.length);
    setupRequestActions();
  })
  .catch(error => {
    console.error("Error loading requests:", error);
    showErrorState();
  })
  .finally(() => {
    showLoadingState(false);
  });
}

function isEventStartedOrPassed(startDate, startTime) {
  if (!startDate || !startTime) return false;

  const now = new Date();
  const estNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  
  let year, month, day;
  if (startDate.includes('/')) {
    [month, day, year] = startDate.split('/').map(Number);
  } else {
    [year, month, day] = startDate.split('-').map(Number);
  }

  let [time, period] = startTime.split(' ');
  let [hours, minutes] = time.split(':').map(Number);
  if (period === 'PM' && hours < 12) hours += 12;
  if (period === 'AM' && hours === 12) hours = 0;

  const eventDateTime = new Date(year, month - 1, day, hours, minutes);
  return estNow >= eventDateTime;
}

function isEventPastEndDate(endDate) {
  if (!endDate) return false;

  const now = new Date();
  const estNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));

  let year, month, day;
  if (endDate.includes('/')) {
    [month, day, year] = endDate.split('/').map(Number);
  } else {
    [year, month, day] = endDate.split('-').map(Number);
  }

  const eventEndDate = new Date(year, month - 1, day, 23, 59, 59);
  return estNow > eventEndDate;
}

/**
 * Render declined requests
 */
function renderAdminDeclinedRequests(requests, containerId) {
  const container = document.getElementById(containerId);

  if (!container) {
    console.error(`Container #${containerId} not found in DOM.`);
    return;
  }

  if (!requests || requests.length === 0) {
    container.innerHTML = '<div class="no-requests">No declined requests found</div>';
    return;
  }

  container.innerHTML = `
    <div class="filter-controls">
      <select class="month-filter" id="${containerId}-month"></select>
      <select class="year-filter" id="${containerId}-year"></select>
    </div>
    <div class="request-list" id="${containerId}-list"></div>
  `;

  let html = '';
  requests.forEach((request, index) => {

    const startDate = request.start_date;
    const endDate = request.end_date;
    const formattedRequestDate = formatLocalTime(request.request_date);

    html += `
      <div class="request-item" 
           data-request-id="${request.request_id}" 
           data-start-date="${startDate}" 
           data-end-date="${endDate}">
        <div class="request-header">
          <span class="request-name">
            ${request.rental_name} 
            ${request.user_name ? `<span class="user-name">(${request.user_name})</span>` : ''}
            ${request.is_recurring ? '<span class="recurring-badge">Recurring</span>' : ''}
          </span>
        </div>
        <div class="request-dates">
          ${startDate} ${startDate !== endDate ? `to ${endDate}` : ''}
        </div>
        <div class="request-time">
          ${request.start_time} - ${request.end_time}
        </div>
        ${request.additional_desc ? `<div class="request-desc">${request.additional_desc}</div>` : ''}
        <div class="declined-reason">
          <strong>Reason:</strong> ${request.declined_reason || 'No reason provided'}
        </div>
        <div class="request-footer">
          <div class="request-meta">
            <span class="request-date">Submitted: ${formattedRequestDate}</span>
            ${request.user_email ? `<span class="request-user">User: ${request.user_email}</span>` : ''}
          </div>
        </div>
      </div>`;
  });

  const listContainer = document.getElementById(`${containerId}-list`);
  if (!listContainer) {
    console.error(`List container #${containerId}-list not found.`);
    return;
  }

  listContainer.innerHTML = html;

  populateMonthYearFilters(containerId, requests);

  const monthDropdown = document.getElementById(`${containerId}-month`);
  const yearDropdown = document.getElementById(`${containerId}-year`);

  // Filter after rendering
  filterRequests(containerId);

  // Attach event listeners
  monthDropdown?.addEventListener('change', () => filterRequests(containerId));
  yearDropdown?.addEventListener('change', () => filterRequests(containerId));

  // Scroll to today’s item if available
  setTimeout(() => {
    const today = new Date().toISOString().split('T')[0];
    const todayItem = document.querySelector(`#${containerId}-list .request-item[data-start-date="${today}"]`);
    if (todayItem) {
      todayItem.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, 300);
}


function renderAdminRequests(requests, containerId) {
  const container = document.getElementById(containerId);
  const isAcceptedView = containerId === 'acceptedRequests';

  if (!requests || requests.length === 0) {
    container.innerHTML = '<div class="no-requests">No requests found</div>';
    return;
  }

  container.innerHTML = `
    <div class="filter-controls">
      <select class="month-filter" id="${containerId}-month"></select>
      <select class="year-filter" id="${containerId}-year"></select>
    </div>
    <div class="request-list" id="${containerId}-list"></div>
  `;

  const now = new Date();
  const estNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const oneMonthAgo = new Date(estNow);
  oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

  let html = '';
  requests.forEach(request => {
    const startDate = request.start_date;
    const endDate = request.end_date;
    const startTime = request.start_time;
    const formattedRequestDate = formatLocalTime(request.request_date || request.created_date);
    const isPending = request.request_status === 'pending';
    const isAdminEvent = request.is_admin_event;
    const isRecurring = request.is_recurring;
    const hasStarted = isEventStartedOrPassed(startDate, startTime);
    const isPastEndDate = isEventPastEndDate(endDate);
    const amount = request.amount ? `$${parseFloat(request.amount).toFixed(2)}` : 'N/A';
    const isPaid = request.paid;
    const userEmail = request.user_email || '';

    let canEditAmount = false;
    if (!isPending && !isAdminEvent && !isPaid) {
      if (isRecurring) {
        const eventEndDate = parseDate(endDate);
        canEditAmount = eventEndDate > oneMonthAgo;
      } else {
        const eventStartDate = parseDate(startDate);
        canEditAmount = eventStartDate > oneMonthAgo;
      }
    }

    html += `
      <div class="request-item ${isAdminEvent ? 'admin-event' : ''} ${hasStarted ? 'event-started' : ''}" 
           data-request-id="${request.request_id}"
           data-is-admin-event="${isAdminEvent}"
           data-is-recurring="${isRecurring}"
           data-start-date="${startDate}"
           data-end-date="${endDate}"
           data-start-time="${startTime}"
           data-has-started="${hasStarted}"
           data-past-end-date="${isPastEndDate}"
           data-amount="${request.amount || 0}"
           data-paid="${isPaid}">
        <div class="request-header">
          <div class="header-left">
            <span class="request-name">
              ${request.rental_name || request.event_name} 
              ${request.user_name ? `<span class="user-name">(${request.user_name})</span>` : ''}
              ${isRecurring ? '<span class="recurring-badge">Recurring</span>' : ''}
              ${request.request_status === 'admin' || isAdminEvent ? '<span class="admin-badge">Admin Event</span>' : ''}
              ${isAcceptedView && isPaid ? '<span class="paid-badge">Paid</span>' : ''}
              ${isAcceptedView && !isAdminEvent && !isPaid ? '<span class="unpaid-badge">Unpaid</span>' : ''}
            </span>
          </div>
        </div>

        <div class="request-dates">
          ${startDate} ${startDate !== endDate ? `to ${endDate}` : ''}
        </div>
        <div class="request-time">
          ${startTime} - ${request.end_time}
        </div>

        ${isAcceptedView && !isAdminEvent ? `
          <div class="request-amount">
            <strong>Amount:</strong> 
            <span class="amount-value">${amount}</span>
            ${canEditAmount ? `
              <button class="btn btn-sm btn-primary btn-edit-amount edit-amount" 
                      data-request-id="${request.request_id}"
                      ${isPaid ? 'disabled' : ''}>
                <i class="fas fa-edit"></i>
              </button>` : ''}
            ${!isPaid ? `
              <button class="btn btn-sm btn-invoice send-invoice" 
                      data-request-id="${request.request_id}"
                      data-user-email="${userEmail}"
                      data-amount="${request.amount || 0}">
                <i class="fas fa-paper-plane"></i>
              </button>` : ''}
            ${!isPaid ? `
              <button class="btn btn-sm btn-mark-paid mark-paid" 
                      title="Mark as Paid"
                      data-request-id="${request.request_id}">
                <i class="fas fa-check"></i>
              </button>` : ''}
          </div>` : ''}

        ${request.additional_desc || request.description ? `
          <div class="request-desc">
            ${request.additional_desc || request.description}
          </div>` : ''}

        <div class="request-footer">
          <div class="request-meta">
            <span class="request-date">
              ${isAdminEvent ? 'Created' : 'Submitted'}: ${formattedRequestDate}
              ${!isAdminEvent ? `
                <span class="request-user">User: ${userEmail}</span>
                <span class="request-phone">Phone: ${request.user_phone}</span>` : ''}
            </span>
          </div>

          ${isPending ? `
            <div class="request-actions">
              ${!hasStarted ? `
                <button class="btn btn-approve approve-request" data-request-id="${request.request_id}">
                  <i class="fas fa-check"></i> Approve
                </button>` : ''}
              <button class="btn btn-decline decline-request" data-request-id="${request.request_id}">
                <i class="fas fa-times"></i> Decline
              </button>
            </div>` : `
            <div class="request-actions">
              ${isRecurring && !isPastEndDate ? `
                <button class="btn btn-edit edit-recurring" data-request-id="${request.request_id}" data-is-admin="${isAdminEvent}">
                  <i class="fas fa-edit"></i> Edit
                </button>` : ''}
              ${isAdminEvent && !hasStarted ? `
                <button class="btn btn-delete delete-event" data-event-id="${request.request_id}">
                  <i class="fas fa-trash"></i> Delete
                </button>` : !isAdminEvent ? `
                <button class="btn btn-decline decline-request" data-request-id="${request.request_id}">
                  <i class="fas fa-times"></i> Decline
                </button>` : ''}
            </div>`}
        </div>
      </div>
    `;
  });

  document.getElementById(`${containerId}-list`).innerHTML = html;

  if (containerId === 'acceptedRequests') {
    setupAdminEventButtons();
    setupRecurringEditButtons();
    setupAmountEditButtons();
    setupInvoiceButtons();
    setupMarkPaidButtons();
  }

  populateMonthYearFilters(containerId, requests);
  document.getElementById(`${containerId}-month`).addEventListener('change', () => filterRequests(containerId));
  document.getElementById(`${containerId}-year`).addEventListener('change', () => filterRequests(containerId));

  setTimeout(() => {
    const today = new Date().toISOString().split('T')[0];
    const todayItem = document.querySelector(`#${containerId}-list .request-item[data-start-date="${today}"]`);
    if (todayItem) {
      todayItem.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, 300);
}






/**
 * Helpers: dropdown filter & scroll logic
 */
function populateMonthYearFilters(containerId, requests) {
  const monthSelect = document.getElementById(`${containerId}-month`);
  const yearSelect = document.getElementById(`${containerId}-year`);
  const dates = requests.map(r => new Date(r.start_date));
  const months = [...new Set(dates.map(d => d.getMonth()))];
  const years = [...new Set(dates.map(d => d.getFullYear()))];
  const currentMonth = new Date().getMonth();
  const currentYear = new Date().getFullYear();

  monthSelect.innerHTML = months
    .sort((a, b) => a - b)
    .map(m => `<option value="${m}" ${m === currentMonth ? 'selected' : ''}>${new Date(0, m).toLocaleString('en-US', { month: 'long' })}</option>`)
    .join('');
  yearSelect.innerHTML = years
    .sort((a, b) => a - b)
    .map(y => `<option value="${y}" ${y === currentYear ? 'selected' : ''}>${y}</option>`)
    .join('');
}

function filterRequests(containerId) {
  const selectedMonth = parseInt(document.getElementById(`${containerId}-month`).value);
  const selectedYear = parseInt(document.getElementById(`${containerId}-year`).value);
  const items = document.querySelectorAll(`#${containerId}-list .request-item`);

  items.forEach(item => {
    const startDateStr = item.getAttribute('data-start-date');
    const endDateStr = item.getAttribute('data-end-date');

    if (!startDateStr || !endDateStr) {
      item.style.display = 'none';
      return;
    }

    const start = new Date(startDateStr);
    const end = new Date(endDateStr);

    const firstDayOfSelectedMonth = new Date(selectedYear, selectedMonth, 1);
    const lastDayOfSelectedMonth = new Date(selectedYear, selectedMonth + 1, 0);

    const overlapsMonth = !(end < firstDayOfSelectedMonth || start > lastDayOfSelectedMonth);
    item.style.display = overlapsMonth ? '' : 'none';
  });
}

/**
 * Helper function to parse date string (handles both MM/DD/YYYY and YYYY-MM-DD formats)
 */
function parseDate(dateString) {
  if (!dateString) return new Date(0); // Return epoch if no date
  
  let year, month, day;
  
  if (dateString.includes('/')) {
    // MM/DD/YYYY format
    [month, day, year] = dateString.split('/').map(Number);
    return new Date(year, month - 1, day);
  } else {
    // YYYY-MM-DD format
    [year, month, day] = dateString.split('-').map(Number);
    return new Date(year, month - 1, day);
  }
}

/**
 * Set up edit amount buttons
 */
function setupAmountEditButtons() {
  document.querySelectorAll('.edit-amount').forEach(button => {
    button.addEventListener('click', (e) => handleEditAmount(e, button));
  });
}

/**
 * Handle edit amount action
 */
function handleEditAmount(e, button) {
  e.preventDefault();
  e.stopPropagation();
  
  const requestId = button.dataset.requestId;
  const requestItem = button.closest('.request-item');
  const currentAmount = parseFloat(requestItem.dataset.amount) || 0;
  const isAdminEvent = requestItem.dataset.isAdminEvent === 'true';
  
  // Create modal backdrop
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.style.position = 'fixed';
  backdrop.style.top = '0';
  backdrop.style.left = '0';
  backdrop.style.width = '100%';
  backdrop.style.height = '100%';
  backdrop.style.backgroundColor = 'rgba(0,0,0,0.5)';
  backdrop.style.zIndex = '1000';
  backdrop.style.display = 'flex';
  backdrop.style.justifyContent = 'center';
  backdrop.style.alignItems = 'center';
  
  // Create modal content
  const modal = document.createElement('div');
  modal.className = 'edit-amount-modal';
  modal.style.backgroundColor = 'white';
  modal.style.padding = '25px';
  modal.style.borderRadius = '8px';
  modal.style.boxShadow = '0 4px 15px rgba(0,0,0,0.2)';
  modal.style.width = '400px';
  modal.style.maxWidth = '90%';
  
  modal.innerHTML = `
    <h3 style="margin-top: 0; color: #0066ff;">Edit Amount</h3>
    <p>Current amount: $${currentAmount.toFixed(2)}</p>
    <div style="margin-bottom: 20px;">
      <label for="newAmount" style="display: block; margin-bottom: 8px; font-weight: 600;">New Amount ($):</label>
      <input type="number" id="newAmount" style="width: 100%; padding: 10px; border: 1px solid #ccc; border-radius: 5px;" 
             placeholder="Enter new amount" min="0" step="0.01" value="${currentAmount.toFixed(2)}">
      <div id="amountEditError" style="color: #d32f2f; font-size: 0.8em; margin-top: 5px; display: none;">
        Please enter a valid amount
      </div>
    </div>
    <div style="display: flex; justify-content: flex-end; gap: 10px;">
      <button id="cancelAmountEdit" style="padding: 10px 15px; border: none; border-radius: 5px; background-color: #f1f1f1; cursor: pointer;">
        Cancel
      </button>
      <button id="saveAmountEdit" style="padding: 10px 15px; border: none; border-radius: 5px; background-color: #0066ff; color: white; cursor: pointer;">
        Save Changes
      </button>
    </div>
  `;
  
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);
  
  // Set up event listeners for modal
  document.getElementById('cancelAmountEdit').addEventListener('click', () => {
    document.body.removeChild(backdrop);
  });
  
  document.getElementById('saveAmountEdit').addEventListener('click', async () => {
    const newAmountInput = document.getElementById('newAmount');
    const newAmount = parseFloat(newAmountInput.value);
    
    // Validate amount
    if (isNaN(newAmount) || newAmount < 0) {
      document.getElementById('amountEditError').style.display = 'block';
      return;
    }
    
    try {
      const saveButton = document.getElementById('saveAmountEdit');
      saveButton.disabled = true;
      saveButton.textContent = 'Saving...';

      // Choose endpoint based on whether it's an admin event or user request
      const endpoint = isAdminEvent ? 
        `/api/admin/events/update_amount/${requestId}` : 
        `/api/admin/requests/update_amount/${requestId}`;
      
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ 
          amount: newAmount 
        })
      });
      
      const result = await response.json();
      
      if (!response.ok) {
        throw new Error(result.error || 'Failed to update amount');
      }
      
      // Remove modal and refresh data
      document.body.removeChild(backdrop);
      showToast('Amount updated successfully', 'success');
      loadAllRequests();
    } catch (error) {
      console.error('Error updating amount:', error);
      showToast(`Error: ${error.message}`, 'error');
      document.getElementById('saveAmountEdit').disabled = false;
      document.getElementById('saveAmountEdit').textContent = 'Save Changes';
    }
  });
  
  // Focus on amount input
  document.getElementById('newAmount').focus();
}

/**
 * Set up action buttons for admin events
 */
function setupAdminEventButtons() {
  // Delete buttons
  document.querySelectorAll('.delete-event').forEach(button => {
    button.addEventListener('click', (e) => handleDeleteEvent(e, button));
  });
}

/**
 * Set up edit buttons for recurring events
 */
function setupRecurringEditButtons() {
  document.querySelectorAll('.edit-recurring').forEach(button => {
    button.addEventListener('click', (e) => handleEditRecurring(e, button));
  });
}

/**
 * Handle edit recurring event action
 */
function handleEditRecurring(e, button) {
  e.preventDefault();
  const requestId = button.dataset.requestId;
  const isAdmin = button.dataset.isAdmin === 'true';
  const item = button.closest('.request-item');
  const currentEndDate = item.dataset.endDate;
  
  // Get current date in EST timezone
  const now = new Date();
  const estNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const todayEST = estNow.toISOString().split('T')[0]; // Format as YYYY-MM-DD
  
  // Create modal backdrop
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.style.position = 'fixed';
  backdrop.style.top = '0';
  backdrop.style.left = '0';
  backdrop.style.width = '100%';
  backdrop.style.height = '100%';
  backdrop.style.backgroundColor = 'rgba(0,0,0,0.5)';
  backdrop.style.zIndex = '1000';
  backdrop.style.display = 'flex';
  backdrop.style.justifyContent = 'center';
  backdrop.style.alignItems = 'center';
  
  // Create modal content
  const modal = document.createElement('div');
  modal.className = 'edit-modal';
  modal.style.backgroundColor = 'white';
  modal.style.padding = '20px';
  modal.style.borderRadius = '5px';
  modal.style.boxShadow = '0 2px 10px rgba(0,0,0,0.1)';
  modal.style.width = '400px';
  modal.style.maxWidth = '90%';
  
  // Use the current start date or today's date (whichever is later) as the minimum date
  const minDate = new Date(item.dataset.startDate) > estNow ? 
                  item.dataset.startDate : 
                  todayEST;
  
  modal.innerHTML = `
    <h3>Edit End Date for Recurring Event</h3>
    <p>Current end date: ${currentEndDate}</p>
    <div style="margin-bottom: 15px;">
      <label for="newEndDate">New End Date:</label>
      <input type="date" id="newEndDate" class="form-control" value="${currentEndDate}" min="${minDate}">
    </div>
    <div style="display: flex; justify-content: flex-end; gap: 10px;">
      <button id="cancelEdit" class="btn">Cancel</button>
      <button id="saveEdit" class="btn btn-primary">Save Changes</button>
    </div>
  `;
  
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);
  
  // Set up event listeners for modal
  document.getElementById('cancelEdit').addEventListener('click', () => {
    document.body.removeChild(backdrop);
  });
  
  document.getElementById('saveEdit').addEventListener('click', async () => {
    const newEndDate = document.getElementById('newEndDate').value;
    
    if (!newEndDate) {
      alert('Please select a valid end date');
      return;
    }
    
    // Additional validation to ensure the selected date is not before today in EST
    if (new Date(newEndDate) < estNow) {
      alert('End date cannot be in the past');
      return;
    }
    
    if (new Date(newEndDate) < new Date(item.dataset.startDate)) {
      alert('End date cannot be before start date');
      return;
    }
    
    try {
      const saveButton = document.getElementById('saveEdit');
      saveButton.disabled = true;
      saveButton.textContent = 'Saving...';
      
      // Determine endpoint based on whether it's admin event or user request
      const endpoint = isAdmin ? 
        `/api/admin/events/update/${requestId}` : 
        `/api/admin/requests/update/${requestId}`;
      
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ 
          end_date: newEndDate 
        })
      });
      
      const result = await response.json();
      
      if (!response.ok) {
        throw new Error(result.error || 'Failed to update end date');
      } else {refreshCalendar();}
      
      // Remove modal and refresh data
      document.body.removeChild(backdrop);
      showToast('End date updated successfully', 'success');
      loadAllRequests();
    } catch (error) {
      console.error('Error updating end date:', error);
      showToast(`Error: ${error.message}`, 'error');
      document.getElementById('saveEdit').disabled = false;
      document.getElementById('saveEdit').textContent = 'Save Changes';
    }
  });
}

/**
 * Handle delete event action
 */
async function handleDeleteEvent(e, button) {
  e.preventDefault();
  const eventId = button.dataset.eventId;
  const eventItem = button.closest('.request-item');
  
  if (!confirm('Are you sure you want to delete this admin event? This cannot be undone.')) return;
  
  try {
    button.disabled = true;
    button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Deleting...';
    
    const response = await fetch(`/api/admin/events/delete/${eventId}`, {
      method: 'DELETE'
    });
    
    const result = await response.json();
    
    if (!response.ok) {
      throw new Error(result.error || 'Failed to delete event');
    } else {refreshCalendar();}
    
    // Remove the event from UI
    eventItem.remove();
    
    // Update counters
    const acceptedContainer = document.getElementById('acceptedRequests');
    if (acceptedContainer.querySelectorAll('.request-item').length === 0) {
      acceptedContainer.innerHTML = '<div class="no-requests">No requests found</div>';
    }
    
    showToast('Admin event deleted successfully', 'success');
  } catch (error) {
    console.error('Delete event error:', error);
    showToast(`Error: ${error.message}`, 'error');
    button.disabled = false;
    button.innerHTML = '<i class="fas fa-trash"></i> Delete';
  }
}

/**
 * Set up admin request controls (filters, search, etc.)
 */
function setupAdminRequestControls() {
  // Set up filter controls
  document.getElementById('filterStatus')?.addEventListener('change', (e) => {
    // Implement filter functionality
    console.log('Filter by status:', e.target.value);
  });
  
  // Set up search control
  document.getElementById('searchRequests')?.addEventListener('input', (e) => {
    // Implement search functionality
    console.log('Search:', e.target.value);
  });
}

/**
 * Helper function to handle fetch responses
 */
function handleResponse(response) {
  if (!response.ok) {
    throw new Error('Network response was not ok');
  }
  return response.json();
}

/**
 * Format request_date to Eastern Time
 */
function formatLocalTime(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString); // parsed as UTC

  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  }).format(date);
}

/**
 * Show loading state
 */
function showLoadingState(show) {
  const loader = document.getElementById('requestsLoader');
  const containers = document.querySelectorAll('.requests-container');
  
  if (loader) loader.style.display = show ? 'block' : 'none';
  containers.forEach(container => {
    container.style.display = show ? 'none' : 'block';
  });
}

/**
 * Show error state
 */
function showErrorState() {
  const containers = ['pendingRequests', 'acceptedRequests', 'declinedRequests'];
  containers.forEach(id => {
    const container = document.getElementById(id);
    if (container) {
      container.innerHTML = '<div class="no-requests error">Error loading requests. Please try again later.</div>';
    }
  });
}

/**
 * Update request counters in UI
 */
function updateRequestCounters(pendingCount, acceptedCount, declinedCount) {
  const pendingBadge = document.getElementById('pendingCountBadge');
  const acceptedBadge = document.getElementById('acceptedCountBadge');
  const declinedBadge = document.getElementById('declinedCountBadge');
  
  if (pendingBadge) pendingBadge.textContent = pendingCount;
  if (acceptedBadge) acceptedBadge.textContent = acceptedCount;
  if (declinedBadge) declinedBadge.textContent = declinedCount;
}

/**
 * Show amount prompt when approving a request
 */
function showAmountPrompt(requestId) {
  // Get request details
  const requestItem = document.querySelector(`.request-item[data-request-id="${requestId}"]`);
  const rentalName = requestItem.querySelector('.request-name').textContent.trim();
  const userEmail = requestItem.querySelector('.request-user')?.textContent.replace('User:', '').trim();
  const startDate = requestItem.dataset.startDate;
  const endDate = requestItem.dataset.endDate;
  
  // Create modal backdrop
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.style.position = 'fixed';
  backdrop.style.top = '0';
  backdrop.style.left = '0';
  backdrop.style.width = '100%';
  backdrop.style.height = '100%';
  backdrop.style.backgroundColor = 'rgba(0,0,0,0.5)';
  backdrop.style.zIndex = '1000';
  backdrop.style.display = 'flex';
  backdrop.style.justifyContent = 'center';
  backdrop.style.alignItems = 'center';
  
  // Create modal content
  const modal = document.createElement('div');
  modal.className = 'amount-modal';
  modal.style.backgroundColor = 'white';
  modal.style.padding = '25px';
  modal.style.borderRadius = '8px';
  modal.style.boxShadow = '0 4px 15px rgba(0,0,0,0.2)';
  modal.style.width = '400px';
  modal.style.maxWidth = '90%';
  
  modal.innerHTML = `
    <h3 style="margin-top: 0; color: #0066ff;">Approve Request</h3>
    <p>Rental: ${rentalName}</p>
    <p>Dates: ${startDate} to ${endDate}</p>
    <div style="margin-bottom: 20px;">
      <label for="amount" style="display: block; margin-bottom: 8px; font-weight: 600;">Amount ($):</label>
      <input type="number" id="approve_amount" style="width: 100%; padding: 10px; border: 1px solid #ccc; border-radius: 5px;" 
             placeholder="Enter amount" min="0" step="0.01" value="0.00">
      <div id="amountError" style="color: #d32f2f; font-size: 0.8em; margin-top: 5px; display: none;">
        Please enter a valid amount
      </div>
    </div>
    <div style="margin-bottom: 20px;">
      <label style="display: flex; align-items: center; cursor: pointer;">
        <input type="checkbox" id="sendEmailNotification" checked style="margin-right: 8px;">
        Send email notification to user
      </label>
    </div>
    <div style="display: flex; justify-content: flex-end; gap: 10px;">
      <button id="cancelApprove" style="padding: 10px 15px; border: none; border-radius: 5px; background-color: #f1f1f1; cursor: pointer;">
        Cancel
      </button>
      <button id="saveApprove" style="padding: 10px 15px; border: none; border-radius: 5px; background-color: #0066ff; color: white; cursor: pointer;">
        Approve Request
      </button>
    </div>
  `;
  
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);
  
  // Set up event listeners for modal
  document.getElementById('cancelApprove').addEventListener('click', () => {
    document.body.removeChild(backdrop);
  });
  
  document.getElementById('saveApprove').addEventListener('click', async () => {
    const amountInput = document.getElementById('approve_amount');
    const amount = parseFloat(amountInput.value);
    const sendEmail = document.getElementById('sendEmailNotification').checked;
    
    // Validate amount
    if (isNaN(amount) || amount < 0) {
      document.getElementById('amountError').style.display = 'block';
      return;
    }
    
    try {
      const saveButton = document.getElementById('saveApprove');
      saveButton.disabled = true;
      saveButton.textContent = 'Approving...';

      const response = await fetch(`/api/admin/approve_request/${requestId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ 
          amount: amount,
          sendEmail: sendEmail,
          rentalName: rentalName,
          startDate: startDate,
          endDate: endDate,
          userEmail: userEmail
        })
      });

      const result = await response.json();
      
      if (!response.ok) {
        throw new Error(result.error || 'Failed to approve request');
      } else {refreshCalendar();}
      
      // Remove modal and refresh data
      document.body.removeChild(backdrop);
      showToast('Request approved successfully' + (sendEmail ? ' and notification sent' : ''), 'success');
      loadAllRequests();
    } catch (error) {
      console.error('Error approving request:', error);
      showToast(`Error: ${error.message}`, 'error');
      document.getElementById('saveApprove').disabled = false;
      document.getElementById('saveApprove').textContent = 'Approve Request';
    }
  });
  
  // Focus on amount input
  document.getElementById('amount').focus();
}

/**
 * Set up decline buttons with email notification option
 */
function setupRequestActions() {
  // Approve buttons
  document.querySelectorAll('.approve-request').forEach(button => {
    button.addEventListener('click', async (e) => {
      e.preventDefault();
      const requestId = button.dataset.requestId;
      const hasStarted = button.closest('.request-item').dataset.hasStarted === 'true';
      
      // If event has started, show message and don't proceed
      if (hasStarted) {
        showToast('Cannot approve events that have already started or passed', 'error');
        return;
      }
      
      // Create and show the amount popup
      showAmountPrompt(requestId);
    });  
  });

  // Decline buttons - works for both pending and accepted requests
  document.querySelectorAll('.decline-request').forEach(button => {
    button.addEventListener('click', async (e) => {
      e.preventDefault();
      const requestId = button.dataset.requestId;
      const requestItem = button.closest('.request-item');
      const requestStatus = requestItem.dataset.requestStatus;
      const isAccepted = requestStatus === 'approved' || requestStatus === 'admin';
      const hasStarted = requestItem.dataset.hasStarted === 'true';
      const rentalName = requestItem.querySelector('.request-name').textContent.trim();
      const userEmail = requestItem.querySelector('.request-user')?.textContent.replace('User:', '').trim();
      const startDate = requestItem.dataset.startDate;
      const endDate = requestItem.dataset.endDate;
      
      // If event has started, show a message and don't proceed
      if (hasStarted & isAccepted) {
        showToast('Cannot decline events that have already started or passed', 'error');
        return;
      }

      // Create modal backdrop for decline reason
      const backdrop = document.createElement('div');
      backdrop.className = 'modal-backdrop';
      backdrop.style.position = 'fixed';
      backdrop.style.top = '0';
      backdrop.style.left = '0';
      backdrop.style.width = '100%';
      backdrop.style.height = '100%';
      backdrop.style.backgroundColor = 'rgba(0,0,0,0.5)';
      backdrop.style.zIndex = '1000';
      backdrop.style.display = 'flex';
      backdrop.style.justifyContent = 'center';
      backdrop.style.alignItems = 'center';
      
      // Create modal content
      const modal = document.createElement('div');
      modal.className = 'decline-modal';
      modal.style.backgroundColor = 'white';
      modal.style.padding = '25px';
      modal.style.borderRadius = '8px';
      modal.style.boxShadow = '0 4px 15px rgba(0,0,0,0.2)';
      modal.style.width = '400px';
      modal.style.maxWidth = '90%';
      
      // Different confirmation message based on status
      const confirmMessage = isAccepted ? 
        'Are you sure you want to decline this previously approved request?' : 
        'Are you sure you want to decline this request?';
      
      modal.innerHTML = `
        <h3 style="margin-top: 0; color: #dc3545;">Decline Request</h3>
        <p>${confirmMessage}</p>
        <p>Rental: ${rentalName}</p>
        <p>Dates: ${startDate} to ${endDate}</p>
        <div style="margin-bottom: 20px;">
          <label for="declineReason" style="display: block; margin-bottom: 8px; font-weight: 600;">Reason for declining:</label>
          <textarea id="declineReason" style="width: 100%; padding: 10px; border: 1px solid #ccc; border-radius: 5px; min-height: 80px;" 
                   placeholder="Please provide a reason for declining this request"></textarea>
          <div id="reasonError" style="color: #d32f2f; font-size: 0.8em; margin-top: 5px; display: none;">
            Please provide a reason for declining
          </div>
        </div>
        <div style="margin-bottom: 20px;">
          <label style="display: flex; align-items: center; cursor: pointer;">
            <input type="checkbox" id="sendDeclineEmail" checked style="margin-right: 8px;">
            Send email notification to user with reason
          </label>
        </div>
        <div style="display: flex; justify-content: flex-end; gap: 10px;">
          <button id="cancelDecline" style="padding: 10px 15px; border: none; border-radius: 5px; background-color: #f1f1f1; cursor: pointer;">
            Cancel
          </button>
          <button id="confirmDecline" style="padding: 10px 15px; border: none; border-radius: 5px; background-color: #dc3545; color: white; cursor: pointer;">
            Decline Request
          </button>
        </div>
      `;
      
      backdrop.appendChild(modal);
      document.body.appendChild(backdrop);
      
      // Set up event listeners for modal
      document.getElementById('cancelDecline').addEventListener('click', () => {
        document.body.removeChild(backdrop);
      });
      
      document.getElementById('confirmDecline').addEventListener('click', async () => {
        const reasonInput = document.getElementById('declineReason');
        const reason = reasonInput.value.trim();
        const sendEmail = document.getElementById('sendDeclineEmail').checked;
        
        // Validate reason
        if (!reason) {
          document.getElementById('reasonError').style.display = 'block';
          return;
        }
        
        try {
          const declineButton = document.getElementById('confirmDecline');
          declineButton.disabled = true;
          declineButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Declining...';
          
          const response = await fetch(`/api/admin/decline_request/${requestId}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ 
              reason: reason,
              sendEmail: sendEmail,
              rentalName: rentalName,
              startDate: startDate,
              endDate: endDate,
              userEmail: userEmail
            })
          });
          
          const result = await response.json();
          
          if (!response.ok) {
            throw new Error(result.error || 'Failed to decline request');
          }
          
          // Remove modal and refresh data
          document.body.removeChild(backdrop);
          showToast('Request declined successfully' + (sendEmail ? ' and notification sent' : ''), 'success');
          loadAllRequests();
        } catch (error) {
          console.error('Error declining request:', error);
          showToast(`Error: ${error.message}`, 'error');
          document.getElementById('confirmDecline').disabled = false;
          document.getElementById('confirmDecline').innerHTML = 'Decline Request';
        }
      });
      
      // Focus on reason input
      document.getElementById('declineReason').focus();
    });
  });
}

/**
 * Set up invoice send buttons
 */
function setupInvoiceButtons() {
  document.querySelectorAll('.send-invoice').forEach(button => {
    button.addEventListener('click', async (e) => {
      e.preventDefault();
      
      const requestId = button.dataset.requestId;
      const userEmail = button.dataset.userEmail;
      const amount = parseFloat(button.dataset.amount);
      
      // Get additional details from the parent request item
      const requestItem = button.closest('.request-item');
      const rentalName = requestItem.querySelector('.request-name').textContent.trim().split('(')[0].trim();
      const startDate = requestItem.dataset.startDate;
      const endDate = requestItem.dataset.endDate;
      
      if (isNaN(amount) || amount <= 0) {
        showToast('Cannot send invoice with invalid amount', 'error');
        return;
      }
      
      if (!userEmail) {
        showToast('No user email found for this request', 'error');
        return;
      }
      
      if (confirm(`Send an invoice for $${amount.toFixed(2)} to ${userEmail}?`)) {
        try {
          button.disabled = true;
          button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';
          
          const response = await fetch('/api/admin/send_invoice', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              request_id: requestId,
              user_email: userEmail,
              amount: amount,
              rental_name: rentalName,
              start_date: startDate,
              end_date: endDate
            })
          });
          
          const result = await response.json();
          
          if (!response.ok) {
            throw new Error(result.error || 'Failed to send invoice');
          }
          
          // If already paid or successfully sent
          if (result.paid) {
            button.classList.add('invoice-sent');
            button.disabled = true;
            button.innerHTML = '<i class="fas fa-check"></i> Paid';
            showToast('This request has already been paid', 'success');
          } else {
            button.classList.add('invoice-sent');
            button.innerHTML = '<i class="fas fa-check"></i> Invoice Sent';
            showToast('Invoice sent successfully', 'success');
          }
        } catch (error) {
          console.error('Error sending invoice:', error);
          showToast(`Error: ${error.message}`, 'error');
          button.disabled = false;
          button.innerHTML = '<i class="fas fa-paper-plane"></i> Send Invoice';
        }
      }
    });
  });
}

/**
 * Set up mark as paid buttons
 */
function setupMarkPaidButtons() {
  document.querySelectorAll('.mark-paid').forEach(button => {
    button.addEventListener('click', async (e) => {
      e.preventDefault();
      const requestId = button.dataset.requestId;
      const requestItem = button.closest('.request-item');
      const rentalName = requestItem.querySelector('.request-name').textContent.trim();
      
      if (confirm(`Mark this request for ${rentalName} as paid?`)) {
        try {
          button.disabled = true;
          button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Updating...';
          
          const response = await fetch(`/api/admin/mark_paid/${requestId}`, {
            method: 'POST'
          });
          
          const result = await response.json();
          
          if (!response.ok) {
            throw new Error(result.error || 'Failed to mark as paid');
          }
          
          // Update UI
          button.innerHTML = '<i class="fas fa-check-circle"></i> Paid';
          button.classList.add('disabled');
          
          // Add paid badge and remove unpaid badge
          const paidBadge = document.createElement('span');
          paidBadge.className = 'paid-badge';
          paidBadge.textContent = 'Paid';
          
          const unpaidBadge = requestItem.querySelector('.unpaid-badge');
          if (unpaidBadge) {
            unpaidBadge.replaceWith(paidBadge);
          }
          
          // Disable invoice button if it exists
          const invoiceButton = requestItem.querySelector('.send-invoice');
          if (invoiceButton) {
            invoiceButton.disabled = true;
            invoiceButton.innerHTML = '<i class="fas fa-check"></i> Paid';
            invoiceButton.classList.add('invoice-sent');
          }
          
          showToast('Request marked as paid successfully', 'success');
        } catch (error) {
          console.error('Error marking as paid:', error);
          showToast(`Error: ${error.message}`, 'error');
          button.disabled = false;
          button.innerHTML = '<i class="fas fa-check-circle"></i> Mark Paid';
        }
      }
    });
  });
}

/**
 * Show toast notification
 */
function showToast(message, type = 'info') {
  const bgColor = {
    success: "#28a745",
    error: "#dc3545",
    info: "#007bff",
    warning: "#ffc107"
  }[type] || "#007bff";

  Toastify({
    text: message,
    duration: 3000,
    close: true,
    gravity: "top", 
    position: "right",
    backgroundColor: bgColor,
    stopOnFocus: true
  }).showToast();
}

function refreshCalendar() {
  const oldScript = document.querySelector('script[src*="calendar.js"]');

  if (oldScript) {
    const newScript = document.createElement('script');
    newScript.src = oldScript.src.includes('?') 
      ? `${oldScript.src}&refresh=${Date.now()}`
      : `${oldScript.src}?refresh=${Date.now()}`;

    if (oldScript.id) {
      newScript.id = oldScript.id;
    }

    newScript.onload = () => {
      console.log('✅ Calendar script reloaded');

      // Wait a tick and re-initialize the calendar class
      if (typeof IceRinkCalendar !== 'undefined') {
        new IceRinkCalendar();
        console.log('🔄 Calendar reinitialized');
      } else {
        console.error('❌ IceRinkCalendar not found after reload');
      }
    };

    oldScript.parentNode.replaceChild(newScript, oldScript);
  } else {
    console.warn('⚠️ Calendar script not found');
  }
}


// Initialize the module when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  initAdminRequestsModule();
  // Add click handler for user search button
  const userSearchBtn = document.getElementById('userSearchBtn');
  if (userSearchBtn) {
      userSearchBtn.addEventListener('click', function() {
          window.location.href = '/user_search'; // Redirect to user search page
      });
  }
});

