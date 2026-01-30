from django.shortcuts import render, redirect, get_object_or_404
from django.contrib import messages
from django.db.models import Q
from accounts.models import User


def parking_monitoring(request):
    """Display the parking lot monitoring dashboard."""
    # Check if user is logged in
    if not request.session.get('user_id'):
        return redirect('login')
    
    return render(request, 'dashboards/parking_monitoring.html')


def user_management(request):
    """Display the user management dashboard."""
    # Check if user is logged in
    if not request.session.get('user_id'):
        return redirect('login')
    
    # Get filter parameters
    search_query = request.GET.get('search', '').strip()
    role_filter = request.GET.get('role', '').strip()
    
    # Start with all users
    users = User.objects.all().order_by('-created_at')
    
    # Apply search filter
    if search_query:
        users = users.filter(
            Q(username__icontains=search_query) |
            Q(email__icontains=search_query) |
            Q(user_id__icontains=search_query)
        )
    
    # Apply role filter
    if role_filter and role_filter != 'all':
        users = users.filter(role=role_filter)
    
    context = {
        'users': users,
        'search_query': search_query,
        'role_filter': role_filter,
    }
    
    return render(request, 'dashboards/user_management.html', context)


def delete_user(request, user_id):
    """Delete a user from the system."""
    # Check if user is logged in and is admin
    if not request.session.get('user_id'):
        return redirect('login')
    
    if request.session.get('role') != 'admin':
        messages.error(request, 'You do not have permission to delete users.')
        return redirect('user_management')
    
    # Prevent deleting yourself
    if request.session.get('user_id') == user_id:
        messages.error(request, 'You cannot delete your own account.')
        return redirect('user_management')
    
    user = get_object_or_404(User, user_id=user_id)
    username = user.username
    user.delete()
    
    messages.success(request, f'User "{username}" has been deleted successfully.')
    return redirect('user_management')


def edit_user(request, user_id):
    """Edit user details (username and role)."""
    # Check if user is logged in and is admin
    if not request.session.get('user_id'):
        return redirect('login')
    
    if request.session.get('role') != 'admin':
        messages.error(request, 'You do not have permission to edit users.')
        return redirect('user_management')
    
    user = get_object_or_404(User, user_id=user_id)
    
    if request.method == 'POST':
        new_username = request.POST.get('username', '').strip()
        new_role = request.POST.get('role')
        
        # Validate inputs
        if not new_username:
            messages.error(request, 'Username cannot be empty.')
            return render(request, 'dashboards/edit_user.html', {'user': user})
        
        # Check for spaces
        if ' ' in new_username:
            messages.error(request, 'Username cannot contain spaces.')
            return render(request, 'dashboards/edit_user.html', {'user': user})
        
        # Username validation (first letter can be uppercase, rest lowercase with numbers, underscore, hyphen)
        if len(new_username) == 0 or not new_username[0].isalpha():
            messages.error(request, 'Username must start with a letter.')
            return render(request, 'dashboards/edit_user.html', {'user': user})
        
        if not all(c.islower() or c.isdigit() or c in '_-' for c in new_username[1:]):
            messages.error(request, 'Username can only contain letters (first letter can be uppercase), numbers, underscore, and hyphen.')
            return render(request, 'dashboards/edit_user.html', {'user': user})
        
        if new_role not in ['admin', 'driver']:
            messages.error(request, 'Invalid role selected.')
            return render(request, 'dashboards/edit_user.html', {'user': user})
        
        # Check if username already exists (excluding current user)
        if new_username != user.username and User.objects.filter(username=new_username).exists():
            messages.error(request, 'Username already exists. Please choose another one.')
            return render(request, 'dashboards/edit_user.html', {'user': user})
        
        # Check if any changes were made
        changes_made = False
        if user.username != new_username:
            user.username = new_username
            changes_made = True
        
        if user.role != new_role:
            user.role = new_role
            changes_made = True
        
        # Only save and show success if changes were made
        if changes_made:
            user.save()
            messages.success(request, f'User details updated successfully.')
        else:
            messages.info(request, 'No changes were made.')
        
        return redirect('edit_user', user_id=user.user_id)
    
    context = {
        'user': user,
    }
    return render(request, 'dashboards/edit_user.html', context)


def parking_records(request):
    """Display the parking records/history dashboard."""
    # Check if user is logged in
    if not request.session.get('user_id'):
        return redirect('login')
    
    return render(request, 'dashboards/parking_records.html')


def user_dashboard(request):
    """Display the user dashboard for drivers."""
    # Check if user is logged in
    if not request.session.get('user_id'):
        return redirect('login')
    
    # Get user info from session
    username = request.session.get('username', 'User')
    
    context = {
        'username': username,
    }
    return render(request, 'dashboards/user_dashboard.html', context)
