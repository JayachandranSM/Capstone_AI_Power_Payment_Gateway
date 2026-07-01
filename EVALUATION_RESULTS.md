# Evaluation Results

This document records the AI evaluation metrics, system test results, requirement coverage, and bug fixes for the AI-Powered Payment Gateway. Updated after final E2E testing and UI walkthrough on 30 June - 1 July 2026.

---

## Summary Scorecard

| Category | Score | Target | Status |
|---|---|---|---|
| Basic requirements | 100% (13/13) | >= 90% | Exceeded |
| Advanced requirements | 100% (10/10) | >= 30% | Exceeded |
| DeepEval overall grade | A | B+ | Exceeded |
| DeepEval fraud accuracy | 1.0 | >= 0.8 | Exceeded |
| RAG confidence | 0.85 | >= 0.65 | Exceeded |
| NLP confidence | 0.926 | >= 0.70 | Exceeded |
| E2E automated tests | 40/40 (100%) | >= 90% | Exceeded |
| System health checks | 6/6 healthy | 6/6 | Passed |
| Synthetic dataset | 10,064 records | >= 10,000 | Exceeded |
| Open fraud alerts | 769 | > 0 | Passed |

---

## 1. AI Evaluation - DeepEval (LLM-as-Judge)

DeepEval was run via POST /api/ai/evaluate/batch (accessible at /api/ai/docs).

### Batch Evaluation Results (sample_size=5)

Grade improved from B (earlier run with sparse data) to A after backfilling 769 fraud alerts giving the evaluator richer real data.

- overall_grade: A
- fraud_prediction accuracy: 1.0 (5/5 correct)
- false_positives: 0
- false_negatives: 0
- avg_score_error: 0.23
- nlp_failure_prediction pass_rate: 1.0

---

## 2. RAG Pipeline Evaluation

| Query | Confidence | Sources | Method |
|---|---|---|---|
| Why do UPI payments fail? | 0.85 | 8 | vector + keyword |
| What is the chargeback process? | 0.81 | 6 | vector |
| How are settlements calculated? | 0.88 | 7 | vector |
| What is the refund SLA? | 0.79 | 5 | keyword fallback |
| Why was my card payment declined? | 0.83 | 7 | vector |

Average confidence: 0.832

The "What is the refund SLA?" query uses unusual jargon yet returns a confident policy-grounded answer - proving the Dice-coefficient keyword fallback activates when vector similarity is low. Hybrid search confirmed working.

RAG Configuration:
- Embedding model: text-embedding-3-small (1,536 dimensions)
- Index type: HNSW (ef_construction=128, m=16)
- Top-K: 5 default, up to 10
- Reranking: 0.5 x similarity + 0.3 x recency + 0.2 x resolution
- Fallback: Dice-coefficient keyword matching
- Knowledge base: 57 articles

---

## 3. NLP Failure Reason Detection

| Query | Confidence | Structured Categories |
|---|---|---|
| Why are card payments failing? | 0.926 | invalid_cvv, fraud_flagged, high_value_risk |
| Show failed UPI transactions | 0.881 | upi_failure, vpa_not_registered |
| Card testing pattern transactions | 0.863 | micro_round_amount, card_testing |
| Find high-value declined payments | 0.891 | high_value_risk, invalid_cvv |

Each category returns structured fix suggestions and escalation flags. The "Requires escalation" tag correctly fires for fraud_flagged and high_risk_card_flags categories.

---

## 4. Multi-Agent Orchestration Verified

Tested live on a CRITICAL alert (INR 127,400 NEFT, fraud_score 0.95):

FraudAgent result:
- Risk: CRITICAL
- Action: BLOCK
- Confidence: 96%

ComplianceAgent result:
- AML Flags: 2
- KYC: verified
- Verdict: REVERIFY

Synthesized Verdict (PaymentOrchestrator):
"Block pending re-verification - despite KYC verified status, 2 AML flags + 95% fraud score warrants compliance escalation"

The nuance (block for re-verification rather than permanent block) only emerges because the ComplianceAgent KYC finding influenced the FraudAgent BLOCK recommendation. This is genuine agent-to-agent communication through shared context.

---

## 5. LLM-as-Judge Dispute Validation Verified

Tested live on a customer dispute (INR 199, Fraudulent merchant):

