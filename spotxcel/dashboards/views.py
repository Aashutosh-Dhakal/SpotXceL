from django.shortcuts import render, redirect, get_object_or_404
from django.contrib import messages
from django.db.models import Q
from django.http import JsonResponse, HttpResponse
from django.views.decorators.http import require_POST
from django.conf import settings
from django.utils import timezone
from pathlib import Path
from threading import Lock
from threading import Thread, Event
from datetime import datetime
from decimal import Decimal
import math
import json
import logging
import os
import time
import uuid

import cv2
import numpy as np
from ultralytics import YOLO

from accounts.models import User
from dashboards.ocr import recognise_plate
from dashboards.models import ParkingFeeConfig, ParkingRecord, PlateDetectionHistory

logger = logging.getLogger(__name__)


def _check_verified(request):
    """Return redirect response if user is not verified, else None."""
    user_id = request.session.get('user_id')
    if not user_id:
        return redirect('login')
    try:
        user = User.objects.get(user_id=user_id)
        if not user.verified_status:
            return redirect('verify_account')
    except User.DoesNotExist:
        return redirect('login')
    return None


MODEL_PATH = Path(settings.BASE_DIR) / 'models' / 'LicensePlateDetection' / 'my_model.pt'
_model = None
_model_load_error = None
_model_init_lock = Lock()
_inference_lock = Lock()

PARKING_MODEL_PATH = Path(settings.BASE_DIR) / 'models' / 'VehicleDetection' / 'my_model.pt'
_parking_model = None
_parking_model_load_error = None
_parking_model_init_lock = Lock()
_parking_inference_lock = Lock()

_parking_public_feed_lock = Lock()
_parking_public_feed_active = False
_parking_public_feed_source = None
_parking_public_feed_label = None
_parking_public_feed_frame_jpeg = None
_parking_public_feed_updated_at = 0.0

_parking_layout_lock = Lock()
_parking_layout_spaces = []

ALLOWED_VEHICLE_CLASS_NAMES = {'car', 'van', 'motor'}
VEHICLE_BOX_COLOR_BGR = (255, 0, 0)
VEHICLE_BOX_THICKNESS = 2

LICENSE_PLATE_BOX_COLOR_BGR = (0, 255, 255)  # Yellow in BGR
LICENSE_PLATE_BOX_THICKNESS = 2

SERVER_UPLOADS_DIR = Path(settings.BASE_DIR) / 'temp_stream_uploads'
SERVER_UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
SERVER_RUNTIME_MAX_FRAME_WIDTH = 960
SERVER_RUNTIME_JPEG_QUALITY = 68


def _draw_license_plate_boxes(frame, result):
    """Draw license plate detections with yellow OpenCV boxes."""
    annotated = frame.copy()
    boxes = result.boxes
    if boxes is None or len(boxes) == 0:
        return annotated
    
    for box in boxes:
        x1, y1, x2, y2 = map(int, box.xyxy[0].tolist())
        cv2.rectangle(annotated, (x1, y1), (x2, y2), LICENSE_PLATE_BOX_COLOR_BGR, LICENSE_PLATE_BOX_THICKNESS)
    
    return annotated


def _save_uploaded_video_to_temp(uploaded_file):
    """Persist uploaded video to a temp file path for server-side capture."""
    suffix = Path(uploaded_file.name or '').suffix or '.mp4'
    temp_name = f"feed_{uuid.uuid4().hex}{suffix}"
    temp_path = SERVER_UPLOADS_DIR / temp_name
    with open(temp_path, 'wb') as handle:
        for chunk in uploaded_file.chunks():
            handle.write(chunk)
    return temp_path


def _annotate_entry_frame(frame):
    """Run entry model + OCR/tracker and return yellow-box annotated frame."""
    model = _get_license_plate_model()
    with _inference_lock:
        results = model.predict(
            source=frame,
            conf=0.25,
            iou=0.45,
            imgsz=640,
            verbose=False,
            device='cpu',
        )

    current_detections = []
    boxes = results[0].boxes
    if boxes is not None and len(boxes):
        h, w = frame.shape[:2]
        for box in boxes:
            x1, y1, x2, y2 = map(int, box.xyxy[0].tolist())
            x1, y1 = max(0, x1), max(0, y1)
            x2, y2 = min(w, x2), min(h, y2)
            if x2 <= x1 or y2 <= y1:
                continue

            bbox = (x1, y1, x2, y2)
            plate_crop = frame[y1:y2, x1:x2]
            try:
                text, conf, plate_type = recognise_plate(plate_crop)
            except Exception as ocr_exc:
                logger.warning('OCR failed for a plate region: %s', ocr_exc)
                text, conf, plate_type = '', 0.0, 'unknown'

            current_detections.append({
                'bbox': bbox,
                'text': text,
                'confidence': conf,
                'plate_type': plate_type,
            })

    _update_tracker(current_detections)
    return _draw_license_plate_boxes(frame, results[0])


def _annotate_parking_frame(frame):
    """Run vehicle model and return annotated frame and detection metadata."""
    model = _get_parking_space_model()
    allowed_class_ids = _get_allowed_vehicle_class_ids(model)

    with _parking_inference_lock:
        results = model.predict(
            source=frame,
            conf=0.50,
            iou=0.45,
            imgsz=640,
            classes=allowed_class_ids,
            verbose=False,
            device='cpu',
        )

    detections = _extract_allowed_vehicle_detections(results[0], allowed_class_ids)
    annotated = _draw_allowed_vehicle_boxes(frame, results[0], allowed_class_ids)
    annotated, occupancy_stats = _draw_server_parking_layout_overlay(annotated, detections)
    return {
        'frame': annotated,
        'meta': {
            'detections': detections,
            'frame_width': int(frame.shape[1]),
            'frame_height': int(frame.shape[0]),
            'occupancy_stats': occupancy_stats,
        },
    }


def _set_parking_layout_spaces(spaces):
    """Persist normalized parking-space layout used by server-side overlay."""
    normalized = []
    if isinstance(spaces, list):
        for raw_space in spaces:
            if not isinstance(raw_space, dict):
                continue
            points = raw_space.get('points')
            if not isinstance(points, list) or len(points) < 3:
                continue

            norm_points = []
            for pair in points:
                if not isinstance(pair, (list, tuple)) or len(pair) < 2:
                    continue
                try:
                    nx = float(pair[0])
                    ny = float(pair[1])
                except (TypeError, ValueError):
                    continue
                norm_points.append([
                    min(1.0, max(0.0, nx)),
                    min(1.0, max(0.0, ny)),
                ])

            if len(norm_points) < 3:
                continue

            normalized.append({
                'id': str(raw_space.get('id', '')),
                'points': norm_points,
            })

    with _parking_layout_lock:
        _parking_layout_spaces.clear()
        _parking_layout_spaces.extend(normalized)


def _get_parking_layout_spaces():
    with _parking_layout_lock:
        return [
            {
                'id': space['id'],
                'points': [point[:] for point in space['points']],
            }
            for space in _parking_layout_spaces
        ]


