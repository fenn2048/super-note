# Super Note — 中文 OCR 侧车（RapidOCR + ONNXRuntime）
# 不安装 paddlepaddle，避免在较老 Intel / Ubuntu 上 SIGILL
FROM python:3.10-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    OCR_LANG=ch \
    USE_ANGLE_CLS=true \
    CPU_THREADS=4 \
    PORT=8868 \
    OMP_NUM_THREADS=4 \
    ORT_NUM_THREADS=4 \
    HOME=/root

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
      libgomp1 \
      libgl1 \
      libglib2.0-0 \
      curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --upgrade pip \
    && pip install -r requirements.txt \
    && python -c "from rapidocr_onnxruntime import RapidOCR; print('rapidocr import ok')"

COPY app.py .

EXPOSE 8868

HEALTHCHECK --interval=30s --timeout=10s --start-period=90s --retries=5 \
  CMD curl -fsS http://127.0.0.1:8868/health || exit 1

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8868", "--workers", "1"]
