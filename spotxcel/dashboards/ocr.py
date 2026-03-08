"""
PaddleOCR integration for license plate text extraction.

Supports both Nepali traditional plates (Devanagari script)
and embossed plates (English/Latin characters) by running both
OCR models and selecting the result with the highest average
recognition confidence.

Compatible with PaddleOCR v3.4+ (PP-OCRv5 pipeline).
"""

import logging
import os
from threading import Lock

import numpy as np

# Suppress the slow connectivity check on every import / model load
os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")

from paddleocr import PaddleOCR  # noqa: E402 — env var must be set first

logger = logging.getLogger(__name__)

_ocr_en = None
_ocr_dev = None
_ocr_init_lock = Lock()


def _get_ocr_models():
    """Lazily initialise and return (english_ocr, devanagari_ocr) singletons."""
    global _ocr_en, _ocr_dev

    if _ocr_en is not None and _ocr_dev is not None:
        return _ocr_en, _ocr_dev

    with _ocr_init_lock:
        if _ocr_en is not None and _ocr_dev is not None:
            return _ocr_en, _ocr_dev

        logger.info("Loading PaddleOCR English model …")
        _ocr_en = PaddleOCR(
            lang="en",
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
            use_textline_orientation=False,
        )

        logger.info("Loading PaddleOCR Devanagari (Nepali) model …")
        _ocr_dev = PaddleOCR(
            lang="ne",
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
            use_textline_orientation=False,
        )

        return _ocr_en, _ocr_dev


def _extract_text_and_confidence(results):
    """
    Return (merged_text, average_confidence) from a PaddleOCR v3.4 result list.

    If the result is empty or contains no recognised text, returns ("", 0.0).
    """
    if not results:
        return "", 0.0

    result = results[0]
    texts = result.get("rec_texts", [])
    scores = result.get("rec_scores", [])

    if not texts:
        return "", 0.0

    merged = " ".join(texts)
    avg_conf = float(np.mean(scores)) if scores else 0.0
    return merged, avg_conf


def recognise_plate(plate_image: np.ndarray) -> tuple:
    """
    Run OCR on a cropped licence-plate image.

    Returns
    -------
    (text, confidence, plate_type)
        text        – recognised string (may be empty)
        confidence  – average recognition score (0.0 – 1.0)
        plate_type  – "embossed" or "traditional_nepali"
    """
    ocr_en, ocr_dev = _get_ocr_models()

    en_results = ocr_en.predict(plate_image)
    en_text, en_conf = _extract_text_and_confidence(en_results)

    dev_results = ocr_dev.predict(plate_image)
    dev_text, dev_conf = _extract_text_and_confidence(dev_results)

    # Pick whichever model is more confident
    if dev_conf > en_conf and dev_text:
        return dev_text, dev_conf, "traditional_nepali"
    return en_text, en_conf, "embossed"
