// User profile data cache
let currentUserProfile = {
  firstName: "",
  lastName: "",
  phone: ""
};

async function initProfileModule(user) {
  try {
    // Fetch user profile from backend
    const response = await fetch(`/api/user_profile/${user.uid}`);
    const profileData = await response.json();
    
    if (profileData.error) {
      throw new Error(profileData.error);
    }
    
    // Cache the user profile data
    currentUserProfile = {
      firstName: profileData.first_name || "",
      lastName: profileData.last_name || "",
      phone: profileData.phone || ""
    };
    
    // Display user information
    document.getElementById("userName").textContent = `Name: ${profileData.first_name} ${profileData.last_name}`;
    document.getElementById("userPhone").textContent = `Phone: ${profileData.phone || 'Not provided'}`;
    
    // Also populate the edit form
    document.getElementById("firstName").value = currentUserProfile.firstName;
    document.getElementById("lastName").value = currentUserProfile.lastName;
    document.getElementById("phone").value = currentUserProfile.phone;
    
  } catch (error) {
    console.error("Error loading user profile:", error);
    document.getElementById("userName").textContent = "";
    document.getElementById("userPhone").textContent = "";
  }

  // Set up profile form event listeners
  setupProfileForm();
}

function openEditProfileModal() {
  // Close the user profile popup
  document.getElementById("userProfilePopup").classList.remove("show");
  
  // Populate form with current values
  document.getElementById("firstName").value = currentUserProfile.firstName;
  document.getElementById("lastName").value = currentUserProfile.lastName;
  document.getElementById("phone").value = currentUserProfile.phone;
  
  // Show the modal
  document.getElementById("editProfileModal").style.display = "block";
}

function closeEditProfileModal() {
  document.getElementById("editProfileModal").style.display = "none";
}

function setupProfileForm() {
  // Handle profile form submission
  document.getElementById("profileForm").addEventListener("submit", async function(e) {
    e.preventDefault();
    
    const user = auth.currentUser;
    if (!user) {
      alert("You must be logged in to update your profile");
      return;
    }
    
    const firstName = document.getElementById("firstName").value;
    const lastName = document.getElementById("lastName").value;
    const phone = document.getElementById("phone").value;
    
    try {
      const response = await fetch('/api/update_profile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          firebase_uid: user.uid,
          first_name: firstName,
          last_name: lastName,
          phone: phone
        })
      });
      
      const result = await response.json();
      
      if (result.error) {
        throw new Error(result.error);
      }
      
      // Update the cached profile data
      currentUserProfile = {
        firstName,
        lastName,
        phone
      };
      
      // Update displayed profile info
      document.getElementById("userName").textContent = `Name: ${firstName} ${lastName}`;
      document.getElementById("userPhone").textContent = `Phone: ${phone || 'Not provided'}`;
      
      alert("Profile updated successfully!");
      closeEditProfileModal();
    } catch (error) {
      console.error("Error updating profile:", error);
      alert("Error updating profile: " + error.message);
    }
  });
}