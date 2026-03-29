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

	document.addEventListener('DOMContentLoaded', () => {
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
