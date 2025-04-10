class IceRinkCalendar {
    constructor() {
        this.currentDate = new Date();
        this.rentalData = this.generateSampleRentalData();

        this.monthDisplay = document.getElementById('monthDisplay');
        this.calendar = document.getElementById('calendar');

        this.renderCalendar();
    }

    generateSampleRentalData() {
        // Specific ice slots with exact dates and times
        return RINK_EVENTS;
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

    renderCalendar() {
        this.calendar.innerHTML = '';

        const monthNames = [
            'January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December'
        ];
        this.monthDisplay.textContent = `${monthNames[this.currentDate.getMonth()]} ${this.currentDate.getFullYear()}`;

        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        dayNames.forEach(dayName => {
            const dayHeader = document.createElement('div');
            dayHeader.textContent = dayName;
            this.calendar.appendChild(dayHeader);
        });

        const firstDay = new Date(this.currentDate.getFullYear(), this.currentDate.getMonth(), 1);
        const lastDay = new Date(this.currentDate.getFullYear(), this.currentDate.getMonth() + 1, 0);

        for (let i = 0; i < firstDay.getDay(); i++) {
            this.calendar.appendChild(document.createElement('div'));
        }


        // Loop through each day of the month
        for (let day = 1; day <= lastDay.getDate(); day++) {
            const dayElement = document.createElement('div');
            dayElement.classList.add('day');

            // Create a Date object for the current day
            const currentDate = new Date(this.currentDate.getFullYear(), this.currentDate.getMonth(), day);
            const dateString = currentDate.toISOString().split('T')[0]; // Format date as YYYY-MM-DD

            // Add the day number to the cell
            const dayHeader = document.createElement('div');
            dayHeader.classList.add('day-header');
            dayHeader.textContent = day;
            dayElement.appendChild(dayHeader);

            // Find and sort rentals for this specific date
            const dayRentals = this.rentalData
                .filter(rental => rental.date === dateString && rental.status !== 'denied') // Only show rentals that are not denied
                .sort((a, b) => this.parseTime(a.time.split(' - ')[0]) - this.parseTime(b.time.split(' - ')[0])); // Sort by start time

            // Display rental information for the day
            dayRentals.forEach(rental => {
                const rentalElement = document.createElement('div');
                rentalElement.classList.add('rental', rental.status); // Add status class to style accordingly
                rentalElement.innerHTML = `
                    <strong>${rental.name}</strong><br>
                    ${rental.time}<br>
                    ${rental.description}
                `;
                dayElement.appendChild(rentalElement);
            });

            // Add event listener for expanding/collapsing day details (optional)
            dayElement.addEventListener('click', () => {
                dayElement.classList.toggle('expanded'); // Toggle expanded view
            });

            this.calendar.appendChild(dayElement); // Append day element to the calendar
        }
    }
}

// Initialize the calendar when the page loads
new IceRinkCalendar();
