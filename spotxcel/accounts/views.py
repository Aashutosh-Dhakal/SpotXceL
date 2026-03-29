from django.shortcuts import render, redirect
from django.contrib import messages
from django.utils import timezone
from django.db import IntegrityError
from django.core.mail import EmailMultiAlternatives
from django.contrib.auth.tokens import default_token_generator
from django.utils.http import urlsafe_base64_encode, urlsafe_base64_decode
from django.utils.encoding import force_bytes, force_str
from django.conf import settings
from django.contrib.auth.hashers import make_password, check_password
import hashlib
import re

from .models import User

# Create your views here.

def _redirect_for_role(user):
    """Helper to redirect based on user role."""
    if user.role == 'admin':
        return redirect('parking_monitoring')
    return redirect('user_dashboard')


_LEGACY_SHA256_RE = re.compile(r'^[0-9a-f]{64}$')


def _verify_user_password(user, raw_password):
    """Verify password and indicate whether the stored hash should be upgraded."""
    stored = user.password or ''

    if check_password(raw_password, stored):
        return True, False

    legacy_hash = hashlib.sha256(raw_password.encode()).hexdigest()
    if _LEGACY_SHA256_RE.match(stored) and stored == legacy_hash:
        return True, True

    return False, False


def signup(request):
    # Redirect to dashboard if user is already logged in
    if request.session.get('user_id'):
        if request.session.get('role') == 'admin':
            return redirect('parking_monitoring')
        else:
            return redirect('user_dashboard')
    
    if request.method == 'POST':
        username = request.POST.get('username', '').strip()
        email = request.POST.get('email', '').strip().lower()
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
        
        hashed_password = make_password(password)
        
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
            
            messages.success(request, f'Welcome to SpotXceL, {user.username}! Please verify your email.')
            
            # New users are unverified — redirect to verification page
            return redirect('verify_account')
            
        except IntegrityError as e:
            # Handle duplicate username or email
            if 'username' in str(e).lower():
                messages.error(request, 'Username already exists. Please choose another one.')
            elif 'email' in str(e).lower():
                messages.error(request, 'Email already registered. Please use another email.')
            else:
                messages.error(request, 'An error occurred. Please try again.')
            return render(request, 'accounts/signup.html')
        
        except Exception:
            messages.error(request, 'An unexpected error occurred. Please try again.')
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
            
            is_valid_password, should_upgrade_hash = _verify_user_password(user, password)

            if is_valid_password:
                # Update last_logged timestamp
                user.last_logged = timezone.now()
                if should_upgrade_hash:
                    user.password = make_password(password)
                user.save()
                
                # Create session
                request.session['user_id'] = user.user_id
                request.session['username'] = user.username
                request.session['email'] = user.email
                request.session['role'] = user.role
                
                # Check verification status
                if not user.verified_status:
                    messages.info(request, 'Please verify your email to continue.')
                    return redirect('verify_account')
                
                messages.success(request, f'Welcome back, {user.username}!')
                
                # Redirect based on role
                if user.role == 'admin':
                    return redirect('parking_monitoring')  # Admin goes to Parking Lot Monitoring
                else:
                    return redirect('user_dashboard')  # Drivers go to user dashboard
            else:
                messages.error(request, 'Invalid password.')
                return render(request, 'accounts/login.html', {'username': username})
                
        except Exception:
            messages.error(request, 'An unexpected error occurred. Please try again.')
            return render(request, 'accounts/login.html', {'username': username})
    
    return render(request, 'accounts/login.html')


