from django.contrib import admin
from spotxcel.admin import admin_site
from .models import User

class UserAdmin(admin.ModelAdmin):
    # List view configuration
    list_display = ('user_id', 'username', 'email', 'role', 'verified_status', 'created_at', 'last_logged')
    search_fields = ('username', 'email')
    list_filter = ('role', 'verified_status')
    
    # Detail view configuration - fields to display (exclude password)
    fields = ('user_id', 'username', 'email', 'role', 'verified_status', 'created_at', 'last_logged')
    
    # Read-only fields (cannot be edited)
    readonly_fields = ('user_id', 'created_at', 'last_logged')
    
    # Exclude password from all forms
    exclude = ('password',)

# Register with custom admin site
admin_site.register(User, UserAdmin)
