// Profile Settings JavaScript

// Store original form values on page load
let originalFormValues = {};

document.addEventListener('DOMContentLoaded', function() {
    const form = document.querySelector('.profile-form');
    const inputs = form.querySelectorAll('input');

    // Store original values
    inputs.forEach(input => {
        if (input.type !== 'password') {
            originalFormValues[input.id || input.name] = input.value;
        }
    });

    const deleteAccountForm = document.getElementById('delete-account-form');
    const deleteAccountBtn = document.getElementById('delete-account-btn');
    const deleteAccountModal = document.getElementById('deleteAccountModal');
    const closeDeleteAccountModalBtn = document.getElementById('closeDeleteAccountModalBtn');
    const cancelDeleteAccountBtn = document.getElementById('cancelDeleteAccountBtn');
    const confirmDeleteAccountBtn = document.getElementById('confirmDeleteAccountBtn');

    function openDeleteAccountModal() {
        if (deleteAccountModal) {
            deleteAccountModal.classList.add('show');
        }
    }

    function closeDeleteAccountModal() {
        if (deleteAccountModal) {
            deleteAccountModal.classList.remove('show');
        }
    }

    if (deleteAccountBtn) {
        deleteAccountBtn.addEventListener('click', function(e) {
            e.preventDefault();
            openDeleteAccountModal();
        });
    }

    if (closeDeleteAccountModalBtn) {
        closeDeleteAccountModalBtn.addEventListener('click', closeDeleteAccountModal);
    }

    if (cancelDeleteAccountBtn) {
        cancelDeleteAccountBtn.addEventListener('click', closeDeleteAccountModal);
    }

    if (confirmDeleteAccountBtn && deleteAccountForm) {
        confirmDeleteAccountBtn.addEventListener('click', function() {
            deleteAccountForm.submit();
        });
    }

    if (deleteAccountModal) {
        deleteAccountModal.addEventListener('click', function(e) {
            if (e.target === deleteAccountModal) {
                closeDeleteAccountModal();
            }
        });
    }

    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            closeDeleteAccountModal();
        }
    });
});

// Show alert message
function showAlert(message) {
    // Create or get existing alert card
    let alertCard = document.querySelector('.alert-card');
    
    if (!alertCard) {
        alertCard = document.createElement('div');
        alertCard.className = 'alert-card alert-error';
        alertCard.innerHTML = `
            <i class="fas fa-exclamation-circle alert-icon"></i>
            <div class="alert-content">
                <p class="alert-message"></p>
            </div>
        `;
        document.querySelector('.profile-container').insertBefore(
            alertCard, 
            document.querySelector('.page-header')
        );
    }
    
    const alertMessage = alertCard.querySelector('.alert-message');
    alertMessage.textContent = message;
    alertCard.className = 'alert-card alert-error';
    alertCard.style.display = 'flex';
    
    // Scroll to top to show alert
    window.scrollTo({ top: 0, behavior: 'smooth' });
    
    // Auto-hide after 5 seconds
    setTimeout(() => {
        alertCard.style.display = 'none';
    }, 5000);
}

// Form validation on submit
document.addEventListener('DOMContentLoaded', function() {
    const form = document.querySelector('.profile-form');
    
    form.addEventListener('submit', function(e) {
        const usernameInput = document.getElementById('fullname');
        const emailInput = document.getElementById('email');
        const currentPasswordInput = document.getElementById('current_password');
        const newPasswordInput = document.getElementById('new_password');
        
        const username = usernameInput.value.trim();
        const email = emailInput.value.trim();
        const currentPassword = currentPasswordInput.value;
        const newPassword = newPasswordInput.value;
        
        // Reset visual states
        usernameInput.classList.remove('input-error', 'input-success');
        emailInput.classList.remove('input-error', 'input-success');
        currentPasswordInput.classList.remove('input-error', 'input-success');
        newPasswordInput.classList.remove('input-error', 'input-success');
        
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
        
        // Email validation
        if (!email || !email.includes('@')) {
            e.preventDefault();
            showAlert('Please enter a valid email address.');
            emailInput.classList.add('input-error');
            emailInput.focus();
            return false;
        }
        
        // Password validation - only if user is trying to change password
        if (newPassword) {
            // Current password is required to change password
            if (!currentPassword) {
                e.preventDefault();
                showAlert('Current password is required to set a new password.');
                currentPasswordInput.classList.add('input-error');
                currentPasswordInput.focus();
                return false;
            }
            
            // New password strength check
            if (newPassword.length < 8) {
                e.preventDefault();
                showAlert('New password must be at least 8 characters long.');
                newPasswordInput.classList.add('input-error');
                newPasswordInput.focus();
                return false;
            }
        }
        
        // All validations passed
        return true;
    });
});

// Reset form to original values
function resetForm() {
    const form = document.querySelector('.profile-form');
    const inputs = form.querySelectorAll('input');
    
    // Reset all inputs to original values
    inputs.forEach(input => {
        if (input.type === 'password') {
            input.value = ''; // Clear password fields
        } else if (originalFormValues[input.id || input.name] !== undefined) {
            input.value = originalFormValues[input.id || input.name];
        }
    });
    
    // Clear any dynamically added vehicles
    const vehiclesList = document.getElementById('vehiclesList');
    if (vehiclesList) {
        vehiclesList.innerHTML = '';
    }
}

// Add Vehicle Button (optional; section may be hidden/removed)
const addVehicleBtn = document.getElementById('addVehicleBtn');
if (addVehicleBtn) {
    addVehicleBtn.addEventListener('click', function() {
        const vehiclesList = document.getElementById('vehiclesList');
        if (!vehiclesList) {
            return;
        }

        // Create new vehicle item
        const vehicleItem = document.createElement('div');
        vehicleItem.className = 'vehicle-item';
        vehicleItem.innerHTML = `
            <div class="vehicle-field">
                <label>Vehicle Type</label>
                <div class="input-with-icon">
                    <i class="fas fa-car"></i>
                    <select name="vehicle_type[]">
                        <option selected>Passenger Car</option>
                        <option>Motorcycle</option>
                        <option>SUV / Van</option>
                        <option>Truck</option>
                    </select>
                </div>
            </div>
            <div class="vehicle-field">
                <label>Number Plate</label>
                <div class="input-with-icon">
                    <i class="fas fa-hashtag"></i>
                    <input type="text" name="number_plate[]" placeholder="ABC-123" class="plate-input">
                </div>
            </div>
            <button type="button" class="btn-remove-vehicle" onclick="removeVehicle(this)">
                <i class="fas fa-trash"></i>
                <span class="btn-text">Remove</span>
            </button>
        `;

        vehiclesList.appendChild(vehicleItem);
    });
}

// Remove Vehicle Function
function removeVehicle(button) {
    const vehicleItem = button.closest('.vehicle-item');
    vehicleItem.remove();
}

// Auto-uppercase for number plates
document.addEventListener('input', function(e) {
    if (e.target.classList.contains('plate-input')) {
        e.target.value = e.target.value.toUpperCase();
    }
});
