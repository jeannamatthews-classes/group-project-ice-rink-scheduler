// This function will load all rentals from the database and sort them into the appropriate sections

function loadRentalsFromDatabase() {
    // Get container elements
    const pendingContainer = document.getElementById('pending');
    const declinedContainer = document.getElementById('declined');

    // Clear existing content (keeping the headers)
    pendingContainer.innerHTML = '<h2>Pending Rentals</h2>';
    declinedContainer.innerHTML = '<h2>Declined Rentals</h2>';

    // Filter events by status
    const pendingEvents = RINK_EVENTS.filter(event => event.status === 'pending');
    const declinedEvents = RINK_EVENTS.filter(event => event.status === 'denied');

    // Display pending events
    if (pendingEvents.length === 0) {
        pendingContainer.innerHTML += '<div class="empty-message">No pending rentals</div>';
    } else {
        pendingEvents.forEach(event => {
            const rentalItem = createRentalItem(event, 'pending');
            pendingContainer.appendChild(rentalItem);
        });
    }

    // Display declined events
    if (declinedEvents.length === 0) {
        declinedContainer.innerHTML += '<div class="empty-message">No declined rentals</div>';
    } else {
        declinedEvents.forEach(event => {
            const rentalItem = createRentalItem(event, 'declined');
            declinedContainer.appendChild(rentalItem);
        });
    }
}

// Create a rental item element
function createRentalItem(event, section) {
    const rentalItem = document.createElement('div');
    rentalItem.className = 'rental-item';
    rentalItem.dataset.id = event.id;

    // Create the content display
    const content = document.createElement('div');
    content.className = 'rental-content';
    content.innerHTML = `
        <strong>${event.name}</strong><br>
        ${event.date} | ${event.time}<br>
        ${event.description}
    `;

    // Create action buttons container
    const actionButtons = document.createElement('div');
    actionButtons.className = 'action-buttons';

    // Add appropriate buttons based on section
    if (section === 'pending') {
        // For pending items, add approve and decline buttons
        const approveButton = document.createElement('button');
        approveButton.className = 'approve';
        approveButton.textContent = 'Approve';
        approveButton.onclick = () => changeRentalStatus(event.id, 'accepted');

        const declineButton = document.createElement('button');
        declineButton.className = 'decline';
        declineButton.textContent = 'Decline';
        declineButton.onclick = () => changeRentalStatus(event.id, 'denied');

        actionButtons.appendChild(approveButton);
        actionButtons.appendChild(declineButton);
    } else if (section === 'declined') {
        // For declined items, add revert button
        const revertButton = document.createElement('button');
        revertButton.className = 'revert';
        revertButton.textContent = 'Revert';
        revertButton.onclick = () => changeRentalStatus(event.id, 'pending');

        actionButtons.appendChild(revertButton);
    }

    // Assemble the rental item
    rentalItem.appendChild(content);
    rentalItem.appendChild(actionButtons);

    return rentalItem;
}

// Change the status of a rental and refresh the display
function changeRentalStatus(eventId, newStatus) {
    // Find the event in the database
    const eventIndex = RINK_EVENTS.findIndex(event => event.id === eventId);

    if (eventIndex !== -1) {
        // Update the status
        RINK_EVENTS[eventIndex].status = newStatus;

        // Refresh the display
        loadRentalsFromDatabase();

        // Simply refresh the iframe - this is the most reliable method
        const calendarFrame = document.querySelector('.calendar-container iframe');
        calendarFrame.src = calendarFrame.src.split('?')[0] + '?t=' + new Date().getTime();

        // Show confirmation message
        let statusText = newStatus === 'accepted' ? 'approved' : (newStatus === 'denied' ? 'declined' : 'reverted to pending');
        alert(`Rental has been ${statusText} successfully!`);
    }
}

// Function to update the calendar without reloading the iframe
// Replace the existing updateCalendarWithoutReload function with this:
function updateCalendarWithoutReload(eventId, newStatus) {
    try {
        // Get the iframe
        const calendarFrame = document.querySelector('.calendar-container iframe');

        // The most reliable way to ensure the iframe gets the updated data
        // is to reload it with the updated data passed via sessionStorage

        // Store the updated RINK_EVENTS in sessionStorage
        sessionStorage.setItem('updatedRinkEvents', JSON.stringify(RINK_EVENTS));

        // Reload the iframe
        calendarFrame.src = calendarFrame.src.split('?')[0] + '?t=' + new Date().getTime();
    } catch (e) {
        console.error("Error updating calendar:", e);
    }
}

// Function to refresh the calendar
function refreshCalendar() {
    // Get the iframe and reload it
    const calendarFrame = document.querySelector('.calendar-container iframe');
    if (calendarFrame) {
        // Store the updated RINK_EVENTS in sessionStorage to pass to the iframe
        sessionStorage.setItem('updatedRinkEvents', JSON.stringify(RINK_EVENTS));

        // Force reload by changing the src slightly (adding a timestamp)
        calendarFrame.src = 'rink-calendar-page.html?t=' + new Date().getTime();
    }
}

// Initialize the page
window.addEventListener('DOMContentLoaded', function () {
    loadRentalsFromDatabase();
});



// info on the account pop ups
function toggleAccountPopup() {
    let popup = document.getElementById('accountPopup');
    popup.style.display = popup.style.display === 'block' ? 'none' : 'block';
}

function openPasswordPopup() {
    document.getElementById('passwordPopup').style.display = 'block';
}

function closePasswordPopup() {
    document.getElementById('passwordPopup').style.display = 'none';
}

function changePassword() {
    let oldPassword = document.getElementById('oldPassword').value;
    let newPassword = document.getElementById('newPassword').value;
    let confirmPassword = document.getElementById('confirmPassword').value;

    if (!oldPassword) {
        alert('Please enter your current password');
        return;
    }

    if (!newPassword) {
        alert('Please enter a new password');
        return;
    }

    if (newPassword !== confirmPassword) {
        alert('New passwords do not match');
        return;
    }

    // Here you would typically send this to your server
    alert('Password changed successfully!');
    closePasswordPopup();
}