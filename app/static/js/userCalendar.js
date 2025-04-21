// Combined calendar.js to handle both calendar views
class IceRinkCalendar {
    constructor() {
        this.currentDate = new Date();
        this.allEvents = [];
        this.userEvents = [];
        this.showAllEvents = false; // Start with only user events
        
        this.monthDisplay = document.getElementById('monthDisplay');
        this.calendar = document.getElementById('calendar');
        
        // Add toggle button to the calendar header
        this.addToggleButton();
        
        document.getElementById('prevMonth').addEventListener('click', () => this.changeMonth(-1));
        document.getElementById('nextMonth').addEventListener('click', () => this.changeMonth(1));
        
        // First load user's events, then initialize the calendar
        this.initializeCalendar();
    }
    
    async initializeCalendar() {
        // Wait for Firebase auth to initialize first
        firebase.auth().onAuthStateChanged(async user => {
            if (user) {
                // Load user events first
                await this.fetchUserEvents();
                // Then load all events (but don't display them yet)
                await this.fetchAllEvents();
                // Render the calendar with user events initially
                this.renderCalendar();
            } else {
                // No user logged in, just show all approved events
                this.showAllEvents = true;
                await this.fetchAllEvents();
                this.renderCalendar();
            }
        });
    }
    
    addToggleButton() {
        // Check if button already exists
        if (document.getElementById('toggleCalendar')) {
            return;
        }
        
        // Create a button to toggle between personal and all events
        const toggleButton = document.createElement('button');
        toggleButton.id = 'toggleCalendar';
        toggleButton.innerHTML = '<i class="fas fa-exchange-alt"></i> Show All Events';
        toggleButton.classList.add('toggle-button');
        
        // Insert the button into the calendar header
        const calendarHeader = document.querySelector('.calendar-header');
        calendarHeader.appendChild(toggleButton);
        
        // Add event listener to the toggle button
        toggleButton.addEventListener('click', () => this.toggleCalendarView());
    }
    
    toggleCalendarView() {
        this.showAllEvents = !this.showAllEvents;
        const toggleButton = document.getElementById('toggleCalendar');
        
        if (this.showAllEvents) {
            toggleButton.innerHTML = '<i class="fas fa-user"></i> Show My Events';
        } else {
            toggleButton.innerHTML = '<i class="fas fa-exchange-alt"></i> Show All Events';
        }
        
        // Re-render the calendar with the new view setting
        this.renderCalendar();
    }
    
    async fetchUserEvents() {
        try {
            // Get the current user's ID
            const userId = firebase.auth().currentUser?.uid;
            if (!userId) {
                console.error('No user logged in');
                return;
            }
            
            const response = await fetch(`/api/user_events/${userId}`);
            if (!response.ok) throw new Error('Network response was not ok');
            const data = await response.json();
            this.userEvents = data.events || [];
            console.log('Fetched user events:', this.userEvents.length);
        } catch (error) {
            console.error('Error fetching user data:', error);
        }
    }
    
    async fetchAllEvents() {
        try {
            const response = await fetch('/api/events');
            if (!response.ok) throw new Error('Network response was not ok');
            const data = await response.json();
            this.allEvents = data.events || [];
            console.log('Fetched all events:', this.allEvents.length);
        } catch (error) {
            console.error('Error fetching all events:', error);
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
            
            // Determine which events to display based on the toggle state
            const eventsToShow = this.showAllEvents ? this.allEvents : this.userEvents;
            
            const dayEvents = eventsToShow
                .filter(event => event.date === dateString)
                .sort((a, b) => this.parseTime(a.time.split(' - ')[0]) - this.parseTime(b.time.split(' - ')[0]));
            
            dayEvents.forEach(event => {
                const eventElement = document.createElement('div');
                eventElement.classList.add('event');
                
                // Apply Arial font
                eventElement.style.fontFamily = 'Arial, sans-serif';
                
                // Set color based on event type/status
                if (this.showAllEvents) {
                    // In "all events" view, show approved events in green
                    eventElement.style.backgroundColor = '#02c955';
                } else {
                    // In "my events" view, color by status
                    if (event.status === 'pending') {
                        // Pending events are yellow
                        eventElement.style.backgroundColor = '#FFD700';
                        eventElement.classList.add('pending-event');
                    } else if (event.status === 'approved') {
                        // Approved events are green
                        eventElement.style.backgroundColor = '#02c955';
                        eventElement.classList.add('approved-event');
                    } else if (event.status === 'declined') {
                        // Don't show declined events in the calendar
                        return;
                    }
                }
                
                eventElement.style.color = 'white'; // White text for all
                
                // Format the time in AM/PM format
                const formattedTime = this.formatTimeAmPm(event.time);
                
                // Add status indicator for user's events
                let statusIndicator = '';
                if (!this.showAllEvents) {
                    statusIndicator = `<span class="status-tag ${event.status}">${event.status}</span>`;
                }
                
                eventElement.innerHTML = `
                    <strong>${event.name}</strong> ${statusIndicator}
                    <br>
                    ${formattedTime}<br>
                    ${event.description || ''}
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
        
        // Add legend only for user events view
        if (!this.showAllEvents) {
            this.addCalendarLegend();
        } else {
            // Remove any existing legend when showing all events
            const existingLegend = document.querySelector('.calendar-legend');
            if (existingLegend) {
                existingLegend.remove();
            }
        }
    }
    
    addCalendarLegend() {
        // Remove existing legend if any
        const existingLegend = document.querySelector('.calendar-legend');
        if (existingLegend) {
            existingLegend.remove();
        }
        
        // Create new legend only for user events view
        const legend = document.createElement('div');
        legend.classList.add('calendar-legend');
        
        // Legend for user events view - only pending and approved
        legend.innerHTML = `
            <div class="legend-item">
                <div class="legend-color legend-pending"></div>
                <span>Pending</span>
            </div>
            <div class="legend-item">
                <div class="legend-color legend-approved"></div>
                <span>Approved</span>
            </div>
        `;
        
        this.calendar.parentNode.appendChild(legend);
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
    // Create single instance of calendar
    window.iceRinkCalendar = new IceRinkCalendar();
});