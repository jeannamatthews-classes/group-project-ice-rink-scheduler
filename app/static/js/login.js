
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

  document.getElementById("login").addEventListener("click", async () => {
    const email = document.getElementById("loginEmail").value.trim();
    const password = document.getElementById("loginPassword").value;
    const errorDiv = document.getElementById("loginError");
    const loadingDiv = document.getElementById("loginLoading");

    errorDiv.textContent = "";
    loadingDiv.style.display = "block";

    try {
      const userCredential = await auth.signInWithEmailAndPassword(email, password);
      const user = userCredential.user;

      if (!user.emailVerified) {
        errorDiv.textContent = "Please verify your email before logging in.";
        loadingDiv.style.display = "none";
        await auth.signOut();
        return;
      }

      const token = await user.getIdToken();

      // Check if user is admin
      const response = await fetch('/check-admin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ email })
      });

      const data = await response.json();
      document.cookie = `firebaseToken=${token}; path=/; secure; samesite=strict`;

      // If not admin, check/create user in backend
      if (!data.isAdmin) {
        await fetch('/check-user', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
      }

      // Redirect based on admin status
      if (data.isAdmin) {
        window.location.href = "/admin";
      } else {
        window.location.href = "/u";
      }

    } catch (error) {
      loadingDiv.style.display = "none";
      if (error.code === "auth/wrong-password" || error.code === "auth/user-not-found") {
        errorDiv.textContent = "Invalid email or password.";
      } else {
        errorDiv.textContent = error.message;
      }
    }
  });

  // Handle Enter key in login form
  document.getElementById("loginPassword").addEventListener("keypress", function(event) {
    if (event.key === "Enter") {
      event.preventDefault();
      document.getElementById("login").click();
    }
  });

