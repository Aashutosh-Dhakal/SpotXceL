// Tab navigation + server-side feed control
(function () {
    'use strict';

    document.querySelectorAll('.nav-tab').forEach((tab) => {
        tab.addEventListener('click', function () {
            document.querySelectorAll('.nav-tab').forEach((t) => t.classList.remove('active'));
            this.classList.add('active');
        });
    });

    const API = {
        devices: '/dashboards/api/video-devices/',
        entryStart: '/dashboards/api/entry-source/start/',
        entryRemove: '/dashboards/api/entry-source/remove/',
        entryStatus: '/dashboards/api/entry-source/status/',
        entryFrame: '/dashboards/api/entry-source/live-frame/',
        parkingStart: '/dashboards/api/parking-source/start/',
        parkingRemove: '/dashboards/api/parking-source/remove/',
        parkingStatus: '/dashboards/api/parking-source/status/',
        parkingFrame: '/dashboards/api/parking-source/live-frame/',
        parkingMeta: '/dashboards/api/parking-source/live-metadata/',
        parkingLayout: '/dashboards/api/parking-source/layout/',
        parkingLayoutSave: '/dashboards/api/parking-source/layout/save/',
    };

    const FEED_LOOP_DELAY_MS = 30;
    const PARKING_META_REFRESH_MS = 400;

    let currentFeedType = null;
    let pendingRemovalFeedType = null;

    let entryLoopTimer = null;
    let parkingLoopTimer = null;
    let entryPollingActive = false;
    let parkingPollingActive = false;
    let entryFrameInFlight = false;
    let parkingFrameInFlight = false;
    let parkingMetaLastFetchAt = 0;

    let parkingEditorInstance = null;
    let parkingSpaces = [];
    let parkingOverlayActive = false;
    let parkingLastFrameBitmap = null;

    function getCSRFToken() {
        const cookieValue = document.cookie
            .split('; ')
            .find((cookie) => cookie.startsWith('csrftoken='));
        return cookieValue ? decodeURIComponent(cookieValue.split('=')[1]) : '';
    }

    function getProcessedImageElement(feedType) {
        return document.getElementById(feedType === 'entry' ? 'entry-processed-feed' : 'parking-processed-feed');
    }

    function getParkingOutputCanvasElement() {
        return document.getElementById('parking-output-canvas');
    }

    function setParkingRenderSurface(mode) {
        const processedImage = getProcessedImageElement('parking');
        const outputCanvas = getParkingOutputCanvasElement();

        if (processedImage) {
            if (mode === 'image') {
                processedImage.style.display = 'block';
                processedImage.classList.remove('hidden');
            } else {
                processedImage.style.display = 'none';
                processedImage.classList.add('hidden');
            }
        }

        if (outputCanvas) {
            if (mode === 'overlay') {
                outputCanvas.style.display = 'block';
                outputCanvas.classList.add('active');
            } else {
                outputCanvas.style.display = 'none';
                outputCanvas.classList.remove('active');
            }
        }
    }

    function getParkingEditorModalElement() {
        return document.getElementById('parkingEditorModal');
    }

    function getParkingEditorHostElement() {
        return document.getElementById('parking-editor-host');
    }

    function openParkingEditorModal() {
        const modal = getParkingEditorModalElement();
        if (!modal) {
            return;
        }
        modal.classList.add('show');
    }

    function closeParkingEditorModal() {
        const modal = getParkingEditorModalElement();
        if (!modal) {
            return;
        }
        modal.classList.remove('show');
    }

    function setParkingStats(total, occupied, available) {
        const statValues = document.querySelectorAll('.stats-section .stat-value');
        if (statValues[0]) {
            statValues[0].textContent = String(total);
        }
        if (statValues[1]) {
            statValues[1].textContent = String(occupied);
        }

        const occupancyBar = document.getElementById('occupancyBar');
        if (occupancyBar) {
            const percentage = total > 0 ? Math.round((occupied / total) * 100) : 0;
            occupancyBar.style.width = `${percentage}%`;
        }

        const occupancyText = document.querySelector('.occupancy-text');
        if (occupancyText) {
            const percentage = total > 0 ? Math.round((occupied / total) * 100) : 0;
            occupancyText.textContent = `${percentage}% Occupancy`;
        }

        const availableText = document.querySelector('.revenue-change span');
        if (availableText) {
            availableText.textContent = `Available: ${available}`;
        }

        const capacityNoteValue = document.getElementById('capacityNoteValue');
        if (capacityNoteValue) {
            capacityNoteValue.textContent = total > 0 ? `${total} spaces configured` : 'Configured spaces';
        }
    }

    function setFeedUiActive(feedType, active) {
        const noFeedMessage = document.getElementById(`${feedType}-no-feed`);
        const removeBtn = document.getElementById(`${feedType}-remove-btn`);
        const selectBtn = document.getElementById(`${feedType}-select-btn`);
        const processedImage = getProcessedImageElement(feedType);
        const videoEl = document.getElementById(`${feedType}-video`);
        const outputCanvas = feedType === 'parking' ? getParkingOutputCanvasElement() : null;

        if (active) {
            if (processedImage) {
                if (feedType === 'parking') {
                    setParkingRenderSurface('image');
                } else {
                    processedImage.style.display = 'block';
                    processedImage.classList.remove('hidden');
                }
            }
            if (noFeedMessage) {
                noFeedMessage.style.display = 'none';
            }
            if (removeBtn) {
                removeBtn.style.display = 'flex';
            }
            if (selectBtn) {
                selectBtn.style.display = 'none';
            }
        } else {
            if (processedImage) {
                if (feedType === 'parking') {
                    setParkingRenderSurface('none');
                } else {
                    processedImage.style.display = 'none';
                    processedImage.classList.add('hidden');
                }
                processedImage.removeAttribute('src');
                const prevUrl = processedImage.getAttribute('data-last-object-url');
                if (prevUrl) {
                    URL.revokeObjectURL(prevUrl);
                    processedImage.removeAttribute('data-last-object-url');
                }
            }
            if (noFeedMessage) {
                noFeedMessage.style.display = 'flex';
            }
            if (removeBtn) {
                removeBtn.style.display = 'none';
            }
            if (selectBtn) {
                selectBtn.style.display = 'flex';
            }
        }

        if (videoEl) {
            videoEl.style.display = 'none';
            videoEl.srcObject = null;
            videoEl.src = '';
        }

        if (outputCanvas && feedType !== 'parking') {
            outputCanvas.style.display = 'none';
            outputCanvas.classList.remove('active');
            const ctx = outputCanvas.getContext('2d');
            if (ctx) {
                ctx.clearRect(0, 0, outputCanvas.width || 1, outputCanvas.height || 1);
            }
        }

        if (feedType === 'parking' && !active) {
            parkingOverlayActive = false;
            if (parkingLastFrameBitmap && typeof parkingLastFrameBitmap.close === 'function') {
                parkingLastFrameBitmap.close();
            }
            parkingLastFrameBitmap = null;
        }
    }

    async function requestParkingLiveMetadata() {
        const response = await fetch(`${API.parkingMeta}?t=${Date.now()}`, {
            method: 'GET',
            credentials: 'same-origin',
            cache: 'no-store',
        });
        if (!response.ok) {
            return null;
        }
        return response.json();
    }

    async function refreshParkingStatsFromMetadata(force = false) {
        const now = Date.now();
        if (!force && now - parkingMetaLastFetchAt < PARKING_META_REFRESH_MS) {
            return;
        }
        parkingMetaLastFetchAt = now;

        try {
            const metadata = await requestParkingLiveMetadata();
            if (!metadata || metadata.active === false) {
                return;
            }

            const stats = metadata.occupancy_stats || {};
            const total = Number(stats.total);
            const occupied = Number(stats.occupied);
            const available = Number(stats.available);

            if (Number.isFinite(total) && Number.isFinite(occupied) && Number.isFinite(available)) {
                setParkingStats(total, occupied, available);
            }
        } catch (error) {
            console.error('Failed to refresh parking stats metadata:', error);
        }
    }

    async function requestParkingLayout() {
        const response = await fetch(`${API.parkingLayout}?t=${Date.now()}`, {
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

    async function saveParkingLayoutToServer(spaces) {
        try {
            await fetch(API.parkingLayoutSave, {
                method: 'POST',
                credentials: 'same-origin',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCSRFToken(),
                },
                body: JSON.stringify({ spaces }),
            });
        } catch (error) {
            console.error('Failed to save parking layout to server:', error);
        }
    }

    async function renderParkingOverlayFromFrameBlob(blob) {
        const outputCanvas = getParkingOutputCanvasElement();
        const parkingFeed = document.getElementById('parking-feed');
        if (!outputCanvas || !window.renderDetectionOverlay || !window.checkOccupancy) {
            return false;
        }

        const metadata = await requestParkingLiveMetadata();
        if (!metadata || metadata.active === false) {
            return false;
        }

        if (parkingLastFrameBitmap && typeof parkingLastFrameBitmap.close === 'function') {
            parkingLastFrameBitmap.close();
        }
        parkingLastFrameBitmap = await createImageBitmap(blob);

        const frameWidth = Number(metadata.frame_width) || parkingLastFrameBitmap.width || 1;
        const frameHeight = Number(metadata.frame_height) || parkingLastFrameBitmap.height || 1;

        const renderWidth = parkingFeed ? Math.max(1, Math.round(parkingFeed.clientWidth)) : frameWidth;
        const renderHeight = parkingFeed ? Math.max(1, Math.round(parkingFeed.clientHeight)) : frameHeight;
        const scaleX = renderWidth / frameWidth;
        const scaleY = renderHeight / frameHeight;

        outputCanvas.width = renderWidth;
        outputCanvas.height = renderHeight;
        setParkingRenderSurface('overlay');

        const detections = Array.isArray(metadata.detections) ? metadata.detections : [];
        const scaledBoxes = detections.map((d) => ({
            x1: Number(d.x1) * scaleX,
            y1: Number(d.y1) * scaleY,
            x2: Number(d.x2) * scaleX,
            y2: Number(d.y2) * scaleY,
            class_name: d.class_name,
        }));

        const occupancy = window.checkOccupancy(scaledBoxes, parkingSpaces, renderWidth, renderHeight);
        parkingSpaces = occupancy.spaces;
        setParkingStats(occupancy.stats.total, occupancy.stats.occupied, occupancy.stats.available);

        const ctx = outputCanvas.getContext('2d');
        window.renderDetectionOverlay({
            ctx,
            frameBitmap: parkingLastFrameBitmap,
            yoloBoxes: scaledBoxes,
            parkingSpaces,
            frameWidth: renderWidth,
            frameHeight: renderHeight,
        });

        return true;
    }

    function stopFeedPolling(feedType) {
        if (feedType === 'entry') {
            entryPollingActive = false;
            entryFrameInFlight = false;
            if (entryLoopTimer) {
                clearTimeout(entryLoopTimer);
                entryLoopTimer = null;
            }
            return;
        }

        parkingPollingActive = false;
        parkingFrameInFlight = false;
        if (parkingLoopTimer) {
            clearTimeout(parkingLoopTimer);
            parkingLoopTimer = null;
        }
    }

    function startFeedPolling(feedType) {
        stopFeedPolling(feedType);
        if (feedType === 'entry') {
            entryPollingActive = true;
        } else {
            parkingPollingActive = true;
        }
        scheduleNextFrame(feedType, 0);
    }

    function scheduleNextFrame(feedType, delayMs) {
        if (feedType === 'entry') {
            if (!entryPollingActive) {
                return;
            }
            entryLoopTimer = window.setTimeout(() => {
                pollFeedFrame('entry');
            }, delayMs);
            return;
        }

        if (!parkingPollingActive) {
            return;
        }
        parkingLoopTimer = window.setTimeout(() => {
            pollFeedFrame('parking');
        }, delayMs);
    }

    async function pollFeedFrame(feedType) {
        const endpoint = feedType === 'entry' ? API.entryFrame : API.parkingFrame;
        const processedImage = getProcessedImageElement(feedType);
        if (!processedImage) {
            return;
        }

        if (feedType === 'entry' && entryFrameInFlight) {
            scheduleNextFrame(feedType, FEED_LOOP_DELAY_MS);
            return;
        }
        if (feedType === 'parking' && parkingFrameInFlight) {
            scheduleNextFrame(feedType, FEED_LOOP_DELAY_MS);
            return;
        }

        if (feedType === 'entry') {
            entryFrameInFlight = true;
        } else {
            parkingFrameInFlight = true;
        }

        try {
            const response = await fetch(`${endpoint}?t=${Date.now()}`, {
                method: 'GET',
                credentials: 'same-origin',
                cache: 'no-store',
            });

            if (!response.ok) {
                scheduleNextFrame(feedType, FEED_LOOP_DELAY_MS);
                return;
            }

            const contentType = (response.headers.get('content-type') || '').toLowerCase();
            if (contentType.includes('application/json')) {
                const payload = await response.json();
                if (!payload.active) {
                    setFeedUiActive(feedType, false);
                    stopFeedPolling(feedType);
                } else {
                    scheduleNextFrame(feedType, FEED_LOOP_DELAY_MS);
                }
                return;
            }

            const blob = await response.blob();
            if (!blob || blob.size === 0) {
                scheduleNextFrame(feedType, FEED_LOOP_DELAY_MS);
                return;
            }

            if (feedType === 'entry' && !entryPollingActive) {
                return;
            }
            if (feedType === 'parking' && !parkingPollingActive) {
                return;
            }

            if (feedType === 'parking' && parkingOverlayActive) {
                const rendered = await renderParkingOverlayFromFrameBlob(blob);
                if (rendered) {
                    scheduleNextFrame(feedType, FEED_LOOP_DELAY_MS);
                    return;
                }
                setParkingRenderSurface('image');
            }

            const objectUrl = URL.createObjectURL(blob);
            const prevUrl = processedImage.getAttribute('data-last-object-url');
            processedImage.src = objectUrl;
            if (feedType === 'parking') {
                setParkingRenderSurface('image');
            } else {
                processedImage.style.display = 'block';
                processedImage.classList.remove('hidden');
            }
            processedImage.setAttribute('data-last-object-url', objectUrl);

            if (prevUrl) {
                URL.revokeObjectURL(prevUrl);
            }

            if (feedType === 'parking') {
                refreshParkingStatsFromMetadata();
            }

            scheduleNextFrame(feedType, FEED_LOOP_DELAY_MS);
        } catch (error) {
            console.error(`${feedType} frame polling error:`, error);
            scheduleNextFrame(feedType, 120);
        } finally {
            if (feedType === 'entry') {
                entryFrameInFlight = false;
            } else {
                parkingFrameInFlight = false;
            }
        }
    }

    async function requestStartSource(feedType, payload, fileObj) {
        const endpoint = feedType === 'entry' ? API.entryStart : API.parkingStart;
        const formData = new FormData();
        formData.append('source_type', payload.source_type);

        if (payload.source_type === 'camera') {
            formData.append('camera_index', payload.camera_index);
            formData.append('source_label', payload.source_label || '');
        } else {
            formData.append('video_file', fileObj);
        }

        const response = await fetch(endpoint, {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
                'X-CSRFToken': getCSRFToken(),
            },
            body: formData,
        });

        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.error || 'Unable to start source');
        }

        return response.json();
    }

    async function requestRemoveSource(feedType) {
        const endpoint = feedType === 'entry' ? API.entryRemove : API.parkingRemove;
        const response = await fetch(endpoint, {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
                'X-CSRFToken': getCSRFToken(),
            },
        });

        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.error || 'Unable to remove source');
        }
    }

    async function requestSourceStatus(feedType) {
        const endpoint = feedType === 'entry' ? API.entryStatus : API.parkingStatus;
        const response = await fetch(endpoint, {
            method: 'GET',
            credentials: 'same-origin',
            cache: 'no-store',
        });
        if (!response.ok) {
            throw new Error('Unable to get source status');
        }
        return response.json();
    }

    async function requestFeedFrameBlob(feedType) {
        const endpoint = feedType === 'entry' ? API.entryFrame : API.parkingFrame;
        const response = await fetch(`${endpoint}?t=${Date.now()}`, {
            method: 'GET',
            credentials: 'same-origin',
            cache: 'no-store',
        });

        if (!response.ok) {
            throw new Error('Unable to fetch frame');
        }

        const contentType = (response.headers.get('content-type') || '').toLowerCase();
        if (contentType.includes('application/json')) {
            return null;
        }

        const blob = await response.blob();
        if (!blob || blob.size === 0) {
            return null;
        }
        return blob;
    }

    async function fetchFirstParkingFrameForEditor(maxTries = 20) {
        for (let i = 0; i < maxTries; i += 1) {
            try {
                const blob = await requestFeedFrameBlob('parking');
                if (blob) {
                    const bitmap = await createImageBitmap(blob);
                    return {
                        imageBitmap: bitmap,
                        width: bitmap.width,
                        height: bitmap.height,
                    };
                }
            } catch (error) {
                console.error('Parking frame fetch for editor failed:', error);
            }
            await new Promise((resolve) => setTimeout(resolve, 120));
        }
        return null;
    }

    async function openParkingEditorThenStartPolling() {
        if (typeof window.initParkingEditor !== 'function') {
            startFeedPolling('parking');
            return;
        }

        const host = getParkingEditorHostElement();
        if (!host) {
            startFeedPolling('parking');
            return;
        }

        const firstFrame = await fetchFirstParkingFrameForEditor();
        if (!firstFrame) {
            startFeedPolling('parking');
            return;
        }

        if (parkingEditorInstance) {
            parkingEditorInstance.destroy();
            parkingEditorInstance = null;
        }

        openParkingEditorModal();

        parkingEditorInstance = window.initParkingEditor(firstFrame, host, {
            onStartDetection: (spaces) => {
                parkingSpaces = Array.isArray(spaces) ? spaces : [];
                setParkingStats(parkingSpaces.length, 0, parkingSpaces.length);
                saveParkingLayoutToServer(parkingSpaces);
                if (parkingEditorInstance) {
                    parkingEditorInstance.destroy();
                    parkingEditorInstance = null;
                }
                closeParkingEditorModal();
                // Use API-rendered processed frame only to avoid client canvas rescaling artifacts.
                parkingOverlayActive = false;
                setParkingRenderSurface('image');
                refreshParkingStatsFromMetadata(true);
                startFeedPolling('parking');
            },
        });
    }

    async function syncInitialFeedStatus() {
        for (const feedType of ['entry', 'parking']) {
            try {
                const status = await requestSourceStatus(feedType);
                if (status.active) {
                    setFeedUiActive(feedType, true);
                    if (feedType === 'parking') {
                        parkingSpaces = await requestParkingLayout();
                        setParkingStats(parkingSpaces.length, 0, parkingSpaces.length);
                    }
                    startFeedPolling(feedType);
                } else {
                    setFeedUiActive(feedType, false);
                }
            } catch (error) {
                console.error(`Failed to sync ${feedType} status:`, error);
                setFeedUiActive(feedType, false);
            }
        }
    }

    window.openDeviceModal = async function (feedType) {
        currentFeedType = feedType;
        const modal = document.getElementById('deviceModal');
        const feedTypeName = document.getElementById('feedTypeName');

        if (feedTypeName) {
            feedTypeName.textContent = feedType === 'entry' ? 'Vehicle Entry Feed' : 'Vehicle Detection Feed';
        }

        modal.classList.add('show');
        modal.style.display = 'flex';
        document.getElementById('videoFileInput').value = '';
        await getAvailableDevices();
    };

    window.closeDeviceModal = function () {
        const modal = document.getElementById('deviceModal');
        modal.classList.remove('show');
        modal.style.display = 'none';
        currentFeedType = null;
    };

    async function getAvailableDevices() {
        const deviceList = document.getElementById('deviceList');
        if (!deviceList) {
            return;
        }

        deviceList.innerHTML = `
            <div class="loading-devices">
                <i class="fas fa-spinner fa-spin"></i>
                <p>Detecting available server cameras...</p>
            </div>
        `;

        try {
            const response = await fetch(API.devices, {
                method: 'GET',
                credentials: 'same-origin',
                cache: 'no-store',
            });

            if (!response.ok) {
                throw new Error('Failed to fetch devices');
            }

            const payload = await response.json();
            const devices = Array.isArray(payload.devices) ? payload.devices : [];

            if (!devices.length) {
                deviceList.innerHTML = `
                    <div class="no-devices">
                        <i class="fas fa-exclamation-triangle"></i>
                        <p>No server camera devices found</p>
                    </div>
                `;
                return;
            }

            deviceList.innerHTML = devices.map((device) => `
                <div class="device-item" onclick="selectDevice('${device.id}', '${(device.label || '').replace(/'/g, '&#39;')}')">
                    <div class="device-icon">
                        <i class="fas fa-video"></i>
                    </div>
                    <div class="device-info">
                        <div class="device-name">${device.label}</div>
                        <div class="device-id">Index ${device.id}</div>
                    </div>
                    <div class="device-action">
                        <i class="fas fa-chevron-right"></i>
                    </div>
                </div>
            `).join('');
        } catch (error) {
            console.error('Device load failed:', error);
            deviceList.innerHTML = `
                <div class="device-error">
                    <i class="fas fa-exclamation-circle"></i>
                    <p>Could not load server cameras</p>
                </div>
            `;
        }
    }

    async function startFeedFromSelection(startPayload, fileObj) {
        if (!currentFeedType) {
            return;
        }

        const status = await requestSourceStatus(currentFeedType).catch(() => ({ active: false }));
        if (status.active) {
            alert('Please remove the current device first before selecting a new source.');
            return;
        }

        await requestStartSource(currentFeedType, startPayload, fileObj);
        setFeedUiActive(currentFeedType, true);

        if (currentFeedType === 'parking') {
            stopFeedPolling('parking');
            await openParkingEditorThenStartPolling();
        } else {
            startFeedPolling('entry');
        }

        window.closeDeviceModal();
    }

    window.selectDevice = async function (deviceId, deviceLabel) {
        try {
            await startFeedFromSelection({
                source_type: 'camera',
                camera_index: String(deviceId),
                source_label: deviceLabel,
            });
        } catch (error) {
            console.error('Start camera failed:', error);
            alert(error.message || 'Failed to start camera source');
        }
    };

    window.handleVideoFileSelect = async function (event) {
        const file = event.target.files && event.target.files[0];
        if (!file || !currentFeedType) {
            return;
        }

        if (!file.type.startsWith('video/')) {
            alert('Please select a valid video file.');
            return;
        }

        try {
            await startFeedFromSelection({ source_type: 'file' }, file);
        } catch (error) {
            console.error('Start file failed:', error);
            alert(error.message || 'Failed to start video file source');
        }
    };

    window.showConfirmationModal = function (feedType) {
        const modal = document.getElementById('confirmationModal');
        const message = document.getElementById('confirmationMessage');
        const confirmBtn = document.getElementById('confirmYesBtn');

        pendingRemovalFeedType = feedType;
        message.textContent = `Are you sure you want to remove the ${feedType === 'entry' ? 'Vehicle Entry' : 'Vehicle Detection'} feed?`;

        modal.classList.add('show');
        modal.style.display = 'flex';

        confirmBtn.onclick = function () {
            window.confirmRemoveVideoFeed();
        };
    };

    window.closeConfirmationModal = function () {
        const modal = document.getElementById('confirmationModal');
        modal.classList.remove('show');
        modal.style.display = 'none';
        pendingRemovalFeedType = null;
    };

    window.confirmRemoveVideoFeed = async function () {
        if (!pendingRemovalFeedType) {
            return;
        }

        try {
            await requestRemoveSource(pendingRemovalFeedType);
            stopFeedPolling(pendingRemovalFeedType);
            setFeedUiActive(pendingRemovalFeedType, false);
            if (pendingRemovalFeedType === 'parking') {
                parkingOverlayActive = false;
                if (parkingEditorInstance) {
                    parkingEditorInstance.destroy();
                    parkingEditorInstance = null;
                }
                closeParkingEditorModal();
                setParkingStats(0, 0, 0);
            }
        } catch (error) {
            console.error('Remove source failed:', error);
            alert(error.message || 'Failed to remove source');
        } finally {
            window.closeConfirmationModal();
        }
    };

    window.onclick = function (event) {
        const deviceModal = document.getElementById('deviceModal');
        if (event.target === deviceModal) {
            window.closeDeviceModal();
        }

        const confirmModal = document.getElementById('confirmationModal');
        if (event.target === confirmModal) {
            window.closeConfirmationModal();
        }

        const editorModal = getParkingEditorModalElement();
        if (event.target === editorModal) {
            if (parkingEditorInstance) {
                parkingEditorInstance.destroy();
                parkingEditorInstance = null;
            }
            closeParkingEditorModal();
            parkingOverlayActive = false;
            startFeedPolling('parking');
        }
    };

    document.addEventListener('DOMContentLoaded', function () {
        syncInitialFeedStatus();

        const closeBtn = document.getElementById('parkingEditorModalCloseBtn');
        if (closeBtn) {
            closeBtn.addEventListener('click', function () {
                if (parkingEditorInstance) {
                    parkingEditorInstance.destroy();
                    parkingEditorInstance = null;
                }
                closeParkingEditorModal();
                parkingOverlayActive = false;
                startFeedPolling('parking');
            });
        }
    });
})();
