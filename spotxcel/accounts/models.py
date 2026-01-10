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
    created_at = models.DateTimeField(auto_now_add=True)
    last_logged = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return self.username