def _bbox_iou_dict(a, b):
    x_left = max(a['x1'], b['x1'])
    y_top = max(a['y1'], b['y1'])
    x_right = min(a['x2'], b['x2'])
    y_bottom = min(a['y2'], b['y2'])

    inter_w = max(0.0, x_right - x_left)
    inter_h = max(0.0, y_bottom - y_top)
    inter_area = inter_w * inter_h
    if inter_area <= 0:
        return 0.0

    area_a = max(0.0, a['x2'] - a['x1']) * max(0.0, a['y2'] - a['y1'])
    area_b = max(0.0, b['x2'] - b['x1']) * max(0.0, b['y2'] - b['y1'])
    denom = area_a + area_b - inter_area
    return (inter_area / denom) if denom > 0 else 0.0


def _point_in_polygon(point, polygon):
    px, py = point
    inside = False
    j = len(polygon) - 1
    for i in range(len(polygon)):
        xi, yi = polygon[i]
        xj, yj = polygon[j]
        intersects = ((yi > py) != (yj > py)) and (
            px < ((xj - xi) * (py - yi) / ((yj - yi) if (yj - yi) != 0 else 1e-9) + xi)
        )
        if intersects:
            inside = not inside
        j = i
    return inside


def _draw_server_parking_layout_overlay(frame, detections):
    """Draw saved parking spaces with occupied/empty highlight on server-rendered frame."""
    spaces = _get_parking_layout_spaces()
    if not spaces:
        return frame, {
            'total': 0,
            'occupied': 0,
            'available': 0,
        }

    h, w = frame.shape[:2]
    overlay = frame.copy()
    occupied_count = 0
    occupied_slot_ids = []

    for idx, space in enumerate(spaces):
        points_px = []
        for nx, ny in space['points']:
            points_px.append((int(round(nx * w)), int(round(ny * h))))
        if len(points_px) < 3:
            continue

        slot_id = (space.get('id') or '').strip() or f'Space-{idx + 1}'

        xs = [pt[0] for pt in points_px]
        ys = [pt[1] for pt in points_px]
        space_box = {
            'x1': float(min(xs)),
            'y1': float(min(ys)),
            'x2': float(max(xs)),
            'y2': float(max(ys)),
        }

        occupied = False
        for det in detections:
            iou = _bbox_iou_dict(
                {
                    'x1': float(det['x1']),
                    'y1': float(det['y1']),
                    'x2': float(det['x2']),
                    'y2': float(det['y2']),
                },
                space_box,
            )
            if iou > 0.3:
                occupied = True
                break

            centroid = (
                (float(det['x1']) + float(det['x2'])) / 2.0,
                (float(det['y1']) + float(det['y2'])) / 2.0,
            )
            if _point_in_polygon(centroid, points_px):
                occupied = True
                break

        if occupied:
            occupied_count += 1
            occupied_slot_ids.append(slot_id)

        poly = np.array(points_px, dtype=np.int32)
        fill_color = (60, 60, 255) if occupied else (60, 200, 60)
        line_color = (40, 40, 220) if occupied else (40, 170, 40)
        cv2.fillPoly(overlay, [poly], fill_color)
        cv2.polylines(frame, [poly], True, line_color, 2)

        label = slot_id
        if label:
            lx, ly = points_px[0]
            ly = ly + 16 if ly < 16 else ly - 6
            cv2.putText(frame, label, (lx + 4, ly), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 2, cv2.LINE_AA)

    _sync_parking_record_tracker(occupied_slot_ids)

    cv2.addWeighted(overlay, 0.24, frame, 0.76, 0, frame)
    total_count = len(spaces)
    return frame, {
        'total': total_count,
        'occupied': occupied_count,
        'available': max(0, total_count - occupied_count),
    }


class _ServerFeedRuntime:
    """Persistent server-side capture runtime for one feed."""

    def __init__(self, name, frame_processor):
        self.name = name
        self.frame_processor = frame_processor
        self.lock = Lock()
        self.thread = None
        self.stop_event = None
        self.capture = None
        self.active = False
        self.source_type = None
        self.source_label = None
        self.source_ref = None
        self.latest_raw_jpeg = None
        self.latest_jpeg = None
        self.latest_meta = None
        self.updated_at = 0.0
        self.error = None

    def _open_capture(self, source_type, source_ref):
        if source_type == 'camera':
            cap = cv2.VideoCapture(int(source_ref))
        else:
            cap = cv2.VideoCapture(str(source_ref))
        if not cap.isOpened():
            raise RuntimeError(f'Unable to open {self.name} source.')
        return cap

    def start(self, source_type, source_ref, source_label):
        self.stop(clear_latest=False)

        stop_event = Event()
        capture = self._open_capture(source_type, source_ref)

        with self.lock:
            self.stop_event = stop_event
            self.capture = capture
            self.active = True
            self.source_type = source_type
            self.source_label = source_label
            self.source_ref = source_ref
            self.latest_raw_jpeg = None
            self.latest_jpeg = None
            self.latest_meta = None
            self.updated_at = time.time()
            self.error = None

        thread = Thread(target=self._run, daemon=True)
        self.thread = thread
        thread.start()

    def stop(self, clear_latest=True):
        with self.lock:
            stop_event = self.stop_event
            thread = self.thread
            capture = self.capture
            source_type = self.source_type
            source_ref = self.source_ref

            self.active = False
            self.source_type = None
            self.source_label = None
            self.source_ref = None
            self.stop_event = None
            self.capture = None
            self.thread = None
            self.error = None
            if clear_latest:
                self.latest_raw_jpeg = None
                self.latest_jpeg = None
                self.latest_meta = None
                self.updated_at = time.time()

        if stop_event is not None:
            stop_event.set()

        if capture is not None:
            try:
                capture.release()
            except Exception:
                pass

        if thread is not None and thread.is_alive():
            thread.join(timeout=1.0)

        if source_type == 'file' and source_ref:
            try:
                os.remove(str(source_ref))
            except FileNotFoundError:
                pass
            except Exception:
                logger.warning('Could not remove temp source file: %s', source_ref)

    def snapshot(self):
        with self.lock:
            return {
                'active': self.active,
                'source_type': self.source_type,
                'source_label': self.source_label,
                'updated_at': self.updated_at,
                'latest_raw_jpeg': self.latest_raw_jpeg,
                'latest_jpeg': self.latest_jpeg,
                'latest_meta': self.latest_meta,
                'error': self.error,
            }

    def _run(self):
        while True:
            with self.lock:
                stop_event = self.stop_event
                capture = self.capture
                source_type = self.source_type

            if stop_event is None or capture is None:
                return
            if stop_event.is_set():
                return

            ok, frame = capture.read()
            if not ok or frame is None:
                if source_type == 'file':
                    capture.set(cv2.CAP_PROP_POS_FRAMES, 0)
                    time.sleep(0.02)
                    continue
                time.sleep(0.05)
                continue

            if frame.shape[1] > SERVER_RUNTIME_MAX_FRAME_WIDTH:
                scale = SERVER_RUNTIME_MAX_FRAME_WIDTH / float(frame.shape[1])
                frame = cv2.resize(
                    frame,
                    (SERVER_RUNTIME_MAX_FRAME_WIDTH, max(1, int(round(frame.shape[0] * scale)))),
                    interpolation=cv2.INTER_AREA,
                )

            raw_jpeg = None
            ok_raw_encode, raw_encoded = cv2.imencode(
                '.jpg',
                frame,
                [int(cv2.IMWRITE_JPEG_QUALITY), SERVER_RUNTIME_JPEG_QUALITY],
            )
            if ok_raw_encode:
                raw_jpeg = raw_encoded.tobytes()

            try:
                processed = self.frame_processor(frame)
                meta = None
                if isinstance(processed, dict):
                    annotated = processed.get('frame')
                    meta = processed.get('meta')
                else:
                    annotated = processed

                if annotated is None:
                    continue

                ok_encode, encoded = cv2.imencode(
                    '.jpg',
                    annotated,
                    [int(cv2.IMWRITE_JPEG_QUALITY), SERVER_RUNTIME_JPEG_QUALITY],
                )
                if not ok_encode:
                    continue
                with self.lock:
                    self.latest_raw_jpeg = raw_jpeg
                    self.latest_jpeg = encoded.tobytes()
                    self.latest_meta = meta
                    self.updated_at = time.time()
            except Exception as exc:
                with self.lock:
                    self.error = str(exc)
                logger.exception('Server feed runtime error (%s): %s', self.name, exc)
                time.sleep(0.05)


