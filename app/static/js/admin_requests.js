/**
 * Initialize the admin requests module
 */
function initAdminRequestsModule() {
  // Load all requests and events for admin view
  loadAllRequests();
  
  // Set up admin-specific event listeners
  setupAdminRequestControls();
}

/**
 * Load all rental requests and admin events
 */
function loadAllRequests() {
  // Show loading state
  showLoadingState(true);
  
  // Load both rental requests and admin events in parallel
  Promise.all([
    fetch('/api/admin/requests').then(handleResponse),
    fetch('/api/admin/events').then(handleResponse)
  ])
  .then(([requestsData, eventsData]) => {
    // Process rental requests
    const requests = Array.isArray(requestsData.requests) ? requestsData.requests : [];
    const pending = requests.filter(r => r.request_status === 'pending');
    const acceptedRequests = requests.filter(r => r.request_status === 'approved');
    const declined = requests.filter(r => r.request_status === 'declined');
    
    // Process admin events (all are considered accepted)
    const adminEvents = Array.isArray(eventsData.events) ? eventsData.events : [];
    const acceptedEvents = adminEvents.map(event => ({
      ...event,
      request_id: event.event_id, // Map event_id to request_id for consistency
      request_status: 'approved',
      is_admin_event: true
    
    }));
    
    // Combine accepted requests and admin events, sorted by date
    const allAccepted = [...acceptedRequests, ...acceptedEvents].sort((a, b) => {
      return new Date(a.start_date) - new Date(b.start_date);
    });
    
    // Render all sections
    renderAdminRequests(pending, 'pendingRequests');
    renderAdminRequests(allAccepted, 'acceptedRequests');
    renderAdminDeclinedRequests(declined, 'declinedRequests');
    
    // Update UI counters
    updateRequestCounters(pending.length, allAccepted.length, declined.length);
    
    // Set up action buttons after rendering all sections
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

/**
 * Check if event has already started or passed
 * Returns true if the event has started or passed
 */
function isEventStartedOrPassed(startDate, startTime) {
  if (!startDate || !startTime) return false;

  const now = new Date();
  const estNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  
  // Parse the date (MM/DD/YYYY format)
  let year, month, day;
  if (startDate.includes('/')) {
    // MM/DD/YYYY format
    [month, day, year] = startDate.split('/').map(Number);
  } else {
    // YYYY-MM-DD format
    [year, month, day] = startDate.split('-').map(Number);
  }
  
  // Parse the time (HH:MM AM/PM format)
  let [time, period] = startTime.split(' ');
  let [hours, minutes] = time.split(':').map(Number);
  if (period === 'PM' && hours < 12) hours += 12;
  if (period === 'AM' && hours === 12) hours = 0;
  
  // Create the event date in EST
  const eventDateTime = new Date(year, month - 1, day, hours, minutes);
  
  return estNow >= eventDateTime;
}

/**
 * Check if event is past its end date
 * Returns true if today is past the event's end date
 */
function isEventPastEndDate(endDate) {
  if (!endDate) return false;
  
  const now = new Date();
  const estNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  
  // Parse the end date (normalize format)
  let year, month, day;
  if (endDate.includes('/')) {
    // MM/DD/YYYY format
    [month, day, year] = endDate.split('/').map(Number);
  } else {
    // YYYY-MM-DD format
    [year, month, day] = endDate.split('-').map(Number);
  }
  
  // Create end date in EST
  const eventEndDate = new Date(year, month - 1, day, 23, 59, 59);
  
  return estNow > eventEndDate;
}

/**
 * Render declined requests
 */
function renderAdminDeclinedRequests(requests, containerId) {
  const container = document.getElementById(containerId);
  
  if (!requests || requests.length === 0) {
    container.innerHTML = '<div class="no-requests">No declined requests found</div>';
    return;
  }
  
  let html = '';
  requests.forEach(request => {
    const startDate = request.start_date;
    const endDate = request.end_date;
    const formattedRequestDate = formatLocalTime(request.request_date);

    html += 
      `<div class="request-item" data-request-id="${request.request_id}">
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
        ${request.additional_desc ? 
          `<div class="request-desc">
            ${request.additional_desc}
          </div>`
         : ''}
        <div class="declined-reason">
          <strong>Reason:</strong> ${request.declined_reason || 'No reason provided'}
        </div>
        <div class="request-footer">
          <div class="request-meta">
            <span class="request-date">Submitted: ${formattedRequestDate}</span>
            ${request.user_email ? 
              `<span class="request-user">User: ${request.user_email}</span>`
             : ''}
          </div>
        </div>
      </div>`
    ;
  });
  
  container.innerHTML = html;
}

/**
 * Render requests (pending or accepted)
 */
function renderAdminRequests(requests, containerId) {
  const container = document.getElementById(containerId);
  const isAcceptedView = containerId === 'acceptedRequests';

  if (!requests || requests.length === 0) {
    container.innerHTML = '<div class="no-requests">No requests found</div>';
    return;
  }

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

    let canEditAmount = false;
    if (!isPending && !isAdminEvent && !isPaid) {  // <-- don't allow editing if paid
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
           data-amount="${request.amount || 0}">
        <div class="request-header">
          <div class="header-left">
            <span class="request-name">
              ${request.rental_name || request.event_name} 
              ${request.user_name ? `<span class="user-name">(${request.user_name})</span>` : ''}
              ${isRecurring ? '<span class="recurring-badge">Recurring</span>' : ''}
              ${isAdminEvent ? '<span class="admin-badge">Admin Event</span>' : ''}
              ${isAcceptedView && isPaid ? '<span class="paid-badge">Paid</span>' : ''}  <!-- NEW: Paid badge -->
            </span>
          </div>
          <div class="header-right">
            ${isAcceptedView && !isAdminEvent && parseFloat(request.amount) > 0 ? `
              <div class="request-invoice">
                <button 
                  class="btn btn-invoice send-invoice ${isPaid ? 'invoice-sent' : ''}" 
                  data-request-id="${request.request_id}" 
                  data-user-email="${request.user_email}" 
                  data-amount="${request.amount || 0}"
                  ${isPaid ? 'disabled' : ''}
                >
                  <i class="fas fa-paper-plane"></i> Send Invoice
                </button>
              </div>` 
            : ''}
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
              <button 
                class="btn btn-sm btn-edit-amount edit-amount" 
                data-request-id="${request.request_id}"
                ${isPaid ? 'disabled' : ''}
              >
                <i class="fas fa-edit"></i>
              </button>
            ` : ''}
          </div>` 
        : ''}

        ${request.additional_desc || request.description ? `
          <div class="request-desc">
            ${request.additional_desc || request.description}
          </div>` 
        : ''}

        <div class="request-footer">
          <div class="request-meta">
            <span class="request-date">
              ${isAdminEvent ? 'Created' : 'Submitted'}: ${formattedRequestDate}
              ${!isAdminEvent ? `
                <span class="request-user">User: ${request.user_email}</span>
                <span class="request-phone">Phone: ${request.user_phone}</span>` 
              : ''}
            </span>
          </div>

          ${isPending ? `
            <div class="request-actions">
              ${!hasStarted ? `
                <button class="btn btn-approve approve-request" data-request-id="${request.request_id}">
                  <i class="fas fa-check"></i> Approve
                </button>` 
              : ''}
              <button class="btn btn-decline decline-request" data-request-id="${request.request_id}">
                <i class="fas fa-times"></i> Decline
              </button>
            </div>`
          : `
            <div class="request-actions">
              ${isRecurring && !isPastEndDate ? `
                <button class="btn btn-edit edit-recurring" data-request-id="${request.request_id}" data-is-admin="${isAdminEvent}">
                  <i class="fas fa-edit"></i> Edit
                </button>` 
              : ''}
              ${isAdminEvent && !hasStarted ? `
                <button class="btn btn-delete delete-event" data-event-id="${request.request_id}">
                  <i class="fas fa-trash"></i> Delete
                </button>` 
              : !isAdminEvent ? `
                <button class="btn btn-decline decline-request" data-request-id="${request.request_id}">
                  <i class="fas fa-times"></i> Decline
                </button>` 
              : ''}
            </div>`}
        </div>
      </div>
    `;
  });

  container.innerHTML = html;

  if (containerId === 'acceptedRequests') {
    setupAdminEventButtons();
    setupRecurringEditButtons();
    setupAmountEditButtons();
    setupInvoiceButtons();

    const style = document.createElement('style');
    style.textContent = `
      .amount-value {
        color: #0275d8;
        font-weight: 600;
        font-size: 1.05em;
        padding: 2px 6px;
        border-radius: 4px;
        background-color: rgba(2, 117, 216, 0.05);
      }

      .paid-badge {
        background-color: #28a745;
        color: white;
        padding: 2px 8px;
        border-radius: 12px;
        font-size: 0.75em;
        margin-left: 6px;
      }

      .request-amount {
        margin: 8px 0;
        padding: 2px 0;
        display: flex;
        align-items: center;
      }

      .request-amount .btn-edit-amount {
        margin-left: 10px;
        padding: 2px 8px;
        font-size: 0.8em;
      }

      .btn-edit-amount {
        background-color: #17a2b8;
        color: white;
        border-color: #17a2b8;
      }

      .btn-edit-amount:hover {
        background-color: #138496;
        border-color: #117a8b;
      }

      .btn-edit {
        background-color: #f8f9fa;
        color: #495057;
        border: 1px solid #ced4da;
      }

      .btn-edit:hover {
        background-color: #e2e6ea;
        border-color: #dae0e5;
      }

      .btn-invoice {
        background-color: #005082;
        color: white;
        border-color: #005082;
        padding: 4px 8px;
        font-size: 14px;
      }

      .btn-invoice:hover {
        background-color: #003c5f;
        border-color: #002c46;
      }

      .invoice-sent {
        background-color: #6c757d;
        border-color: #6c757d;
      }
    `;
    document.head.appendChild(style);
  }
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
  
  // Add CSS for buttons and badges
  const style = document.createElement('style');
  style.textContent = `
    .btn-delete, .btn-decline {
      background-color: #dc3545 !important;
      color: white !important;
      border-color: #dc3545 !important;
    }
    .btn-delete:hover, .btn-decline:hover {
      background-color: #c82333 !important;
      border-color: #bd2130 !important;
    }
    .modal-backdrop {
      backdrop-filter: blur(2px);
    }
    .event-started {
      position: relative;
    }
    .event-started::after {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background-color: rgba(108, 117, 125, 0.05);
      pointer-events: none;
    }
  `;
  document.head.appendChild(style);
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
 * Set up action buttons for requests
 * This is called once after rendering all requests
 */
function setupRequestActions() {
  // Approve buttons
  document.querySelectorAll('.approve-request').forEach(button => {
    button.addEventListener('click', async (e) => {
      e.preventDefault();
      const requestId = button.dataset.requestId;
      const hasStarted = button.dataset.hasStarted === 'true';
      
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
      const isAccepted = requestItem.querySelector('.status-approved') !== null;
      const hasStarted = button.dataset.hasStarted === 'true';
      
      // If event has started, show a message and don't proceed
      if (hasStarted) {
        showToast('Cannot decline events that have already started or passed', 'error');
        return;
      }
      
      // Different confirmation message based on status
      const confirmMessage = isAccepted ? 
        'Are you sure you want to decline this previously approved request?' : 
        'Are you sure you want to decline this request?';
      
      const reason = prompt('Please enter a reason for declining this request:');
      if (reason === null) return; // User cancelled
      if (!reason.trim()) {
        alert('Please provide a reason for declining');
        return;
      }
      
      if (confirm(confirmMessage)) {
        try {
          button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Declining...';
          button.disabled = true;
          
          const response = await fetch(`/api/admin/decline_request/${requestId}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ reason: reason.trim() })
          });
          
          const result = await response.json();
          
          if (!response.ok) {
            throw new Error(result.error || 'Failed to decline request');
          }
          
          // Refresh the requests view
          loadAllRequests();
          showToast('Request declined successfully', 'success');
        } catch (error) {
          console.error('Error declining request:', error);
          showToast(`Error: ${error.message}`, 'error');
          button.innerHTML = '<i class="fas fa-times"></i> Decline';
          button.disabled = false;
        }
      }
    });
  });
}

