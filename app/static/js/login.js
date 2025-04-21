
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

        // Get the auth token
        const token = await user.getIdToken();

        // Check if user is admin
        const response = await fetch('/check-admin', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            email: email
          })
        });

	const data = await response.json();
        document.cookie = `firebaseToken=${token}; path=/; secure; samesite=strict`;

 
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

    // Add keypress event to handle Enter key in login form
    document.getElementById("loginPassword").addEventListener("keypress", function(event) {
      if (event.key === "Enter") {
        event.preventDefault();
        document.getElementById("login").click();
      }
    });