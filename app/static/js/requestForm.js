function setupRequestForm() {
  // Initialize date/time pickers
  const datePicker = flatpickr("#date", {
    dateFormat: "m/d/Y",
    minDate: "today",
    allowInput: true,
    onChange: validateForm
  });
  
  const recurringEndPicker = flatpickr("#recurring-end", {
    dateFormat: "m/d/Y",
    minDate: "today",
    allowInput: true,
    onChange: validateForm
  });
  
  const startTimePicker = flatpickr("#start-time", {
    enableTime: true,
    noCalendar: true,
    dateFormat: "h:i K",
    minuteIncrement: 15,
    defaultHour: 8,
    defaultMinute: 0,
    allowInput: true,
    onChange: validateForm
  });
  
  const endTimePicker = flatpickr("#end-time", {
    enableTime: true,
    noCalendar: true,
    dateFormat: "h:i K",
    minuteIncrement: 15,
    defaultHour: 9,
    defaultMinute: 0,
    allowInput: true,
    onChange: validateForm
  });

  // Recurring checkbox event
  document.getElementById("recurring").addEventListener("change", function() {
    const isChecked = this.checked;
    const recurringDates = document.getElementById("recurring-dates");
    recurringDates.style.display = isChecked ? "block" : "none";
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
      recurrence_rule: "weekly"
    };
    
    fetch('/api/submit_request', {
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
      alert("Request submitted successfully!");
      this.reset();
      document.getElementById("recurring-dates").style.display = "none";
      loadUserRequests(user.uid);
      switchView('pending');
    })
    .catch(error => {
      console.error("Error:", error);
      alert("Error submitting request: " + (error.message || "Please check your input and try again"));
    });
  });
}

function validateForm() {
  let isValid = true;
  const date = document.getElementById("date").value;
  const startTime = document.getElementById("start-time").value;
  const endTime = document.getElementById("end-time").value;
  const isRecurring = document.getElementById("recurring").checked;
  const recurringEnd = document.getElementById("recurring-end").value;

  // Clear all error messages
  document.querySelectorAll('.error-message').forEach(el => {
    el.textContent = '';
    el.style.display = 'none';
  });

  // Validate required fields
  if (!document.getElementById("name-rental").value) {
    showError('name-error', 'Rental name is required');
    isValid = false;
  }

  if (!date) {
    showError('date-error', 'Date is required');
    isValid = false;
  }

  if (!startTime) {
    showError('start-time-error', 'Start time is required');
    isValid = false;
  }

  if (!endTime) {
    showError('end-time-error', 'End time is required');
    isValid = false;
  }

  if (isRecurring && !recurringEnd) {
    showError('recurring-end-error', 'Recurring end date is required');
    isValid = false;
  }

  // Validate time logic if we have all required fields
  if (date && startTime && endTime) {
    const startDateTime = new Date(`${date} ${startTime}`);
    const endDateTime = new Date(`${date} ${endTime}`);

    if (startDateTime >= endDateTime) {
      showError('end-time-error', 'End time must be after start time');
      isValid = false;
    }
  }

  // Validate recurring end date if needed
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

function showError(elementId, message) {
  const errorElement = document.getElementById(elementId);
  errorElement.textContent = message;
  errorElement.style.display = 'block';
}