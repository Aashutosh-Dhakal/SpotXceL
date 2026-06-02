from django.db import migrations, models


def normalize_vehicle_type(vehicle_type):
    value = str(vehicle_type or '').strip().lower()
    if value in {'motor', 'motorbike', 'motorcycle'}:
        return 'motor'
    return 'car'


def backfill_fee_snapshot(apps, schema_editor):
    ParkingRecord = apps.get_model('dashboards', 'ParkingRecord')
    ParkingFeeConfig = apps.get_model('dashboards', 'ParkingFeeConfig')

    for record in ParkingRecord.objects.all().iterator():
        if getattr(record, 'fee_billing_unit', '') and getattr(record, 'fee_rate', None) is not None:
            continue

        vehicle_type = normalize_vehicle_type(getattr(record, 'vehicle_type', 'car'))
        fee_config = ParkingFeeConfig.objects.filter(
            vehicle_type=vehicle_type,
            created_at__lte=record.entry_time,
        ).order_by('-created_at').first()

        if fee_config is None:
            fee_config = ParkingFeeConfig.objects.filter(vehicle_type=vehicle_type).order_by('-created_at').first()

        if fee_config is None and vehicle_type != 'car':
            fee_config = ParkingFeeConfig.objects.filter(vehicle_type='car').order_by('-created_at').first()

        if fee_config is None:
            continue

        ParkingRecord.objects.filter(pk=record.pk).update(
            fee_billing_unit=fee_config.billing_unit,
            fee_rate=fee_config.rate,
        )


class Migration(migrations.Migration):

    dependencies = [
        ('dashboards', '0008_alter_parkingrecord_vehicle_type'),
    ]

    operations = [
        migrations.AddField(
            model_name='parkingrecord',
            name='fee_billing_unit',
            field=models.CharField(blank=True, default='', max_length=16),
        ),
        migrations.AddField(
            model_name='parkingrecord',
            name='fee_rate',
            field=models.DecimalField(blank=True, decimal_places=2, default=None, max_digits=10, null=True),
        ),
        migrations.RunPython(backfill_fee_snapshot, migrations.RunPython.noop),
    ]
