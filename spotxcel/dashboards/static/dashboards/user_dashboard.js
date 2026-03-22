// User Dashboard JavaScript
(function () {
    'use strict';

    const USER_PARKING_LIVE_FRAME_ENDPOINT = '/dashboards/api/parking-source/live-frame/';
    const USER_PARKING_LIVE_METADATA_ENDPOINT = '/dashboards/api/parking-source/live-metadata/';
    const USER_PARKING_POLL_INTERVAL_MS = 300;

    let pollTimer = null;
    let lastObjectUrl = null;

    function setLiveBadgeActive(isActive) {
        const liveText = document.querySelector('.live-text');
        if (liveText) {
            liveText.textContent = isActive ? 'Live Detection' : 'Waiting';
        }
    }

    function updateParkingStats(total, available, occupied) {
        const totalEl = document.querySelector('.parking-stats-grid .stat-card.total .stat-value');
        const availableEl = document.querySelector('.parking-stats-grid .stat-card.available .stat-value');
        const occupiedEl = document.querySelector('.parking-stats-grid .stat-card.occupied .stat-value');

        const formatStat = (value) => {
            if (value === '--') {
                return '--';
            }
            return String(Number.isFinite(Number(value)) ? Math.max(0, Math.round(Number(value))) : 0);
        };

        if (totalEl) {
            totalEl.textContent = formatStat(total);
        }
        if (availableEl) {
            availableEl.textContent = formatStat(available);
        }
        if (occupiedEl) {
            occupiedEl.textContent = formatStat(occupied);
        }
    }

    async function fetchParkingMetadata() {
        const response = await fetch(`${USER_PARKING_LIVE_METADATA_ENDPOINT}?t=${Date.now()}`, {
            method: 'GET',
            credentials: 'same-origin',
            cache: 'no-store',
        });
        if (!response.ok) {
            return null;
        }
        return response.json();
    }

    function showNoFeed(message) {
        const feedImage = document.getElementById('user-parking-feed');
        const feedVideo = document.getElementById('user-parking-video');
        const noFeedMessage = document.getElementById('user-parking-no-feed');

        if (feedImage) {
            feedImage.style.display = 'none';
            feedImage.removeAttribute('src');
        }
        if (feedVideo) {
            feedVideo.style.display = 'none';
            feedVideo.srcObject = null;
        }
        if (noFeedMessage) {
            const text = noFeedMessage.querySelector('p');
            if (text) {
                text.textContent = message;
            }
            noFeedMessage.style.display = 'flex';
        }

        setLiveBadgeActive(false);
        updateParkingStats('--', '--', '--');
    }

    function showFrame(blob) {
        const feedImage = document.getElementById('user-parking-feed');
        const noFeedMessage = document.getElementById('user-parking-no-feed');
        if (!feedImage) {
            return;
        }

        const objectUrl = URL.createObjectURL(blob);
        feedImage.src = objectUrl;
        feedImage.style.display = 'block';

        if (lastObjectUrl) {
            URL.revokeObjectURL(lastObjectUrl);
        }
        lastObjectUrl = objectUrl;

        if (noFeedMessage) {
            noFeedMessage.style.display = 'none';
        }

        setLiveBadgeActive(true);
    }

    async function pollFrame() {
        try {
            const metadata = await fetchParkingMetadata();
            if (metadata && metadata.occupancy_stats) {
                updateParkingStats(
                    Number(metadata.occupancy_stats.total) || 0,
                    Number(metadata.occupancy_stats.available) || 0,
                    Number(metadata.occupancy_stats.occupied) || 0,
                );
            }

            const response = await fetch(`${USER_PARKING_LIVE_FRAME_ENDPOINT}?t=${Date.now()}`, {
                method: 'GET',
                credentials: 'same-origin',
                cache: 'no-store',
            });

            if (!response.ok) {
                showNoFeed('Parking feed temporarily unavailable');
                return;
            }

            const contentType = (response.headers.get('content-type') || '').toLowerCase();
            if (contentType.includes('application/json')) {
                const payload = await response.json();
                if (!payload.active) {
                    showNoFeed('Waiting for admin to select Vehicle Detection Feed source');
                } else {
                    showNoFeed('Admin source is active. Waiting for fresh frame...');
                }
                return;
            }

            const blob = await response.blob();
            if (!blob || blob.size === 0) {
                showNoFeed('Admin source is active. Waiting for fresh frame...');
                return;
            }

            showFrame(blob);
        } catch (error) {
            console.error('Failed to poll parking feed:', error);
            showNoFeed('Parking feed temporarily unavailable');
        }
    }

    function startPolling() {
        if (pollTimer) {
            window.clearInterval(pollTimer);
        }
        pollFrame();
        pollTimer = window.setInterval(pollFrame, USER_PARKING_POLL_INTERVAL_MS);
    }

    function stopPolling() {
        if (pollTimer) {
            window.clearInterval(pollTimer);
            pollTimer = null;
        }
        if (lastObjectUrl) {
            URL.revokeObjectURL(lastObjectUrl);
            lastObjectUrl = null;
        }
    }

    document.addEventListener('DOMContentLoaded', function () {
        const highlightToggle = document.getElementById('highlightToggle');
        if (highlightToggle) {
            highlightToggle.addEventListener('change', function () {
                if (this.checked) {
                    console.log('Map highlight enabled');
                } else {
                    console.log('Map highlight disabled');
                }
            });
        }

        startPolling();
    });

    window.addEventListener('beforeunload', function () {
        stopPolling();
    });
})();
