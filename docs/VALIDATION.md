# Validation record

Validated on 24 October 2026 against the local Docker deployment, PostgreSQL 18.4 and native Ollama `qwen3:4b-instruct-2507-q4_K_M`. Results describe this disposable lab, not a production benchmark or a long-term reliability guarantee.

## Completed checks

- **33 core tests passed.** Fixed action registry, incident/target inspection guards, typed policy changes, current-policy approval recheck, absent evidence, idle/unknown replication lag, directive interruption, planner recovery, exhausted action attempts and current-evidence precedence over historical memory; hybrid intent/query guards, vector validation, UTF-8 semantic excerpt bounds, full stored text beyond the former content cap, exhaustive-list versus relevance semantics and generation-aware SQL provenance.
- **Live baseline integration passed.** Actual primary and physical standby, streaming sender, non-superuser accounts, restricted monitoring/execution grants, state API, pause controls and unknown fixture rejection.
- **Autonomous statistics flow passed.** An injected 10,000-row change caused the local model to inspect statistics and propose the fixed `ANALYZE` tool. The target result verified, a human acknowledgement persisted feedback in memory, and repeating the completion did not duplicate it.
- **Targeted control-only regressions passed.** Two human reviews on one action retain separate linked feedback memories; an incident recurrence has a generation-specific investigation review; an expired final action claim escalates to a human and cannot cause a third attempt. These regression records are clearly labelled synthetic control-only records and cleaned up after the tests.

## Actual target actions observed

| Action | Representative verified action ID | Evidence |
| --- | --- | --- |
| Statistics refresh | `3aa9069a-ca1d-4dd7-9bc5-f68aea92c547` | Fresh table statistics after a real row-update fixture |
| Standby replay recovery | `c1a82981-7d48-4a2b-8459-dbf920d040d4` | Replay resumed, receiver streaming, bounded sender/replay WAL byte distance |
| Fixed-role privilege repair | `13785681-cb01-41b8-9620-fca3a0ae8872` | `CREATEROLE` removed only from `verdant_risky_login` |
| Fixed index tuning | `ed2a4750-3a15-4e27-b910-357e8b3e816a` | Fixed customer index exists and actual before/after EXPLAIN evidence retained |
| Tagged blocker repair | `dcda4eb1-f459-4452-a647-736dfba12473` | Only the known workload database, fixture user and exact blocker application tag are eligible |

The action records store actual before/after observations and verification timestamps. An EXPLAIN access-path change is not a latency benchmark. Query statistics shown in the console are cumulative.

## Reproduce

From the repository root with the stack running:

```sh
npm test
npm run integration
node test/integration.mjs --full
node test/supervision.mjs
```

The last two commands inject actual disposable fixtures. Do not run them during a recording. The supervision test leaves broader autonomy, a 40-actions/hour rehearsal budget, cleared fixtures and retained review/memory history. The fresh-install default is 12 actions/hour. This running conference lab retains 40 while rehearsing; reduce it after the recent validation-attempt window expires.

Security scope remains privilege posture, not authentication-log attack detection. Both API and worker currently share lab secret mounts, as described in OPERATIONS.md. Services persist in named volumes and restart under Docker; this validation does not assert host-loss tolerance, autonomous failover, backup/PITR verification or production readiness.

## Live supervision and restart check

The final live supervision regression passed from `2026-10-24T04:30:18Z` to `04:31:43Z`:

| Check | Recorded result |
| --- | --- |
| Prior approval enforced | The standby remained replay-paused while action `2882a1c0-70aa-48d6-a56a-af90f8830159` waited for approval. A pending proposal appeared after 36.6 seconds. |
| Approval executed and verified | Approval review `0081762b-bd25-4391-b841-0e681f28da3c` released that action. Replay recovery verified 7.4 seconds after the approval. |
| Acknowledgement retained separately | Review `dff15dbf-95c0-4fac-b1b9-6860f86fbb85` recorded post-action feedback. Exactly two human-feedback memories reference the two distinct reviews on this one action. |
| Idempotent decisions | Repeating both approval and acknowledgement left the feedback-memory count at two. |
| Worker restart | Only the worker container restarted. Both feedback memories remained. The worker produced two fresh monitoring cycles and a new heartbeat without any browser or cycle-trigger request. The verified action count for that incident generation stayed at one. Resume evidence appeared after 18.9 seconds. |
| Real tagged blocker | Action `f8db2e7b-c3e9-424b-8865-54f25fb915ba` ended the fixture blocker and verified clear waiting work after 19.9 seconds. A direct target query confirmed zero matching `verdant-demo-blocker` sessions remained. |

The test left all fixtures cleared, old validation acknowledgement/investigation reviews completed with explicit notes, no old pending approvals, and all history/memory intact. Agent actions were unpaused with broader disposable-lab autonomy and a 40-actions/hour recording budget. The fresh-install default remains 12; the running rehearsal lab retains 40 so the recent validation attempts do not prevent another demonstration. Timings are observations from this local run, not a performance guarantee.

## Observed model error and grounding correction

