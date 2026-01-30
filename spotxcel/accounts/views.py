from django.shortcuts import render, redirect
from django.contrib import messages
from django.utils import timezone
from django.db import IntegrityError
import hashlib

from .models import User

# Create your views here.

def signup(request):
    # Redirect to dashboard if user is already logged in
    if request.session.get('user_id'):
        if request.session.get('role') == 'admin':
            return redirect('parking_monitoring')
        else:
            return redirect('user_dashboard')
    
    if request.method == 'POST':
        username = request.POST.get('username', '').strip()
        email = request.POST.get('email', '').strip()
        password = request.POST.get('password', '')
        confirm_password = request.POST.get('confirm_password', '')
        
        # Server-side validation
        if not username or not email or not password:
            messages.error(request, 'All fields are required.')
            return render(request, 'accounts/signup.html')
        
        # Username validation (first letter can be uppercase, rest lowercase with numbers, underscore, hyphen)
        if len(username) == 0 or not username[0].isalpha():
            messages.error(request, 'Username must start with a letter.')
            return render(request, 'accounts/signup.html')
        
        if not all(c.islower() or c.isdigit() or c in '_-' for c in username[1:]):
            messages.error(request, 'Username can only contain letters (first letter can be uppercase), numbers, underscore, and hyphen.')
            return render(request, 'accounts/signup.html')
        
        # Email validation
        if '@' not in email or '.' not in email:
            messages.error(request, 'Please enter a valid email address.')
            return render(request, 'accounts/signup.html')
        
        # Password length validation
        if len(password) < 8:
            messages.error(request, 'Password must be at least 8 characters long.')
            return render(request, 'accounts/signup.html')
        
        # Password match validation
        if password != confirm_password:
            messages.error(request, 'Passwords do not match.')
            return render(request, 'accounts/signup.html')
        
        # Hash the password using SHA-256
        hashed_password = hashlib.sha256(password.encode()).hexdigest()
        
        try:
            # Create new user
            user = User(
                username=username,
                email=email,
                password=hashed_password,
                role='driver',  # Default role
                created_at=timezone.now(),
                last_logged=timezone.now()
            )
            user.save()
            
            # Create session for the new user
            request.session['user_id'] = user.user_id
            request.session['username'] = user.username
            request.session['email'] = user.email
            request.session['role'] = user.role
            
            messages.success(request, f'Welcome to SpotXceL, {user.username}!')
            
            # Redirect based on role
            if user.role == 'admin':
                return redirect('parking_monitoring')
            else:
                return redirect('user_dashboard')
            
        except IntegrityError as e:
            # Handle duplicate username or email
            if 'username' in str(e).lower():
                messages.error(request, 'Username already exists. Please choose another one.')
            elif 'email' in str(e).lower():
                messages.error(request, 'Email already registered. Please use another email.')
            else:
                messages.error(request, 'An error occurred. Please try again.')
            return render(request, 'accounts/signup.html')
        
        except Exception as e:
            messages.error(request, f'An unexpected error occurred: {str(e)}')
            return render(request, 'accounts/signup.html')
    
    return render(request, 'accounts/signup.html')


def login(request):
    # Redirect to dashboard if user is already logged in
    if request.session.get('user_id'):
        if request.session.get('role') == 'admin':
            return redirect('parking_monitoring')
        else:
            return redirect('user_dashboard')
    
    if request.method == 'POST':
        username = request.POST.get('username', '').strip()
        password = request.POST.get('password', '')
        
        # Server-side validation
        if not username or not password:
            messages.error(request, 'Email or username and password are required.')
            return render(request, 'accounts/login.html', {'username': username})
        
        # Hash the provided password using SHA-256
        hashed_password = hashlib.sha256(password.encode()).hexdigest()
        
        try:
            # Try to find user by username or email
            try:
                user = User.objects.get(username=username)
            except User.DoesNotExist:
                try:
                    user = User.objects.get(email=username)
                except User.DoesNotExist:
                    messages.error(request, 'Invalid email or username.')
                    return render(request, 'accounts/login.html', {'username': username})
            
            # Verify password
            if user.password == hashed_password:
                # Update last_logged timestamp
                user.last_logged = timezone.now()
                user.save()
                
                # Create session
                request.session['user_id'] = user.user_id
                request.session['username'] = user.username
                request.session['email'] = user.email
                request.session['role'] = user.role
                
                messages.success(request, f'Welcome back, {user.username}!')
                
                # Redirect based on role
                if user.role == 'admin':
                    return redirect('parking_monitoring')  # Admin goes to Parking Lot Monitoring
                else:
                    return redirect('user_dashboard')  # Drivers go to user dashboard
            else:
                messages.error(request, 'Invalid password.')
                return render(request, 'accounts/login.html', {'username': username})
                
        except Exception as e:
            messages.error(request, f'An unexpected error occurred: {str(e)}')
            return render(request, 'accounts/login.html', {'username': username})
    
    return render(request, 'accounts/login.html')

