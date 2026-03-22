// Home Page JavaScript
(function () {
    'use strict';

    const HOME_STATS_ENDPOINT = '/dashboards/api/parking-source/public-stats/';
    const HOME_STATS_POLL_MS = 2000;

    let pollTimer = null;

    function updateHomeStats(total, occupied, available) {
        const totalEl = document.getElementById('homeTotalSpots');
        const occupiedEl = document.getElementById('homeOccupiedSpots');
        const availableEl = document.getElementById('homeAvailableSpots');

        const formatStat = (value) => {
            if (value === '--') {
                return '--';
            }
            return String(Math.max(0, Number(value) || 0));
        };

        if (totalEl) {
            totalEl.textContent = formatStat(total);
        }
        if (occupiedEl) {
            occupiedEl.textContent = formatStat(occupied);
        }
        if (availableEl) {
            availableEl.textContent = formatStat(available);
        }
    }

    function setHomeStatsInactive() {
        updateHomeStats('--', '--', '--');
    }

    function updateLastUpdated() {
        const stamp = document.querySelector('.last-updated');
        if (!stamp) {
            return;
        }
        stamp.textContent = `Last updated: ${new Date().toLocaleTimeString()}`;
    }

    async function fetchAndUpdateStats() {
        try {
            const response = await fetch(`${HOME_STATS_ENDPOINT}?t=${Date.now()}`, {
                method: 'GET',
                cache: 'no-store',
            });
            if (!response.ok) {
                return;
            }

            const payload = await response.json();
            if (!payload || payload.active !== true) {
                setHomeStatsInactive();
                updateLastUpdated();
                return;
            }

            const stats = payload && payload.stats ? payload.stats : {};
            updateHomeStats(stats.total || 0, stats.occupied || 0, stats.available || 0);
            updateLastUpdated();
        } catch (error) {
            console.error('Home stats fetch failed:', error);
        }
    }

    document.addEventListener('DOMContentLoaded', function () {
        const ctaButton = document.querySelector('.btn-cta');
        if (ctaButton) {
            ctaButton.addEventListener('click', function () {
                console.log('Check Availability clicked');
            });
        }

        fetchAndUpdateStats();
        pollTimer = window.setInterval(fetchAndUpdateStats, HOME_STATS_POLL_MS);
    });

    window.addEventListener('beforeunload', function () {
        if (pollTimer) {
            window.clearInterval(pollTimer);
            pollTimer = null;
        }
    });
})();
