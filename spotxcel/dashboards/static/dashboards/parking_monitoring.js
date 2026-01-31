// Tab navigation
document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.addEventListener('click', function() {
        document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
        this.classList.add('active');
    });
});

// Video feed management
let currentFeedType = null;
let entryStream = null;
let parkingStream = null;
let entryVideoSource = null; // 'camera' or 'file'
let parkingVideoSource = null; // 'camera' or 'file'

// Open device selection modal
function openDeviceModal(feedType) {
    currentFeedType = feedType;
    const modal = document.getElementById('deviceModal');
    const feedTypeName = document.getElementById('feedTypeName');
    
    feedTypeName.textContent = feedType === 'entry' ? 'Vehicle Entry Feed' : 'Parking Space Feed';
    modal.classList.add('show');
    modal.style.display = 'flex';
    
    // Reset file input
    document.getElementById('videoFileInput').value = '';
    
    // Get available devices
    getAvailableDevices();
}

// Close device selection modal
function closeDeviceModal() {
    const modal = document.getElementById('deviceModal');
    modal.classList.remove('show');
    modal.style.display = 'none';
    currentFeedType = null;
}

// Handle video file selection
function handleVideoFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    if (!currentFeedType) {
        alert('Please select a feed type first');
        return;
    }
    
    // Validate file type
    if (!file.type.startsWith('video/')) {
        alert('Please select a valid video file');
        return;
    }
    
    // Stop existing stream if any
    if (currentFeedType === 'entry' && entryStream) {
        entryStream.getTracks().forEach(track => track.stop());
        entryStream = null;
    } else if (currentFeedType === 'parking' && parkingStream) {
        parkingStream.getTracks().forEach(track => track.stop());
        parkingStream = null;
    }
    
    // Create URL for the video file
    const videoURL = URL.createObjectURL(file);
    
    // Set video source
    const videoElement = document.getElementById(`${currentFeedType}-video`);
    const noFeedMessage = document.getElementById(`${currentFeedType}-no-feed`);
    
    videoElement.srcObject = null; // Clear any existing stream
    videoElement.src = videoURL;
    videoElement.loop = true; // Loop the video for testing
    videoElement.muted = true; // Mute the video
    videoElement.style.display = 'block';
    noFeedMessage.style.display = 'none';
    
    // Play the video
    videoElement.play().then(() => {
        console.log('Video playing successfully');
        
        // Save source type
        if (currentFeedType === 'entry') {
            entryVideoSource = 'file';
        } else {
            parkingVideoSource = 'file';
        }
        
        // Save to localStorage
        localStorage.setItem(`${currentFeedType}VideoSource`, 'file');
        localStorage.setItem(`${currentFeedType}VideoFile`, file.name);
        
        // Show remove button
        showRemoveButton(currentFeedType);
        
        // Hide select button
        hideSelectButton(currentFeedType);
        
        // Close modal
        closeDeviceModal();
    }).catch(error => {
        console.error('Error playing video:', error);
        videoElement.style.display = 'none';
        noFeedMessage.style.display = 'flex';
        alert('Failed to play video file. The file may be corrupted or in an unsupported format.');
    });
}

// Show confirmation modal
let pendingRemovalFeedType = null;

function showConfirmationModal(feedType) {
    const modal = document.getElementById('confirmationModal');
    const message = document.getElementById('confirmationMessage');
    const confirmBtn = document.getElementById('confirmYesBtn');
    
    pendingRemovalFeedType = feedType;
    message.textContent = `Are you sure you want to remove the ${feedType === 'entry' ? 'Vehicle Entry' : 'Parking Space'} feed?`;
    
    modal.classList.add('show');
    modal.style.display = 'flex';
    
    // Set up the confirm button click handler
    confirmBtn.onclick = function() {
        confirmRemoveVideoFeed();
    };
}

function closeConfirmationModal() {
    const modal = document.getElementById('confirmationModal');
    modal.classList.remove('show');
    modal.style.display = 'none';
    pendingRemovalFeedType = null;
}