_entry_server_runtime = _ServerFeedRuntime('entry', _annotate_entry_frame)
_parking_server_runtime = _ServerFeedRuntime('parking', _annotate_parking_frame)


def _get_license_plate_model():
    """Load license plate model once and reuse it for subsequent requests."""
    global _model, _model_load_error

    if _model is not None:
        return _model

    with _model_init_lock:
        if _model is not None:
            return _model
        if _model_load_error is not None:
            raise RuntimeError(_model_load_error)

        if not MODEL_PATH.exists():
            _model_load_error = f'Model file not found at {MODEL_PATH}'
            raise RuntimeError(_model_load_error)

        try:
            _model = YOLO(str(MODEL_PATH))
            return _model
        except Exception as exc:
            _model_load_error = f'Failed to load model: {exc}'
            raise RuntimeError(_model_load_error) from exc


def _get_parking_space_model():
    """Load vehicle and parking space model once and reuse it for subsequent requests."""
    global _parking_model, _parking_model_load_error

    if _parking_model is not None:
        return _parking_model

    with _parking_model_init_lock:
        if _parking_model is not None:
            return _parking_model
        if _parking_model_load_error is not None:
            raise RuntimeError(_parking_model_load_error)

        if not PARKING_MODEL_PATH.exists():
            _parking_model_load_error = f'Model file not found at {PARKING_MODEL_PATH}'
            raise RuntimeError(_parking_model_load_error)

        try:
            _parking_model = YOLO(str(PARKING_MODEL_PATH))
            return _parking_model
        except Exception as exc:
            _parking_model_load_error = f'Failed to load model: {exc}'
            raise RuntimeError(_parking_model_load_error) from exc


def _get_allowed_vehicle_class_ids(model):
    """Resolve class ids for allowed vehicle classes from the loaded model."""
    names = getattr(model, 'names', None)
    if names is None:
        raise RuntimeError('Vehicle model did not expose class names.')

    if isinstance(names, dict):
        items = names.items()
    else:
        items = enumerate(names)

    allowed_ids = [
        int(class_id)
        for class_id, class_name in items
        if str(class_name).strip().lower() in ALLOWED_VEHICLE_CLASS_NAMES
    ]

    if not allowed_ids:
        raise RuntimeError(
            'None of the allowed classes (car, van, motor) were found in the vehicle model.'
        )

    return sorted(set(allowed_ids))


def _draw_allowed_vehicle_boxes(frame, result, allowed_class_ids):
    """Draw only allowed vehicle detections with a single consistent box color."""
    annotated = frame.copy()
    boxes = result.boxes
    if boxes is None or len(boxes) == 0:
        return annotated

    allowed_set = set(allowed_class_ids)
    for box in boxes:
        if box.cls is None or len(box.cls) == 0:
            continue

        class_id = int(box.cls[0].item())
        if class_id not in allowed_set:
            continue

        x1, y1, x2, y2 = map(int, box.xyxy[0].tolist())
        cv2.rectangle(annotated, (x1, y1), (x2, y2), VEHICLE_BOX_COLOR_BGR, VEHICLE_BOX_THICKNESS)

    return annotated


def _extract_allowed_vehicle_detections(result, allowed_class_ids):
    """Extract allowed vehicle detections for client-side occupancy checks."""
    detections = []
    boxes = result.boxes
    if boxes is None or len(boxes) == 0:
        return detections

    names = getattr(result, 'names', {}) or {}
    allowed_set = set(allowed_class_ids)

    for box in boxes:
        if box.cls is None or len(box.cls) == 0:
            continue

        class_id = int(box.cls[0].item())
        if class_id not in allowed_set:
            continue

        x1, y1, x2, y2 = map(float, box.xyxy[0].tolist())
        confidence = float(box.conf[0].item()) if box.conf is not None and len(box.conf) else 0.0
        if isinstance(names, dict):
            class_name = str(names.get(class_id, class_id))
        else:
            class_name = str(class_id)

        detections.append({
            'class_id': class_id,
            'class_name': class_name,
            'confidence': confidence,
            'x1': x1,
            'y1': y1,
            'x2': x2,
            'y2': y2,
        })

    return detections


def _set_parking_public_feed_state(active, source_type=None, source_label=None, clear_frame=False):
    """Update global parking feed state shared with user dashboard viewers."""
    global _parking_public_feed_active, _parking_public_feed_source, _parking_public_feed_label
    global _parking_public_feed_frame_jpeg, _parking_public_feed_updated_at

    with _parking_public_feed_lock:
        _parking_public_feed_active = bool(active)
        _parking_public_feed_source = source_type if source_type else None
        _parking_public_feed_label = source_label if source_label else None
        if clear_frame:
            _parking_public_feed_frame_jpeg = None
            _parking_public_feed_updated_at = time.time()


def _set_parking_public_feed_frame(frame):
    """Store latest parking frame as JPEG for user dashboard polling."""
    global _parking_public_feed_frame_jpeg, _parking_public_feed_updated_at

    ok, encoded = cv2.imencode('.jpg', frame, [int(cv2.IMWRITE_JPEG_QUALITY), 75])
    if not ok:
        return

    with _parking_public_feed_lock:
        _parking_public_feed_frame_jpeg = encoded.tobytes()
        _parking_public_feed_updated_at = time.time()


def _get_parking_public_feed_snapshot():
    """Return a consistent snapshot of shared parking feed metadata and frame bytes."""
    with _parking_public_feed_lock:
        return {
            'active': _parking_public_feed_active,
            'source_type': _parking_public_feed_source,
            'source_label': _parking_public_feed_label,
            'updated_at': _parking_public_feed_updated_at,
            'frame': _parking_public_feed_frame_jpeg,
        }


