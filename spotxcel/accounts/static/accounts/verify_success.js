document.addEventListener('DOMContentLoaded', function() {
    const redirectTarget = document.querySelector('.auth-container')?.getAttribute('data-redirect-url') || '/';

    setTimeout(function() {
        window.location.href = redirectTarget;
    }, 3000);
});
