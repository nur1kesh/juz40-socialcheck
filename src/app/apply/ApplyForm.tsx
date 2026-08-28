'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { BENEFIT_LABELS } from '@/lib/statusLabels';
import { discountPercentFor } from '@/lib/discount';
import { formatAlmatyDate, isPastAlmatyDay } from '@/lib/timezone';
import Icon from '@/components/Icon';

type BenefitType = 'many_children_family' | 'incomplete_family' | 'disability';

type OcrResult = {
  isReadable: boolean;
  extractedFullName: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  documentTypeGuess: string | null;
  confidence: number;
  matchesExpectedCategory: boolean | null;
  expiryStatus: 'valid' | 'expired' | 'unknown';
};

type UploadedDoc = {
  documentId: string;
  fileName: string;
  ocr: OcrResult;
};

const BENEFIT_OPTIONS: { type: BenefitType; description: string; icon: Parameters<typeof Icon>[0]['name'] }[] = [
  {
    type: 'many_children_family',
    description: 'SOC-ID немесе «Көпбалалы отбасы жәрдемақысы алушысы» картасын жүктеңіз (eGov Mobile, Kaspi).',
    icon: 'family',
  },
  {
    type: 'incomplete_family',
    description: 'Ажырасуды немесе қайтыс болған ата-ананы растайтын құжатты жүктеңіз.',
    icon: 'home',
  },
  {
    type: 'disability',
    description: 'Мүгедектікті растайтын құжатты жүктеңіз.',
    icon: 'accessibility',
  },
];

const STEP_LABELS = ['Жеңілдік', 'Құжаттар', 'Растау'];

