from django.contrib.admin import AdminSite
from django.contrib.auth import logout as auth_logout
from django.shortcuts import redirect
from django.urls import reverse


class CustomAdminSite(AdminSite):
    """Custom admin site that preserves custom user session on logout"""
    
    def logout(self, request, extra_context=None):
        """
        Override the default logout to only clear Django's authentication
        while preserving custom user session keys (user_id, username, email, role)
        """
        # Store custom session keys before logout
        custom_session_data = {
            'user_id': request.session.get('user_id'),
            'username': request.session.get('username'),
            'email': request.session.get('email'),
            'role': request.session.get('role'),
        }
        
        # Perform Django's default logout (clears auth user)
        auth_logout(request)
        
        # Restore custom session keys
        for key, value in custom_session_data.items():
            if value is not None:
                request.session[key] = value
        
        # Redirect to admin login page
        return redirect(reverse('admin:index'))


# Create instance of custom admin site
admin_site = CustomAdminSite(name='custom_admin')