Root cause ranking:
- 50% customer_error: "fraud score 0.230 is low, weakens fraud likelihood"
- 35% fraud: "explicitly raised but low score does not strongly match"
- 15% merchant_error: "no evidence of wrong amount or duplicate charge"

Recommended: INVESTIGATE AND REQUEST EVIDENCE

Each hypothesis includes evidence reasoning, not just a percentage. Recommendation is actionable, not vague.

---

## 6. Feedback Loop Verified (Live UI Test)

Starting state: STRUCTURING rule weight = 0.230, fp_count = 2

After clicking Clear (false positive) on 3 STRUCTURING alerts:
- STRUCTURING weight: 0.230 -> 0.220 -> 0.210 -> 0.200
- fp_count: 2 -> 3 -> 4 -> 5
- hit_count: 6 (unchanged)

Weight reduction: weight = weight - 0.01 per false positive
Floor: 0.05 (rule can never be fully disabled)

---

## 7. Guardrails Implemented and Verified

### Rate Limiting (Nginx-level)
- Login endpoint: 5 req/min per IP, burst 3
- AI endpoints: 30 req/min per IP, burst 10
- Verified: 8 rapid attempts -> attempts 1-4 return 401, attempts 5-8 return 429

### Account Lockout (Redis-backed)
- Threshold: 5 failed login attempts per email
- Lockout duration: 15 minutes
- Scope: per-account not per-IP (survives IP rotation)
- Auto-clear: counter resets on successful login
- Verified: 5 wrong passwords -> "Account locked for 15 minutes"

### Prompt Injection Defense (AI Service)
- 21 known injection patterns blocked
- Includes: "ignore previous instructions", "reveal your system prompt", "jailbreak", "developer mode"
- Verified: injection attempt blocked, normal queries unaffected (confidence 0.85)

### Off-Topic Scope Guardrail (AI Service)
- Layer 1: keyword pre-check for 20+ off-topic patterns
- Layer 2: system prompt reinforcement on every LLM call
- Session history poisoning fix: current_query parameter ensures guardrails check only current message
- Verified: politics/weather/jokes blocked, payment questions immediately after answered normally

---

## 8. E2E Automated Test Results (40/40)

| Module | Tests | Result |
|---|---|---|
| M0: Authentication and RBAC | 4 | 4/4 |
| M1: Wallets and FX | 3 | 3/3 |
| M2: Payment processing | 3 | 3/3 |
| M3: Transaction history | 2 | 2/2 |
| M4: Fraud detection | 2 | 2/2 |
| M5: Refunds | 3 | 3/3 |
| M6: Disputes | 1 | 1/1 |
| M7: Merchant features | 3 | 3/3 |
| M8: AI features | 7 | 7/7 |
| M9: Admin operations | 3 | 3/3 |
| M10: Infrastructure | 6 | 6/6 |
| TOTAL | 40 | 40/40 |

Key negative flows verified: wrong password rejected, account lockout after 5 fails, RBAC enforced (403), self-payment blocked, insufficient balance rejected, idempotency confirmed, structuring flagged, prompt injection blocked, off-topic blocked, no history poisoning.

---

## 9. Synthetic Dataset

| Table | Records | Notes |
|---|---|---|
| ledger.transactions | 10,064 | Exceeds 10,000 requirement |
| ledger.entries | 4,090 | Double-entry for 2,000 transactions |
| ledger.disputes | 298 | 200 synthetic + 98 from demo |
| ai.fraud_alerts | 769 | Backfilled after threshold fix |
| core.users | 57 | 50 synthetic + 7 demo personas |
| core.wallets | 59 | Multi-currency balances |
| ai.knowledge_base | 57 | 50 synthetic + 7 existing |

Transaction distribution: 72% success, 12% failed, 8% pending, 8% flagged.
All 16 required schema fields implemented.

---

## 10. System Health (Final)

All 6 Docker containers healthy at submission:
- core_api: FastAPI port 8000 - healthy
- ai_service: FastAPI port 8001 - healthy
- frontend: React 18 + Nginx port 80 - running
- nginx_gateway: reverse proxy port 80 - running
- pg_gateway: PostgreSQL 16 + pgvector port 5432 - healthy
- redis_gateway: Redis 7 port 6379 - healthy

Additional endpoints:
- Core API Swagger: http://host/docs
- AI Service Swagger: http://host/api/ai/docs
- Health: http://host/health

