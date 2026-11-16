"""Gamified ITS API, SQLite-backed quiz tracking, and KNN predictions."""

from __future__ import annotations

import json
import hashlib
import hmac
import os
import secrets
import sqlite3
import uuid
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal
from zoneinfo import ZoneInfo

import joblib
import pandas as pd
from fastapi import FastAPI, HTTPException, Request
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator
from sklearn.neighbors import KNeighborsClassifier

BASE_DIR = Path(__file__).resolve().parent
MODEL_PATH = BASE_DIR / "model" / "gamified_its_model.joblib"
DB_PATH = BASE_DIR / "gamified_its.sqlite3"
STATIC_DIR = BASE_DIR / "static"
FEATURES = [
    "quiz_score", "duration_minutes", "attempt_count", "task_difficulty",
    "completion_rate", "accuracy", "streak_days", "engagement_score",
    "hint_count", "feedback_frequency", "game_level",
]
REQUIRED_KEYS = {"model", "scaler", "median_values", "features", "classes", "max_level"}
NOW_SQL = "strftime('%Y-%m-%dT%H:%M:%fZ','now')"
app = FastAPI(title="Gamified ITS: Adaptif Level & Engagement Engine", version="4.0.0")


class QuizInput(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
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
    accumulated_xp: int = Field(default=0, ge=0)
    completed_modules: int = Field(default=0, ge=0)
    total_modules: int = Field(default=4, ge=1)
    completed_quizzes: int = Field(default=0, ge=0)


class StartAttempt(BaseModel):
    model_config = ConfigDict(extra="forbid")
    quiz_id: int = Field(gt=0)


class MaterialComplete(BaseModel):
    model_config = ConfigDict(extra="forbid")
    module_id: Literal["m1", "m2", "m3", "m4"]


class Registration(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=2, max_length=80)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    role: Literal["admin", "student"]
    admin_code: str | None = Field(default=None, max_length=100)


class Login(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)
    role: Literal["admin", "student"]




class AnswerItem(BaseModel):
    question_id: int = Field(gt=0)
    answer_index: int | None = Field(default=None, ge=0, le=5)
    hint_used: bool = False


class SubmitAttempt(BaseModel):
    model_config = ConfigDict(extra="forbid")
    answers: list[AnswerItem] = Field(min_length=1, max_length=50)


class QuestionActivity(BaseModel):
    model_config = ConfigDict(extra="forbid")
    attempt_id: str = Field(min_length=20, max_length=64)
    question_id: int = Field(gt=0)


class NewQuestion(BaseModel):
    model_config = ConfigDict(extra="forbid")
    prompt: str = Field(min_length=5, max_length=500)
    options: list[str] = Field(min_length=2, max_length=6)
    correct_index: int = Field(ge=0, le=5)
    hint: str = Field(min_length=2, max_length=300)
    explanation: str = Field(min_length=5, max_length=1200)

    @field_validator("options")
    @classmethod
    def valid_options(cls, value: list[str]) -> list[str]:
        value = [x.strip() for x in value]
        if any(not x for x in value):
            raise ValueError("Pilihan jawaban tidak boleh kosong.")
        if len(set(value)) != len(value):
            raise ValueError("Pilihan jawaban harus berbeda.")
        return value

    @field_validator("correct_index")
    @classmethod
    def index_in_options(cls, value: int, info):
        options = info.data.get("options")
        if options is not None and value >= len(options):
            raise ValueError("Kunci jawaban harus menunjuk pilihan yang tersedia.")
        return value


class NewQuiz(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=3, max_length=120)
    topic: str = Field(min_length=2, max_length=80)
    duration_minutes: Literal[10] = 10
    questions: list[NewQuestion] = Field(min_length=10, max_length=10)

    @field_validator("title", "topic")
    @classmethod
    def trim_text(cls, value: str) -> str:
        return value.strip()


SEED_QUESTIONS = [
    ("Apa tujuan utama data preprocessing?", ["Menyiapkan data untuk analisis/model", "Menghapus semua data", "Mengganti target secara acak", "Menjamin model selalu benar"], 0, "Pikirkan tahap persiapan sebelum data masuk ke algoritma.", "Preprocessing membersihkan dan mentransformasikan data agar format dan skalanya sesuai untuk analisis atau pelatihan model. Tahap ini dapat mencakup imputasi nilai kosong, encoding kategori, dan scaling."),
    ("Apa yang dimaksud fitur dalam dataset?", ["Atribut masukan yang menggambarkan observasi", "Nama file model", "Nilai jawaban akhir saja", "Jenis basis data"], 0, "Fitur menjadi variabel masukan untuk model.", "Fitur adalah kolom prediktor yang memberi informasi tentang observasi. Model menggunakan fitur untuk memperkirakan target atau label."),
    ("Mengapa data latih dan data uji dipisahkan?", ["Mengukur generalisasi pada data yang tidak dilatih", "Memperbanyak label", "Menghilangkan preprocessing", "Menaikkan nilai otomatis"], 0, "Data uji seharusnya tidak digunakan saat fitting.", "Data latih dipakai untuk mempelajari pola. Data uji yang tidak ikut fitting memberi gambaran lebih jujur tentang kinerja pada data baru."),
    ("Bagaimana KNN menentukan kelas data baru?", ["Melihat kelas tetangga terdekat", "Mengurutkan nama fitur", "Memilih kelas paling jarang", "Mengabaikan jarak"], 0, "KNN memakai kedekatan antarobservasi.", "KNN menghitung jarak dari data baru ke data latih, memilih k tetangga terdekat, lalu menentukan kelas melalui voting tetangga."),
    ("Apa arti parameter k pada KNN?", ["Jumlah tetangga yang dipertimbangkan", "Jumlah kolom target", "Kecepatan internet", "Jumlah dataset uji"], 0, "Nilai k menentukan banyak tetangga yang ikut voting.", "Parameter k adalah jumlah tetangga terdekat untuk proses voting. Nilai k terlalu kecil dapat sensitif terhadap noise, sedangkan nilai terlalu besar dapat menghaluskan batas kelas berlebihan."),
    ("Mengapa penskalaan fitur penting untuk KNN?", ["Skala besar dapat mendominasi perhitungan jarak", "KNN hanya menerima teks", "Agar label berubah", "Untuk menghapus data uji"], 0, "Jarak sensitif terhadap satuan dan rentang nilai.", "KNN bergantung pada jarak. Tanpa scaling, fitur berskala besar dapat memberi kontribusi lebih dominan meski secara konteks tidak lebih penting."),
    ("MLP merupakan salah satu jenis...", ["Jaringan saraf tiruan berlapis", "Basis data relasional", "Metode pengurutan", "Visualisasi peta"], 0, "MLP memiliki lapisan neuron yang saling terhubung.", "Multi-Layer Perceptron adalah jaringan saraf dengan lapisan masukan, satu atau lebih lapisan tersembunyi, dan lapisan keluaran. Bobot dipelajari dari data."),
    ("Apa fungsi data validasi?", ["Membantu memilih konfigurasi model", "Menjadi nama kelas keluaran", "Menghapus data pelatihan", "Menggantikan semua evaluasi"], 0, "Data ini membantu keputusan selama pengembangan model.", "Data validasi membantu memilih hyperparameter atau konfigurasi selama pengembangan. Data uji sebaiknya disimpan untuk evaluasi akhir yang tidak bias."),
    ("Confidence prediksi sebaiknya dipahami sebagai...", ["Probabilitas model, bukan kepastian", "Jaminan nilai akademik", "Jumlah XP", "Akurasi universal model"], 0, "Keluaran model tetap memiliki ketidakpastian.", "Confidence menggambarkan probabilitas atau keyakinan model untuk kelas yang dipilih. Nilai itu bukan jaminan bahwa prediksi pasti benar."),
    ("Apa yang sebaiknya dilakukan setelah mendapat hasil Perlu Remedial?", ["Meninjau materi dan jawaban yang salah", "Mengabaikan hasil", "Menghapus nilai", "Menaikkan level manual"], 0, "Gunakan hasil untuk menentukan materi penguatan.", "Gunakan hasil sebagai petunjuk belajar: periksa jawaban yang salah, pelajari ulang konsep terkait, lalu coba latihan lagi untuk melihat perkembangan."),
]


def connect() -> sqlite3.Connection:
    db = sqlite3.connect(DB_PATH, timeout=15)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")
    return db


def init_db() -> None:
    with connect() as db:
        db.executescript("""
            CREATE TABLE IF NOT EXISTS students (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT NOT NULL UNIQUE COLLATE NOCASE,
                name TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
            );
            CREATE TABLE IF NOT EXISTS accounts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT NOT NULL UNIQUE COLLATE NOCASE,
                name TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL CHECK(role IN ('admin','student')),
                student_id INTEGER UNIQUE REFERENCES students(id) ON DELETE CASCADE,
                created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
                CHECK((role='student' AND student_id IS NOT NULL) OR (role='admin' AND student_id IS NULL))
            );
            CREATE TABLE IF NOT EXISTS auth_sessions (
                token_hash TEXT PRIMARY KEY,
                account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
                expires_at TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
            );
            CREATE TABLE IF NOT EXISTS student_streaks (
                student_id INTEGER PRIMARY KEY REFERENCES students(id) ON DELETE CASCADE,
                current_streak INTEGER NOT NULL DEFAULT 0,
                best_streak INTEGER NOT NULL DEFAULT 0,
                last_activity_at TEXT
            );
            CREATE TABLE IF NOT EXISTS streak_days (
                student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
                activity_date TEXT NOT NULL,
                questions_answered INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY(student_id,activity_date)
            );
            CREATE TABLE IF NOT EXISTS achievements (
                student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
                achievement_id TEXT NOT NULL,
                earned_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
                PRIMARY KEY(student_id,achievement_id)
            );
            CREATE TABLE IF NOT EXISTS quizzes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                topic TEXT NOT NULL,
                duration_seconds INTEGER NOT NULL,
                active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
            );
            CREATE TABLE IF NOT EXISTS questions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                quiz_id INTEGER NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
                position INTEGER NOT NULL,
                prompt TEXT NOT NULL,
                options_json TEXT NOT NULL,
                correct_index INTEGER NOT NULL,
                hint TEXT NOT NULL,
                explanation TEXT NOT NULL DEFAULT '',
                UNIQUE(quiz_id, position)
            );
            CREATE TABLE IF NOT EXISTS attempts (
                id TEXT PRIMARY KEY,
                student_id INTEGER NOT NULL REFERENCES students(id),
                quiz_id INTEGER NOT NULL REFERENCES quizzes(id),
                started_at TEXT NOT NULL,
                submitted_at TEXT,
                duration_seconds INTEGER,
                score INTEGER,
                correct_count INTEGER,
                total_questions INTEGER NOT NULL,
                hint_count INTEGER NOT NULL DEFAULT 0,
                xp_earned INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'in_progress',
                adaptive_level INTEGER NOT NULL DEFAULT 1,
                prediction_status TEXT
            );
            CREATE TABLE IF NOT EXISTS attempt_answers (
                attempt_id TEXT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
                question_id INTEGER NOT NULL REFERENCES questions(id),
                answer_index INTEGER,
                is_correct INTEGER NOT NULL,
                hint_used INTEGER NOT NULL DEFAULT 0,
                xp_earned INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY(attempt_id, question_id)
            );
            CREATE TABLE IF NOT EXISTS xp_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                student_id INTEGER NOT NULL REFERENCES students(id),
                event_key TEXT NOT NULL UNIQUE,
                reason TEXT NOT NULL,
                amount INTEGER NOT NULL CHECK(amount >= 0),
                created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
            );
            CREATE INDEX IF NOT EXISTS idx_attempts_student ON attempts(student_id, submitted_at);
            CREATE INDEX IF NOT EXISTS idx_attempts_quiz ON attempts(quiz_id, submitted_at);
        """)
        question_columns = {row["name"] for row in db.execute("PRAGMA table_info(questions)").fetchall()}
        if "explanation" not in question_columns:
            db.execute("ALTER TABLE questions ADD COLUMN explanation TEXT NOT NULL DEFAULT ''")
        count = db.execute("SELECT COUNT(*) FROM quizzes").fetchone()[0]
        if count == 0:
            quiz_id = db.execute(
                "INSERT INTO quizzes(title,topic,duration_seconds) VALUES(?,?,?)",
                ("Fondasi Machine Learning", "Dasar data · KNN", 600),
            ).lastrowid
            db.executemany(
                "INSERT INTO questions(quiz_id,position,prompt,options_json,correct_index,hint,explanation) VALUES(?,?,?,?,?,?,?)",
                [(quiz_id, i + 1, q, json.dumps(opts, ensure_ascii=False), answer, hint, explanation)
                 for i, (q, opts, answer, hint, explanation) in enumerate(SEED_QUESTIONS)],
            )
        db.execute("UPDATE quizzes SET duration_seconds=600")
        seed_quiz = db.execute("SELECT id FROM quizzes WHERE title='Fondasi Machine Learning' ORDER BY id LIMIT 1").fetchone()
        if seed_quiz:
            db.executemany("UPDATE questions SET explanation=? WHERE quiz_id=? AND position=? AND (explanation='' OR explanation IS NULL)",
                           [(row[4], seed_quiz["id"], i + 1) for i, row in enumerate(SEED_QUESTIONS)])


init_db()


PASSWORD_ITERATIONS = 310_000


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PASSWORD_ITERATIONS)
    return f"pbkdf2_sha256${PASSWORD_ITERATIONS}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algorithm, iterations, salt, expected = stored.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt), int(iterations)).hex()
        return hmac.compare_digest(digest, expected)
    except (ValueError, TypeError):
        return False


