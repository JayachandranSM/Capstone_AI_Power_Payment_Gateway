# AI-Powered Payment Gateway

A production-grade, full-stack payment platform with real-time fraud detection, multi-agent AI orchestration, and RAG-powered support — built as a Prodapt capstone project.

**Live demo:** `http://172.21.155.61` | **API docs:** `http://172.21.155.61/docs` | **GitHub:** `JayachandranSM/Capstone_AI_Power_Payment_Gateway`

---

## What it does

| Capability | Details |
|---|---|
| Multi-role access | Customer · Merchant · Support Admin — each with a distinct dashboard |
| Payments | UPI · Card · NEFT · RTGS · IMPS · multi-currency with live FX |
| Fraud detection | 10 weighted rules, real-time scoring, AI explanation via Azure OpenAI |
| Refunds & disputes | Full workflow with admin approve/reject and in-app notifications |
| AI support | RAG pipeline (pgvector HNSW) + NLP failure lookup + multi-agent orchestration |
| Sandbox | Razorpay sandbox integration with test cards and simulate-payment |

---

## Tech Stack

---

## Quick Start

### Prerequisites
- Docker + Docker Compose
- WSL2 (Windows) or Linux/macOS
- 4 GB RAM minimum

### One-command startup

```bash
git clone https://github.com/JayachandranSM/Capstone_AI_Power_Payment_Gateway.git
cd Capstone_AI_Power_Payment_Gateway
cp .env.example .env
docker compose up -d
```

Wait ~40 seconds for all services to initialise, then open `http://localhost`.

### Seed demo passwords (first time only)

```bash
HASH=$(docker exec core_api python3 -c \
  "from passlib.context import CryptContext; \
   ctx = CryptContext(schemes=['bcrypt'], deprecated='auto'); \
   print(ctx.hash('Admin@123'))")

docker exec pg_gateway psql -U pguser -d payment_gateway -c \
  "UPDATE core.users SET hashed_password='$HASH' \
   WHERE email IN ('priya@example.com','carlos@example.com',\
                   'raj@merchant.com','sara@paygw.com');"
```

### Environment variables (`.env`)

```env
AZURE_OPENAI_ENDPOINT=https://synapt-softbank.openai.azure.com
AZURE_OPENAI_KEY=<your-key>
AZURE_OPENAI_DEPLOYMENT=gpt-5.4-mini
AZURE_OPENAI_EMBEDDING=text-embedding-3-small
DATABASE_URL=postgresql+asyncpg://pguser:pgpass@pg_gateway:5432/payment_gateway
REDIS_URL=redis://redis_gateway:6379
SECRET_KEY=<your-jwt-secret>
RAZORPAY_KEY_ID=<sandbox-key>
RAZORPAY_KEY_SECRET=<sandbox-secret>
```

---

## Demo Credentials

| Persona | Email | Password | Role |
|---|---|---|---|
| Priya Sharma | priya@example.com | Admin@123 | Customer · UPI · INR |
| Carlos Mendez | carlos@example.com | Admin@123 | Customer · Card · USD |
| Raj Patel | raj@merchant.com | Admin@123 | Merchant · Raj Electronics |
| Sara Chen | sara@paygw.com | Admin@123 | Support Admin · Singapore |

---

## Project Structure
---

## Synthetic Dataset

The system includes a synthetic dataset meeting all specification requirements:
**Schema fields covered:** `transaction_id`, `user_id`, `merchant_id`, `amount`, `currency`, `payment_method`, `status`, `failure_reason`, `fraud_score`, `timestamp`, `chargeback_flag`, `settlement_status`, `resolution_notes`, `kyc_status`, `country_sender`, `country_receiver`

Generated with Python Faker — see `scripts/synthetic_data_fixed.sql`.

---

## API Overview

### Core API (`/api/v1/`)

| Method | Path | Description |
|---|---|---|
| POST | `/auth/login` | JWT login |
| POST | `/auth/signup` | Create account + wallet |
| POST | `/auth/forgot-password` | Generate reset token |
| POST | `/auth/reset-password` | Reset with token |
| POST | `/auth/mfa/setup` | Generate TOTP secret |
| POST | `/auth/mfa/verify` | Enable MFA |
| POST | `/payments/process` | Process payment (UPI/Card/NEFT etc.) |
| GET | `/transactions` | Transaction history (paginated, `items` key) |
| POST | `/refunds` | Request refund |
| GET | `/wallets` | Wallet balances |
| POST | `/wallets/topup` | Top up wallet |
| POST | `/wallets/convert` | FX conversion |
| GET | `/notifications` | In-app notifications |
| GET | `/merchants/me` | Merchant profile |
| GET | `/merchants/settlements` | Weekly settlement records |
| GET | `/merchants/transactions` | Merchant transaction history |
| GET | `/admin/fraud-alerts` | Fraud alert queue |
| GET | `/admin/fraud-patterns` | Fraud rule weights |
| GET | `/admin/transactions` | All transactions (admin) |
| GET | `/admin/refunds` | All refund requests (admin) |
| GET | `/admin/disputes` | All disputes (admin) |
| GET | `/admin/analytics` | Platform KPIs (`summary.total_transactions`) |
| GET | `/admin/users` | User management |

### AI Service (`/api/ai/`)

| Method | Path | Description |
|---|---|---|
| POST | `/rag/query` | Semantic search (confidence + sources) |
| POST | `/nlp/failure-reason` | NLP failure analysis |
| POST | `/tools/call` | Tool dispatch with real DB data |
| POST | `/fraud/explain` | LLM explanation of fraud alert |
| POST | `/agents/analyze-transaction` | Multi-agent transaction analysis |
| POST | `/agents/resolve-dispute` | DisputeAgent root-cause ranking |
| POST | `/agents/merchant-settlement` | MerchantAgent settlement analysis |
| POST | `/session/create` | Create AI support chat session |
| POST | `/session/chat` | Send message (with session memory) |
| GET | `/settlement/summary/{merchant_id}` | AI settlement summary |
| POST | `/evaluate/batch` | DeepEval batch scoring |

---

## Evaluation Results

| Metric | Score |
|---|---|
| Basic requirements | 95%+ |
| Advanced requirements | 85%+ |
| DeepEval grade | B (accuracy 1.0) |
| RAG confidence | 0.85 |
| NLP confidence | 0.926 |
| E2E test suite | 40/40 (100%) |
| Synthetic dataset | 10,064 records |
| Docker containers | 6/6 healthy |

See [EVALUATION_RESULTS.md](./EVALUATION_RESULTS.md) for full details including bug fixes applied.

---

## Sample End-to-End Flow

```bash
# 1. Login
curl -X POST http://localhost/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"priya@example.com","password":"Admin@123"}'
# Returns: {"access_token":"..."}

# 2. Process a payment
curl -X POST http://localhost/api/v1/payments/process \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -H "X-Idempotency-Key: unique-key-001" \
  -d '{"amount":500,"currency":"INR","payment_method":"upi","upi_handle":"rajshop@paygw"}'
# Returns: {"transaction_id":"...","status":"success","fraud_score":0.2}

# 3. Query AI support
curl -X POST http://localhost/api/ai/rag/query \
  -H "Content-Type: application/json" \
  -d '{"query":"Why do UPI payments fail?","top_k":5}'
# Returns: {"answer":"...","confidence":0.85,"sources":[...]}
```

---

## Author

**Jayachandran Swarnamoorthy** — Prodapt Capstone, June 2026
Mentor: Siva
