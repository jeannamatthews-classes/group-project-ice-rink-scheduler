function setupRequestForm() {
  // Initialize date/time pickers
  const datePicker = flatpickr("#date", {
    dateFormat: "m/d/Y",
    minDate: "today",
    allowInput: true,
  });

  const DatePicker = flatpickr("#recurring-end", {
    dateFormat: "m/d/Y",
    allowInput: true,
    onOpen: function (selectedDates, dateStr, instance) {

      const min = new Date();

      instance.set('minDate', min);

    }
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

  // Recurring checkbox event
  document.getElementById("recurring").addEventListener("change", function () {
    const isChecked = this.checked;
    document.getElementById("recurring-dates").style.display = isChecked ? "block" : "none";
    document.getElementById("recurrence-type-container").style.display = isChecked ? "block" : "none";
    document.getElementById("recurring-end").required = isChecked;

    validateForm();
  });

  // Form submission
  document.getElementById("ice-request-form").addEventListener("submit", function(e) {
    e.preventDefault();

    if (!validateForm()) return;

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
      recurrence_rule: document.getElementById("recurring").checked
        ? document.getElementById("recurrence-type").value
        : null
    };

    fetch('/api/submit_request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData)
    })
    .then(response => {
      if (!response.ok) {
        return response.json().then(err => { throw err; });
      }
      return response.json();
    })
    .then(data => {
      if (data.error) throw new Error(data.error);

      Toastify({
        text: "Request submitted successfully!",
        duration: 3000,
        close: true,
        gravity: "top",
        position: "right",
        backgroundColor: "#4CAF50"
      }).showToast();

      this.reset();
      document.getElementById("recurring-dates").style.display = "none";
      document.getElementById("recurrence-type-container").style.display = "none";
      loadUserRequests(firebase.auth().currentUser.uid);
      switchView('pending');
    })
    .catch(error => {
      console.error("Error:", error);
      Toastify({
        text: `Error: ${error.message || "Please check your input and try again"}`,
        duration: 4000,
        close: true,
        gravity: "top",
        position: "right",
        backgroundColor: "#f44336"
      }).showToast();
    });
  });
}

async function validateForm() {
  let isValid = true;
  const date = document.getElementById("date")?.value || '';
  const startTime = document.getElementById("start-time")?.value || '';
  const endTime = document.getElementById("end-time")?.value || '';
  const isRecurring = document.getElementById("recurring")?.checked || false;
  const recurringEnd = document.getElementById("recurring-end")?.value || '';
  
  // Clear all previous error messages
  document.querySelectorAll('.error-message').forEach(el => {
    el.textContent = '';
    el.style.display = 'none';
  });
  
  // Basic validation checks
  if (!document.getElementById("name-rental")?.value) {
    showError('name-rental-error', 'Rental name is required');
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
  
  // Validate start time when date is today
  if (date && startTime) {
    const now = new Date();
    const selectedDate = new Date(date);
    const startDateTime = new Date(`${date} ${startTime}`);
    
    if (selectedDate.toDateString() === now.toDateString() && startDateTime < now) {
      showError('start-time-error', 'Start time cannot be in the past');
      isValid = false;
    }
    
    // Compare start time and end time
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
  
  // Only check for conflicts if basic validation passed
  if (isValid) {
    try {
      const recurrenceType = document.getElementById("recurrence-type")?.value || 'weekly';
      
      const response = await fetch('/api/check_conflicts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          start_date: date,
          end_date: isRecurring ? recurringEnd : date,
          start_time: startTime,
          end_time: endTime,
          is_recurring: isRecurring,
          recurrence_rule: isRecurring ? recurrenceType : null
        })
      });
      
      if (!response.ok) {
        throw new Error('Failed to check conflicts');
      }
      
      const result = await response.json();
      
      if (result.has_conflicts) {
        // Simplified conflict message
        let conflictMsg = "Schedule conflicts with existing bookings. Please select a different time or date.";
        
        // Create or find the error element
        let errorElement = document.getElementById('scheduling-conflict-error');
        if (!errorElement) {
          errorElement = document.createElement('div');
          errorElement.id = 'scheduling-conflict-error';
          errorElement.className = 'error-message';
          errorElement.style.color = '#f1c40f';
          errorElement.style.marginTop = '10px';
          // Insert it somewhere appropriate in your form
          document.querySelector('#ice-request-form').appendChild(errorElement);
        }
        
        errorElement.textContent = conflictMsg;
        errorElement.style.display = 'block';
        isValid = false;
      }
    } catch (error) {
      console.error('Error checking conflicts:', error);
      showError('form-error', 'Failed to check for scheduling conflicts');
      isValid = false;
    }
  }
  return isValid;
}

function showError(elementId, message) {
  const errorElement = document.getElementById(elementId);
  errorElement.textContent = message;
  errorElement.style.display = 'block';
  errorElement.style.color = '#f1c40f';
}

function showError(elementId, message) {
  const errorElement = document.getElementById(elementId);
  errorElement.textContent = message;
  errorElement.style.display = 'block';
  errorElement.style.color = '#f1c40f';
}