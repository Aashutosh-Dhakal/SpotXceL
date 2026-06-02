from django.db import migrations, models


VEHICLE_TYPES = ['car', 'van', 'motor']


def seed_vehicle_fee_configs(apps, schema_editor):
    ParkingFeeConfig = apps.get_model('dashboards', 'ParkingFeeConfig')

    template = ParkingFeeConfig.objects.filter(is_active=True).order_by('-created_at').first()
    if template is None:
        template = ParkingFeeConfig.objects.order_by('-created_at').first()

    if template is None:
        return

    for vehicle_type in VEHICLE_TYPES:
        if ParkingFeeConfig.objects.filter(vehicle_type=vehicle_type, is_active=True).exists():
            continue

        ParkingFeeConfig.objects.create(
            vehicle_type=vehicle_type,
            billing_unit=template.billing_unit,
            rate=template.rate,
            is_active=True,
        )


class Migration(migrations.Migration):

    dependencies = [
        ('dashboards', '0005_detectionconfidenceconfig'),
    ]

    operations = [
        migrations.AddField(
            model_name='parkingrecord',
            name='vehicle_type',
            field=models.CharField(choices=[('car', 'Car'), ('van', 'Van'), ('motor', 'Motor')], default='car', max_length=16),
        ),
        migrations.AddField(
            model_name='parkingfeeconfig',
            name='vehicle_type',
            field=models.CharField(choices=[('car', 'Car'), ('van', 'Van'), ('motor', 'Motor')], default='car', max_length=16),
        ),
        migrations.RunPython(seed_vehicle_fee_configs, migrations.RunPython.noop),
    ]