def forgot_password(request):
    """Render forgot-password page and send reset email."""
    if request.method == 'POST':
        email_input = request.POST.get('email', '').strip().lower()

        if not email_input:
            messages.error(request, 'Email is required.')
            return render(request, 'accounts/forgot_password.html', {'email': email_input})

        if '@' not in email_input or '.' not in email_input:
            messages.error(request, 'Please enter a valid email address.')
            return render(request, 'accounts/forgot_password.html', {'email': email_input})

        try:
            user = User.objects.get(email=email_input)

            # Generate token and encoded user ID (same pipeline as account verification)
            token = default_token_generator.make_token(user)
            uid = urlsafe_base64_encode(force_bytes(user.user_id))

            # Build absolute reset URL
            reset_path = f'/accounts/reset-password/{uid}/{token}/'
            reset_url = request.build_absolute_uri(reset_path)

            # Send email
            subject = 'SpotXceL - Reset your password'
            text_message = (
                f'Hi {user.username},\n\n'
                f'We received a request to reset your SpotXceL password.\n'
                f'Please click the link below to set a new password:\n\n'
                f'{reset_url}\n\n'
                f'This link will expire automatically for security reasons.\n'
                f'If you did not request a password reset, you can ignore this email.\n\n'
                f'- SpotXceL'
            )
            html_message = f'''
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
            </head>
            <body style="margin:0;padding:0;background-color:#F3F4F6;font-family:'Inter',Arial,sans-serif;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F3F4F6;padding:40px 20px;">
                    <tr>
                        <td align="center">
                            <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
                                <tr>
                                    <td style="background:linear-gradient(135deg,#1F2937 0%,#374151 100%);padding:32px 40px;text-align:center;">
                                        <h1 style="margin:0;font-size:24px;font-weight:800;color:#ffffff;letter-spacing:0.03em;"><span style="color:#ffffff;">Spot</span><span style="color:#EA580C;">XceL</span></h1>
                                        <p style="margin:8px 0 0;font-size:13px;color:#9CA3AF;">Smart Parking System</p>
                                    </td>
                                </tr>
                                <tr>
                                    <td style="padding:40px 40px 20px;">
                                        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
                                            <tr>
                                                <td align="center">
                                                    <table role="presentation" cellpadding="0" cellspacing="0">
                                                        <tr>
                                                            <td align="center" style="width:64px;height:64px;border-radius:50%;background:#FFF7ED;text-align:center;vertical-align:middle;">
                                                                <span style="font-size:28px;line-height:64px;">&#128274;</span>
                                                            </td>
                                                        </tr>
                                                    </table>
                                                </td>
                                            </tr>
                                        </table>
                                        <h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111827;text-align:center;">Reset Your Password</h2>
                                        <p style="margin:0 0 28px;font-size:14px;color:#6B7280;line-height:1.6;text-align:center;">Hi <strong style="color:#111827;">{user.username}</strong>, click the button below to choose a new password for your account.</p>
                                        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                                            <tr>
                                                <td align="center">
                                                    <a href="{reset_url}" style="display:inline-block;padding:14px 40px;background-color:#F26522;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;border-radius:8px;box-shadow:0 2px 8px rgba(242,101,34,0.3);">Reset Password</a>
                                                </td>
                                            </tr>
                                        </table>
                                    </td>
                                </tr>
                                <tr>
                                    <td style="padding:0 40px 32px;">
                                        <div style="margin-top:24px;padding:16px;background:#F9FAFB;border:1px solid #E5E7EB;border-radius:8px;">
                                            <p style="margin:0 0 8px;font-size:12px;color:#9CA3AF;text-align:center;">Button not working? Copy and paste this link:</p>
                                            <p style="margin:0;font-size:12px;color:#F26522;word-break:break-all;text-align:center;">{reset_url}</p>
                                        </div>
                                    </td>
                                </tr>
                                <tr>
                                    <td style="padding:20px 40px;border-top:1px solid #E5E7EB;text-align:center;">
                                        <p style="margin:0 0 4px;font-size:12px;color:#9CA3AF;">This link will expire automatically for security.</p>
                                        <p style="margin:0;font-size:12px;color:#9CA3AF;">If you did not request this, ignore this email.</p>
                                        <p style="margin:16px 0 0;font-size:11px;color:#D1D5DB;">&copy; SpotXceL</p>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                </table>
            </body>
            </html>
            '''

            email = EmailMultiAlternatives(subject, text_message, settings.DEFAULT_FROM_EMAIL, [user.email])
            email.attach_alternative(html_message, 'text/html')
            email.send()
        except User.DoesNotExist:
            # Avoid leaking whether the email is registered.
            pass
        except Exception:
            # Keep response generic to avoid user enumeration side-channel.
            pass

        messages.success(request, 'If an account with that email exists, a password reset link has been sent.')
        return redirect('forgot_password')

    return render(request, 'accounts/forgot_password.html')


