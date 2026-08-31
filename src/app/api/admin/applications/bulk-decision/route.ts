import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentAdmin } from '@/lib/adminSession';
import { decideApplicationAsAdmin } from '@/lib/decideApplicationAdmin';

const schema = z.object({
  ids: z.array(z.string()).min(1).max(100),
  decision: z.enum(['approve', 'reject']),
  note: z.string().max(1000).optional(),
  // Applied to every application in the batch when decision is 'approve' —
  // decideApplicationAsAdmin rejects each one individually if it's missing.
  limitMonths: z.number().int().min(1).max(60).optional(),
});

// Applies the same per-application decision logic as the single-application
// route, one application at a time — each one still gets its own state
// transition check and event log entry, so a batch that's partly invalid
// (e.g. one row already decided by someone else) fails only for that row,
// not the whole batch.
export async function POST(req: NextRequest) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: 'Авторизация қажет' }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Деректер форматы дұрыс емес' }, { status: 400 });
  }

  // A duplicated id in the request would otherwise race two concurrent
  // decideApplicationAsAdmin calls against the same row — decideApplicationAsAdmin
  // now guards against that safely (one wins, one gets a clean 409), but
  // deduping up front avoids a confusing "1 failed" for what's really the
  // same intended action submitted twice.
  const ids = [...new Set(parsed.data.ids)];

  // Chunked rather than one giant Promise.all — up to 100 ids each opening
  // their own $transaction would mean up to 100 concurrent connections from
  // a single request, which can exhaust the Prisma pool under load.
  const CHUNK_SIZE = 10;
  const results: Awaited<ReturnType<typeof decideApplicationAsAdmin>>[] = [];
  for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
    const chunk = ids.slice(i, i + CHUNK_SIZE);
    const chunkResults = await Promise.all(
      chunk.map((id) =>
        decideApplicationAsAdmin({
          applicationId: id,
          decision: parsed.data.decision,
          adminEmail: admin.email,
          note: parsed.data.note,
          limitMonths: parsed.data.limitMonths,
        }),
      ),
    );
    results.push(...chunkResults);
  }
  const resultsWithIds = results.map((result, i) => ({ id: ids[i]!, ...result }));

  const succeeded = resultsWithIds.filter((r) => r.ok).length;
  const failed = resultsWithIds.filter((r): r is { id: string; ok: false; error: string; status: number } => !r.ok);

  return NextResponse.json({ succeeded, failed });
}
