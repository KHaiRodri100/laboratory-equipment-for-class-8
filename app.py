import io
import json
import os
import unicodedata
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, Request, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image, UnidentifiedImageError

load_dotenv()
ROOT = Path(__file__).resolve().parent
WEB = ROOT / "web"
LESSONS = json.loads((ROOT / "data" / "lessons.json").read_text(encoding="utf-8"))
app = FastAPI(title="Phòng thực hành KHTN 8")
app.mount("/static", StaticFiles(directory=WEB), name="static")


def normalized(value: str) -> str:
    value = unicodedata.normalize("NFD", value.lower())
    return "".join(c for c in value if unicodedata.category(c) != "Mn").replace("đ", "d").strip()


@lru_cache(maxsize=1)
def get_model():
    from ultralytics import YOLO

    path = Path(os.getenv("MODEL_PATH", "./my_custom_yolo11_model.pt"))
    if not path.is_absolute():
        path = ROOT / path
    if not path.is_file():
        raise FileNotFoundError(f"Không tìm thấy mô hình: {path}")
    return YOLO(str(path))


def candidate_lessons(labels: list[str]) -> list[dict]:
    found = []
    for lesson in LESSONS["lessons"]:
        aliases = [normalized(a) for a in lesson["equipment_aliases"]]
        if any(normalized(label) in aliases for label in labels):
            found.append(lesson)
    return found


def safe_fallback(lesson: dict, labels: list[str], reason: str) -> dict:
    return {
        "status": "matched_without_gemini",
        "title": lesson["title"],
        "reason": f"Dụng cụ nhận diện được: {', '.join(labels)}. {reason}",
        "objective": lesson["objective"],
        "steps": lesson["steps"],
        "safety": lesson["safety"],
        "source": lesson["source"],
        "data_status": LESSONS["status"],
    }


def lesson_suggestion(labels: list[str]) -> dict:
    if not labels:
        return {"status": "no_detection", "message": "Chưa thấy dụng cụ. Hãy chụp rõ hơn, đủ sáng và đưa dụng cụ vào giữa ảnh."}
    candidates = candidate_lessons(labels)
    if not candidates:
        return {"status": "no_match", "message": "Chưa tìm thấy bài thực hành phù hợp trong dữ liệu hiện có.", "data_status": LESSONS["status"]}
    lesson = candidates[0]
    if not os.getenv("GEMINI_API_KEY"):
        return safe_fallback(lesson, labels, "Chưa cấu hình Gemini; nội dung lấy từ dữ liệu minh họa.")
    try:
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
        prompt = (
            "Bạn hỗ trợ học sinh lớp 8. Chỉ dùng dữ liệu JSON sau. "
            "Chọn đúng một lesson.id trong candidates; không thêm bước, mục tiêu hay quy tắc an toàn mới. "
            "Viết reason tiếng Việt ngắn gọn dựa trên nhãn dụng cụ. "
            "Trả JSON gồm lesson_id và reason. Nếu không phù hợp, lesson_id là null.\n"
            + json.dumps({"detected_labels": labels, "candidates": candidates}, ensure_ascii=False)
        )
        response = client.models.generate_content(
            model=os.getenv("GEMINI_MODEL", "gemini-2.5-flash"),
            contents=prompt,
            config=types.GenerateContentConfig(response_mime_type="application/json"),
        )
        choice = json.loads(response.text or "{}")
        selected = next((x for x in candidates if x["id"] == choice.get("lesson_id")), None)
        if selected is None:
            return {"status": "no_match", "message": "Gemini chưa chọn được bài phù hợp từ dữ liệu hiện có.", "data_status": LESSONS["status"]}
        result = safe_fallback(selected, labels, "")
        result["status"] = "matched_with_gemini"
        result["reason"] = str(choice.get("reason", ""))[:300] or result["reason"]
        return result
    except Exception:
        return safe_fallback(lesson, labels, "Gemini tạm thời không khả dụng; nội dung lấy từ dữ liệu minh họa.")


@app.get("/")
def dashboard():
    return FileResponse(WEB / "index.html")


@app.get("/about")
def about():
    return FileResponse(WEB / "about.html")


@app.get("/api/health")
def health():
    return {"status": "ok", "model_path": os.getenv("MODEL_PATH", "./my_custom_yolo11_model.pt"), "gemini_configured": bool(os.getenv("GEMINI_API_KEY"))}


@app.post("/api/analyze")
async def analyze(file: UploadFile = File(...)):
    if file.content_type not in {"image/jpeg", "image/png", "image/webp"}:
        raise HTTPException(415, "Chỉ nhận ảnh JPG, PNG hoặc WebP.")
    limit = int(os.getenv("MAX_UPLOAD_MB", "10")) * 1024 * 1024
    raw = await file.read(limit + 1)
    if len(raw) > limit:
        raise HTTPException(413, "Ảnh vượt quá dung lượng cho phép.")
    try:
        image = Image.open(io.BytesIO(raw))
        image.load()
        image = image.convert("RGB")
        if image.width * image.height > 20_000_000:
            raise HTTPException(413, "Kích thước ảnh quá lớn.")
    except (UnidentifiedImageError, OSError, ValueError):
        raise HTTPException(400, "Không đọc được ảnh. Hãy chọn ảnh khác.")
    try:
        model = get_model()
        result = model.predict(image, conf=float(os.getenv("CONFIDENCE_THRESHOLD", "0.25")), verbose=False)[0]
        detections = []
        if result.boxes is not None:
            for box in result.boxes:
                class_id = int(box.cls.item())
                detections.append({
                    "label": str(result.names[class_id]),
                    "confidence": round(float(box.conf.item()), 3),
                    "box": [round(float(x), 1) for x in box.xyxy[0].tolist()],
                })
    except Exception as exc:
        raise HTTPException(503, f"Không thể chạy mô hình nhận diện: {exc}") from exc
    labels = sorted({item["label"] for item in detections})
    return {"width": image.width, "height": image.height, "detections": detections, "labels": labels, "suggestion": lesson_suggestion(labels), "data_notice": LESSONS["notice"]}