def reset_password(request, uidb64, token):
    """Handle password reset from emailed token link."""
    try:
        uid = force_str(urlsafe_base64_decode(uidb64))
        user = User.objects.get(user_id=uid)
    except (TypeError, ValueError, OverflowError, User.DoesNotExist):
        user = None

    if user is None or not default_token_generator.check_token(user, token):
        return render(request, 'accounts/reset_password_invalid.html')

    if request.method == 'POST':
        password = request.POST.get('password', '')
        confirm_password = request.POST.get('confirm_password', '')

        if not password or not confirm_password:
            messages.error(request, 'Both password fields are required.')
            return render(request, 'accounts/reset_password.html')

        if len(password) < 8:
            messages.error(request, 'Password must be at least 8 characters long.')
            return render(request, 'accounts/reset_password.html')

        if password != confirm_password:
            messages.error(request, 'Passwords do not match.')
            return render(request, 'accounts/reset_password.html')

        user.password = make_password(password)
        user.save()

        messages.success(request, 'Your password has been reset successfully. Please log in.')
        return redirect('login')

    return render(request, 'accounts/reset_password.html')

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
    try:
        user = User.objects.get(user_id=request.session.get('user_id'))
    except User.DoesNotExist:
        request.session.flush()
        return redirect('login')
    
    # Enforce email verification
    if not user.verified_status:
        return redirect('verify_account')
    
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
            
            # Verify current password and support transparent hash upgrade.
            current_ok, should_upgrade_hash = _verify_user_password(user, current_password)
            if not current_ok:
                messages.error(request, 'Current password is incorrect.')
                return render(request, 'accounts/profile.html', {'user': user})

            if should_upgrade_hash:
                user.password = make_password(current_password)
            
            # Validate new password length
            if len(new_password) < 8:
                messages.error(request, 'New password must be at least 8 characters long.')
                return render(request, 'accounts/profile.html', {'user': user})
            
            user.password = make_password(new_password)
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


def verify_account(request):
    """Verification page — shown to unverified users."""
    if not request.session.get('user_id'):
        return redirect('login')

    try:
        user = User.objects.get(user_id=request.session['user_id'])
    except User.DoesNotExist:
        return redirect('login')

    # Already verified — send them to their dashboard
    if user.verified_status:
        return _redirect_for_role(user)

    return render(request, 'accounts/verify_account.html', {'user': user})


