-- Replace the single benefit_type column with a benefit_types array so a
-- student can apply for more than one benefit category at once.
ALTER TABLE "applications" ADD COLUMN "benefit_types" "BenefitType"[] NOT NULL DEFAULT ARRAY[]::"BenefitType"[];

UPDATE "applications" SET "benefit_types" = ARRAY["benefit_type"] WHERE "benefit_type" IS NOT NULL;

ALTER TABLE "applications" ALTER COLUMN "benefit_types" DROP DEFAULT;
ALTER TABLE "applications" DROP COLUMN "benefit_type";
