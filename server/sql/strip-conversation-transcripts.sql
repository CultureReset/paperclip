-- Owner-applied, not a migration (DECISIONS #34).
--
-- Conversation rows recorded before Paperclip kept only a reference carried
-- the transcript, the customer's number (`from`/`to`) and a summary in
-- `activity_log.details`. That is business state and lives in gcr-api-clean
-- (`live_conversations`). This removes those keys from the existing rows and
-- keeps everything else (channel, outcome and the reference fields), so the
-- audit trail stays. Re-running it is harmless.
--
-- Apply to the Paperclip database (never the business database):
--   psql "$DATABASE_URL" -f server/sql/strip-conversation-transcripts.sql

BEGIN;

UPDATE activity_log
SET details = details - 'transcript' - 'from' - 'to' - 'summary'
WHERE action = 'nextgent.conversation'
  AND details ?| ARRAY['transcript', 'from', 'to', 'summary'];

COMMIT;
