from django.db import models
from django.utils import timezone
from decimal import Decimal


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


class ParkingRecord(models.Model):
	session_id = models.CharField(max_length=32, unique=True)
	entry_time = models.DateTimeField(default=timezone.now)
	exit_time = models.DateTimeField(null=True, blank=True)
	slot_id = models.CharField(max_length=64, default='Unknown')
	vehicle_id = models.CharField(max_length=64, blank=True, default='')
	plate_detected = models.BooleanField(default=False)

	class Meta:
		ordering = ['-entry_time']

	def __str__(self):
		return f"{self.session_id} - {self.slot_id}"

	@property
	def is_active(self):
		return self.exit_time is None

	@property
	def vehicle_display(self):
		return self.vehicle_id if self.vehicle_id else 'Not Detected'

	@property
	def duration_display(self):
		end_time = self.exit_time or timezone.now()
		delta = end_time - self.entry_time
		total_seconds = max(0, int(delta.total_seconds()))
		hours, remainder = divmod(total_seconds, 3600)
		minutes, seconds = divmod(remainder, 60)

		if hours > 0:
			duration = f"{hours}h {minutes}m"
		elif minutes > 0:
			duration = f"{minutes}m {seconds}s"
		else:
			duration = f"{seconds}s"

		return duration


class ParkingFeeConfig(models.Model):
	UNIT_MINUTE = 'minute'
	UNIT_HOUR = 'hour'
	UNIT_DAY = 'day'
	UNIT_MONTH = 'month'

	BILLING_UNIT_CHOICES = [
		(UNIT_MINUTE, 'Minute'),
		(UNIT_HOUR, 'Hour'),
		(UNIT_DAY, 'Day'),
		(UNIT_MONTH, 'Month'),
	]

	billing_unit = models.CharField(max_length=16, choices=BILLING_UNIT_CHOICES, default=UNIT_HOUR)
	rate = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0.00'))
	is_active = models.BooleanField(default=True)
	created_at = models.DateTimeField(default=timezone.now)
	updated_at = models.DateTimeField(auto_now=True)

	class Meta:
		ordering = ['-created_at']

	def __str__(self):
		unit_labels = {
			self.UNIT_MINUTE: 'Minute',
			self.UNIT_HOUR: 'Hour',
			self.UNIT_DAY: 'Day',
			self.UNIT_MONTH: 'Month',
		}
		return f"{unit_labels.get(self.billing_unit, 'Hour')} - Rs {self.rate}"


class DetectionConfidenceConfig(models.Model):
	plate_detection_confidence = models.FloatField(default=0.25)
	parking_detection_confidence = models.FloatField(default=0.50)
	is_active = models.BooleanField(default=True)
	created_at = models.DateTimeField(default=timezone.now)
	updated_at = models.DateTimeField(auto_now=True)

	class Meta:
		ordering = ['-updated_at']

	def __str__(self):
		return (
			f"Plate {self.plate_detection_confidence:.2f} / "
			f"Parking {self.parking_detection_confidence:.2f}"
		)
