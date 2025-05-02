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
    
    // Fix for expanded calendar days
    const calendar = document.getElementById('calendar');
    if (calendar) {
      // When a day is expanded on mobile, scroll to it
      calendar.addEventListener('click', function(e) {
        const clickedDay = e.target.closest('.day');
        if (!clickedDay) return;
        
        // Check if this day is being expanded
        if (!clickedDay.classList.contains('expanded')) return;
        
        // On mobile, scroll the expanded day into view
        if (isMobile) {
          setTimeout(() => {
            clickedDay.scrollIntoView({
              behavior: 'smooth',
              block: 'center'
            });
          }, 100);
        }
      });
    }
    
    // Adjust calendar height on window resize
    window.addEventListener('resize', function() {
      const calendarContainer = document.querySelector('.calendar-container');
      if (calendarContainer && window.innerWidth <= 576) {
        calendarContainer.style.maxHeight = '80vh';
      } else if (calendarContainer) {
        calendarContainer.style.maxHeight = '650px'; // Reset to original
      }
    });
    
    // Fix modal positioning for mobile
    const editProfileModal = document.getElementById('editProfileModal');
    if (editProfileModal) {
      const modalContent = editProfileModal.querySelector('.modal-content');
      if (modalContent && window.innerWidth <= 576) {
        modalContent.style.width = '90%';
        modalContent.style.margin = '10% auto';
      }
    }
  }
