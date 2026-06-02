# 🐟 Dory.md

> The notes app that remembers so you don't have to forget.

A personal knowledge system that models your memory decay using the Ebbinghaus forgetting curve and surfaces fading notes before you lose them.

## What it does

- **Ingest** Markdown, PDF, DOCX, HTML, JSON, or plain text — chunked, embedded, stored.
- **Decay engine** Per-chunk Ebbinghaus retention math drives a "what am I forgetting" view.
- **Hybrid-aware search** Composite ranking blends semantic similarity, decay urgency, and recency over the user's chunks.
- **Discovery** Background polling surfaces the single most at-risk chunk as a slide-in card.
- **Quiz** Auto-generated MCQs from the lowest-retention chunks (Groq LLM, with a fallback bank).
- **Time Machine** Project your library's retention into the future and watch the dashboard re-rank.

## Stack

| Layer | Tech |
|---|---|
| Frontend | React + TypeScript + Vite + Tailwind + Framer Motion |
| Backend | FastAPI + SQLite (WAL) + ChromaDB |
| Embeddings | `sentence-transformers/all-MiniLM-L6-v2` (CPU) |
| LLM | Groq (any OpenAI-compatible provider via env) |
| Auth | JWT access + refresh rotation, bcrypt password hashing |

## Repo layout

```
Dory.md/
├── backend/                FastAPI server — orchestration only (routes, auth, persistence)
│   ├── main.py             app entry + CORS + logging + lifespan + livez/readyz
│   ├── observability.py    logging config        ratelimit.py  in-memory limiter
│   ├── routers/            auth, chunks, search, ingest, quiz, review, …
│   │   └── _shared.py      datetime + chunk-shape helpers
│   ├── services/           category_service (classification orchestration)
│   ├── database/           db.py + schema.sql (SQLite)
│   ├── models/schemas.py   Pydantic request/response shapes
│   ├── parsers/            file/pdf/html parsers
│   └── tests/              backend pytest (auth, chunk authz, FSRS loop, AI gate, P0 fixes, rate limit)
├── intelligence/           Independent domain layer (no HTTP/DB) — see ARCHITECTURE_REFACTOR.md
│   ├── memory/             Ebbinghaus retention + FSRS scheduler
│   ├── embeddings/         SentenceTransformer vectorization
│   ├── retrieval/          ChromaDB vector store
│   ├── ranking/            hybrid composite scoring
│   ├── llm/                provider abstraction + categorization + quiz generation
│   ├── domain/             chunking + complexity
│   └── tests/              pure unit tests + boundary enforcement
├── frontend/
│   └── src/                pages, components, lib, contexts, styles
├── Dockerfile              backend container        .github/workflows/ci.yml  CI
└── ReadMe.md
```

## Running locally

### Prerequisites
- Python 3.11+
- Node 18+
- (Optional) A free [Groq API key](https://console.groq.com) for LLM-generated quizzes and category classification. The app falls back to a hardcoded question bank without it.

### Backend
```bash
cd backend
python -m venv venv
venv/Scripts/activate           # Windows
# source venv/bin/activate       # macOS/Linux
pip install -r requirements.txt

# Configure
cp .env.example .env             # then edit
# Required: JWT_SECRET when DORY_ENV != "dev"
# Optional: GROQ_API_KEY for LLM-backed quiz + classifier

uvicorn main:app --port 8001 --reload
```

First startup downloads the MiniLM model (~90 MB) and warms it. Subsequent starts are fast.

### Frontend
```bash
cd frontend
npm install
# Point at the backend (default already targets 8001)
echo "VITE_API_BASE_URL=http://localhost:8001" > .env.local
npm run dev
```

Open http://localhost:5173 and log in with:
- Email: `demo@dory.md`
- Password: `demo123`

Then go to **Settings → Demo data → Load demo data** to seed 55 chunks across 5 categories with varied retention profiles.

## Tests
```bash
# From the repo root, in a venv with the test deps installed:
pip install -r backend/requirements-test.txt

# Backend suite (run from backend/ so `from main import app` resolves):
cd backend && python -m pytest tests/ -v

# Intelligence layer suite (pure logic, ~0.1s):
cd .. && python -m pytest intelligence/tests/ -v
```
CI runs both suites plus frontend `tsc` / `lint` / `build` — see `.github/workflows/ci.yml`.

## Environment variables

### Backend `.env`
```bash
DORY_ENV=dev                     # 'dev' enables a permissive JWT secret default
JWT_SECRET=                      # REQUIRED when DORY_ENV != dev
LLM_PROVIDER=groq                # groq | openai | anthropic | ollama
LLM_MODEL=meta-llama/llama-4-scout-17b-16e-instruct
GROQ_API_KEY=                    # optional; LLM features degrade gracefully without it
FRONTEND_URL=http://localhost:5173
DORY_SKIP_WARMUP=                # set to 1 to skip embedding-model warmup (faster startup, slower first request)
DORY_DB_PATH=                    # override SQLite path; tests use this
```

### Frontend `.env.local`
```bash
VITE_API_BASE_URL=http://localhost:8001
VITE_USE_MOCKS=false             # set true to render with the bundled mock JSON instead of hitting the backend
VITE_DISCOVERY_POLL_MS=30000
```

## License

MIT.
