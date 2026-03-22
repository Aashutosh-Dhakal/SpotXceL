from django.contrib import admin

from .models import PlateDetectionHistory


@admin.register(PlateDetectionHistory)
class PlateDetectionHistoryAdmin(admin.ModelAdmin):
	list_display = (
		'timestamp',
		'license_plate_text',
		'confidence',
		'plate_type',
		'first_seen',
		'last_seen',
		'frames_detected',
	)
	search_fields = ('license_plate_text', 'plate_type')
	list_filter = ('plate_type', 'timestamp')