def send_verification_email(request):
    """Generate a token and send a verification link to the user's email."""
    if not request.session.get('user_id'):
        return redirect('login')

    if request.method != 'POST':
        return redirect('verify_account')

    try:
        user = User.objects.get(user_id=request.session['user_id'])
    except User.DoesNotExist:
        return redirect('login')

    if user.verified_status:
        messages.info(request, 'Your account is already verified.')
        return _redirect_for_role(user)

    # Generate token and encoded user ID
    token = default_token_generator.make_token(user)
    uid = urlsafe_base64_encode(force_bytes(user.user_id))

    # Build absolute verification URL
    verification_path = f'/accounts/verify-email/{uid}/{token}/'
    verification_url = request.build_absolute_uri(verification_path)

    # Send email
    subject = 'SpotXceL — Verify your email address'
    text_message = (
        f'Hi {user.username},\n\n'
        f'Please click the link below to verify your email address:\n\n'
        f'{verification_url}\n\n'
        f'This link will expire automatically for security reasons.\n'
        f'If you did not create an account, you can ignore this email.\n\n'
        f'— SpotXceL'
    )
    html_message = f'''
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="margin:0;padding:0;background-color:#F3F4F6;font-family:'Inter',Arial,sans-serif;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F3F4F6;padding:40px 20px;">
            <tr>
                <td align="center">
                    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
                        <!-- Header -->
                        <tr>
                            <td style="background:linear-gradient(135deg,#1F2937 0%,#374151 100%);padding:32px 40px;text-align:center;">
                                <h1 style="margin:0;font-size:24px;font-weight:800;color:#ffffff;letter-spacing:0.03em;"><span style="color:#ffffff;">Spot</span><span style="color:#EA580C;">XceL</span></h1>
                                <p style="margin:8px 0 0;font-size:13px;color:#9CA3AF;">Smart Parking System</p>
                            </td>
                        </tr>
                        <!-- Body -->
                        <tr>
                            <td style="padding:40px 40px 20px;">
                                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
                                    <tr>
                                        <td align="center">
                                            <table role="presentation" cellpadding="0" cellspacing="0">
                                                <tr>
                                                    <td align="center" style="width:64px;height:64px;border-radius:50%;background:#FFF7ED;text-align:center;vertical-align:middle;">
                                                        <span style="font-size:28px;line-height:64px;">&#9993;</span>
                                                    </td>
                                                </tr>
                                            </table>
                                        </td>
                                    </tr>
                                </table>
                                <h2 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111827;text-align:center;">Verify Your Email</h2>
                                <p style="margin:0 0 28px;font-size:14px;color:#6B7280;line-height:1.6;text-align:center;">Hi <strong style="color:#111827;">{user.username}</strong>, click the button below to verify your email address and activate your account.</p>
                                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                                    <tr>
                                        <td align="center">
                                            <a href="{verification_url}" style="display:inline-block;padding:14px 40px;background-color:#F26522;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;border-radius:8px;box-shadow:0 2px 8px rgba(242,101,34,0.3);">Verify Email Address</a>
                                        </td>
                                    </tr>
                                </table>
                            </td>
                        </tr>
                        <!-- Fallback Link -->
                        <tr>
                            <td style="padding:0 40px 32px;">
                                <div style="margin-top:24px;padding:16px;background:#F9FAFB;border:1px solid #E5E7EB;border-radius:8px;">
                                    <p style="margin:0 0 8px;font-size:12px;color:#9CA3AF;text-align:center;">Button not working? Copy and paste this link:</p>
                                    <p style="margin:0;font-size:12px;color:#F26522;word-break:break-all;text-align:center;">{verification_url}</p>
                                </div>
                            </td>
                        </tr>
                        <!-- Footer -->
                        <tr>
                            <td style="padding:20px 40px;border-top:1px solid #E5E7EB;text-align:center;">
                                <p style="margin:0 0 4px;font-size:12px;color:#9CA3AF;">This link will expire automatically for security.</p>
                                <p style="margin:0;font-size:12px;color:#9CA3AF;">If you didn&rsquo;t create an account, ignore this email.</p>
                                <p style="margin:16px 0 0;font-size:11px;color:#D1D5DB;">&copy; SpotXceL</p>
                            </td>
                        </tr>
                    </table>
                </td>
            </tr>
        </table>
    </body>
    </html>
    '''

    try:
        email = EmailMultiAlternatives(subject, text_message, settings.DEFAULT_FROM_EMAIL, [user.email])
        email.attach_alternative(html_message, 'text/html')
        email.send()
        messages.success(request, 'Verification email sent! Check your inbox.')
    except Exception:
        messages.error(request, 'Failed to send email. Please try again later.')

    return redirect('verify_account')


def verify_email(request, uidb64, token):
    """Verify the email using the token from the link."""
    try:
        uid = force_str(urlsafe_base64_decode(uidb64))
        user = User.objects.get(user_id=uid)
    except (TypeError, ValueError, OverflowError, User.DoesNotExist):
        user = None

    if user is not None and default_token_generator.check_token(user, token):
        if user.verified_status:
            messages.info(request, 'Your account is already verified.')
            # Log the user in if not already
            if not request.session.get('user_id'):
                request.session['user_id'] = user.user_id
                request.session['username'] = user.username
                request.session['email'] = user.email
                request.session['role'] = user.role
            return _redirect_for_role(user)

        # Mark as verified
        user.verified_status = True
        user.save()

        # Ensure user is logged in
        request.session['user_id'] = user.user_id
        request.session['username'] = user.username
        request.session['email'] = user.email
        request.session['role'] = user.role

        return render(request, 'accounts/verify_success.html', {'user': user})
    else:
        # Invalid or expired token
        return render(request, 'accounts/verify_failed.html')


def delete_account(request):
    """Delete the logged-in user's account permanently."""
    if not request.session.get('user_id'):
        return redirect('login')

    if request.method == 'POST':
        try:
            user = User.objects.get(user_id=request.session['user_id'])
            user.delete()
        except User.DoesNotExist:
            pass

        # Clear session
        request.session.flush()
        messages.success(request, 'Your account has been deleted.')
        return redirect('signup')

    return redirect('verify_account')
