// gpt-5.6-luna over gpt-4o: repeated live tests on real uploaded documents
// showed gpt-4o occasionally hallucinating an expiry date on documents that
// have none (1/3 runs), which can wrongly affect auto-decision/discount
// limit outcomes. gpt-5.6-luna was consistent (0/3) on the same document
// across repeated runs — worth the extra tokens/latency for this use case.
export const MODEL = 'gpt-5.6-luna';

export interface GenerateStructuredJsonResult<T> {
  data: T;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
}

// Thrown instead of a plain Error when the request was actually billed by
// OpenAI (a 200 response with usage figures) but the content came back
// empty or unparseable — carries the usage so callers can still log the
// cost instead of silently undercounting it.
export class OpenAiUsageError extends Error {
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  constructor(message: string, usage: { promptTokens: number; completionTokens: number; totalTokens: number }) {
    super(message);
    this.name = 'OpenAiUsageError';
    this.usage = usage;
  }
}

// Wraps the OpenAI Chat Completions API (vision + structured JSON schema
// output) for image-understanding calls that must return a fixed JSON
// shape. Same interface as src/lib/gemini.ts on purpose — profileOcr.ts and
// ocr.ts just import whichever provider is currently active.
export async function generateStructuredJson<T>(params: {
  prompt: string;
  imageBuffer: Buffer;
  mimeType: string;
  schema: Record<string, unknown>;
  schemaName?: string;
}): Promise<GenerateStructuredJsonResult<T>> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured');
  }

  const dataUrl = `data:${params.mimeType};base64,${params.imageBuffer.toString('base64')}`;

  // Chat Completions' `image_url` content part only accepts actual image
  // MIME types — it 400s on application/pdf ("Only image types are
  // supported"). PDFs need the separate `file` content part instead.
  const mediaContent =
    params.mimeType === 'application/pdf'
      ? { type: 'file', file: { filename: 'document.pdf', file_data: dataUrl } }
      : { type: 'image_url', image_url: { url: dataUrl } };

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: params.prompt }, mediaContent],
        },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: params.schemaName ?? 'result',
          strict: true,
          schema: params.schema,
        },
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OpenAI API error ${res.status}: ${body}`);
  }

  const data = await res.json();
  const usage = {
    promptTokens: data.usage?.prompt_tokens ?? 0,
    completionTokens: data.usage?.completion_tokens ?? 0,
    totalTokens: data.usage?.total_tokens ?? 0,
  };

  const text: string | undefined = data.choices?.[0]?.message?.content;
  if (!text) {
    throw new OpenAiUsageError('OpenAI response had no content', usage);
  }

  let parsed: T;
  try {
    parsed = JSON.parse(text) as T;
  } catch {
    throw new OpenAiUsageError('OpenAI response was not valid JSON', usage);
  }

  return { data: parsed, usage };
}
