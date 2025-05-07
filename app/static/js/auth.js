const firebaseConfig = {
  apiKey: "AIzaSyDOJnX2Cfp5ibbxl18jb_-44-n5NxNF_6Y",
  authDomain: "clarksonicerink2.firebaseapp.com",
  projectId: "clarksonicerink2",
  storageBucket: "clarksonicerink2.firebasestorage.app",
  messagingSenderId: "763006421145",
  appId: "1:763006421145:web:b26bf97a527913495a1008",
  measurementId: "G-D1WC6SSD6W"
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