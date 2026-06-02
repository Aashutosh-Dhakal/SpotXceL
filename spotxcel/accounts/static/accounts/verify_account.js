document.addEventListener('DOMContentLoaded', function() {
    const deleteBtn = document.getElementById('btn-delete-account');
    const deleteForm = document.getElementById('delete-form');
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

    if (deleteBtn) {
        deleteBtn.addEventListener('click', function() {
            openDeleteAccountModal();
        });
    }

    if (closeDeleteAccountModalBtn) {
        closeDeleteAccountModalBtn.addEventListener('click', closeDeleteAccountModal);
    }

    if (cancelDeleteAccountBtn) {
        cancelDeleteAccountBtn.addEventListener('click', closeDeleteAccountModal);
    }

    if (confirmDeleteAccountBtn && deleteForm) {
        confirmDeleteAccountBtn.addEventListener('click', function() {
            deleteForm.submit();
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
