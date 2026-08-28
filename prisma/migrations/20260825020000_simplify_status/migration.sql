-- Collapse the 12-value ApplicationStatus enum down to 4: draft,
-- pending_review, approved, rejected. Everything that was "in progress" in
-- some way maps to pending_review; every terminal "got the discount"
-- variant maps to approved; every terminal "didn't" variant maps to
-- rejected. Also drops the now-unused 24h-wait/result columns.

CREATE TYPE "ApplicationStatus_new" AS ENUM ('draft', 'pending_review', 'approved', 'rejected');

ALTER TABLE "applications" ADD COLUMN "status_new" "ApplicationStatus_new";

UPDATE "applications" SET "status_new" = (
  CASE "status"::text
    WHEN 'draft' THEN 'draft'
    WHEN 'submitted' THEN 'pending_review'
    WHEN 'automatic_check' THEN 'pending_review'
    WHEN 'pending_manual_review' THEN 'pending_review'
    WHEN 'waiting_24h' THEN 'pending_review'
    WHEN 'waiting_student_confirmation' THEN 'pending_review'
    WHEN 'approved' THEN 'approved'
    WHEN 'discount_confirmed' THEN 'approved'
    WHEN 'rejected' THEN 'rejected'
    WHEN 'expired_document' THEN 'rejected'
    WHEN 'discount_not_activated' THEN 'rejected'
    WHEN 'resubmission_allowed' THEN 'rejected'
    ELSE 'rejected'
  END
)::"ApplicationStatus_new";

ALTER TABLE "applications" ALTER COLUMN "status_new" SET NOT NULL;
ALTER TABLE "applications" DROP COLUMN "status";
ALTER TABLE "applications" RENAME COLUMN "status_new" TO "status";
ALTER TABLE "applications" ALTER COLUMN "status" SET DEFAULT 'draft';

DROP TYPE "ApplicationStatus";
ALTER TYPE "ApplicationStatus_new" RENAME TO "ApplicationStatus";

ALTER TABLE "applications" DROP COLUMN IF EXISTS "review_available_at";
ALTER TABLE "applications" DROP COLUMN IF EXISTS "result";
