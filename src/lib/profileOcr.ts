import { generateStructuredJson, MODEL, OpenAiUsageError } from '@/lib/openai';
import { logAiUsage } from '@/lib/aiUsageLog';

export interface ExtractedProfileGuess {
  fullName: string;
  email: string;
  whatsapp: string;
}

const PROFILE_SCHEMA = {
  type: 'object',
  properties: {
    fullName: { type: 'string' },
    email: { type: 'string' },
    whatsapp: { type: 'string' },
  },
  required: ['fullName', 'email', 'whatsapp'],
  additionalProperties: false,
};

const PROMPT = `This is a screenshot of a JUZ40 student profile page (juz40-edu.kz/student/profile), in Kazakh. Extract exactly these 3 fields and return them as JSON:
- fullName: the student's full name (Аты-жөні)
- email: their email address
- whatsapp: their WhatsApp phone number as digits only, formatted as "+7XXXXXXXXXX" (no spaces, no dashes)
If a field is not visible or not legible in the image, return an empty string for it. Do not guess or invent values.`;

// This is strictly best-effort: the caller must show these as an editable
// draft for the student to confirm/correct, never submit them silently —
// same "OCR never auto-approves" rule as document verification.
export async function extractProfileFromScreenshot(
  buffer: Buffer,
  mimeType: string,
): Promise<ExtractedProfileGuess> {
  try {
    const { data: result, usage } = await generateStructuredJson<ExtractedProfileGuess>({
      prompt: PROMPT,
      imageBuffer: buffer,
      mimeType,
      schema: PROFILE_SCHEMA,
      schemaName: 'profile',
    });

    await logAiUsage({ kind: 'profile_screenshot', model: MODEL, usage });

    // The model doesn't always follow the no-spaces instruction exactly —
    // strip formatting characters so the prefilled field passes validation
    // without the student having to edit it just to remove spaces.
    return { ...result, whatsapp: result.whatsapp.replace(/[\s\-()]/g, '') };
  } catch (e) {
    // Billed-but-unusable response — log the cost before the caller's own
    // error handling (connect/screenshot/route.ts) turns this into a 502.
    if (e instanceof OpenAiUsageError) {
      await logAiUsage({ kind: 'profile_screenshot', model: MODEL, usage: e.usage });
    }
    throw e;
  }
}