/**
 * Show amount prompt for approval
 */
function showAmountPrompt(requestId) {
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
    <h3 style="margin-top: 0; color: #0066ff;">Add Amount for Request</h3>
    <p>Please specify the amount to charge for this rental request:</p>
    <div style="margin-bottom: 20px;">
      <label for="requestAmount" style="display: block; margin-bottom: 8px; font-weight: 600;">Amount ($):</label>
      <input type="number" id="requestAmount" style="width: 100%; padding: 10px; border: 1px solid #ccc; border-radius: 5px;" placeholder="Enter amount" min="0" step="0.01">
      <div id="amountError" style="color: #d32f2f; font-size: 0.8em; margin-top: 5px; display: none;">Please enter a valid amount</div>
    </div>
    <div style="display: flex; justify-content: flex-end; gap: 10px;">
      <button id="cancelApproval" style="padding: 10px 15px; border: none; border-radius: 5px; background-color: #f1f1f1; cursor: pointer;">Cancel</button>
      <button id="confirmApproval" style="padding: 10px 15px; border: none; border-radius: 5px; background-color: #0066ff; color: white; cursor: pointer;">Approve</button>
    </div>
  `;
  
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);
  
  // Add event listeners
  document.getElementById('cancelApproval').addEventListener('click', () => {
    document.body.removeChild(backdrop);
  });
  
  document.getElementById('confirmApproval').addEventListener('click', async () => {
    const amountInput = document.getElementById('requestAmount');
    const amount = parseFloat(amountInput.value);
    
    // Validate amount
    if (isNaN(amount) || amount < 0) {
      document.getElementById('amountError').style.display = 'block';
      return;
    }
    
    // Hide error if previously shown
    document.getElementById('amountError').style.display = 'none';
    
    try {
      const confirmButton = document.getElementById('confirmApproval');
      confirmButton.disabled = true;
      confirmButton.textContent = 'Processing...';
      confirmButton.style.backgroundColor = '#cccccc';
      
      // Call API to approve the request with amount
      const response = await fetch(`/api/admin/approve_request/${requestId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ amount: amount })
      });
      
      const result = await response.json();
      
      if (!response.ok) {
        throw new Error(result.error || 'Failed to approve request');
      }
      
      // Close modal
      document.body.removeChild(backdrop);
      
      // Refresh requests and show success message
      loadAllRequests();
      showToast('Request approved successfully', 'success');
    } catch (error) {
      console.error('Error approving request:', error);
      showToast(`Error: ${error.message}`, 'error');
      
      // Reset button
      const confirmButton = document.getElementById('confirmApproval');
      confirmButton.disabled = false;
      confirmButton.textContent = 'Approve';
      confirmButton.style.backgroundColor = '#0066ff';
    }
  });
  
  // Focus on amount input
  document.getElementById('requestAmount').focus();
}

