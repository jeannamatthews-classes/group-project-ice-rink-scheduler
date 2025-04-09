class IceRinkCalendar {
    constructor() {
        this.currentDate = new Date();

        this.monthDisplay = document.getElementById('monthDisplay');
        this.calendar = document.getElementById('calendar');

        document.getElementById('prevMonth').addEventListener('click', () => this.changeMonth(-1));
        document.getElementById('nextMonth').addEventListener('click', () => this.changeMonth(1));

        this.renderCalendar();
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

        for (let day = 1; day <= lastDay.getDate(); day++) {
            const dayElement = document.createElement('div');
            dayElement.classList.add('day');

            const dayHeader = document.createElement('div');
            dayHeader.classList.add('day-header');
            dayHeader.textContent = day;
            dayElement.appendChild(dayHeader);

            dayElement.addEventListener('click', () => {
                dayElement.classList.toggle('expanded');
            });

            this.calendar.appendChild(dayElement);
        }
    }
}

// Initialize calendar
new IceRinkCalendar();
