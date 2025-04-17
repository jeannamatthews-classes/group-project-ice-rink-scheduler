function switchView(viewName) {
  // Hide all views
  document.querySelectorAll('.view').forEach(view => {
    view.classList.remove('active');
  });
  
  // Deactivate all buttons
  document.querySelectorAll('.view-buttons button').forEach(button => {
    button.classList.remove('active');
  });
  
  // Activate selected view and button
  document.getElementById(viewName).classList.add('active');
  document.querySelector(`.view-buttons button[onclick="switchView('${viewName}')"]`).classList.add('active');
}

// Close modal if clicked outside
window.onclick = function(event) {
  const modal = document.getElementById("editProfileModal");
  if (event.target === modal) {
    closeEditProfileModal();
  }
}