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
├── backend/                FastAPI server
│   ├── main.py             app entry + CORS + lifespan
│   ├── routers/            auth, chunks, search, ingest, quiz, …
│   │   └── _shared.py      datetime + chunk-shape helpers
│   ├── core/               decay_engine, chunker, complexity, embeddings
│   ├── services/           chroma_service, llm_service, category_service
│   ├── database/           db.py + schema.sql (SQLite)
│   ├── models/schemas.py   Pydantic request/response shapes
│   ├── parsers/            file/pdf/html parsers
│   └── tests/              17 pytest cases (auth + chunk authorization + AI gate)
├── frontend/
│   └── src/
│       ├── pages/          Dashboard, Library, Search, Quiz, NoteEditor, Settings, …
│       ├── components/     chunks, notes, quiz, layout, ui, discovery, search, upload
│       ├── lib/            api, tokens, types, utils, useDashboardData, useDiscoveryPolling
│       ├── contexts/       AuthContext
│       └── styles/         theme.ts (warm-grey accent + retention color scale)
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
cd backend
.testvenv/Scripts/python.exe -m pytest tests/ -v
# or use the regular venv if it has pytest installed
```

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
