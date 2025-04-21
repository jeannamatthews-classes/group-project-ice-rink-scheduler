const firebaseConfig = {
  apiKey: "AIzaSyA_VXKD9_HiLyNZnzwAn7UB9RPrvMJSMPM",
  authDomain: "icerinkscheduling.firebaseapp.com",
  projectId: "icerinkscheduling",
  storageBucket: "icerinkscheduling.appspot.com",
  messagingSenderId: "887329525211",
  appId: "1:887329525211:web:75bc17a1639dfdc5d4abfe"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

function logout() {
  auth.signOut().then(() => {
    window.location.href = "/logout"; // server clears the cookie too
  });
}


function toggleUserPopup() {
  document.getElementById("userProfilePopup").classList.toggle("show");
}

// Initialize auth state listener
auth.onAuthStateChanged(async (user) => {
  if (user) {
    try {
      // Set email from Firebase auth
      document.getElementById("userEmail").textContent = `Email: ${user.email || "No email found"}`;
      
      // Initialize other modules that need the user
      await initProfileModule(user);
      await initRequestsModule(user);
      
    } catch (error) {
      console.error("Error during auth state change:", error);
    }
  } else {
    window.location.href = "/";
  }
});