# ---------------------------------------------------------------------------
#  Plate tracking & DB logging
# ---------------------------------------------------------------------------

# Each "active plate" is a dict:
#   bbox: (x1, y1, x2, y2)
#   best_text: str
#   best_conf: float
#   plate_type: str
#   first_seen: float   (epoch)
#   last_seen: float     (epoch)
#   frame_count: int
_active_plates: list[dict] = []
_tracker_lock = Lock()

# A plate is considered the same if IoU with a previous bbox exceeds this.
_IOU_THRESHOLD = 0.3
# Plates not seen for this many seconds are considered to have exited.
_EXIT_TIMEOUT_S = 2.0

PLATE_TYPE_TRADITIONAL = 'Traditional_nepali'
PLATE_TYPE_EMBOSSED = 'Embossed'
PLATE_TYPE_OPTIONS = [
    PLATE_TYPE_TRADITIONAL,
    PLATE_TYPE_EMBOSSED,
]

_parking_record_tracker_lock = Lock()
_active_parking_records_by_slot = {}
_PARKING_EXIT_MISS_FRAMES = 10


def _generate_parking_session_id():
    return f"PR-{timezone.now():%Y%m%d%H%M%S}-{uuid.uuid4().hex[:6].upper()}"


def _start_parking_record(slot_id, vehicle_id=''):
    normalized_vehicle = str(vehicle_id or '').strip()
    record = ParkingRecord.objects.create(
        session_id=_generate_parking_session_id(),
        entry_time=timezone.now(),
        slot_id=(str(slot_id or '').strip() or 'Unknown')[:64],
        vehicle_id=normalized_vehicle[:64],
        plate_detected=bool(normalized_vehicle),
    )
    logger.info('Parking record started -> %s (%s)', record.session_id, record.slot_id)
    return record.id


def _close_parking_record(record_id):
    updated = ParkingRecord.objects.filter(id=record_id, exit_time__isnull=True).update(exit_time=timezone.now())
    return bool(updated)


def _sync_parking_record_tracker(occupied_slot_ids):
    normalized_occupied = {
        (str(slot_id or '').strip() or 'Unknown')[:64]
        for slot_id in occupied_slot_ids
    }

    with _parking_record_tracker_lock:
        for slot_id in normalized_occupied:
            active = _active_parking_records_by_slot.get(slot_id)
            if active is None:
                record_id = _start_parking_record(slot_id)
                _active_parking_records_by_slot[slot_id] = {
                    'record_id': record_id,
                    'miss_frames': 0,
                }
                continue

            active['miss_frames'] = 0

        for slot_id in list(_active_parking_records_by_slot.keys()):
            if slot_id in normalized_occupied:
                continue

            active = _active_parking_records_by_slot[slot_id]
            active['miss_frames'] += 1
            if active['miss_frames'] < _PARKING_EXIT_MISS_FRAMES:
                continue

            _close_parking_record(active['record_id'])
            _active_parking_records_by_slot.pop(slot_id, None)


def flush_active_parking_records():
    with _parking_record_tracker_lock:
        for active in _active_parking_records_by_slot.values():
            _close_parking_record(active['record_id'])
        _active_parking_records_by_slot.clear()


def close_stale_open_parking_records():
    ParkingRecord.objects.filter(exit_time__isnull=True).update(exit_time=timezone.now())


def _format_duration_seconds(start_time, end_time=None):
    if not start_time:
        return '-'

    effective_end = end_time or timezone.now()
    total_seconds = max(0, int((effective_end - start_time).total_seconds()))
    hours, remainder = divmod(total_seconds, 3600)
    minutes, seconds = divmod(remainder, 60)

    if hours > 0:
        return f"{hours}h {minutes}m"
    if minutes > 0:
        return f"{minutes}m {seconds}s"
    return f"{seconds}s"


def _iso_or_none(value):
    return value.isoformat() if value else None


def _get_active_parking_fee_config():
    return ParkingFeeConfig.objects.filter(is_active=True).order_by('-created_at').first()


def _calculate_parking_fee_for_record(record, fee_config):
    unit_seconds_map = {
        ParkingFeeConfig.UNIT_MINUTE: 60,
        ParkingFeeConfig.UNIT_HOUR: 3600,
        ParkingFeeConfig.UNIT_DAY: 86400,
        ParkingFeeConfig.UNIT_MONTH: 30 * 24 * 3600,
    }

    if fee_config is None:
        return {
            'duration': record.duration_display,
            'billable_units': 0,
            'fee': Decimal('0.00'),
        }

    end_time = record.exit_time or timezone.now()
    total_seconds = max(0, int((end_time - record.entry_time).total_seconds()))
    seconds_per_unit = unit_seconds_map.get(fee_config.billing_unit, 3600)
    billable_units = max(1, int(math.ceil(total_seconds / float(seconds_per_unit))))
    fee_amount = (Decimal(billable_units) * fee_config.rate).quantize(Decimal('0.01'))

    return {
        'duration': _format_duration_seconds(record.entry_time, record.exit_time),
        'billable_units': billable_units,
        'fee': fee_amount,
    }


def _normalize_plate_type(raw_value):
    normalized = str(raw_value or '').strip().lower().replace('-', '_').replace(' ', '_')
    if normalized == 'traditional_nepali' or normalized.startswith('traditional'):
        return PLATE_TYPE_TRADITIONAL
    if normalized == 'embossed' or normalized.startswith('emboss'):
        return PLATE_TYPE_EMBOSSED
    return PLATE_TYPE_TRADITIONAL


def _iou(box_a, box_b):
    """Compute intersection-over-union of two (x1, y1, x2, y2) boxes."""
    xa = max(box_a[0], box_b[0])
    ya = max(box_a[1], box_b[1])
    xb = min(box_a[2], box_b[2])
    yb = min(box_a[3], box_b[3])
    inter = max(0, xb - xa) * max(0, yb - ya)
    if inter == 0:
        return 0.0
    area_a = (box_a[2] - box_a[0]) * (box_a[3] - box_a[1])
    area_b = (box_b[2] - box_b[0]) * (box_b[3] - box_b[1])
    return inter / (area_a + area_b - inter)


def _save_plate_to_db(plate: dict):
    """Persist one finalized plate record to the database."""
    tz = timezone.get_current_timezone()
    first_seen = datetime.fromtimestamp(float(plate['first_seen']), tz=tz)
    last_seen = datetime.fromtimestamp(float(plate['last_seen']), tz=tz)

    PlateDetectionHistory.objects.create(
        timestamp=timezone.now(),
        license_plate_text=str(plate['best_text']).strip(),
        confidence=float(plate['best_conf']),
        plate_type=_normalize_plate_type(plate.get('plate_type')),
        first_seen=first_seen,
        last_seen=last_seen,
        frames_detected=max(1, int(plate['frame_count'])),
    )
    logger.info(
        "Plate saved in DB -> %s  (conf=%.4f, type=%s, frames=%d)",
        plate['best_text'], plate['best_conf'], plate['plate_type'], plate['frame_count'],
    )