def create_session(db: sqlite3.Connection, account_id: int) -> str:
    db.execute("DELETE FROM auth_sessions WHERE expires_at < ?", (datetime.now(timezone.utc).isoformat(),))
    token = secrets.token_urlsafe(40)
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    expires = (datetime.now(timezone.utc) + timedelta(hours=12)).isoformat()
    db.execute("INSERT INTO auth_sessions(token_hash,account_id,expires_at) VALUES(?,?,?)", (token_hash, account_id, expires))
    return token


def authenticated_user(request: Request, expected_role: str | None = None) -> sqlite3.Row:
    header = request.headers.get("authorization", "")
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(status_code=401, detail="Silakan login untuk melanjutkan.")
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    with connect() as db:
        user = db.execute("""SELECT a.id,a.name,a.email,a.role,a.student_id,s.id AS sid
                             FROM auth_sessions x JOIN accounts a ON a.id=x.account_id
                             LEFT JOIN students s ON s.id=a.student_id
                             WHERE x.token_hash=? AND x.expires_at>?""", (token_hash, datetime.now(timezone.utc).isoformat())).fetchone()
    if not user:
        raise HTTPException(status_code=401, detail="Sesi login tidak valid atau sudah berakhir. Silakan login kembali.")
    if expected_role and user["role"] != expected_role:
        raise HTTPException(status_code=403, detail="Fitur ini tidak tersedia untuk peran akun Anda.")
    return user


