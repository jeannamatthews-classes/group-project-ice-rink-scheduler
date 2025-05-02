// DOM Elements
const userSearch = document.getElementById('userSearch');
const searchResults = document.getElementById('searchResults');
const selectedUserInfo = document.getElementById('selectedUserInfo');
const statusFilter = document.getElementById('statusFilter');
const monthFilter = document.getElementById('monthFilter');
const yearFilter = document.getElementById('yearFilter');
const requestsList = document.getElementById('requestsList');
const loadingIndicator = document.getElementById('loadingIndicator');
const noRequestsMessage = document.getElementById('noRequestsMessage');
const requestCount = document.getElementById('requestCount');
const paymentSummary = document.getElementById('paymentSummary');
const backToAdmin = document.getElementById('backToAdmin');
const clearSearch = document.getElementById('clearSearch');
const clearSelectedUser = document.getElementById('clearSelectedUser');
const requestDetailsModal = new bootstrap.Modal(document.getElementById('requestDetailsModal'));

// State
let currentUser = null;
let allUserRequests = [];
let filteredRequests = [];
let currentYear = new Date().getFullYear();

// Initialize the page
document.addEventListener('DOMContentLoaded', function() {
    setupEventListeners();
    populateYearFilter();
    
    // Load all users immediately
    handleUserSearch('', true);
});

function setupEventListeners() {
    // User search functionality
    userSearch.addEventListener('input', debounce(handleUserSearch, 300));
    
    // Show all users when search input is clicked
    userSearch.addEventListener('click', function() {
        if (searchResults.children.length === 0 || searchResults.style.display === 'none') {
            handleUserSearch('', true); // Force load all users
        }
    });
    
    userSearch.addEventListener('focus', function() {
        if (userSearch.value.trim() === '' || searchResults.children.length > 0) {
            handleUserSearch('', true); // Force load all users
            searchResults.style.display = 'block';
        }
    });
    
    document.addEventListener('click', function(e) {
        if (!searchResults.contains(e.target) && e.target !== userSearch) {
            searchResults.style.display = 'none';
        }
    });
    document.getElementById('paymentFilter').addEventListener('change', applyFilters);
    
    // Clear buttons
    clearSearch.addEventListener('click', clearSearchInput);
    clearSelectedUser.addEventListener('click', clearSelectedUserInfo);
    
    // Filter changes
    statusFilter.addEventListener('change', applyFilters);
    monthFilter.addEventListener('change', applyFilters);
    yearFilter.addEventListener('change', applyFilters);
    
    // Navigation
    backToAdmin.addEventListener('click', function() {
        window.location.href = '/admin';
    });
}
   

function populateYearFilter() {
    const startYear = 2020; // Adjust as needed
    const endYear = currentYear + 1;
    
    for (let year = endYear; year >= startYear; year--) {
        const option = document.createElement('option');
        option.value = year;
        option.textContent = year;
        yearFilter.appendChild(option);
    }
}

function debounce(func, wait) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

async function handleUserSearch(query = '', forceLoadAll = false) {
    query = typeof query === 'string' ? query.trim() : '';
    
    // If input is empty or we're forcing load all, show all users
    if (query === '' || forceLoadAll) {
        try {
            const response = await fetch('/api/admin/all-users');
            const data = await response.json();
            
            if (data.users && data.users.length > 0) {
                displaySearchResults(data.users);
                searchResults.style.display = 'block';
            } else {
                searchResults.innerHTML = '<div class="dropdown-item">No users found</div>';
                searchResults.style.display = 'block';
            }
        } catch (error) {
            console.error('Error fetching all users:', error);
            searchResults.innerHTML = '<div class="dropdown-item text-danger">Error loading users</div>';
            searchResults.style.display = 'block';
        }
        return;
    }
    
    if (query.length < 2) {
        searchResults.style.display = 'none';
        return;
    }
    
    try {
        const response = await fetch(`/api/admin/search-users?query=${encodeURIComponent(query)}`);
        const data = await response.json();
        
        if (data.users && data.users.length > 0) {
            displaySearchResults(data.users);
            searchResults.style.display = 'block';
        } else {
            searchResults.innerHTML = '<div class="dropdown-item">No users found</div>';
            searchResults.style.display = 'block';
        }
    } catch (error) {
        console.error('Error searching users:', error);
        searchResults.innerHTML = '<div class="dropdown-item text-danger">Error searching users</div>';
        searchResults.style.display = 'block';
    }
}