function confirmRemoveVideoFeed() {
    if (!pendingRemovalFeedType) return;
    
    removeVideoFeed(pendingRemovalFeedType);
    closeConfirmationModal();
}

// Remove video feed
function removeVideoFeed(feedType) {
    
    const videoElement = document.getElementById(`${feedType}-video`);
    const noFeedMessage = document.getElementById(`${feedType}-no-feed`);
    
    // Stop camera stream if active
    if (feedType === 'entry' && entryStream) {
        entryStream.getTracks().forEach(track => track.stop());
        entryStream = null;
        entryVideoSource = null;
    } else if (feedType === 'parking' && parkingStream) {
        parkingStream.getTracks().forEach(track => track.stop());
        parkingStream = null;
        parkingVideoSource = null;
    }
    
    // Clear video element
    videoElement.srcObject = null;
    videoElement.src = '';
    videoElement.style.display = 'none';
    
    // Show no feed message
    noFeedMessage.style.display = 'flex';
    
    // Hide remove button
    hideRemoveButton(feedType);
    
    // Show select button
    showSelectButton(feedType);
    
    // Clear localStorage
    localStorage.removeItem(`${feedType}VideoSource`);
    localStorage.removeItem(`${feedType}CameraDevice`);
    localStorage.removeItem(`${feedType}CameraLabel`);
    localStorage.removeItem(`${feedType}VideoFile`);
}

// Show remove button
function showRemoveButton(feedType) {
    const removeBtn = document.getElementById(`${feedType}-remove-btn`);
    if (removeBtn) {
        removeBtn.style.display = 'flex';
    }
}

// Hide remove button
function hideRemoveButton(feedType) {
    const removeBtn = document.getElementById(`${feedType}-remove-btn`);
    if (removeBtn) {
        removeBtn.style.display = 'none';
    }
}

// Show select button
function showSelectButton(feedType) {
    const selectBtn = document.getElementById(`${feedType}-select-btn`);
    if (selectBtn) {
        selectBtn.style.display = 'flex';
    }
}

// Hide select button
function hideSelectButton(feedType) {
    const selectBtn = document.getElementById(`${feedType}-select-btn`);
    if (selectBtn) {
        selectBtn.style.display = 'none';
    }
}

// Get available video devices
async function getAvailableDevices() {
    const deviceList = document.getElementById('deviceList');
    
    try {
        // Request permission first
        await navigator.mediaDevices.getUserMedia({ video: true });
        
        // Get all devices
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(device => device.kind === 'videoinput');
        
        if (videoDevices.length === 0) {
            deviceList.innerHTML = `
                <div class="no-devices">
                    <i class="fas fa-exclamation-triangle"></i>
                    <p>No camera devices found</p>
                </div>
            `;
            return;
        }
        
        // Display devices
        deviceList.innerHTML = videoDevices.map((device, index) => `
            <div class="device-item" onclick="selectDevice('${device.deviceId}', '${device.label || `Camera ${index + 1}`}')">
                <div class="device-icon">
                    <i class="fas fa-video"></i>
                </div>
                <div class="device-info">
                    <div class="device-name">${device.label || `Camera ${index + 1}`}</div>
                    <div class="device-id">${device.deviceId.substring(0, 20)}...</div>
                </div>
                <div class="device-action">
                    <i class="fas fa-chevron-right"></i>
                </div>
            </div>
        `).join('');
        
    } catch (error) {
        console.error('Error accessing media devices:', error);
        deviceList.innerHTML = `
            <div class="device-error">
                <i class="fas fa-exclamation-circle"></i>
                <p>Camera access denied</p>
                <small>Please allow camera permissions in your browser</small>
            </div>
        `;
    }
}