@app.post("/api/auth/register")
def register(payload: Registration):
    name = " ".join(payload.name.strip().split())
    email = str(payload.email).lower()
    if len(name) < 2:
        raise HTTPException(status_code=422, detail="Nama harus terdiri dari minimal 2 karakter.")
    with connect() as db:
        if db.execute("SELECT 1 FROM accounts WHERE email=? COLLATE NOCASE", (email,)).fetchone():
            raise HTTPException(status_code=409, detail="Email sudah terdaftar. Silakan login.")
        student_id = None
        if payload.role == "admin":
            required_code = os.getenv("GAMIFIED_ITS_ADMIN_CODE")
            admin_count = db.execute("SELECT COUNT(*) FROM accounts WHERE role='admin'").fetchone()[0]
            if required_code:
                if not payload.admin_code or not hmac.compare_digest(payload.admin_code, required_code):
                    raise HTTPException(status_code=403, detail="Kode pendaftaran admin salah.")
            elif admin_count:
                raise HTTPException(status_code=403, detail="Admin pertama sudah terdaftar. Set GAMIFIED_ITS_ADMIN_CODE untuk mengundang admin berikutnya.")
        else:
            existing = db.execute("SELECT id FROM students WHERE email=? COLLATE NOCASE", (email,)).fetchone()
            if existing:
                student_id = int(existing["id"])
                db.execute("UPDATE students SET name=? WHERE id=?", (name, student_id))
            else:
                student_id = int(db.execute("INSERT INTO students(email,name) VALUES(?,?)", (email, name)).lastrowid)
        db.execute("INSERT INTO accounts(email,name,password_hash,role,student_id) VALUES(?,?,?,?,?)",
                   (email, name, hash_password(payload.password), payload.role, student_id))
        return {"status": "registered", "role": payload.role, "message": "Akun berhasil dibuat. Silakan login."}


@app.post("/api/auth/login")
def login(payload: Login):
    email = str(payload.email).lower()
    with connect() as db:
        account = db.execute("SELECT * FROM accounts WHERE email=? COLLATE NOCASE", (email,)).fetchone()
        if not account or account["role"] != payload.role or not verify_password(payload.password, account["password_hash"]):
            raise HTTPException(status_code=401, detail="Email, password, atau jenis akun tidak cocok.")
        if account["role"] == "student" and account["student_id"]:
            db.execute("UPDATE students SET name=? WHERE id=?", (account["name"], account["student_id"]))
        token = create_session(db, int(account["id"]))
        return {"access_token": token, "token_type": "bearer", "user": {"name": account["name"], "email": account["email"], "role": account["role"], "student_id": account["student_id"]}}


@app.get("/api/auth/me")
def auth_me(request: Request):
    user = authenticated_user(request)
    return {"name": user["name"], "email": user["email"], "role": user["role"], "student_id": user["student_id"]}


@app.post("/api/auth/logout")
def logout(request: Request):
    header = request.headers.get("authorization", "")
    token = header.partition(" ")[2]
    if token:
        with connect() as db:
            db.execute("DELETE FROM auth_sessions WHERE token_hash=?", (hashlib.sha256(token.encode()).hexdigest(),))
    return {"status": "logged_out"}


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
    if not isinstance(bundle["median_values"], dict) or not all(name in bundle["median_values"] for name in FEATURES):
        raise ValueError("Median training untuk beberapa fitur tidak tersedia.")
    return bundle


def load_bundle():
    if not MODEL_PATH.is_file():
        raise HTTPException(status_code=503, detail="File model/gamified_its_model.joblib tidak ditemukan.")
    try:
        return _load_bundle(str(MODEL_PATH), MODEL_PATH.stat().st_mtime_ns)
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Model gagal dimuat. Periksa artefak Joblib dan versi dependensi.") from exc


def predict_values(values: dict[str, Any]) -> dict[str, Any]:
    bundle = load_bundle()
    row = {name: values.get(name) if values.get(name) is not None else bundle["median_values"][name] for name in FEATURES}
    if row["game_level"] > bundle["max_level"]:
        raise HTTPException(status_code=422, detail="game_level melebihi max_level model.")
    try:
        scaled = bundle["scaler"].transform(pd.DataFrame([row], columns=bundle["features"]))
        status = str(bundle["model"].predict(scaled)[0])
        probs = bundle["model"].predict_proba(scaled)[0] if hasattr(bundle["model"], "predict_proba") else None
        labels = list(bundle["model"].classes_)
        confidence = round(float(probs[labels.index(status)]), 4) if probs is not None else None
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Prediksi KNN gagal.") from exc
    return {"status": status, "confidence": confidence, "bundle": bundle, "features_used": row}