During a later query-tuning recurrence (generation 3), current database evidence showed `indexExists: false` and a sequential scan. The model nevertheless relied on an earlier repair memory, claimed the index already existed and stated an unsupported latency improvement. Deterministic guards kept the incident open and queued investigation review `95bf9e6b-e16c-4e2b-bd67-01630b118335`; that incorrect conclusion caused no target write.

The planner context was corrected to prioritize current database findings, label model summaries as unverified and omit raw historical plans/cumulative counters from recalled memory. After deployment, the independent worker selected `inspect_queries` → `propose_action` → `finish_cycle` and verified the real index repair as action `286a7cf8-5094-421c-8f87-b46452b82fd9`, without forced target SQL or a synthetic fallback. Both resulting review items were acknowledged with feedback.

This correction improved the observed run; it does not guarantee model accuracy. Current database evidence and verified action receipts remain authoritative, and an access-path change still establishes no latency improvement on its own.

## Hybrid schema installation — 26 October 2026

The additive pgvector/control-schema upgrade was applied twice successfully against the existing lab volume. PostgreSQL reported vector extension version `0.8.7`, `agent.search_document` owned by `verdant_control`, and seven indexes including its primary/unique indexes. The pre-upgrade records remained: 41 memories and 226 events in the measured preservation check. These are snapshot counts; normal worker activity can add later records.

A separate temporary control container also completed fresh initialization with vector `0.8.7`, the search table owned by `verdant_control`, and both target records present. That temporary container was removed. These installation checks establish repeatable migration and preservation of existing state; retrieval behavior was checked separately below.

## Hybrid retrieval checks — 26 October 2026

The live isolated control-database integration passed using real Nomic vectors. It checked inclusive/exclusive date boundaries, mandatory category and literal-keyword filters, exact totals/pagination, retrieval without a query embedding, and SQL provenance. A historical event with an unknown generation retained its own captured SQL without inheriting a later action merely through shared incident identity. The existing primary/standby, role and dashboard-control integration also passed.

The requested query, “Give me a list of all events and SQL queries associated with them in the last 2 days where performance degraded”, returned 53 retained events in the measured rolling interval. Its first page contained 25 events; 21 of those results included associated SQL evidence. This is a count of retained recorded concerns and outcomes, not proof of a measured latency regression, a complete execution audit or a permanent result count.

Calibration on the real corpus showed that the initial `0.35` cosine cutoff was too broad. At the final `0.60` cutoff, a lock-contention paraphrase retained ten semantic matches, with the leading blocker match approximately `0.710`; an unrelated chocolate-cake question had maximum similarity approximately `0.481` and no semantic matches. These observations motivated a lab-specific retrieval cutoff. They do not establish confidence, general relevance accuracy or correct diagnosis. Recognized exhaustive performance/date listings retain all hard-filtered corpus rows independently of the semantic cutoff.

Final focused API checks repeated the 53-event example, ten lock-paraphrase results and zero results for an unrelated beach question. A completed backfill sample reported 2,360 of 2,360 corpus documents embedded and zero pending source records. New worker records continue to arrive, so those coverage counts are a point-in-time observation.

Final browser checks observed a 17-pixel body font, six recent-memory cards, readable summaries/time chips, collapsed advanced filters, successful hybrid results, no console errors and no horizontal overflow at a 390-pixel mobile viewport. These are local UI checks, not a cross-browser or accessibility certification.

## Delivered conference recording

The five-minute silent, captioned video uses actual local lab captures edited for presentation pacing. It shows automatic replay recovery (`d98a58ce-d546-41ad-b96f-a3707f165262`), the fixed index action (`388a3136-ab6e-482e-b75d-bf35ef469458`), and a deliberately paced approval flow. The latter verified action `7d09540c-a301-4d55-ae75-01fd83c8b1bf` after approval review `df84b61e-5117-4275-a270-126337a356c2`, followed by separate acknowledgement `01686106-414a-4951-8616-300ffb9caf4a` and feedback memory. No monitoring values or target action receipts were fabricated. Model prose remains untrusted; the clip does not establish a latency improvement.

After capture, broader disposable-lab autonomy was restored, all pending demonstration follow-ups were checked with notes, and both targets were healthy and streaming with zero measured WAL byte gap at the final sample.

Presentation delivery checks also passed: 22 slides, native click builds on 19 slides, transitions on all slides, a native table, and the exact 300-second H.264 recording embedded on slide 20. Microsoft PowerPoint opened the deck without repair, displayed the poster, started the movie on click and showed advancing frames. The loop diagram's staged builds and connectors were checked in Slide Show.

## Complete schema and portal wording — 26 October 2026

The live schema endpoint was checked against the PostgreSQL catalogue: all 14 agent tables and all 131 columns matched in name, order and SQL type. This includes `agent.search_document.embedding` as `vector(768)` and `agent.run.recalled_memory_ids` as `uuid[]`. Browser checks passed for expanding all 131 columns, collapsing them, the removed portal label, no JavaScript errors and no overflow at a 390-pixel viewport. Generated-column expressions are identified separately from defaults. The existing 33 core tests passed. Portal wording and the active directive were updated; historical events and memory remain intact.
