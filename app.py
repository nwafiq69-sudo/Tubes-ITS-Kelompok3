from functools import lru_cache
from pathlib import Path
from typing import Literal

import joblib
import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field


BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
MODEL_PATH = BASE_DIR / "model" / "model_kelompok_3.joblib"

NUMERIC_FEATURES = [
    "total_events",
    "quiz_started",
    "quiz_submitted",
    "quiz_viewed",
    "quiz_reviewed",
    "quiz_module_viewed",
    "assignment_events",
    "learning_material_events",
    "forum_events",
    "active_days",
    "active_span_days",
    "unique_activity_types",
    "submit_rate",
]

ACTIVITY_TYPES = Literal[
    "Kuis", "Tugas", "Materi Belajar", "Forum", "Navigasi Kursus", "Aktivitas Lain"
]


class PredictPayload(BaseModel):
    """Validasi tepat 14 fitur yang dipakai saat training pipeline ITS."""

    total_events: int = Field(ge=0)
    quiz_started: int = Field(ge=0)
    quiz_submitted: int = Field(ge=0)
    quiz_viewed: int = Field(ge=0)
    quiz_reviewed: int = Field(ge=0)
    quiz_module_viewed: int = Field(ge=0)
    assignment_events: int = Field(ge=0)
    learning_material_events: int = Field(ge=0)
    forum_events: int = Field(ge=0)
    active_days: int = Field(ge=0)
    active_span_days: float = Field(ge=0)
    unique_activity_types: int = Field(ge=0)
    submit_rate: float = Field(ge=0, le=1)
    dominant_activity_type: ACTIVITY_TYPES


@lru_cache(maxsize=2)
def _load_model(path: str, modified_at: float):
    # mtime as a cache key permits replacing the model without restarting Uvicorn.
    return joblib.load(path)


def load_model():
    if not MODEL_PATH.is_file():
        raise HTTPException(
            status_code=503,
            detail="Model Joblib belum tersedia. Prediksi akan aktif setelah model_kelompok_3.joblib diletakkan di folder model/.",
        )
    try:
        return _load_model(str(MODEL_PATH), MODEL_PATH.stat().st_mtime)
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail="Model gagal dimuat. Periksa file Joblib dan kompatibilitas versi scikit-learn.",
        ) from exc


app = FastAPI(
    title="Gamified ITS: Adaptif Level & Engagement Engine",
    description="Analisis status belajar dengan pipeline KNN/JST-MLP dari Joblib.",
    version="1.0.0",
)


@app.get("/health")
def health():
    return {"status": "ok", "model_available": MODEL_PATH.is_file()}


def run_prediction(payload: PredictPayload):
    model = load_model()
    values = payload.model_dump()
    row = {feature: values[feature] for feature in NUMERIC_FEATURES}
    row["dominant_activity_type"] = values["dominant_activity_type"]
    frame = pd.DataFrame([row], columns=NUMERIC_FEATURES + ["dominant_activity_type"])

    try:
        class_id = int(model.predict(frame)[0])
        estimator = model.steps[-1][1] if hasattr(model, "steps") else model
        estimator_name = estimator.__class__.__name__
        algorithm = {
            "KNeighborsClassifier": "KNN",
            "MLPClassifier": "JST/MLP",
        }.get(estimator_name, estimator_name)

        confidence = None
        if hasattr(model, "predict_proba"):
            probabilities = model.predict_proba(frame)[0]
            classes = list(getattr(model, "classes_", range(len(probabilities))))
            if class_id in classes:
                confidence = round(float(probabilities[classes.index(class_id)]), 4)
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail="Pipeline tidak dapat memproses fitur. Pastikan model berasal dari notebook ITS dan kompatibel dengan versi library.",
        ) from exc

    if class_id not in (0, 1):
        raise HTTPException(status_code=500, detail="Model mengembalikan kelas di luar label 0/1.")

    status = "Perlu Remedial" if class_id == 1 else "Tuntas"
    return {
        "class_id": class_id,
        "status": status,
        "algorithm": algorithm,
        "confidence": confidence,
        "confidence_label": "Probabilitas untuk kelas prediksi; bukan kepastian." if confidence is not None else None,
        "activity_summary": values,
    }


@app.post("/api/predict")
def predict(payload: PredictPayload):
    return run_prediction(payload)


@app.post("/api/process")
def process(payload: PredictPayload):
    return run_prediction(payload)


@app.get("/api/analytics")
def analytics():
    # The browser owns quiz history and gamification state; no server persistence is used.
    return {
        "storage": "localStorage",
        "model_available": MODEL_PATH.is_file(),
        "note": "Riwayat analitik dibaca dari localStorage pada browser pengguna.",
        "features": NUMERIC_FEATURES + ["dominant_activity_type"],
    }


@app.get("/api/recommendations")
def recommendations(status: Literal["Tuntas", "Perlu Remedial"] | None = None):
    if status is None:
        return {"available": False, "message": "Jalankan analisis model untuk mendapatkan rekomendasi adaptif."}
    if status == "Perlu Remedial":
        return {
            "available": True,
            "status": status,
            "title": "Perkuat materi dasar",
            "message": "Ulangi materi yang berkaitan, kerjakan kuis remedial, lalu tinjau kembali hasil belajarmu.",
        }
    return {
        "available": True,
        "status": status,
        "title": "Lanjut ke tantangan berikutnya",
        "message": "Lanjutkan ke materi berikutnya dan coba latihan dengan tingkat kesulitan lebih tinggi.",
    }


app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