def public_quiz(db: sqlite3.Connection, quiz: sqlite3.Row, include_hints: bool = True) -> dict[str, Any]:
    questions = db.execute("SELECT id,position,prompt,options_json,hint FROM questions WHERE quiz_id=? ORDER BY position", (quiz["id"],)).fetchall()
    return {"id": quiz["id"], "title": quiz["title"], "topic": quiz["topic"], "duration": quiz["duration_seconds"],
            "questions": [{"id": q["id"], "q": q["prompt"], "options": json.loads(q["options_json"]), "hint": q["hint"] if include_hints else None} for q in questions]}


JAKARTA = ZoneInfo("Asia/Jakarta")


def record_streak(db: sqlite3.Connection, student_id: int, now: datetime, answered_count: int) -> dict[str, Any]:
    if answered_count < 1:
        row = db.execute("SELECT * FROM student_streaks WHERE student_id=?", (student_id,)).fetchone()
        return dict(row) if row else {"current_streak": 0, "best_streak": 0, "last_activity_at": None}
    now = now.astimezone(timezone.utc)
    row = db.execute("SELECT * FROM student_streaks WHERE student_id=?", (student_id,)).fetchone()
    current = int(row["current_streak"]) if row else 0
    best = int(row["best_streak"]) if row else 0
    last_at = datetime.fromisoformat(row["last_activity_at"]) if row and row["last_activity_at"] else None
    if last_at and last_at.tzinfo is None:
        last_at = last_at.replace(tzinfo=timezone.utc)
    same_date = bool(last_at and last_at.astimezone(JAKARTA).date() == now.astimezone(JAKARTA).date())
    if last_at is None or (now - last_at).total_seconds() >= 24 * 60 * 60:
        current = 1
    elif not same_date:
        current += 1
    best = max(best, current)
    stamp = now.isoformat()
    db.execute("INSERT INTO student_streaks(student_id,current_streak,best_streak,last_activity_at) VALUES(?,?,?,?) ON CONFLICT(student_id) DO UPDATE SET current_streak=excluded.current_streak,best_streak=excluded.best_streak,last_activity_at=excluded.last_activity_at", (student_id, current, best, stamp))
    day = now.astimezone(JAKARTA).date().isoformat()
    db.execute("INSERT INTO streak_days(student_id,activity_date,questions_answered) VALUES(?,?,?) ON CONFLICT(student_id,activity_date) DO UPDATE SET questions_answered=questions_answered+excluded.questions_answered", (student_id, day, answered_count))
    return {"current_streak": current, "best_streak": best, "last_activity_at": stamp}


def current_streak_row(db: sqlite3.Connection, student_id: int) -> dict[str, Any]:
    row = db.execute("SELECT * FROM student_streaks WHERE student_id=?", (student_id,)).fetchone()
    if not row or not row["last_activity_at"]:
        return {"current_streak": 0, "best_streak": 0, "last_activity_at": None, "hours_remaining": 0, "lit": False}
    last = datetime.fromisoformat(row["last_activity_at"])
    if last.tzinfo is None:
        last = last.replace(tzinfo=timezone.utc)
    seconds = max(0, int(24 * 3600 - (datetime.now(timezone.utc) - last).total_seconds()))
    active = seconds > 0
    return {"current_streak": int(row["current_streak"]) if active else 0, "best_streak": int(row["best_streak"]),
            "last_activity_at": row["last_activity_at"], "hours_remaining": round(seconds / 3600, 1), "lit": active}


def student_tier(avg_score: float | None) -> str:
    if avg_score is None:
        return "Belum ada data"
    if avg_score < 75:
        return "Perlu bimbingan"
    if avg_score < 100:
        return "Berkembang"
    return "Mandiri"


ACHIEVEMENT_RULES = [
    ("first_quiz", "Langkah pertama", "Menyelesaikan kuis pertama"),
    ("perfect_quiz", "Nilai sempurna", "Mendapat nilai 100"),
    ("three_day_streak", "Api konsisten", "Mempertahankan streak 3 hari"),
    ("xp_100", "Pengumpul XP", "Mengumpulkan 100 XP"),
    ("ten_quizzes", "Tekun berlatih", "Menyelesaikan 10 kuis"),
]


def update_achievements(db: sqlite3.Connection, student_id: int, score: int, total_xp: int, streak: int, quiz_count: int) -> None:
    earned = []
    if quiz_count >= 1: earned.append("first_quiz")
    if score == 100: earned.append("perfect_quiz")
    if streak >= 3: earned.append("three_day_streak")
    if total_xp >= 100: earned.append("xp_100")
    if quiz_count >= 10: earned.append("ten_quizzes")
    db.executemany("INSERT OR IGNORE INTO achievements(student_id,achievement_id) VALUES(?,?)", [(student_id, key) for key in earned])


@app.get("/health")
def health():
    return {"status": "ok", "model_loaded": MODEL_PATH.is_file(), "database": "sqlite", "quiz_rule": "10 XP/jawaban benar + 50 XP/kuis lengkap"}


@app.get("/api/quizzes")
def list_quizzes(request: Request):
    authenticated_user(request)
    with connect() as db:
        rows = db.execute("SELECT * FROM quizzes WHERE active=1 ORDER BY id").fetchall()
        return [public_quiz(db, q) for q in rows]


@app.post("/api/attempts/start")
def start_attempt(payload: StartAttempt, request: Request):
    user = authenticated_user(request, "student")
    with connect() as db:
        quiz = db.execute("SELECT * FROM quizzes WHERE id=? AND active=1", (payload.quiz_id,)).fetchone()
        if not quiz:
            raise HTTPException(status_code=404, detail="Kuis tidak ditemukan atau tidak aktif.")
        student_id = int(user["sid"])
        questions = db.execute("SELECT COUNT(*) FROM questions WHERE quiz_id=?", (quiz["id"],)).fetchone()[0]
        if questions != 10:
            raise HTTPException(status_code=409, detail="Kuis harus berisi tepat 10 soal.")
        attempt_id = str(uuid.uuid4())
        db.execute("INSERT INTO attempts(id,student_id,quiz_id,started_at,total_questions) VALUES(?,?,?,?,?)", (attempt_id, student_id, quiz["id"], datetime.now(timezone.utc).isoformat(), questions))
        return {"attempt_id": attempt_id, "quiz": public_quiz(db, quiz)}


