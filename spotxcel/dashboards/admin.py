from django.contrib import admin

from .models import ParkingFeeConfig, ParkingRecord, PlateDetectionHistory


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


@admin.register(ParkingRecord)
class ParkingRecordAdmin(admin.ModelAdmin):
	list_display = (
		'session_id',
		'entry_time',
		'exit_time',
		'slot_id',
		'vehicle_id',
		'plate_detected',
	)
	search_fields = ('session_id', 'slot_id', 'vehicle_id')
	list_filter = ('plate_detected', 'entry_time', 'exit_time')


@admin.register(ParkingFeeConfig)
class ParkingFeeConfigAdmin(admin.ModelAdmin):
	list_display = (
		'billing_unit',
		'rate',
		'is_active',
		'created_at',
	)
	list_filter = ('billing_unit', 'is_active', 'created_at')
	search_fields = ('billing_unit',)
