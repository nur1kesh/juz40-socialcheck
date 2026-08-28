-- The extension-based login flow (extension/, /api/extension/sync,
-- /auth/callback) was replaced by the screenshot+OCR /connect flow, which
-- creates sessions directly without a one-time exchange code. This table
-- has had no writer since.
DROP TABLE IF EXISTS "login_codes";