@app.post("/api/attempts/{attempt_id}/submit")
def submit_attempt(attempt_id: str, payload: SubmitAttempt, request: Request):
    user = authenticated_user(request, "student")
    with connect() as db:
        attempt = db.execute("SELECT * FROM attempts WHERE id=?", (attempt_id,)).fetchone()
        if not attempt:
            raise HTTPException(status_code=404, detail="Attempt tidak ditemukan.")
        if attempt["student_id"] != user["sid"]:
            raise HTTPException(status_code=403, detail="Attempt ini milik akun mahasiswa lain.")
        if attempt["status"] != "in_progress":
            raise HTTPException(status_code=409, detail="Attempt ini sudah dikumpulkan.")
        questions = db.execute("SELECT * FROM questions WHERE quiz_id=? ORDER BY position", (attempt["quiz_id"],)).fetchall()
        submitted = {x.question_id: x for x in payload.answers}
        expected = {q["id"] for q in questions}
        if set(submitted) != expected:
            raise HTTPException(status_code=422, detail="Jawaban harus memuat seluruh 10 soal, termasuk yang tidak dijawab.")
        correct = 0
        hint_count = 0
        answer_rows = []
        for q in questions:
            item = submitted[q["id"]]
            options = json.loads(q["options_json"])
            if item.answer_index is not None and item.answer_index >= len(options):
                raise HTTPException(status_code=422, detail=f"Pilihan untuk soal {q['position']} tidak valid.")
            is_correct = item.answer_index == q["correct_index"]
            correct += int(is_correct)
            hint_count += int(item.hint_used)
            answer_rows.append((attempt_id, q["id"], item.answer_index, int(is_correct), int(item.hint_used), 10 if is_correct else 0))
        total = len(questions)
        score = correct * 10
        complete = all(submitted[q["id"]].answer_index is not None for q in questions)
        completion_bonus = 50 if complete else 0
        xp_earned = correct * 10 + completion_bonus
        now = datetime.now(timezone.utc)
        try:
            started = datetime.fromisoformat(attempt["started_at"].replace("Z", "+00:00"))
            duration = max(1, int((now - started).total_seconds()))
        except (ValueError, TypeError):
            duration = 1
        streak_info = current_streak_row(db, int(attempt["student_id"]))
        prior_attempts = db.execute("SELECT COUNT(*) FROM attempts WHERE student_id=? AND status='submitted'", (attempt["student_id"],)).fetchone()[0]
        current_level = max(1, db.execute("SELECT COALESCE(MAX(adaptive_level),1) FROM attempts WHERE student_id=?", (attempt["student_id"],)).fetchone()[0])
        model_result = None
        try:
            predicted = predict_values({
                "quiz_score": score, "duration_minutes": duration / 60, "attempt_count": prior_attempts + 1,
                "task_difficulty": min(5, max(1, attempt["quiz_id"])), "completion_rate": 100 if complete else round(sum(v.answer_index is not None for v in submitted.values()) / total * 100),
                "accuracy": score, "streak_days": streak_info["current_streak"], "engagement_score": max(0, min(100, round(score * .55 + (100 if complete else score) * .25 + (100 - min(100, hint_count * 10)) * .2))),
                "hint_count": hint_count, "feedback_frequency": None, "game_level": current_level,
            })
            model_result = predicted
        except HTTPException:
            pass
        status = model_result["status"] if model_result else None
        max_level = model_result["bundle"]["max_level"] if model_result else max(5, current_level)
        adaptive_level = min(max_level, current_level + 1) if status == "Tuntas" else current_level
        db.executemany("INSERT INTO attempt_answers(attempt_id,question_id,answer_index,is_correct,hint_used,xp_earned) VALUES(?,?,?,?,?,?)", answer_rows)
        db.execute("UPDATE attempts SET submitted_at=?,duration_seconds=?,score=?,correct_count=?,hint_count=?,xp_earned=?,status='submitted',adaptive_level=?,prediction_status=? WHERE id=?",
                   (now.isoformat(), duration, score, correct, hint_count, xp_earned, adaptive_level, status, attempt_id))
        db.execute("INSERT OR IGNORE INTO xp_events(student_id,event_key,reason,amount) VALUES(?,?,?,?)",
                   (attempt["student_id"], f"attempt:{attempt_id}", f"Kuis: {db.execute('SELECT title FROM quizzes WHERE id=?',(attempt['quiz_id'],)).fetchone()[0]}", xp_earned))
        total_xp = db.execute("SELECT COALESCE(SUM(amount),0) FROM xp_events WHERE student_id=?", (attempt["student_id"],)).fetchone()[0]
        update_achievements(db, int(attempt["student_id"]), score, total_xp, streak_info["current_streak"], prior_attempts + 1)
        db.commit()
        graded_answers = []
        for q in questions:
            answer = submitted[q["id"]]
            options = json.loads(q["options_json"])
            graded_answers.append({"question_id": q["id"], "position": q["position"], "prompt": q["prompt"],
                                   "options": options, "answer_index": answer.answer_index,
                                   "correct_index": q["correct_index"], "is_correct": answer.answer_index == q["correct_index"],
                                   "hint_used": answer.hint_used, "xp_earned": 10 if answer.answer_index == q["correct_index"] else 0,
                                   "explanation": q["explanation"]})
        return {"attempt_id": attempt_id, "score": score, "correct_count": correct, "total_questions": total,
                "duration_seconds": duration, "hint_count": hint_count, "xp_per_correct_question": 10,
                "completion_bonus": completion_bonus, "xp_earned": xp_earned, "total_xp": total_xp,
                "completed": complete, "status": status or "Model belum tersedia", "performance_status": student_tier(score),
                "confidence": model_result["confidence"] if model_result else None,
                "adaptive_level": adaptive_level, "max_level": max_level, "graded_answers": graded_answers,
                "features_used": model_result["features_used"] if model_result else {},
                "streak": current_streak_row(db, int(attempt["student_id"])),
                "achievement_count": db.execute("SELECT COUNT(*) FROM achievements WHERE student_id=?", (attempt["student_id"],)).fetchone()[0],
                "recommendation": ("Perlu bimbingan: pelajari kembali materi dasar dan tinjau pembahasan jawaban yang salah." if score < 75 else "Berkembang: lanjutkan latihan pada topik dengan jawaban salah dan pertahankan streak." if score < 100 else "Mandiri: penguasaan kuis sempurna. Lanjutkan ke tantangan berikutnya.")}


@app.post("/api/students/question-activity")
def record_question_activity(payload: QuestionActivity, request: Request):
    user = authenticated_user(request, "student")
    with connect() as db:
        attempt = db.execute("SELECT * FROM attempts WHERE id=?", (payload.attempt_id,)).fetchone()
        if not attempt or attempt["student_id"] != user["sid"]:
            raise HTTPException(status_code=404, detail="Attempt tidak ditemukan untuk akun ini.")
        if attempt["status"] != "in_progress":
            raise HTTPException(status_code=409, detail="Attempt sudah dikumpulkan.")
        if not db.execute("SELECT 1 FROM questions WHERE id=? AND quiz_id=?", (payload.question_id, attempt["quiz_id"])).fetchone():
            raise HTTPException(status_code=404, detail="Soal tidak ditemukan pada kuis ini.")
        now = datetime.now(timezone.utc)
        streak = record_streak(db, int(user["sid"]), now, 1)
        xp = db.execute("SELECT COALESCE(SUM(amount),0) FROM xp_events WHERE student_id=?", (user["sid"],)).fetchone()[0]
        quizzes_done = db.execute("SELECT COUNT(*) FROM attempts WHERE student_id=? AND status='submitted'", (user["sid"],)).fetchone()[0]
        update_achievements(db, int(user["sid"]), 0, xp, streak["current_streak"], quizzes_done)
        db.commit()
        earned = db.execute("SELECT achievement_id,earned_at FROM achievements WHERE student_id=? ORDER BY earned_at DESC", (user["sid"],)).fetchall()
        return {"streak": current_streak_row(db, int(user["sid"])), "achievement_count": len(earned),
                "achievements": [{"id": x["achievement_id"], "earned_at": x["earned_at"]} for x in earned]}


