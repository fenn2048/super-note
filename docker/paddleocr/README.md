# 中文 OCR 侧车（RapidOCR + ONNXRuntime）

**当前默认方案**：RapidOCR + ONNXRuntime（PP-OCR 系模型）。  
服务名 / 环境变量仍叫 `paddleocr` / `PADDLEOCR_URL`，Super Note 后端无需改。

- 不做大模型推理  
- 典型热路径：数秒～十余秒/张（Intel CPU）  
- 避免官方 `paddlepaddle` 在部分 x86 上 **SIGILL**

## 接口

- `GET /health` → `{ ok, ready, engine: "rapidocr-onnx", ... }`
- `POST /ocr` `{ "image_base64": "..." }` → `{ text, lines, avg_score, engine }`

## 部署机重建（必须 --no-cache）

旧镜像若含 paddle，会继续 SIGILL，务必无缓存重建：

```bash
cd /app/super-note

# 确认依赖
grep rapidocr docker/paddleocr/requirements.txt

docker compose stop paddleocr 2>/dev/null || true
docker rm -f super-note-paddleocr 2>/dev/null || true
docker rmi super-note-paddleocr:latest 2>/dev/null || true

docker compose build --no-cache paddleocr
docker compose up -d paddleocr
docker logs -f super-note-paddleocr
```

成功日志应有：

```text
RapidOCR ready
```

```bash
curl -s http://127.0.0.1:8868/health
# "engine":"rapidocr-onnx","ready":true
```

## Super Note

```env
PADDLEOCR_URL=http://paddleocr:8868
HEALTH_OCR_ENGINE=paddle
```

`HEALTH_OCR_ENGINE=paddle` 表示「走侧车 OCR」，不是再装 Paddle C++。
