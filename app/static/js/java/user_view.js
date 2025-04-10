document.addEventListener('DOMContentLoaded', function () {
    var calendarEl = document.getElementById('calendar');
    var calendar = new FullCalendar.Calendar(calendarEl, {
        initialView: 'dayGridMonth',
        validRange: {
            start: '2025-01-01',
            end: '2025-12-31'
        },
        headerToolbar: {
            left: 'prev,next',
            center: 'title',
            right: 'today'
        },
        events: [
            {
                title: 'Booking 1',
                start: '2025-03-02',
                className: 'event-booking'
            },
            {
                title: 'Booking 2',
                start: '2025-03-15',
                className: 'event-booking'
            },
            {
                title: 'Booking 3',
                start: '2025-03-10',
                className: 'event-booking'
            }
        ]
    });
    calendar.render();
});

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