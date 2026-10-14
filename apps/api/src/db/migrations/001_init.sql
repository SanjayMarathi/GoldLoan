-- 001_init.sql – schema for the Gold Loan Portal.
-- Money is stored as integers: paise (1/100 rupee) or whole rupees. Weights as integer milligrams.
-- Percentages as basis points (1% = 100 bps). No floats anywhere.

CREATE TABLE loan_schemes (
  id                  text PRIMARY KEY,
  name                text    NOT NULL,
  repayment_type      text    NOT NULL CHECK (repayment_type IN ('BULLET', 'EMI')),
  annual_interest_bps integer NOT NULL CHECK (annual_interest_bps BETWEEN 1 AND 10000),
  -- the database itself refuses anything above the 75% cap
  max_ltv_bps         integer NOT NULL CHECK (max_ltv_bps BETWEEN 1 AND 7500),
  tenure_months       integer NOT NULL CHECK (tenure_months > 0),
  active              boolean NOT NULL DEFAULT true,
  sort_order          integer NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- GL-1001, GL-1002, ...
CREATE SEQUENCE application_seq START 1001;

CREATE TABLE leads (
  id                      bigserial PRIMARY KEY,
  application_id          text    NOT NULL UNIQUE,
  name                    text    NOT NULL CHECK (char_length(name) BETWEEN 2 AND 60),
  -- the real number is stored (needed for duplicate detection); it is masked on every way out
  mobile_number           text    NOT NULL CHECK (mobile_number ~ '^[6-9][0-9]{9}$'),
  gross_weight_mg         integer NOT NULL CHECK (gross_weight_mg > 0 AND gross_weight_mg <= 1000000),
  net_weight_mg           integer NOT NULL CHECK (net_weight_mg > 0 AND net_weight_mg <= gross_weight_mg),
  karat                   smallint NOT NULL CHECK (karat IN (18, 22, 24)),
  plan_id                 text    NOT NULL REFERENCES loan_schemes (id),
  plan_name               text    NOT NULL,
  rate_per_gram_24k_paise bigint  NOT NULL CHECK (rate_per_gram_24k_paise > 0),
  pure_gold_mg            integer NOT NULL CHECK (pure_gold_mg > 0),
  gold_value_paise        bigint  NOT NULL CHECK (gold_value_paise > 0),
  loan_amount_rupees      bigint  NOT NULL CHECK (loan_amount_rupees >= 0),
  status                  text    NOT NULL DEFAULT 'SUBMITTED'
                          CHECK (status IN ('SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED')),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

-- duplicate check: "same mobile within 7 days"
CREATE INDEX leads_mobile_created_idx ON leads (mobile_number, created_at DESC);
-- admin table: newest first
CREATE INDEX leads_created_idx ON leads (created_at DESC, id DESC);
CREATE INDEX leads_plan_idx ON leads (plan_id);

CREATE TABLE lead_audit (
  id             bigserial PRIMARY KEY,
  application_id text NOT NULL REFERENCES leads (application_id),
  event          text NOT NULL CHECK (event IN ('CREATED', 'STATUS_CHANGED')),
  from_status    text,
  to_status      text,
  actor          text NOT NULL,
  channel        text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lead_audit_application_idx ON lead_audit (application_id, id);

-- Idempotency-Key support: replay the original response for a retried POST /leads
CREATE TABLE idempotency_keys (
  key           text PRIMARY KEY,
  request_hash  text    NOT NULL,
  status_code   integer NOT NULL,
  response_body jsonb   NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
