(function () {
	'use strict';

	function csvEscape(value) {
		const normalized = String(value == null ? '' : value);
		if (/[",\n]/.test(normalized)) {
			return `"${normalized.replace(/"/g, '""')}"`;
		}
		return normalized;
	}

	function collectTableCsv() {
		const table = document.querySelector('.records-table');
		if (!table) {
			return '';
		}

		const rows = table.querySelectorAll('tr');
		const csvLines = [];

		rows.forEach((row) => {
			const cells = row.querySelectorAll('th, td');
			if (!cells.length) {
				return;
			}

			const line = Array.from(cells)
				.map((cell) => csvEscape(cell.textContent.trim()))
				.join(',');
			csvLines.push(line);
		});

		return csvLines.join('\n');
	}

	function downloadCsv(filename, content) {
		const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
		const url = URL.createObjectURL(blob);
		const anchor = document.createElement('a');

		anchor.href = url;
		anchor.download = filename;
		document.body.appendChild(anchor);
		anchor.click();
		document.body.removeChild(anchor);
		URL.revokeObjectURL(url);
	}

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
		if (periodSelect) {
			togglePeriodInputs();
			periodSelect.addEventListener('change', togglePeriodInputs);
		}

		const exportButton = document.querySelector('.btn-export');
		if (!exportButton) {
			return;
		}

		exportButton.addEventListener('click', () => {
			const csvContent = collectTableCsv();
			if (!csvContent.trim()) {
				return;
			}

			const now = new Date();
			const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
			downloadCsv(`parking_records_${stamp}.csv`, csvContent);
		});
	});
})();
