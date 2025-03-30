function checkPassword() {
    let password = document.getElementById("password").value;
    let repeatPassword = document.getElementById("repeat-password").value;
    let message = document.getElementById("message");

    if(password.length >= 8) {
        if(password == repeatPassword) {
            message.textContent = "Passwords Match";
        }
        else {
            alert("Password doesn't match")
        }
    }
    else {
        alert("Password less than 8 characters")
        message.textContent = "";
    }
}