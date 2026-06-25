-- ============================================================
--  AI-Powered Payment Gateway — Database Initialisation
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS ledger;
CREATE SCHEMA IF NOT EXISTS ai;
CREATE SCHEMA IF NOT EXISTS ops;

-- ============================================================
--  SCHEMA: core
-- ============================================================

CREATE TYPE core.user_role AS ENUM ('customer', 'merchant', 'admin');
CREATE TYPE core.kyc_status AS ENUM ('pending', 'verified', 'failed', 'expired');

CREATE TABLE core.users (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email               VARCHAR(255) UNIQUE NOT NULL,
    phone               VARCHAR(20),
    full_name           VARCHAR(255) NOT NULL,
    hashed_password     TEXT NOT NULL,
    role                core.user_role NOT NULL DEFAULT 'customer',
    kyc_status          core.kyc_status NOT NULL DEFAULT 'pending',
    mfa_enabled         BOOLEAN NOT NULL DEFAULT FALSE,
    mfa_secret          TEXT,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    country_code        CHAR(2) NOT NULL DEFAULT 'IN',
    preferred_currency  CHAR(3) NOT NULL DEFAULT 'INR',
    password_reset_token TEXT,
    password_reset_expires TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_email ON core.users(email);
CREATE INDEX idx_users_role  ON core.users(role);

CREATE TABLE core.merchants (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id             UUID NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
    business_name       VARCHAR(255) NOT NULL,
    business_type       VARCHAR(100),
    api_key             VARCHAR(128) UNIQUE NOT NULL,
    api_secret_hash     TEXT NOT NULL,
    webhook_url         TEXT,
    settlement_currency CHAR(3) NOT NULL DEFAULT 'INR',
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_merchants_user_id ON core.merchants(user_id);
CREATE INDEX idx_merchants_api_key ON core.merchants(api_key);

CREATE TYPE core.wallet_status AS ENUM ('active', 'frozen', 'closed');

CREATE TABLE core.wallets (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
    currency        CHAR(3) NOT NULL DEFAULT 'INR',
    balance         NUMERIC(18,4) NOT NULL DEFAULT 0.0000,
    locked_balance  NUMERIC(18,4) NOT NULL DEFAULT 0.0000,
    status          core.wallet_status NOT NULL DEFAULT 'active',
    version         INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT balance_non_negative CHECK (balance >= 0),
    UNIQUE (user_id, currency)
);

CREATE INDEX idx_wallets_user_id ON core.wallets(user_id);

CREATE TABLE core.upi_handles (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
    handle      VARCHAR(100) UNIQUE NOT NULL,
    is_primary  BOOLEAN NOT NULL DEFAULT FALSE,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_upi_handle ON core.upi_handles(handle);

CREATE TABLE core.sessions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
    refresh_token   TEXT UNIQUE NOT NULL,
    expires_at      TIMESTAMPTZ NOT NULL,
    ip_address      INET,
    user_agent      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE core.currencies (
    code            CHAR(3) PRIMARY KEY,
    name            VARCHAR(100) NOT NULL,
    symbol          VARCHAR(10) NOT NULL,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    decimal_places  SMALLINT NOT NULL DEFAULT 2
);

INSERT INTO core.currencies VALUES
  ('USD','US Dollar','$',TRUE,2),
  ('EUR','Euro','€',TRUE,2),
  ('GBP','British Pound','£',TRUE,2),
  ('INR','Indian Rupee','₹',TRUE,2),
  ('JPY','Japanese Yen','¥',TRUE,0),
  ('AUD','Australian Dollar','A$',TRUE,2),
  ('CAD','Canadian Dollar','C$',TRUE,2),
  ('SGD','Singapore Dollar','S$',TRUE,2),
  ('AED','UAE Dirham','AED',TRUE,2),
  ('CNY','Chinese Yuan','¥',TRUE,2);

CREATE TABLE core.fx_rates (
    base_currency   CHAR(3) NOT NULL,
    quote_currency  CHAR(3) NOT NULL,
    rate            NUMERIC(18,8) NOT NULL,
    fetched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (base_currency, quote_currency)
);

-- ============================================================
--  SCHEMA: ledger
-- ============================================================

CREATE TYPE ledger.tx_type AS ENUM (
    'p2p','merchant_payment','refund','reversal',
    'wallet_topup','wallet_withdrawal','fee','settlement'
);
CREATE TYPE ledger.tx_status AS ENUM (
    'pending','processing','success','failed','flagged','reversed'
);
CREATE TYPE ledger.payment_method AS ENUM (
    'upi','card','bank_transfer','wallet','neft','rtgs','imps'
);
CREATE TYPE ledger.entry_direction AS ENUM ('debit','credit');
CREATE TYPE ledger.settlement_status AS ENUM (
    'pending','processing','settled','disputed','reversed','on_hold'
);

CREATE TABLE ledger.transactions (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    idempotency_key         VARCHAR(128) UNIQUE NOT NULL,
    sender_id               UUID REFERENCES core.users(id),
    receiver_id             UUID REFERENCES core.users(id),
    merchant_id             UUID REFERENCES core.merchants(id),
    amount                  NUMERIC(18,4) NOT NULL,
    currency                CHAR(3) NOT NULL,
    amount_usd              NUMERIC(18,4),
    fx_rate                 NUMERIC(18,8),
    type                    ledger.tx_type NOT NULL,
    status                  ledger.tx_status NOT NULL DEFAULT 'pending',
    payment_method          ledger.payment_method NOT NULL,
    upi_handle_sender       VARCHAR(100),
    upi_handle_receiver     VARCHAR(100),
    failure_reason          TEXT,
    fraud_score             NUMERIC(4,3) DEFAULT 0.000,
    chargeback_flag         BOOLEAN NOT NULL DEFAULT FALSE,
    chargeback_probability  NUMERIC(4,3) DEFAULT 0.000,
    settlement_status       ledger.settlement_status DEFAULT 'pending',
    sandbox_provider        VARCHAR(50),
    sandbox_ref             VARCHAR(128),
    metadata                JSONB DEFAULT '{}',
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT amount_positive CHECK (amount > 0)
);

CREATE INDEX idx_tx_sender   ON ledger.transactions(sender_id, created_at DESC);
CREATE INDEX idx_tx_receiver ON ledger.transactions(receiver_id, created_at DESC);
CREATE INDEX idx_tx_merchant ON ledger.transactions(merchant_id, created_at DESC);
CREATE INDEX idx_tx_status   ON ledger.transactions(status);
CREATE INDEX idx_tx_fraud    ON ledger.transactions(fraud_score DESC) WHERE fraud_score > 0.5;
CREATE INDEX idx_tx_created  ON ledger.transactions(created_at DESC);
CREATE INDEX idx_tx_idem     ON ledger.transactions(idempotency_key);

CREATE TABLE ledger.entries (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    transaction_id  UUID NOT NULL REFERENCES ledger.transactions(id),
    wallet_id       UUID NOT NULL REFERENCES core.wallets(id),
    direction       ledger.entry_direction NOT NULL,
    amount          NUMERIC(18,4) NOT NULL,
    currency        CHAR(3) NOT NULL,
    balance_after   NUMERIC(18,4) NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_entries_tx     ON ledger.entries(transaction_id);
CREATE INDEX idx_entries_wallet ON ledger.entries(wallet_id, created_at DESC);

CREATE VIEW ledger.imbalance_check AS
SELECT transaction_id,
       SUM(CASE WHEN direction='credit' THEN amount ELSE -amount END) AS net
FROM   ledger.entries
GROUP  BY transaction_id
HAVING ABS(SUM(CASE WHEN direction='credit' THEN amount ELSE -amount END)) > 0.0001;

CREATE TYPE ledger.refund_status AS ENUM (
    'requested','approved','processing','completed','rejected'
);

CREATE TABLE ledger.refunds (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    original_tx_id  UUID NOT NULL REFERENCES ledger.transactions(id),
    refund_tx_id    UUID REFERENCES ledger.transactions(id),
    requester_id    UUID NOT NULL REFERENCES core.users(id),
    amount          NUMERIC(18,4) NOT NULL,
    currency        CHAR(3) NOT NULL,
    reason          TEXT NOT NULL,
    status          ledger.refund_status NOT NULL DEFAULT 'requested',
    approved_by     UUID REFERENCES core.users(id),
    rejection_reason TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TYPE ledger.dispute_status AS ENUM (
    'open','under_review','resolved_customer','resolved_merchant','escalated','closed'
);

CREATE TABLE ledger.disputes (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    transaction_id  UUID NOT NULL REFERENCES ledger.transactions(id),
    raised_by       UUID NOT NULL REFERENCES core.users(id),
    reason          TEXT NOT NULL,
    evidence        JSONB DEFAULT '[]',
    status          ledger.dispute_status NOT NULL DEFAULT 'open',
    assigned_to     UUID REFERENCES core.users(id),
    priority        VARCHAR(20) DEFAULT 'medium',
    resolution      TEXT,
    llm_analysis    TEXT,
    root_cause_rank JSONB DEFAULT '[]',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_disputes_status ON ledger.disputes(status);

CREATE TABLE ledger.settlements (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    merchant_id     UUID NOT NULL REFERENCES core.merchants(id),
    period_start    TIMESTAMPTZ NOT NULL,
    period_end      TIMESTAMPTZ NOT NULL,
    gross_amount    NUMERIC(18,4) NOT NULL,
    fees            NUMERIC(18,4) NOT NULL DEFAULT 0,
    tax             NUMERIC(18,4) NOT NULL DEFAULT 0,
    net_amount      NUMERIC(18,4) NOT NULL,
    currency        CHAR(3) NOT NULL,
    status          ledger.settlement_status NOT NULL DEFAULT 'pending',
    tx_count        INTEGER NOT NULL DEFAULT 0,
    summary_ai      TEXT,
    forecast_next   NUMERIC(18,4),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    settled_at      TIMESTAMPTZ
);

-- ============================================================
--  SCHEMA: ai
-- ============================================================

CREATE TABLE ai.transaction_embeddings (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    transaction_id  UUID NOT NULL REFERENCES ledger.transactions(id) ON DELETE CASCADE,
    content_text    TEXT NOT NULL,
    embedding       vector(1536),
    chunk_index     INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tx_embed_hnsw ON ai.transaction_embeddings
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

CREATE TABLE ai.knowledge_base (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title           TEXT NOT NULL,
    content         TEXT NOT NULL,
    category        VARCHAR(100),
    tags            TEXT[],
    embedding       vector(1536),
    view_count      INTEGER NOT NULL DEFAULT 0,
    helpful_count   INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_kb_embed_hnsw ON ai.knowledge_base
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

CREATE INDEX idx_kb_tags ON ai.knowledge_base USING gin(tags);

CREATE TYPE ai.alert_severity AS ENUM ('low','medium','high','critical');
CREATE TYPE ai.alert_status   AS ENUM ('open','investigating','resolved','false_positive');

CREATE TABLE ai.fraud_alerts (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    transaction_id  UUID NOT NULL REFERENCES ledger.transactions(id),
    fraud_score     NUMERIC(4,3) NOT NULL,
    severity        ai.alert_severity NOT NULL,
    rules_triggered JSONB DEFAULT '[]',
    llm_explanation TEXT,
    status          ai.alert_status NOT NULL DEFAULT 'open',
    resolved_by     UUID REFERENCES core.users(id),
    feedback        VARCHAR(20),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_alerts_status   ON ai.fraud_alerts(status, created_at DESC);
CREATE INDEX idx_alerts_severity ON ai.fraud_alerts(severity);

CREATE TABLE ai.llm_evaluations (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    eval_type       VARCHAR(50),
    query           TEXT NOT NULL,
    response        TEXT NOT NULL,
    context_docs    JSONB,
    faithfulness    NUMERIC(4,3),
    relevancy       NUMERIC(4,3),
    correctness     NUMERIC(4,3),
    overall         NUMERIC(4,3),
    judge_model     VARCHAR(100),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE ai.fraud_patterns (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    rule_name       VARCHAR(100) NOT NULL,
    weight          NUMERIC(4,3) NOT NULL,
    hit_count       INTEGER NOT NULL DEFAULT 0,
    false_positive  INTEGER NOT NULL DEFAULT 0,
    last_updated    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE ai.agent_sessions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_type    VARCHAR(50) NOT NULL,
    user_id         UUID REFERENCES core.users(id),
    messages        JSONB DEFAULT '[]',
    context         JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
--  SCHEMA: ops
-- ============================================================

CREATE TYPE ops.notif_type    AS ENUM ('payment','refund','fraud_alert','dispute','system','kyc');
CREATE TYPE ops.notif_channel AS ENUM ('in_app','email','sms','push');
CREATE TYPE ops.notif_status  AS ENUM ('pending','sent','delivered','failed','read');

CREATE TABLE ops.notifications (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
    type        ops.notif_type NOT NULL,
    channel     ops.notif_channel NOT NULL DEFAULT 'in_app',
    title       TEXT NOT NULL,
    body        TEXT NOT NULL,
    metadata    JSONB DEFAULT '{}',
    status      ops.notif_status NOT NULL DEFAULT 'pending',
    read_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notif_user   ON ops.notifications(user_id, created_at DESC);
CREATE INDEX idx_notif_status ON ops.notifications(status);

CREATE TYPE ops.ticket_status   AS ENUM ('open','in_progress','pending_customer','resolved','closed');
CREATE TYPE ops.ticket_priority AS ENUM ('low','medium','high','urgent');
CREATE TYPE ops.ticket_category AS ENUM ('payment_failure','fraud','refund','dispute','kyc','technical','other');

CREATE TABLE ops.tickets (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES core.users(id),
    transaction_id  UUID REFERENCES ledger.transactions(id),
    subject         TEXT NOT NULL,
    description     TEXT NOT NULL,
    category        ops.ticket_category NOT NULL DEFAULT 'other',
    status          ops.ticket_status NOT NULL DEFAULT 'open',
    priority        ops.ticket_priority NOT NULL DEFAULT 'medium',
    assigned_to     UUID REFERENCES core.users(id),
    tags            TEXT[],
    resolution      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tickets_status   ON ops.tickets(status, priority);
CREATE INDEX idx_tickets_assigned ON ops.tickets(assigned_to);

CREATE TABLE ops.audit_log (
    id          BIGSERIAL PRIMARY KEY,
    actor_id    UUID REFERENCES core.users(id),
    action      VARCHAR(100) NOT NULL,
    entity_type VARCHAR(100),
    entity_id   UUID,
    old_values  JSONB,
    new_values  JSONB,
    ip_address  INET,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_time ON ops.audit_log(created_at DESC);

-- ============================================================
--  Seed: Demo personas  (password = Admin@123 for all)
-- ============================================================

INSERT INTO core.users (id,email,full_name,hashed_password,role,kyc_status,country_code,preferred_currency) VALUES
  ('00000000-0000-0000-0000-000000000001','admin@paygw.com','System Admin',
   '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/KeKRtWH3y1vZO0tiu','admin','verified','IN','INR'),
  ('00000000-0000-0000-0000-000000000002','priya@example.com','Priya Sharma',
   '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/KeKRtWH3y1vZO0tiu','customer','verified','IN','INR'),
  ('00000000-0000-0000-0000-000000000003','carlos@example.com','Carlos Mendez',
   '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/KeKRtWH3y1vZO0tiu','customer','verified','US','USD'),
  ('00000000-0000-0000-0000-000000000004','raj@merchant.com','Raj Patel',
   '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/KeKRtWH3y1vZO0tiu','merchant','verified','IN','INR'),
  ('00000000-0000-0000-0000-000000000005','sara@paygw.com','Sara Chen',
   '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/KeKRtWH3y1vZO0tiu','admin','verified','SG','SGD');

INSERT INTO core.wallets (user_id,currency,balance) VALUES
  ('00000000-0000-0000-0000-000000000002','INR',25000.00),
  ('00000000-0000-0000-0000-000000000003','USD',500.00),
  ('00000000-0000-0000-0000-000000000003','EUR',200.00),
  ('00000000-0000-0000-0000-000000000004','INR',150000.00);

INSERT INTO core.upi_handles (user_id,handle,is_primary) VALUES
  ('00000000-0000-0000-0000-000000000002','priya@paygw',TRUE),
  ('00000000-0000-0000-0000-000000000004','rajshop@paygw',TRUE);

INSERT INTO core.merchants (user_id,business_name,business_type,api_key,api_secret_hash,settlement_currency) VALUES
  ('00000000-0000-0000-0000-000000000004','Raj Electronics','retail',
   'pk_live_demo_raj_merchant_001',
   '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/KeKRtWH3y1vZO0tiu','INR');

-- Seed initial fraud pattern weights
INSERT INTO ai.fraud_patterns (rule_name, weight) VALUES
  ('HIGH_AMOUNT',0.300),('NEW_ACCOUNT',0.250),('HIGH_VELOCITY',0.350),
  ('MICRO_ROUND_AMOUNT',0.200),('INTL_CARD',0.150),('KYC_UNVERIFIED',0.200),
  ('STRUCTURING',0.250),('RECENT_FAILURES',0.300),('NIGHT_TRANSACTION',0.100),
  ('CROSS_BORDER',0.150),('MULTIPLE_DEVICES',0.200),('ROUND_AMOUNT',0.100),
  ('DORMANT_ACCOUNT',0.200),('BULK_SMALL_TXNS',0.250),('VELOCITY_SPIKE',0.300);

COMMIT;
