ALTER TABLE "users" ADD COLUMN     "wa_chat_jid" TEXT,
ADD COLUMN     "onboarding_welcome_sent_at" TIMESTAMPTZ,
ADD COLUMN     "last_inbound_at" TIMESTAMPTZ,
ADD COLUMN     "last_daily_summary_for_date" TEXT,
ADD COLUMN     "last_pin_nudge_at" TIMESTAMPTZ;

CREATE INDEX "users_wa_chat_jid_idx" ON "users" ("wa_chat_jid");

UPDATE "users" u
SET
  onboarding_welcome_sent_at = COALESCE(u.onboarding_welcome_sent_at, u.created_at),
  last_inbound_at = sub.max_at
FROM (
  SELECT user_id, MAX(received_at) AS max_at
  FROM "messages"
  WHERE direction = 'INBOUND'
  GROUP BY user_id
) sub
WHERE u.id = sub.user_id;
