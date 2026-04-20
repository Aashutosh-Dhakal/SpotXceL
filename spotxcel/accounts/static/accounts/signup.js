// Signup Form Validation and Interactive Features
document.addEventListener('DOMContentLoaded', function() {
    const form = document.getElementById('signup-form');
    const usernameInput = document.getElementById('username');
    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('password');
    const confirmPasswordInput = document.getElementById('confirm_password');
    const togglePassword = document.getElementById('toggle-password');
    const toggleConfirmPassword = document.getElementById('toggle-confirm-password');
    const passwordIcon = document.getElementById('password-icon');
    const confirmPasswordIcon = document.getElementById('confirm-password-icon');
    const strengthContainer = document.getElementById('password-strength');
    const strengthBars = document.querySelectorAll('.strength-bar');
    const strengthText = document.getElementById('strength-text');
    const alertCard = document.getElementById('alert-card');
    const alertMessage = document.getElementById('alert-message');
    const termsLink = document.getElementById('terms-link');
    const termsModal = document.getElementById('terms-modal');
    const termsModalClose = document.getElementById('terms-modal-close');

    // Show alert message
    function showAlert(message) {
        alertMessage.textContent = message;
        alertCard.className = 'alert-card alert-error'; // Add error class for red styling
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

    function openTermsModal() {
        if (!termsModal) {
            return;
        }
        termsModal.classList.add('is-open');
        termsModal.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';
    }

    function closeTermsModal() {
        if (!termsModal) {
            return;
        }
        termsModal.classList.remove('is-open');
        termsModal.setAttribute('aria-hidden', 'true');
        document.body.style.overflow = '';
    }

    if (termsLink && termsModal) {
        termsLink.addEventListener('click', function(e) {
            e.preventDefault();
            openTermsModal();
        });

        if (termsModalClose) {
            termsModalClose.addEventListener('click', closeTermsModal);
        }

        termsModal.addEventListener('click', function(e) {
            if (e.target.closest('[data-action="close-terms"]')) {
                closeTermsModal();
            }
        });

        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape' && termsModal.classList.contains('is-open')) {
                closeTermsModal();
            }
        });
    }

    // Password visibility toggle
    togglePassword.addEventListener('click', function() {
        const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
        passwordInput.setAttribute('type', type);
        passwordIcon.className = type === 'password' ? 'fas fa-eye' : 'fas fa-eye-slash';
    });

    toggleConfirmPassword.addEventListener('click', function() {
        const type = confirmPasswordInput.getAttribute('type') === 'password' ? 'text' : 'password';
        confirmPasswordInput.setAttribute('type', type);
        confirmPasswordIcon.className = type === 'password' ? 'fas fa-eye' : 'fas fa-eye-slash';
    });

    // Password strength calculation with new rules
    passwordInput.addEventListener('input', function() {
        const password = passwordInput.value;
        
        if (password.length === 0) {
            strengthContainer.style.display = 'none';
            return;
        }
        
        strengthContainer.style.display = 'block';
        const strength = calculatePasswordStrength(password);
        updateStrengthIndicator(strength);
    });

    function calculatePasswordStrength(password) {
        let score = 0;
        
        // Check for simple/common passwords
        const commonPasswords = ['password', '12345678', 'qwerty', 'abc123', 'password123'];
        if (commonPasswords.some(common => password.toLowerCase().includes(common))) {
            return { level: 'weak', score: 0 };
        }
        
        const length = password.length;
        const hasLowercase = /[a-z]/.test(password);
        const hasUppercase = /[A-Z]/.test(password);
        const hasNumbers = /[0-9]/.test(password);
        const hasSymbols = /[^a-zA-Z0-9]/.test(password);
        
        // Weak: Under 8 characters
        if (length < 8) {
            return { level: 'weak', score: 0 };
        }
        
        // Fair: 8+ characters, mix of letters and numbers
        if (length >= 8 && ((hasLowercase || hasUppercase) && hasNumbers)) {
            score = 2;
        }
        
        // Good: 10+ characters, mix of uppercase, lowercase, numbers, and symbols
        if (length >= 10 && hasLowercase && hasUppercase && hasNumbers && hasSymbols) {
            score = 3;
        }
        
        // Strong: 12+ characters, complex variety
        if (length >= 12 && hasLowercase && hasUppercase && hasNumbers && hasSymbols) {
            score = 4;
        }
        
        const levels = ['weak', 'weak', 'fair', 'good', 'strong'];
        return { level: levels[score], score: score };
    }

    function updateStrengthIndicator(strength) {
        const labels = {
            'weak': 'Weak',
            'fair': 'Fair',
            'good': 'Good',
            'strong': 'Strong'
        };
        
        // Reset all bars
        strengthBars.forEach(bar => {
            bar.className = 'strength-bar';
        });
        
        // Color bars based on score
        for (let i = 0; i < strength.score; i++) {
            strengthBars[i].classList.add(strength.level);
        }
        
        // Update text
        strengthText.className = `strength-text ${strength.level}`;
        strengthText.textContent = `Strength: ${labels[strength.level]}`;
    }

    // Visual feedback for password match (no error message)
    function updatePasswordMatchVisual() {
        if (confirmPasswordInput.value === '') {
            confirmPasswordInput.classList.remove('input-error', 'input-success');
            return;
        }
        
        if (passwordInput.value === confirmPasswordInput.value) {
            confirmPasswordInput.classList.remove('input-error');
            confirmPasswordInput.classList.add('input-success');
        } else {
            confirmPasswordInput.classList.add('input-error');
            confirmPasswordInput.classList.remove('input-success');
        }
    }

    confirmPasswordInput.addEventListener('input', updatePasswordMatchVisual);
    passwordInput.addEventListener('input', function() {
        if (confirmPasswordInput.value) {
            updatePasswordMatchVisual();
        }
    });

    // Form submission validation - validate everything on submit
    form.addEventListener('submit', function(e) {
        const username = usernameInput.value.trim();
        const email = emailInput.value.trim();
        const password = passwordInput.value;
        const confirmPassword = confirmPasswordInput.value;
        const terms = document.getElementById('terms').checked;
        
        // Reset all visual states
        usernameInput.classList.remove('input-error', 'input-success');
        emailInput.classList.remove('input-error', 'input-success');
        passwordInput.classList.remove('input-error', 'input-success');
        confirmPasswordInput.classList.remove('input-error', 'input-success');
        
        // Username validation
        if (!username) {
            e.preventDefault();
            showAlert('Username is required.');
            usernameInput.classList.add('input-error');
            usernameInput.focus();
            return false;
        }
        
        // Check for spaces
        if (/\s/.test(username)) {
            e.preventDefault();
            showAlert('Username cannot contain spaces.');
            usernameInput.classList.add('input-error');
            usernameInput.focus();
            return false;
        }
        
        // Check for invalid special characters (allow first letter uppercase, rest lowercase with numbers, underscore, hyphen)
        if (!/^[A-Za-z][a-z0-9_-]*$/.test(username)) {
            e.preventDefault();
            showAlert('Username must start with a letter and can only contain letters (first letter can be uppercase), numbers, underscore, and hyphen.');
            usernameInput.classList.add('input-error');
            usernameInput.focus();
            return false;
        }
        
        // Email validation (match backend rule: must contain both @ and .)
        if (!email || !email.includes('@') || !email.includes('.')) {
            e.preventDefault();
            showAlert('Please enter a valid email address.');
            emailInput.classList.add('input-error');
            emailInput.focus();
            return false;
        }
        
        // Password strength check
        const strength = calculatePasswordStrength(password);
        if (strength.score === 0) {
            e.preventDefault();
            showAlert('Password is too weak. Please use at least 8 characters with letters and numbers.');
            passwordInput.classList.add('input-error');
            passwordInput.focus();
            return false;
        }
        
        // Password match check
        if (password !== confirmPassword) {
            e.preventDefault();
            showAlert('Passwords do not match. Please check and try again.');
            confirmPasswordInput.classList.add('input-error');
            confirmPasswordInput.focus();
            return false;
        }
        
        // Terms agreement check
        if (!terms) {
            e.preventDefault();
            showAlert('You must agree to the Terms & Conditions to continue.');
            return false;
        }
        
        // All validations passed
        return true;
    });
});