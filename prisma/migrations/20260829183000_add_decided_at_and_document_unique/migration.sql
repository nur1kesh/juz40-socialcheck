-- AlterTable
ALTER TABLE "applications" ADD COLUMN     "decided_at" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "documents_application_id_document_type_key" ON "documents"("application_id", "document_type");
