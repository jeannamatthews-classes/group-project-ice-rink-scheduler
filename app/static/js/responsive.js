/**
 * Responsive behavior for Ice Rink Scheduling Website
 */
document.addEventListener('DOMContentLoaded', function() {
    initResponsiveBehavior();
  });
  
  function initResponsiveBehavior() {
    // Track horizontal scrolling on mobile
    const mainContainer = document.querySelector('.main-container');
    if (!mainContainer) return;
    
    // Check if we're on mobile
    const isMobile = window.innerWidth <= 576;
    
    if (isMobile) {
      // Transform calendar to vertical layout
      transformCalendarForMobile();
      
      // Add scroll event listener to hide the indicator
      mainContainer.addEventListener('scroll', function() {
        if (mainContainer.scrollLeft > 20) {
          mainContainer.classList.add('scrolled');
        } else {
          mainContainer.classList.remove('scrolled');
        }
      });
      
      // Add touch swipe detection for easier navigation
      let touchStartX = 0;
      let touchEndX = 0;
      
      mainContainer.addEventListener('touchstart', e => {
        touchStartX = e.changedTouches[0].screenX;
      }, {passive: true});
      
      mainContainer.addEventListener('touchend', e => {
        touchEndX = e.changedTouches[0].screenX;
        handleSwipe();
      }, {passive: true});
      
      function handleSwipe() {
        const swipeDistance = touchEndX - touchStartX;
        const swipeThreshold = 50;
        
        if (swipeDistance > swipeThreshold) {
          // Swipe right - scroll to previous panel
          mainContainer.scrollBy({
            left: -window.innerWidth * 0.9,
            behavior: 'smooth'
          });
        } else if (swipeDistance < -swipeThreshold) {
          // Swipe left - scroll to next panel
          mainContainer.scrollBy({
            left: window.innerWidth * 0.9,
            behavior: 'smooth'
          });
        }
      }
    }
    
    // Fix modal positioning for mobile
    const editProfileModal = document.getElementById('editProfileModal');
    if (editProfileModal) {
      const modalContent = editProfileModal.querySelector('.modal-content');
      if (modalContent && window.innerWidth <= 576) {
        modalContent.style.width = '90%';
        modalContent.style.margin = '10% auto';
      }
    }
    
    // Re-apply mobile transformations on window resize
    window.addEventListener('resize', function() {
      const wasMobile = isMobile;
      const isNowMobile = window.innerWidth <= 576;
      
      // If changed between mobile/desktop, reload to apply correct layout
      if (wasMobile !== isNowMobile) {
        if (isNowMobile) {
          transformCalendarForMobile();
        } else {
          // If switching back to desktop, consider reloading the page
          // Or you could try to undo the mobile transformations
          location.reload();
        }
      }
    });
  }
  
  /**
   * Transform the calendar for vertical mobile view
   */
  function transformCalendarForMobile() {
    const calendar = document.getElementById('calendar');
    if (!calendar) return;
    
    // Add day names to each day header for context
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth();
    
    // Get all day cells and enhance them for mobile
    const dayCells = calendar.querySelectorAll('.day');
    dayCells.forEach((dayCell, index) => {
      // Get the day number from the header
      const dayHeader = dayCell.querySelector('.day-header');
      if (!dayHeader) return;
      
      const dayNumber = parseInt(dayHeader.textContent.trim());
      if (isNaN(dayNumber)) return;
      
      // Calculate the day of week
      const date = new Date(currentYear, currentMonth, dayNumber);
      const dayOfWeek = date.getDay();
      
      // Add day name as data attribute
      dayHeader.setAttribute('data-day-name', dayNames[dayOfWeek]);
      
      // Remove expanded behavior (not needed in vertical layout)
      dayCell.removeEventListener('click', null);
      
      // If no events, add placeholder text
      const events = dayCell.querySelectorAll('.event');
      if (events.length === 0) {
        const noEvents = document.createElement('div');
        noEvents.className = 'no-events';
        noEvents.textContent = 'No events scheduled';
        noEvents.style.color = '#999';
        noEvents.style.textAlign = 'center';
        noEvents.style.padding = '10px';
        noEvents.style.fontStyle = 'italic';
        dayCell.appendChild(noEvents);
      }
    });
    
    // Add a "jump to today" button for easier navigation
    addJumpToTodayButton();
  }
  
  /**
   * Add a floating button to jump to today's date
   */
  function addJumpToTodayButton() {
    // Check if button already exists
    if (document.getElementById('jumpToToday')) return;
    
    const jumpButton = document.createElement('button');
    jumpButton.id = 'jumpToToday';
    jumpButton.textContent = 'Today';
    jumpButton.style.position = 'fixed';
    jumpButton.style.bottom = '70px';
    jumpButton.style.right = '15px';
    jumpButton.style.zIndex = '100';
    jumpButton.style.padding = '8px 12px';
    jumpButton.style.backgroundColor = '#0066ff';
    jumpButton.style.color = 'white';
    jumpButton.style.border = 'none';
    jumpButton.style.borderRadius = '20px';
    jumpButton.style.boxShadow = '0 2px 5px rgba(0,0,0,0.2)';
    
    // Get today's date
    const today = new Date();
    const todayDate = today.getDate();
    
    jumpButton.addEventListener('click', function() {
      // Find today's cell
      const dayCells = document.querySelectorAll('.day');
      for (const dayCell of dayCells) {
        const dayHeader = dayCell.querySelector('.day-header');
        if (!dayHeader) continue;
        
        const dayNum = parseInt(dayHeader.textContent.trim());
        if (dayNum === todayDate) {
          // Scroll to today's cell
          dayCell.scrollIntoView({ behavior: 'smooth', block: 'center' });
          
          // Highlight today's cell briefly
          dayCell.style.transition = 'background-color 0.5s';
          dayCell.style.backgroundColor = 'rgba(0, 102, 255, 0.1)';
          setTimeout(() => {
            dayCell.style.backgroundColor = '';
          }, 1500);
          
          break;
        }
      }
    });
    
    document.body.appendChild(jumpButton);
  }
