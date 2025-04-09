const secretKey = "mySuperSecretKey123";

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

// Handle form submission
document.getElementById("signup-form").addEventListener("submit", function (event) {
    event.preventDefault(); 

    const password = document.getElementById("password").value;
    const repeatPassword = document.getElementById("repeat-password").value;
    const messageEl = document.getElementById("message");
    const resultEl = document.getElementById("result");

    if (password.length < 8) {
        messageEl.textContent = "Password must be at least 8 characters.";
        return;
    }

    if (password !== repeatPassword) {
        messageEl.textContent = "Passwords do not match.";
        return;
    }

    // Encrypting in AES
    const encryptedPassword = CryptoJS.AES.encrypt(password, secretKey).toString();

    messageEl.textContent = "Account created successfully!";
    resultEl.innerHTML = `
        <strong>Encrypted Password:</strong><br>${encryptedPassword}
    `;
    
    setTimeout(function() {
        messageEl.textContent = '';
        resultEl.innerHTML = '';
    }, 5000);
});