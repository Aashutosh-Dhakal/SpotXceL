// User Dashboard JavaScript
(function () {
    'use strict';

    const USER_PARKING_LIVE_FRAME_ENDPOINT = '/dashboards/api/parking-source/live-frame/';
    const USER_PARKING_LIVE_METADATA_ENDPOINT = '/dashboards/api/parking-source/live-metadata/';
    const USER_SLOT_STATUS_ENDPOINT = '/dashboards/api/parking-source/slot-status/';
    const USER_PARKING_LAYOUT_ENDPOINT = '/dashboards/api/parking-source/layout/';
    const USER_PARKING_POLL_INTERVAL_MS = 300;
    const USER_SLOT_POLL_INTERVAL_MS = 1000;
    const USER_LAYOUT_REFRESH_INTERVAL_MS = 2000;

    let pollTimer = null;
    let slotPollTimer = null;
    let lastObjectUrl = null;
    let selectedSlotId = '';
    let selectedSlotStatus = '';
    let highlightEnabled = true;
    let slotLayoutSpaces = [];
    let parkingFeedActive = false;
    let lastLayoutRefreshAt = 0;
    let lastLayoutSlotIds = [];
    let lastPopupPayload = null;

    function getLayoutSlotIds() {
        if (!Array.isArray(slotLayoutSpaces)) {
            return [];
        }

        const ids = slotLayoutSpaces
            .map((space) => String((space && space.id) || '').trim())
            .filter(Boolean);
        return Array.from(new Set(ids)).sort();
    }

    function syncSlotSelectorToLayout() {
        const slotSelect = document.getElementById('trackedSlotSelect');
        if (!slotSelect) {
            return;
        }

        const layoutSlotIds = parkingFeedActive ? getLayoutSlotIds() : [];
        const previousSlotId = selectedSlotId;
        const previousSelectValue = slotSelect.value;

        // Check if we need to rebuild the options
        const currentOptions = Array.from(slotSelect.options)
            .map(opt => opt.value)
            .filter(v => v !== '');
        
        const optionsChanged = JSON.stringify(currentOptions.sort()) !== JSON.stringify(layoutSlotIds.sort());

        // Only rebuild if options actually changed
        if (!optionsChanged) {
            return;
        }

        slotSelect.innerHTML = '';

        const placeholderOption = document.createElement('option');
        placeholderOption.value = '';
        if (!parkingFeedActive) {
            placeholderOption.textContent = 'Choose a slot';
        } else if (layoutSlotIds.length === 0) {
            placeholderOption.textContent = 'No parking boxes configured';
        } else {
            placeholderOption.textContent = 'Choose a slot';
        }
        slotSelect.appendChild(placeholderOption);

        layoutSlotIds.forEach((slotId) => {
            const option = document.createElement('option');
            option.value = slotId;
            option.textContent = slotId;
            slotSelect.appendChild(option);
        });

        slotSelect.disabled = !parkingFeedActive || layoutSlotIds.length === 0;

        // Restore the previous selection
        if (previousSlotId && layoutSlotIds.includes(previousSlotId)) {
            slotSelect.value = previousSlotId;
        } else if (!parkingFeedActive && previousSlotId) {
            // Only clear selection if feed became inactive
            selectedSlotId = '';
            stopSlotPolling();
            setSlotTrackingPlaceholders('');
            slotSelect.value = '';
        } else if (previousSlotId) {
            // Feed is active, keep previous selection value even if not in layout
            slotSelect.value = previousSlotId;
        } else {
            slotSelect.value = '';
        }
    }

    function setSlotTrackingPlaceholders(slotId) {
        const slotChip = document.getElementById('tracked-slot-chip');
        const statusEl = document.getElementById('tracked-slot-status');
        const startEl = document.getElementById('tracked-start-time');
        const endEl = document.getElementById('tracked-end-time');
        const durationEl = document.getElementById('tracked-duration');
        const sessionEl = document.getElementById('tracked-session-id');
        const vehicleEl = document.getElementById('tracked-vehicle-id');

        if (slotChip) {
            slotChip.textContent = slotId || '-';
        }
        if (statusEl) {
            statusEl.textContent = slotId ? 'Loading...' : '-';
        }
        if (startEl) {
            startEl.textContent = '-';
        }
        if (endEl) {
            endEl.textContent = '-';
        }
        if (durationEl) {
            durationEl.textContent = '-';
        }
        if (sessionEl) {
            sessionEl.textContent = '-';
        }
        if (vehicleEl) {
            vehicleEl.textContent = '-';
        }

        selectedSlotStatus = '';
        renderSlotHighlightOverlay();
    }

    async function fetchParkingLayout() {
        const response = await fetch(`${USER_PARKING_LAYOUT_ENDPOINT}?t=${Date.now()}`, {
            method: 'GET',
            credentials: 'same-origin',
            cache: 'no-store',
        });
        if (!response.ok) {
            return [];
        }
        const payload = await response.json().catch(() => ({}));
        return Array.isArray(payload.spaces) ? payload.spaces : [];
    }

    async function refreshParkingLayout() {
        try {
            slotLayoutSpaces = await fetchParkingLayout();
        } catch (error) {
            console.error('Failed to fetch parking layout for highlight:', error);
            slotLayoutSpaces = [];
        }
        lastLayoutRefreshAt = Date.now();
        
        // Only sync selector if layout slot IDs actually changed
        const currentLayoutSlotIds = getLayoutSlotIds();
        const layoutChanged = JSON.stringify(currentLayoutSlotIds) !== JSON.stringify(lastLayoutSlotIds);
        
        if (layoutChanged) {
            lastLayoutSlotIds = currentLayoutSlotIds;
            syncSlotSelectorToLayout();
        }
        
        renderSlotHighlightOverlay();
    }

    function refreshParkingLayoutIfNeeded(force = false) {
        if (force || (Date.now() - lastLayoutRefreshAt) >= USER_LAYOUT_REFRESH_INTERVAL_MS) {
            refreshParkingLayout();
        }
    }

    function getSelectedSlotSpace() {
        if (!selectedSlotId || !Array.isArray(slotLayoutSpaces)) {
            return null;
        }

        return slotLayoutSpaces.find((space) => {
            const id = String((space && space.id) || '').trim();
            return id === selectedSlotId;
        }) || null;
    }

    function clearSlotHighlightOverlay() {
        const canvas = document.getElementById('user-slot-highlight-canvas');
        if (!canvas) {
            return;
        }

        const ctx = canvas.getContext('2d');
        if (ctx) {
            ctx.clearRect(0, 0, canvas.width || 1, canvas.height || 1);
        }

        canvas.style.display = 'none';
    }

    function renderSlotHighlightOverlay() {
        const shouldHighlight = highlightEnabled && selectedSlotId;
        if (!shouldHighlight) {
            clearSlotHighlightOverlay();
            return;
        }

        const selectedSpace = getSelectedSlotSpace();
        const feedImage = document.getElementById('user-parking-feed');
        const canvas = document.getElementById('user-slot-highlight-canvas');
        if (!selectedSpace || !feedImage || !canvas) {
            clearSlotHighlightOverlay();
            return;
        }

        const points = Array.isArray(selectedSpace.points) ? selectedSpace.points : [];
        if (points.length < 3) {
            clearSlotHighlightOverlay();
            return;
        }

        const width = Math.max(1, Math.round(feedImage.clientWidth || canvas.clientWidth || 0));
        const height = Math.max(1, Math.round(feedImage.clientHeight || canvas.clientHeight || 0));
        if (!width || !height) {
            clearSlotHighlightOverlay();
            return;
        }

        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
            clearSlotHighlightOverlay();
            return;
        }

        ctx.clearRect(0, 0, width, height);
        ctx.beginPath();
        points.forEach((pair, index) => {
            const x = Number(pair[0]) * width;
            const y = Number(pair[1]) * height;
            if (index === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        });
        ctx.closePath();

        ctx.fillStyle = 'rgba(234, 88, 12, 0.28)';
        ctx.strokeStyle = 'rgba(234, 88, 12, 0.95)';
        ctx.lineWidth = 3;
        ctx.fill();
        ctx.stroke();

        const labelPoint = points[0];
        if (labelPoint) {
            const labelX = Number(labelPoint[0]) * width;
            const labelY = Number(labelPoint[1]) * height;
            ctx.fillStyle = 'rgba(31, 41, 55, 0.92)';
            ctx.fillRect(labelX + 6, Math.max(0, labelY - 22), 118, 18);
            ctx.fillStyle = '#ffffff';
            ctx.font = '12px Arial';
            ctx.fillText(`Tracking ${selectedSlotId}`, labelX + 10, Math.max(12, labelY - 9));
        }

        canvas.style.display = 'block';
    }

    function formatDateTime(isoValue) {
        if (!isoValue) {
            return '-';
        }

        const parsed = new Date(isoValue);
        if (Number.isNaN(parsed.getTime())) {
            return '-';
        }

        const year = parsed.getFullYear();
        const month = String(parsed.getMonth() + 1).padStart(2, '0');
        const day = String(parsed.getDate()).padStart(2, '0');
        const hours = String(parsed.getHours()).padStart(2, '0');
        const minutes = String(parsed.getMinutes()).padStart(2, '0');
        const seconds = String(parsed.getSeconds()).padStart(2, '0');
        return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    }

    function updateSlotTrackingUi(payload) {
        const slotChip = document.getElementById('tracked-slot-chip');
        const statusEl = document.getElementById('tracked-slot-status');
        const startEl = document.getElementById('tracked-start-time');
        const endEl = document.getElementById('tracked-end-time');
        const durationEl = document.getElementById('tracked-duration');
        const sessionEl = document.getElementById('tracked-session-id');
        const vehicleEl = document.getElementById('tracked-vehicle-id');

        if (payload.status === 'Completed' || payload.status === 'No Records') {
            if (slotChip) slotChip.textContent = payload.slot_id || '-';
            if (statusEl) statusEl.textContent = 'Empty';
            if (startEl) startEl.textContent = '-';
            if (endEl) endEl.textContent = '-';
            if (durationEl) durationEl.textContent = '-';
            if (sessionEl) sessionEl.textContent = '-';
            if (vehicleEl) vehicleEl.textContent = '-';
            selectedSlotStatus = payload.status || '';
            renderSlotHighlightOverlay();
            return;
        }

        if (slotChip) {
            slotChip.textContent = payload.slot_id || '-';
        }
        if (statusEl) {
            statusEl.textContent = payload.status || '-';
        }
        if (startEl) {
            startEl.textContent = formatDateTime(payload.start_time);
        }
        if (endEl) {
            endEl.textContent = formatDateTime(payload.end_time);
        }
        if (durationEl) {
            durationEl.textContent = payload.duration || '-';
        }
        if (sessionEl) {
            sessionEl.textContent = payload.session_id || '-';
        }
        if (vehicleEl) {
            vehicleEl.textContent = payload.vehicle_id || '-';
        }

        selectedSlotStatus = payload.status || '';
        renderSlotHighlightOverlay();
    }

    function showSessionEndedPopup(payload) {
        lastPopupPayload = payload;
        
        const slotEl = document.getElementById('popup-slot-id');
        const startEl = document.getElementById('popup-start-time');
        const endEl = document.getElementById('popup-end-time');
        const durationEl = document.getElementById('popup-duration');
        const sessionEl = document.getElementById('popup-session-id');
        const vehicleEl = document.getElementById('popup-vehicle-id');

        if (slotEl) slotEl.textContent = payload.slot_id || '-';
        if (startEl) startEl.textContent = formatDateTime(payload.start_time);
        if (endEl) endEl.textContent = formatDateTime(payload.end_time);
        if (durationEl) durationEl.textContent = payload.duration || '-';
        if (sessionEl) sessionEl.textContent = payload.session_id || '-';
        if (vehicleEl) vehicleEl.textContent = payload.vehicle_id || '-';

        const modal = document.getElementById('sessionEndedModal');
        if (modal) {
            modal.classList.add('show');
        }
    }
    
    window.closeSessionEndedModal = function() {
        const modal = document.getElementById('sessionEndedModal');
        if (modal) {
            modal.classList.remove('show');
        }
    };

    async function fetchSelectedSlotStatus() {
        if (!selectedSlotId) {
            return;
        }

        const response = await fetch(`${USER_SLOT_STATUS_ENDPOINT}?slot_id=${encodeURIComponent(selectedSlotId)}&t=${Date.now()}`, {
            method: 'GET',
            credentials: 'same-origin',
            cache: 'no-store',
        });

        if (!response.ok) {
            throw new Error('Unable to fetch slot tracking status');
        }

        return response.json();
    }

    async function refreshSelectedSlotStatus() {
        if (!selectedSlotId) {
            return;
        }

        try {
            const payload = await fetchSelectedSlotStatus();
            if (payload) {
                if (selectedSlotStatus === 'In Progress' && payload.status === 'Completed') {
                    showSessionEndedPopup(payload);
                }
                updateSlotTrackingUi(payload);
            }
        } catch (error) {
            console.error('Failed to refresh selected slot status:', error);
            const statusEl = document.getElementById('tracked-slot-status');
            if (statusEl) {
                statusEl.textContent = 'Unavailable';
            }
        }
    }

    function startSlotPolling() {
        if (slotPollTimer) {
            window.clearInterval(slotPollTimer);
        }

        if (!selectedSlotId) {
            return;
        }

        refreshSelectedSlotStatus();
        slotPollTimer = window.setInterval(refreshSelectedSlotStatus, USER_SLOT_POLL_INTERVAL_MS);
    }

    function stopSlotPolling() {
        if (slotPollTimer) {
            window.clearInterval(slotPollTimer);
            slotPollTimer = null;
        }
    }

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

    function showNoFeed(message, options) {
        const nextState = options || {};
        const feedImage = document.getElementById('user-parking-feed');
        const feedVideo = document.getElementById('user-parking-video');
        const noFeedMessage = document.getElementById('user-parking-no-feed');

        if (typeof nextState.feedActive === 'boolean') {
            parkingFeedActive = nextState.feedActive;
        }

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
        syncSlotSelectorToLayout();
        if (!parkingFeedActive) {
            stopSlotPolling();
            selectedSlotId = '';
            setSlotTrackingPlaceholders('');
        }
        clearSlotHighlightOverlay();
    }

    function showFrame(blob) {
        const feedImage = document.getElementById('user-parking-feed');
        const noFeedMessage = document.getElementById('user-parking-no-feed');
        if (!feedImage) {
            return;
        }

        const wasFeedInactive = !parkingFeedActive;
        parkingFeedActive = true;

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
        
        // Only sync slot selector when feed transitions from inactive to active
        if (wasFeedInactive) {
            syncSlotSelectorToLayout();
        }
        
        renderSlotHighlightOverlay();
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
                    showNoFeed('Waiting for admin to select Vehicle Detection Feed source', { feedActive: false });
                } else {
                    showNoFeed('Admin source is active. Waiting for fresh frame...', { feedActive: true });
                    refreshParkingLayoutIfNeeded();
                }
                return;
            }

            const blob = await response.blob();
            if (!blob || blob.size === 0) {
                showNoFeed('Admin source is active. Waiting for fresh frame...', { feedActive: true });
                refreshParkingLayoutIfNeeded();
                return;
            }

            showFrame(blob);
            refreshParkingLayoutIfNeeded();
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
        const downloadBtn = document.getElementById('downloadSessionBtn');
        if (downloadBtn) {
            downloadBtn.addEventListener('click', function() {
                if (!lastPopupPayload) return;
                
                let csvContent = "data:text/csv;charset=utf-8,";
                csvContent += "Slot,Start Time,End Time,Duration,Session ID,License Plate\n";
                
                const row = [
                    lastPopupPayload.slot_id || '-',
                    formatDateTime(lastPopupPayload.start_time),
                    formatDateTime(lastPopupPayload.end_time),
                    lastPopupPayload.duration || '-',
                    lastPopupPayload.session_id || '-',
                    lastPopupPayload.vehicle_id || '-'
                ];
                
                csvContent += row.map(val => `"${val}"`).join(",") + "\n";
                
                const encodedUri = encodeURI(csvContent);
                const link = document.createElement("a");
                link.setAttribute("href", encodedUri);
                link.setAttribute("download", `session_${lastPopupPayload.session_id || 'ended'}.csv`);
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
            });
        }

        syncSlotSelectorToLayout();
        refreshParkingLayout();
        lastLayoutSlotIds = getLayoutSlotIds();

        const slotSelect = document.getElementById('trackedSlotSelect');
        if (slotSelect) {
            slotSelect.addEventListener('change', function () {
                selectedSlotId = this.value;
                setSlotTrackingPlaceholders(selectedSlotId);
                startSlotPolling();
            });
        }

        const highlightToggle = document.getElementById('highlightToggle');
        if (highlightToggle) {
            highlightEnabled = Boolean(highlightToggle.checked);
            highlightToggle.addEventListener('change', function () {
                highlightEnabled = Boolean(this.checked);
                renderSlotHighlightOverlay();
            });
        }

        window.addEventListener('resize', renderSlotHighlightOverlay);

        startPolling();
    });

    window.addEventListener('beforeunload', function () {
        stopSlotPolling();
        stopPolling();
    });
})();