/**
 * Set up invoice buttons for accepted requests
 */
function setupInvoiceButtons() {
  document.querySelectorAll('.send-invoice').forEach(button => {
    button.addEventListener('click', (e) => handleSendInvoice(e, button));
  });
}

/**
 * Handle sending invoice
 */
async function handleSendInvoice(e, button) {
  e.preventDefault();
  e.stopPropagation();
  
  const requestId = button.dataset.requestId;
  const userEmail = button.dataset.userEmail;
  const amount = parseFloat(button.dataset.amount);
  const requestItem = button.closest('.request-item');
  const rentalName = requestItem.querySelector('.request-name').textContent.trim();
  const startDate = requestItem.dataset.startDate;
  const endDate = requestItem.dataset.endDate;
  
  if (!userEmail) {
    showToast('No email found for this user', 'error');
    return;
  }
  
  if (isNaN(amount) || amount <= 0) {
    showToast('Invalid amount for invoice', 'error');
    return;
  }
  
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
    
    // Update UI to show invoice sent
    button.innerHTML = '<i class="fas fa-check"></i> Invoice Sent';
    button.classList.add('invoice-sent');
    
    // Re-enable after a short delay
    setTimeout(() => {
      button.disabled = false;
      button.innerHTML = '<i class="fas fa-paper-plane"></i> Send Invoice';
      button.classList.remove('invoice-sent');
    }, 5000);
    
    showToast('Invoice sent successfully to ' + userEmail, 'success');
  } catch (error) {
    console.error('Error sending invoice:', error);
    showToast(`Error: ${error.message}`, 'error');
    button.disabled = false;
    button.innerHTML = '<i class="fas fa-paper-plane"></i> Send Invoice';
  }
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
});

