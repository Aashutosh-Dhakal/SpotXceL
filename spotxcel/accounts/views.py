from django.shortcuts import render, redirect
from django.contrib import messages
from django.utils import timezone
from django.db import IntegrityError
import hashlib

from .models import User

# Create your views here.

def signup(request):
    if request.method == 'POST':
        username = request.POST.get('username', '').strip()
        email = request.POST.get('email', '').strip()
        password = request.POST.get('password', '')
        confirm_password = request.POST.get('confirm_password', '')
        
        # Server-side validation
        if not username or not email or not password:
            messages.error(request, 'All fields are required.')
            return render(request, 'accounts/signup.html')
        
        # Username validation (lowercase, numbers, underscore, hyphen only)
        if not all(c.islower() or c.isdigit() or c in '_-' for c in username):
            messages.error(request, 'Username must contain only lowercase letters, numbers, underscore, and hyphen.')
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
                last_logged=None
            )
            user.save()
            
            messages.success(request, 'Account created successfully! You can now login.')
            return redirect('login')  # Redirect to login page
            
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
    if request.method == 'POST':
        username = request.POST.get('username', '').strip()
        password = request.POST.get('password', '')
        
        # Server-side validation
        if not username or not password:
            messages.error(request, 'Email or username and password are required.')
            return render(request, 'accounts/login.html')
        
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
                    return render(request, 'accounts/login.html')
            
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
                    return redirect('dashboard')  # Regular users go to dashboard
            else:
                messages.error(request, 'Invalid password.')
                return render(request, 'accounts/login.html')
                
        except Exception as e:
            messages.error(request, f'An unexpected error occurred: {str(e)}')
            return render(request, 'accounts/login.html')
    
    return render(request, 'accounts/login.html')


def dashboard(request):
    # Check if user is logged in
    if 'user_id' not in request.session:
        messages.warning(request, 'Please login to access the dashboard.')
        return redirect('login')
    
    # Redirect admins to parking monitoring
    if request.session.get('role') == 'admin':
        return redirect('parking_monitoring')
    
    # Get user data from session
    context = {
        'username': request.session.get('username'),
        'email': request.session.get('email'),
        'role': request.session.get('role'),
    }
    return render(request, 'accounts/dashboard.html', context)


def logout(request):
    # Clear the session
    request.session.flush()
    messages.success(request, 'You have been logged out successfully.')
    return redirect('login')


