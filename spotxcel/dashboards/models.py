from django.db import models
from django.utils import timezone


class PlateDetectionHistory(models.Model):
	timestamp = models.DateTimeField(default=timezone.now)
	license_plate_text = models.CharField(max_length=64)
	confidence = models.FloatField(default=0.0)
	plate_type = models.CharField(max_length=32, default='unknown')
	first_seen = models.DateTimeField()
	last_seen = models.DateTimeField()
	frames_detected = models.PositiveIntegerField(default=1)

	class Meta:
		ordering = ['-timestamp']

	def __str__(self):
		return f"{self.license_plate_text} ({self.timestamp:%Y-%m-%d %H:%M:%S})"
