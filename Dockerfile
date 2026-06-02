# Backend (FastAPI + intelligence layer) container.
# Python 3.12: the pinned torch CPU wheel (torch==2.5.1+cpu) has cp312 wheels,
# whereas Python 3.14 does not (see PRODUCT_GAPS / AUDIT baseline).
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    DORY_ENV=production \
    DORY_SKIP_WARMUP=0

WORKDIR /app

# Install backend deps first for layer caching.
COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --upgrade pip && pip install -r /app/backend/requirements.txt

# App code: backend + the sibling intelligence package (main.py puts the repo
# root on sys.path, so `import intelligence` resolves from /app/backend).
COPY backend /app/backend
COPY intelligence /app/intelligence

WORKDIR /app/backend

# Persist SQLite + Chroma on a mounted volume in production.
VOLUME ["/app/backend/data"]

EXPOSE 8001

# JWT_SECRET MUST be provided at runtime (the app fails fast at boot without it
# when DORY_ENV != dev). Provide GROQ_API_KEY etc. via the environment too.
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001"]
