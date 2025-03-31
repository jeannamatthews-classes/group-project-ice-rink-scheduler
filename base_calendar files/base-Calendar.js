class IceRinkCalendar {
    constructor() {
        this.currentDate = new Date();
        this.rentalData = this.generateSampleRentalData();
        
        this.monthDisplay = document.getElementById('monthDisplay');
        this.calendar = document.getElementById('calendar');
        
        document.getElementById('prevMonth').addEventListener('click', () => this.changeMonth(-1));
        document.getElementById('nextMonth').addEventListener('click', () => this.changeMonth(1));
        
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
            
            const currentDate = new Date(this.currentDate.getFullYear(), this.currentDate.getMonth(), day);
            const dateString = currentDate.toISOString().split('T')[0];
            
            const dayHeader = document.createElement('div');
            dayHeader.classList.add('day-header');
            dayHeader.textContent = day;
            dayElement.appendChild(dayHeader);
            
            // Find and sort rentals for this specific date
            const dayRentals = this.rentalData
                .filter(rental => rental.date === dateString&& rental.status !== 'denied')
                .sort((a, b) => this.parseTime(a.time.split(' - ')[0]) - this.parseTime(b.time.split(' - ')[0]));
            
            dayRentals.forEach(rental => {
                const rentalElement = document.createElement('div');
                rentalElement.classList.add('rental', rental.status);
                rentalElement.innerHTML = `
                    <strong>${rental.name}</strong><br>
                    ${rental.time}<br>
                    ${rental.description}
                `;
                dayElement.appendChild(rentalElement);
            });
            
            dayElement.addEventListener('click', () => {
                dayElement.classList.toggle('expanded');
            });
            
            this.calendar.appendChild(dayElement);
        }
    }
}

        // Initialize calendar
        new IceRinkCalendar();