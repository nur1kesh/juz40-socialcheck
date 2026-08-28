import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentAdmin } from '@/lib/adminSession';
import { decideApplicationAsAdmin } from '@/lib/decideApplicationAdmin';

// Only approve/reject — pending_review has nowhere else to go back to in
// the simplified state machine (see applicationStateMachine.ts), so there's
// no "send to manual review" action anymore: an application either already
// is in pending_review (the AI's own fallback) or it isn't.
const schema = z.object({
  decision: z.enum(['approve', 'reject']),
  note: z.string().max(1000).optional(),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = await getCurrentAdmin();
  if (!admin) return NextResponse.json({ error: 'Авторизация қажет' }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Деректер форматы дұрыс емес' }, { status: 400 });
  }

  const result = await decideApplicationAsAdmin({
    applicationId: params.id,
    decision: parsed.data.decision,
    adminEmail: admin.email,
    note: parsed.data.note,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ application: result.application });
}