def _update_tracker(current_detections: list[dict]):
    """
    Match current-frame detections against active plates.

    * Matched plates get their best-confidence record updated.
    * Unmatched active plates that have timed out are flushed to DB.
    * Unmatched new detections start a new active-plate entry.
    """
    now = time.time()

    with _tracker_lock:
        matched_active = set()
        matched_new = set()

        # --- match current detections to existing active plates ---
        for new_idx, det in enumerate(current_detections):
            best_iou = 0.0
            best_active_idx = -1
            for act_idx, act in enumerate(_active_plates):
                if act_idx in matched_active:
                    continue
                score = _iou(det['bbox'], act['bbox'])
                if score > best_iou:
                    best_iou = score
                    best_active_idx = act_idx

            if best_iou >= _IOU_THRESHOLD and best_active_idx >= 0:
                # Update existing plate
                ap = _active_plates[best_active_idx]
                ap['bbox'] = det['bbox']
                ap['last_seen'] = now
                ap['frame_count'] += 1
                if det['confidence'] > ap['best_conf']:
                    ap['best_text'] = det['text']
                    ap['best_conf'] = det['confidence']
                    ap['plate_type'] = det['plate_type']
                matched_active.add(best_active_idx)
                matched_new.add(new_idx)

        # --- flush plates that have exited the frame ---
        remaining = []
        for idx, ap in enumerate(_active_plates):
            if idx in matched_active:
                remaining.append(ap)
            elif now - ap['last_seen'] < _EXIT_TIMEOUT_S:
                remaining.append(ap)
            else:
                # Plate has left - write to DB if we got text and more than 1 frame.
                if ap['best_text'] and ap['frame_count'] > 1:
                    _save_plate_to_db(ap)

        # --- register new detections ---
        for new_idx, det in enumerate(current_detections):
            if new_idx in matched_new:
                continue
            remaining.append({
                'bbox': det['bbox'],
                'best_text': det['text'],
                'best_conf': det['confidence'],
                'plate_type': det['plate_type'],
                'first_seen': now,
                'last_seen': now,
                'frame_count': 1,
            })

        _active_plates.clear()
        _active_plates.extend(remaining)


def flush_active_plates():
    """Flush all remaining active plates to DB (e.g. when the feed stops)."""
    with _tracker_lock:
        for ap in _active_plates:
            if ap['best_text'] and ap['frame_count'] > 1:
                _save_plate_to_db(ap)
        _active_plates.clear()


def parking_monitoring(request):
    """Display the parking lot monitoring dashboard."""
    # Check if user is logged in
    if not request.session.get('user_id'):
        return redirect('login')
    
    # Enforce email verification
    guard = _check_verified(request)
    if guard:
        return guard
    
    return render(request, 'dashboards/parking_monitoring.html')


def _is_admin_session(request):
    return bool(request.session.get('user_id')) and request.session.get('role') == 'admin'


def _admin_guard_or_redirect(request):
    if not request.session.get('user_id'):
        return redirect('login')

    guard = _check_verified(request)
    if guard:
        return guard

    if request.session.get('role') != 'admin':
        messages.error(request, 'Admin access is required for this page.')
        return redirect('user_dashboard')

    return None


def _list_server_video_devices(max_indexes=6):
    devices = []
    for idx in range(max_indexes):
        cap = cv2.VideoCapture(idx)
        if cap.isOpened():
            devices.append({'id': str(idx), 'label': f'Server Camera {idx}'})
        cap.release()
    return devices


def _start_server_feed(runtime, request, feed_name):
    if not _is_admin_session(request):
        return JsonResponse({'error': 'Admin privileges required'}, status=403)

    source_type = request.POST.get('source_type', '').strip().lower()
    if source_type not in {'camera', 'file'}:
        return JsonResponse({'error': 'Invalid source_type. Use camera or file.'}, status=400)

    try:
        if source_type == 'camera':
            camera_index = request.POST.get('camera_index', '').strip()
            if camera_index == '':
                return JsonResponse({'error': 'camera_index is required for camera source'}, status=400)
            source_ref = int(camera_index)
            source_label = request.POST.get('source_label', '').strip() or f'Server Camera {source_ref}'
        else:
            file_obj = request.FILES.get('video_file')
            if not file_obj:
                return JsonResponse({'error': 'video_file is required for file source'}, status=400)
            source_ref = _save_uploaded_video_to_temp(file_obj)
            source_label = file_obj.name

        if feed_name == 'parking':
            close_stale_open_parking_records()
            flush_active_parking_records()

        runtime.start(source_type, source_ref, source_label)
        if feed_name == 'parking':
            _set_parking_public_feed_state(True, source_type=source_type, source_label=source_label)
        return JsonResponse({'status': 'ok', 'active': True, 'source_type': source_type, 'source_label': source_label})
    except Exception as exc:
        return JsonResponse({'error': f'Failed to start {feed_name} source: {exc}'}, status=500)


def _remove_server_feed(runtime, request, feed_name):
    if not _is_admin_session(request):
        return JsonResponse({'error': 'Admin privileges required'}, status=403)

    runtime.stop(clear_latest=True)
    if feed_name == 'parking':
        _set_parking_public_feed_state(False, clear_frame=True)
        flush_active_parking_records()
    if feed_name == 'entry':
        flush_active_plates()
    return JsonResponse({'status': 'ok', 'active': False})


def _server_feed_status(runtime, request):
    if not request.session.get('user_id'):
        return JsonResponse({'error': 'Unauthorized'}, status=401)

    snap = runtime.snapshot()
    return JsonResponse({
        'active': snap['active'],
        'source_type': snap['source_type'],
        'source_label': snap['source_label'],
        'updated_at': snap['updated_at'],
        'error': snap['error'],
    })


def _server_feed_live_frame(runtime, request, include_source_headers=False):
    if not request.session.get('user_id'):
        return JsonResponse({'error': 'Unauthorized'}, status=401)

    snap = runtime.snapshot()
    if not snap['active']:
        return JsonResponse({'active': False, 'waiting_frame': False})

    raw_requested = str(request.GET.get('raw', '')).strip().lower() in {'1', 'true', 'yes'}
    frame_bytes = snap.get('latest_raw_jpeg') if raw_requested else snap.get('latest_jpeg')

    if not frame_bytes:
        return JsonResponse({'active': True, 'waiting_frame': True})

    response = HttpResponse(frame_bytes, content_type='image/jpeg')
    response['Cache-Control'] = 'no-store'
    if include_source_headers:
        response['X-Parking-Source-Type'] = snap['source_type'] or ''
        response['X-Parking-Source-Label'] = snap['source_label'] or ''
    return response


def server_video_devices(request):
    if not request.session.get('user_id'):
        return JsonResponse({'error': 'Unauthorized'}, status=401)
    return JsonResponse({'devices': _list_server_video_devices()})


