"""Seed endpoint — inserts synthetic demo chunks with varied retention profiles."""
import random
import threading
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends

from database.db import get_all_chunks, insert_chunk
from routers.deps import get_current_user_id
from core.embeddings import embed_texts
from services.chroma_service import add_chunks
from services.category_service import classify_all_uncategorized

router = APIRouter()

_SEED_ITEMS = [
    # ── Strong (recently reviewed) ──────────────────────────────────────────
    ("Binary search divides the search space in half each step. Check the midpoint; if the target is smaller go left, larger go right. Time complexity O(log n), space O(1). Works only on sorted arrays.", "demo/algorithms.md", "strong"),
    ("Quick sort picks a pivot, partitions the array around it, then recursively sorts both halves. Average O(n log n), worst case O(n²) when pivot is always min/max. In-place but not stable.", "demo/algorithms.md", "strong"),
    ("Dynamic programming stores solutions to overlapping subproblems to avoid recomputation. Two approaches: top-down (memoization) and bottom-up (tabulation). Key property: optimal substructure.", "demo/algorithms.md", "strong"),
    ("Hash tables map keys to indices via a hash function. Collision handling: chaining (linked list per bucket) or open addressing (probe for next empty slot). Average O(1) for insert/lookup/delete.", "demo/algorithms.md", "strong"),
    ("BFS uses a queue to explore nodes level by level — ideal for shortest path in unweighted graphs. DFS uses a stack (or recursion) to go deep first — useful for cycle detection and topological sort.", "demo/algorithms.md", "strong"),
    ("Merge sort splits arrays in half, sorts each half recursively, then merges. Always O(n log n) time. Stable and predictable but requires O(n) extra space. Preferred for linked lists and external sort.", "demo/algorithms.md", "strong"),
    # ── Fading (reviewed 2–3 weeks ago) ─────────────────────────────────────
    ("Gradient descent iteratively moves parameters in the direction of steepest loss decrease. Learning rate controls step size — too large causes oscillation, too small causes slow convergence. SGD uses mini-batches.", "demo/ml.md", "fading"),
    ("Overfitting: model memorises training noise and fails on new data. Fixes: dropout (randomly zero neurons), L2 regularisation (penalise large weights), data augmentation, early stopping.", "demo/ml.md", "fading"),
    ("Attention computes a weighted sum of values using query–key dot products (scaled, softmaxed). Self-attention lets every token attend to every other token — the backbone of transformer models.", "demo/ml.md", "fading"),
    ("Convolutional layers detect local spatial features via learned filters. Pooling layers downsample. Fully connected layers classify. Parameter sharing drastically reduces complexity vs dense layers.", "demo/ml.md", "fading"),
    ("TCP three-way handshake: SYN → SYN-ACK → ACK. Establishes sequence numbers for reliable ordered delivery. Teardown uses FIN/FIN-ACK/ACK. Stateful — both sides track connection state.", "demo/networking.md", "fading"),
    ("TLS handshake: client hello (cipher list) → server hello + certificate → key exchange (ECDHE) → finished messages. Result: symmetric session keys. Forward secrecy via ephemeral key pairs.", "demo/networking.md", "fading"),
    ("HTTP/2 improvements: multiplexing (multiple streams per connection), header compression (HPACK), server push, binary framing. HTTP/3 uses QUIC over UDP to eliminate head-of-line blocking.", "demo/networking.md", "fading"),
    # ── Weak (1–2 months ago, minimal review) ───────────────────────────────
    ("Database normalisation: 1NF atomic values, 2NF no partial dependencies, 3NF no transitive dependencies, BCNF every determinant is a candidate key. Goal: eliminate redundancy and update anomalies.", "demo/databases.md", "weak"),
    ("ACID properties: Atomicity (all-or-nothing), Consistency (valid state), Isolation (concurrent transactions don't interfere), Durability (committed data survives failures). Foundation of relational databases.", "demo/databases.md", "weak"),
    ("B-tree indexes store sorted data in a balanced tree. Each node holds multiple keys. B+ trees store records only in leaves; internal nodes route searches. Self-balancing keeps depth O(log n).", "demo/databases.md", "weak"),
    ("CAP theorem: distributed systems can guarantee at most two of Consistency, Availability, Partition tolerance. Partitions are inevitable, so choose CP (ZooKeeper, HBase) or AP (Cassandra, DynamoDB).", "demo/system_design.md", "weak"),
    ("Load balancing strategies: round robin, least connections, IP hash (sticky sessions), weighted. Layer 4 (TCP-level) vs Layer 7 (HTTP-level, can route by path/header). Prevents single-point overload.", "demo/system_design.md", "weak"),
    ("Caching layers: CPU L1/L2 cache (nanoseconds), Redis (microseconds), CDN edge (milliseconds). Invalidation strategies: TTL, write-through, write-back, cache-aside (lazy load on miss).", "demo/system_design.md", "weak"),
    # ── Critical (3–5 months ago, almost forgotten) ──────────────────────────
    ("Virtual memory maps virtual addresses to physical frames via page tables. Pages not in RAM trigger a page fault — OS loads from disk (swap). Enables isolation between processes.", "demo/os.md", "critical"),
    ("Deadlock requires all four: mutual exclusion, hold-and-wait, no preemption, circular wait. Prevention: break any one condition. Detection: resource-allocation graph. Recovery: kill or preempt a process.", "demo/os.md", "critical"),
    ("Process scheduling: FCFS simple but convoy effect; SJF minimises avg wait but needs burst prediction; Round Robin fair with time quantum; Priority scheduling risks starvation — fix with aging.", "demo/os.md", "critical"),
    ("Bayes theorem: P(A|B) = P(B|A)·P(A)/P(B). Posterior ∝ likelihood × prior. Used in spam filters, medical diagnosis, A/B test analysis to rationally update beliefs given evidence.", "demo/math.md", "critical"),
    ("Big-O notation: O(1) constant, O(log n) log, O(n) linear, O(n log n) linearithmic, O(n²) quadratic, O(2ⁿ) exponential. Ignore constants, lower-order terms. Always analyse worst case unless stated.", "demo/math.md", "critical"),
    ("Tries (prefix trees) store strings character-by-character. Each node represents a character prefix; marked nodes signal word ends. O(m) insert/search where m is string length. Used in autocomplete.", "demo/algorithms.md", "critical"),
]

