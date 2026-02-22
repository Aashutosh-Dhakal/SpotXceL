// Login Form Validation and Interactive Features
document.addEventListener('DOMContentLoaded', function() {
    const form = document.getElementById('login-form');
    const usernameInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');
    const togglePassword = document.getElementById('toggle-password');
    const passwordIcon = document.getElementById('password-icon');
    const alertCard = document.getElementById('alert-card');
    const alertMessage = document.getElementById('alert-message');

    // Show alert message
    function showAlert(message) {
        alertMessage.textContent = message;
        alertCard.className = 'alert-card alert-error';
        alertCard.style.display = 'flex';
        
        // Scroll to top to show alert
        window.scrollTo({ top: 0, behavior: 'smooth' });
        
        // Auto-hide after 5 seconds
        setTimeout(() => {
            hideAlert();
        }, 5000);
    }

    // Hide alert message
    function hideAlert() {
        alertCard.style.display = 'none';
    }

    // Password visibility toggle
    togglePassword.addEventListener('click', function() {
        const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
        passwordInput.setAttribute('type', type);
        passwordIcon.className = type === 'password' ? 'fas fa-eye' : 'fas fa-eye-slash';
    });

    // Form submission validation
    form.addEventListener('submit', function(e) {
        const username = usernameInput.value.trim();
        const password = passwordInput.value;
        
        // Reset visual states
        usernameInput.classList.remove('input-error', 'input-success');
        passwordInput.classList.remove('input-error', 'input-success');
        
        // Username/Email validation
        if (!username) {
            e.preventDefault();
            showAlert('Email or username is required.');
            usernameInput.classList.add('input-error');
            passwordInput.value = ''; // Clear password
            usernameInput.focus();
            return false;
        }
        
        // Password validation
        if (!password) {
            e.preventDefault();
            showAlert('Password is required.');
            passwordInput.classList.add('input-error');
            passwordInput.focus();
            return false;
        }
        
        if (password.length < 8) {
            e.preventDefault();
            showAlert('Password must be at least 8 characters.');
            passwordInput.classList.add('input-error');
            passwordInput.value = ''; // Clear password
            passwordInput.focus();
            return false;
        }
        
        // All validations passed
        return true;
    });
});