function displaySearchResults(users) {
    searchResults.innerHTML = '';
    
    if (users.length === 0) {
        searchResults.innerHTML = '<div class="dropdown-item">No users found</div>';
        return;
    }
    
    users.forEach(user => {
        const resultItem = document.createElement('div');
        resultItem.className = 'dropdown-item search-result-item';
        resultItem.innerHTML = `
            <div class="fw-bold">${user.full_name}</div>
            <div class="text-muted small">${user.email}</div>
            ${user.phone ? `<div class="text-muted small">${user.phone}</div>` : ''}
        `;
        
        resultItem.addEventListener('click', () => {
            selectUser(user);
            searchResults.style.display = 'none';
            userSearch.value = user.full_name;
        });
        
        searchResults.appendChild(resultItem);
    });
}

function selectUser(user) {
    currentUser = user;
    
    // Update user info display
    document.getElementById('userFullName').textContent = user.full_name;
    document.getElementById('userEmail').textContent = user.email;
    document.getElementById('userPhone').textContent = user.phone || 'N/A';
    selectedUserInfo.style.display = 'block';
    
    // Load user requests
    loadUserRequests(user.user_id);
}

async function loadUserRequests(userId) {
    loadingIndicator.style.display = 'block';
    noRequestsMessage.style.display = 'none';
    requestsList.innerHTML = '';
    
    try {
        let response;
        if (userId) {
            response = await fetch(`/api/admin/user-requests/${userId}`);
        } else {
            response = await fetch('/api/admin/all-requests');
        }
        
        const data = await response.json();
        
        if (data.requests && data.requests.length > 0) {
            allUserRequests = data.requests;
            applyFilters();
            
            // Update the UI to show we're viewing all requests if no user selected
            if (!userId) {
                document.getElementById('userFullName').textContent = 'All Users';
                document.getElementById('userEmail').textContent = '';
                document.getElementById('userPhone').textContent = '';
                selectedUserInfo.style.display = 'block';
            }
        } else {
            noRequestsMessage.textContent = userId 
                ? 'No requests found for this user' 
                : 'No requests found in the system';
            noRequestsMessage.style.display = 'block';
            requestCount.textContent = '0 requests';
            paymentSummary.style.display = 'none';
        }
    } catch (error) {
        console.error('Error loading requests:', error);
        noRequestsMessage.innerHTML = '<p class="text-danger">Error loading requests. Please try again.</p>';
        noRequestsMessage.style.display = 'block';
    } finally {
        loadingIndicator.style.display = 'none';
    }
}

function clearSelectedUserInfo() {
    currentUser = null;
    allUserRequests = [];
    filteredRequests = [];
    selectedUserInfo.style.display = 'none';
    requestsList.innerHTML = '';
    noRequestsMessage.textContent = 'Select a user to view their requests or search for users above';
    noRequestsMessage.style.display = 'block';
    requestCount.textContent = '0 requests';
    paymentSummary.style.display = 'none';
    userSearch.value = '';
    
    // Load all requests when no user is selected
    loadUserRequests();
}

// Initialize by loading all requests
document.addEventListener('DOMContentLoaded', function() {
    setupEventListeners();
    populateYearFilter();
    loadUserRequests(); // Load all requests initially
});