@require_POST
def start_entry_source(request):
    return _start_server_feed(_entry_server_runtime, request, 'entry')


@require_POST
def remove_entry_source(request):
    return _remove_server_feed(_entry_server_runtime, request, 'entry')


def entry_source_status(request):
    return _server_feed_status(_entry_server_runtime, request)


def entry_live_frame(request):
    return _server_feed_live_frame(_entry_server_runtime, request)


@require_POST
def start_parking_source(request):
    return _start_server_feed(_parking_server_runtime, request, 'parking')


@require_POST
def remove_parking_source(request):
    return _remove_server_feed(_parking_server_runtime, request, 'parking')


def parking_source_status(request):
    return _server_feed_status(_parking_server_runtime, request)


def parking_live_frame(request):
    return _server_feed_live_frame(_parking_server_runtime, request, include_source_headers=True)


def parking_live_metadata(request):
    if not request.session.get('user_id'):
        return JsonResponse({'error': 'Unauthorized'}, status=401)

    snap = _parking_server_runtime.snapshot()
    if not snap['active']:
        return JsonResponse({'active': False, 'waiting_frame': False, 'detections': []})

    meta = snap.get('latest_meta') or {}
    occupancy_stats = meta.get('occupancy_stats') or {
        'total': len(_get_parking_layout_spaces()),
        'occupied': 0,
        'available': len(_get_parking_layout_spaces()),
    }
    return JsonResponse({
        'active': True,
        'waiting_frame': not bool(snap.get('latest_jpeg')),
        'detections': meta.get('detections', []),
        'frame_width': meta.get('frame_width'),
        'frame_height': meta.get('frame_height'),
        'occupancy_stats': occupancy_stats,
        'updated_at': snap.get('updated_at'),
    })


def parking_public_stats(request):
    """Public parking occupancy summary for home page widgets."""
    snap = _parking_server_runtime.snapshot()
    layout_count = len(_get_parking_layout_spaces())

    stats = {
        'total': layout_count,
        'occupied': 0,
        'available': layout_count,
    }

    meta = snap.get('latest_meta') or {}
    occupancy_stats = meta.get('occupancy_stats')
    if isinstance(occupancy_stats, dict):
        stats = {
            'total': int(occupancy_stats.get('total', layout_count) or 0),
            'occupied': int(occupancy_stats.get('occupied', 0) or 0),
            'available': int(occupancy_stats.get('available', layout_count) or 0),
        }

    return JsonResponse({
        'active': bool(snap.get('active')),
        'stats': stats,
        'updated_at': snap.get('updated_at') or 0,
    })


@require_POST
def save_parking_layout(request):
    if not _is_admin_session(request):
        return JsonResponse({'error': 'Admin privileges required'}, status=403)

    try:
        payload = json.loads(request.body.decode('utf-8') or '{}')
    except Exception:
        return JsonResponse({'error': 'Invalid JSON payload'}, status=400)

    spaces = payload.get('spaces', [])
    _set_parking_layout_spaces(spaces)
    return JsonResponse({'status': 'ok', 'count': len(_get_parking_layout_spaces())})


def get_parking_layout(request):
    if not request.session.get('user_id'):
        return JsonResponse({'error': 'Unauthorized'}, status=401)
    return JsonResponse({'spaces': _get_parking_layout_spaces()})


@require_POST
def update_parking_source_state(request):
    """Set parking source active/inactive state from admin dashboard actions."""
    if not request.session.get('user_id'):
        return JsonResponse({'error': 'Unauthorized'}, status=401)

    try:
        payload = json.loads(request.body.decode('utf-8') or '{}')
    except Exception:
        return JsonResponse({'error': 'Invalid JSON payload'}, status=400)

    active = bool(payload.get('active', False))
    source_type = payload.get('source_type')
    source_label = payload.get('source_label')

    if active:
        _set_parking_public_feed_state(True, source_type=source_type, source_label=source_label)
    else:
        _set_parking_public_feed_state(False, clear_frame=True)
        flush_active_parking_records()

    return JsonResponse({'status': 'ok'})


def parking_public_feed_frame(request):
    """Return latest parking frame for user dashboard when admin source is active."""
    if not request.session.get('user_id'):
        return JsonResponse({'error': 'Unauthorized'}, status=401)

    snapshot = _get_parking_public_feed_snapshot()
    if not snapshot['active']:
        return JsonResponse({'active': False, 'source_type': None, 'source_label': None})

    if not snapshot['frame']:
        return JsonResponse({
            'active': True,
            'source_type': snapshot['source_type'],
            'source_label': snapshot['source_label'],
            'waiting_frame': True,
        })

    response = HttpResponse(snapshot['frame'], content_type='image/jpeg')
    response['Cache-Control'] = 'no-store'
    response['X-Parking-Source-Type'] = snapshot['source_type'] or ''
    response['X-Parking-Source-Label'] = snapshot['source_label'] or ''
    return response


@require_POST
def process_entry_frame(request):
    """Process a frame: detect plates, run OCR, track plates, return annotated JPEG."""
    if not request.session.get('user_id'):
        return JsonResponse({'error': 'Unauthorized'}, status=401)

    frame_file = request.FILES.get('frame')
    if not frame_file:
        return JsonResponse({'error': 'Missing frame payload'}, status=400)

    try:
        frame_bytes = frame_file.read()
        np_frame = np.frombuffer(frame_bytes, dtype=np.uint8)
        frame = cv2.imdecode(np_frame, cv2.IMREAD_COLOR)
        if frame is None:
            return JsonResponse({'error': 'Invalid image frame'}, status=400)

        model = _get_license_plate_model()
        with _inference_lock:
            results = model.predict(
                source=frame,
                conf=0.25,
                iou=0.45,
                imgsz=640,
                verbose=False,
                device='cpu',
            )

        # --- OCR on detected plates & feed to tracker ---
        current_detections = []
        boxes = results[0].boxes
        if boxes is not None and len(boxes):
            h, w = frame.shape[:2]
            for box in boxes:
                x1, y1, x2, y2 = map(int, box.xyxy[0].tolist())
                x1, y1 = max(0, x1), max(0, y1)
                x2, y2 = min(w, x2), min(h, y2)
                if x2 <= x1 or y2 <= y1:
                    continue

                bbox = (x1, y1, x2, y2)
                plate_crop = frame[y1:y2, x1:x2]
                try:
                    text, conf, plate_type = recognise_plate(plate_crop)
                except Exception as ocr_exc:
                    logger.warning("OCR failed for a plate region: %s", ocr_exc)
                    text, conf, plate_type = "", 0.0, "unknown"

                current_detections.append({
                    'bbox': bbox,
                    'text': text,
                    'confidence': conf,
                    'plate_type': plate_type,
                })

        _update_tracker(current_detections)

        annotated_frame = _draw_license_plate_boxes(frame, results[0])
        ok, encoded = cv2.imencode(
            '.jpg',
            annotated_frame,
            [int(cv2.IMWRITE_JPEG_QUALITY), 75],
        )
        if not ok:
            return JsonResponse({'error': 'Failed to encode processed frame'}, status=500)

        response = HttpResponse(encoded.tobytes(), content_type='image/jpeg')
        response['Cache-Control'] = 'no-store'
        return response
    except RuntimeError as exc:
        return JsonResponse({'error': str(exc)}, status=500)
    except Exception as exc:
        return JsonResponse({'error': f'Frame processing failed: {exc}'}, status=500)