@app.post("/api/students/material-complete")
def complete_material(payload: MaterialComplete, request: Request):
    user = authenticated_user(request, "student")
    with connect() as db:
        sid = int(user["sid"])
        key = f"material:{sid}:{payload.module_id}"
        inserted = db.execute("INSERT OR IGNORE INTO xp_events(student_id,event_key,reason,amount) VALUES(?,?,?,15)",
                              (sid, key, f"Menyelesaikan materi {payload.module_id}")).rowcount
        total = db.execute("SELECT COALESCE(SUM(amount),0) FROM xp_events WHERE student_id=?", (sid,)).fetchone()[0]
        update_achievements(db, sid, 0, total, current_streak_row(db, sid)["current_streak"], db.execute("SELECT COUNT(*) FROM attempts WHERE student_id=? AND status='submitted'", (sid,)).fetchone()[0])
        db.commit()
        return {"total_xp": total, "xp_earned": 15 if inserted else 0}


@app.get("/api/students/dashboard")
def student_dashboard(request: Request):
    user = authenticated_user(request, "student")
    sid = int(user["sid"])
    with connect() as db:
        stats = db.execute("SELECT AVG(score) average_score,COUNT(*) attempts,COALESCE(MAX(adaptive_level),1) adaptive_level,AVG(duration_seconds) avg_duration,SUM(correct_count) correct,SUM(total_questions) total FROM attempts WHERE student_id=? AND status='submitted'", (sid,)).fetchone()
        latest = db.execute("SELECT score FROM attempts WHERE student_id=? AND status='submitted' ORDER BY submitted_at DESC LIMIT 1", (sid,)).fetchone()
        xp = db.execute("SELECT COALESCE(SUM(amount),0) FROM xp_events WHERE student_id=?", (sid,)).fetchone()[0]
        achievements = db.execute("SELECT achievement_id,earned_at FROM achievements WHERE student_id=? ORDER BY earned_at DESC", (sid,)).fetchall()
        streak = current_streak_row(db, sid)
        recent = db.execute("SELECT reason,amount,created_at FROM xp_events WHERE student_id=? ORDER BY created_at DESC LIMIT 12", (sid,)).fetchall()
        xp_events = db.execute("SELECT reason,amount,created_at FROM xp_events WHERE student_id=? ORDER BY created_at DESC LIMIT 1000", (sid,)).fetchall()
        attempts = db.execute("SELECT a.id,a.quiz_id,q.title,a.score,a.correct_count,a.total_questions,a.xp_earned,a.duration_seconds,a.submitted_at,a.prediction_status FROM attempts a JOIN quizzes q ON q.id=a.quiz_id WHERE a.student_id=? AND a.status='submitted' ORDER BY a.submitted_at DESC LIMIT 50", (sid,)).fetchall()
        total_q = int(stats["total"] or 0)
        return {"id": sid, "name": user["name"], "email": user["email"], "xp": xp,
                "average_score": round(stats["average_score"], 1) if stats["average_score"] is not None else None,
                "last_score": latest["score"] if latest else None, "completed_quizzes": stats["attempts"], "adaptive_level": stats["adaptive_level"],
                "accuracy": round((stats["correct"] or 0) / total_q * 100, 1) if total_q else None,
                "average_duration_seconds": round(stats["avg_duration"]) if stats["avg_duration"] is not None else None,
                "tier": student_tier(stats["average_score"]), "streak": streak,
                "achievements": [{"id": a["achievement_id"], "name": next((x[1] for x in ACHIEVEMENT_RULES if x[0] == a["achievement_id"]), a["achievement_id"]), "earned_at": a["earned_at"]} for a in achievements],
                "activities": [{"reason": x["reason"], "xp": x["amount"], "date": x["created_at"]} for x in recent],
                "xp_events": [{"reason": x["reason"], "xp": x["amount"], "date": x["created_at"]} for x in xp_events],
                "attempts": [{"id": x["id"], "quizId": x["quiz_id"], "quizTitle": x["title"], "score": x["score"], "correct": x["correct_count"], "total": x["total_questions"], "xp": x["xp_earned"], "duration": x["duration_seconds"], "date": x["submitted_at"], "status": x["prediction_status"]} for x in attempts]}


@app.get("/api/students/streak")
def student_streak(request: Request):
    user = authenticated_user(request, "student")
    with connect() as db:
        streak = current_streak_row(db, int(user["sid"]))
        days = db.execute("SELECT activity_date,questions_answered FROM streak_days WHERE student_id=? ORDER BY activity_date DESC LIMIT 30", (user["sid"],)).fetchall()
        streak["days"] = [{"date": x["activity_date"], "questions_answered": x["questions_answered"]} for x in reversed(days)]
        return streak


@app.get("/api/students/achievements")
def student_achievements(request: Request):
    user = authenticated_user(request, "student")
    with connect() as db:
        earned = {x["achievement_id"]: x["earned_at"] for x in db.execute("SELECT achievement_id,earned_at FROM achievements WHERE student_id=?", (user["sid"],)).fetchall()}
        return [{"id": key, "name": name, "description": desc, "earned_at": earned.get(key)} for key, name, desc in ACHIEVEMENT_RULES]


