from django.db import migrations, models
from django.utils import timezone


class Migration(migrations.Migration):

    dependencies = [
        ('dashboards', '0003_parkingrecord'),
    ]

    operations = [
        migrations.CreateModel(
            name='ParkingFeeConfig',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('billing_unit', models.CharField(choices=[('minute', 'Minute'), ('hour', 'Hour'), ('day', 'Day'), ('month', 'Month')], default='hour', max_length=16)),
                ('rate', models.DecimalField(decimal_places=2, default=0, max_digits=10)),
                ('is_active', models.BooleanField(default=True)),
                ('created_at', models.DateTimeField(default=timezone.now)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
            options={
                'ordering': ['-created_at'],
            },
        ),
    ]
