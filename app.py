"""Serve the trained Gamified ITS KNN model and the local dashboard."""

from functools import lru_cache
from pathlib import Path

import joblib
import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field
from sklearn.neighbors import KNeighborsClassifier

BASE_DIR = Path(__file__).resolve().parent
MODEL_PATH = BASE_DIR / "model" / "gamified_its_model.joblib"
STATIC_DIR = BASE_DIR / "static"
FEATURES = [
    "quiz_score", "duration_minutes", "attempt_count", "task_difficulty",
    "completion_rate", "accuracy", "streak_days", "engagement_score",
    "hint_count", "feedback_frequency", "game_level",
]
REQUIRED_KEYS = {"model", "scaler", "median_values", "features", "classes", "max_level"}


class QuizInput(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    # None is imputed with the median saved during training.
    quiz_score: float | None = Field(default=None, ge=0, le=100)
    duration_minutes: float | None = Field(default=None, ge=0)
    attempt_count: int | None = Field(default=None, ge=1)
    task_difficulty: int | None = Field(default=None, ge=1, le=5)
    completion_rate: float | None = Field(default=None, ge=0, le=100)
    accuracy: float | None = Field(default=None, ge=0, le=100)
    streak_days: int | None = Field(default=None, ge=0)
    engagement_score: float | None = Field(default=None, ge=0, le=100)
    hint_count: int | None = Field(default=None, ge=0)
    feedback_frequency: int | None = Field(default=None, ge=0)
    game_level: int | None = Field(default=None, ge=1)

    # Context for rewards; these are never passed to the model.
    accumulated_xp: int = Field(default=0, ge=0)
    completed_modules: int = Field(default=0, ge=0)
    total_modules: int = Field(default=4, ge=1)
    completed_quizzes: int = Field(default=0, ge=0)


@lru_cache(maxsize=2)
def _load_bundle(path: str, mtime_ns: int):
    bundle = joblib.load(path)
    if not isinstance(bundle, dict) or not REQUIRED_KEYS.issubset(bundle):
        raise ValueError("Struktur artefak Joblib tidak lengkap.")
    if list(bundle["features"]) != FEATURES:
        raise ValueError("Urutan fitur model berbeda dari kontrak API.")
    if set(bundle["classes"]) != {"Tuntas", "Perlu Remedial"}:
        raise ValueError("Label kelas model tidak dikenal.")
    if not isinstance(bundle["model"], KNeighborsClassifier):
        raise ValueError("Estimator dalam artefak bukan KNN.")
    if not hasattr(bundle["scaler"], "transform"):
        raise ValueError("Scaler dalam artefak tidak valid.")
    if not isinstance(bundle["median_values"], dict) or not all(
        name in bundle["median_values"] for name in FEATURES
    ):
        raise ValueError("Median training untuk beberapa fitur tidak tersedia.")
    if int(bundle["max_level"]) < 1:
        raise ValueError("max_level tidak valid.")
    return bundle


def load_bundle():
    if not MODEL_PATH.is_file():
        raise HTTPException(status_code=503, detail="File model/gamified_its_model.joblib tidak ditemukan.")
    try:
        return _load_bundle(str(MODEL_PATH), MODEL_PATH.stat().st_mtime_ns)
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail="Model gagal dimuat. Periksa artefak Joblib dan versi dependensi.",
        ) from exc


app = FastAPI(title="Gamified ITS: Adaptive Level & Engagement Engine", version="2.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


@app.get("/health")
def health():
    try:
        bundle = load_bundle()
    except HTTPException as exc:
        return {"status": "error", "model_loaded": False, "detail": exc.detail}
    return {
        "status": "ok", "model_loaded": True, "algorithm": "KNN",
        "features": bundle["features"], "max_level": bundle["max_level"],
    }


@app.post("/api/process")
def process_quiz(payload: QuizInput):
    bundle = load_bundle()
    values = payload.model_dump()
    row = {
        name: values[name] if values[name] is not None else bundle["median_values"][name]
        for name in bundle["features"]
    }
    if row["game_level"] > bundle["max_level"]:
        raise HTTPException(status_code=422, detail="game_level melebihi max_level model.")
    if payload.completed_modules > payload.total_modules:
        raise HTTPException(status_code=422, detail="completed_modules melebihi total_modules.")

    try:
        frame = pd.DataFrame([row], columns=bundle["features"])
        scaled = bundle["scaler"].transform(frame)
        status = str(bundle["model"].predict(scaled)[0])
        if status not in bundle["classes"]:
            raise ValueError("Kelas prediksi tidak dikenal.")
        confidence = None
        if hasattr(bundle["model"], "predict_proba"):
            probabilities = bundle["model"].predict_proba(scaled)[0]
            labels = list(bundle["model"].classes_)
            confidence = round(float(probabilities[labels.index(status)]), 4)
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Prediksi KNN gagal. Periksa kompatibilitas artefak model.") from exc

    score = float(row["quiz_score"])
    level = int(row["game_level"])
    unlocked_level = min(
        bundle["max_level"],
        level + (1 if status == "Tuntas" and row["task_difficulty"] >= level else 0),
    )
    earned_xp = max(
        5,
        10 + int(score // 10) * 5 + (20 if status == "Tuntas" else 0)
        + min(int(row["streak_days"]) * 2, 10) - int(row["hint_count"]) * 2,
    )
    total_xp = payload.accumulated_xp + earned_xp
    badges = []
    if payload.completed_quizzes == 0:
        badges.append("Langkah Pertama")
    if score >= 80:
        badges.append("Quick Learner")
    if score == 100:
        badges.append("Sempurna")
    if row["streak_days"] >= 3:
        badges.append("Konsisten")
    if total_xp >= 750:
        badges.append("Level 5")

    if status == "Perlu Remedial":
        recommendation = "Ulangi materi pada level ini, tinjau jawaban salah, lalu coba kuis remedial."
    elif unlocked_level > level:
        recommendation = f"Level {unlocked_level} terbuka. Lanjutkan ke materi dan kuis level berikutnya."
    elif level < bundle["max_level"]:
        recommendation = f"Kuasai kuis level {level} untuk membuka level berikutnya."
    else:
        recommendation = "Seluruh level terbuka. Lanjutkan latihan untuk mempertahankan penguasaan materi."

    return {
        "status": status,
        "quiz_score": round(score, 2),
        "confidence": confidence,
        "xp_earned": earned_xp,
        "total_xp": total_xp,
        "badges": badges,
        "current_level": level,
        "unlocked_level": unlocked_level,
        "next_level": unlocked_level if unlocked_level > level else None,
        "max_level": bundle["max_level"],
        "learning_progress": round(payload.completed_modules / payload.total_modules * 100),
        "recommendation": recommendation,
        "features_used": row,
        "algorithm": "KNN",
    }


app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
