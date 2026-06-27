# Production Readiness

## What is Production-Ready Today
- JWT auth (HS256, 60min expiry)
- RBAC enforced at API layer
- MFA (TOTP) RFC 6238 compliant
- Bcrypt password hashing (cost 12)
- Pydantic v2 input validation
- Redis two-key idempotency
- Double-entry ledger with zero-imbalance invariant
- Optimistic concurrency on wallet updates
- Structured JSON logging (zero print() statements)
- Health endpoints (/health → status, db, redis)
- Graceful LLM fallback on Azure OpenAI timeout
- RAG keyword fallback on pgvector failure

## What Needs Work Before Production

### Infrastructure
| Item | Current | Required |
|---|---|---|
| Deployment | Docker Compose / single VM | Kubernetes (EKS/AKS) 3+ replicas |
| Database | Single PostgreSQL | Multi-AZ RDS + read replicas |
| Redis | Single node | Redis Cluster / ElastiCache |
| Secrets | .env file | Azure Key Vault |
| TLS | HTTP only | TLS at load balancer |
| Monitoring | Logs only | Prometheus + Grafana + PagerDuty |

### Security
- Rate limiting (Nginx per IP + per user)
- DDoS protection (Cloudflare / AWS Shield)
- WAF (Web Application Firewall)
- PII encryption at rest (AES-256 for card data)
- Dependency scanning (Snyk / Dependabot)

### Compliance (real payments)
- PCI-DSS Level 1 assessment
- RBI Payment Aggregator licence (India)
- GDPR / DPDP compliance
- Penetration testing (independent firm)

### Application
- Email notifications (SendGrid / SES)
- SMS OTP (Twilio / AWS SNS)
- Webhook delivery with retry queue
- Database migrations (Alembic)
- Automated backups to S3/Azure Blob
