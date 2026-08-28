import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser } from '@/lib/session';
import { prisma } from '@/lib/db';
import { STATUS_LABELS, BENEFIT_LABELS } from '@/lib/statusLabels';
import { discountPercentFor } from '@/lib/discount';
import { discountLimitMonths, discountValidUntilLabel } from '@/lib/discountLimit';
import { formatAlmatyDateTime } from '@/lib/timezone';
import ResubmitButton from './ResubmitButton';
import Icon from '@/components/Icon';
import type { ApplicationStatus } from '@prisma/client';

const HERO: Record<ApplicationStatus, { icon: Parameters<typeof Icon>[0]['name']; tone: string }> = {
  draft: { icon: 'edit', tone: 'bg-forest-100 text-forest-700' },
  pending_review: { icon: 'search', tone: 'bg-gold-100 text-gold-600' },
  approved: { icon: 'check-circle', tone: 'bg-forest-600 text-paper-soft' },
  rejected: { icon: 'x-circle', tone: 'bg-clay-400/15 text-clay-500' },
};

export default async function ApplicationStatusPage({ params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) redirect('/');

  const application = await prisma.application.findUnique({
    where: { id: params.id },
    include: { documents: true },
  });
  if (!application || application.userId !== user.id) notFound();

  const hero = HERO[application.status];

  const limitMonths = application.status === 'approved' ? discountLimitMonths(application.documents) : null;
  const validUntilLabel = limitMonths !== null ? discountValidUntilLabel(limitMonths) : null;
  // discountValidUntilLabel returns null for months<=0 (nothing to render
  // as an upcoming end date) — but that collapses "already lapsed" into
  // the same silent absence as "no expiry data at all", leaving an
  // approved-but-lapsed application showing the generic "approved, you'll
  // get it within 24h" copy with no hint it's already expired. profile/page.tsx
  // already distinguishes this case; this page didn't.
  const alreadyExpired = limitMonths === 0;

  let rejectionReasonLabel: string | null = null;
  let rejectionNote: string | null = null;
  if (application.status === 'rejected') {
    const lastRejectEvent = await prisma.applicationEvent.findFirst({
      where: { applicationId: application.id, newStatus: 'rejected' },
      orderBy: { createdAt: 'desc' },
      select: { metadata: true },
    });
    const meta = lastRejectEvent?.metadata as { reason?: string; note?: string } | null;
    rejectionReasonLabel =
      meta?.reason === 'expired'
        ? 'Себебі: жүктелген құжаттың мерзімі аяқталды.'
        : meta?.reason === 'type_mismatch'
          ? 'Себебі: жүктелген құжат талап етілген түрге сәйкес келмеді.'
          : null;
    // A manual admin rejection (e.g. from pending_review, where the
    // automated reason enum doesn't apply) often has no machine-readable
    // reason at all — the admin's own free-text note is then the only
    // explanation that exists anywhere, so it needs to reach the student.
    rejectionNote = meta?.note ?? null;
  }

  return (
    <main className="mx-auto min-h-dvh w-full max-w-xl px-5 pb-16 pt-8 sm:px-6 sm:pt-14">
      <Link href="/profile" className="btn-ghost mb-6 inline-flex no-underline">
        <Icon name="arrow-left" className="h-4 w-4" /> Профильге оралу
      </Link>

      <div className="stagger mb-8 flex flex-col items-center gap-3 text-center">
        <div className={`grid h-16 w-16 place-items-center rounded-2xl shadow-soft ${hero.tone}`}>
          <Icon name={hero.icon} className="h-7 w-7" />
        </div>
        <h1 className="font-display text-2xl font-medium text-forest-950 sm:text-3xl">
          {STATUS_LABELS[application.status]}
        </h1>
      </div>

      {application.status === 'pending_review' && (
        <div className="card animate-scale-in mb-4" style={{ animationDelay: '100ms' }}>
          <h2 className="mb-2 font-display text-lg font-medium text-forest-950">
            Тексерілуде
          </h2>
          <p className="text-sm leading-relaxed text-ink-soft">
            Сіздің құжаттарыңыз менеджерлердің тексерісінде, күтуіңізді сұраймыз.
          </p>
        </div>
      )}

      {application.status === 'approved' && (
        <div className="card animate-scale-in mb-4" style={{ animationDelay: '100ms' }}>
          <h2 className="mb-2 font-display text-lg font-medium text-forest-950">
            Мақұлданды
          </h2>
          <p className="mb-3 text-sm leading-relaxed text-ink-soft">
            Сізге 24 сағат ішінде аккаунтыңызға жеңілдік берілетін болады.
          </p>
          {alreadyExpired ? (
            <p className="inline-flex items-center gap-1.5 rounded-full bg-clay-400/15 px-3 py-1.5 text-sm font-bold text-clay-500">
              <Icon name="alert" className="h-4 w-4" /> Жеңілдік мерзімі аяқталды — жаңарту үшін жаңа өтінім беріңіз
            </p>
          ) : (
            validUntilLabel && (
              <p className="inline-flex items-center gap-1.5 rounded-full bg-forest-100 px-3 py-1.5 text-sm font-bold text-forest-800">
                <Icon name="hourglass" className="h-4 w-4" /> Жеңілдік мерзімі: {validUntilLabel}
              </p>
            )
          )}
        </div>
      )}

      <div className="card animate-scale-in flex flex-col gap-4" style={{ animationDelay: '160ms' }}>
        <Row label="ФИО" value={user.fullName} />
        <Row
          label="Әлеуметтік мәртебе"
          value={application.benefitTypes.map((t) => BENEFIT_LABELS[t] ?? t).join(', ')}
        />
        {application.status === 'approved' && (
          <>
            <Row
              label="Жеңілдік"
              valueNode={
                <span className="rounded-full bg-gold-100/70 px-2.5 py-0.5 text-sm font-semibold text-gold-600">
                  {discountPercentFor(application.benefitTypes)}%
                </span>
              }
            />
            {validUntilLabel && <Row label="Жеңілдік мерзімі" value={validUntilLabel} />}
          </>
        )}
        <Row
          label="Жіберілген күні"
          value={application.submittedAt ? formatAlmatyDateTime(application.submittedAt) : '—'}
        />
      </div>

      {application.status === 'rejected' && (
        <div className="card animate-scale-in mt-6" style={{ animationDelay: '220ms' }}>
          {rejectionReasonLabel && (
            <p className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-clay-400/15 px-3 py-1.5 text-sm font-bold text-clay-500">
              <Icon name="alert" className="h-4 w-4" /> {rejectionReasonLabel}
            </p>
          )}
          {rejectionNote && (
            <p className="mb-3 rounded-xl bg-clay-400/10 px-3.5 py-3 text-sm leading-relaxed text-clay-500">
              {rejectionNote}
            </p>
          )}
          <p className="mb-4 text-sm font-medium text-clay-500">
            Өтінім қабылданбады. Құжаттарды қайта тексеріп, қайта жіберуге болады.
          </p>
          <ResubmitButton applicationId={application.id} />
        </div>
      )}
    </main>
  );
}

function Row({ label, value, valueNode }: { label: string; value?: string; valueNode?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm text-ink-faint">{label}</span>
      {valueNode ?? <span className="text-right text-sm font-medium text-ink">{value}</span>}
    </div>
  );
}
