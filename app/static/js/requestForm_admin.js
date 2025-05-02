document.addEventListener('DOMContentLoaded', function() {
  setupRequestForm();
});

function setupRequestForm() {
  // Initialize date/time pickers (same as before)
  const datePicker = flatpickr("#date", {
    dateFormat: "m/d/Y",
    minDate: "today",
    allowInput: true,
  });

  const recurringEndPicker = flatpickr("#recurring-end", {
    dateFormat: "m/d/Y",
    allowInput: true,
    onOpen: function (selectedDates, dateStr, instance) {
      const startDateStr = document.getElementById("date").value;
      if (!startDateStr) return;
  
      const startDate = new Date(startDateStr);
  
      // Set minDate: 1 day after the selected start date
      const minDate = new Date(startDate);
      minDate.setDate(minDate.getDate() + 1);
  
      // Set maxDate: Last day of the start date's month
      const maxDate = new Date(startDate.getFullYear(), startDate.getMonth() + 1, 0);
  
      instance.set('minDate', minDate);
      instance.set('maxDate', maxDate);
    }
  });
  

  const startTimePicker = flatpickr("#start-time", {
    enableTime: true,
    noCalendar: true,
    dateFormat: "h:i K",
    minuteIncrement: 15,
    defaultHour: 8,
    defaultMinute: 0,
    allowInput: true,
  });

  const endTimePicker = flatpickr("#end-time", {
    enableTime: true,
    noCalendar: true,
    dateFormat: "h:i K",
    minuteIncrement: 15,
    defaultHour: 9,
    defaultMinute: 0,
    allowInput: true,
  });

  // Add admin checkbox event listener
  document.getElementById("admin-event").addEventListener("change", function() {
    const isChecked = this.checked;
    document.getElementById("user-email-container").style.display = isChecked ? "block" : "none";
    document.getElementById("user-email").required = isChecked;
    validateForm();
  });

  // Recurring checkbox event (same as before)
  document.getElementById("recurring").addEventListener("change", function() {
    const isChecked = this.checked;
    document.getElementById("recurring-dates").style.display = isChecked ? "block" : "none";
    document.getElementById("recurrence-type-container").style.display = isChecked ? "block" : "none";
    document.getElementById("recurring-end").required = isChecked;
    validateForm();
  });

  // Form submission
  document.getElementById("ice-request-form").addEventListener("submit", function(e) {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    const user = auth.currentUser;
    if (!user) {
      alert("Please sign in to submit a request");
      return;
    }

    const isAdminEvent = document.getElementById("admin-event").checked;
    
    // For regular events (using existing endpoint)
    if (!isAdminEvent) {
      const formData = {
        firebase_uid: user.uid,
        rental_name: document.getElementById("name-rental").value,
        additional_desc: document.getElementById("add-desc").value,
        start_date: document.getElementById("date").value,
        end_date: document.getElementById("recurring").checked ? 
                  document.getElementById("recurring-end").value : 
                  document.getElementById("date").value,
        start_time: document.getElementById("start-time").value,
        end_time: document.getElementById("end-time").value,
        is_recurring: document.getElementById("recurring").checked,
        recurrence_rule: document.getElementById("recurring").checked
          ? document.getElementById("recurrence-type").value
          : null
      };

      submitRegularEvent(formData);
    } 
    // For admin events (using new endpoint)
    else {
      const formData = {
        firebase_uid: user.uid, // Admin's UID
        user_email: document.getElementById("user-email").value, // User's email
        rental_name: document.getElementById("name-rental").value,
        additional_desc: document.getElementById("add-desc").value,
        start_date: document.getElementById("date").value,
        end_date: document.getElementById("recurring").checked ? 
                  document.getElementById("recurring-end").value : 
                  document.getElementById("date").value,
        start_time: document.getElementById("start-time").value,
        end_time: document.getElementById("end-time").value,
        is_recurring: document.getElementById("recurring").checked,
        recurrence_rule: document.getElementById("recurring").checked
          ? document.getElementById("recurrence-type").value
          : null,
        status: 'admin' // Explicitly set status
      };

      submitAdminEvent(formData);
    }
  });
}

// Function to submit admin events
function submitRegularEvent(formData) {
  fetch('/api/submit_event', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(formData)
  })
  .then(response => {
    if (!response.ok) {
      return response.json().then(err => { throw err; });
    }
    return response.json();
  })
  .then(data => {
    if (data.error) {
      throw new Error(data.error);
    }
    showSuccessToast("Event created successfully!");
    resetForm();
  })
  .catch(error => {
    showErrorToast(error);
  });
}