export default function ApplyForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const existingApplicationId = searchParams.get('applicationId');
  const [step, setStep] = useState(1);
  const [benefitTypes, setBenefitTypes] = useState<BenefitType[]>([]);
  const [applicationId, setApplicationId] = useState<string | null>(existingApplicationId);
  const [docs, setDocs] = useState<Partial<Record<string, UploadedDoc>>>({});
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [creatingApp, setCreatingApp] = useState(false);

  // Resuming a draft (either a continued fill-in or a resubmission): pre-fill
  // what the student already picked/uploaded instead of making them start
  // over from a blank step 1 and re-upload documents that are already saved.
  useEffect(() => {
    if (!existingApplicationId) return;
    fetch('/api/applications')
      .then((res) => res.json())
      .then((data) => {
        const match = data.applications?.find((a: { id: string }) => a.id === existingApplicationId);
        if (!match) return;
        setBenefitTypes(match.benefitTypes);
        const restoredDocs: Partial<Record<string, UploadedDoc>> = {};
        for (const d of match.documents ?? []) {
          const expiryStatus: OcrResult['expiryStatus'] = !d.documentExpiryDate
            ? 'unknown'
            : isPastAlmatyDay(new Date(d.documentExpiryDate))
              ? 'expired'
              : 'valid';
          restoredDocs[d.documentType] = {
            documentId: d.id,
            fileName: d.originalFilename,
            ocr: {
              isReadable: d.ocrStatus !== 'needs_manual_review',
              extractedFullName: d.ocrExtractedName,
              issueDate: d.documentIssueDate,
              expiryDate: d.documentExpiryDate,
              documentTypeGuess: null,
              confidence: d.ocrStatus === 'needs_manual_review' ? 0 : 1,
              matchesExpectedCategory:
                d.verificationStatus === 'verified' ? true : d.verificationStatus === 'rejected' ? false : null,
              expiryStatus,
            },
          };
        }
        setDocs(restoredDocs);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // If an application already exists (fresh creation, or resuming a
  // resubmission draft) and the student then changes their benefit/SMART
  // PRO choice, the server-side record would no longer match what's shown
  // on screen — the documents step would ask for the new selection while
  // /submit still validates against the old one. Clearing applicationId
  // here forces goToDocuments to create a fresh, matching draft instead.
  function invalidateApplication() {
    if (applicationId) {
      setApplicationId(null);
      setDocs({});
    }
  }

  function toggleBenefit(type: BenefitType) {
    invalidateApplication();
    setBenefitTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type],
    );
  }

  async function goToDocuments() {
    setError(null);
    if (applicationId) {
      setStep(2);
      return;
    }
    setCreatingApp(true);
    try {
      const res = await fetch('/api/applications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ benefitTypes }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Қате шықты');
      setApplicationId(data.application.id);
      setStep(2);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Қате шықты');
    } finally {
      setCreatingApp(false);
    }
  }

  async function handleUpload(documentType: string, file: File) {
    if (!applicationId) return;
    setError(null);
    const formData = new FormData();
    formData.append('applicationId', applicationId);
    formData.append('documentType', documentType);
    formData.append('file', file);
    const res = await fetch('/api/documents', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? 'Құжатты жүктеу қажет.');
      return;
    }
    setDocs((prev) => ({
      ...prev,
      [documentType]: { documentId: data.document.id, fileName: file.name, ocr: data.ocr },
    }));
  }

  async function handleRemove(documentType: string) {
    const doc = docs[documentType];
    if (!doc) return;
    const res = await fetch(`/api/documents/${doc.documentId}`, { method: 'DELETE' }).catch(() => null);
    if (!res || !res.ok) {
      setError('Құжатты жою мүмкін болмады. Қайта көріңіз.');
      return;
    }
    setDocs((prev) => {
      const next = { ...prev };
      delete next[documentType];
      return next;
    });
  }

  const allDocsReady = benefitTypes.every((t) => docs[t]);

  async function handleSubmit() {
    if (!applicationId || !allDocsReady || !confirmed) return;
    setSubmitting(true);
    setError(null);
    try {
      const submitRes = await fetch(`/api/applications/${applicationId}/submit`, { method: 'POST' });
      const submitData = await submitRes.json();
      if (!submitRes.ok) throw new Error(submitData.error ?? 'Қате шықты');
      router.push(`/applications/${applicationId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Қате шықты');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto min-h-dvh w-full max-w-2xl px-5 pb-6 pt-8 sm:px-6 sm:pt-14">
      <StepProgress step={step} />

      <div className="stagger mb-6">
        <p className="eyebrow mb-1">Жаңа өтінім</p>
        <h1 className="font-display text-2xl font-medium text-forest-950 sm:text-3xl">
          Әлеуметтік жеңілдік
        </h1>
      </div>

      {step === 1 && (
        <div key="s1" className="animate-fade-up flex flex-col gap-3">
          <p className="mb-1 text-sm text-ink-soft">
            Бірнеше жеңілдік түрін таңдауға болады: 1 жеңілдік — 10%, 2 және одан көп — 15%.
          </p>
          {BENEFIT_OPTIONS.map((opt) => {
            const checked = benefitTypes.includes(opt.type);
            return (
              <button
                key={opt.type}
                onClick={() => toggleBenefit(opt.type)}
                data-checked={checked}
                aria-pressed={checked}
                className="card card-select flex items-start gap-4 text-left"
              >
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-forest-50 text-forest-700">
                  <Icon name={opt.icon} className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="mb-0.5 font-semibold text-ink">{BENEFIT_LABELS[opt.type]}</div>
                  <div className="text-sm text-ink-soft">{opt.description}</div>
                </div>
                <span
                  className={`mt-1 grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 text-[11px] text-paper-soft transition-colors ${
                    checked ? 'border-forest-700 bg-forest-700' : 'border-forest-900/20 bg-transparent'
                  }`}
                >
                  {checked && <Icon name="check" className="h-3 w-3" />}
                </span>
              </button>
            );
          })}

          {benefitTypes.length > 0 && (
            <div className="mt-1 flex items-center gap-2 rounded-xl bg-gold-100/60 px-4 py-3 text-sm font-medium text-gold-600">
              <span className="font-display text-lg">{discountPercentFor(benefitTypes)}%</span>
              <span>жеңілдік — {benefitTypes.length} жеңілдік түрі таңдалды</span>
            </div>
          )}

          {error && <ErrorNote text={error} />}

          <div className="mobile-action-bar">
            <button
              className="btn-primary w-full"
              disabled={benefitTypes.length === 0 || creatingApp}
              onClick={goToDocuments}
            >
              {creatingApp ? 'Жүктелуде...' : 'Жалғастыру'}
            </button>
          </div>
        </div>
      )}

      {step === 2 && applicationId && (
        <div key="s2" className="animate-fade-up flex flex-col gap-6">
          {benefitTypes.map((type) => (
            <div key={type} className="flex flex-col gap-2">
              <DocumentUploader
                label={
                  type === 'many_children_family'
                    ? 'SOC-ID немесе жәрдемақы алушысы картасы (Көпбалалы отбасылар)'
                    : `${BENEFIT_LABELS[type]} — растайтын құжат`
                }
                doc={docs[type] ?? null}
                onUpload={(file) => handleUpload(type, file)}
                onRemove={() => handleRemove(type)}
                mismatchHint={
                  type === 'many_children_family'
                    ? 'Тек SOC-ID немесе «Көпбалалы отбасы жәрдемақысы алушысы» картасы қабылданады. eGov Mobile немесе Kaspi қосымшасынан жүктеп алып, соны салыңыз.'
                    : undefined
                }
              />
              {type === 'many_children_family' && (
                <a
                  href="https://youtube.com/shorts/fgsrgIByolQ?si=mdkjRkKhiCyjku1Z"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 self-start text-sm font-semibold text-forest-700 underline decoration-2 underline-offset-2 hover:text-forest-900"
                >
                  <Icon name="play" className="h-3.5 w-3.5" /> SOC-ID қалай алуға болады — видео нұсқаулық
                </a>
              )}
            </div>
          ))}

          {docs.many_children_family?.ocr.expiryStatus === 'expired' && (
            <div className="animate-scale-in rounded-2xl border-2 border-gold-400/70 bg-gold-100/60 p-4 shadow-glow-gold">
              <div className="mb-3 flex items-start gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gold-300/70 text-gold-700">
                  <Icon name="hourglass" className="h-5 w-5" />
                </span>
                <div>
                  <p className="mb-1 text-sm font-bold text-forest-950">
                    Мерзімі аяқталса да — өтінім беруге болады!
                  </p>
                  <p className="text-sm leading-relaxed text-ink-soft">
                    Отбасында 18 жасқа толған, оқуын жалғастырып жатқан бала болса, оқу орнынан
                    анықтаманы төменде қосымша жүктеңіз — өтінім солай да қабылданады.
                  </p>
                </div>
              </div>
              <DocumentUploader
                label="Оқу орнынан анықтама"
                doc={docs.student_certificate ?? null}
                onUpload={(file) => handleUpload('student_certificate', file)}
                onRemove={() => handleRemove('student_certificate')}
              />
            </div>
          )}

          {error && <ErrorNote text={error} />}

          <div className="mobile-action-bar">
            <button className="btn-secondary" onClick={() => setStep(1)}>
              Артқа
            </button>
            <button className="btn-primary flex-1" disabled={!allDocsReady} onClick={() => setStep(3)}>
              Жалғастыру
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div key="s3" className="animate-fade-up flex flex-col gap-4">
          <div className="card">
            <h2 className="eyebrow mb-2">Әлеуметтік мәртебе</h2>
            <p className="font-medium text-ink">{benefitTypes.map((t) => BENEFIT_LABELS[t]).join(', ')}</p>
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-gold-100/70 px-3 py-1 text-sm font-semibold text-gold-600">
              {discountPercentFor(benefitTypes)}% жеңілдік
            </p>
          </div>
          <div className="card">
            <h2 className="eyebrow mb-2">Құжаттар</h2>
            <ul className="flex flex-col gap-1.5">
              {benefitTypes.map((t) => (
                <li key={t} className="flex items-center gap-2 text-sm text-ink">
                  <Icon name="check" className="h-3.5 w-3.5 text-forest-600" /> {docs[t]?.fileName}
                </li>
              ))}
              {docs.student_certificate && (
                <li className="flex items-center gap-2 text-sm text-ink">
                  <Icon name="check" className="h-3.5 w-3.5 text-forest-600" /> {docs.student_certificate.fileName}
                </li>
              )}
            </ul>
          </div>
          <label className="flex cursor-pointer items-start gap-3 rounded-xl px-1 py-2 text-sm text-ink-soft">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-forest-900/30 text-forest-700 focus:ring-forest-500/30"
            />
            <span>Мен енгізілген мәліметтердің дұрыстығын растаймын.</span>
          </label>

          {error && <ErrorNote text={error} />}

          <div className="mobile-action-bar">
            <button className="btn-secondary" onClick={() => setStep(2)}>
              Артқа
            </button>
            <button
              className="btn-primary flex-1"
              disabled={!confirmed || submitting}
              onClick={handleSubmit}
            >
              {submitting ? 'Жіберілуде...' : 'Өтінімді жіберу'}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

function StepProgress({ step }: { step: number }) {
  return (
    <div className="mb-8">
      <div className="mb-2 flex gap-1.5">
        {STEP_LABELS.map((_, i) => (
          <div key={i} className="h-1.5 flex-1 overflow-hidden rounded-full bg-forest-900/10">
            <div
              className="h-full rounded-full bg-forest-700 transition-all duration-500 ease-out"
              style={{ width: i < step - 1 ? '100%' : i === step - 1 ? '50%' : '0%' }}
            />
          </div>
        ))}
      </div>
      <p className="text-xs font-medium text-ink-faint">
        {step}/{STEP_LABELS.length} · {STEP_LABELS[step - 1]}
      </p>
    </div>
  );
}

function ErrorNote({ text }: { text: string }) {
  return (
    <p className="rounded-xl bg-clay-400/10 px-4 py-3 text-sm font-medium text-clay-500">{text}</p>
  );
}

function DocumentUploader({
  label,
  doc,
  onUpload,
  onRemove,
  mismatchHint,
}: {
  label: string;
  doc: UploadedDoc | null;
  onUpload: (f: File) => void | Promise<void>;
  onRemove: () => void | Promise<void>;
  mismatchHint?: string;
}) {
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);

  async function pick(file: File) {
    if (uploading) return;
    setUploading(true);
    try {
      await onUpload(file);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div>
      <label className="mb-2 block text-sm font-semibold text-ink">{label}</label>
      {!doc ? (
        <label
          onDragOver={(e) => {
            e.preventDefault();
            if (!uploading) setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            if (uploading) return;
            const f = e.dataTransfer.files?.[0];
            if (f) pick(f);
          }}
          className={`relative flex cursor-pointer flex-col items-center gap-2 overflow-hidden rounded-2xl border-2 border-dashed p-6 text-center transition-colors ${
            dragOver ? 'border-forest-500 bg-forest-50' : 'border-forest-900/15 hover:border-forest-400 hover:bg-forest-50/50'
          }`}
        >
          {uploading && (
            <div
              className="absolute inset-0 bg-[linear-gradient(110deg,transparent,rgba(11,110,133,0.22),transparent)] bg-[length:200%_100%]"
              style={{ animation: 'shimmer 1.6s linear infinite' }}
            />
          )}
          <div className="relative z-10 flex flex-col items-center gap-2">
            {uploading ? (
              <p className="text-sm font-medium text-forest-800">Тексерілуде...</p>
            ) : (
              <>
                <p className="text-sm text-ink">
                  <span className="font-semibold text-forest-700 underline decoration-2 underline-offset-2">
                    Файл таңдаңыз
                  </span>{' '}
                  немесе осында тастаңыз
                </p>
                <p className="text-xs text-ink-faint">PDF, JPG, PNG — 10 MB дейін</p>
              </>
            )}
          </div>
          <input
            type="file"
            accept=".pdf,.jpg,.jpeg,.png"
            disabled={uploading}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) pick(f);
            }}
            className="sr-only"
          />
        </label>
      ) : (
        <div className="card animate-scale-in">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="truncate font-medium text-ink">{doc.fileName}</p>
            <button
              className="-m-2 shrink-0 rounded-lg p-2 text-sm font-semibold text-clay-500 hover:underline"
              onClick={onRemove}
            >
              Жою
            </button>
          </div>

          <div className="mb-3 flex flex-wrap gap-1.5">
            <Badge
              ok={doc.ocr.expiryStatus === 'valid'}
              unknown={doc.ocr.expiryStatus === 'unknown'}
              label={
                doc.ocr.expiryStatus === 'valid'
                  ? 'Мерзімі жарамды'
                  : doc.ocr.expiryStatus === 'expired'
                    ? 'Мерзімі аяқталған'
                    : 'Мерзімі белгісіз'
              }
            />
            {doc.ocr.matchesExpectedCategory !== null && (
              <Badge
                ok={doc.ocr.matchesExpectedCategory}
                unknown={false}
                label={doc.ocr.matchesExpectedCategory ? 'Түрі сәйкес келеді' : 'Түрі сәйкес емес'}
              />
            )}
            <Badge
              ok={doc.ocr.isReadable}
              unknown={false}
              label={doc.ocr.isReadable ? 'Оқылады' : 'Оқылмайды'}
            />
          </div>

          {doc.ocr.matchesExpectedCategory === false && mismatchHint && (
            <p className="mb-3 rounded-xl bg-clay-400/10 px-3.5 py-3 text-xs leading-relaxed text-clay-500">
              {mismatchHint}
            </p>
          )}

          {(doc.ocr.documentTypeGuess || doc.ocr.extractedFullName || doc.ocr.expiryDate) && (
            <div className="rounded-xl bg-forest-50/70 px-3.5 py-3 text-xs leading-relaxed text-forest-800">
              <p className="mb-1 flex items-center gap-1.5 font-semibold text-forest-700">
                <Icon name="sparkle" className="h-3 w-3" /> Анықталды
              </p>
              {doc.ocr.documentTypeGuess && <p>{doc.ocr.documentTypeGuess}</p>}
              {doc.ocr.extractedFullName && <p>Аты-жөні: {doc.ocr.extractedFullName}</p>}
              {doc.ocr.expiryDate && (
                <p>Жарамдылық мерзімі: {formatDate(doc.ocr.expiryDate)}</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    return formatAlmatyDate(new Date(iso));
  } catch {
    return iso;
  }
}

function Badge({ ok, unknown, label }: { ok: boolean; unknown: boolean; label: string }) {
  const color = unknown
    ? 'bg-forest-100 text-forest-700'
    : ok
      ? 'bg-forest-600 text-paper-soft'
      : 'bg-clay-400/15 text-clay-500';
  return <span className={`chip ${color}`}>{label}</span>;
}
