# 🐟 Dory.md

> **The notes app that remembers so you don't have to forget.**

A research-grade personal knowledge system that models your memory decay and proactively resurfaces knowledge before it fades.

**Event:** UWB Hacks 2026 — Hacks the Future  
**Track:** Track 2: Human Experience  
**Build Window:** 48 Hours | **Team Size:** 3

---

## 🧠 What Is Dory.md?

Dory.md is an AI-powered personal knowledge system that tracks what you're forgetting and brings it back at the right time. Unlike tools that simply store and search notes, Dory.md **models your memory decay** and **proactively resurfaces knowledge** before it fades.

### Core Features
- **📥 Ingest** — Upload notes, PDFs, markdown files, or connect Notion via OAuth
- **📉 Decay Engine** — Ebbinghaus forgetting curve math per knowledge chunk
- **🔍 Hybrid Search** — BM25 + dense retrieval + Reciprocal Rank Fusion
- **💡 Discovery Notifications** — "I just found something!" — resurfaces fading, relevant knowledge
- **🕐 Time Machine Slider** — Watch your knowledge decay into the future in real-time
- **🧪 Quiz Mode** — MCQ questions from fading chunks to boost retention

### The Formula
```
R(t) = exp(-hours_since_access / (S × k × 24))
```
Where `S` = stability (increases with reviews), `k` = complexity modifier, and `t` = time elapsed.

---

## 📁 Project Structure

```
dory-md/
├── intelligence/          ← Person 2: AI/ML modules (Python)
│   ├── __init__.py
│   ├── chunk_protocol.py  # ChunkLike Protocol (shared type contract)
│   ├── decay.py           # Retention math (R(t) formula, Time Machine)
│   ├── embedder.py        # BGE embeddings + ChromaDB vector store
│   ├── search.py          # BM25 + Dense + RRF hybrid search
│   ├── classifier.py      # Groq LLM chunk categorizer
│   ├── quiz.py            # Groq MCQ quiz generator
│   ├── demo_data.py       # Demo dataset generator (90 backdated chunks)
│   ├── scripts/           # Utility scripts
│   │   └── load_demo_to_chroma.py
│   └── tests/             # Unit tests for all modules
│       ├── test_demo_data.py
│       ├── test_decay.py
│       ├── test_embedder.py
│       ├── test_search.py
│       ├── test_classifier.py
│       ├── test_quiz.py
│       └── inspect_demo.py
│
├── backend/               ← Person 1: FastAPI server (TODO)
│   └── (endpoints, models, DB, Notion OAuth)
│
├── frontend/              ← Person 3: React UI (TODO)
│   └── (dashboard, Time Machine slider, Discovery cards, Quiz UI)
│
├── requirements.txt       # Python dependencies
├── .env.example           # Environment variable template
├── .gitignore
├── demo_chunks.json       # Generated demo dataset (90 chunks)
└── README.md              # You are here
```

---

## 🔗 Integration Contract

**Person 1 imports and calls Person 2's modules.** These are the agreed function signatures:

| Module | Function | When P1 Calls It |
|--------|----------|-------------------|
| `intelligence/decay.py` | `compute_retention(chunks, time_offset_hours=0) → np.ndarray` | Every `/api/health` request |
| `intelligence/decay.py` | `aggregate_by_category(chunks, retentions) → dict` | Every `/api/health` request |
| `intelligence/embedder.py` | `embed_chunks(texts) → np.ndarray` | Background task after ingest |
| `intelligence/embedder.py` | `store_embeddings(chunks, embeddings) → None` | Background task after ingest |
| `intelligence/search.py` | `hybrid_search(query, top_k=10) → list[tuple]` | Every `/api/search` request |
| `intelligence/classifier.py` | `classify_chunks(texts) → list[str]` | Background task after ingest |
| `intelligence/quiz.py` | `generate_quiz_questions(chunks) → list[dict]` | Every `/api/quiz/start` request |

### The Chunk Schema (Shared Contract)

All 3 persons use this exact JSON shape:

```json
{
  "id": "chk_8a3f...",
  "content": "...chunk text 200-500 chars...",
  "source_type": "file",
  "source_name": "research_notes.md",
  "category": "technical | personal | reference | general",
  "created_at": "2026-04-25T10:00:00Z",
  "last_accessed": "2026-04-25T10:00:00Z",
  "access_count": 0,
  "stability_S": 7.0,
  "complexity_k": 1.0
}
```

### API Endpoints (Person 1 builds these)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/ingest` | Upload and process files |
| `GET` | `/api/health` | Dashboard data + Time Machine (`?time_offset_hours=N`) |
| `POST` | `/api/search` | Context-aware discovery search |
| `GET` | `/api/discovery` | Get discovery notification |
| `POST` | `/api/review/{chunk_id}` | Mark chunk as reviewed |
| `POST` | `/api/quiz/start` | Generate quiz from fading chunks |
| `POST` | `/api/quiz/submit` | Submit quiz answers |
| `GET` | `/api/fading` | Fading memories feed |

---

## 🚀 Getting Started

### Prerequisites
- Python 3.11+
- Git
- Groq API key ([get one free](https://console.groq.com))

### Setup

```bash
# 1. Clone the repo
git clone https://github.com/vaishnavi1064/Dory.md.git
cd Dory.md

# 2. Create virtual environment
python -m venv .venv

# Windows:
.venv\Scripts\activate
# Mac/Linux:
source .venv/bin/activate

# 3. Install dependencies
pip install -r requirements.txt

# 4. Set up environment variables
cp .env.example .env
# Edit .env and add your GROQ_API_KEY

# 5. Pre-download the embedding model (IMPORTANT - do on good WiFi)
python -c "from sentence_transformers import SentenceTransformer; m = SentenceTransformer('BAAI/bge-small-en-v1.5'); print('Model ready:', m.encode('test').shape)"

# 6. Run tests
python -m pytest intelligence/tests/ -v

# 7. Generate demo dataset
python -m intelligence.demo_data
```

### Branch Strategy
- `main` — stable, merged code only
- `feat/intelligence` — Person 2's work
- `feat/backend` — Person 1's work
- `feat/frontend` — Person 3's work

---

## 🧪 Running Tests

```bash
# All intelligence tests
python -m pytest intelligence/tests/ -v

# Specific module
python -m pytest intelligence/tests/test_demo_data.py -v

# Inspect demo dataset
python intelligence/tests/inspect_demo.py
```

---

## 📋 48-Hour Build Timeline

| Hours | Person 1 (Backend) | Person 2 (Intelligence) | Person 3 (Frontend) |
|-------|-------------------|------------------------|-------------------|
| 0-4 | FastAPI scaffold, schema | Demo data, package setup | React scaffold, dark mode |
| 4-8 | File parsers | **Decay Engine** | Upload page |
| 8-14 | Embedding pipeline | **Embedder + ChromaDB** | Dashboard |
| 14-20 | API endpoints | **Hybrid Search** | Time Machine Slider |
| 20-24 | Notion OAuth | **Groq Classifier** | Discovery Card |
| 24-30 | Edge cases | **Quiz Generator** | Quiz UI |
| 30-38 | Integration | Integration testing | Connect to API |
| 38-48 | Deploy + polish | Bug bash + buffer | Polish + deploy |

---

## 📝 License

Built for UWB Hacks 2026. MIT License.
