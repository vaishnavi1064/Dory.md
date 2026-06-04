# Dory.md — UI / UX Review (Agent 4)

**Date:** 2026-06-01
**Method:** Read every page/component; corroborated by a dedicated read-only sub-agent sweep. Frontend `tsc` + `vite build` pass (VERIFIED); `eslint` cannot run (no flat config — see AUDIT P0/lint). No live browser session was run, so visual-rendering and real-device claims are **UNVERIFIED (runtime)** unless tied to specific code.

**Overall:** This is **above hackathon grade**. There is a real design system (CSS custom-property tokens, a warm-grey "Notion-like" palette, consistent `app-card`/`btn-*` component classes, Framer-Motion transitions, thoughtful empty/loading states on Dashboard and Search). It is **not** a recolor job. The gaps that separate it from "sellable SaaS" are: **mobile navigation is missing**, **accessibility is inconsistent**, a few **error/empty states keep stale data**, **security-sensitive HTML rendering is unsanitized**, and there is **shipped dead code**.

---

## 1. P0 / High-impact UX defects

### U-1 — No mobile navigation at all — VERIFIED
- `Sidebar` is `hidden ... md:flex` ([Sidebar.tsx:85](frontend/src/components/layout/Sidebar.tsx#L85)) — it renders **only ≥768px**.
- `Header` ([Header.tsx:48-83](frontend/src/components/layout/Header.tsx#L48-L83)) contains Upload / Add memory / Bell — **no hamburger, no nav drawer**.
- Result: on any phone, after landing on `/` the user **cannot reach** Search, Library, Review, Calendar, Focus, or Settings except via incidental in-page `<Link>`s. For a product you intend to sell, this is a hard blocker. The `vite build` succeeds, so this is purely a layout/feature gap, not a build error.

### U-2 — Unsanitized HTML injection (security ∩ UX) — VERIFIED
- `dangerouslySetInnerHTML` on `marked.parse` output ([NoteEditorPage.tsx:337](frontend/src/pages/NoteEditorPage.tsx#L337)) and on search `highlight` ([SearchPage.tsx:126](frontend/src/pages/SearchPage.tsx#L126), [ChunkCard.tsx:119](frontend/src/components/chunks/ChunkCard.tsx#L119)). `marked` doesn't sanitize; user-authored notes can inject executable HTML. Cross-referenced as P1-5 in AUDIT (token theft chain). Fix: DOMPurify before render.

### U-3 — Error states keep stale results visible — VERIFIED
- `SearchPage.handleSearch` sets `error` on failure but does **not** clear `results` ([SearchPage.tsx:56-58](frontend/src/pages/SearchPage.tsx#L56-L58)). The user sees an error banner *plus* the previous query's results, with no indication which query the results belong to.
- Several fetches swallow errors entirely: Dashboard `getStats/getReviewQueue/getDiscovery` all `.catch(() => {})` ([Dashboard.tsx:85-89](frontend/src/pages/Dashboard.tsx#L85-L89)); discovery polling `catch { /* ignore */ }` ([useDiscoveryPolling.ts:36-38](frontend/src/lib/useDiscoveryPolling.ts#L36-L38)). If the backend is down, the dashboard renders as if the user simply has no data — indistinguishable from a real empty account. There is no global "can't reach server" surface.

---

## 2. P1 — Accessibility

(Modern SaaS buyers increasingly require WCAG AA; these are the concrete gaps.)

- **A-1 Icon-only buttons without accessible names** — VERIFIED. The Bell/discovery button uses `title=` but no `aria-label` ([Header.tsx:73-81](frontend/src/components/layout/Header.tsx#L73-L81)); `title` is not a reliable accessible name and isn't keyboard-discoverable. Same pattern on close (`X`) buttons.
- **A-2 Status conveyed by color alone** — VERIFIED. Retention/stability is signaled purely by dot color ([Dashboard.tsx:258-262](frontend/src/pages/Dashboard.tsx#L258-L262), DiscoveryCard border). Color-blind users get no signal. The numeric label exists on `sm+` only (`hidden sm:block`, [Dashboard.tsx:276](frontend/src/pages/Dashboard.tsx#L276)) — so on mobile the dot is the *only* cue.
- **A-3 Clickable non-button elements** — VERIFIED (sub-agent). `ChunkCard` root is a `<div onClick>` (not keyboard-focusable) ([ChunkCard.tsx:50](frontend/src/components/chunks/ChunkCard.tsx#L50)). (Note: ChunkCard is currently dead code — U-7 — but the pattern would regress if reused.) Modal overlays (`Add memory`, Library delete) close on backdrop click but have **no focus trap, no `Esc` handler, no `role="dialog"`/`aria-modal`** ([Header.tsx:85-125](frontend/src/components/layout/Header.tsx#L85-L125)).
- **A-4 No skip-to-content / landmark labelling** — VERIFIED. `main` exists ([AppShell.tsx:24](frontend/src/components/layout/AppShell.tsx#L24)) but there is no skip link and the icon-only avatar menu has no `aria-expanded`.

---

## 3. P1 — Data/UX correctness

- **D-1 Dashboard "projection" vs server truth diverge** — VERIFIED. Horizon chips reproject retention **client-side** via `projectRetention` ([useDashboardData.ts:52-59](frontend/src/lib/useDashboardData.ts#L52-L59)), using thresholds (`0.72/0.5/0.28`, [Dashboard.tsx:103-106](frontend/src/pages/Dashboard.tsx#L103-L106)) that **differ from the backend's** `classify_retention` (`0.8/0.5/0.2`, [decay_engine.py:78-85](backend/core/decay_engine.py#L78-L85)). So "Now" counts from `/api/stats` and the projected counts use different cutoffs — the bucket numbers can jump when you toggle from "Now" to "+24h" purely from the threshold mismatch, not real decay.
- **D-2 Calendar reminders are a local approximation** — VERIFIED (sub-agent + types). `CalendarPage` predicts "forget dates" from a client Ebbinghaus curve, not the backend FSRS `fsrs_due`. Two different schedulers shown as one truth. Either label as "estimate" or read `fsrs_due`.
- **D-3 Category color/emoji keyed off mismatched taxonomy** — VERIFIED. `categoryColors[category]` and `CATEGORY_EMOJI` expect lowercase keys like `technical/personal/general` ([Dashboard.tsx:55-70](frontend/src/pages/Dashboard.tsx#L55-L70)) but the backend emits `"Computer Science"`, `"AI/ML"`, etc. The `?? general` / `?? '📝'` fallbacks mask it, so most real categories render as the generic note emoji/color. (Root cause = AUDIT P4-1 taxonomy split.)

---

## 4. P2 — Polish, performance, dead code

- **U-7 Dead components in the bundle** — VERIFIED. `ChunkCard.tsx`, `Card3D.tsx`, `AnimatedBackground.tsx` are imported nowhere (`grep`). Empty/stub mock JSON (`mock_chunks.json = []`). Remove or wire.
- **U-8 No list virtualization** — VERIFIED (sub-agent). Library renders up to `getAllChunks(2000)` rows directly; Calendar builds an all-chunks map. Fine at demo scale, will jank at 1k+.
- **U-9 `mammoth.browser` is 499 KB (125 KB gz)** — VERIFIED (build output). It's used for client-side .docx parsing. It dominates the bundle; should be dynamically `import()`-ed only when a .docx is actually chosen.
- **U-10 SearchBar debounce recreated per render** — reported by sub-agent ([SearchBar.tsx:25-29]) — would weaken debouncing; verify and memoize.
- **U-11 Demo offline-login fabricates a logged-in state with no token** ([AuthContext.tsx:46-51]) — user sees the app shell but every call 401s; confusing. (AUDIT P1-4.)

---

## 5. What's genuinely good (so we don't break it)
- Coherent token system + dark-text-on-warm-paper palette; consistent `app-card`, `btn-primary/secondary/ghost`, `tag` primitives ([index.css](frontend/src/index.css)).
- Real empty + loading states on Dashboard and Search (skeletons, "All caught up", "Start with a concept").
- Sensible route structure + `ErrorBoundary` wrapping the authed app ([App.tsx:40-58](frontend/src/App.tsx#L40-L58)).
- Single-flight refresh-token logic to avoid racing refreshes ([tokens.ts:30-60](frontend/src/lib/tokens.ts#L30-L60)).

---

## 6. Prioritized UI work (drives Agent 4 implementation)
| ID | Fix | Effort | Validates |
|---|---|---|---|
| U-1 | Mobile nav drawer (reuse `navGroups`) | M | build + manual |
| U-2 | DOMPurify-sanitize all `dangerouslySetInnerHTML` | S | build |
| U-3 | Clear stale results on error; add global "offline" surface | S | build |
| A-1..A-4 | aria-labels, focus trap + `Esc` + `role=dialog`, skip link, non-color status | M | build |
| D-1/D-3 | Align client thresholds + category taxonomy with backend | S | build |
| U-7 | Delete dead components/mocks | S | build |
| U-9 | Lazy-load `mammoth` | S | build |

Implemented subset + verification is recorded in `QA_REPORT.md`. Because no browser run is possible here, every UI change is validated by `tsc` + `vite build` and marked **UNVERIFIED (runtime)** for pixel-level behavior.
