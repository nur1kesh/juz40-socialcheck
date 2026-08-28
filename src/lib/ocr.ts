import { generateStructuredJson, MODEL, OpenAiUsageError } from '@/lib/openai';
import { logAiUsage } from '@/lib/aiUsageLog';

export interface OcrResult {
  isReadable: boolean;
  extractedFullName: string | null;
  issueDate: Date | null;
  expiryDate: Date | null;
  documentTypeGuess: string | null;
  confidence: number; // 0..1
  matchesExpectedCategory: boolean | null; // null = OCR couldn't tell
}

interface StructuredDocumentResult {
  isReadable: boolean;
  extractedFullName: string;
  issueDate: string; // ISO date "YYYY-MM-DD" or ""
  expiryDate: string; // ISO date "YYYY-MM-DD" or ""
  documentTypeGuess: string;
  confidence: number;
  matchesExpectedCategory: boolean;
}

const DOCUMENT_SCHEMA = {
  type: 'object',
  properties: {
    isReadable: { type: 'boolean' },
    extractedFullName: { type: 'string' },
    issueDate: { type: 'string' },
    expiryDate: { type: 'string' },
    documentTypeGuess: { type: 'string' },
    confidence: { type: 'number' },
    matchesExpectedCategory: { type: 'boolean' },
  },
  required: [
    'isReadable',
    'extractedFullName',
    'issueDate',
    'expiryDate',
    'documentTypeGuess',
    'confidence',
    'matchesExpectedCategory',
  ],
  additionalProperties: false,
};

function buildPrompt(expectedCategoryLabel: string): string {
  return `This is a document uploaded by a student in Kazakhstan applying for a social benefit. The
student claims this document proves: "${expectedCategoryLabel}". Analyze the image and return JSON with:
- isReadable: false if the image is blurry, cropped, or otherwise not usable
- extractedFullName: the person's full name as printed on the document (empty string if not found)
- documentTypeGuess: a short description of what kind of document this actually is (in Kazakh or Russian)
- issueDate: the document's issue date in YYYY-MM-DD format, or "" if not present
- expiryDate: the document's expiry date in YYYY-MM-DD format, or "" if the document has no expiry / not present
- confidence: your confidence in this whole reading, 0.0 to 1.0
- matchesExpectedCategory: true only if this document plausibly proves the claimed category above; false if it is clearly a different, unrelated, or invalid document (e.g. claimed "мүгедектік" but the image is a random photo)
Do not guess dates, names, or the category match if you are not reasonably sure — use empty string / false / low confidence instead.`;
}

// This never decides pass/fail on its own — src/lib/applicationStateMachine.ts
// and src/lib/autoDecision.ts are the only places that turn OCR signals into
// an application status, and only when every signal is unambiguous. A low
// isReadable/confidence read routes to manual review rather than being
// trusted.
export async function runOcr(
  buffer: Buffer,
  mimeType: string,
  expectedCategoryLabel: string,
  context?: { applicationId?: string; documentType?: string },
): Promise<OcrResult> {
  try {
    const { data: result, usage } = await generateStructuredJson<StructuredDocumentResult>({
      prompt: buildPrompt(expectedCategoryLabel),
      imageBuffer: buffer,
      mimeType,
      schema: DOCUMENT_SCHEMA,
      schemaName: 'document',
    });

    await logAiUsage({
      kind: 'document_ocr',
      model: MODEL,
      usage,
      documentType: context?.documentType,
      applicationId: context?.applicationId,
    });

    return {
      isReadable: result.isReadable,
      extractedFullName: result.extractedFullName || null,
      issueDate: parseIsoDate(result.issueDate),
      expiryDate: parseIsoDate(result.expiryDate),
      documentTypeGuess: result.documentTypeGuess || null,
      confidence: result.confidence,
      matchesExpectedCategory: result.isReadable ? result.matchesExpectedCategory : null,
    };
  } catch (e) {
    console.error('document OCR failed', e);
    // OpenAiUsageError means the call was actually billed (a 200 with
    // token counts) even though we couldn't use the content — log it so
    // cost tracking doesn't silently undercount.
    if (e instanceof OpenAiUsageError) {
      await logAiUsage({
        kind: 'document_ocr',
        model: MODEL,
        usage: e.usage,
        documentType: context?.documentType,
        applicationId: context?.applicationId,
      });
    }
    // Fail closed: an OCR error routes to manual review, never silent approval.
    return {
      isReadable: false,
      extractedFullName: null,
      issueDate: null,
      expiryDate: null,
      documentTypeGuess: null,
      confidence: 0,
      matchesExpectedCategory: null,
    };
  }
}

function parseIsoDate(value: string): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function namesLikelyMatch(profileFullName: string, ocrName: string | null): boolean {
  if (!ocrName) return false;
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-zа-яәғқңөұүһі\s]/gi, '').trim();
  return normalize(profileFullName) === normalize(ocrName);
}
