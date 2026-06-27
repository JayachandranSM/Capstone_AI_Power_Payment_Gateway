# AI-Powered Payment Gateway

Production-grade fintech platform · Prodapt Capstone · June 2026

**App:** http://172.21.155.61 | **API Docs:** http://172.21.155.61/docs

## Quick Start
```bash
git clone https://github.com/JayachandranSM/Capstone_AI_Power_Payment_Gateway.git
cd Capstone_AI_Power_Payment_Gateway && docker compose up -d
```

## Demo Credentials
| Persona | Email | Password | Role |
|---|---|---|---|
| Priya Sharma | priya@example.com | Admin@123 | Customer · UPI · INR |
| Carlos Mendez | carlos@example.com | Admin@123 | Customer · Card · USD |
| Raj Patel | raj@merchant.com | Admin@123 | Merchant |
| Sara Chen | sara@paygw.com | Admin@123 | Support Admin |

## Tech Stack
- **Frontend:** React 18 + TypeScript + Vite + TailwindCSS
- **Core API:** FastAPI + SQLAlchemy async + Pydantic v2
- **AI Service:** FastAPI + Azure OpenAI GPT-5.4 + pgvector HNSW
- **Database:** PostgreSQL 16 + pgvector
- **Cache:** Redis 7 (idempotency + FX cache + sessions)
- **Container:** Docker Compose (6 services, one-command startup)

## Evaluation
| Metric | Score | Target |
|---|---|---|
| Basic requirements | 95%+ | ≥ 90% ✅ |
| Advanced requirements | 85%+ | ≥ 30% ✅ |
| DeepEval grade | A (accuracy 1.0) | B+ ✅ |
| RAG confidence | 0.85 | ≥ 0.65 ✅ |
| NLP confidence | 0.919 | ≥ 0.70 ✅ |
| E2E tests | 49/49 (100%) | ≥ 90% ✅ |

## Author
Jayachandran Swarnamoorthy | Mentor: Siva | Prodapt Capstone June 2026