def logout(request):
    # Clear any existing messages to prevent them from showing on login page
    storage = messages.get_messages(request)
    for _ in storage:
        pass  # Iterate through to mark as used
    
    # Only clear custom user session keys, not the entire session
    # This preserves Django admin authentication
    custom_keys = ['user_id', 'username', 'email', 'role']
    for key in custom_keys:
        if key in request.session:
            del request.session[key]
    
    messages.success(request, 'You have been logged out successfully.')
    return redirect('login')


def profile(request):
    """Display and handle profile settings page."""
    # Check if user is logged in
    if not request.session.get('user_id'):
        return redirect('login')
    
    # Get current user
    user = User.objects.get(user_id=request.session.get('user_id'))
    
    if request.method == 'POST':
        # Get form data
        fullname = request.POST.get('fullname', '').strip()
        email = request.POST.get('email', '').strip()
        current_password = request.POST.get('current_password', '')
        new_password = request.POST.get('new_password', '')
        
        # Validate required fields
        if not fullname or not email:
            messages.error(request, 'Full name and email are required.')
            return render(request, 'accounts/profile.html', {'user': user})
        
        # Username validation (same as signup)
        if not all(c.islower() or c.isdigit() or c in '_- ' for c in fullname):
            # Allow spaces in full name but keep lowercase, numbers, underscore, hyphen
            pass  # We'll be more lenient with full names
        
        # Email validation
        if '@' not in email or '.' not in email:
            messages.error(request, 'Please enter a valid email address.')
            return render(request, 'accounts/profile.html', {'user': user})
        
        # Check if email already exists (excluding current user)
        if email != user.email and User.objects.filter(email=email).exists():
            messages.error(request, 'Email already registered. Please use another email.')
            return render(request, 'accounts/profile.html', {'user': user})
        
        # Handle password change
        password_changed = False
        if new_password:
            # Verify current password if trying to change
            if not current_password:
                messages.error(request, 'Current password is required to set a new password.')
                return render(request, 'accounts/profile.html', {'user': user})
            
            # Hash current password and verify using SHA-256
            hashed_current = hashlib.sha256(current_password.encode()).hexdigest()
            if user.password != hashed_current:
                messages.error(request, 'Current password is incorrect.')
                return render(request, 'accounts/profile.html', {'user': user})
            
            # Validate new password length
            if len(new_password) < 8:
                messages.error(request, 'New password must be at least 8 characters long.')
                return render(request, 'accounts/profile.html', {'user': user})
            
            # Update password using SHA-256 hashing
            user.password = hashlib.sha256(new_password.encode()).hexdigest()
            password_changed = True
        
        # Check if any changes were made
        changes_made = False
        if user.username != fullname:
            user.username = fullname
            request.session['username'] = fullname
            changes_made = True
        
        if user.email != email:
            user.email = email
            request.session['email'] = email
            changes_made = True
        
        if password_changed:
            changes_made = True
        
        # Only save and show success if changes were made
        if changes_made:
            user.save()
            messages.success(request, 'Profile updated successfully!')
        else:
            messages.info(request, 'No changes were made.')
        
        return redirect('profile')
    
    context = {
        'user': user,
    }
    return render(request, 'accounts/profile.html', context)
