"""Seed endpoint — loads (or reloads) a synthetic demo corpus.

The corpus is placed in its retention bands relative to the current clock, so
the dashboard shows the same strong/fading/weak/critical spread whenever it is
loaded rather than decaying into all-critical over time. Reloading clears the
previous demo corpus from both stores first, so it works on an already-decayed
database.
"""
import logging
import os
import random
from collections import Counter
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends

from core.graph_edges import rebuild_edges_for_user
from database.db import (
    DEFAULT_USER_ID,
    delete_chunks_by_source_prefix,
    get_chunk_ids_by_source_prefix,
    insert_chunk,
    set_retention_anchors,
    update_chunk_category,
)
from routers.deps import get_current_user_id
from intelligence.embeddings import embed_texts
from intelligence.memory import classify_retention, hours_until_retention
from intelligence.retrieval import add_chunks, delete_chunks as chroma_delete_chunks

router = APIRouter()
logger = logging.getLogger("dory")

# Each tuple: (content, source_file, profile, category)
# Profiles: strong / fading / weak / critical → drives retention via backdated last_accessed.
# Category is pre-assigned (no LLM call needed) so the Knowledge Forest splits cleanly.
_SEED_ITEMS = [
    # ─────────── DEVELOPMENT (strong) ───────────
    ("Binary search divides the search space in half each step. Check the midpoint; if the target is smaller go left, larger go right. Time complexity O(log n), space O(1). Works only on sorted arrays.", "demo/algorithms.md", "strong", "Computer Science"),
    ("Quick sort picks a pivot, partitions the array around it, then recursively sorts both halves. Average O(n log n), worst case O(n²). In-place but not stable.", "demo/algorithms.md", "strong", "Computer Science"),
    ("Dynamic programming stores solutions to overlapping subproblems to avoid recomputation. Top-down (memoization) or bottom-up (tabulation). Key property: optimal substructure.", "demo/algorithms.md", "strong", "Computer Science"),
    ("Hash tables map keys to indices via a hash function. Collision handling: chaining or open addressing. Average O(1) for insert/lookup/delete.", "demo/algorithms.md", "strong", "Computer Science"),
    ("BFS uses a queue to explore nodes level by level — ideal for shortest path in unweighted graphs. DFS uses a stack to go deep first — useful for cycle detection.", "demo/algorithms.md", "strong", "Computer Science"),
    ("Merge sort splits arrays in half, sorts each half recursively, then merges. Always O(n log n) time. Stable and predictable but requires O(n) extra space.", "demo/algorithms.md", "strong", "Computer Science"),
    ("Git rebase rewrites commit history by replaying commits on top of another base. Cleaner than merge but never rebase shared/pushed branches.", "demo/git.md", "strong", "Computer Science"),
    ("Python list comprehensions: [expr for x in iterable if cond]. Faster than a for-loop with append. Avoid for side effects — use a regular loop.", "demo/python.md", "strong", "Computer Science"),
    ("React hooks must be called at the top level of a function component. Never inside loops, conditions, or nested functions. Order must be stable across renders.", "demo/react.md", "strong", "Computer Science"),
    ("TypeScript discriminated unions: tag each variant with a literal type. Switch on the tag and TS narrows automatically — exhaustive checks via 'never'.", "demo/typescript.md", "strong", "Computer Science"),
    ("Tries store strings character-by-character. Each node represents a prefix. O(m) insert/search where m is string length. Used in autocomplete.", "demo/algorithms.md", "strong", "Computer Science"),

    # ─────────── AI / ML (fading) ───────────
    ("Gradient descent moves parameters in the direction of steepest loss decrease. Learning rate controls step size — too large oscillates, too small converges slowly.", "demo/ml.md", "fading", "AI/ML"),
    ("Overfitting: model memorises training noise and fails on new data. Fixes: dropout, L2 regularisation, data augmentation, early stopping.", "demo/ml.md", "fading", "AI/ML"),
    ("Attention computes a weighted sum of values using scaled dot-product (Q·Kᵀ/√d, softmax). Self-attention lets every token attend to every other — the transformer backbone.", "demo/ml.md", "fading", "AI/ML"),
    ("Convolutional layers detect local spatial features via learned filters. Pooling layers downsample. Parameter sharing drastically reduces complexity vs dense layers.", "demo/ml.md", "fading", "AI/ML"),
    ("Batch normalisation normalises activations across the batch dimension. Allows higher learning rates and reduces internal covariate shift. Train/eval modes differ.", "demo/ml.md", "fading", "AI/ML"),
    ("Cross-entropy loss: -Σ y_i log(p_i). Used for classification when outputs are probabilities. Pairs with softmax in the final layer.", "demo/ml.md", "fading", "AI/ML"),
    ("Word embeddings map tokens to dense vectors where similar meanings cluster. Word2Vec, GloVe were early; today contextual embeddings (BERT, GPT) dominate.", "demo/ml.md", "fading", "AI/ML"),
    ("Reinforcement learning loop: agent observes state, picks action, environment returns reward + next state. Policy maximises expected discounted return.", "demo/ml.md", "fading", "AI/ML"),
    ("Vector embeddings encode semantic meaning as high-dimensional points. Cosine similarity ≈ angle between vectors. ChromaDB and Pinecone are popular vector stores.", "demo/ml.md", "fading", "AI/ML"),
    ("RAG (retrieval-augmented generation): retrieve relevant chunks from a vector DB, stuff them into the LLM context, then generate. Beats fine-tuning for fact-recall use cases.", "demo/ml.md", "fading", "AI/ML"),
    ("LoRA fine-tuning trains low-rank update matrices instead of all model weights. ~10000x fewer trainable params, comparable quality, runs on consumer GPUs.", "demo/ml.md", "fading", "AI/ML"),

    # ─────────── SYSTEM DESIGN (mixed) ───────────
    ("TCP three-way handshake: SYN → SYN-ACK → ACK. Establishes sequence numbers for reliable ordered delivery. Teardown uses FIN/FIN-ACK/ACK.", "demo/system_design.md", "strong", "System Design"),
    ("TLS handshake: client hello → server hello + cert → key exchange (ECDHE) → finished. Result: symmetric session keys with forward secrecy.", "demo/system_design.md", "strong", "System Design"),
    ("HTTP/2 adds multiplexing (multiple streams per connection), header compression (HPACK), server push, binary framing. HTTP/3 uses QUIC over UDP.", "demo/system_design.md", "fading", "System Design"),
    ("Load balancing strategies: round robin, least connections, IP hash. Layer 4 routes by IP/port; Layer 7 can route by HTTP path/header.", "demo/system_design.md", "fading", "System Design"),
    ("Caching layers: CPU L1/L2 (ns), Redis (µs), CDN edge (ms). Invalidation: TTL, write-through, write-back, cache-aside.", "demo/system_design.md", "fading", "System Design"),
    ("CAP theorem: distributed systems can guarantee at most two of Consistency, Availability, Partition tolerance. Partitions are inevitable, so pick CP or AP.", "demo/system_design.md", "weak", "System Design"),
    ("Database normalisation: 1NF atomic values, 2NF no partial deps, 3NF no transitive deps, BCNF every determinant is a candidate key.", "demo/system_design.md", "weak", "System Design"),
    ("ACID: Atomicity, Consistency, Isolation, Durability. Foundation of relational databases. BASE (eventual consistency) is the NoSQL counterpart.", "demo/system_design.md", "weak", "System Design"),
    ("B+ tree indexes store sorted data in a balanced tree, records only in leaves. Self-balancing, O(log n) depth — used by virtually every relational DB.", "demo/system_design.md", "weak", "System Design"),
    ("Eventual consistency: replicas converge after writes propagate. Strong consistency requires consensus (Raft/Paxos). Tunable in Cassandra, DynamoDB.", "demo/system_design.md", "weak", "System Design"),
    ("Microservices vs monolith: microservices give independent deploys and team autonomy but pay network + ops complexity. Start monolith, split when boundaries are real.", "demo/system_design.md", "critical", "System Design"),
    ("Kafka topics are partitioned, ordered logs. Consumers track offsets; producers append. Retention by time or size. Decouples producers from consumers.", "demo/system_design.md", "critical", "System Design"),

    # ─────────── PRODUCTIVITY (mostly strong/fading) ───────────
    ("Deep work: 90-120 minute blocks of distraction-free focus on a single cognitively demanding task. Schedule, don't react. Phones in another room.", "demo/productivity.md", "strong", "Productivity"),
    ("GTD capture rule: get every commitment out of your head into a trusted system within 2 minutes of it appearing. Inbox → process → next-action.", "demo/productivity.md", "strong", "Productivity"),
    ("Pomodoro: 25min focused work, 5min break, repeat. After 4 cycles take a longer 15-30min break. The timer is a commitment device, not a productivity hack.", "demo/productivity.md", "strong", "Productivity"),
    ("Time blocking beats todo lists for high-leverage work. Pre-allocate your day so reactive tasks can't displace strategic ones. Defend the blocks ruthlessly.", "demo/productivity.md", "fading", "Productivity"),
    ("Eisenhower matrix: urgent/important quadrants. Most 'urgent' is not important. Schedule important-not-urgent (Q2) — that's where leverage lives.", "demo/productivity.md", "fading", "Productivity"),
    ("Spaced repetition uses increasing intervals between reviews — exploits the testing effect. Anki and SuperMemo schedule reviews algorithmically.", "demo/productivity.md", "fading", "Productivity"),
    ("The two-minute rule: if a task takes less than 2 minutes, do it now. Anything longer goes on the calendar or task list.", "demo/productivity.md", "weak", "Productivity"),
    ("Single-tasking outperforms multitasking on cognitively demanding work — context switching imposes a 20-40% efficiency tax. Batch similar tasks.", "demo/productivity.md", "weak", "Productivity"),
    ("Inbox zero is a workflow, not a metric. Process by deciding: delete, delegate, defer, do. Email is someone else's todo list, opened on your time.", "demo/productivity.md", "weak", "Productivity"),
    ("Weekly review: 30 minutes every Friday. Process inboxes, review goals, plan next week. Without it GTD collapses into chaos.", "demo/productivity.md", "critical", "Productivity"),
    ("Default to writing things down. Memory is unreliable; an external system is leverage. Bullet journals, Notion, plain markdown — pick one and commit.", "demo/productivity.md", "critical", "Productivity"),

    # ─────────── PERSONAL (mostly weak/critical — these are the most forgotten) ───────────
    ("Mom's birthday: October 14. She loves dark chocolate, hates flowers. Call the morning of, dinner reservation Saturday after.", "demo/personal.md", "strong", "Personal"),
    ("Apartment lease renews June 2026 — start looking March if not staying. Current rent $1850, gym + utilities included.", "demo/personal.md", "fading", "Personal"),
    ("Dentist appointment every 6 months — last visit March 12. Insurance covers 2 cleanings per year. Dr. Chen, downtown clinic.", "demo/personal.md", "fading", "Personal"),
    ("Workout split (4 days): push, pull, legs, accessory. Squat 1RM 285lb, deadlift 315lb, bench 195lb as of last test.", "demo/personal.md", "weak", "Personal"),
    ("Books to read this year: Designing Data-Intensive Applications, Crime and Punishment, The Pragmatic Programmer, Atomic Habits, Sapiens.", "demo/personal.md", "weak", "Personal"),
    ("Coffee at home: 15g beans, 250g water, 30s bloom, 2:30 total brew. V60 dripper, medium-fine grind, water just off boil.", "demo/personal.md", "weak", "Personal"),
    ("Passport expires August 2027. Renewal takes 4-6 weeks routine, 2-3 expedited ($60 extra). Need new passport photo first.", "demo/personal.md", "critical", "Personal"),
    ("Emergency fund target: 6 months of expenses ≈ $18000. Current: $11200. Auto-transfer $400/month from checking.", "demo/personal.md", "critical", "Personal"),
    ("Wifi password: change every 6 months. Router admin login is on the back. Mesh network — primary in living room, satellite in bedroom.", "demo/personal.md", "critical", "Personal"),
    ("Driver's license renewal: every 5 years, online if no address change. Last renewed July 2023 — next due 2028.", "demo/personal.md", "critical", "Personal"),
    # --------- ALGORITHMS, second cluster (strong) ---------
    ("Two pointers walk a sorted array from both ends, moving whichever side improves the candidate. Turns many O(n^2) pair-search problems into O(n) with O(1) space.", "demo/algorithms.md", "strong", "Computer Science"),
    ("Sliding window keeps a running aggregate over a contiguous range, expanding right and contracting left. O(n) for longest/shortest subarray problems under a constraint.", "demo/algorithms.md", "strong", "Computer Science"),
    ("Heaps give O(log n) insert and extract-min with O(1) peek. A binary heap is an array where children of i live at 2i+1 and 2i+2. Backs priority queues and top-k.", "demo/algorithms.md", "strong", "Computer Science"),
    ("Topological sort orders a DAG so every edge points forward. Kahn algorithm repeatedly removes in-degree-zero nodes; a leftover node means a cycle.", "demo/algorithms.md", "strong", "Computer Science"),
    ("Union-find tracks disjoint sets with near-constant amortised cost using path compression and union by rank. Used for cycle detection and Kruskal MST.", "demo/algorithms.md", "strong", "Computer Science"),
    ("Git bisect binary-searches commit history for the change that introduced a bug. Mark good and bad commits and it halves the range each step.", "demo/git.md", "strong", "Computer Science"),
    ("Git cherry-pick replays a single commit onto the current branch. Useful for hotfixes; it creates a new commit hash, so the original stays where it was.", "demo/git.md", "strong", "Computer Science"),
    ("Python generators yield lazily and hold one value at a time, so memory stays flat over huge sequences. A generator expression is (expr for x in it).", "demo/python.md", "strong", "Computer Science"),
    ("React useEffect cleanup runs before the next effect and on unmount. Return a function that cancels timers, aborts fetches, and removes listeners to avoid leaks.", "demo/react.md", "strong", "Computer Science"),

    # --------- AI / ML, second cluster (fading) ---------
    ("Positional encoding injects token order into a transformer, which is otherwise permutation-invariant. Sinusoidal in the original paper; learned or rotary (RoPE) today.", "demo/ml.md", "fading", "AI/ML"),
    ("Byte-pair encoding builds a subword vocabulary by repeatedly merging the most frequent adjacent pair. Keeps common words whole and still covers rare ones.", "demo/ml.md", "fading", "AI/ML"),
    ("Dropout randomly zeroes activations during training, forcing redundant representations. Disabled at inference; scale activations to keep the expected value stable.", "demo/ml.md", "fading", "AI/ML"),
    ("Learning rate schedules decay the step size over training. Warmup then cosine decay is the transformer default; too aggressive a decay stalls progress early.", "demo/ml.md", "fading", "AI/ML"),
    ("Beam search keeps the k most likely partial sequences at each decode step instead of only the best. Higher k costs more compute and can hurt diversity.", "demo/ml.md", "fading", "AI/ML"),
    ("HNSW builds a layered proximity graph for approximate nearest-neighbour search. Upper layers are sparse for long hops, the base layer is dense for refinement.", "demo/ml.md", "fading", "AI/ML"),
    ("Cosine similarity compares direction and ignores magnitude; Euclidean distance cares about both. Normalise vectors and the two rank results identically.", "demo/ml.md", "fading", "AI/ML"),

    # --------- DATABASES / WEB / SECURITY (weak) ---------
    ("SQL joins: INNER keeps matching rows, LEFT keeps all of the left side, FULL keeps both. A join without a predicate is a cross product, usually a bug.", "demo/databases.md", "weak", "System Design"),
    ("Database indexes trade write speed and disk for read speed. A composite index only helps queries that use its leftmost columns in order.", "demo/databases.md", "weak", "System Design"),
    ("Transaction isolation levels: read uncommitted, read committed, repeatable read, serializable. Each rules out one more anomaly and costs more concurrency.", "demo/databases.md", "weak", "System Design"),
    ("Sharding splits rows across databases by a shard key. Pick a key with even distribution and few cross-shard queries, because joins across shards are painful.", "demo/databases.md", "weak", "System Design"),
    ("Replication lag is the delay before a read replica sees a write. Read-after-write consistency needs sticky reads to the primary or a version token.", "demo/databases.md", "weak", "System Design"),
    ("Connection pooling reuses a fixed set of database connections. Pool size should track database capacity, not application threads, or the DB becomes the bottleneck.", "demo/databases.md", "weak", "System Design"),
    ("HTTP status codes: 2xx success, 3xx redirect, 4xx client error, 5xx server error. 401 means unauthenticated, 403 means authenticated but not allowed.", "demo/web.md", "weak", "System Design"),
    ("CORS is a browser rule, not a server one. The server sends Access-Control-Allow-Origin; preflight OPTIONS is sent for non-simple methods and headers.", "demo/web.md", "weak", "System Design"),
    ("JWTs are stateless and cannot be revoked before expiry, so keep access tokens short and pair them with a refresh token you can revoke server-side.", "demo/security.md", "weak", "System Design"),
    ("OAuth2 authorization code flow: redirect to the provider, receive a code, exchange it server-side for tokens. PKCE protects public clients from code interception.", "demo/security.md", "weak", "System Design"),
    ("Never store passwords reversibly. bcrypt or argon2 with a per-password salt and a deliberate work factor; raise the cost as hardware gets faster.", "demo/security.md", "weak", "System Design"),

    # --------- PERSONAL, second cluster (critical) ---------
    ("Car service every 7500 miles or 6 months. Last done at 41200. Tyre rotation included; brake pads were at 60% at the last check.", "demo/personal.md", "critical", "Personal"),
    ("Renters insurance renews in November, 14 dollars a month, covers 30k contents and 100k liability. Policy number is in the filing box.", "demo/personal.md", "critical", "Personal"),
    ("Tax documents to keep for seven years: W-2s, 1099s, charitable receipts, brokerage statements. Scan and file each January.", "demo/personal.md", "critical", "Personal"),
    ("Bolognese: soffritto low and slow for 20 minutes, brown the mince hard, deglaze with white wine, then milk, then tomato. Simmer three hours minimum.", "demo/personal.md", "critical", "Personal"),
    ("Airline miles expire after 24 months of no activity. A single small purchase through the shopping portal resets the clock on the whole balance.", "demo/personal.md", "critical", "Personal"),
]

