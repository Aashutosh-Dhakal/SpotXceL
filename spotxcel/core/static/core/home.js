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

        if (totalEl) {
            totalEl.textContent = String(Math.max(0, Number(total) || 0));
        }
        if (occupiedEl) {
            occupiedEl.textContent = String(Math.max(0, Number(occupied) || 0));
        }
        if (availableEl) {
            availableEl.textContent = String(Math.max(0, Number(available) || 0));
        }
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
