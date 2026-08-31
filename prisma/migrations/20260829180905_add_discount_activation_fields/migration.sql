-- AlterTable
ALTER TABLE "applications" ADD COLUMN     "activation_disputed_at" TIMESTAMP(3),
ADD COLUMN     "discount_activated_at" TIMESTAMP(3);
