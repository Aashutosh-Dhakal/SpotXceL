from django.shortcuts import render, redirect, get_object_or_404
from django.contrib import messages
from django.db.models import Q
from django.http import JsonResponse, HttpResponse
from django.views.decorators.http import require_POST
from django.conf import settings
from pathlib import Path
from threading import Lock
import csv
import logging
import time

import cv2
import numpy as np
from ultralytics import YOLO

from accounts.models import User
from dashboards.ocr import recognise_plate

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

PARKING_MODEL_PATH = Path(settings.BASE_DIR) / 'models' / 'VehicleAndParkingSpaceDetection' / 'my_model.pt'
_parking_model = None
_parking_model_load_error = None
_parking_model_init_lock = Lock()
_parking_inference_lock = Lock()


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


# ---------------------------------------------------------------------------
#  Plate tracking & CSV logging
# ---------------------------------------------------------------------------

CSV_PATH = Path(settings.BASE_DIR) / 'plate_detections.csv'
_csv_lock = Lock()

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
# Only re-run OCR on already-tracked plates every N frames.
_OCR_RERUN_EVERY_N = 5


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


def _ensure_csv_header():
    """Create the CSV file with headers if it doesn't exist yet."""
    if CSV_PATH.exists():
        return
    with open(CSV_PATH, 'w', newline='', encoding='utf-8') as f:
        writer = csv.writer(f)
        writer.writerow([
            'timestamp',
            'license_plate_text',
            'confidence',
            'plate_type',
            'first_seen',
            'last_seen',
            'frames_detected',
        ])


def _write_plate_to_csv(plate: dict):
    """Append one finalised plate record to the CSV file."""
    _ensure_csv_header()
    with _csv_lock:
        with open(CSV_PATH, 'a', newline='', encoding='utf-8') as f:
            writer = csv.writer(f)
            writer.writerow([
                time.strftime('%Y-%m-%d %H:%M:%S'),
                plate['best_text'],
                f"{plate['best_conf']:.4f}",
                plate['plate_type'],
                time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(plate['first_seen'])),
                time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(plate['last_seen'])),
                plate['frame_count'],
            ])
    logger.info(
        "Plate saved → %s  (conf=%.4f, type=%s, frames=%d)",
        plate['best_text'], plate['best_conf'], plate['plate_type'], plate['frame_count'],
    )


def _update_tracker(current_detections: list[dict]):
    """
    Match current-frame detections against active plates.

    * Matched plates get their best-confidence record updated.
    * Unmatched active plates that have timed out are flushed to CSV.
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
                # Plate has left — write to CSV if we got text AND more than 1 frame
                if ap['best_text'] and ap['frame_count'] > 1:
                    _write_plate_to_csv(ap)

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
        # To reduce latency, only run OCR on NEW plates (no IoU match).
        # Already-tracked plates re-run OCR every _OCR_RERUN_EVERY_N frames.
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

                # Check if this plate is already being tracked
                matched_ap = None
                with _tracker_lock:
                    for ap in _active_plates:
                        if _iou(bbox, ap['bbox']) >= _IOU_THRESHOLD:
                            matched_ap = ap
                            break

                run_ocr = True
                if matched_ap is not None and matched_ap['best_text']:
                    # Already tracked with OCR data — skip unless it's time to re-run
                    if matched_ap['frame_count'] % _OCR_RERUN_EVERY_N != 0:
                        run_ocr = False

                if run_ocr:
                    plate_crop = frame[y1:y2, x1:x2]
                    try:
                        text, conf, plate_type = recognise_plate(plate_crop)
                    except Exception as ocr_exc:
                        logger.warning("OCR failed for a plate region: %s", ocr_exc)
                        text, conf, plate_type = "", 0.0, "unknown"
                else:
                    text, conf, plate_type = "", 0.0, matched_ap['plate_type'] if matched_ap else "unknown"

                current_detections.append({
                    'bbox': bbox,
                    'text': text,
                    'confidence': conf,
                    'plate_type': plate_type,
                })

        _update_tracker(current_detections)

        annotated_frame = results[0].plot(labels=False, conf=False)
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
    """Process a frame through the vehicle and parking space model and return annotated JPEG."""
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
        with _parking_inference_lock:
            results = model.predict(
                source=frame,
                conf=0.25,
                iou=0.45,
                imgsz=640,
                verbose=False,
                device='cpu',
            )

        annotated_frame = results[0].plot(labels=False, conf=False)
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
    # Check if user is logged in
    if not request.session.get('user_id'):
        return redirect('login')
    
    # Enforce email verification
    guard = _check_verified(request)
    if guard:
        return guard
    
    return render(request, 'dashboards/parking_records.html')


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
    
    context = {
        'username': username,
    }
    return render(request, 'dashboards/user_dashboard.html', context)
