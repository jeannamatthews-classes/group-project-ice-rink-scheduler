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
  
  if (!requests || requests.length === 0) {
    container.innerHTML = '<div class="no-requests">No requests found</div>';
    return;
  }
  
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
    
    html += 
      `<div class="request-item ${isAdminEvent ? 'admin-event' : ''} ${hasStarted ? 'event-started' : ''}" 
           data-request-id="${request.request_id}"
           data-is-admin-event="${isAdminEvent}"
           data-is-recurring="${isRecurring}"
           data-start-date="${startDate}"
           data-end-date="${endDate}"
           data-start-time="${startTime}"
           data-has-started="${hasStarted}"
           data-past-end-date="${isPastEndDate}">
        <div class="request-header">
          <span class="request-name">
            ${request.rental_name || request.event_name} 
            ${request.user_name ? `<span class="user-name">(${request.user_name})</span>` : ''}
            ${isRecurring ? '<span class="recurring-badge">Recurring</span>' : ''}
            ${isAdminEvent ? '<span class="admin-badge">Admin Event</span>' : ''}
          </span>

        </div>
        <div class="request-dates">
          ${startDate} ${startDate !== endDate ? `to ${endDate}` : ''}
        </div>
        <div class="request-time">
          ${startTime} - ${request.end_time}
        </div>
        ${request.additional_desc || request.description ? 
          `<div class="request-desc">
            ${request.additional_desc || request.description}
          </div>`
         : ''}
        <div class="request-footer">
          <div class="request-meta">
            <span class="request-date">
              ${isAdminEvent ? 'Created' : 'Submitted'}: ${formattedRequestDate}
            </span>
            ${request.user_email ? 
              `<span class="request-user">User: ${request.user_email}</span>`
             : ''}
          </div>
          
          ${isPending ? 
            `<div class="request-actions">
              ${!hasStarted ? 
                `<button class="btn btn-approve approve-request" data-request-id="${request.request_id}">
                  <i class="fas fa-check"></i> Approve
                </button>` 
              : ''}
              <button class="btn btn-decline decline-request" data-request-id="${request.request_id}">
                <i class="fas fa-times"></i> Decline
              </button>
            </div>`
           : ''}
          
          ${!isPending ? 
            `<div class="request-actions">
              ${isRecurring && !isPastEndDate ? 
                `<button class="btn btn-edit edit-recurring" data-request-id="${request.request_id}" data-is-admin="${isAdminEvent}">
                  <i class="fas fa-edit"></i> Edit
                </button>` 
              : ''}
              ${isAdminEvent && !hasStarted ? 
                `<button class="btn btn-delete delete-event" data-event-id="${request.request_id}">
                  <i class="fas fa-trash"></i> Delete
                </button>`
              : 
                // Always show decline button for approved user requests
                !isAdminEvent ? 
                `<button class="btn btn-decline decline-request" data-request-id="${request.request_id}">
                  <i class="fas fa-times"></i> Decline
                </button>` 
              : ''}
            </div>`
           : ''}
        </div>
      </div>`
    ;
  });
  
  container.innerHTML = html;
  
  // Set up admin event buttons if needed
  if (containerId === 'acceptedRequests') {
    setupAdminEventButtons();
    setupRecurringEditButtons();
  }
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
      
      if (confirm('Are you sure you want to approve this request?')) {
        try {
          button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Approving...';
          button.disabled = true;
          
          const response = await fetch(`/api/admin/approve_request/${requestId}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            }
          });
          
          const result = await response.json();
          
          if (!response.ok) {
            throw new Error(result.error || 'Failed to approve request');
          } else {refreshCalendar();}
          
          // Refresh the requests view
          loadAllRequests();
          showToast('Request approved successfully', 'success');
        } catch (error) {
          console.error('Error approving request:', error);
          showToast(`Error: ${error.message}`, 'error');
          button.innerHTML = '<i class="fas fa-check"></i> Approve';
          button.disabled = false;
        }
      }
    });
  });

  // Decline buttons
  document.querySelectorAll('.decline-request').forEach(button => {
    button.addEventListener('click', async (e) => {
      e.preventDefault();
      const requestId = button.dataset.requestId;
      const requestItem = button.closest('.request-item');
      const isAccepted = requestItem.querySelector('.status-approved') !== null;
      
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
          } else {refreshCalendar();}
          
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

