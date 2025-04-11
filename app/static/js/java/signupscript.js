const passwordInput = document.getElementById("password");
const hint = document.getElementById("password-hint");
const strengthMeter = document.getElementById("strength-meter");

// Password requirement reminder
passwordInput.addEventListener("focus", () => {
    const rect = passwordInput.getBoundingClientRect();
    hint.style.top = `${rect.top + window.scrollY - 50}px`;
    hint.style.left = `${rect.left + window.scrollX}px`;
    hint.classList.add("show");

    setTimeout(() => {
        hint.classList.remove("show");
    }, 3000);
});

passwordInput.addEventListener("input", () => {
    hint.classList.remove("show");

    const value = passwordInput.value;
    strengthMeter.textContent = getStrengthLabel(value);
    strengthMeter.className = getStrengthClass(value);
});

// Strength label
function getStrengthLabel(password) {
    if (password.length < 8) return "Too short";
    if (/^[a-zA-Z]+$/.test(password)) return "Weak";
    if (/^(?=.*[a-zA-Z])(?=.*[0-9]).{8,}$/.test(password)) return "Medium";
    if (/^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[\W_]).{8,}$/.test(password)) return "Strong";
    return "Medium";
}

// Checks strength of password
function getStrengthClass(password) {
    if (password.length < 8) return "weak";
    if (/^[a-zA-Z]+$/.test(password)) return "weak";
    if (/^(?=.*[a-zA-Z])(?=.*[0-9]).{8,}$/.test(password)) return "medium";
    if (/^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[\W_]).{8,}$/.test(password)) return "strong";
    return "medium";
}

function normalizePhoneNumber(input) {
    return input.replace(/\D/g, ''); // Remove all non-digit characters
}

document.getElementById("signup-form").addEventListener("submit", function (event) {
    event.preventDefault();

    const first_name = document.getElementById("first_name").value;
    const last_name = document.getElementById("last_name").value;
    const renter_email = document.getElementById("renter_email").value;
    let phone = document.getElementById("phone").value;
    const password = document.getElementById("password").value;
    const repeatPassword = document.getElementById("repeat-password").value;

    const messageEl = document.getElementById("message");
    const resultEl = document.getElementById("result");

    phone = normalizePhoneNumber(phone);

    if (password.length < 8) {
        messageEl.textContent = "Password must be at least 8 characters.";
        return;
    }

    if (password !== repeatPassword) {
        messageEl.textContent = "Passwords do not match.";
        return;
    }

    const formData = new FormData();
    formData.append('first_name', first_name);
    formData.append('last_name', last_name);
    formData.append('renter_email', renter_email);
    formData.append('phone', phone);
    formData.append('password', password);

    fetch('/signup', {
        method: 'POST',
        body: formData
    })
    .then(response => {
        if (!response.ok) {
            return response.json().then(data => {
                throw new Error(data.error || "Unknown error");
            });
        }
        return response.json();
    })
    .then(data => {
        messageEl.textContent = data.message || "Account created successfully!";
        setTimeout(() => {
            window.location.href = '/';
        }, 2000);
    })
    .catch(error => {
        messageEl.textContent = "Error: " + error.message;
        console.error("Signup error:", error);
    });
});