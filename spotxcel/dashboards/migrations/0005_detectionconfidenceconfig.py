from django.db import migrations, models
from django.utils import timezone


class Migration(migrations.Migration):

    dependencies = [
        ('dashboards', '0004_parkingfeeconfig'),
    ]

    operations = [
        migrations.CreateModel(
            name='DetectionConfidenceConfig',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('plate_detection_confidence', models.FloatField(default=0.25)),
                ('parking_detection_confidence', models.FloatField(default=0.5)),
                ('is_active', models.BooleanField(default=True)),
                ('created_at', models.DateTimeField(default=timezone.now)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
            options={
                'ordering': ['-updated_at'],
            },
        ),
    ]