from django.db import migrations, models
from django.utils import timezone


class Migration(migrations.Migration):

    dependencies = [
        ('dashboards', '0002_normalize_plate_type_values'),
    ]

    operations = [
        migrations.CreateModel(
            name='ParkingRecord',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('session_id', models.CharField(max_length=32, unique=True)),
                ('entry_time', models.DateTimeField(default=timezone.now)),
                ('exit_time', models.DateTimeField(blank=True, null=True)),
                ('slot_id', models.CharField(default='Unknown', max_length=64)),
                ('vehicle_id', models.CharField(blank=True, default='', max_length=64)),
                ('plate_detected', models.BooleanField(default=False)),
            ],
            options={
                'ordering': ['-entry_time'],
            },
        ),
    ]
