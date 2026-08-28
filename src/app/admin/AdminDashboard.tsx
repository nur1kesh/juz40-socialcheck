'use client';

import { Fragment, useMemo, useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { STATUS_LABELS, BENEFIT_LABELS } from '@/lib/statusLabels';
import { discountPercentFor } from '@/lib/discount';
import { todayAlmatyIso, formatAlmatyDateTime } from '@/lib/timezone';
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
  user: { fullName: string; email: string; whatsapp: string };
  documents: { id: string; originalFilename: string; nameMatchesProfile: boolean | null }[];
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

const EVENT_TYPE_LABELS: Record<string, string> = {
  submitted: 'Жіберілді',
  auto_decision: 'Автоматты шешім',
  admin_approve: 'Админ мақұлдады',
  admin_reject: 'Админ қабылдамады',
};

type PendingDecision = { ids: string[]; label: string; decision: 'approve' | 'reject' };

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
type Page = 'applications' | 'analytics';

export default function AdminDashboard() {
  const router = useRouter();
  const [page, setPage] = useState<Page>('applications');
  const [applications, setApplications] = useState<ApplicationRow[]>([]);
  // The whole point of this panel now: show what actually needs a human,
  // by default. Everything else resolves itself automatically.
  const [status, setStatus] = useState('pending_review');
  const [benefitType, setBenefitType] = useState('');
  const [email, setEmail] = useState('');
  const [date, setDate] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [listTotalCount, setListTotalCount] = useState(0);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [pendingDecision, setPendingDecision] = useState<PendingDecision | null>(null);
  const [decisionNote, setDecisionNote] = useState('');
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [deciding, setDeciding] = useState(false);
  const [exportDate, setExportDate] = useState(todayAlmatyIso());
  const [exportStatus, setExportStatus] = useState('');
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
      if (date) params.set('date', date);
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
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setDecisionError(data?.error ?? 'Қате шықты. Қайта көріңіз.');
        return;
      }
      if (data?.failed?.length > 0) {
        // Some rows in the batch succeeded and some didn't (e.g. another
        // admin already decided one) — surface it instead of pretending
        // the whole batch went through.
        setDecisionError(
          `${data.failed.length} өтінім өзгертілмеді (${data.failed[0]?.error ?? 'қате'}). ${data.succeeded} өтінім сәтті өзгертілді.`,
        );
        load();
        loadStats();
        return;
      }
      setPendingDecision(null);
      setDecisionNote('');
      load();
      loadStats();
    } catch {
      setDecisionError('Желі қатесі. Қайта көріңіз.');
    } finally {
      setDeciding(false);
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

  function exportUrl(format: 'xlsx' | 'json') {
    const [yyyy, mm, dd] = exportDate.split('-');
    const params = new URLSearchParams({ date: `${dd}.${mm}.${yyyy}`, format });
    if (exportStatus) params.set('status', exportStatus);
    return `/api/admin/export?${params.toString()}`;
  }

  const activeFilterCount = [benefitType, email, date].filter(Boolean).length;
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
      </div>

      {/* Stays mounted (just hidden) rather than conditionally rendered, so
          switching back to "Өтінімдер" and returning doesn't reset the
          chart's granularity/metric choice or force a refetch. */}
      <div className={page === 'analytics' ? undefined : 'hidden'}>
        <AnalyticsSection usage={usage} />
      </div>

      {page === 'applications' && (
        <>
      {/* Stats overview */}
      <div className="animate-scale-in mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatCard label="Барлығы" value={totalCount} tone="bg-forest-900/5 text-forest-900" />
        <StatCard
          label={STATUS_LABELS.pending_review}
          value={stats.pending_review ?? 0}
          tone="bg-gold-100 text-gold-600"
        />
        <StatCard label={STATUS_LABELS.approved} value={stats.approved ?? 0} tone="bg-forest-100 text-forest-700" />
        <StatCard label={STATUS_LABELS.rejected} value={stats.rejected ?? 0} tone="bg-clay-400/15 text-clay-500" />
      </div>

      {/* Export: pick a date, then download */}
      <div className="animate-scale-in mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-forest-900/8 bg-paper-card p-4 shadow-soft">
        <span className="text-sm font-semibold text-ink-soft">Экспорт күні:</span>
        <input
          type="date"
          value={exportDate}
          onChange={(e) => setExportDate(e.target.value)}
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
          Excel
        </a>
        <a className="btn-secondary" href={exportUrl('json')}>
          JSON
        </a>
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
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={selectClass} />
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
              onClick={() =>
                setPendingDecision({ ids: [...selected], label: `${selected.size} өтінім`, decision: 'approve' })
              }
            >
              Барлығын мақұлдау
            </button>
            <button
              className="rounded-full bg-clay-400/15 px-4 py-2 text-sm font-semibold text-clay-500 transition hover:bg-clay-400/25"
              onClick={() =>
                setPendingDecision({ ids: [...selected], label: `${selected.size} өтінім`, decision: 'reject' })
              }
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
                <p className="mb-1 text-sm text-ink">
                  {a.benefitTypes.map((t) => BENEFIT_LABELS[t]).join(', ') || '—'}
                </p>
                <p className="mb-3 text-xs text-ink-faint">
                  {a.status === 'rejected' ? 'Жеңілдік берілмеді' : `${discountPercentFor(a.benefitTypes)}% жеңілдік`}
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
                    <ActionButton
                      tone="approve"
                      onClick={() => setPendingDecision({ ids: [a.id], label: a.user.fullName, decision: 'approve' })}
                    />
                    <ActionButton
                      tone="reject"
                      onClick={() => setPendingDecision({ ids: [a.id], label: a.user.fullName, decision: 'reject' })}
                    />
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
                      </td>
                      <td className="max-w-[160px] px-2 py-3">
                        {a.documents.length === 0 ? (
                          <span className="text-ink-faint">—</span>
                        ) : (
                          <div className="flex flex-col gap-0.5">
                            {a.documents.map((d) => (
                              <a
                                key={d.id}
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
                              onClick={() =>
                                setPendingDecision({ ids: [a.id], label: a.user.fullName, decision: 'approve' })
                              }
                            />
                            <ActionButton
                              tone="reject"
                              onClick={() =>
                                setPendingDecision({ ids: [a.id], label: a.user.fullName, decision: 'reject' })
                              }
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
          onClick={() => !deciding && (setPendingDecision(null), setDecisionNote(''), setDecisionError(null))}
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
                disabled={deciding}
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

function StatCard({ label, value, tone }: { label: string; value: number | string; tone: string }) {
  return (
    <div className={`rounded-2xl px-4 py-3.5 shadow-soft ${tone}`}>
      <p className="font-display text-2xl font-semibold">{value}</p>
      <p className="text-xs font-semibold opacity-80">{label}</p>
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
  const [seriesLoading, setSeriesLoading] = useState(false);

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
          <StatCard label="Барлық шығын" value={formatUsd(usage.totals.costUsd)} tone="bg-forest-900/5 text-forest-900" />
          <StatCard label="Соңғы 30 күн" value={formatUsd(usage.last30Days.costUsd)} tone="bg-forest-100 text-forest-700" />
          <StatCard label="Барлық шақыру" value={formatCount(usage.totals.calls)} tone="bg-gold-100 text-gold-600" />
          <StatCard
            label="Өтінімге орташа"
            value={usage.avgCostPerApplication !== null ? formatUsd(usage.avgCostPerApplication) : '—'}
            tone="bg-paper-card text-ink border border-forest-900/8"
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

        {seriesLoading ? (
          <div className="h-56 animate-pulse rounded-xl bg-forest-900/5" />
        ) : series.length === 0 ? (
          <p className="py-12 text-center text-sm text-ink-faint">Бұл кезеңде деректер жоқ.</p>
        ) : (
          <TimeseriesChart series={series} metric={metric} granularity={granularity} />
        )}
      </div>

      {usage && (
        <div className="grid gap-4 rounded-2xl border border-forest-900/8 bg-paper-card p-4 shadow-soft sm:grid-cols-2 sm:p-6">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">Модель бойынша</p>
            <ul className="flex flex-col gap-1.5">
              {usage.byModel.map((m) => (
                <li key={m.model} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate text-ink">{m.model}</span>
                  <span className="shrink-0 text-ink-faint">
                    {formatCount(m.calls)} · {formatUsd(m.costUsd)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">Түрі бойынша</p>
            <ul className="flex flex-col gap-1.5">
              {usage.byKind.map((k) => (
                <li key={k.kind} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate text-ink">{KIND_LABELS[k.kind] ?? k.kind}</span>
                  <span className="shrink-0 text-ink-faint">
                    {formatCount(k.calls)} · {formatUsd(k.costUsd)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

const CHART_WIDTH = 800;
const CHART_HEIGHT = 220;
const CHART_PAD_LEFT = 44;
const CHART_PAD_BOTTOM = 24;
const CHART_PAD_TOP = 12;

function TimeseriesChart({
  series,
  metric,
  granularity,
}: {
  series: TimeseriesPoint[];
  metric: Metric;
  granularity: Granularity;
}) {
  const [hovered, setHovered] = useState<number | null>(null);

  const values = series.map((p) => (metric === 'costUsd' ? p.costUsd : metric === 'totalTokens' ? p.totalTokens : p.calls));
  const maxValue = Math.max(...values, 1);

  const plotWidth = CHART_WIDTH - CHART_PAD_LEFT;
  const plotHeight = CHART_HEIGHT - CHART_PAD_TOP - CHART_PAD_BOTTOM;
  const barGap = 3;
  // Capped so a handful of bars (e.g. one month of "month" granularity)
  // don't stretch into one giant block spanning the whole plot — the
  // leftover space is then centered rather than left bar-hugging the axis.
  const barWidth = Math.min(48, Math.max(2, plotWidth / series.length - barGap));
  const rowWidth = series.length * (barWidth + barGap) - barGap;
  const rowOffset = Math.max(0, (plotWidth - rowWidth) / 2);

  // Avoid label collisions when there are many bars — show at most ~8 x-axis labels.
  const labelStride = Math.max(1, Math.ceil(series.length / 8));

  const gridLines = [0, 0.25, 0.5, 0.75, 1];

  return (
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
                {formatAxisValue(maxValue * f, metric)}
              </text>
            </g>
          );
        })}

        {series.map((p, i) => {
          const value = values[i]!;
          const barHeight = maxValue > 0 ? (value / maxValue) * plotHeight : 0;
          const x = CHART_PAD_LEFT + rowOffset + i * (barWidth + barGap);
          const y = CHART_PAD_TOP + plotHeight - barHeight;
          const showLabel = i % labelStride === 0;
          return (
            <g key={p.period}>
              <rect
                x={x}
                y={y}
                width={barWidth}
                height={Math.max(barHeight, 1)}
                rx={Math.min(4, barWidth / 2)}
                className={hovered === i ? 'fill-forest-700' : 'fill-forest-500'}
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered((h) => (h === i ? null : h))}
              >
                <title>
                  {formatPeriodLabel(p.period, granularity)}: {formatAxisValue(value, metric)}
                </title>
              </rect>
              {showLabel && (
                <text
                  x={x + barWidth / 2}
                  y={CHART_HEIGHT - 6}
                  fontSize={9}
                  textAnchor="middle"
                  className="fill-ink-faint"
                >
                  {formatPeriodLabel(p.period, granularity)}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {hovered !== null && series[hovered] && (
        <div className="pointer-events-none absolute -top-2 left-1/2 -translate-x-1/2 -translate-y-full rounded-lg bg-forest-950 px-3 py-2 text-xs font-semibold text-paper-soft shadow-lifted">
          <p>{formatPeriodLabel(series[hovered]!.period, granularity)}</p>
          <p className="text-paper-soft/80">
            {formatUsd(series[hovered]!.costUsd)} · {formatCount(series[hovered]!.totalTokens)} токен ·{' '}
            {formatCount(series[hovered]!.calls)} шақыру
          </p>
        </div>
      )}
    </div>
  );
}

function formatAxisValue(value: number, metric: Metric): string {
  if (metric === 'costUsd') return `$${value.toFixed(value < 1 ? 3 : 1)}`;
  return formatCount(Math.round(value));
}

function ActionButton({ tone, onClick }: { tone: 'approve' | 'reject'; onClick: () => void }) {
  const config = {
    approve: { label: 'Approve', className: 'bg-forest-600 text-paper-soft hover:bg-forest-700' },
    reject: { label: 'Reject', className: 'bg-clay-400/15 text-clay-500 hover:bg-clay-400/25' },
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