_PROFILES = {
    "strong":   (1,   4,   4, 8),   # (min_days, max_days, min_access, max_access)
    "fading":   (14,  25,  2, 3),
    "weak":     (45,  70,  1, 2),
    "critical": (100, 160, 0, 1),
}


@router.post("/seed")
def seed_demo_data(user_id: str = Depends(get_current_user_id)):
    existing = get_all_chunks(user_id)
    already = sum(1 for r in existing if (r["source_file"] or "").startswith("demo/"))
    if already >= 10:
        return {"message": f"Demo data already loaded ({already} demo chunks present).", "seeded": 0}

    now = datetime.now(tz=timezone.utc)
    texts = [item[0] for item in _SEED_ITEMS]
    embeddings = embed_texts(texts)

    chunk_ids, metadatas = [], []
    for (content, source, profile_key), embedding in zip(_SEED_ITEMS, embeddings):
        min_d, max_d, min_a, max_a = _PROFILES[profile_key]
        days = random.randint(min_d, max_d)
        last_accessed = now - timedelta(days=days)
        created_at = last_accessed - timedelta(days=random.randint(1, 7))
        access_count = random.randint(min_a, max_a)

        cid = insert_chunk(
            content=content,
            source_file=source,
            complexity_score=round(random.uniform(0.4, 0.8), 2),
            user_id=user_id,
            created_at=created_at,
            last_accessed=last_accessed,
            access_count=access_count,
        )
        chunk_ids.append(cid)
        metadatas.append({"user_id": user_id, "chunk_id": cid, "source_file": source})

    add_chunks(chunk_ids, embeddings, metadatas)
    threading.Thread(target=classify_all_uncategorized, daemon=True).start()

    return {"message": f"Seeded {len(chunk_ids)} demo chunks across strong/fading/weak/critical profiles.", "seeded": len(chunk_ids)}
