# Architecture Decision Records (ADR)

12 key architectural decisions made during the design and build.

---

## ADR-001 — PostgreSQL over NoSQL
**Decision:** Use PostgreSQL 16 as primary database.
**Reason:** ACID transactions are non-negotiable for double-entry ledger correctness. pgvector extension lets us store AI embeddings co-located with transaction data.

## ADR-002 — 4 Isolated Schemas
**Decision:** core · ledger · ai · ops schemas.
**Reason:** Schema-level isolation mirrors domain boundaries. The AI service only connects to ai and ledger schemas.

## ADR-003 — Redis Two-Key Idempotency
**Decision:** Lock key (prevents concurrent duplicates) + result key (handles retries).
**Reason:** Prevents double charges on network retries. Industry-standard pattern (Stripe/Razorpay).

## ADR-004 — Hexagonal Architecture
**Decision:** Domain logic isolated from FastAPI adapters.
**Reason:** Business rules testable without database or HTTP server.

## ADR-005 — pgvector over Pinecone
**Decision:** pgvector HNSW index (ef_construction=128, m=16).
**Reason:** Zero additional infrastructure. Embeddings co-located with transactions. 95% recall at sub-10ms.

## ADR-006 — Azure OpenAI over Self-Hosted
**Decision:** GPT-5.4-mini (fast) + GPT-5.4 (heavy) via Azure.
**Reason:** Enterprise SLA. No GPU infrastructure. Prodapt Azure subscription active.

## ADR-007 — Deterministic Rules + LLM Explanation
**Decision:** 10-rule scoring engine, flagging threshold 0.45, LLM explains in plain English.
**Reason:** Rules are auditable for regulators. LLM adds human-readable context. Feedback loop adjusts weights.

## ADR-008 — Multi-Agent Orchestrator Pattern
**Decision:** PaymentOrchestrator coordinates FraudAgent, ComplianceAgent, DisputeAgent, MerchantAgent.
**Reason:** Specialist agents produce higher quality outputs. Parallelisable. Traceable.

## ADR-009 — Redis-backed Chat Sessions
**Decision:** Session history stored in Redis with UUID, 24h TTL, last 10 turns.
**Reason:** Redis already in stack. Session-scoped (not user-scoped). Turn counter shows context depth.

## ADR-010 — React 18 Single SPA with Role Routing
**Decision:** One SPA, RoleRoute guard, redirects to /customer, /merchant, or /admin post-login.
**Reason:** Single build artifact. RBAC enforced server-side as real security layer.

## ADR-011 — Double-Entry Ledger
**Decision:** Every payment creates debit + credit entries. Zero-imbalance invariant enforced.
**Reason:** Accounting correctness. Every balance change has a corresponding ledger entry.

## ADR-012 — Docker Compose over Kubernetes
**Decision:** 6 services via Docker Compose on single WSL2 VM.
**Reason:** One command starts everything. No K8s cluster needed for demo. Right-fit for scope.
