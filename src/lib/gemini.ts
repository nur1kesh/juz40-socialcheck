import type { GenerateStructuredJsonResult } from '@/lib/openai';

export const MODEL = 'gemini-3.6-flash';

// Wraps the Gemini REST API for image-understanding calls that must return
// a fixed JSON shape. Used by both profile-screenshot recognition
// (src/lib/profileOcr.ts) and document verification (src/lib/ocr.ts) — one
// client, one place to swap models/providers later. Same return shape as
// src/lib/openai.ts (including usage) so swapping the import is a drop-in.
export async function generateStructuredJson<T>(params: {
  prompt: string;
  imageBuffer: Buffer;
  mimeType: string;
  schema: Record<string, unknown>;
}): Promise<GenerateStructuredJsonResult<T>> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured');
  }

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: params.prompt },
              {
                inline_data: {
                  mime_type: params.mimeType,
                  data: params.imageBuffer.toString('base64'),
                },
              },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: params.schema,
        },
      }),
    },
  );

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Gemini API error ${res.status}: ${body}`);
  }

  const data = await res.json();
  const text: string | undefined = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error('Gemini response had no content');
  }

  return {
    data: JSON.parse(text) as T,
    usage: {
      promptTokens: data.usageMetadata?.promptTokenCount ?? 0,
      completionTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
      totalTokens: data.usageMetadata?.totalTokenCount ?? 0,
    },
  };
}
