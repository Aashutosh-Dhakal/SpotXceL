document.addEventListener('DOMContentLoaded', function() {
    const forgotForm = document.getElementById('forgot-password-form');
    const sendBtn = document.getElementById('btn-send-reset-link');
    if (forgotForm && sendBtn) {
        forgotForm.addEventListener('submit', function() {
            sendBtn.disabled = true;
            sendBtn.classList.add('btn-loading');
            document.getElementById('send-reset-icon').classList.add('hidden');
            document.getElementById('send-reset-text').classList.add('hidden');
            const spinner = document.getElementById('send-reset-spinner');
            spinner.classList.remove('send-spinner-hidden');
            spinner.classList.add('send-spinner-visible');
        });
    }
});