DEMO_SOURCE_PREFIX = "demo/"

# Retention band each profile must land in. The bucket thresholds are
# STRONG >= 0.8, FADING >= 0.5, WEAK >= 0.2 (intelligence/memory/ebbinghaus.py),
# so every band sits comfortably inside its bucket rather than on a boundary.
_TARGET_RETENTION = {
    "strong":   (0.84, 0.94),
    "fading":   (0.56, 0.74),
    "weak":     (0.26, 0.44),
    "critical": (0.04, 0.16),
}

# Plausible "last viewed" window per profile, in days. This feeds last_accessed
# only, which stays an honest record of when the note was read — the retention
# anchor is what actually places a chunk in its bucket. These ranges track the
# bands above so the two never contradict each other on screen.
_LAST_SEEN_DAYS = {
    "strong":   (1, 5),
    "fading":   (6, 13),
    "weak":     (14, 26),
    "critical": (24, 50),
}

_ACCESS_COUNTS = {
    "strong":   (4, 8),
    "fading":   (2, 3),
    "weak":     (1, 2),
    "critical": (0, 1),
}

# Real MiniLM similarities between distinct notes sit well below the product
# default, so the demo corpus is linked at a lower bar to produce a graph worth
# looking at. Scoped to this endpoint; SEMANTIC_EDGE_THRESHOLD is unchanged.
#
# Tuned against real MiniLM vectors over this exact corpus (87 notes, K=8).
# Each row is the whole graph at that threshold:
#
#   tau    edges  components  largest  isolated  avg degree
#   0.35      84          35       29        24        1.93   <- was this
#   0.30     160          18       61        13        3.68
#   0.25     273           6       82         5        6.28
#   0.22     330           3       85         2        7.59   <- is this
#   0.20     358           3       85         2        8.23
#   0.10     455           1       87         0       10.46
#
# 0.22 is where the curve flattens: 0.20 adds 28 edges and connects nothing
# further, and clearing the last two isolated notes needs tau <= 0.145, which is
# below the noise floor of the embedding — at that bar a pasta recipe links to a
# Kafka note and the graph stops meaning anything. K=8 (MAX_EDGES_PER_CHUNK)
# caps density independently, so this stays a constellation, not a hairball.
DEMO_EDGE_THRESHOLD = 0.22