@app.get("/api/leaderboard")
def leaderboard(request: Request, quiz_id: int | None = None):
    authenticated_user(request)
    with connect() as db:
        if quiz_id is None:
            rows = db.execute("""SELECT s.id,s.name,COALESCE((SELECT SUM(x.amount) FROM xp_events x WHERE x.student_id=s.id),0) xp,
                                AVG(a.score) average_score,COALESCE(MAX(a.adaptive_level),1) adaptive_level,COUNT(a.id) quiz_count
                                FROM students s LEFT JOIN attempts a ON a.student_id=s.id AND a.status='submitted' GROUP BY s.id""").fetchall()
            output = []
            for r in rows:
                streak = current_streak_row(db, r["id"])
                achievements = db.execute("SELECT COUNT(*) FROM achievements WHERE student_id=?", (r["id"],)).fetchone()[0]
                output.append({"student_id": r["id"], "name": r["name"], "level": r["adaptive_level"], "status": student_tier(r["average_score"]), "xp": r["xp"],
                               "average_score": round(r["average_score"], 1) if r["average_score"] is not None else None,
                               "achievements": achievements, "streak": streak["current_streak"], "best_streak": streak["best_streak"]})
            output.sort(key=lambda x: (-x["xp"], -(x["average_score"] or 0), x["name"].casefold()))
        else:
            if not db.execute("SELECT 1 FROM quizzes WHERE id=?", (quiz_id,)).fetchone():
                raise HTTPException(status_code=404, detail="Kuis tidak ditemukan.")
            rows = db.execute("""SELECT s.id,s.name,MAX(a.score) best_score,MIN(CASE WHEN a.score=(SELECT MAX(a2.score) FROM attempts a2 WHERE a2.student_id=s.id AND a2.quiz_id=? AND a2.status='submitted') THEN a.duration_seconds END) best_duration,
                                COALESCE((SELECT SUM(x.amount) FROM xp_events x WHERE x.student_id=s.id),0) xp,
                                COALESCE(MAX(a.adaptive_level),1) adaptive_level,AVG(a.score) average_score
                                FROM attempts a JOIN students s ON s.id=a.student_id WHERE a.quiz_id=? AND a.status='submitted' GROUP BY s.id""", (quiz_id, quiz_id)).fetchall()
            output = []
            for r in rows:
                streak = current_streak_row(db, r["id"])
                achievements = db.execute("SELECT COUNT(*) FROM achievements WHERE student_id=?", (r["id"],)).fetchone()[0]
                output.append({"student_id": r["id"], "name": r["name"], "level": r["adaptive_level"], "status": student_tier(r["average_score"]), "xp": r["xp"],
                               "average_score": round(r["average_score"], 1) if r["average_score"] is not None else None, "best_score": r["best_score"],
                               "best_duration_seconds": r["best_duration"], "achievements": achievements, "streak": streak["current_streak"], "best_streak": streak["best_streak"]})
            output.sort(key=lambda x: (-x["best_score"], x["best_duration_seconds"] or 10**9, x["name"].casefold()))
        for i, row in enumerate(output, 1): row["rank"] = i
        return output


@app.post("/api/process")
def process_quiz(payload: QuizInput, request: Request):
    authenticated_user(request, "student")
    values = payload.model_dump()
    predicted = predict_values(values)
    bundle = predicted["bundle"]
    status = predicted["status"]
    row = {name: values.get(name) if values.get(name) is not None else bundle["median_values"][name] for name in FEATURES}
    score, level = float(row["quiz_score"]), int(row["game_level"])
    unlocked = min(bundle["max_level"], level + int(status == "Tuntas" and row["task_difficulty"] >= level))
    return {"status": status, "quiz_score": round(score, 2), "confidence": predicted["confidence"], "xp_earned": 0,
            "total_xp": payload.accumulated_xp, "badges": [], "current_level": level, "unlocked_level": unlocked,
            "next_level": unlocked if unlocked > level else None, "max_level": bundle["max_level"],
            "learning_progress": round(payload.completed_modules / payload.total_modules * 100),
            "recommendation": "Ulangi materi pada level ini dan tinjau jawaban salah." if status == "Perlu Remedial" else "Lanjutkan latihan dan pertahankan penguasaan materi.",
            "features_used": row, "algorithm": "KNN"}


def student_level(avg: float | None, xp: int, attempts: int) -> str:
    if attempts == 0 and xp == 0:
        return "Belum ada data"
    if avg is None:
        return "Perlu bimbingan" if xp < 75 else "Berkembang"
    return student_tier(avg)


@app.get("/api/admin/overview")
def admin_overview(request: Request):
    authenticated_user(request, "admin")
    with connect() as db:
        students = db.execute("SELECT COUNT(*) FROM students").fetchone()[0]
        avg = db.execute("SELECT AVG(score) FROM attempts WHERE status='submitted'").fetchone()[0]
        quizzes = db.execute("SELECT COUNT(*) FROM quizzes WHERE active=1").fetchone()[0]
        rows = db.execute("""SELECT s.id,s.email,s.name,COALESCE(AVG(a.score),0) avg_score,
                             (SELECT COALESCE(SUM(x.amount),0) FROM xp_events x WHERE x.student_id=s.id) xp,COUNT(a.id) attempts
                             FROM students s LEFT JOIN attempts a ON a.student_id=s.id AND a.status='submitted' GROUP BY s.id""").fetchall()
        needs_help = sum(student_level(r["avg_score"] if r["attempts"] else None, r["xp"], r["attempts"]) == "Perlu bimbingan" for r in rows)
        return {"student_count": students, "average_score": round(avg, 1) if avg is not None else None,
                "needs_guidance": needs_help, "active_quiz_count": quizzes,
                "reward_rule": "10 XP setiap jawaban benar + 50 XP setelah 10 soal selesai"}


@app.get("/api/admin/students")
def admin_students(request: Request):
    authenticated_user(request, "admin")
    with connect() as db:
        rows = db.execute("""SELECT s.id,s.name,s.email,s.created_at,AVG(a.score) avg_score,
                            (SELECT COALESCE(SUM(x.amount),0) FROM xp_events x WHERE x.student_id=s.id) xp,
                            COUNT(a.id) completed_quizzes,COALESCE(MAX(a.adaptive_level),1) adaptive_level,AVG(a.duration_seconds) avg_duration
                            FROM students s LEFT JOIN attempts a ON a.student_id=s.id AND a.status='submitted'
                            GROUP BY s.id ORDER BY s.name COLLATE NOCASE""").fetchall()
        return [{"id": r["id"], "name": r["name"], "email": r["email"], "average_score": round(r["avg_score"], 1) if r["avg_score"] is not None else None,
                 "xp": r["xp"], "level": student_level(r["avg_score"], r["xp"], r["completed_quizzes"]),
                 "adaptive_level": r["adaptive_level"], "completed_quizzes": r["completed_quizzes"],
                 "average_duration_seconds": round(r["avg_duration"]) if r["avg_duration"] is not None else None} for r in rows]


