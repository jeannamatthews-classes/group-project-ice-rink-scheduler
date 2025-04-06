class IceRinkCalendar {
    constructor() {
        this.currentDate = new Date();
        this.allEvents = [];

        this.monthDisplay = document.getElementById('monthDisplay');
        this.calendar = document.getElementById('calendar');

        document.getElementById('prevMonth').addEventListener('click', () => this.changeMonth(-1));
        document.getElementById('nextMonth').addEventListener('click', () => this.changeMonth(1));

        this.fetchData().then(() => this.renderCalendar());
    }

    async fetchData() {
        try {
            const response = await fetch('/api/events');
            if (!response.ok) throw new Error('Network response was not ok');
            const data = await response.json();
            this.allEvents = data.events || [];
            console.log('Fetched events:', this.allEvents.length);
        } catch (error) {
            console.error('Error fetching data:', error);
        }
    }

    changeMonth(increment) {
        this.currentDate.setMonth(this.currentDate.getMonth() + increment);
        this.renderCalendar();
    }

    renderCalendar() {
        this.calendar.innerHTML = '';

        const monthNames = [
            'January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December'
        ];

        const currentYear = this.currentDate.getFullYear();
        const currentMonth = this.currentDate.getMonth();
        this.monthDisplay.textContent = `${monthNames[currentMonth]} ${currentYear}`;

        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        dayNames.forEach(dayName => {
            const dayHeader = document.createElement('div');
            dayHeader.classList.add('calendar-day-header');
            dayHeader.textContent = dayName;
            this.calendar.appendChild(dayHeader);
        });

        const firstDay = new Date(currentYear, currentMonth, 1);
        const lastDay = new Date(currentYear, currentMonth + 1, 0);

        // Add empty cells for days before the first day of the month
        for (let i = 0; i < firstDay.getDay(); i++) {
            this.calendar.appendChild(document.createElement('div'));
        }

        // Create a reference to track the currently expanded day
        let expandedDay = null;

        for (let day = 1; day <= lastDay.getDate(); day++) {
            const dayElement = document.createElement('div');
            dayElement.classList.add('day');

            const currentDate = new Date(currentYear, currentMonth, day);
            const dateString = currentDate.toISOString().split('T')[0];

            const dayHeader = document.createElement('div');
            dayHeader.classList.add('day-header');
            dayHeader.textContent = day;
            dayElement.appendChild(dayHeader);

            const dayEvents = this.allEvents
                .filter(event => event.date === dateString)
                .sort((a, b) => this.parseTime(a.time.split(' - ')[0]) - this.parseTime(b.time.split(' - ')[0]));

            // Using only green color for all events
            dayEvents.forEach(event => {
                const eventElement = document.createElement('div');
                eventElement.classList.add('event');
                
                // Apply Arial font
                eventElement.style.fontFamily = 'Arial, sans-serif';

                // Set color to green
                eventElement.style.backgroundColor = '#02c955';
                eventElement.style.borderLeft = `3px solid #02c955`;
                eventElement.style.color = 'white'; // White text

                // Format the time in AM/PM format
                const formattedTime = this.formatTimeAmPm(event.time);

                eventElement.innerHTML = `
                    <strong>${event.name}</strong>
                    <br>
                    ${formattedTime}<br>
                    ${event.description}
                `;

                dayElement.appendChild(eventElement);
            });

            // Add click event to toggle expanded view
            dayElement.addEventListener('click', () => {
                // If this cell is already expanded, collapse it
                if (dayElement.classList.contains('expanded')) {
                    dayElement.classList.remove('expanded');
                    expandedDay = null;
                } else {
                    // If another cell is expanded, collapse it first
                    if (expandedDay) {
                        expandedDay.classList.remove('expanded');
                    }
                    // Expand this cell
                    dayElement.classList.add('expanded');
                    expandedDay = dayElement;
                }
            });

            this.calendar.appendChild(dayElement);
        }
    }

 
    parseTime(timeString) {
        const [time, period] = timeString.split(' ');
        let [hours, minutes] = time.split(':').map(Number);

        if (period === 'PM' && hours !== 12) {
            hours += 12;
        } else if (period === 'AM' && hours === 12) {
            hours = 0;
        }

        return hours * 60 + minutes;
    }

    formatTimeAmPm(timeRange) {
        // Assuming timeRange is in format "HH:MM:SS - HH:MM:SS" or "HH:MM - HH:MM"
        return timeRange.replace(/(\d{1,2}):(\d{2})(?::\d{2})?\s*(?:-)\s*(\d{1,2}):(\d{2})(?::\d{2})?/g, 
            (match, h1, m1, h2, m2) => {
                // Format first time
                h1 = parseInt(h1);
                const period1 = h1 >= 12 ? 'PM' : 'AM';
                h1 = h1 % 12 || 12; // Convert to 12-hour format
                
                // Format second time
                h2 = parseInt(h2);
                const period2 = h2 >= 12 ? 'PM' : 'AM';
                h2 = h2 % 12 || 12; // Convert to 12-hour format
                
                return `${h1}:${m1} ${period1} - ${h2}:${m2} ${period2}`;
            }
        );
    }
}

// Initialize calendar when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new IceRinkCalendar();
});
