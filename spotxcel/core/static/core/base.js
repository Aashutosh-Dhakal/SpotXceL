(function () {
    'use strict';

    function autoCloseAlerts(selector, delayMs) {
        const timeoutMs = Number.isFinite(Number(delayMs)) ? Number(delayMs) : 5000;
        const targetSelector = selector || '.alert-card';

        document.querySelectorAll(targetSelector).forEach((alert) => {
            setTimeout(() => {
                alert.style.display = 'none';
            }, timeoutMs);
        });
    }

    window.spotxcelAutoCloseAlerts = autoCloseAlerts;

    document.addEventListener('DOMContentLoaded', function () {
        autoCloseAlerts('.alert-card', 5000);
    });
})();