# Fixed seed so reloading the demo yields the same corpus every time.
_RNG_SEED = 1064


@router.post("/seed")
def seed_demo_data(user_id: str = Depends(get_current_user_id)):
    """Load or reload the demo corpus for the calling user.

    Idempotent by replacement rather than by refusal: any previous demo chunks
    are deleted from SQLite (their graph edges cascade) and from the vector
    store, then the corpus is rebuilt and relinked. Only rows whose source_file
    starts with 'demo/' are touched, and every query is scoped to user_id, so a
    reload can never reach a hand-written note or another account.
    """
    rng = random.Random(_RNG_SEED)
    now = datetime.now(tz=timezone.utc)

    removed_ids = delete_chunks_by_source_prefix(user_id, DEMO_SOURCE_PREFIX)
    if removed_ids:
        chroma_delete_chunks(removed_ids, user_id)

    texts = [item[0] for item in _SEED_ITEMS]
    embeddings = embed_texts(texts)

    chunk_ids: list[str] = []
    metadatas: list[dict] = []
    anchors: dict[str, str] = {}
    buckets: Counter = Counter()

    for (content, source, profile, category), embedding in zip(_SEED_ITEMS, embeddings):
        complexity = round(rng.uniform(0.4, 0.8), 2)
        access_count = rng.randint(*_ACCESS_COUNTS[profile])

        last_accessed = now - timedelta(days=rng.uniform(*_LAST_SEEN_DAYS[profile]))
        created_at = last_accessed - timedelta(days=rng.randint(1, 7))

        cid = insert_chunk(
            content=content,
            source_file=source,
            complexity_score=complexity,
            user_id=user_id,
            created_at=created_at,
            last_accessed=last_accessed,
            access_count=access_count,
        )
        # Pre-assign the category — no LLM call, so this works without a key.
        update_chunk_category(cid, category)

        # Solve for the anchor that puts this chunk at its target retention now.
        target_retention = rng.uniform(*_TARGET_RETENTION[profile])
        decay_hours = hours_until_retention(target_retention, access_count, complexity)
        anchors[cid] = (now - timedelta(hours=decay_hours)).isoformat()
        buckets[classify_retention(target_retention)] += 1

        chunk_ids.append(cid)
        metadatas.append({"user_id": user_id, "chunk_id": cid, "source_file": source})

    add_chunks(chunk_ids, embeddings, metadatas)
    set_retention_anchors(user_id, anchors)

    graph = rebuild_edges_for_user(user_id, threshold=DEMO_EDGE_THRESHOLD)

    return {
        "seeded": len(chunk_ids),
        "removed": len(removed_ids),
        "edges_total": graph["edges_total"],
        "edges_created": graph["edges_created"],
        "buckets": dict(buckets),
        "message": (
            f"Loaded {len(chunk_ids)} demo notes "
            f"({buckets['strong']} strong / {buckets['fading']} fading / "
            f"{buckets['weak']} weak / {buckets['critical']} critical) "
            f"linked by {graph['edges_total']} connections."
        ),
    }


def autoseed_enabled() -> bool:
    """DORY_AUTOSEED_DEMO=1 opts in. Off by default so local runs and tests are
    unaffected; meant for hosts with ephemeral disks, where the demo corpus is
    wiped on every restart."""
    return os.getenv("DORY_AUTOSEED_DEMO") == "1"


def autoseed_demo_if_empty() -> None:
    """Seed the demo account's corpus if it has none. Run once at startup.

    Reuses seed_demo_data unchanged, so it is scoped the same way: only the demo
    user, only 'demo/' rows. Skips when any demo chunk already exists, so a
    restart on a persistent disk never rebuilds (or reshuffles) a corpus the
    demo user has been using. Never raises — a failed seed is logged and the app
    carries on with an empty demo account, exactly as before this existed.
    """
    try:
        if get_chunk_ids_by_source_prefix(DEFAULT_USER_ID, DEMO_SOURCE_PREFIX):
            logger.info("Demo auto-seed skipped: demo corpus already present")
            return
        result = seed_demo_data(user_id=DEFAULT_USER_ID)
        logger.info("Demo auto-seed: %s", result["message"])
    except Exception:
        logger.exception("Demo auto-seed failed; continuing without demo data")
