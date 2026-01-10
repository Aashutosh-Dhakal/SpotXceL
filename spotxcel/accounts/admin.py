from django.contrib import admin
from .models import User

@admin.register(User)
class UserAdmin(admin.ModelAdmin):
    list_display = ('user_id', 'username', 'email', 'role', 'created_at', 'last_logged')
    search_fields = ('username', 'email')
    list_filter = ('role',)
