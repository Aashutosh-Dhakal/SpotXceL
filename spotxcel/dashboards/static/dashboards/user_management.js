// Clear filters functionality
function clearFilters() {
    // Redirect to user management page without any query parameters
    window.location.href = '/dashboards/user-management/';
}

// Delete confirmation modal
let deleteUserId = null;

function confirmDelete(username, userId) {
    deleteUserId = userId;
    document.getElementById('deleteUsername').textContent = username;
    document.getElementById('deleteModal').classList.add('show');
}

function closeDeleteModal() {
    document.getElementById('deleteModal').classList.remove('show');
    deleteUserId = null;
}

// Handle confirm delete button click
document.addEventListener('DOMContentLoaded', function() {
    const confirmBtn = document.getElementById('confirmDeleteBtn');
    if (confirmBtn) {
        confirmBtn.addEventListener('click', function() {
            if (deleteUserId) {
                window.location.href = `/dashboards/user-management/delete/${deleteUserId}/`;
            }
        });
    }
    
    // Close modal when clicking outside
    const modal = document.getElementById('deleteModal');
    if (modal) {
        modal.addEventListener('click', function(e) {
            if (e.target === modal) {
                closeDeleteModal();
            }
        });
    }
    
    // Close modal on Escape key
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            closeDeleteModal();
        }
    });
});

console.log('User Management page loaded');