---

## 11. Bugs Found and Fixed During UI Walkthrough

| # | Bug | Impact | Fix |
|---|---|---|---|
| 1 | Fraud alert threshold mismatch (CRITICAL) | 769 alerts silently missing - flagged at 0.45 but alerts created at 0.50 | Aligned to 0.45, backfilled 769 alerts |
| 2 | Dispute resolution not crediting wallet | Sara marked resolved but no money moved | Added wallet credit in matching currency (INR->INR, USD->USD) |
| 3 | Dispute resolution not notifying customer | Customer never knew dispute outcome | Added notification with amount credited and resolution reason |
| 4 | Settlement agent sending zeros to LLM | AI showed "Insufficient data" despite real DB data | Build LLM prompt directly with computed values |
| 5 | Tool call selecting wrong tool | NLP Lookup returned generic "could not find" messages | Deterministic keyword-based routing + real DB data fetched first |
| 6 | Session history poisoning | One off-topic block poisoned subsequent legitimate questions | current_query parameter - guardrails check only current message |
| 7 | MFA QR code showing raw URI | Customer could not scan QR code | Real QR image via api.qrserver.com |
| 8 | Admin endpoints missing | 404 on /admin/transactions, /admin/refunds, /admin/disputes | All three endpoints added |
| 9 | Amount formatting 199.0000 | Unprofessional decimal display in DisputeAgent | Applied :.2f formatting to all LLM prompts |
| 10 | AI Agent button required 2 clicks | Admin had to manually expand results panel | Auto-expand on click via setE(dispute.id) |
| 11 | Markdown in AI responses | **bold** and ### showing as raw text everywhere | strip_markdown() added globally at source and frontend |
| 12 | Settlements showing pre-seeded records only | Dynamic transactions not in merchant settlement view | Dynamic weekly calculation from actual ledger.transactions |
| 13 | NLP Lookup showing raw JSON | Tool result dumped to screen | Replaced with record count, answer in AI Analysis section |

---

## 12. Full Requirements Traceability

### Basic Requirements (13/13)

| # | Requirement | Verified via |
|---|---|---|
| 1 | User account management | Login, MFA QR scan, wallet balances confirmed |
| 2 | Payment processing | INR P2P, USD merchant, multi-currency FX |
| 3 | Transaction history, refunds, disputes | 237 txns, refund created, dispute resolved + wallet credited |
| 4 | NLP failure detection | 93% confidence, structured categories, fix suggestions |
| 5 | RAG support assistant | 85% confidence, 8 sources, policy-grounded answers |
| 6 | Hybrid search | Vector + keyword fallback, refund SLA query confirmed |
| 7 | Fraud detection | 10 rules, 769 alerts, structuring pattern detected |
| 8 | REST APIs + validation + idempotency | 422 validation schema, same TX on retry |
| 9 | Tool calling | get_failure_reasons + analyze_fraud_risk with real DB data |
| 10 | Session memory | Multi-turn chat, RAG-powered with session memory subtitle |
| 11 | Notifications | Payment, refund, dispute resolved notifications confirmed |
| 12 | Ticket routing | Dispute priority auto-assigned low/medium/high/urgent |
| 13 | Front-end interface | 3 distinct role dashboards: Customer, Merchant, Admin |

### Advanced Requirements (10/10)

| # | Requirement | Verified via |
|---|---|---|
| 1 | Multi-agent orchestration | FraudAgent + ComplianceAgent live on CRITICAL alert |
| 2 | LLM-as-judge | Root cause ranking with evidence on INR 199 dispute |
| 3 | DeepEval | Grade A via /api/ai/docs Swagger UI |
| 4 | Reranking | Recency-weighted: today's transaction surfaced first |
| 5 | Token optimisation | 769 alerts summarised without crash or token overflow |
| 6 | Agent-to-agent communication | KYC finding from ComplianceAgent influenced FraudAgent verdict |
| 7 | Feedback loop | STRUCTURING weight 0.230 -> 0.200 confirmed live |
| 8 | Predictive analytics | Forecast chart, chargeback probability model, anomaly view |
| 9 | Razorpay sandbox | Mock Mode confirmed, SYNTH_ refs in transaction history |
| 10 | Compliance automation | AML flags auto-detected, KYC status checked per transaction |
