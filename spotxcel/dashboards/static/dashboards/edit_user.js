document.addEventListener('DOMContentLoaded', function() {
    const form = document.getElementById('edit-user-form');
    const usernameInput = document.getElementById('username');
    const roleSelect = document.getElementById('role');
    const cancelBtn = document.getElementById('cancel-btn');

    if (!form || !usernameInput || !roleSelect || !cancelBtn) {
        return;
    }

    const originalValues = {
        username: usernameInput.value,
        role: roleSelect.value,
    };

    cancelBtn.addEventListener('click', function() {
        usernameInput.value = originalValues.username;
        roleSelect.value = originalValues.role;

        usernameInput.classList.remove('input-error', 'input-success');
        roleSelect.classList.remove('input-error', 'input-success');
    });

    form.addEventListener('submit', function(e) {
        e.preventDefault();

        const username = usernameInput.value.trim();
        const usernameRegex = /^[A-Za-z][a-z0-9_-]*$/;

        usernameInput.classList.remove('input-error', 'input-success');

        if (username.length < 3) {
            usernameInput.classList.add('input-error');
            showAlert('Username must be at least 3 characters long', 'error');
            return;
        }

        if (!usernameRegex.test(username)) {
            usernameInput.classList.add('input-error');
            showAlert('Username must start with a letter and contain only lowercase letters, numbers, underscores, or hyphens', 'error');
            return;
        }

        usernameInput.classList.add('input-success');
        form.submit();
    });

    function showAlert(message, type) {
        const container = document.querySelector('.container');
        if (!container) {
            return;
        }

        const existingAlert = container.querySelector('.alert-card');
        if (existingAlert) {
            existingAlert.remove();
        }

        const alertDiv = document.createElement('div');
        alertDiv.className = `alert-card alert-${type}`;

        let icon = 'info-circle';
        if (type === 'error') icon = 'exclamation-circle';
        else if (type === 'success') icon = 'check-circle';
        else if (type === 'warning') icon = 'exclamation-triangle';

        alertDiv.innerHTML = `
            <i class="fas fa-${icon} alert-icon"></i>
            <div class="alert-content">
                <p class="alert-message">${message}</p>
            </div>
        `;

        container.insertBefore(alertDiv, container.firstChild);

        setTimeout(() => {
            alertDiv.style.display = 'none';
        }, 5000);
    }

});
