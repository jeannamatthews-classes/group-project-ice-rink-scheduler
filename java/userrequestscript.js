function toggleRecurringDates() {
    const checkbox = document.getElementById('recurring');
    const recurringSection = document.getElementById('recurring-dates');
    recurringSection.style.display = checkbox.checked ? 'block' : 'none';
}