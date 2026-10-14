-- 002_lead_plan_terms.sql – snapshot the plan terms on every lead.
-- An application keeps the offer it was given (interest, tenure, LTV, repayment type) even if the plan
-- is edited later, so the EMI / interest shown to the applicant and the admin can always be recomputed exactly.

ALTER TABLE leads
  ADD COLUMN repayment_type      text,
  ADD COLUMN annual_interest_bps integer,
  ADD COLUMN tenure_months       integer,
  ADD COLUMN applied_ltv_bps     integer;

-- Leads filed before this migration take the terms of their plan as it is now.
UPDATE leads AS l
SET repayment_type      = s.repayment_type,
    annual_interest_bps = s.annual_interest_bps,
    tenure_months       = s.tenure_months,
    applied_ltv_bps     = LEAST(s.max_ltv_bps, 7500)
FROM loan_schemes AS s
WHERE s.id = l.plan_id;

ALTER TABLE leads
  ALTER COLUMN repayment_type      SET NOT NULL,
  ALTER COLUMN annual_interest_bps SET NOT NULL,
  ALTER COLUMN tenure_months       SET NOT NULL,
  ALTER COLUMN applied_ltv_bps     SET NOT NULL,
  ADD CONSTRAINT leads_repayment_type_check      CHECK (repayment_type IN ('BULLET', 'EMI')),
  ADD CONSTRAINT leads_annual_interest_bps_check CHECK (annual_interest_bps BETWEEN 1 AND 10000),
  ADD CONSTRAINT leads_tenure_months_check       CHECK (tenure_months > 0),
  -- the 75% cap is enforced by the database for every stored offer too
  ADD CONSTRAINT leads_applied_ltv_bps_check     CHECK (applied_ltv_bps BETWEEN 1 AND 7500);
