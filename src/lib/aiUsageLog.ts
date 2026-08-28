import { prisma } from '@/lib/db';
import { estimateCostUsd } from '@/lib/aiPricing';

interface Usage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

// Best-effort logging — never let a usage-tracking failure break the OCR
// request it's recording. Cost is estimated at write time from a static
// price table, not looked up later, so historical rows stay accurate even
// after prices change.
export async function logAiUsage(params: {
  kind: 'profile_screenshot' | 'document_ocr';
  model: string;
  usage: Usage;
  documentType?: string | null;
  applicationId?: string | null;
}): Promise<void> {
  const costUsd = estimateCostUsd(params.model, params.usage.promptTokens, params.usage.completionTokens);
  // estimateCostUsd's null means "cost unknown" (unrecognized model), not
  // "free" — but AiUsageLog.costUsd is a non-nullable Float, so it still
  // has to be stored as 0. Without this warning, that would silently
  // undercount spend the same way logging itself used to fail silently
  // (see OpenAiUsageError) — the next time MODEL in openai.ts changes
  // without updating aiPricing.ts's table, this is the only signal.
  if (costUsd === null) {
    console.error(`aiUsageLog: no price entry for model "${params.model}" — logging costUsd=0 (real cost unknown)`);
  }
  try {
    await prisma.aiUsageLog.create({
      data: {
        kind: params.kind,
        model: params.model,
        documentType: params.documentType ?? null,
        applicationId: params.applicationId ?? null,
        promptTokens: params.usage.promptTokens,
        completionTokens: params.usage.completionTokens,
        totalTokens: params.usage.totalTokens,
        costUsd: costUsd ?? 0,
      },
    });
  } catch (e) {
    console.error('failed to log AI usage', e);
  }
}
