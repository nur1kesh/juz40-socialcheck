import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser } from '@/lib/session';
import { prisma } from '@/lib/db';
import { STATUS_LABELS, BENEFIT_LABELS } from '@/lib/statusLabels';
import { discountPercentFor } from '@/lib/discount';
import { discountLimitMonths } from '@/lib/discountLimit';
import { formatAlmatyDate } from '@/lib/timezone';
import LogoutButton from './LogoutButton';
import Icon from '@/components/Icon';
import type { ApplicationStatus } from '@prisma/client';

const STATUS_TONE: Record<ApplicationStatus, string> = {
  draft: 'bg-forest-100 text-forest-700',
  pending_review: 'bg-gold-100 text-gold-600',
  approved: 'bg-forest-600 text-paper-soft',
  rejected: 'bg-clay-400/15 text-clay-500',
};

function initials(fullName: string): string {
  return fullName
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

export default async function ProfilePage() {
  const user = await getCurrentUser();
  if (!user) redirect('/');

  const applications = await prisma.application.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    include: { documents: true },
  });

  const openApplication = applications.find((a) => a.status === 'draft' || a.status === 'pending_review');
  // Drafts are unfinished attempts with no meaningful outcome — the open
  // one above already surfaces the resume link, so history only needs to
  // show applications that actually went somewhere.
  const historyApplications = applications.filter((a) => a.status !== 'draft');

  // Nudge the student to renew before their discount lapses, instead of
  // leaving them to notice on their own. Only surfaced when there isn't
  // already a fresh application in flight (draft/pending_review) — no point
  // nagging someone who's already renewing.
  const latestApproved = applications.find((a) => a.status === 'approved');
  const approvedLimitMonths = latestApproved ? discountLimitMonths(latestApproved.documents) : null;
  const showRenewalBanner = !openApplication && approvedLimitMonths !== null && approvedLimitMonths <= 1;
  // monthsUntilExpiry clamps negative counts to 0, so "0" actually means
  // "already lapsed" and "1" means "still valid, just through this month"
  // — collapsing both into "expires this month" would be wrong for the
  // first case, so the copy has to distinguish them.
  const alreadyExpired = approvedLimitMonths === 0;

  return (
    <main className="mx-auto min-h-dvh w-full max-w-2xl px-5 pb-16 pt-10 sm:px-6 sm:pt-14">
      <div className="stagger mb-8 flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-forest-900 font-display text-xl font-medium text-gold-200 shadow-soft">
            {initials(user.fullName)}
          </div>
          <div>
            <p className="eyebrow mb-1">Жеке кабинет</p>
            <h1 className="font-display text-2xl font-medium text-forest-950 sm:text-3xl">
              {user.fullName}
            </h1>
          </div>
        </div>
        <LogoutButton />
      </div>

      <section className="card animate-scale-in mb-6" style={{ animationDelay: '120ms' }}>
        <h2 className="mb-4 eyebrow">Жеке мәліметтер</h2>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-5">
          <Field label="WhatsApp" value={user.whatsapp} />
          <Field label="Email" value={user.email} />
        </dl>
      </section>

      {showRenewalBanner && (
        <Link
          href="/apply"
          className="card-select card animate-scale-in mb-4 flex items-center gap-3 border-gold-400/60 bg-gold-100/50"
          style={{ animationDelay: '160ms' }}
        >
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gold-200 text-gold-700">
            <Icon name="hourglass" className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-forest-900">
              {alreadyExpired ? 'Жеңілдігіңіздің мерзімі аяқталды' : 'Жеңілдігіңіздің мерзімі осы айда аяқталады'}
            </p>
            <p className="text-xs text-ink-soft">Үзіліссіз жалғасу үшін қазірден жаңа өтінім беріңіз.</p>
          </div>
          <Icon name="arrow-right" className="h-4 w-4 text-forest-700" />
        </Link>
      )}

      {!openApplication ? (
        <Link
          href="/apply"
          className="btn-primary animate-scale-in w-full"
          style={{ animationDelay: '200ms' }}
        >
          Өтінім беру
          <Icon name="arrow-right" className="h-4 w-4" />
        </Link>
      ) : (
        <Link
          href={
            openApplication.status === 'draft'
              ? `/apply?applicationId=${openApplication.id}`
              : `/applications/${openApplication.id}`
          }
          className="card-select card animate-scale-in flex items-center justify-between gap-3 border-gold-300/60 bg-gold-100/40"
          style={{ animationDelay: '200ms' }}
        >
          <div>
            <p className="text-sm font-semibold text-forest-900">Ағымдағы өтінім</p>
            <p className="text-xs text-ink-soft">{STATUS_LABELS[openApplication.status]}</p>
          </div>
          <Icon name="arrow-right" className="h-4 w-4 text-forest-700" />
        </Link>
      )}

      {historyApplications.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-3 eyebrow">Өтінімдер тарихы</h2>
          <ul className="flex flex-col gap-3">
            {historyApplications.map((a, i) => (
              <li key={a.id} className="animate-fade-up" style={{ animationDelay: `${i * 60}ms` }}>
                <Link
                  href={`/applications/${a.id}`}
                  className="card-select card flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">
                      {a.benefitTypes.map((t) => BENEFIT_LABELS[t]).join(', ') || '—'}
                    </p>
                    <p className="mt-0.5 text-xs text-ink-faint">
                      {formatAlmatyDate(a.createdAt)} ·{' '}
                      {discountPercentFor(a.benefitTypes)}% жеңілдік
                    </p>
                  </div>
                  <span className={`chip shrink-0 ${STATUS_TONE[a.status]}`}>
                    {STATUS_LABELS[a.status]}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

function Field({ label, value, className = '' }: { label: string; value: string; className?: string }) {
  return (
    <div className={className}>
      <dt className="mb-0.5 text-xs font-semibold uppercase tracking-wide text-ink-faint">{label}</dt>
      <dd className="truncate font-medium text-ink">{value}</dd>
    </div>
  );
}
