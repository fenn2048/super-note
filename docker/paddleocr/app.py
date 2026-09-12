#!/usr/bin/env python3
"""
Super Note — 中文 OCR HTTP 侧车
引擎：RapidOCR + ONNXRuntime（PP-OCR 模型，不依赖 paddlepaddle）

POST /ocr  { "image_base64": "...", "lang": "ch" }
GET  /health
"""
from __future__ import annotations

import base64
import io
import logging
import os
import threading
from typing import Any

import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from PIL import Image
from pydantic import BaseModel, Field

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("ocr-sidecar")

OCR_LANG = os.environ.get("OCR_LANG", "ch")
USE_ANGLE_CLS = os.environ.get("USE_ANGLE_CLS", "true").lower() in ("1", "true", "yes")
CPU_THREADS = int(os.environ.get("CPU_THREADS", "4") or "4")
PORT = int(os.environ.get("PORT", "8868") or "8868")
ENGINE_ID = "rapidocr-onnx"

app = FastAPI(title="super-note-ocr", version="1.3.0-rapidocr")

_ocr_lock = threading.Lock()
_ocr = None
_ocr_error: str | None = None


def get_ocr():
    global _ocr, _ocr_error
    if _ocr is not None:
        return _ocr
    if _ocr_error:
        raise RuntimeError(_ocr_error)
    with _ocr_lock:
        if _ocr is not None:
            return _ocr
        try:
            os.environ.setdefault("OMP_NUM_THREADS", str(max(1, CPU_THREADS)))
            os.environ.setdefault("MKL_NUM_THREADS", str(max(1, CPU_THREADS)))
            os.environ.setdefault("ORT_NUM_THREADS", str(max(1, CPU_THREADS)))

            from rapidocr_onnxruntime import RapidOCR

            log.info(
                "Loading RapidOCR (onnxruntime) lang=%s angle_cls=%s threads=%s",
                OCR_LANG,
                USE_ANGLE_CLS,
                CPU_THREADS,
            )
            _ocr = RapidOCR()
            log.info("RapidOCR ready")
            return _ocr
        except Exception as e:
            _ocr_error = f"OCR 引擎初始化失败: {e}"
            log.exception(_ocr_error)
            raise RuntimeError(_ocr_error) from e


class OcrRequest(BaseModel):
    image_base64: str = Field(..., description="原始或 data-url base64")
    lang: str | None = Field(default=None, description="预留")


def _decode_image(b64: str) -> np.ndarray:
    raw = (b64 or "").strip()
    if "," in raw and raw.lower().startswith("data:"):
        raw = raw.split(",", 1)[1]
    try:
        data = base64.b64decode(raw, validate=False)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"无效 base64: {e}") from e
    if not data:
        raise HTTPException(status_code=400, detail="空图片数据")
    if len(data) > 20 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="图片过大（>20MB）")
    try:
        img = Image.open(io.BytesIO(data))
        img = img.convert("RGB")
        return np.array(img)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"无法解码图片: {e}") from e


def _run_ocr(arr: np.ndarray) -> dict[str, Any]:
    ocr = get_ocr()
    # RapidOCR: result, elapse = engine(img)
    # result: list of [box, text, score] 或 None
    result, _elapse = ocr(arr)

    lines: list[dict[str, Any]] = []
    texts: list[str] = []
    scores: list[float] = []

    for item in result or []:
        if not item or len(item) < 2:
            continue
        if isinstance(item, dict):
            text = str(item.get("text") or item.get("txt") or "").strip()
            score = float(item.get("score") or item.get("confidence") or 0.0)
            box = item.get("box") or item.get("dt_boxes")
        else:
            box = item[0] if len(item) > 0 else None
            text = str(item[1]).strip() if len(item) > 1 else ""
            score = float(item[2]) if len(item) > 2 and item[2] is not None else 0.0
        if not text:
            continue
        lines.append({"text": text, "score": score, "box": box})
        texts.append(text)
        scores.append(score)

    full = "\n".join(texts)
    avg = sum(scores) / len(scores) if scores else 0.0
    return {
        "text": full,
        "lines": lines,
        "line_count": len(lines),
        "avg_score": round(avg, 4),
        "engine": ENGINE_ID,
        "lang": OCR_LANG,
    }


@app.on_event("startup")
def _warmup():
    try:
        get_ocr()
    except Exception:
        log.warning("warmup failed; will retry on first /ocr")


@app.get("/health")
def health():
    return {
        "ok": True,
        "ready": _ocr is not None,
        "error": _ocr_error,
        "lang": OCR_LANG,
        "engine": ENGINE_ID,
    }


@app.post("/ocr")
def ocr_endpoint(body: OcrRequest):
    arr = _decode_image(body.image_base64)
    try:
        with _ocr_lock:
            out = _run_ocr(arr)
    except HTTPException:
        raise
    except Exception as e:
        log.exception("ocr failed")
        raise HTTPException(status_code=500, detail=f"OCR 失败: {e}") from e

    if not (out.get("text") or "").strip():
        return JSONResponse(
            status_code=422,
            content={
                "error": "未识别到文字",
                "text": "",
                "lines": [],
                "engine": ENGINE_ID,
            },
        )
    return out


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=PORT, workers=1)