@require_POST
def process_parking_frame(request):
    """Process a frame through the vehicle model and return JSON detections."""
    if not request.session.get('user_id'):
        return JsonResponse({'error': 'Unauthorized'}, status=401)

    frame_file = request.FILES.get('frame')
    if not frame_file:
        return JsonResponse({'error': 'Missing frame payload'}, status=400)

    try:
        frame_bytes = frame_file.read()
        np_frame = np.frombuffer(frame_bytes, dtype=np.uint8)
        frame = cv2.imdecode(np_frame, cv2.IMREAD_COLOR)
        if frame is None:
            return JsonResponse({'error': 'Invalid image frame'}, status=400)

        model = _get_parking_space_model()
        allowed_class_ids = _get_allowed_vehicle_class_ids(model)

        with _parking_inference_lock:
            results = model.predict(
                source=frame,
                conf=0.50,
                iou=0.45,
                imgsz=640,
                classes=allowed_class_ids,
                verbose=False,
                device='cpu',
            )

        detections = _extract_allowed_vehicle_detections(results[0], allowed_class_ids)
        _set_parking_public_feed_frame(frame)
        return JsonResponse({
            'detections': detections,
            'frame_width': int(frame.shape[1]),
            'frame_height': int(frame.shape[0]),
        })
    except RuntimeError as exc:
        return JsonResponse({'error': str(exc)}, status=500)
    except Exception as exc:
        return JsonResponse({'error': f'Frame processing failed: {exc}'}, status=500)


def user_management(request):
    """Display the user management dashboard."""
    # Check if user is logged in
    if not request.session.get('user_id'):
        return redirect('login')
    
    # Enforce email verification
    guard = _check_verified(request)
    if guard:
        return guard
    
    # Get filter parameters
    search_query = request.GET.get('search', '').strip()
    role_filter = request.GET.get('role', '').strip()
    
    # Start with all users
    users = User.objects.all().order_by('-created_at')
    
    # Apply search filter
    if search_query:
        users = users.filter(
            Q(username__icontains=search_query) |
            Q(email__icontains=search_query) |
            Q(user_id__icontains=search_query)
        )
    
    # Apply role filter
    if role_filter and role_filter != 'all':
        users = users.filter(role=role_filter)
    
    context = {
        'users': users,
        'search_query': search_query,
        'role_filter': role_filter,
    }
    
    return render(request, 'dashboards/user_management.html', context)


def delete_user(request, user_id):
    """Delete a user from the system."""
    # Check if user is logged in and is admin
    if not request.session.get('user_id'):
        return redirect('login')
    
    if request.session.get('role') != 'admin':
        messages.error(request, 'You do not have permission to delete users.')
        return redirect('user_management')
    
    # Prevent deleting yourself
    if request.session.get('user_id') == user_id:
        messages.error(request, 'You cannot delete your own account.')
        return redirect('user_management')
    
    user = get_object_or_404(User, user_id=user_id)
    username = user.username
    user.delete()
    
    messages.success(request, f'User "{username}" has been deleted successfully.')
    return redirect('user_management')


def edit_user(request, user_id):
    """Edit user details (username and role)."""
    # Check if user is logged in and is admin
    if not request.session.get('user_id'):
        return redirect('login')
    
    if request.session.get('role') != 'admin':
        messages.error(request, 'You do not have permission to edit users.')
        return redirect('user_management')
    
    user = get_object_or_404(User, user_id=user_id)
    
    if request.method == 'POST':
        new_username = request.POST.get('username', '').strip()
        new_role = request.POST.get('role')
        
        # Validate inputs
        if not new_username:
            messages.error(request, 'Username cannot be empty.')
            return render(request, 'dashboards/edit_user.html', {'user': user})
        
        # Check for spaces
        if ' ' in new_username:
            messages.error(request, 'Username cannot contain spaces.')
            return render(request, 'dashboards/edit_user.html', {'user': user})
        
        # Username validation (first letter can be uppercase, rest lowercase with numbers, underscore, hyphen)
        if len(new_username) == 0 or not new_username[0].isalpha():
            messages.error(request, 'Username must start with a letter.')
            return render(request, 'dashboards/edit_user.html', {'user': user})
        
        if not all(c.islower() or c.isdigit() or c in '_-' for c in new_username[1:]):
            messages.error(request, 'Username can only contain letters (first letter can be uppercase), numbers, underscore, and hyphen.')
            return render(request, 'dashboards/edit_user.html', {'user': user})
        
        if new_role not in ['admin', 'driver']:
            messages.error(request, 'Invalid role selected.')
            return render(request, 'dashboards/edit_user.html', {'user': user})
        
        # Check if username already exists (excluding current user)
        if new_username != user.username and User.objects.filter(username=new_username).exists():
            messages.error(request, 'Username already exists. Please choose another one.')
            return render(request, 'dashboards/edit_user.html', {'user': user})
        
        # Check if any changes were made
        changes_made = False
        if user.username != new_username:
            user.username = new_username
            changes_made = True
        
        if user.role != new_role:
            user.role = new_role
            changes_made = True
        
        # Only save and show success if changes were made
        if changes_made:
            user.save()
            messages.success(request, f'User details updated successfully.')
        else:
            messages.info(request, 'No changes were made.')
        
        return redirect('edit_user', user_id=user.user_id)
    
    context = {
        'user': user,
    }
    return render(request, 'dashboards/edit_user.html', context)


def parking_records(request):
    """Display the parking records/history dashboard."""
    guard = _admin_guard_or_redirect(request)
    if guard:
        return guard

    vehicle_query = request.GET.get('vehicle', '').strip()
    date_query = request.GET.get('date', '').strip()

    records = ParkingRecord.objects.all().order_by('-entry_time')
    if vehicle_query:
        records = records.filter(
            Q(vehicle_id__icontains=vehicle_query) |
            Q(session_id__icontains=vehicle_query) |
            Q(slot_id__icontains=vehicle_query)
        )

    if date_query:
        try:
            parsed_date = datetime.strptime(date_query, '%Y-%m-%d').date()
            records = records.filter(entry_time__date=parsed_date)
        except ValueError:
            messages.warning(request, 'Invalid date filter. Please use YYYY-MM-DD.')

    return render(request, 'dashboards/parking_records.html', {
        'records': records,
        'vehicle_query': vehicle_query,
        'date_query': date_query,
    })


