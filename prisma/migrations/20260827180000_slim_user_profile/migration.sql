-- Keep only what the app actually needs to identify and contact a
-- student: full name, email, WhatsApp. JUZ40 ID, grade, and subjects were
-- collected but never used for any decision or matching logic beyond
-- display — email becomes the new unique identity key.
DROP INDEX IF EXISTS "users_juz40_id_key";

ALTER TABLE "users"
  DROP COLUMN "juz40_id",
  DROP COLUMN "grade",
  DROP COLUMN "subject_1",
  DROP COLUMN "subject_2";

CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