// Select a device and start video stream
async function selectDevice(deviceId, deviceLabel) {
    if (!currentFeedType) return;
    
    try {
        // Stop existing stream if any
        if (currentFeedType === 'entry' && entryStream) {
            entryStream.getTracks().forEach(track => track.stop());
        } else if (currentFeedType === 'parking' && parkingStream) {
            parkingStream.getTracks().forEach(track => track.stop());
        }
        
        // Get new stream
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { deviceId: { exact: deviceId } }
        });
        
        // Set stream to video element
        const videoElement = document.getElementById(`${currentFeedType}-video`);
        const noFeedMessage = document.getElementById(`${currentFeedType}-no-feed`);
        
        videoElement.srcObject = stream;
        videoElement.src = ''; // Clear any file source
        videoElement.style.display = 'block';
        noFeedMessage.style.display = 'none';
        
        // Store stream reference
        if (currentFeedType === 'entry') {
            entryStream = stream;
            entryVideoSource = 'camera';
        } else {
            parkingStream = stream;
            parkingVideoSource = 'camera';
        }
        
        // Save selection to localStorage
        localStorage.setItem(`${currentFeedType}VideoSource`, 'camera');
        localStorage.setItem(`${currentFeedType}CameraDevice`, deviceId);
        localStorage.setItem(`${currentFeedType}CameraLabel`, deviceLabel);
        
        // Show remove button
        showRemoveButton(currentFeedType);
        
        // Hide select button
        hideSelectButton(currentFeedType);
        
        // Close modal
        closeDeviceModal();
        
    } catch (error) {
        console.error('Error starting video stream:', error);
        alert('Failed to start camera. Please try another device.');
    }
}

// Restore saved camera selections on page load
async function restoreSavedCameras() {
    // Restore entry feed
    const entrySource = localStorage.getItem('entryVideoSource');
    if (entrySource === 'camera') {
        const entryCameraId = localStorage.getItem('entryCameraDevice');
        if (entryCameraId) {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({
                    video: { deviceId: { exact: entryCameraId } }
                });
                const videoElement = document.getElementById('entry-video');
                const noFeedMessage = document.getElementById('entry-no-feed');
                videoElement.srcObject = stream;
                videoElement.style.display = 'block';
                noFeedMessage.style.display = 'none';
                entryStream = stream;
                entryVideoSource = 'camera';
                showRemoveButton('entry');
                hideSelectButton('entry');
            } catch (error) {
                console.error('Failed to restore entry camera:', error);
                localStorage.removeItem('entryCameraDevice');
                localStorage.removeItem('entryVideoSource');
            }
        }
    }
    // Note: File sources cannot be restored due to browser security
    
    // Restore parking feed
    const parkingSource = localStorage.getItem('parkingVideoSource');
    if (parkingSource === 'camera') {
        const parkingCameraId = localStorage.getItem('parkingCameraDevice');
        if (parkingCameraId) {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({
                    video: { deviceId: { exact: parkingCameraId } }
                });
                const videoElement = document.getElementById('parking-video');
                const noFeedMessage = document.getElementById('parking-no-feed');
                videoElement.srcObject = stream;
                videoElement.style.display = 'block';
                noFeedMessage.style.display = 'none';
                parkingStream = stream;
                parkingVideoSource = 'camera';
                showRemoveButton('parking');
                hideSelectButton('parking');
            } catch (error) {
                console.error('Failed to restore parking camera:', error);
                localStorage.removeItem('parkingCameraDevice');
                localStorage.removeItem('parkingVideoSource');
            }
        }
    }
    // Note: File sources cannot be restored due to browser security
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', function() {
    restoreSavedCameras();
});

// Close modal when clicking outside
window.onclick = function(event) {
    const modal = document.getElementById('deviceModal');
    if (event.target === modal) {
        closeDeviceModal();
    }
}

// Clean up streams when page is unloaded
window.addEventListener('beforeunload', function() {
    if (entryStream) {
        entryStream.getTracks().forEach(track => track.stop());
    }
    if (parkingStream) {
        parkingStream.getTracks().forEach(track => track.stop());
    }
});
