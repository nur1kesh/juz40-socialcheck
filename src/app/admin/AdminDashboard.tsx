'use client';

import { Fragment, useMemo, useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { STATUS_LABELS, BENEFIT_LABELS } from '@/lib/statusLabels';
import { discountPercentFor } from '@/lib/discount';
import { discountLimitMonths } from '@/lib/discountLimit';
import { formatAlmatyDate, formatAlmatyDateTime } from '@/lib/timezone';
import Icon from '@/components/Icon';
import type { ApplicationStatus, BenefitType } from '@prisma/client';

type ApplicationEventRow = {
  id: string;
  eventType: string;
  oldStatus: string | null;
  newStatus: string | null;
  actor: string;
  metadata: unknown;
  createdAt: string;
};

type ApplicationRow = {
  id: string;
  status: ApplicationStatus;
  benefitTypes: BenefitType[];
  createdAt: string;
  submittedAt: string | null;
  discountActivatedAt: string | null;
  activationDisputedAt: string | null;
  user: { fullName: string; email: string; whatsapp: string };
  documents: {
    id: string;
    originalFilename: string;
    nameMatchesProfile: boolean | null;
    documentType: string;
    documentExpiryDate: string | null;
  }[];
  events: ApplicationEventRow[];
};

const REJECTION_REASON_LABELS: Record<string, string> = {
  expired: 'Мерзімі аяқталды',
  type_mismatch: 'Құжат түрі сәйкес емес',
};

function rejectionReasonLabel(app: ApplicationRow): string | null {
  if (app.status !== 'rejected') return null;
  const lastRejectEvent = [...app.events].reverse().find((e) => e.newStatus === 'rejected');
  const reason = (lastRejectEvent?.metadata as { reason?: string } | null)?.reason;
  return reason ? (REJECTION_REASON_LABELS[reason] ?? null) : null;
}

// The same rule the auto-decision path uses (shortest-lived supporting
// document bounds the limit) — surfaced here so the admin doesn't have to
// open every document and do the date math by hand before typing a number
// into the approve modal. Still just a suggestion: the admin can override
// it, and manually-approved applications already store their own
// `manualLimitMonths` once decided (see decideApplicationAdmin.ts).
function suggestedLimitMonths(documents: ApplicationRow['documents']): number | null {
  return discountLimitMonths(
    documents.map((d) => ({
      documentType: d.documentType,
      documentExpiryDate: d.documentExpiryDate ? new Date(d.documentExpiryDate) : null,
    })),
  );
}

// A secondary pill under the main status chip — mirrors rejectionReasonLabel's
// pattern, but for the activation-confirmation flow, which is orthogonal to
// `status` (see activateDiscount.ts): an 'approved' application can be
// not-yet-activated, activated, or activated-but-disputed.
function activationBadge(app: ApplicationRow): { label: string; tone: string } | null {
  if (app.status !== 'approved') return null;
  if (app.activationDisputedAt) return { label: 'Шағым: белсендірілмеді', tone: 'bg-clay-400/15 text-clay-500' };
  if (app.discountActivatedAt) return { label: 'Белсендірілді', tone: 'bg-forest-100 text-forest-700' };
  return null;
}

const EVENT_TYPE_LABELS: Record<string, string> = {
  submitted: 'Жіберілді',
  auto_decision: 'Автоматты шешім',
  admin_approve: 'Админ мақұлдады',
  admin_reject: 'Админ қабылдамады',
  discount_activated: 'Жеңілдік белсендірілді',
  activation_disputed: 'Студент белсендірілмеді деп хабарлады',
  activation_dispute_resolved: 'Шағым шешілді',
};

type PendingDecision = { ids: string[]; label: string; decision: 'approve' | 'reject' };

type ActivationImportSummary = {
  activated: string[];
  alreadyActivated: string[];
  noApprovedApplication: string[];
  notFound: string[];
  invalid: string[];
};

type AiUsage = {
  totals: { calls: number; promptTokens: number; completionTokens: number; totalTokens: number; costUsd: number };
  last30Days: { calls: number; totalTokens: number; costUsd: number };
  byModel: { model: string; calls: number; totalTokens: number; costUsd: number }[];
  byKind: { kind: string; calls: number; totalTokens: number; costUsd: number }[];
  avgCostPerApplication: number | null;
  applicationCount: number;
};

const KIND_LABELS: Record<string, string> = {
  document_ocr: 'Құжат тексеру',
  profile_screenshot: 'Профиль скриншоты',
};

const STATUS_OPTIONS = Object.keys(STATUS_LABELS);
const BENEFIT_OPTIONS = Object.keys(BENEFIT_LABELS);

const STATUS_TONE: Record<string, string> = {
  approved: 'bg-forest-600 text-paper-soft',
  rejected: 'bg-clay-400/15 text-clay-500',
};

function statusTone(status: string): string {
  return STATUS_TONE[status] ?? 'bg-gold-100 text-gold-600';
}

const selectClass =
  'rounded-xl border border-forest-900/12 bg-paper-card px-3.5 py-2.5 text-sm text-ink outline-none transition focus:border-forest-500 focus:ring-2 focus:ring-forest-500/15';

type SortKey = 'submittedAt' | 'fullName';
type Page = 'applications' | 'analytics' | 'statistics';

export default function AdminDashboard() {
  const router = useRouter();
  const [page, setPage] = useState<Page>('applications');
  const [applications, setApplications] = useState<ApplicationRow[]>([]);
  // The whole point of this panel now: show what actually needs a human,
  // by default. Everything else resolves itself automatically.
  const [status, setStatus] = useState('pending_review');
  const [benefitType, setBenefitType] = useState('');
  const [email, setEmail] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [listTotalCount, setListTotalCount] = useState(0);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [pendingDecision, setPendingDecision] = useState<PendingDecision | null>(null);
  const [decisionNote, setDecisionNote] = useState('');
  const [decisionLimitMonths, setDecisionLimitMonths] = useState('');
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [deciding, setDeciding] = useState(false);
  const [exportDateFrom, setExportDateFrom] = useState('');
  const [exportDateTo, setExportDateTo] = useState('');
  const [exportStatus, setExportStatus] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ActivationImportSummary | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [resolvingDisputeId, setResolvingDisputeId] = useState<string | null>(null);
  const [usage, setUsage] = useState<AiUsage | null>(null);
  const [stats, setStats] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('submittedAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  async function load(overrideStatus?: string) {
    setLoading(true);
    setLoadError(null);
    try {
      const params = new URLSearchParams();
      const s = overrideStatus ?? status;
      if (s) params.set('status', s);
      if (benefitType) params.set('benefitType', benefitType);
      if (email) params.set('email', email);
      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo) params.set('dateTo', dateTo);
      const res = await fetch(`/api/admin/applications?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Қате шықты');
      setApplications(data.applications ?? []);
      setListTotalCount(data.totalCount ?? (data.applications ?? []).length);
      setTruncated(Boolean(data.truncated));
      setSelected(new Set());
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Қате шықты. Қайта көріңіз.');
      setApplications([]);
    } finally {
      setLoading(false);
    }
  }

  function loadStats() {
    fetch('/api/admin/stats')
      .then((res) => res.json())
      .then((data) => setStats(data.byStatus ?? {}))
      .catch(() => {});
  }

  useEffect(() => {
    load();
    loadStats();
    fetch('/api/admin/ai-usage')
      .then((res) => res.json())
      .then((data) => setUsage(data))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sortedApplications = useMemo(() => {
    const copy = [...applications];
    copy.sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'submittedAt') cmp = (a.submittedAt ?? '').localeCompare(b.submittedAt ?? '');
      else cmp = a.user.fullName.localeCompare(b.user.fullName, 'kk');
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return copy;
  }, [applications, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'submittedAt' ? 'desc' : 'asc');
    }
  }

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Opens the decision modal and, for approvals, pre-fills the limit field
  // with the document-derived suggestion instead of leaving the admin to
  // calculate it by hand. Bulk-selecting rows whose documents suggest
  // different limits leaves the field blank rather than silently applying
  // one row's number to all of them — the modal's hint (below) then spells
  // out the mismatch instead of pretending there's a single right answer.
  // One suggestion per id, in the same order — deliberately NOT filtering
  // out the nulls ("this application's documents don't imply any specific
  // limit") before comparing them, unlike an earlier version of this code.
  // A bulk selection where some rows have a known suggestion and others
  // don't is just as much a "can't apply one shared number" case as rows
  // disagreeing on a number — filtering nulls out first made that case
  // silently look like full agreement (pre-filling the one known number
  // for every row, including the ones it doesn't apply to at all).
  function limitSuggestionsFor(ids: string[]): (number | null)[] {
    return ids
      .map((id) => applications.find((a) => a.id === id))
      .filter((a): a is ApplicationRow => Boolean(a))
      .map((a) => suggestedLimitMonths(a.documents));
  }

  function openDecision(ids: string[], label: string, decision: 'approve' | 'reject') {
    setPendingDecision({ ids, label, decision });
    setDecisionNote('');
    setDecisionError(null);
    if (decision === 'approve') {
      const unique = [...new Set(limitSuggestionsFor(ids))];
      setDecisionLimitMonths(unique.length === 1 && unique[0] !== null ? String(unique[0]) : '');
    } else {
      setDecisionLimitMonths('');
    }
  }

  // Rendered under the limit input — explains where the pre-filled number
  // came from, or, for a bulk selection whose documents disagree (or where
  // some simply have no document-derived answer at all), warns that one
  // shared number can't be right for all of them instead of silently going
  // with whatever the field happens to hold.
  function approveLimitHint(ids: string[]): string | null {
    const suggestions = limitSuggestionsFor(ids);
    const unique = [...new Set(suggestions)];
    if (unique.length === 1) {
      return unique[0] !== null ? `Ұсынылады: ${unique[0]} ай (құжат мерзіміне негізделген).` : null;
    }
    if (ids.length > 1) {
      const known = suggestions.filter((n): n is number => n !== null).sort((a, b) => a - b);
      const unknownCount = suggestions.length - known.length;
      const knownPart = known.length > 0 ? `белгілі мерзімдер: ${known.join(', ')} ай` : '';
      const unknownPart = unknownCount > 0 ? `${unknownCount} өтінімнің құжат мерзімі анықталмаған` : '';
      const detail = [knownPart, unknownPart].filter(Boolean).join('; ');
      return `Таңдалған өтінімдердің құжат мерзімдері әртүрлі (${detail}) — бір санмен бекітпей, әрқайсысын жеке тексеріңіз.`;
    }
    return null;
  }

  const pendingRows = sortedApplications.filter((a) => a.status === 'pending_review');
  const allPendingSelected = pendingRows.length > 0 && pendingRows.every((a) => selected.has(a.id));

  function toggleSelectAllPending() {
    setSelected((prev) => {
      if (allPendingSelected) return new Set();
      return new Set(pendingRows.map((a) => a.id));
    });
  }

  async function confirmDecision() {
    if (!pendingDecision) return;
    setDeciding(true);
    setDecisionError(null);
    try {
      const res = await fetch('/api/admin/applications/bulk-decision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ids: pendingDecision.ids,
          decision: pendingDecision.decision,
          note: decisionNote.trim() || undefined,
          limitMonths: pendingDecision.decision === 'approve' ? Number(decisionLimitMonths) : undefined,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setDecisionError(data?.error ?? 'Қате шықты. Қайта көріңіз.');
        return;
      }
      if (data?.failed?.length > 0) {
        // Some rows in the batch succeeded and some didn't (e.g. another
        // admin already decided one) — name exactly which students failed
        // (by looking their id up in the currently-loaded list) instead of
        // just a count, so the admin doesn't have to re-scan the whole
        // table for whichever ones are still pending_review.
        const failedNames = (data.failed as { id: string; error?: string }[])
          .map((f) => applications.find((a) => a.id === f.id)?.user.fullName ?? f.id)
          .join(', ');
        setDecisionError(
          `${data.failed.length} өтінім өзгертілмеді: ${failedNames} (${data.failed[0]?.error ?? 'қате'}). ${data.succeeded} өтінім сәтті өзгертілді.`,
        );
        load();
        loadStats();
        return;
      }
      setPendingDecision(null);
      setDecisionNote('');
      setDecisionLimitMonths('');
      load();
      loadStats();
    } catch {
      setDecisionError('Желі қатесі. Қайта көріңіз.');
    } finally {
      setDeciding(false);
    }
  }

  async function handleImportFile(file: File) {
    setImporting(true);
    setImportError(null);
    setImportResult(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/admin/import-activations', { method: 'POST', body: formData });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? 'Қате шықты');
      setImportResult(data.summary);
      load();
    } catch (e) {
      setImportError(e instanceof Error ? e.message : 'Қате шықты. Қайта көріңіз.');
    } finally {
      setImporting(false);
    }
  }

  async function resolveDispute(id: string) {
    setResolvingDisputeId(id);
    try {
      const res = await fetch(`/api/admin/applications/${id}/resolve-activation-dispute`, { method: 'POST' });
      if (res.ok) load();
    } finally {
      setResolvingDisputeId(null);
    }
  }

  async function handleLogout() {
    try {
      await fetch('/api/admin/logout', { method: 'POST' });
    } finally {
      router.push('/admin/login');
      router.refresh();
    }
  }

  function exportUrl(format: 'xlsx' | 'pf') {
    const params = new URLSearchParams({ format });
    if (exportDateFrom) params.set('dateFrom', exportDateFrom);
    if (exportDateTo) params.set('dateTo', exportDateTo);
    if (exportStatus) params.set('status', exportStatus);
    return `/api/admin/export?${params.toString()}`;
  }

  const activeFilterCount = [benefitType, email, dateFrom, dateTo].filter(Boolean).length;
  const totalCount = Object.values(stats).reduce((sum, n) => sum + n, 0);

  return (
    <main className="mx-auto min-h-dvh w-full max-w-6xl px-5 pb-16 pt-8 sm:px-6 sm:pt-12">
      <div className="stagger mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="eyebrow mb-1">SocialCheck</p>
          <h1 className="font-display text-2xl font-medium text-forest-950 sm:text-3xl">
            Admin панель
          </h1>
        </div>
        <button
          className="-m-2.5 self-end rounded-lg p-2.5 text-sm font-semibold text-ink-faint transition hover:text-clay-500 sm:self-auto"
          onClick={handleLogout}
        >
          Шығу
        </button>
      </div>

      {/* Top-level section switch — applications queue vs. analytics, so
          neither view has to compete for scroll space with the other. */}
      <div className="animate-scale-in mb-6 flex gap-2 rounded-2xl border border-forest-900/8 bg-paper-card p-1.5 shadow-soft">
        <button
          className={`flex-1 rounded-xl px-4 py-2.5 text-sm font-bold transition ${
            page === 'applications' ? 'bg-forest-900 text-paper-soft' : 'text-ink-soft hover:bg-forest-50'
          }`}
          onClick={() => setPage('applications')}
        >
          Өтінімдер
        </button>
        <button
          className={`flex-1 rounded-xl px-4 py-2.5 text-sm font-bold transition ${
            page === 'analytics' ? 'bg-forest-900 text-paper-soft' : 'text-ink-soft hover:bg-forest-50'
          }`}
          onClick={() => setPage('analytics')}
        >
          Аналитика
        </button>
        <button
          className={`flex-1 rounded-xl px-4 py-2.5 text-sm font-bold transition ${
            page === 'statistics' ? 'bg-forest-900 text-paper-soft' : 'text-ink-soft hover:bg-forest-50'
          }`}
          onClick={() => setPage('statistics')}
        >
          Статистика
        </button>
      </div>

      {/* Stays mounted (just hidden) rather than conditionally rendered, so
          switching back to "Өтінімдер" and returning doesn't reset the
          chart's granularity/metric choice or force a refetch. */}
      <div className={page === 'analytics' ? undefined : 'hidden'}>
        <AnalyticsSection usage={usage} />
      </div>
      <div className={page === 'statistics' ? undefined : 'hidden'}>
        <StatisticsSection />
      </div>

      {page === 'applications' && (
        <>
      {/* Stats overview — all 5 statuses shown so "Барлығы" always equals
          the sum of the other cards; before this, drafts (started but not
          yet submitted) counted toward the total with no card of their
          own, so admins would see e.g. 15 total / 13 approved / 0 / 0 and
          have no way to tell where the other 2 went. */}
      <div className="animate-scale-in mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard label="Барлығы" value={totalCount} tone="bg-forest-900/5 text-forest-900" />
        <StatCard label={STATUS_LABELS.draft} value={stats.draft ?? 0} tone="bg-paper-card text-ink-soft border border-forest-900/8" />
        <StatCard
          label={STATUS_LABELS.pending_review}
          value={stats.pending_review ?? 0}
          tone="bg-gold-100 text-gold-600"
        />
        <StatCard label={STATUS_LABELS.approved} value={stats.approved ?? 0} tone="bg-forest-100 text-forest-700" />
        <StatCard label={STATUS_LABELS.rejected} value={stats.rejected ?? 0} tone="bg-clay-400/15 text-clay-500" />
      </div>

      {/* Export: optional date+time range, then download. Either end can
          be left blank (open-ended before/since); leaving both blank
          exports everything. */}
      <div className="animate-scale-in mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-forest-900/8 bg-paper-card p-4 shadow-soft">
        <span className="text-sm font-semibold text-ink-soft">Экспорт кезеңі:</span>
        <input
          type="datetime-local"
          value={exportDateFrom}
          onChange={(e) => setExportDateFrom(e.target.value)}
          aria-label="Бастап"
          className={selectClass}
        />
        <span className="text-sm text-ink-faint">—</span>
        <input
          type="datetime-local"
          value={exportDateTo}
          onChange={(e) => setExportDateTo(e.target.value)}
          aria-label="Дейін"
          className={selectClass}
        />
        <select
          value={exportStatus}
          onChange={(e) => setExportStatus(e.target.value)}
          className={selectClass}
        >
          <option value="">Барлық статус</option>
          {STATUS_OPTIONS.filter((s) => s !== 'draft').map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s as ApplicationStatus]}
            </option>
          ))}
        </select>
        <a className="btn-secondary" href={exportUrl('xlsx')}>
          Excel FULL
        </a>
        <a className="btn-secondary" href={exportUrl('pf')}>
          Excel ПФ
        </a>
      </div>

      {/* Activation import: the admin sends "Excel ПФ" out to Kaspi/the
          school's billing system, and once it confirms which students'
          discounts actually went live, re-uploads that same shape here —
          matched back to applications purely by email (activateDiscount.ts).
          This is the only place discountActivatedAt ever gets set. */}
      <div className="animate-scale-in mb-4 flex flex-col gap-3 rounded-2xl border border-forest-900/8 bg-paper-card p-4 shadow-soft">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-semibold text-ink-soft">
            Белсендіру импорты (Excel ПФ):
          </span>
          <label className="btn-secondary cursor-pointer">
            {importing ? 'Жүктелуде...' : 'Файл таңдау'}
            <input
              type="file"
              accept=".xlsx"
              disabled={importing}
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) handleImportFile(file);
              }}
            />
          </label>
        </div>
        {importError && (
          <p className="rounded-xl bg-clay-400/10 px-3.5 py-2.5 text-sm font-medium text-clay-500">{importError}</p>
        )}
        {importResult && (
          <div className="flex flex-wrap gap-2 text-xs font-semibold">
            <span className="rounded-full bg-forest-100 px-2.5 py-1 text-forest-700">
              Белсендірілді: {importResult.activated.length}
            </span>
            <span className="rounded-full bg-forest-900/5 px-2.5 py-1 text-ink-soft">
              Бұрын белсендірілген: {importResult.alreadyActivated.length}
            </span>
            <span className="rounded-full bg-gold-100 px-2.5 py-1 text-gold-600">
              Мақұлданған өтінімі жоқ: {importResult.noApprovedApplication.length}
            </span>
            <span className="rounded-full bg-clay-400/15 px-2.5 py-1 text-clay-500">
              Табылмады: {importResult.notFound.length}
            </span>
            {importResult.invalid.length > 0 && (
              <span className="rounded-full bg-clay-400/15 px-2.5 py-1 text-clay-500">
                Жарамсыз email: {importResult.invalid.length}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Status tabs — pending_review is the actionable queue; the rest is history. */}
      <div className="animate-scale-in mb-4 flex gap-2 overflow-x-auto">
        {['pending_review', '', ...STATUS_OPTIONS.filter((s) => s !== 'pending_review' && s !== 'draft')].map(
          (s, i) => (
            <button
              key={s || 'all'}
              onClick={() => {
                setStatus(s);
                load(s);
              }}
              className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold outline-none transition focus-visible:ring-2 focus-visible:ring-forest-500/40 ${
                status === s ? 'bg-forest-900 text-paper-soft' : 'bg-paper-card text-ink-soft hover:bg-forest-50'
              }`}
            >
              <span className="inline-flex items-center gap-1">
                {s === '' ? 'Барлығы' : STATUS_LABELS[s as ApplicationStatus]}
                {i === 0 && <Icon name="search" className="h-3.5 w-3.5" />}
              </span>
            </button>
          ),
        )}
      </div>

      {/* Extra filters: collapsible on mobile, always open on desktop */}
      <div className="animate-scale-in mb-4 rounded-2xl border border-forest-900/8 bg-paper-card p-4 shadow-soft">
        <button
          className="-m-4 flex w-[calc(100%+2rem)] items-center justify-between p-4 text-sm font-semibold text-ink sm:hidden"
          onClick={() => setFiltersOpen((v) => !v)}
        >
          <span>
            Қосымша сүзгілер{' '}
            {activeFilterCount > 0 && <span className="chip ml-1 bg-gold-100 text-gold-600">{activeFilterCount}</span>}
          </span>
          <Icon name="chevron-down" className={`h-4 w-4 transition-transform ${filtersOpen ? 'rotate-180' : ''}`} />
        </button>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            load();
          }}
          className={`${filtersOpen ? 'mt-4 flex' : 'hidden'} flex-col gap-3 sm:mt-0 sm:flex sm:flex-row sm:flex-wrap sm:items-center`}
        >
          <select value={benefitType} onChange={(e) => setBenefitType(e.target.value)} className={selectClass}>
            <option value="">Барлық мәртебе</option>
            {BENEFIT_OPTIONS.map((b) => (
              <option key={b} value={b}>
                {BENEFIT_LABELS[b]}
              </option>
            ))}
          </select>
          <input
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={selectClass}
          />
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="datetime-local"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              aria-label="Бастап"
              className={selectClass}
            />
            <span className="text-sm text-ink-faint">—</span>
            <input
              type="datetime-local"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              aria-label="Дейін"
              className={selectClass}
            />
          </div>
          <button type="submit" className="btn-secondary">
            Іздеу
          </button>
        </form>
      </div>

      {/* Bulk action bar — only meaningful while on the actionable queue */}
      {selected.size > 0 && (
        <div className="animate-scale-in sticky top-2 z-10 mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-forest-500/30 bg-forest-50 p-4 shadow-soft">
          <p className="text-sm font-semibold text-forest-900">{selected.size} өтінім таңдалды</p>
          <div className="flex gap-2">
            <button
              className="rounded-full bg-forest-600 px-4 py-2 text-sm font-semibold text-paper-soft transition hover:bg-forest-700"
              onClick={() => openDecision([...selected], `${selected.size} өтінім`, 'approve')}
            >
              Барлығын мақұлдау
            </button>
            <button
              className="rounded-full bg-clay-400/15 px-4 py-2 text-sm font-semibold text-clay-500 transition hover:bg-clay-400/25"
              onClick={() => openDecision([...selected], `${selected.size} өтінім`, 'reject')}
            >
              Барлығын қабылдамау
            </button>
            <button
              className="rounded-full px-3 py-2 text-sm font-semibold text-ink-faint hover:text-ink"
              onClick={() => setSelected(new Set())}
            >
              Болдырмау
            </button>
          </div>
        </div>
      )}

      {loadError && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl bg-clay-400/10 px-4 py-3 text-sm font-medium text-clay-500">
          <span>{loadError}</span>
          <button className="shrink-0 font-bold underline" onClick={() => load()}>
            Қайталау
          </button>
        </div>
      )}

      {truncated && !loading && (
        <p className="mb-4 rounded-2xl bg-gold-100/60 px-4 py-3 text-sm font-medium text-gold-600">
          Тізім {applications.length} / {listTotalCount} өтінімге қысқартылды — дәлірек көру үшін сүзгіні тарылтыңыз.
        </p>
      )}

      {loading ? (
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-2xl bg-forest-900/5" />
          ))}
        </div>
      ) : loadError ? null : applications.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-forest-900/15 p-10 text-center text-sm text-ink-faint">
          {status === 'pending_review' ? 'Тексеруді қажет ететін өтінімдер жоқ.' : 'Өтінімдер табылмады.'}
        </p>
      ) : (
        <>
          {/* Mobile: card list */}
          {pendingRows.length > 0 && (
            <label className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink-soft sm:hidden">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-forest-900/30"
                checked={allPendingSelected}
                onChange={toggleSelectAllPending}
              />
              Тексерілуде — барлығын таңдау
            </label>
          )}
          <ul className="flex flex-col gap-3 sm:hidden">
            {sortedApplications.map((a) => (
              <li key={a.id} className="card">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-start gap-2">
                    {a.status === 'pending_review' && (
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4 shrink-0 rounded border-forest-900/30"
                        checked={selected.has(a.id)}
                        onChange={() => toggleSelected(a.id)}
                      />
                    )}
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-ink">{a.user.fullName}</p>
                      <p className="truncate text-xs text-ink-faint">{a.user.email}</p>
                    </div>
                  </div>
                  <span className={`chip shrink-0 ${statusTone(a.status)}`}>
                    {STATUS_LABELS[a.status]}
                  </span>
                </div>
                {rejectionReasonLabel(a) && (
                  <p className="mb-2 inline-flex items-center gap-1 rounded-full bg-clay-400/15 px-2.5 py-1 text-xs font-bold text-clay-500">
                    <Icon name="alert" className="h-3.5 w-3.5" /> {rejectionReasonLabel(a)}
                  </p>
                )}
                {activationBadge(a) && (
                  <p
                    className={`mb-2 inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-bold ${activationBadge(a)!.tone}`}
                  >
                    {activationBadge(a)!.label}
                    {a.activationDisputedAt && (
                      <button
                        className="underline decoration-2 underline-offset-2 disabled:opacity-50"
                        disabled={resolvingDisputeId === a.id}
                        onClick={() => resolveDispute(a.id)}
                      >
                        Шешілді
                      </button>
                    )}
                  </p>
                )}
                <p className="mb-1 text-sm text-ink">
                  {a.benefitTypes.map((t) => BENEFIT_LABELS[t]).join(', ') || '—'}
                </p>
                <p className="mb-3 text-xs text-ink-faint">
                  {a.status === 'rejected' ? 'Жеңілдік берілмеді' : `${discountPercentFor(a.benefitTypes)}% жеңілдік`}
                  {a.status === 'pending_review' &&
                    suggestedLimitMonths(a.documents) !== null &&
                    ` · ұсынылатын лимит: ${suggestedLimitMonths(a.documents)} ай`}
                </p>
                {a.documents.length > 0 && (
                  <div className="mb-3 flex flex-col gap-1">
                    {a.documents.map((d) => (
                      <div key={d.id} className="flex items-center gap-1.5">
                        <a
                          className="block max-w-full truncate text-xs font-medium text-forest-700 underline decoration-forest-300 underline-offset-2"
                          href={`/api/documents/${d.id}/file`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {d.originalFilename}
                        </a>
                        {d.documentExpiryDate && (
                          <span className="shrink-0 text-xs text-ink-faint">
                            · {formatAlmatyDate(new Date(d.documentExpiryDate))} дейін
                          </span>
                        )}
                        {d.nameMatchesProfile === false && (
                          <span title="Құжаттағы аты-жөні профильмен сәйкес келмейді" className="shrink-0">
                            <Icon name="alert" className="h-3 w-3 text-clay-500" />
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                <button
                  className="-mx-2 -my-1 mb-1 rounded-lg px-2 py-2 text-xs font-semibold text-forest-600 hover:text-forest-800"
                  onClick={() => setExpandedId(expandedId === a.id ? null : a.id)}
                >
                  <span className="inline-flex items-center gap-1">
                    {expandedId === a.id ? 'Тарихты жасыру' : 'Тарихты көру'}
                    <Icon name={expandedId === a.id ? 'chevron-up' : 'chevron-down'} className="h-3.5 w-3.5" />
                  </span>
                </button>
                {expandedId === a.id && <EventTimeline events={a.events} />}
                {a.status === 'pending_review' && (
                  <div className="flex gap-2 border-t border-forest-900/8 pt-3">
                    <ActionButton tone="approve" onClick={() => openDecision([a.id], a.user.fullName, 'approve')} />
                    <ActionButton tone="reject" onClick={() => openDecision([a.id], a.user.fullName, 'reject')} />
                  </div>
                )}
              </li>
            ))}
          </ul>

          {/* Desktop: table */}
          <div className="hidden overflow-x-auto rounded-2xl border border-forest-900/8 bg-paper-card shadow-soft sm:block">
            <table className="w-full min-w-[1040px] text-left text-sm">
              <thead>
                <tr className="border-b border-forest-900/8 text-xs font-semibold uppercase tracking-wide text-ink-faint">
                  <th className="px-4 py-3">
                    {pendingRows.length > 0 && (
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-forest-900/30"
                        checked={allPendingSelected}
                        onChange={toggleSelectAllPending}
                        title="Тексерілуде — барлығын таңдау"
                      />
                    )}
                  </th>
                  <SortableTh label="ФИО" sortKey="fullName" activeKey={sortKey} dir={sortDir} onClick={toggleSort} />
                  <th className="px-2 py-3">Email</th>
                  <th className="px-2 py-3">Мәртебе</th>
                  <th className="px-2 py-3">Жеңілдік</th>
                  <th className="px-2 py-3">Құжаттар</th>
                  <SortableTh
                    label="Жіберілген"
                    sortKey="submittedAt"
                    activeKey={sortKey}
                    dir={sortDir}
                    onClick={toggleSort}
                  />
                  <th className="px-2 py-3">Статус</th>
                  <th className="px-2 py-3">Тарих</th>
                  <th className="px-4 py-3">Әрекет</th>
                </tr>
              </thead>
              <tbody>
                {sortedApplications.map((a) => (
                  <Fragment key={a.id}>
                    <tr className="border-b border-forest-900/6 transition-colors hover:bg-forest-50/50">
                      <td className="px-4 py-3">
                        {a.status === 'pending_review' && (
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-forest-900/30"
                            checked={selected.has(a.id)}
                            onChange={() => toggleSelected(a.id)}
                          />
                        )}
                      </td>
                      <td className="px-2 py-3 font-medium text-ink">{a.user.fullName}</td>
                      <td className="px-2 py-3 text-ink-soft">{a.user.email}</td>
                      <td className="px-2 py-3 text-ink-soft">
                        {a.benefitTypes.map((t) => BENEFIT_LABELS[t]).join(', ')}
                      </td>
                      <td className={`px-2 py-3 font-medium ${a.status === 'rejected' ? 'text-ink-faint' : 'text-gold-600'}`}>
                        {a.status === 'rejected' ? '—' : `${discountPercentFor(a.benefitTypes)}%`}
                        {a.status === 'pending_review' && suggestedLimitMonths(a.documents) !== null && (
                          <span className="block text-[11px] font-normal text-ink-faint">
                            {suggestedLimitMonths(a.documents)} ай
                          </span>
                        )}
                      </td>
                      <td className="max-w-[160px] px-2 py-3">
                        {a.documents.length === 0 ? (
                          <span className="text-ink-faint">—</span>
                        ) : (
                          <div className="flex flex-col gap-1.5">
                            {a.documents.map((d) => (
                              <div key={d.id}>
                                <a
                                  className={`block truncate underline decoration-2 underline-offset-2 ${
                                    d.nameMatchesProfile === false
                                      ? 'text-clay-500 decoration-clay-400 hover:text-clay-600'
                                      : 'text-forest-700 decoration-forest-300 hover:text-forest-900'
                                  }`}
                                  href={`/api/documents/${d.id}/file`}
                                  target="_blank"
                                  rel="noreferrer"
                                  title={
                                    d.nameMatchesProfile === false
                                      ? `${d.originalFilename} — аты-жөні профильмен сәйкес келмейді`
                                      : d.originalFilename
                                  }
                                >
                                  {d.originalFilename}
                                </a>
                                {d.documentExpiryDate && (
                                  <span className="block text-[11px] text-ink-faint">
                                    {formatAlmatyDate(new Date(d.documentExpiryDate))} дейін
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-2 py-3 text-xs text-ink-faint">
                        {a.submittedAt ? formatAlmatyDateTime(new Date(a.submittedAt)) : '—'}
                      </td>
                      <td className="px-2 py-3">
                        <span className={`chip ${statusTone(a.status)}`}>{STATUS_LABELS[a.status]}</span>
                        {rejectionReasonLabel(a) && (
                          <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-clay-400/15 px-2 py-0.5 text-[11px] font-bold text-clay-500">
                            <Icon name="alert" className="h-3.5 w-3.5" /> {rejectionReasonLabel(a)}
                          </p>
                        )}
                        {activationBadge(a) && (
                          <p
                            className={`mt-1 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-bold ${activationBadge(a)!.tone}`}
                          >
                            {activationBadge(a)!.label}
                            {a.activationDisputedAt && (
                              <button
                                className="underline decoration-2 underline-offset-2 disabled:opacity-50"
                                disabled={resolvingDisputeId === a.id}
                                onClick={() => resolveDispute(a.id)}
                              >
                                Шешілді
                              </button>
                            )}
                          </p>
                        )}
                      </td>
                      <td className="px-2 py-3">
                        <button
                          className="text-xs font-semibold text-forest-600 hover:text-forest-800"
                          onClick={() => setExpandedId(expandedId === a.id ? null : a.id)}
                        >
                          <span className="inline-flex items-center gap-1">
                            {expandedId === a.id ? 'Жасыру' : 'Көру'}
                            <Icon name={expandedId === a.id ? 'chevron-up' : 'chevron-down'} className="h-3 w-3" />
                          </span>
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        {a.status === 'pending_review' ? (
                          <div className="flex gap-2">
                            <ActionButton
                              tone="approve"
                              onClick={() => openDecision([a.id], a.user.fullName, 'approve')}
                            />
                            <ActionButton
                              tone="reject"
                              onClick={() => openDecision([a.id], a.user.fullName, 'reject')}
                            />
                          </div>
                        ) : (
                          <span className="text-ink-faint">—</span>
                        )}
                      </td>
                    </tr>
                    {expandedId === a.id && (
                      <tr className="border-b border-forest-900/6 bg-forest-50/30">
                        <td colSpan={10} className="px-4 py-3">
                          <EventTimeline events={a.events} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
        </>
      )}

      {pendingDecision && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-forest-950/40 p-4 backdrop-blur-sm"
          onClick={() =>
            !deciding &&
            (setPendingDecision(null), setDecisionNote(''), setDecisionLimitMonths(''), setDecisionError(null))
          }
        >
          <div
            className="animate-scale-in w-full max-w-sm rounded-2xl bg-paper-card p-6 shadow-lifted"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-2 font-display text-lg font-medium text-forest-950">
              {pendingDecision.decision === 'approve' ? 'Мақұлдау' : 'Қабылдамау'}
            </h2>
            <p className="mb-4 text-sm leading-relaxed text-ink-soft">
              <strong className="text-ink">{pendingDecision.label}</strong> — растайсыз ба?
              {pendingDecision.decision === 'approve'
                ? ' Жеңілдік беріледі.'
                : ' Жеңілдік берілмейді, құжаттар жойылады.'}
            </p>
            {pendingDecision.decision === 'approve' && (
              <label className="mb-4 block">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink-faint">
                  Жеңілдік лимиті (ай) *
                </span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={60}
                  step={1}
                  value={decisionLimitMonths}
                  onChange={(e) => setDecisionLimitMonths(e.target.value)}
                  className="w-full rounded-xl border border-forest-900/12 bg-paper-soft px-3.5 py-2.5 text-sm text-ink outline-none transition focus:border-forest-500 focus:ring-2 focus:ring-forest-500/15"
                  placeholder="Мысалы: 12"
                />
                <span className="mt-1 block text-xs text-ink-faint">
                  Жеңілдік неше айға берілетінін көрсетіңіз (1–60) — қажет болса өзгертіңіз.
                </span>
                {approveLimitHint(pendingDecision.ids) && (
                  <span className="mt-1 block text-xs font-medium text-forest-700">
                    {approveLimitHint(pendingDecision.ids)}
                  </span>
                )}
              </label>
            )}
            <label className="mb-6 block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink-faint">
                Түсініктеме (міндетті емес)
              </span>
              <textarea
                value={decisionNote}
                onChange={(e) => setDecisionNote(e.target.value)}
                rows={2}
                maxLength={1000}
                className="w-full resize-none rounded-xl border border-forest-900/12 bg-paper-soft px-3.5 py-2.5 text-sm text-ink outline-none transition focus:border-forest-500 focus:ring-2 focus:ring-forest-500/15"
                placeholder="Мысалы: құжат сапасы төмен"
              />
            </label>
            {decisionError && (
              <p className="mb-4 rounded-xl bg-clay-400/10 px-3.5 py-2.5 text-xs font-medium text-clay-500">
                {decisionError}
              </p>
            )}
            <div className="flex gap-3">
              <button
                className="btn-secondary flex-1"
                disabled={deciding}
                onClick={() => {
                  setPendingDecision(null);
                  setDecisionNote('');
                  setDecisionLimitMonths('');
                  setDecisionError(null);
                }}
              >
                Болдырмау
              </button>
              <button
                className={`flex-1 rounded-full px-6 py-3 text-sm font-semibold text-paper-soft transition disabled:opacity-50 ${
                  pendingDecision.decision === 'approve'
                    ? 'bg-forest-700 hover:bg-forest-800'
                    : 'bg-clay-500 hover:bg-clay-500/90'
                }`}
                disabled={
                  deciding ||
                  (pendingDecision.decision === 'approve' &&
                    !(
                      Number.isInteger(Number(decisionLimitMonths)) &&
                      Number(decisionLimitMonths) >= 1 &&
                      Number(decisionLimitMonths) <= 60
                    ))
                }
                onClick={confirmDecision}
              >
                {deciding ? '...' : 'Растау'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function StatCard({
  label,
  value,
  tone,
  icon,
  trend,
}: {
  label: string;
  value: number | string;
  tone: string;
  // Purely decorative context (which metric family this is), never the
  // only way to identify the card — the label text already does that.
  icon?: Parameters<typeof Icon>[0]['name'];
  // 12-point-ish trend per the stat-tile contract (marks-and-anatomy.md):
  // de-emphasis hue with the current period picked out in the accent.
  trend?: number[];
}) {
  return (
    <div className={`relative overflow-hidden rounded-2xl px-4 py-3.5 shadow-soft ${tone}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="font-display text-2xl font-semibold">{value}</p>
        {icon && (
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-black/5">
            <Icon name={icon} className="h-3.5 w-3.5 opacity-70" />
          </span>
        )}
      </div>
      <p className="text-xs font-semibold opacity-80">{label}</p>
      {trend && trend.length >= 2 && (
        <div className="mt-2 h-6">
          <Sparkline values={trend} />
        </div>
      )}
    </div>
  );
}

// Trend-only, axis-free — the stat tile's value already carries the exact
// number, so this only has to communicate "shape": is it rising, flat, or
// choppy. De-emphasis gray for the path, with the final (current) point
// picked out in the tile's own text color so it reads as "you are here"
// without introducing a second hue.
function Sparkline({ values }: { values: number[] }) {
  // `values.length - 1` in the x formula below divides by zero for a
  // single point. Every current caller already checks `trend.length >= 2`
  // before rendering this, but that guard living only on the caller side
  // is fragile — keep one here too so the component is safe on its own.
  if (values.length < 2) return null;
  const w = 100;
  const h = 24;
  const max = Math.max(...values, 0.0001);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const points = values.map((v, i) => ({
    x: (i / (values.length - 1)) * w,
    y: h - ((v - min) / range) * (h - 4) - 2,
  }));
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const last = points[points.length - 1]!;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-full w-full overflow-visible" preserveAspectRatio="none">
      <path d={path} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" opacity={0.45} vectorEffect="non-scaling-stroke" />
      <circle cx={last.x} cy={last.y} r={2} fill="currentColor" />
    </svg>
  );
}

// "A single ratio against a limit -> Meter (same-ramp track)" — the
// dataviz skill's explicit alternative to a pie for exactly this shape of
// number (approval rate). Track is a lighter step of the same hue as the
// fill so the state reads across the whole bar, not just the filled part.
function Meter({
  label,
  percent,
  fillClassName = 'bg-forest-600',
  trackClassName = 'bg-forest-100',
}: {
  label: string;
  percent: number | null;
  fillClassName?: string;
  trackClassName?: string;
}) {
  const clamped = percent === null ? 0 : Math.max(0, Math.min(100, percent));
  return (
    <div className="rounded-2xl border border-forest-900/8 bg-paper-card px-4 py-3.5 shadow-soft">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <p className="text-xs font-semibold text-ink-faint">{label}</p>
        <p className="font-display text-lg font-semibold text-ink">{percent !== null ? `${percent.toFixed(0)}%` : '—'}</p>
      </div>
      {/* No data (nothing decided yet in this period) reads as a plain
          neutral track, not the same-ramp color — a colored empty track
          would look like "some" progress when there's genuinely none. */}
      <div className={`h-2.5 w-full overflow-hidden rounded-full ${percent === null ? 'bg-forest-900/6' : trackClassName}`}>
        {percent !== null && (
          <div
            className={`h-full rounded-full transition-all duration-700 ease-out ${fillClassName}`}
            style={{ width: `${clamped}%` }}
          />
        )}
      </div>
    </div>
  );
}

function SortableTh({
  label,
  sortKey,
  activeKey,
  dir,
  onClick,
}: {
  label: string;
  sortKey: SortKey;
  activeKey: SortKey;
  dir: 'asc' | 'desc';
  onClick: (key: SortKey) => void;
}) {
  const active = activeKey === sortKey;
  return (
    <th className="px-2 py-3">
      <button
        className={`flex items-center gap-1 transition ${active ? 'text-forest-700' : 'hover:text-ink'}`}
        onClick={() => onClick(sortKey)}
      >
        {label}
        <Icon
          name={active ? (dir === 'asc' ? 'chevron-up' : 'chevron-down') : 'sort'}
          className="h-3 w-3"
        />
      </button>
    </th>
  );
}

function EventTimeline({ events }: { events: ApplicationEventRow[] }) {
  if (events.length === 0) {
    return <p className="text-xs text-ink-faint">Тарих жоқ.</p>;
  }
  return (
    <ul className="flex flex-col gap-2">
      {[...events].reverse().map((e) => {
        const meta = e.metadata as { note?: string; reason?: string } | null;
        return (
          <li key={e.id} className="text-xs text-ink-soft">
            <span className="font-semibold text-ink">{formatAlmatyDateTime(new Date(e.createdAt))}</span>
            {' · '}
            {EVENT_TYPE_LABELS[e.eventType] ?? e.eventType}
            {e.newStatus && <> → <span className="font-semibold">{STATUS_LABELS[e.newStatus as ApplicationStatus] ?? e.newStatus}</span></>}
            {' · '}
            <span className="text-ink-faint">{e.actor}</span>
            {meta?.reason && (
              <span className="ml-1 text-clay-500">({REJECTION_REASON_LABELS[meta.reason] ?? meta.reason})</span>
            )}
            {meta?.note && <span className="ml-1 italic text-ink-faint">— «{meta.note}»</span>}
          </li>
        );
      })}
    </ul>
  );
}

function formatUsd(value: number): string {
  return `$${value.toFixed(value < 1 ? 4 : 2)}`;
}

function formatCount(value: number): string {
  return value.toLocaleString('ru-RU');
}

type Granularity = 'day' | 'week' | 'month';
type Metric = 'costUsd' | 'totalTokens' | 'calls';

type TimeseriesPoint = { period: string; calls: number; totalTokens: number; costUsd: number };

const GRANULARITY_LABELS: Record<Granularity, string> = { day: 'Күн', week: 'Апта', month: 'Ай' };
const GRANULARITY_DAYS: Record<Granularity, number> = { day: 30, week: 182, month: 365 };
const METRIC_LABELS: Record<Metric, string> = { costUsd: 'Шығын ($)', totalTokens: 'Токендер', calls: 'Шақырулар' };
const SHORT_MONTHS = ['қаң', 'ақп', 'нау', 'сәу', 'мам', 'мау', 'шіл', 'там', 'қыр', 'қаз', 'қар', 'жел'];

// The server buckets by Almaty calendar day/week/month but the driver
// serializes the naive result as if it were UTC — so reading these back
// with getUTC* accessors (never local-tz or a second Almaty conversion)
// recovers exactly the Almaty-local bucket boundary the server intended.
function formatPeriodLabel(periodIso: string, granularity: Granularity): string {
  const d = new Date(periodIso);
  const day = d.getUTCDate();
  const month = SHORT_MONTHS[d.getUTCMonth()];
  const year = d.getUTCFullYear();
  if (granularity === 'month') return `${month} ${year}`;
  return `${day} ${month}`;
}

function AnalyticsSection({ usage }: { usage: AiUsage | null }) {
  const [granularity, setGranularity] = useState<Granularity>('day');
  const [metric, setMetric] = useState<Metric>('costUsd');
  const [series, setSeries] = useState<TimeseriesPoint[]>([]);
  // Starts true — the fetch effect below only flips it on its own first
  // run, one render after mount, so a `false` default would let the very
  // first paint fall through to the "no data" empty state before the
  // request even started (a wrong-empty-state flash, not the intended
  // "hold the frame" skeleton).
  const [seriesLoading, setSeriesLoading] = useState(true);

  useEffect(() => {
    setSeriesLoading(true);
    fetch(`/api/admin/ai-usage/timeseries?granularity=${granularity}&days=${GRANULARITY_DAYS[granularity]}`)
      .then((res) => res.json())
      .then((data) => setSeries(data.series ?? []))
      .catch(() => setSeries([]))
      .finally(() => setSeriesLoading(false));
  }, [granularity]);

  const periodTotal = useMemo(() => {
    if (metric === 'costUsd') return series.reduce((sum, p) => sum + p.costUsd, 0);
    if (metric === 'totalTokens') return series.reduce((sum, p) => sum + p.totalTokens, 0);
    return series.reduce((sum, p) => sum + p.calls, 0);
  }, [series, metric]);

  return (
    <div className="animate-scale-in flex flex-col gap-4">
      {usage && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatCard label="Барлық шығын" value={formatUsd(usage.totals.costUsd)} tone="bg-forest-900/5 text-forest-900" icon="zap" />
          <StatCard label="Соңғы 30 күн" value={formatUsd(usage.last30Days.costUsd)} tone="bg-forest-100 text-forest-700" icon="hourglass" />
          <StatCard label="Барлық шақыру" value={formatCount(usage.totals.calls)} tone="bg-gold-100 text-gold-600" icon="sparkle" />
          <StatCard
            label="Өтінімге орташа"
            value={usage.avgCostPerApplication !== null ? formatUsd(usage.avgCostPerApplication) : '—'}
            tone="bg-paper-card text-ink border border-forest-900/8"
            icon="check-circle"
          />
        </div>
      )}

      <div className="rounded-2xl border border-forest-900/8 bg-paper-card p-4 shadow-soft sm:p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
              {METRIC_LABELS[metric]} · {GRANULARITY_LABELS[granularity].toLowerCase()} бойынша
            </p>
            <p className="font-display text-2xl font-semibold text-forest-900">
              {metric === 'costUsd' ? formatUsd(periodTotal) : formatCount(Math.round(periodTotal))}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <div className="flex rounded-xl bg-forest-50 p-1">
              {(Object.keys(GRANULARITY_LABELS) as Granularity[]).map((g) => (
                <button
                  key={g}
                  onClick={() => setGranularity(g)}
                  className={`rounded-lg px-3 py-3 text-xs font-bold outline-none transition focus-visible:ring-2 focus-visible:ring-forest-500/40 ${
                    granularity === g ? 'bg-forest-900 text-paper-soft' : 'text-ink-soft hover:text-ink'
                  }`}
                >
                  {GRANULARITY_LABELS[g]}
                </button>
              ))}
            </div>
            <div className="flex rounded-xl bg-forest-50 p-1">
              {(Object.keys(METRIC_LABELS) as Metric[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setMetric(m)}
                  className={`rounded-lg px-3 py-3 text-xs font-bold outline-none transition focus-visible:ring-2 focus-visible:ring-forest-500/40 ${
                    metric === m ? 'bg-forest-900 text-paper-soft' : 'text-ink-soft hover:text-ink'
                  }`}
                >
                  {METRIC_LABELS[m]}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* First load only shows the skeleton — a granularity/metric
            switch afterward holds the previous render at reduced opacity
            instead of flashing blank (interaction.md: "refetch keeps the
            frame"). */}
        {series.length === 0 && seriesLoading ? (
          <div className="h-56 animate-pulse rounded-xl bg-forest-900/5" />
        ) : series.length === 0 ? (
          <p className="py-12 text-center text-sm text-ink-faint">Бұл кезеңде деректер жоқ.</p>
        ) : (
          <div className={`transition-opacity duration-200 ${seriesLoading ? 'opacity-40' : 'opacity-100'}`}>
            <TimeseriesChart series={series} metric={metric} granularity={granularity} />
          </div>
        )}
      </div>

      {usage && (
        <div className="grid gap-4 rounded-2xl border border-forest-900/8 bg-paper-card p-4 shadow-soft sm:grid-cols-2 sm:p-6">
          <MagnitudeBreakdown title="Модель бойынша" rows={usage.byModel.map((m) => ({ key: m.model, label: m.model, calls: m.calls, costUsd: m.costUsd }))} />
          <MagnitudeBreakdown
            title="Түрі бойынша"
            rows={usage.byKind.map((k) => ({ key: k.kind, label: KIND_LABELS[k.kind] ?? k.kind, calls: k.calls, costUsd: k.costUsd }))}
          />
        </div>
      )}
    </div>
  );
}

// "Compare magnitude" over nominal categories (model/document-type names) —
// one flat hue for every bar, length carries the comparison. Coloring bars
// darker-where-bigger here would double-encode length as hue and fail the
// categorical checks by design (anti-patterns.md), so every bar shares the
// same sequential-blue tone; only its length differs.
function MagnitudeBreakdown({
  title,
  rows,
}: {
  title: string;
  rows: { key: string; label: string; calls: number; costUsd: number }[];
}) {
  const max = Math.max(...rows.map((r) => r.costUsd), 0.0001);
  return (
    <div>
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-faint">{title}</p>
      <ul className="flex flex-col gap-2.5">
        {rows.map((r) => (
          <li key={r.key}>
            <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
              <span className="truncate text-ink">{r.label}</span>
              <span className="shrink-0 font-semibold text-ink">{formatUsd(r.costUsd)}</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-forest-900/5">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${(r.costUsd / max) * 100}%`, background: SEQ_LINE }}
              />
            </div>
            <p className="mt-0.5 text-[11px] text-ink-faint">{formatCount(r.calls)} шақыру</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

const CHART_WIDTH = 800;
const CHART_HEIGHT = 220;
const CHART_PAD_LEFT = 44;
const CHART_PAD_BOTTOM = 24;
const CHART_PAD_TOP = 12;

// Trend-over-time, one series -> line + soft area wash, per
// choosing-a-form.md ("Trend over time -> line; area for a single series",
// color job "sequential or 1 categorical"). SEQ_LINE/SEQ_AREA below are the
// dataviz skill's own reference sequential-blue ramp (palette.md step
// 450/mid-tone for the stroke, same hue at the documented ~10% area-fill
// wash) — a different hue from this app's own teal/gold brand on purpose,
// matching how STATUS_CHART_COLORS/BENEFIT_CHART_COLORS already borrow
// validated chart hues while the surrounding chrome stays on-brand.
const SEQ_LINE = '#2a78d6';
const SEQ_AREA = 'rgba(42,120,214,0.12)';

function TimeseriesChart({
  series,
  metric,
  granularity,
}: {
  series: TimeseriesPoint[];
  metric: Metric;
  granularity: Granularity;
}) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const values = series.map((p) => (metric === 'costUsd' ? p.costUsd : metric === 'totalTokens' ? p.totalTokens : p.calls));
  // A hard floor of 1 here would flatten a real chart to invisible for
  // costUsd, whose values are routinely fractions of a cent — the axis
  // would scale 0..$1 against data that never leaves $0..$0.01. Only fall
  // back at all to keep the scale finite when every value is truly zero.
  const maxValue = Math.max(...values, 0.0001);

  const plotWidth = CHART_WIDTH - CHART_PAD_LEFT;
  const plotHeight = CHART_HEIGHT - CHART_PAD_TOP - CHART_PAD_BOTTOM;
  const baselineY = CHART_PAD_TOP + plotHeight;
  // Single points still need somewhere to put the one mark — center it.
  const xFor = (i: number) => (series.length <= 1 ? CHART_PAD_LEFT + plotWidth / 2 : CHART_PAD_LEFT + (i / (series.length - 1)) * plotWidth);
  const yFor = (v: number) => baselineY - (maxValue > 0 ? (v / maxValue) * plotHeight : 0);

  const points = values.map((v, i) => ({ x: xFor(i), y: yFor(v) }));
  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const areaPath = points.length
    ? `${linePath} L${points[points.length - 1]!.x.toFixed(1)},${baselineY} L${points[0]!.x.toFixed(1)},${baselineY} Z`
    : '';

  const labelStride = Math.max(1, Math.ceil(series.length / 7));
  const gridLines = [0, 0.25, 0.5, 0.75, 1];
  const last = points[points.length - 1];

  function handleMove(e: React.PointerEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg || series.length === 0) return;
    const rect = svg.getBoundingClientRect();
    const scaleX = CHART_WIDTH / rect.width;
    const localX = (e.clientX - rect.left) * scaleX;
    // Nearest-point rather than exact hit — "the crosshair finds the X",
    // the reader aims at a period, never at a 2px line (interaction.md).
    let closest = 0;
    let bestDist = Infinity;
    points.forEach((p, i) => {
      const dist = Math.abs(p.x - localX);
      if (dist < bestDist) {
        bestDist = dist;
        closest = i;
      }
    });
    setHoverIndex(closest);
  }

  const hovered = hoverIndex !== null ? series[hoverIndex] : null;
  const hoveredPoint = hoverIndex !== null ? points[hoverIndex] : null;

  // Arrow-left/right steps the same crosshair a keyboard user would get
  // from the mouse — "same details on keyboard focus as on hover"
  // (interaction.md). Focusing the plot for the first time (Tab into it)
  // starts on the last/most-recent point, mirroring the always-visible
  // endpoint marker shown when nothing is hovered.
  function handleKeyDown(e: React.KeyboardEvent<SVGRectElement>) {
    if (series.length === 0) return;
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setHoverIndex((h) => Math.max(0, (h ?? series.length - 1) - 1));
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      setHoverIndex((h) => Math.min(series.length - 1, (h ?? series.length - 1) + 1));
    }
  }

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        className="w-full touch-none"
        style={{ height: 'auto' }}
        onPointerMove={handleMove}
        onPointerLeave={() => setHoverIndex(null)}
      >
        {gridLines.map((f) => {
          const y = CHART_PAD_TOP + plotHeight * (1 - f);
          return (
            <g key={f}>
              <line x1={CHART_PAD_LEFT} x2={CHART_WIDTH} y1={y} y2={y} stroke="currentColor" className="text-forest-900/8" strokeWidth={1} />
              <text x={0} y={y + 3} fontSize={9} className="fill-ink-faint">
                {formatAxisValue(maxValue * f, metric)}
              </text>
            </g>
          );
        })}

        {areaPath && <path d={areaPath} fill={SEQ_AREA} className="animate-fade-up" style={{ animationDuration: '0.5s' }} />}
        {linePath && (
          <path
            d={linePath}
            fill="none"
            stroke={SEQ_LINE}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="animate-fade-up"
            style={{ animationDuration: '0.5s' }}
          />
        )}

        {series.map((p, i) => {
          const showLabel = i % labelStride === 0 || i === series.length - 1;
          if (!showLabel) return null;
          const px = xFor(i);
          // A centered label on the last (rightmost) point overhangs the
          // viewBox by half its width and gets clipped by the card edge —
          // anchor it to its own right edge there instead, same fix
          // already used for the value label just below.
          const anchor = px > CHART_WIDTH - 40 ? 'end' : px < 40 ? 'start' : 'middle';
          const labelX = anchor === 'end' ? Math.min(px + 20, CHART_WIDTH) : anchor === 'start' ? Math.max(px - 20, 0) : px;
          return (
            <text key={p.period} x={labelX} y={CHART_HEIGHT - 6} fontSize={9} textAnchor={anchor} className="fill-ink-faint">
              {formatPeriodLabel(p.period, granularity)}
            </text>
          );
        })}

        {/* Crosshair — a vertical hairline snapped to the nearest period,
            plus a marker (>=8px, 2px surface ring) at the hovered point and
            a permanent endpoint marker so the latest value is always
            direct-labeled, not just on hover (marks-and-anatomy.md: "Lines
            -> value at the end"). */}
        {hoveredPoint && (
          <line x1={hoveredPoint.x} x2={hoveredPoint.x} y1={CHART_PAD_TOP} y2={baselineY} stroke="currentColor" className="text-forest-900/20" strokeWidth={1} />
        )}
        {hoveredPoint && <circle cx={hoveredPoint.x} cy={hoveredPoint.y} r={5} fill={SEQ_LINE} className="stroke-paper-card" strokeWidth={2} />}
        {last && hoverIndex === null && <circle cx={last.x} cy={last.y} r={4} fill={SEQ_LINE} className="stroke-paper-card" strokeWidth={2} />}
        {last && (
          <text
            x={Math.min(last.x + 6, CHART_WIDTH - 4)}
            // A point near the top of the plot (e.g. the single-point case
            // — one bucket, so its value IS the max, sitting right at
            // CHART_PAD_TOP) would push this label above the plot
            // entirely, straight into the top gridline's own axis label.
            // Drop it below the point instead once there's no room above.
            y={last.y - 8 < CHART_PAD_TOP + 8 ? last.y + 16 : last.y - 8}
            fontSize={10}
            fontWeight={700}
            textAnchor={last.x > CHART_WIDTH - 60 ? 'end' : 'start'}
            className="fill-ink"
          >
            {formatAxisValue(values[values.length - 1]!, metric)}
          </text>
        )}

        {/* Full-plot hit area for the crosshair — bars/cells hit their own
            mark, but a line's hit target is the whole plot band. Also the
            keyboard entry point: focusable, arrow keys step the crosshair,
            aria-label speaks the currently-focused (or latest) point since
            the visual tooltip is `pointer-events-none` and never itself
            reachable by Tab. */}
        <rect
          x={CHART_PAD_LEFT}
          y={0}
          width={plotWidth}
          height={CHART_HEIGHT}
          fill="transparent"
          tabIndex={0}
          role="img"
          aria-label={
            hovered
              ? `${formatPeriodLabel(hovered.period, granularity)}: ${formatUsd(hovered.costUsd)}, ${formatCount(hovered.totalTokens)} токен, ${formatCount(hovered.calls)} шақыру`
              : last
                ? `Соңғы период: ${formatAxisValue(values[values.length - 1]!, metric)}. Бағыттар пернесімен шолыңыз.`
                : undefined
          }
          onFocus={() => setHoverIndex((h) => h ?? series.length - 1)}
          onBlur={() => setHoverIndex(null)}
          onKeyDown={handleKeyDown}
        />
      </svg>

      {hovered && hoveredPoint && (
        <div
          className="pointer-events-none absolute -top-2 -translate-x-1/2 -translate-y-full rounded-lg bg-forest-950 px-3 py-2 text-xs shadow-lifted"
          style={{ left: `${clampPct((hoveredPoint.x / CHART_WIDTH) * 100)}%` }}
        >
          <p className="mb-1 font-semibold text-paper-soft/70">{formatPeriodLabel(hovered.period, granularity)}</p>
          <p className="flex items-center gap-1.5 text-paper-soft">
            <span className="h-0.5 w-3 rounded-full" style={{ background: SEQ_LINE }} aria-hidden />
            <span className="font-bold">{formatUsd(hovered.costUsd)}</span>
            <span className="text-paper-soft/60">
              · {formatCount(hovered.totalTokens)} токен · {formatCount(hovered.calls)} шақыру
            </span>
          </p>
        </div>
      )}
    </div>
  );
}

function formatAxisValue(value: number, metric: Metric): string {
  // Matches formatUsd's precision tiers — OCR calls cost fractions of a
  // cent, so a gridline fraction of a tiny maxValue needs 4 decimals or it
  // just rounds away to "$0.000" and the axis looks broken.
  if (metric === 'costUsd') return `$${value.toFixed(value < 0.01 ? 4 : value < 1 ? 3 : 1)}`;
  return formatCount(Math.round(value));
}

// ---------- "Статистика" tab ----------

type AppStatsSeries = {
  period: string;
  draft: number;
  pending_review: number;
  approved: number;
  rejected: number;
  total: number;
};

type AppStats = {
  granularity: Granularity;
  total: number;
  statusCounts: Record<ApplicationStatus, number>;
  approvalRate: number | null;
  benefitTypeCounts: Record<string, number>;
  series: AppStatsSeries[];
};

const STATUS_ORDER: ApplicationStatus[] = ['draft', 'pending_review', 'approved', 'rejected'];

// Fixed status colors (not themed to the app's teal/gold brand) — these are
// state indicators, not a categorical series, so they use the dataviz
// skill's reserved status palette (good/warning/critical + a neutral for
// "draft", which isn't really good or bad). The brand teal fails the
// palette validator's chroma/lightness gates for use as a chart mark
// (it's a deliberately desaturated hue), so chart marks borrow validated
// hues while the surrounding cards/inputs stay in the app's own palette.
const STATUS_CHART_COLORS: Record<ApplicationStatus, string> = {
  draft: '#898781',
  pending_review: '#fab219',
  approved: '#0ca30c',
  rejected: '#d03b3b',
};

// Categorical, validated all-pairs (safe for a small-multiple/legend
// context, not just adjacent bars) — see dataviz skill reference palette,
// slots 1-3.
const BENEFIT_CHART_COLORS: Record<string, string> = {
  many_children_family: '#2a78d6',
  incomplete_family: '#eb6834',
  disability: '#1baf7a',
};

function StatisticsSection() {
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [granularity, setGranularity] = useState<Granularity>('day');
  const [stats, setStats] = useState<AppStats | null>(null);
  // See the identical reasoning on AnalyticsSection's seriesLoading — a
  // `false` default here lets the first paint show "no data" for one
  // frame before the mount effect's `load()` call even starts.
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ granularity });
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);
    fetch(`/api/admin/statistics?${params.toString()}`)
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) throw new Error(data?.error ?? 'Қате шықты');
        setStats(data);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Қате шықты. Қайта көріңіз.'))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    // Granularity changes re-fetch automatically (like the AI-usage chart's
    // toggle); the date range is applied explicitly via the "Қолдану"
    // button below, so typing into the inputs doesn't spam requests.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [granularity]);

  return (
    <div className="animate-scale-in flex flex-col gap-4">
      <div className="rounded-2xl border border-forest-900/8 bg-paper-card p-4 shadow-soft sm:p-6">
        <div className="mb-5 flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-ink-soft">Кезең:</span>
          <input
            type="datetime-local"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            aria-label="Бастап"
            className={selectClass}
          />
          <span className="text-sm text-ink-faint">—</span>
          <input
            type="datetime-local"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            aria-label="Дейін"
            className={selectClass}
          />
          <button type="button" className="btn-secondary" disabled={loading} onClick={load}>
            {loading ? '...' : 'Қолдану'}
          </button>
        </div>

        {error && (
          <p className="mb-4 rounded-xl bg-clay-400/10 px-4 py-3 text-sm font-medium text-clay-500">{error}</p>
        )}

        {stats && (
          <>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">Таңдалған кезеңде</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              <StatCard
                label="Барлығы"
                value={stats.total}
                tone="bg-forest-900/5 text-forest-900"
                trend={stats.series.map((s) => s.total)}
              />
              <StatCard
                label={STATUS_LABELS.draft}
                value={stats.statusCounts.draft}
                tone="bg-paper-card text-ink-soft border border-forest-900/8"
                icon="edit"
                trend={stats.series.map((s) => s.draft)}
              />
              <StatCard
                label={STATUS_LABELS.pending_review}
                value={stats.statusCounts.pending_review}
                tone="bg-gold-100 text-gold-600"
                icon="search"
                trend={stats.series.map((s) => s.pending_review)}
              />
              <StatCard
                label={STATUS_LABELS.approved}
                value={stats.statusCounts.approved}
                tone="bg-forest-100 text-forest-700"
                icon="check-circle"
                trend={stats.series.map((s) => s.approved)}
              />
              <StatCard
                label={STATUS_LABELS.rejected}
                value={stats.statusCounts.rejected}
                tone="bg-clay-400/15 text-clay-500"
                icon="x-circle"
                trend={stats.series.map((s) => s.rejected)}
              />
            </div>
            <div className="mt-2">
              <Meter label="Мақұлдау пайызы" percent={stats.approvalRate} fillClassName="bg-forest-600" trackClassName="bg-forest-100" />
            </div>
          </>
        )}
      </div>

      {stats && stats.total > 0 && (
        <div className="rounded-2xl border border-forest-900/8 bg-paper-card p-4 shadow-soft sm:p-6">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-faint">Өтінім жолы</p>
          <p className="mb-4 text-[13px] text-ink-faint">Толтырудан шешімге дейінгі әр кезеңде қанша өтінім қалғанын көрсетеді.</p>
          <ApplicationFunnel statusCounts={stats.statusCounts} />
        </div>
      )}

      <div className="rounded-2xl border border-forest-900/8 bg-paper-card p-4 shadow-soft sm:p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Өтінімдер саны · {GRANULARITY_LABELS[granularity].toLowerCase()} бойынша
          </p>
          <div className="flex rounded-xl bg-forest-50 p-1">
            {(Object.keys(GRANULARITY_LABELS) as Granularity[]).map((g) => (
              <button
                key={g}
                onClick={() => setGranularity(g)}
                className={`rounded-lg px-3 py-3 text-xs font-bold outline-none transition focus-visible:ring-2 focus-visible:ring-forest-500/40 ${
                  granularity === g ? 'bg-forest-900 text-paper-soft' : 'text-ink-soft hover:text-ink'
                }`}
              >
                {GRANULARITY_LABELS[g]}
              </button>
            ))}
          </div>
        </div>

        {/* Same "hold the frame" rule as the Analytics tab's chart — only
            the very first load (no data yet) shows the skeleton. */}
        {!stats && loading ? (
          <div className="h-56 animate-pulse rounded-xl bg-forest-900/5" />
        ) : !stats || stats.series.length === 0 ? (
          <p className="py-12 text-center text-sm text-ink-faint">Бұл кезеңде деректер жоқ.</p>
        ) : (
          <div className={`transition-opacity duration-200 ${loading ? 'opacity-40' : 'opacity-100'}`}>
            <StatusStackedChart series={stats.series} granularity={granularity} />
          </div>
        )}
      </div>

      {stats && (
        <div className="rounded-2xl border border-forest-900/8 bg-paper-card p-4 shadow-soft sm:p-6">
          <p className="mb-4 text-xs font-semibold uppercase tracking-wide text-ink-faint">Санат бойынша</p>
          <ShareBar counts={stats.benefitTypeCounts} />
        </div>
      )}
    </div>
  );
}

// "Compare magnitude, low -> high" over an ORDERED sequence of stages
// (draft -> submitted -> decided) — anti-patterns.md calls out exactly this
// shape ("Ordered categories (funnel, tiers, age bands) -> the ordinal
// ramp"), so each stage steps one shade darker along the reference
// sequential-blue ramp instead of getting an unrelated categorical hue per
// bar. The final stage is where the story turns into an *outcome*, so
// that bar alone splits into the reserved status colors (approved/
// rejected) rather than continuing the ordinal ramp — status color only
// where something is actually being judged good/bad.
const FUNNEL_RAMP = ['#6da7ec', '#2a78d6', '#184f95'];

function ApplicationFunnel({ statusCounts }: { statusCounts: Record<ApplicationStatus, number> }) {
  const created = STATUS_ORDER.reduce((sum, s) => sum + statusCounts[s], 0);
  const submitted = statusCounts.pending_review + statusCounts.approved + statusCounts.rejected;
  const decided = statusCounts.approved + statusCounts.rejected;
  const stages = [
    { label: 'Толтырылды', value: created, color: FUNNEL_RAMP[0]! },
    { label: 'Жіберілді', value: submitted, color: FUNNEL_RAMP[1]! },
    { label: 'Шешім қабылданды', value: decided, color: FUNNEL_RAMP[2]! },
  ];
  const max = Math.max(created, 1);
  const approvedShare = decided > 0 ? (statusCounts.approved / decided) * 100 : 0;

  return (
    <div className="flex flex-col gap-3">
      {stages.map((s, i) => {
        // A nonzero stage that's a tiny fraction of the first one would
        // otherwise round to a width close to the bar's own corner radius
        // and read as a small blob rather than "a thin bar" — floor it at
        // a couple of visible percent so the shape still says "very few,
        // but not none". A genuinely empty stage stays truly 0.
        const widthPct = s.value === 0 ? 0 : Math.max((s.value / max) * 100, 2.5);
        const prevValue = i === 0 ? null : stages[i - 1]!.value;
        const conversionPct = prevValue && prevValue > 0 ? (s.value / prevValue) * 100 : null;
        const isLast = i === stages.length - 1;
        return (
          <div key={s.label}>
            {conversionPct !== null && (
              <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-ink-faint">
                <Icon name="arrow-right" className="h-3 w-3 rotate-90" />
                {conversionPct.toFixed(0)}% жалғасты
              </p>
            )}
            <div className="flex items-center gap-3">
              <span className="w-32 shrink-0 text-sm font-medium text-ink-soft sm:w-40">{s.label}</span>
              <div className="h-8 flex-1 overflow-hidden rounded-lg bg-forest-900/5">
                {isLast && decided > 0 ? (
                  <div className="flex h-full" style={{ width: `${widthPct}%` }}>
                    <div
                      className="h-full transition-all duration-700 ease-out"
                      style={{ width: `${approvedShare}%`, background: STATUS_CHART_COLORS.approved }}
                      title={`Мақұлданды: ${statusCounts.approved}`}
                    />
                    {statusCounts.rejected > 0 && (
                      <div
                        className="h-full transition-all duration-700 ease-out"
                        style={{ width: `${100 - approvedShare}%`, background: STATUS_CHART_COLORS.rejected }}
                        title={`Қабылданбады: ${statusCounts.rejected}`}
                      />
                    )}
                  </div>
                ) : (
                  <div
                    className="h-full rounded-lg transition-all duration-700 ease-out"
                    style={{ width: `${widthPct}%`, background: s.color }}
                  />
                )}
              </div>
              <span className="w-12 shrink-0 text-right text-sm font-semibold text-ink">{formatCount(s.value)}</span>
            </div>
          </div>
        );
      })}
      {decided > 0 && (
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 pl-[8.75rem] text-xs text-ink-faint sm:pl-[10.75rem]">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: STATUS_CHART_COLORS.approved }} aria-hidden />
            Мақұлданды: {statusCounts.approved}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: STATUS_CHART_COLORS.rejected }} aria-hidden />
            Қабылданбады: {statusCounts.rejected}
          </span>
        </div>
      )}
    </div>
  );
}

function StatusStackedChart({ series, granularity }: { series: AppStatsSeries[]; granularity: Granularity }) {
  const [hovered, setHovered] = useState<number | null>(null);

  const maxValue = Math.max(...series.map((p) => p.total), 1);
  const plotWidth = CHART_WIDTH - CHART_PAD_LEFT;
  const plotHeight = CHART_HEIGHT - CHART_PAD_TOP - CHART_PAD_BOTTOM;
  const barGap = 3;
  const barWidth = Math.min(48, Math.max(2, plotWidth / series.length - barGap));
  const rowWidth = series.length * (barWidth + barGap) - barGap;
  const rowOffset = Math.max(0, (plotWidth - rowWidth) / 2);
  const labelStride = Math.max(1, Math.ceil(series.length / 8));
  const gridLines = [0, 0.25, 0.5, 0.75, 1];
  // 2px surface gap between touching segments (marks-and-anatomy.md) —
  // the mechanism that separates them, never a stroke drawn around each.
  const segmentGap = 2;

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {STATUS_ORDER.map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-soft">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: STATUS_CHART_COLORS[s] }} aria-hidden />
            {STATUS_LABELS[s]}
          </span>
        ))}
      </div>
      <div className="relative">
        <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} className="w-full" style={{ height: 'auto' }}>
          {gridLines.map((f) => {
            const y = CHART_PAD_TOP + plotHeight * (1 - f);
            return (
              <g key={f}>
                <line
                  x1={CHART_PAD_LEFT}
                  x2={CHART_WIDTH}
                  y1={y}
                  y2={y}
                  stroke="currentColor"
                  className="text-forest-900/8"
                  strokeWidth={1}
                />
                <text x={0} y={y + 3} fontSize={9} className="fill-ink-faint">
                  {formatCount(Math.round(maxValue * f))}
                </text>
              </g>
            );
          })}

          {series.map((p, i) => {
            const x = CHART_PAD_LEFT + rowOffset + i * (barWidth + barGap);
            const showLabel = i % labelStride === 0;
            // Only the outermost (last-stacked) non-zero segment is the
            // bar's real "data-end" — that one gets the rounded top; the
            // rest stay square, per marks-and-anatomy.md's "4px rounded
            // data-end, square at the baseline" (here, at every internal
            // seam too, not just the true baseline).
            const topStatus = [...STATUS_ORDER].reverse().find((s) => p[s] > 0);
            let cursorY = CHART_PAD_TOP + plotHeight;
            const label = `${formatPeriodLabel(p.period, granularity)}, барлығы ${p.total}: ${STATUS_ORDER.filter((s) => p[s] > 0)
              .map((s) => `${STATUS_LABELS[s]} ${p[s]}`)
              .join(', ')}`;
            return (
              <g
                key={p.period}
                tabIndex={0}
                role="img"
                aria-label={label}
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered((h) => (h === i ? null : h))}
                onFocus={() => setHovered(i)}
                onBlur={() => setHovered((h) => (h === i ? null : h))}
                opacity={hovered === null || hovered === i ? 1 : 0.35}
                className="outline-none"
              >
                {/* Enlarges the keyboard focus ring / hit area beyond the
                    painted bar, matching the >=24px hit-target rule. */}
                <rect x={x - barGap / 2} y={CHART_PAD_TOP} width={barWidth + barGap} height={plotHeight} fill="transparent" className="focus-visible:fill-forest-900/5" />
                {STATUS_ORDER.map((s) => {
                  const value = p[s];
                  if (value <= 0) return null;
                  const rawHeight = maxValue > 0 ? (value / maxValue) * plotHeight : 0;
                  const segHeight = Math.max(rawHeight - segmentGap, 0.5);
                  cursorY -= rawHeight;
                  const segY = cursorY + segmentGap / 2;
                  return s === topStatus ? (
                    <path key={s} d={roundedTopRectPath(x, segY, barWidth, segHeight, 3)} fill={STATUS_CHART_COLORS[s]} />
                  ) : (
                    <rect key={s} x={x} y={segY} width={barWidth} height={segHeight} fill={STATUS_CHART_COLORS[s]} />
                  );
                })}
                {showLabel && (
                  <text x={x + barWidth / 2} y={CHART_HEIGHT - 6} fontSize={9} textAnchor="middle" className="fill-ink-faint">
                    {formatPeriodLabel(p.period, granularity)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>

        {hovered !== null && series[hovered] && (
          <div
            className="pointer-events-none absolute -top-2 -translate-x-1/2 -translate-y-full rounded-lg bg-forest-950 px-3 py-2 text-xs font-semibold text-paper-soft shadow-lifted"
            style={{
              left: `${clampPct(
                ((CHART_PAD_LEFT + rowOffset + hovered * (barWidth + barGap) + barWidth / 2) / CHART_WIDTH) * 100,
              )}%`,
            }}
          >
            <p className="mb-1">
              {formatPeriodLabel(series[hovered]!.period, granularity)} · {formatCount(series[hovered]!.total)}
            </p>
            {STATUS_ORDER.filter((s) => series[hovered]![s] > 0).map((s) => (
              <p key={s} className="flex items-center gap-1.5">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: STATUS_CHART_COLORS[s] }} aria-hidden />
                <span className="font-bold text-paper-soft">{formatCount(series[hovered]![s])}</span>
                <span className="text-paper-soft/60">{STATUS_LABELS[s]}</span>
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// A rect with only its top-left/top-right corners rounded — SVG <rect rx>
// rounds all four, which would round a stacked segment's bottom corners
// too (the seam against the segment below it, not a real data-end).
function roundedTopRectPath(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, Math.max(h, 0));
  return `M${x},${y + h} L${x},${y + rr} Q${x},${y} ${x + rr},${y} L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y + rr} L${x + w},${y + h} Z`;
}

// Keeps a percentage-positioned, center-anchored (-translate-x-1/2)
// tooltip from spilling past the chart's left/right edges near the
// first/last bar or point — clamping the anchor a little inside the edge
// is enough since the box stays centered on it either way.
function clampPct(pct: number, margin = 8): number {
  return Math.min(100 - margin, Math.max(margin, pct));
}

// Part-to-whole -> stacked bar (choosing-a-form.md; donut stays
// deprioritized per components.md's own system notes). One horizontal bar
// carries the share at a glance; the rows below keep the exact counts
// (and the mark-and-anatomy label rule — a value only goes inside a
// segment when it actually fits, otherwise it moves to the legend/tooltip).
function ShareBar({ counts }: { counts: Record<string, number> }) {
  const entries = (['many_children_family', 'incomplete_family', 'disability'] as const).map((key) => ({
    key,
    label: BENEFIT_LABELS[key],
    value: counts[key] ?? 0,
    color: BENEFIT_CHART_COLORS[key],
  }));
  const total = entries.reduce((sum, e) => sum + e.value, 0);
  const nonZero = entries.filter((e) => e.value > 0);

  if (total === 0) {
    return <p className="text-sm text-ink-faint">Деректер жоқ.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="flex h-8 w-full overflow-hidden rounded-lg bg-forest-900/5">
          {nonZero.map((e, i) => {
            const pct = (e.value / total) * 100;
            const showInlineLabel = pct >= 12;
            return (
              <div
                key={e.key}
                className={`flex h-full items-center justify-center transition-all duration-700 ease-out ${i > 0 ? 'ml-0.5' : ''}`}
                style={{ width: `${pct}%`, background: e.color }}
                title={`${e.label}: ${formatCount(e.value)} (${pct.toFixed(0)}%)`}
              >
                {/* Inline label only when it actually fits — otherwise it
                    stays out of the segment and lives in the legend below
                    (marks-and-anatomy.md: never clip, never force it in). */}
                {showInlineLabel && <span className="text-xs font-bold text-white">{pct.toFixed(0)}%</span>}
              </div>
            );
          })}
        </div>
        <p className="mt-1.5 text-[11px] text-ink-faint">
          Бір өтінімде бірнеше санат болуы мүмкін болғандықтан, үлес барлық таңдаулардың ішіндегі қатынасы.
        </p>
      </div>
      <div className="flex flex-col gap-2.5">
        {entries.map((e) => (
          <div key={e.key} className="flex items-center gap-3">
            <span className="inline-flex w-24 shrink-0 items-center gap-2 text-sm leading-tight text-ink-soft sm:w-36">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: e.color }} aria-hidden />
              {e.label}
            </span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-forest-900/5">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${total > 0 ? (e.value / total) * 100 : 0}%`, background: e.color }}
              />
            </div>
            <span className="w-10 shrink-0 text-right text-sm font-semibold text-ink">{formatCount(e.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ActionButton({ tone, onClick }: { tone: 'approve' | 'reject'; onClick: () => void }) {
  const config = {
    approve: { label: 'Мақұлдау', className: 'bg-forest-600 text-paper-soft hover:bg-forest-700' },
    reject: { label: 'Қабылдамау', className: 'bg-clay-400/15 text-clay-500 hover:bg-clay-400/25' },
  }[tone];

  return (
    <button
      onClick={onClick}
      className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${config.className}`}
    >
      {config.label}
    </button>
  );
}
