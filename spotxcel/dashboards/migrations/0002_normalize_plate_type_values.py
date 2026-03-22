from django.db import migrations


def normalize_plate_types(apps, schema_editor):
    PlateDetectionHistory = apps.get_model('dashboards', 'PlateDetectionHistory')

    for record in PlateDetectionHistory.objects.all().only('id', 'plate_type'):
        current = (record.plate_type or '').strip().lower().replace('-', '_').replace(' ', '_')
        if current == 'embossed' or current.startswith('emboss'):
            target = 'Embossed'
        else:
            target = 'Traditional_nepali'

        if record.plate_type != target:
            record.plate_type = target
            record.save(update_fields=['plate_type'])


class Migration(migrations.Migration):

    dependencies = [
        ('dashboards', '0001_initial'),
    ]

    operations = [
        migrations.RunPython(normalize_plate_types, migrations.RunPython.noop),
    ]
