document.addEventListener('DOMContentLoaded', function() {
  setupRequestForm();
});

function setupRequestForm() {
  // Initialize date/time pickers
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

      const [startMonth, , startYear] = startDateStr.split('/');
      const min = new Date(startYear, startMonth - 1, 1);
      const max = new Date(startYear, startMonth, 0); // Last day of month

      instance.set('minDate', min);
      instance.set('maxDate', max);
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
    const recurringDates = document.getElementById("recurring-dates");
    const recurrenceTypeContainer = document.getElementById("recurrence-type-container");

    recurringDates.style.display = isChecked ? "block" : "none";
    recurrenceTypeContainer.style.display = isChecked ? "block" : "none";
    document.getElementById("recurring-end").required = isChecked;

    validateForm();
  });

  // Form submission
  document.getElementById("ice-request-form").addEventListener("submit", function (e) {
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
      event_name: document.getElementById("name-rental").value,
      additional_desc: document.getElementById("add-desc").value,
      start_date: document.getElementById("date").value,
      end_date: document.getElementById("recurring").checked
        ? document.getElementById("recurring-end").value
        : document.getElementById("date").value,
      start_time: document.getElementById("start-time").value,
      end_time: document.getElementById("end-time").value,
      is_recurring: document.getElementById("recurring").checked,
      recurrence_rule: document.getElementById("recurring").checked
        ? document.getElementById("recurrence-type").value
        : null
    };

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

        Toastify({
          text: "Event created successfully!",
          duration: 3000,
          close: true,
          gravity: "top",
          position: "right",
          backgroundColor: "#4CAF50"
        }).showToast();

        this.reset();
        document.getElementById("recurring-dates").style.display = "none";
        document.getElementById("recurrence-type-container").style.display = "none";
        refreshCalendar();
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

function validateForm() {
  let isValid = true;
  const date = document.getElementById("date").value;
  const startTime = document.getElementById("start-time").value;
  const endTime = document.getElementById("end-time").value;
  const isRecurring = document.getElementById("recurring").checked;
  const recurringEnd = document.getElementById("recurring-end").value;

  document.querySelectorAll('.error-message').forEach(el => {
    el.textContent = '';
    el.style.display = 'none';
  });

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

  if (date && startTime && endTime) {
    const startDateTime = new Date(`${date} ${startTime}`);
    const endDateTime = new Date(`${date} ${endTime}`);

    if (startDateTime >= endDateTime) {
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

function showError(elementId, message) {
  const errorElement = document.getElementById(elementId);
  errorElement.textContent = message;
  errorElement.style.display = 'block';
  errorElement.style.color = '#f1c40f';
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

