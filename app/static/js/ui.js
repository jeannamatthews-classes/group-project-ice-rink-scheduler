function switchView(viewId) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(viewId).classList.add('active');

  document.querySelectorAll('.view-buttons button').forEach(btn => {
    btn.classList.remove('active');
    if (btn.textContent.toLowerCase().includes(viewId)) btn.classList.add('active');
  });
}

// Close modal if clicked outside
window.onclick = function(event) {
  const modal = document.getElementById("editProfileModal");
  if (event.target === modal) {
    closeEditProfileModal();
  }
}