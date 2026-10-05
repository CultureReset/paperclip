-- Owner-applied, not a migration (DECISIONS #87, #34 pattern).
--
-- Routine runs started by gcr-api-clean's hand-off webhook before the agent
-- step sent references only carried the whole booking payload in
-- `routine_runs.trigger_payload`: the customer's name, email and phone, and
-- the `details` the booking was saved with. That is business state and lives
-- in gcr-api-clean. This removes those keys wherever they appear in the
-- payload — at the top level, under `booking`, and under `payload.booking`
-- (the hand-off body) — and keeps everything else (ids, dates, status, the
-- instructions), so the run history stays. Re-running it is harmless.
--
-- Apply to the Paperclip database (never the business database):
--   psql "$DATABASE_URL" -f server/sql/strip-routine-run-pii.sql

BEGIN;

-- Top-level customer fields (older hand-off bodies spread the booking).
UPDATE routine_runs
SET trigger_payload = trigger_payload
  - 'customer_name' - 'customer_email' - 'customer_phone' - 'name' - 'email' - 'phone' - 'address' - 'details' - 'customer' - 'guest'
WHERE trigger_payload ?| ARRAY['customer_name', 'customer_email', 'customer_phone', 'name', 'email', 'phone', 'address', 'details', 'customer', 'guest'];

-- trigger.payload.booking (the booking event as gcr-api-clean emitted it).
UPDATE routine_runs
SET trigger_payload = jsonb_set(
  trigger_payload,
  '{trigger,payload,booking}',
  (trigger_payload #> '{trigger,payload,booking}')
    - 'customer_name' - 'customer_email' - 'customer_phone' - 'name' - 'email' - 'phone' - 'address' - 'details' - 'customer' - 'guest'
)
WHERE jsonb_typeof(trigger_payload #> '{trigger,payload,booking}') = 'object'
  AND (trigger_payload #> '{trigger,payload,booking}') ?| ARRAY['customer_name', 'customer_email', 'customer_phone', 'name', 'email', 'phone', 'address', 'details', 'customer', 'guest'];

-- payload.booking (the hand-off body's details).
UPDATE routine_runs
SET trigger_payload = jsonb_set(
  trigger_payload,
  '{payload,booking}',
  (trigger_payload #> '{payload,booking}')
    - 'customer_name' - 'customer_email' - 'customer_phone' - 'name' - 'email' - 'phone' - 'address' - 'details' - 'customer' - 'guest'
)
WHERE jsonb_typeof(trigger_payload #> '{payload,booking}') = 'object'
  AND (trigger_payload #> '{payload,booking}') ?| ARRAY['customer_name', 'customer_email', 'customer_phone', 'name', 'email', 'phone', 'address', 'details', 'customer', 'guest'];

-- booking at the top level.
UPDATE routine_runs
SET trigger_payload = jsonb_set(
  trigger_payload,
  '{booking}',
  (trigger_payload #> '{booking}')
    - 'customer_name' - 'customer_email' - 'customer_phone' - 'name' - 'email' - 'phone' - 'address' - 'details' - 'customer' - 'guest'
)
WHERE jsonb_typeof(trigger_payload #> '{booking}') = 'object'
  AND (trigger_payload #> '{booking}') ?| ARRAY['customer_name', 'customer_email', 'customer_phone', 'name', 'email', 'phone', 'address', 'details', 'customer', 'guest'];

COMMIT;