// Function to submit admin user events
async function submitAdminEvent(formData) {
  try {
    // Show loading state
    const submitBtn = document.querySelector("#ice-request-form button[type='submit']");
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="spinner"></span> Validating...';

    // 1. First validate the user exists
    const userExists = await checkUserExists(formData.user_email);
    if (!userExists) {
      throw new Error("User with this email does not exist in our system");
    }

    // 2. Submit the admin request
    const response = await fetch('/api/submit_admin_request', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(formData)
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || "Failed to submit admin request");
    }

    const data = await response.json();
    showSuccessToast("Admin event created successfully!");
    resetForm();
  } catch (error) {
    if (error.message.includes("does not exist")) {
      showError('user-email-error', error.message);
    }
    showErrorToast(error);
  } finally {
    const submitBtn = document.querySelector("#ice-request-form button[type='submit']");
    submitBtn.disabled = false;
    submitBtn.textContent = "Submit Request";
  }
}

// Function to check if user exists in database
function checkUserExists(email) {
  return fetch('/api/check_user', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email: email })
  })
  .then(response => {
    if (!response.ok) {
      return response.json().then(err => { throw err; });
    }
    return response.json();
  })
  .then(data => {
    if (data.error) {
      throw new Error(data.error);
    }
    return data.exists; // Should return true/false
  });
}

// Update validateForm to include user email validation
function validateForm() {
  let isValid = true;
  const date = document.getElementById("date").value;
  const startTime = document.getElementById("start-time").value;
  const endTime = document.getElementById("end-time").value;
  const isRecurring = document.getElementById("recurring").checked;
  const recurringEnd = document.getElementById("recurring-end").value;
  const isAdminEvent = document.getElementById("admin-event").checked;
  const userEmail = document.getElementById("user-email").value;

  // Clear previous errors
  document.querySelectorAll('.error-message').forEach(el => {
    el.textContent = '';
    el.style.display = 'none';
  });

  // Basic field validation
  if (!document.getElementById("name-rental").value) {
    isValid = false;
  }

  if (!date) {
    isValid = false;
  }

  if (!startTime) {
    isValid = false;
  }

  if (!endTime) {
    isValid = false;
  }

  if (isRecurring && !recurringEnd) {
    isValid = false;
  }

  // User email validation for admin events
  if (isAdminEvent && !userEmail) {
    showError('user-email-error', 'User email is required for admin events');
    isValid = false;
  } else if (isAdminEvent && !validateEmail(userEmail)) {
    showError('user-email-error', 'Please enter a valid user email address');
    isValid = false;
  }

  // Time validation (same as before)
  if (date && startTime) {
    const now = new Date();
    const selectedDate = new Date(date);
    const startDateTime = new Date(`${date} ${startTime}`);

    if (selectedDate.toDateString() === now.toDateString() && startDateTime < now) {
      showError('start-time-error', 'Start time cannot be in the past');
      isValid = false;
    }

    if (startDateTime >= new Date(`${date} ${endTime}`)) {
      showError('end-time-error', 'End time must be after start time');
      isValid = false;
    }
  }

  if (isRecurring && date && recurringEnd) {
    const startDate = new Date(date);
    const endDate = new Date(recurringEnd);

    if (endDate < startDate) {
      showError('recurring-end-error', 'Recurring end date must be after start date');
      isValid = false;
    }
  }

  return isValid;
}

// Helper functions
function validateEmail(email) {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
}

function showError(elementId, message) {
  const errorElement = document.getElementById(elementId);
  errorElement.textContent = message;
  errorElement.style.display = 'block';
  errorElement.style.color = '#f1c40f';
}

function showSuccessToast(message) {
  Toastify({
    text: message,
    duration: 3000,
    close: true,
    gravity: "top",
    position: "right",
    backgroundColor: "#4CAF50"
  }).showToast();
}

function showErrorToast(error) {
  console.error("Error:", error);
  Toastify({
    text: `Error: ${error.message || "Please check your input and try again"}`,
    duration: 4000,
    close: true,
    gravity: "top",
    position: "right",
    backgroundColor: "#f44336"
  }).showToast();
}

function resetForm() {
  document.getElementById("ice-request-form").reset();
  document.getElementById("recurring-dates").style.display = "none";
  document.getElementById("recurrence-type-container").style.display = "none";
  document.getElementById("user-email-container").style.display = "none";
  refreshCalendar();
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
    oldScript.parentNode.replaceChild(newScript, oldScript);
  }
}