(function () {
    'use strict';

    function parseJsonScript(id) {
        const node = document.getElementById(id);
        if (!node || !node.textContent) {
            return null;
        }
        try {
            return JSON.parse(node.textContent);
        } catch (error) {
            return null;
        }
    }

    function clearNode(node) {
        while (node.firstChild) {
            node.removeChild(node.firstChild);
        }
    }

    function csvEscape(value) {
        const normalized = String(value == null ? '' : value);
        if (/[",\n]/.test(normalized)) {
            return `"${normalized.replace(/"/g, '""')}"`;
        }
        return normalized;
    }

    function downloadCsv(filename, rows) {
        const content = rows.map((row) => row.map(csvEscape).join(',')).join('\n');
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

    function toggleStatsPeriodInputs() {
        const periodSelect = document.getElementById('stats-period');
        if (!periodSelect) {
            return;
        }

        const dayInput = document.getElementById('stats-day');
        const monthInput = document.getElementById('stats-month');
        const yearInput = document.getElementById('stats-year');
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

        const dayWrap = document.querySelector('.stats-period-day');
        const monthWrap = document.querySelector('.stats-period-month');
        const yearWrap = document.querySelector('.stats-period-year');

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

    function renderLineChart(container, labels, parkingSeries, detectionSeries) {
        if (!container) {
            return;
        }

        clearNode(container);

        const width = 760;
        const height = 230;
        const padding = { top: 12, right: 14, bottom: 30, left: 30 };
        const graphWidth = width - padding.left - padding.right;
        const graphHeight = height - padding.top - padding.bottom;
        const points = labels.length;
        const stepX = points > 1 ? graphWidth / (points - 1) : graphWidth;
        const maxValue = Math.max(1, ...parkingSeries, ...detectionSeries);

        const toX = (idx) => padding.left + stepX * idx;
        const toY = (value) => padding.top + graphHeight - (value / maxValue) * graphHeight;

        const parkingPath = parkingSeries
            .map((value, idx) => `${idx === 0 ? 'M' : 'L'} ${toX(idx)} ${toY(value)}`)
            .join(' ');
        const detectionPath = detectionSeries
            .map((value, idx) => `${idx === 0 ? 'M' : 'L'} ${toX(idx)} ${toY(value)}`)
            .join(' ');

        const gridLines = [0, 0.25, 0.5, 0.75, 1].map((ratio) => {
            const y = padding.top + graphHeight * ratio;
            return `<line class="chart-grid" x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" />`;
        }).join('');

        const xLabels = labels.map((label, idx) => {
            const x = toX(idx);
            const y = height - 8;
            return `<text class="chart-label" text-anchor="middle" x="${x}" y="${y}">${label}</text>`;
        }).join('');

        const parkingDots = parkingSeries.map((value, idx) => (
            `<circle cx="${toX(idx)}" cy="${toY(value)}" r="3.6" fill="#EA580C"></circle>`
        )).join('');
        const detectionDots = detectionSeries.map((value, idx) => (
            `<circle cx="${toX(idx)}" cy="${toY(value)}" r="3.6" fill="#1D4ED8"></circle>`
        )).join('');

        container.innerHTML = `
            <svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Parking and detection trends">
                ${gridLines}
                <path d="${parkingPath}" fill="none" stroke="#EA580C" stroke-width="2.5"></path>
                <path d="${detectionPath}" fill="none" stroke="#1D4ED8" stroke-width="2.5"></path>
                ${parkingDots}
                ${detectionDots}
                ${xLabels}
            </svg>
            <div class="legend">
                <span class="legend-item"><span class="legend-dot" style="background:#EA580C"></span>Parking Sessions</span>
                <span class="legend-item"><span class="legend-dot" style="background:#1D4ED8"></span>Plate Detections</span>
            </div>
        `;
    }

    function renderBarChart(container, labels, series, color) {
        if (!container) {
            return;
        }

        clearNode(container);

        const width = 760;
        const height = 230;
        const padding = { top: 8, right: 12, bottom: 30, left: 24 };
        const graphWidth = width - padding.left - padding.right;
        const graphHeight = height - padding.top - padding.bottom;
        const maxValue = Math.max(1, ...series);
        const barWidth = graphWidth / Math.max(1, labels.length);

        const bars = series.map((value, idx) => {
            const h = (value / maxValue) * graphHeight;
            const x = padding.left + idx * barWidth + 2;
            const y = padding.top + graphHeight - h;
            const w = Math.max(3, barWidth - 4);
            return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${color}" rx="2"></rect>`;
        }).join('');

        const xLabels = labels.map((label, idx) => {
            const x = padding.left + idx * barWidth + barWidth / 2;
            const y = height - 8;
            const shortLabel = label.length > 8 ? `${label.slice(0, 7)}.` : label;
            return `<text class="chart-label" text-anchor="middle" x="${x}" y="${y}">${shortLabel}</text>`;
        }).join('');

        container.innerHTML = `
            <svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Bar chart">
                <line class="chart-grid" x1="${padding.left}" y1="${padding.top + graphHeight}" x2="${width - padding.right}" y2="${padding.top + graphHeight}"></line>
                ${bars}
                ${xLabels}
            </svg>
        `;
    }

    function renderDonutChart(container, labels, series) {
        if (!container) {
            return;
        }

        clearNode(container);

        const total = series.reduce((sum, value) => sum + value, 0);
        if (!total) {
            container.innerHTML = '<p class="empty-state-cell">No plate type records available.</p>';
            return;
        }

        const colors = ['#EA580C', '#2563EB', '#10B981', '#F59E0B', '#7C3AED', '#0EA5E9'];
        const circumference = 439.822;
        let cumulative = 0;

        const segments = series.map((value, idx) => {
            const ratio = value / total;
            const dash = `${ratio * circumference} ${circumference - ratio * circumference}`;
            const offset = -cumulative * circumference;
            cumulative += ratio;
            return `<circle cx="82" cy="82" r="70" fill="none" stroke="${colors[idx % colors.length]}" stroke-width="22" stroke-dasharray="${dash}" stroke-dashoffset="${offset}" transform="rotate(-90 82 82)"></circle>`;
        }).join('');

        const legend = labels.map((label, idx) => {
            const count = series[idx];
            const pct = ((count / total) * 100).toFixed(1);
            return `<span class="legend-item"><span class="legend-dot" style="background:${colors[idx % colors.length]}"></span>${label}: ${count} (${pct}%)</span>`;
        }).join('');

        container.innerHTML = `
            <svg class="chart-svg" viewBox="0 0 164 164" role="img" aria-label="Plate type distribution">
                ${segments}
                <text x="82" y="78" text-anchor="middle" style="font-size:12px;fill:#6B7280">Total</text>
                <text x="82" y="98" text-anchor="middle" style="font-size:24px;font-weight:700;fill:#111827">${total}</text>
            </svg>
            <div class="legend">${legend}</div>
        `;
    }

    function setupExport(summary, dailyTrends, confidenceBands) {
        const button = document.getElementById('export-system-stats');
        if (!button) {
            return;
        }

        button.addEventListener('click', () => {
            const now = new Date();
            const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;

            const rows = [
                ['Metric', 'Value'],
                ['Total Users', summary.total_users],
                ['Verified Users', summary.verified_users],
                ['Verification Rate (%)', summary.verification_rate],
                ['Total Parking Sessions', summary.total_parking_sessions],
                ['Active Sessions', summary.active_sessions],
                ['Completed Sessions', summary.completed_sessions],
                ['Total Detections', summary.total_detections],
                ['Average Confidence', summary.avg_confidence],
                ['Total Revenue (Rs)', summary.total_revenue],
                ['Today Revenue (Rs)', summary.today_revenue],
                ['Occupancy Rate (%)', summary.occupancy_rate],
                [],
                ['Day', 'Parking Sessions', 'Detections'],
            ];

            dailyTrends.labels.forEach((label, index) => {
                rows.push([label, dailyTrends.parking_series[index], dailyTrends.detection_series[index]]);
            });

            rows.push([]);
            rows.push(['Confidence Band', 'Count']);
            confidenceBands.labels.forEach((label, index) => {
                rows.push([label, confidenceBands.series[index]]);
            });

            downloadCsv(`system_stats_${stamp}.csv`, rows);
        });
    }

    document.addEventListener('DOMContentLoaded', () => {
        const statsPeriodSelect = document.getElementById('stats-period');
        if (statsPeriodSelect) {
            toggleStatsPeriodInputs();
            statsPeriodSelect.addEventListener('change', toggleStatsPeriodInputs);
        }

        const dailyTrends = parseJsonScript('daily-trends-data') || { labels: [], parking_series: [], detection_series: [] };
        const plateType = parseJsonScript('plate-type-data') || { labels: [], series: [] };
        const peakHours = parseJsonScript('peak-hours-data') || { labels: [], series: [] };
        const confidenceBands = parseJsonScript('confidence-bands-data') || { labels: [], series: [] };
        const summary = parseJsonScript('summary-data') || {};

        renderLineChart(
            document.getElementById('daily-trends-chart'),
            dailyTrends.labels,
            dailyTrends.parking_series,
            dailyTrends.detection_series
        );
        renderDonutChart(
            document.getElementById('plate-type-chart'),
            plateType.labels,
            plateType.series
        );
        renderBarChart(
            document.getElementById('confidence-chart'),
            confidenceBands.labels,
            confidenceBands.series,
            '#F97316'
        );
        renderBarChart(
            document.getElementById('peak-hours-chart'),
            peakHours.labels,
            peakHours.series,
            '#2563EB'
        );

        setupExport(summary, dailyTrends, confidenceBands);
    });
})();
