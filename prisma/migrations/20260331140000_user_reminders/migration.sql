-- CreateEnum
CREATE TYPE "ReminderStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReminderRecurrence" AS ENUM ('NONE', 'DAILY', 'WEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "ReminderSource" AS ENUM ('TEXT', 'AUDIO', 'WHATSAPP_OTHER');

-- CreateTable
CREATE TABLE "user_reminders" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "notes" TEXT,
    "event_at" TIMESTAMP(3) NOT NULL,
    "all_day" BOOLEAN NOT NULL DEFAULT false,
    "notify_at" TIMESTAMP(3) NOT NULL,
    "early_minutes" INTEGER NOT NULL DEFAULT 15,
    "recurrence" "ReminderRecurrence" NOT NULL DEFAULT 'NONE',
    "recurrence_meta" JSONB,
    "status" "ReminderStatus" NOT NULL DEFAULT 'ACTIVE',
    "timezone" TEXT NOT NULL,
    "source_text" TEXT,
    "source" "ReminderSource" NOT NULL DEFAULT 'TEXT',
    "source_message_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),
    "canceled_at" TIMESTAMP(3),

    CONSTRAINT "user_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reminder_deliveries" (
    "id" UUID NOT NULL,
    "reminder_id" UUID NOT NULL,
    "slot_at" TIMESTAMP(3) NOT NULL,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reminder_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_reminders_user_id_status_notify_at_idx" ON "user_reminders"("user_id", "status", "notify_at");

-- CreateIndex
CREATE INDEX "user_reminders_status_notify_at_idx" ON "user_reminders"("status", "notify_at");

-- CreateIndex
CREATE INDEX "reminder_deliveries_reminder_id_idx" ON "reminder_deliveries"("reminder_id");

-- CreateUniqueIndex
CREATE UNIQUE INDEX "reminder_deliveries_reminder_id_slot_at_key" ON "reminder_deliveries"("reminder_id", "slot_at");

-- AddForeignKey
ALTER TABLE "user_reminders" ADD CONSTRAINT "user_reminders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminder_deliveries" ADD CONSTRAINT "reminder_deliveries_reminder_id_fkey" FOREIGN KEY ("reminder_id") REFERENCES "user_reminders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