function applyFilters() {
    if (!allUserRequests || allUserRequests.length === 0) {
        if (!currentUser) {
            // Show message when no user is selected
            noRequestsMessage.textContent = 'Select a user to view their requests or search for users above';
            noRequestsMessage.style.display = 'block';
        }
        return;
    }
    
    const status = statusFilter.value;
    const month = monthFilter.value;
    const year = yearFilter.value;
    const paymentStatus = document.getElementById('paymentFilter').value;
    
    filteredRequests = allUserRequests.filter(request => {
        // Status filter
        if (status !== 'all' && request.request_status !== status) {
            return false;
        }
        
        // Payment status filter
        if (paymentStatus !== 'all') {
            if (paymentStatus === 'paid' && !request.paid) {
                return false;
            }
            if (paymentStatus === 'unpaid' && (request.paid || !request.amount)) {
                return false;
            }
        }
        
        // Parse request date
        let requestDate;
        try {
            requestDate = new Date(request.start_date);
            if (isNaN(requestDate.getTime())) {
                // Try alternative date format if needed
                const parts = request.start_date.split('/');
                if (parts.length === 3) {
                    requestDate = new Date(parts[2], parts[0] - 1, parts[1]);
                } else {
                    return false; // Invalid date format
                }
            }
        } catch (e) {
            console.error('Error parsing date:', request.start_date, e);
            return false;
        }
        
        // Month filter
        if (month !== 'all' && (requestDate.getMonth() + 1) !== parseInt(month)) {
            return false;
        }
        
        // Year filter
        if (year !== 'all' && requestDate.getFullYear() !== parseInt(year)) {
            return false;
        }
        
        return true;
    });
    
    displayFilteredRequests();
    updateRequestCount();
    updatePaymentSummary();
}

function displayFilteredRequests() {
    requestsList.innerHTML = '';
    
    if (filteredRequests.length === 0) {
        noRequestsMessage.style.display = 'block';
        return;
    }
    
    noRequestsMessage.style.display = 'none';
    
    filteredRequests.forEach(request => {
        const requestItem = document.createElement('div');
        requestItem.className = 'request-item mb-3 p-3 border rounded';
        
        // Determine badge color based on status
        let badgeClass;
        switch (request.request_status) {
            case 'approved': badgeClass = 'bg-success'; break;
            case 'declined': badgeClass = 'bg-danger'; break;
            default: badgeClass = 'bg-warning text-dark';
        }
        
        // Format amount if exists
        const amountDisplay = request.amount ? `$${parseFloat(request.amount).toFixed(2)}` : 'N/A';
        
        // Show user info if viewing all requests
        const userInfo = !currentUser ? `
            <div class="mb-2">
                <small><strong>User:</strong> ${request.user_name}</small>
                ${request.user_phone ? `<small class="ms-2">${request.user_phone}</small>` : ''}
            </div>
            <div class="mb-2">
                <small><strong>Email:</strong> ${request.user_email}</small>
            </div>
        ` : '';
        
        requestItem.innerHTML = `
            <div class="d-flex justify-content-between align-items-start mb-2">
                <h6 class="mb-0">${request.rental_name}</h6>
                <span class="badge ${badgeClass}">${request.request_status}</span>
            </div>
            ${userInfo}
            <div class="mb-2">
                <small class="text-muted">
                    ${request.start_date} ${request.start_date !== request.end_date ? `to ${request.end_date}` : ''}
                </small>
            </div>
            <div class="mb-2">
                <small>${request.start_time} - ${request.end_time}</small>
            </div>
            ${request.additional_desc ? `
            <div class="mb-2">
                <small>${request.additional_desc}</small>
            </div>` : ''}
            ${request.amount ? `
            <div class="mb-2">
                <small><strong>Amount:</strong> ${amountDisplay}</small>
                ${request.paid ? '<span class="badge bg-success ms-2">Paid</span>' : ''}
            </div>` : ''}
            <div class="d-flex justify-content-between align-items-center">
                <small class="text-muted">Submitted: ${formatDate(request.request_date)}</small>
                <button class="btn btn-sm btn-outline-primary view-details" data-request-id="${request.request_id}">
                    Details
                </button>
            </div>
        `;
        
        requestsList.appendChild(requestItem);
    });
    
    // Add event listeners to detail buttons
    document.querySelectorAll('.view-details').forEach(button => {
        button.addEventListener('click', function() {
            const requestId = this.getAttribute('data-request-id');
            showRequestDetails(requestId);
        });
    });
}

