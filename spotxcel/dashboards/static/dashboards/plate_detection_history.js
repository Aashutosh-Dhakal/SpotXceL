(function () {
    'use strict';

    function togglePeriodInputs() {
        const periodSelect = document.getElementById('period');
        if (!periodSelect) {
            return;
        }

        const dayInput = document.getElementById('period-day');
        const monthInput = document.getElementById('period-month');
        const yearInput = document.getElementById('period-year');
        const now = new Date();

        if (dayInput && !dayInput.value) {
            const day = String(now.getDate()).padStart(2, '0');
            const month = String(now.getMonth() + 1).padStart(2, '0');
            dayInput.value = `${now.getFullYear()}-${month}-${day}`;
        }
        if (monthInput && !monthInput.value) {
            const month = String(now.getMonth() + 1).padStart(2, '0');
            monthInput.value = `${now.getFullYear()}-${month}`;
        }
        if (yearInput && !yearInput.value) {
            yearInput.value = String(now.getFullYear());
        }

        const dayWrap = document.querySelector('.period-day');
        const monthWrap = document.querySelector('.period-month');
        const yearWrap = document.querySelector('.period-year');

        if (dayWrap) {
            dayWrap.classList.toggle('hidden', periodSelect.value !== 'day');
        }
        if (monthWrap) {
            monthWrap.classList.toggle('hidden', periodSelect.value !== 'month');
        }
        if (yearWrap) {
            yearWrap.classList.toggle('hidden', periodSelect.value !== 'year');
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        const periodSelect = document.getElementById('period');
        if (!periodSelect) {
            return;
        }

        togglePeriodInputs();
        periodSelect.addEventListener('change', togglePeriodInputs);
    });
})();
