'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useRouter } from 'next/navigation';
import { validateField } from '@/lib/validation';
import Icon from '@/components/Icon';

type Draft = {
  fullName: string;
  email: string;
  whatsapp: string;
};

const EMPTY_DRAFT: Draft = {
  fullName: '',
  email: '',
  whatsapp: '',
};

const FIELD_LABELS: Record<keyof Draft, string> = {
  fullName: 'Аты-жөні',
  email: 'Email',
  whatsapp: 'WhatsApp',
};

const FIELD_INPUT_PROPS: Partial<Record<keyof Draft, React.InputHTMLAttributes<HTMLInputElement>>> = {
  email: { type: 'email', inputMode: 'email', placeholder: 'name@example.com' },
  whatsapp: { type: 'tel', inputMode: 'tel', placeholder: '+77000000000' },
};

export default function ScreenshotConnect() {
  const router = useRouter();
  const [step, setStep] = useState<'upload' | 'review' | 'final'>('upload');
  const [direction, setDirection] = useState<'forward' | 'back'>('forward');
  // Chromium gets a native two-sided crossfade+slide via the View
  // Transitions API (see goToStep) — the CSS entrance class below is only
  // needed as a fallback where that API doesn't exist (Firefox/Safari),
  // since the two would otherwise double up and look janky together.
  const vtSupported = typeof document !== 'undefined' && 'startViewTransition' in document;
  const stepAnimClass = vtSupported ? '' : direction === 'back' ? 'animate-step-in-back' : 'animate-step-in-forward';
  // Tracks the in-flight transition so a fast double-click / rapid step
  // change doesn't call startViewTransition while the previous one is
  // still animating — that throws an unhandled InvalidStateError.
  const activeTransitionRef = useRef<{ skipTransition: () => void } | null>(null);
  function goToStep(next: 'upload' | 'review' | 'final', dir: 'forward' | 'back') {
    document.documentElement.dataset.navDirection = dir;
    const startViewTransition = (
      document as {
        startViewTransition?: (cb: () => void) => {
          ready: Promise<void>;
          finished: Promise<void>;
          updateCallbackDone: Promise<void>;
          skipTransition: () => void;
        };
      }
    ).startViewTransition;
    if (startViewTransition) {
      activeTransitionRef.current?.skipTransition();
      const transition = startViewTransition.call(document, () => {
        flushSync(() => {
          setDirection(dir);
          setStep(next);
        });
      });
      activeTransitionRef.current = transition;
      // Skipping the previous transition rejects its `ready` (and
      // sometimes `updateCallbackDone`) promise — nobody else awaits
      // these, so an unhandled rejection would otherwise hit the console
      // on every rapid step change.
      transition.ready.catch(() => {});
      transition.updateCallbackDone.catch(() => {});
      transition.finished.catch(() => {}).finally(() => {
        if (activeTransitionRef.current === transition) activeTransitionRef.current = null;
      });
    } else {
      setDirection(dir);
      setStep(next);
    }
  }
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [touched, setTouched] = useState<Partial<Record<keyof Draft, boolean>>>({});
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fieldErrors = useMemo(() => {
    const errors: Partial<Record<keyof Draft, string>> = {};
    for (const key of Object.keys(FIELD_LABELS) as (keyof Draft)[]) {
      const msg = validateField(key, draft[key]);
      if (msg) errors[key] = msg;
    }
    return errors;
  }, [draft]);
  const isValid = Object.keys(fieldErrors).length === 0;

  const [dragOver, setDragOver] = useState(false);

  // Ctrl+V anywhere on the page (while still on the upload step) pastes a
  // screenshot straight from the clipboard — no save-to-file-then-browse
  // detour, which matters most on laptops (Win+Shift+S / Cmd+Ctrl+Shift+4
  // copy directly to clipboard).
  useEffect(() => {
    if (step !== 'upload') return;
    function onPaste(e: ClipboardEvent) {
      const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.type.startsWith('image/'));
      const file = item?.getAsFile();
      if (file) handleFile(file);
    }
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  async function handleFile(file: File) {
    setLoading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/connect/screenshot', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Қате шықты');
      setDraft({ ...EMPTY_DRAFT, ...data });
      goToStep('review', 'forward');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Қате шықты');
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirm() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/connect/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Қате шықты');
      router.push('/profile');
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Қате шықты');
    } finally {
      setLoading(false);
    }
  }

  if (step === 'final') {
    return (
      <div className={`card ${stepAnimClass}`} style={{ viewTransitionName: 'connect-step' } as React.CSSProperties}>
        <h2 className="mb-1 font-display text-lg font-medium text-forest-950">Соңғы рет тексеріңіз</h2>
        <p className="mb-5 text-[15px] leading-relaxed text-ink-soft">Деректер дұрыс екеніне көз жеткізіңіз.</p>

        <dl className="mb-4 flex flex-col divide-y divide-forest-900/8 rounded-xl bg-forest-50/70 px-4">
          {(Object.keys(FIELD_LABELS) as (keyof Draft)[]).map((key) => (
            <div key={key} className="flex items-center justify-between gap-3 py-2.5">
              <dt className="shrink-0 text-xs font-medium text-ink-faint">{FIELD_LABELS[key]}</dt>
              <dd className="truncate text-sm font-semibold text-ink">{draft[key]}</dd>
            </div>
          ))}
        </dl>

        <div className="mb-5 flex gap-2.5 rounded-xl bg-clay-400/10 px-3.5 py-3">
          <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0 text-clay-500" />
          <p className="text-xs font-medium leading-relaxed text-clay-500">
            Тек <strong>оқушының жеке аккаунты</strong> қабылданады — ата-ана аккаунты немесе қате дерек
            жеңілдіктің есептелмеуіне әкеледі.
          </p>
        </div>

        {error && (
          <p className="mb-4 rounded-xl bg-clay-400/10 px-4 py-3 text-sm font-medium text-clay-500">{error}</p>
        )}

        <div className="mobile-action-bar">
          <button className="btn-secondary" disabled={loading} onClick={() => goToStep('review', 'back')}>
            Артқа
          </button>
          <button className="btn-primary flex-1" disabled={loading} onClick={handleConfirm}>
            {loading ? 'Жіберілуде...' : 'Иә, дұрыс'}
          </button>
        </div>
      </div>
    );
  }

  if (step === 'upload') {
    return (
      <div
        className={`card ${direction === 'back' ? stepAnimClass : ''}`}
        style={{ viewTransitionName: 'connect-step' } as React.CSSProperties}
      >
        <p className="mb-5 text-[15px] leading-relaxed text-ink-soft">
          <a
            href="https://juz40-edu.kz/student/profile"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded bg-forest-50 px-1.5 py-0.5 font-mono text-[13px] text-forest-800 underline decoration-forest-300 decoration-2 underline-offset-2 hover:text-forest-900 hover:decoration-forest-600"
          >
            juz40-edu.kz/student/profile
          </a>{' '}
          бетінің скриншотын түсіріп, осында <strong className="text-ink">Ctrl+V</strong> арқылы
          қойыңыз немесе файлды таңдаңыз.
        </p>
        <label
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const file = e.dataTransfer.files?.[0];
            if (file) handleFile(file);
          }}
          className={`group relative flex cursor-pointer flex-col items-center gap-3 overflow-hidden rounded-2xl border-2 border-dashed p-10 text-center transition-colors ${
            dragOver ? 'border-forest-500 bg-forest-50' : 'border-forest-900/15 hover:border-forest-400 hover:bg-forest-50/50'
          }`}
        >
          {loading && (
            <div
              className="absolute inset-0 bg-[linear-gradient(110deg,transparent,rgba(11,110,133,0.22),transparent)] bg-[length:200%_100%]"
              style={{ animation: 'shimmer 1.6s linear infinite' }}
            />
          )}
          <div className="relative z-10 flex flex-col items-center gap-3">
            <div className="grid h-14 w-14 place-items-center rounded-full bg-forest-900 text-paper-soft transition-transform group-hover:scale-105">
              <Icon name={loading ? 'sparkle' : 'upload'} className={loading ? 'h-5 w-5' : 'h-6 w-6'} />
            </div>
            {loading ? (
              <p className="text-sm font-medium text-forest-800">Тексерілуде, күте тұрыңыз...</p>
            ) : (
              <>
                <p className="text-sm font-medium text-ink">
                  <span className="text-forest-700 underline decoration-2 underline-offset-2">
                    Файлды таңдаңыз
                  </span>{' '}
                  немесе осында тастаңыз
                </p>
                <p className="text-xs text-ink-faint">
                  немесе <strong>Ctrl+V</strong> — буферден тікелей
                </p>
              </>
            )}
          </div>
          <input
            type="file"
            accept=".jpg,.jpeg,.png"
            disabled={loading}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
            }}
            className="sr-only"
          />
        </label>
        {error && (
          <p className="mt-4 rounded-xl bg-clay-400/10 px-4 py-3 text-sm font-medium text-clay-500">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className={`card ${stepAnimClass}`} style={{ viewTransitionName: 'connect-step' } as React.CSSProperties}>
      <p className="mb-5 text-[15px] leading-relaxed text-ink-soft">
        Танылған деректерді тексеріп, қажет болса түзетіңіз.
      </p>
      <div className="flex flex-col gap-4">
        {(Object.keys(FIELD_LABELS) as (keyof Draft)[]).map((key) => {
          const showError = touched[key] && fieldErrors[key];
          return (
            <label key={key} className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink-faint">
                {FIELD_LABELS[key]}
              </span>
              <input
                value={draft[key]}
                onChange={(e) => {
                  const raw = e.target.value;
                  const value = key === 'whatsapp' ? raw.replace(/[\s\-()]/g, '') : raw;
                  setDraft({ ...draft, [key]: value });
                }}
                onBlur={() => setTouched((t) => ({ ...t, [key]: true }))}
                aria-invalid={Boolean(showError)}
                className={`w-full rounded-xl border bg-paper-soft px-4 py-3 text-[15px] text-ink outline-none transition focus:ring-2 ${
                  showError
                    ? 'border-clay-500 focus:border-clay-500 focus:ring-clay-500/20'
                    : 'border-forest-900/12 focus:border-forest-500 focus:ring-forest-500/20'
                }`}
                {...FIELD_INPUT_PROPS[key]}
              />
              {showError && <p className="mt-1.5 text-xs font-medium text-clay-500">{fieldErrors[key]}</p>}
            </label>
          );
        })}
      </div>

      <label className="mt-5 flex cursor-pointer items-start gap-3 text-sm text-ink-soft">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-forest-900/30 text-forest-700 focus:ring-forest-500/30"
        />
        <span>Мен енгізілген мәліметтердің дұрыстығын растаймын.</span>
      </label>

      {error && (
        <p className="mt-4 rounded-xl bg-clay-400/10 px-4 py-3 text-sm font-medium text-clay-500">
          {error}
        </p>
      )}

      <div className="mobile-action-bar">
        <button className="btn-secondary" onClick={() => goToStep('upload', 'back')}>
          Артқа
        </button>
        <button
          className="btn-primary flex-1"
          disabled={!confirmed || loading}
          onClick={() => {
            setTouched(Object.fromEntries(Object.keys(FIELD_LABELS).map((k) => [k, true])));
            if (isValid) goToStep('final', 'forward');
          }}
        >
          {loading ? 'Жіберілуде...' : 'Растау'}
        </button>
      </div>
    </div>
  );
}