function showRequestDetails(requestId) {
    const request = filteredRequests.find(r => r.request_id == requestId);
    if (!request) return;
    
    // Update modal content
    document.getElementById('modalRequestTitle').textContent = request.rental_name;
    document.getElementById('modalRequestDate').textContent = 
        `${request.start_date} ${request.start_date !== request.end_date ? `to ${request.end_date}` : ''}`;
    document.getElementById('modalRequestTime').textContent = `${request.start_time} - ${request.end_time}`;
    document.getElementById('modalRequestDesc').textContent = request.additional_desc || 'No description provided';
    
    // Status display
    const statusBadge = document.getElementById('modalRequestStatus');
    statusBadge.textContent = request.request_status;
    statusBadge.className = 'badge ' + 
        (request.request_status === 'approved' ? 'bg-success' : 
         request.request_status === 'declined' ? 'bg-danger' : 'bg-warning text-dark');
    
    // Decline reason (if applicable)
    const declineReasonSection = document.getElementById('modalDeclineReason');
    if (request.request_status === 'declined' && request.declined_reason) {
        document.getElementById('modalDeclineReasonText').textContent = request.declined_reason;
        declineReasonSection.style.display = 'block';
    } else {
        declineReasonSection.style.display = 'none';
    }
    
    // Payment info (if applicable)
    const paymentSection = document.getElementById('modalPaymentSection');
    if (request.request_status === 'approved' && request.amount) {
        document.getElementById('modalRequestAmount').textContent = parseFloat(request.amount).toFixed(2);
        document.getElementById('modalPaymentStatus').textContent = request.paid ? 'Paid' : 'Pending';
        document.getElementById('modalPaymentStatus').className = 'badge ' + (request.paid ? 'bg-success' : 'bg-warning text-dark');
        paymentSection.style.display = 'block';
    } else {
        paymentSection.style.display = 'none';
    }
    
    // Action buttons
    const actionButtons = document.getElementById('modalActionButtons');
    actionButtons.innerHTML = '';
    
    if (request.request_status === 'pending') {
        const approveBtn = document.createElement('button');
        approveBtn.className = 'btn btn-success me-2';
        approveBtn.innerHTML = '<i class="fas fa-check me-1"></i> Approve';
        approveBtn.addEventListener('click', () => updateRequestStatus(request.request_id, 'approved'));
        
        const declineBtn = document.createElement('button');
        declineBtn.className = 'btn btn-danger';
        declineBtn.innerHTML = '<i class="fas fa-times me-1"></i> Decline';
        declineBtn.addEventListener('click', () => promptDeclineReason(request.request_id));
        
        actionButtons.appendChild(approveBtn);
        actionButtons.appendChild(declineBtn);
    } else if (request.request_status === 'approved' && !request.paid && request.amount) {
        const sendInvoiceBtn = document.createElement('button');
        sendInvoiceBtn.className = 'btn btn-primary';
        sendInvoiceBtn.innerHTML = '<i class="fas fa-paper-plane me-1"></i> Send Invoice';
        sendInvoiceBtn.addEventListener('click', () => sendInvoice(request.request_id, request.user_email, request.amount));
        
        actionButtons.appendChild(sendInvoiceBtn);
    }
    
    requestDetailsModal.show();
}

