-- CreateIndex
CREATE INDEX "applications_status_idx" ON "applications"("status");

-- CreateIndex
CREATE INDEX "applications_status_submitted_at_idx" ON "applications"("status", "submitted_at");
