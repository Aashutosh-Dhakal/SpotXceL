from django.db import models

class User(models.Model):

    ROLE_CHOICES = [
        ('admin', 'Admin'),
        ('driver', 'Driver'),
    ]

    user_id = models.AutoField(primary_key=True)
    username = models.CharField(max_length=100, unique=True)
    email = models.EmailField(unique=True)
    password = models.CharField(max_length=255)
    role = models.CharField(max_length=10, choices=ROLE_CHOICES, default='driver')
    verified_status = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    last_logged = models.DateTimeField(null=True, blank=True)

    # Compatibility properties for Django's default_token_generator
    @property
    def pk(self):
        return self.user_id

    @property
    def is_active(self):
        return True

    @property
    def last_login(self):
        return self.last_logged

    def get_email_field_name(self):
        return 'email'

    def __str__(self):
        return self.username
