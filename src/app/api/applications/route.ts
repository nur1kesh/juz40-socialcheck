import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { getCurrentUser } from '@/lib/session';
import { deleteDocumentFile } from '@/lib/storage';

function sameBenefitTypes(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((t, i) => t === sortedB[i]);
}

const createSchema = z.object({
  benefitTypes: z
    .array(z.enum(['many_children_family', 'incomplete_family', 'disability']))
    .min(1, 'Кемінде бір жеңілдік түрін таңдаңыз')
    .max(3)
    .refine((arr) => new Set(arr).size === arr.length, 'Қайталанатын жеңілдік түрлері'),
});

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Авторизация қажет' }, { status: 401 });

  const applications = await prisma.application.findMany({
    where: { userId: user.id },
    include: { documents: true },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json({ applications });
}

// A fresh application is only allowed to start when the student's most
// recent one has resolved in a way that permits it:
//   - draft / pending_review: blocked outright — one attempt in flight at a
//     time; pending_review specifically means it's already in manual
//     review, so the only way forward is to wait for that decision.
//   - rejected: allowed immediately (the normal resubmit-after-rejection path).
//   - approved: allowed, but rate-limited to once per APPROVE_COOLDOWN_MS —
//     otherwise a student could spam new "renewal" applications right after
//     getting approved. `decidedAt` (set once, when status flipped to
//     approved) is the timestamp used — status is terminal so it never
//     changes again, but the row itself keeps getting written later
//     (discountActivatedAt, activationDisputedAt), so `updatedAt` would
//     drift and can't be used here.
const APPROVE_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Авторизация қажет' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Деректер форматы дұрыс емес' }, { status: 400 });
  }

  const latest = await prisma.application.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
  });

  if (latest?.status === 'draft') {
    // A draft was never submitted, so blocking here would be wrong — the
    // most common way to land in this branch is completely routine: the
    // student is on step 1, already has a draft from an earlier
    // "Жалғастыру" click, and revises their benefit selection.
    // ApplyForm's invalidateApplication() clears the *client's* reference
    // to that draft (so it knows to ask for a fresh one) but leaves the
    // row itself behind — so "the user's latest application" the server
    // sees here is routinely that same orphaned, superseded draft, not a
    // real unfinished attempt the student would lose progress by
    // restarting. Reuse or update it in place instead of erroring:
    if (sameBenefitTypes(latest.benefitTypes, parsed.data.benefitTypes)) {
      // Identical selection — most likely a second tab or a bookmark to
      // /apply instead of the resume link. Hand back the same draft
      // untouched so any documents already uploaded to it survive.
      return NextResponse.json({ application: latest });
    }
    // Selection changed — the old draft's documents were uploaded against
    // the previous combo and don't apply to the new one (this mirrors
    // invalidateApplication() clearing its local docs state for exactly
    // this reason), so they're purged here. Updating the same row — rather
    // than deleting it and creating a new one — means there's never more
    // than one draft per student and nothing is ever silently lost that
    // the student didn't just replace themselves.
    const staleDocuments = await prisma.document.findMany({
      where: { applicationId: latest.id },
      select: { filePath: true },
    });
    await Promise.all(staleDocuments.map((d) => deleteDocumentFile(d.filePath)));
    await prisma.document.deleteMany({ where: { applicationId: latest.id } });
    const application = await prisma.application.update({
      where: { id: latest.id },
      data: { benefitTypes: parsed.data.benefitTypes },
    });
    return NextResponse.json({ application });
  }
  if (latest?.status === 'pending_review') {
    return NextResponse.json(
      { error: 'Ағымдағы өтінім тексерілуде. Нәтиже шыққанша күте тұрыңыз.' },
      { status: 409 },
    );
  }
  if (latest?.status === 'approved') {
    // activateDiscountsFromEmails (src/lib/activateDiscount.ts) matches a
    // re-imported "Excel ПФ" confirmation to "the newest approved
    // application without discountActivatedAt yet" — that only ever picks
    // the right row if a student can't have a SECOND approved-but-not-yet-
    // externally-activated application at the same time. The 24h cooldown
    // below is necessary but not sufficient for that on its own (an admin
    // can easily take longer than 24h to run the export/confirm/import
    // cycle), so block outright, independent of elapsed time, until the
    // current one is confirmed activated — otherwise a later reimport could
    // silently activate the wrong application (mismatched %/limit) while
    // leaving the actually-confirmed one stuck forever.
    if (!latest.discountActivatedAt) {
      return NextResponse.json(
        { error: 'Алдыңғы өтінімнің жеңілдігі әлі белсендірілмеген. Белсендірілгенше күте тұрыңыз.' },
        { status: 409 },
      );
    }
    // decidedAt, not updatedAt — updatedAt is bumped by Prisma's @updatedAt
    // on ANY later write to the row (discountActivatedAt, activationDisputedAt
    // from the activation-confirmation flow), which would otherwise silently
    // re-arm or shorten this cooldown days after the actual approval.
    // submittedAt is the fallback for rows decided before decidedAt existed.
    const decidedAt = latest.decidedAt ?? latest.submittedAt;
    const elapsedMs = decidedAt ? Date.now() - decidedAt.getTime() : Infinity;
    if (elapsedMs < APPROVE_COOLDOWN_MS) {
      const remainingHours = Math.ceil((APPROVE_COOLDOWN_MS - elapsedMs) / (60 * 60 * 1000));
      return NextResponse.json(
        { error: `Жаңа өтінімді тек ${remainingHours} сағаттан кейін бере аласыз.` },
        { status: 409 },
      );
    }
  }

  const application = await prisma.application.create({
    data: {
      userId: user.id,
      benefitTypes: parsed.data.benefitTypes,
      status: 'draft',
    },
  });

  return NextResponse.json({ application });
}
