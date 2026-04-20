from django.db import migrations, models


def merge_van_fee_into_car(apps, schema_editor):
    ParkingFeeConfig = apps.get_model('dashboards', 'ParkingFeeConfig')

    van_rows = list(ParkingFeeConfig.objects.filter(vehicle_type='van').order_by('-created_at'))
    if not van_rows:
        return

    car_active = ParkingFeeConfig.objects.filter(vehicle_type='car', is_active=True).order_by('-created_at').first()
    if car_active is None:
        car_active = ParkingFeeConfig.objects.filter(vehicle_type='car').order_by('-created_at').first()

    source_row = car_active or van_rows[0]

    ParkingFeeConfig.objects.filter(vehicle_type='van').update(vehicle_type='car')

    if car_active is None:
        ParkingFeeConfig.objects.create(
            vehicle_type='car',
            billing_unit=source_row.billing_unit,
            rate=source_row.rate,
            is_active=True,
        )
        return

    ParkingFeeConfig.objects.filter(vehicle_type='car', is_active=True).exclude(id=car_active.id).update(is_active=False)


class Migration(migrations.Migration):

    dependencies = [
        ('dashboards', '0006_vehicle_type_fee_allocation'),
    ]

    operations = [
        migrations.AlterField(
            model_name='parkingfeeconfig',
            name='vehicle_type',
            field=models.CharField(choices=[('car', 'Car'), ('motor', 'Motorbike')], default='car', max_length=16),
        ),
        migrations.AlterField(
            model_name='parkingrecord',
            name='vehicle_type',
            field=models.CharField(choices=[('car', 'Car'), ('van', 'Van'), ('motor', 'Motorbike')], default='car', max_length=16),
        ),
        migrations.RunPython(merge_van_fee_into_car, migrations.RunPython.noop),
    ]