def parking_fee(request):
    """Allow admin to set fee allocation unit/rate and preview recent session fees."""
    guard = _admin_guard_or_redirect(request)
    if guard:
        return guard

    if request.method == 'POST':
        billing_unit = request.POST.get('billing_unit', '').strip().lower()
        rate_raw = request.POST.get('rate', '').strip()

        valid_units = {
            ParkingFeeConfig.UNIT_MINUTE,
            ParkingFeeConfig.UNIT_HOUR,
            ParkingFeeConfig.UNIT_DAY,
            ParkingFeeConfig.UNIT_MONTH,
        }
        if billing_unit not in valid_units:
            messages.error(request, 'Invalid billing unit selected.')
            return redirect('parking_fee')

        try:
            rate_value = Decimal(rate_raw)
            if rate_value < 0:
                raise ValueError()
            rate_value = rate_value.quantize(Decimal('0.01'))
        except Exception:
            messages.error(request, 'Rate must be a valid non-negative amount.')
            return redirect('parking_fee')

        ParkingFeeConfig.objects.filter(is_active=True).update(is_active=False)
        ParkingFeeConfig.objects.create(
            billing_unit=billing_unit,
            rate=rate_value,
            is_active=True,
        )
        messages.success(request, 'Parking fee settings updated successfully.')
        return redirect('parking_fee')

    fee_config = _get_active_parking_fee_config()
    records = ParkingRecord.objects.all().order_by('-entry_time')[:25]

    recent_sessions = []
    total_recent_fee = Decimal('0.00')
    for record in records:
        fee_data = _calculate_parking_fee_for_record(record, fee_config)
        total_recent_fee += fee_data['fee']
        recent_sessions.append({
            'record': record,
            'duration': fee_data['duration'],
            'billable_units': fee_data['billable_units'],
            'fee': fee_data['fee'],
        })

    return render(request, 'dashboards/parking_fee.html', {
        'fee_config': fee_config,
        'unit_choices': ParkingFeeConfig.BILLING_UNIT_CHOICES,
        'recent_sessions': recent_sessions,
        'total_recent_fee': total_recent_fee,
    })


def plate_detection_history(request):
    """Display all stored plate detections with lightweight filters."""
    guard = _admin_guard_or_redirect(request)
    if guard:
        return guard

    search_query = request.GET.get('plate', '').strip()
    timestamp_query = request.GET.get('timestamp', '').strip()
    plate_type_query = request.GET.get('plate_type', '').strip()

    records = PlateDetectionHistory.objects.all().order_by('-timestamp')
    if search_query:
        records = records.filter(license_plate_text__icontains=search_query)
    if timestamp_query:
        normalized_timestamp = timestamp_query.replace('T', ' ')
        records = records.filter(timestamp__startswith=normalized_timestamp)
    if plate_type_query:
        records = records.filter(plate_type=plate_type_query)

    return render(request, 'dashboards/plate_detection_history.html', {
        'records': records,
        'search_query': search_query,
        'timestamp_query': timestamp_query,
        'plate_type_query': plate_type_query,
        'plate_type_options': PLATE_TYPE_OPTIONS,
    })


def edit_plate_detection_history(request, record_id):
    """Allow admin to edit one plate detection history row."""
    guard = _admin_guard_or_redirect(request)
    if guard:
        return guard

    record = get_object_or_404(PlateDetectionHistory, id=record_id)

    if request.method == 'POST':
        plate_text = request.POST.get('license_plate_text', '').strip()
        plate_type = _normalize_plate_type(request.POST.get('plate_type', '').strip())

        if not plate_text:
            messages.error(request, 'License plate text is required.')
            return render(request, 'dashboards/edit_plate_detection_history.html', {
                'record': record,
                'plate_type_options': PLATE_TYPE_OPTIONS,
            })

        record.license_plate_text = plate_text[:64]
        record.plate_type = plate_type
        record.save(update_fields=[
            'license_plate_text',
            'plate_type',
        ])

        messages.success(request, 'Plate detection record updated successfully.')
        return redirect('plate_detection_history')

    if record.plate_type not in PLATE_TYPE_OPTIONS:
        record.plate_type = _normalize_plate_type(record.plate_type)
        record.save(update_fields=['plate_type'])

    return render(request, 'dashboards/edit_plate_detection_history.html', {
        'record': record,
        'plate_type_options': PLATE_TYPE_OPTIONS,
    })


@require_POST
def delete_plate_detection_history(request, record_id):
    """Allow admin to delete one plate detection history row."""
    guard = _admin_guard_or_redirect(request)
    if guard:
        return guard

    record = get_object_or_404(PlateDetectionHistory, id=record_id)
    record.delete()
    messages.success(request, 'Plate detection record deleted successfully.')
    return redirect('plate_detection_history')


def user_dashboard(request):
    """Display the user dashboard for drivers."""
    # Check if user is logged in
    if not request.session.get('user_id'):
        return redirect('login')
    
    # Enforce email verification
    guard = _check_verified(request)
    if guard:
        return guard
    
    # Get user info from session
    username = request.session.get('username', 'User')

    layout_slot_ids = [
        (space.get('id') or '').strip()
        for space in _get_parking_layout_spaces()
        if (space.get('id') or '').strip()
    ]
    historic_slot_ids = list(
        ParkingRecord.objects.exclude(slot_id='').values_list('slot_id', flat=True).distinct()
    )
    slot_ids = sorted(set(layout_slot_ids + historic_slot_ids))
    
    context = {
        'username': username,
        'slot_ids': slot_ids,
    }
    return render(request, 'dashboards/user_dashboard.html', context)


def user_slot_tracking_status(request):
    """Return latest tracking details for a selected parking slot for drivers."""
    if not request.session.get('user_id'):
        return JsonResponse({'error': 'Unauthorized'}, status=401)

    guard = _check_verified(request)
    if guard:
        return JsonResponse({'error': 'Verification required'}, status=403)

    slot_id = request.GET.get('slot_id', '').strip()
    if not slot_id:
        return JsonResponse({'error': 'slot_id is required'}, status=400)

    active_record = ParkingRecord.objects.filter(
        slot_id=slot_id,
        exit_time__isnull=True,
    ).order_by('-entry_time').first()

    if active_record is not None:
        return JsonResponse({
            'slot_id': slot_id,
            'status': 'In Progress',
            'start_time': _iso_or_none(active_record.entry_time),
            'end_time': None,
            'duration': _format_duration_seconds(active_record.entry_time),
            'session_id': active_record.session_id,
            'vehicle_id': active_record.vehicle_display,
        })

    latest_record = ParkingRecord.objects.filter(slot_id=slot_id).order_by('-entry_time').first()
    if latest_record is not None:
        return JsonResponse({
            'slot_id': slot_id,
            'status': 'Completed',
            'start_time': _iso_or_none(latest_record.entry_time),
            'end_time': _iso_or_none(latest_record.exit_time),
            'duration': _format_duration_seconds(latest_record.entry_time, latest_record.exit_time),
            'session_id': latest_record.session_id,
            'vehicle_id': latest_record.vehicle_display,
        })

    return JsonResponse({
        'slot_id': slot_id,
        'status': 'No Records',
        'start_time': None,
        'end_time': None,
        'duration': '-',
        'session_id': '-',
        'vehicle_id': 'Not Detected',
    })
