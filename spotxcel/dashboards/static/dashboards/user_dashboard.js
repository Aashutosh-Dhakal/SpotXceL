// User Dashboard JavaScript

document.addEventListener('DOMContentLoaded', function() {
    // Handle highlight toggle
    const highlightToggle = document.getElementById('highlightToggle');
    
    if (highlightToggle) {
        highlightToggle.addEventListener('change', function() {
            if (this.checked) {
                console.log('Map highlight enabled');
                // Future: Add logic to highlight vehicle location on map
            } else {
                console.log('Map highlight disabled');
                // Future: Remove highlight from map
            }
        });
    }
});
