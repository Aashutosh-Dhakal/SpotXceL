from pathlib import Path
import csv
from datetime import datetime

from django.conf import settings
from django.db import migrations, models
from django.utils import timezone


CSV_DATETIME_FORMAT = '%Y-%m-%d %H:%M:%S'


def _parse_datetime(raw_value):
    raw_value = (raw_value or '').strip()
    if not raw_value:
        return timezone.now()
    parsed = datetime.strptime(raw_value, CSV_DATETIME_FORMAT)
    return timezone.make_aware(parsed, timezone.get_current_timezone())


def import_legacy_plate_csv(apps, schema_editor):
    PlateDetectionHistory = apps.get_model('dashboards', 'PlateDetectionHistory')
    csv_path = Path(settings.BASE_DIR) / 'plate_detections.csv'
    if not csv_path.exists():
        return

    with open(csv_path, 'r', encoding='utf-8', newline='') as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            plate_text = (row.get('license_plate_text') or '').strip()
            if not plate_text:
                continue

            try:
                confidence = float(row.get('confidence') or 0.0)
            except (TypeError, ValueError):
                confidence = 0.0

            try:
                frames_detected = int(row.get('frames_detected') or 1)
                if frames_detected < 1:
                    frames_detected = 1
            except (TypeError, ValueError):
                frames_detected = 1

            PlateDetectionHistory.objects.create(
                timestamp=_parse_datetime(row.get('timestamp')),
                license_plate_text=plate_text[:64],
                confidence=confidence,
                plate_type=((row.get('plate_type') or 'unknown').strip() or 'unknown')[:32],
                first_seen=_parse_datetime(row.get('first_seen')),
                last_seen=_parse_datetime(row.get('last_seen')),
                frames_detected=frames_detected,
            )


class Migration(migrations.Migration):

    initial = True

    dependencies = []

    operations = [
        migrations.CreateModel(
            name='PlateDetectionHistory',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('timestamp', models.DateTimeField(default=timezone.now)),
                ('license_plate_text', models.CharField(max_length=64)),
                ('confidence', models.FloatField(default=0.0)),
                ('plate_type', models.CharField(default='unknown', max_length=32)),
                ('first_seen', models.DateTimeField()),
                ('last_seen', models.DateTimeField()),
                ('frames_detected', models.PositiveIntegerField(default=1)),
            ],
            options={
                'ordering': ['-timestamp'],
            },
        ),
        migrations.RunPython(import_legacy_plate_csv, migrations.RunPython.noop),
    ]