async function updateRequestStatus(requestId, status) {
    try {
        const response = await fetch(`/api/admin/update-request/${requestId}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                status: status,
                reason: status === 'denied' ? prompt('Enter reason for declining:') : null
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            // Update the request in our local data
            const requestIndex = allUserRequests.findIndex(r => r.request_id == requestId);
            if (requestIndex !== -1) {
                allUserRequests[requestIndex].request_status = status;
                if (status === 'denied') {
                    allUserRequests[requestIndex].declined_reason = data.reason;
                }
            }
            
            // Reapply filters to refresh the view
            applyFilters();
            requestDetailsModal.hide();
            
            // Show success message
            alert(`Request ${status} successfully!`);
        } else {
            alert(`Failed to update request: ${data.error || 'Unknown error'}`);
        }
    } catch (error) {
        console.error('Error updating request status:', error);
        alert('Error updating request status. Please try again.');
    }
}

function promptDeclineReason(requestId) {
    const reason = prompt('Please enter the reason for declining this request:');
    if (reason !== null) {
        updateRequestStatus(requestId, 'denied', reason);
    }
}

async function sendInvoice(requestId, userEmail, amount) {
    try {
        // In a real app, you would integrate with Stripe or another payment processor here
        // For this example, we'll just mark it as paid in our database
        
        const response = await fetch(`/api/admin/mark-paid/${requestId}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            }
        });
        
        const data = await response.json();
        
        if (data.success) {
            // Update the request in our local data
            const requestIndex = allUserRequests.findIndex(r => r.request_id == requestId);
            if (requestIndex !== -1) {
                allUserRequests[requestIndex].paid = true;
            }
            
            // Reapply filters to refresh the view
            applyFilters();
            requestDetailsModal.hide();
            
            // Show success message
            alert(`Invoice sent successfully to ${userEmail} for $${amount}!`);
        } else {
            alert(`Failed to send invoice: ${data.error || 'Unknown error'}`);
        }
    } catch (error) {
        console.error('Error sending invoice:', error);
        alert('Error sending invoice. Please try again.');
    }
}

function updateRequestCount() {
    const count = filteredRequests.length;
    requestCount.textContent = `${count} request${count !== 1 ? 's' : ''}`;
}

function updatePaymentSummary() {
    paymentSummary.style.display = 'block';
    
    let paidTotal = 0;
    let unpaidTotal = 0;
    let allTotal = 0;
    
    filteredRequests.forEach(request => {
        const amount = parseFloat(request.amount) || 0;
        allTotal += amount;
        if (request.paid) {
            paidTotal += amount;
        } else if (request.amount) {
            unpaidTotal += amount;
        }
    });
    
    document.getElementById('amountPaid').textContent = `$${paidTotal.toFixed(2)}`;
    document.getElementById('amountPending').textContent = `$${unpaidTotal.toFixed(2)}`;
    document.getElementById('amountTotal').textContent = `$${allTotal.toFixed(2)}`;
}

function clearSearchInput() {
    userSearch.value = '';
    searchResults.innerHTML = '';
    searchResults.style.display = 'none';
}

function clearSelectedUserInfo() {
    currentUser = null;
    allUserRequests = [];
    filteredRequests = [];
    selectedUserInfo.style.display = 'none';
    requestsList.innerHTML = '';
    noRequestsMessage.style.display = 'block';
    requestCount.textContent = '0 requests';
    paymentSummary.style.display = 'none';
    userSearch.value = '';
}

function formatDate(dateString) {
    if (!dateString) return 'N/A';
    
    try {
        const date = new Date(dateString);
        if (isNaN(date.getTime())) {
            // Try alternative format if needed
            const parts = dateString.split('/');
            if (parts.length === 3) {
                return dateString; // Already in MM/DD/YYYY format
            }
            return dateString; // Return as-is if we can't parse it
        }
        
        return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch (e) {
        console.error('Error formatting date:', dateString, e);
        return dateString;
    }
}