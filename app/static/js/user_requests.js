function initRequestsModule(user) {
  // Load user requests
  loadUserRequests(user.uid);

  // Set up form event listeners
  setupRequestForm();
}

function loadUserRequests(firebase_uid) {
  fetch(`/api/user_requests/${firebase_uid}`)
    .then(response => {
      if (!response.ok) {
        throw new Error('Network response was not ok');
      }
      return response.json();
    })
    .then(data => {
      if (data.error) {
        throw new Error(data.error);
      }

      // Ensure data is in proper format
      const requests = Array.isArray(data.requests) ? data.requests : [];

      const pending = requests.filter(r => r.request_status === 'pending');
      const accepted = requests.filter(r => r.request_status === 'approved'  || r.request_status === 'admin');
      const declined = requests.filter(r => r.request_status === 'declined');

      renderRequests(pending, 'pendingRequests');
      renderRequests(accepted, 'acceptedRequests');
      renderDeclinedRequests(declined, 'declinedRequests');
    })
    .catch(error => {
      console.error("Error loading requests:", error);
      document.getElementById('pendingRequests').innerHTML =
        '<div class="no-requests">Error loading requests. Please try again later.</div>';
      document.getElementById('acceptedRequests').innerHTML =
        '<div class="no-requests">Error loading requests. Please try again later.</div>';
      document.getElementById('declinedRequests').innerHTML =
        '<div class="no-requests">Error loading requests. Please try again later.</div>';

      Toastify({
        text: "Failed to load requests",
        duration: 4000,
        gravity: "top",
        position: "right",
        backgroundColor: "#f44336"
      }).showToast();
    });
}

function renderDeclinedRequests(requests, containerId) {
  const container = document.getElementById(containerId);

  if (!requests || requests.length === 0) {
    container.innerHTML = '<div class="no-requests">No declined requests found</div>';
    return;
  }

  container.innerHTML = `
    <div class="filter-controls">
      <label for="${containerId}-month">Filter:</label>
      <select class="month-filter" id="${containerId}-month"></select>
      <select class="year-filter" id="${containerId}-year"></select>
    </div>
    <div class="request-list" id="${containerId}-list"></div>
  `;

  let html = '';
  requests.forEach(request => {
    const startDateObj = new Date(request.start_date);
    const endDateObj = new Date(request.end_date);
    const startDate = startDateObj.toLocaleDateString();
    const endDate = endDateObj.toLocaleDateString();
    const formattedRequestDate = formatLocalTime(request.request_date);

    html += `
      <div class="request-item" data-request-id="${request.request_id}" data-start-date="${startDateObj.toISOString()}">
        <div class="request-header">
          <span class="request-name">
            ${request.rental_name}
            ${request.is_recurring ? '<span class="recurring-badge">Recurring</span>' : ''}
            ${request.request_status === 'admin' ? '<span class="admin-badge">Admin Event</span>' : ''}
          </span>
          <span class="request-status status-declined">Declined</span>
        </div>
        <div class="request-dates">
          ${startDate} ${startDate !== endDate ? `to ${endDate}` : ''}
        </div>
        <div class="request-time">
          ${request.start_time} - ${request.end_time}
        </div>
        ${request.additional_desc ? `
          <div class="request-desc">
            ${request.additional_desc}
          </div>` : ''}
        <div class="declined-reason">
          <strong>Reason:</strong> ${request.declined_reason || 'No reason provided'}
        </div>
        <div class="request-footer">
          <div class="request-date">Submitted: ${formattedRequestDate}</div>
        </div>
      </div>
    `;
  });

  document.getElementById(`${containerId}-list`).innerHTML = html;

  populateMonthYearFilters(containerId, requests);
  document.getElementById(`${containerId}-month`).addEventListener('change', () => filterRequests(containerId));
  document.getElementById(`${containerId}-year`).addEventListener('change', () => filterRequests(containerId));
}