@app.get("/api/admin/students/{student_id}")
def admin_student_detail(student_id: int, request: Request):
    authenticated_user(request, "admin")
    with connect() as db:
        student = db.execute("SELECT * FROM students WHERE id=?", (student_id,)).fetchone()
        if not student:
            raise HTTPException(status_code=404, detail="Mahasiswa tidak ditemukan.")
        attempts = db.execute("""SELECT a.*,q.title quiz_title FROM attempts a JOIN quizzes q ON q.id=a.quiz_id
                                WHERE a.student_id=? AND a.status='submitted' ORDER BY a.submitted_at DESC""", (student_id,)).fetchall()
        total_xp = db.execute("SELECT COALESCE(SUM(amount),0) FROM xp_events WHERE student_id=?", (student_id,)).fetchone()[0]
        avg = sum(a["score"] for a in attempts) / len(attempts) if attempts else None
        detail = []
        for a in attempts:
            answers = db.execute("""SELECT q.position,q.prompt,aa.answer_index,aa.is_correct,aa.hint_used,aa.xp_earned,
                                  q.options_json,q.correct_index FROM attempt_answers aa JOIN questions q ON q.id=aa.question_id
                                  WHERE aa.attempt_id=? ORDER BY q.position""", (a["id"],)).fetchall()
            detail.append({"attempt_id": a["id"], "quiz_title": a["quiz_title"], "date": a["submitted_at"], "score": a["score"],
                           "duration_seconds": a["duration_seconds"], "xp_earned": a["xp_earned"], "hint_count": a["hint_count"],
                           "adaptive_level": a["adaptive_level"], "prediction_status": a["prediction_status"],
                           "answers": [{"position": x["position"], "question": x["prompt"], "selected_answer": json.loads(x["options_json"])[x["answer_index"]] if x["answer_index"] is not None else None,
                                        "correct_answer": json.loads(x["options_json"])[x["correct_index"]], "is_correct": bool(x["is_correct"]), "hint_used": bool(x["hint_used"]), "xp_earned": x["xp_earned"]} for x in answers]})
        return {"id": student["id"], "name": student["name"], "email": student["email"], "average_score": round(avg, 1) if avg is not None else None,
                "xp": total_xp, "level": student_level(avg, total_xp, len(attempts)), "adaptive_level": max((a["adaptive_level"] for a in attempts), default=1),
                "completed_quizzes": len(attempts), "attempts": detail}


@app.post("/api/admin/quizzes")
def create_quiz(payload: NewQuiz, request: Request):
    authenticated_user(request, "admin")
    with connect() as db:
        quiz_id = db.execute("INSERT INTO quizzes(title,topic,duration_seconds) VALUES(?,?,?)", (payload.title, payload.topic, payload.duration_minutes * 60)).lastrowid
        db.executemany("INSERT INTO questions(quiz_id,position,prompt,options_json,correct_index,hint,explanation) VALUES(?,?,?,?,?,?,?)",
                       [(quiz_id, i + 1, q.prompt.strip(), json.dumps(q.options, ensure_ascii=False), q.correct_index, q.hint.strip(), q.explanation.strip()) for i, q in enumerate(payload.questions)])
        return {"id": quiz_id, "title": payload.title, "question_count": len(payload.questions), "max_xp": 150}


@app.get("/api/admin/quizzes")
def admin_quizzes(request: Request):
    authenticated_user(request, "admin")
    with connect() as db:
        quizzes = db.execute("SELECT * FROM quizzes ORDER BY id DESC").fetchall()
        output = []
        for q in quizzes:
            stats = db.execute("""SELECT COUNT(*) attempts,AVG(score) avg_score,AVG(duration_seconds) avg_duration FROM attempts
                                 WHERE quiz_id=? AND status='submitted'""", (q["id"],)).fetchone()
            output.append({"id": q["id"], "title": q["title"], "topic": q["topic"], "question_count": db.execute("SELECT COUNT(*) FROM questions WHERE quiz_id=?", (q["id"],)).fetchone()[0],
                           "completion_count": stats["attempts"], "average_score": round(stats["avg_score"], 1) if stats["avg_score"] is not None else None,
                           "average_duration_seconds": round(stats["avg_duration"]) if stats["avg_duration"] is not None else None})
        return output


@app.get("/api/admin/quizzes/{quiz_id}")
def admin_quiz_detail(quiz_id: int, request: Request):
    authenticated_user(request, "admin")
    with connect() as db:
        quiz = db.execute("SELECT * FROM quizzes WHERE id=?", (quiz_id,)).fetchone()
        if not quiz:
            raise HTTPException(status_code=404, detail="Kuis tidak ditemukan.")
        questions = db.execute("SELECT * FROM questions WHERE quiz_id=? ORDER BY position", (quiz_id,)).fetchall()
        students = db.execute("""SELECT s.id,s.name,s.email,a.id attempt_id,a.score,a.duration_seconds,a.xp_earned,a.hint_count,a.submitted_at
                                FROM attempts a JOIN students s ON s.id=a.student_id WHERE a.quiz_id=? AND a.status='submitted' ORDER BY a.submitted_at DESC""", (quiz_id,)).fetchall()
        per_student = []
        for s in students:
            answers = db.execute("""SELECT q.position,aa.answer_index,aa.is_correct,aa.hint_used,aa.xp_earned FROM attempt_answers aa
                                   JOIN questions q ON q.id=aa.question_id WHERE aa.attempt_id=? ORDER BY q.position""", (s["attempt_id"],)).fetchall()
            per_student.append({"student_id": s["id"], "name": s["name"], "email": s["email"], "score": s["score"],
                                "duration_seconds": s["duration_seconds"], "xp_earned": s["xp_earned"], "hint_count": s["hint_count"],
                                "date": s["submitted_at"], "answers": [{"position": x["position"], "answer_index": x["answer_index"], "correct": bool(x["is_correct"]), "hint_used": bool(x["hint_used"]), "xp_earned": x["xp_earned"]} for x in answers]})
        return {"id": quiz["id"], "title": quiz["title"], "topic": quiz["topic"], "questions": [
            {"position": q["position"], "prompt": q["prompt"], "options": json.loads(q["options_json"]), "correct_answer": q["correct_index"], "hint": q["hint"], "explanation": q["explanation"],
             "hint_usage_count": db.execute("SELECT COUNT(*) FROM attempt_answers aa JOIN attempts a ON a.id=aa.attempt_id WHERE a.quiz_id=? AND a.status='submitted' AND aa.question_id=? AND aa.hint_used=1", (quiz_id, q["id"])).fetchone()[0],
             "average_xp": db.execute("SELECT AVG(aa.xp_earned) FROM attempt_answers aa JOIN attempts a ON a.id=aa.attempt_id WHERE a.quiz_id=? AND a.status='submitted' AND aa.question_id=?", (quiz_id, q["id"])).fetchone()[0]} for q in questions],
            "students": per_student, "completion_count": len(students),
            "average_score": round(sum(x["score"] for x in students) / len(students), 1) if students else None,
            "average_duration_seconds": round(sum(x["duration_seconds"] for x in students) / len(students)) if students else None}


@app.get("/api/analytics")
def analytics():
    return {"storage": "SQLite", "database": DB_PATH.name, "features": FEATURES}


app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
