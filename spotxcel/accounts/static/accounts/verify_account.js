document.addEventListener('DOMContentLoaded', function() {
    const deleteBtn = document.getElementById('btn-delete-account');
    const deleteForm = document.getElementById('delete-form');
    if (deleteBtn && deleteForm) {
        deleteBtn.addEventListener('click', function() {
            if (confirm('Are you sure you want to permanently delete your account? This action cannot be undone.')) {
                deleteForm.submit();
            }
        });
    }

    const verifyForm = document.getElementById('verify-form');
    const sendBtn = document.getElementById('btn-send-verify');
    if (verifyForm && sendBtn) {
        verifyForm.addEventListener('submit', function() {
            sendBtn.disabled = true;
            sendBtn.classList.add('btn-loading');
            document.getElementById('send-icon').classList.add('hidden');
            document.getElementById('send-text').classList.add('hidden');
            const spinner = document.getElementById('send-spinner');
            spinner.classList.remove('send-spinner-hidden');
            spinner.classList.add('send-spinner-visible');
        });
    }
});