function renderRequests(requests, containerId) {
  const container = document.getElementById(containerId);
  const user = auth.currentUser;

  if (!requests || requests.length === 0) {
    container.innerHTML = '<div class="no-requests">No requests found</div>';
    return;
  }

  container.innerHTML = `
    <div class="filter-controls">
      <label for="${containerId}-month">Filter:</label>
      <select class="month-filter" id="${containerId}-month"></select>
      <select class="year-filter" id="${containerId}-year"></select>
    </div>
    <div class="request-list" id="${containerId}-list"></div>
  `;

  let html = '';
  requests.forEach(request => {
    const startDateObj = new Date(request.start_date);
    const endDateObj = new Date(request.end_date);
    const startDate = startDateObj.toLocaleDateString();
    const endDate = endDateObj.toLocaleDateString();
    const formattedRequestDate = formatLocalTime(request.request_date);

    html += `
      <div class="request-item" data-request-id="${request.request_id}" data-start-date="${startDateObj.toISOString()}">
        <div class="request-header">
          <span class="request-name">
            ${request.rental_name}
            ${request.is_recurring ? '<span class="recurring-badge">Recurring</span>' : ''}
          </span>
          <span class="request-status ${request.request_status === 'pending' ? 'status-pending' : 'status-approved'}">
            ${request.request_status}
          </span>
        </div>
        <div class="request-dates">
          ${startDate} ${startDate !== endDate ? `to ${endDate}` : ''}
        </div>
        <div class="request-time">
          ${request.start_time} - ${request.end_time}
        </div>
        ${request.additional_desc ? `
          <div class="request-desc">
            ${request.additional_desc}
          </div>` : ''}
        <div class="request-footer">
          <div class="request-date">Submitted: ${formattedRequestDate}</div>
          ${request.request_status === 'pending' ? `
            <button class="delete-request" data-request-id="${request.request_id}">
              <i class="fas fa-trash"></i> Delete
            </button>` : ''}
        </div>
      </div>
    `;
  });

  document.getElementById(`${containerId}-list`).innerHTML = html;

  setupDeleteButtons();
  populateMonthYearFilters(containerId, requests);
  document.getElementById(`${containerId}-month`).addEventListener('change', () => filterRequests(containerId));
  document.getElementById(`${containerId}-year`).addEventListener('change', () => filterRequests(containerId));
}

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
  const month = parseInt(document.getElementById(`${containerId}-month`).value);
  const year = parseInt(document.getElementById(`${containerId}-year`).value);
  const items = document.querySelectorAll(`#${containerId}-list .request-item`);

  let anyVisible = false;

  items.forEach(item => {
    const dateStr = item.getAttribute('data-start-date');
    if (!dateStr) return item.style.display = 'none';
    const date = new Date(dateStr);
    const visible = date.getMonth() === month && date.getFullYear() === year;
    item.style.display = visible ? '' : 'none';
    if (visible) anyVisible = true;
  });

  const noMatchMessageId = `${containerId}-no-match`;
  const existing = document.getElementById(noMatchMessageId);
  if (!anyVisible) {
    if (!existing) {
      const noMatch = document.createElement('div');
      noMatch.id = noMatchMessageId;
      noMatch.className = 'no-requests';
      noMatch.textContent = 'No requests match the selected filter';
      document.getElementById(`${containerId}-list`).appendChild(noMatch);
    }
  } else {
    if (existing) existing.remove();
  }
}



function setupDeleteButtons() {
  document.querySelectorAll('.delete-request').forEach(button => {
    button.addEventListener('click', async (e) => {
      e.preventDefault();
      const requestId = button.dataset.requestId;
      const requestItem = button.closest('.request-item');
      const container = requestItem.parentElement;

      if (confirm('Are you sure you want to delete this request?')) {
        button.disabled = true;
        button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Deleting...';

        try {
          const response = await fetch(`/api/delete_request/${requestId}`, {
            method: 'DELETE'
          });

          const result = await response.json();

          if (response.ok) {
            // Remove the request from UI
            requestItem.remove();

            // Check if container is now empty
            if (container.querySelectorAll('.request-item').length === 0) {
              container.innerHTML = '<div class="no-requests">No requests found</div>';
            }

            Toastify({
              text: "Request deleted successfully",
              duration: 3000,
              gravity: "top",
              position: "right",
              backgroundColor: "#4caf50"
            }).showToast();
          } else {
            throw new Error(result.error || 'Failed to delete request');
          }
        } catch (error) {
          console.error('Delete error:', error);
          Toastify({
            text: "Error deleting request: " + error.message,
            duration: 4000,
            gravity: "top",
            position: "right",
            backgroundColor: "#f44336"
          }).showToast();

          button.disabled = false;
          button.innerHTML = '<i class="fas fa-trash"></i> Delete';
        }
      }
    });
  });
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



 