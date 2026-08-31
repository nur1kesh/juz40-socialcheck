'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '@/components/Icon';

export default function ReportActivationIssueButton({
  applicationId,
  initiallyDisputed,
}: {
  applicationId: string;
  initiallyDisputed: boolean;
}) {
  const [disputed, setDisputed] = useState(initiallyDisputed);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (disputed) {
    return (
      <p className="mt-2 text-xs font-medium text-ink-faint">
        Хабарламаңыз қабылданды — менеджер тексеруде үстінде, күтіңіз.
      </p>
    );
  }

  async function report() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/applications/${applicationId}/report-activation-issue`, { method: 'POST' });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? 'Қате шықты');
      setConfirmOpen(false);
      setDisputed(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Қате шықты');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-2">
      <button
        className="text-xs font-medium text-ink-faint underline decoration-ink-faint/40 underline-offset-2 hover:text-clay-500"
        onClick={() => {
          setError(null);
          setConfirmOpen(true);
        }}
      >
        Менің жеңілдігім енгізілмеді, менеджерге қайта тексеріске жіберу
      </button>
      {error && !confirmOpen && <p className="mt-1 text-xs font-medium text-clay-500">{error}</p>}

      {/* Portaled to <body> — this button lives inside a `.card
          animate-scale-in` ancestor, and that animation's `both` fill-mode
          leaves a `transform` on the card forever (even at rest, scale(1)
          still counts). A transformed ancestor becomes the containing
          block for any `position: fixed` descendant, which would otherwise
          shrink this overlay down to the card's own box instead of the
          full screen. Escaping to `document.body` sidesteps that. */}
      {confirmOpen &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-gradient-to-b from-forest-950/75 via-forest-900/60 to-forest-950/75 p-4"
            onClick={() => !loading && setConfirmOpen(false)}
          >
            <div
              className="animate-scale-in w-full max-w-sm rounded-xl2 bg-paper-card p-7 text-center shadow-lifted"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-clay-400/15 text-clay-500 shadow-soft">
                <Icon name="alert" className="h-6 w-6" />
              </div>
              <h2 className="mb-2 font-display text-lg font-medium text-forest-950">
                Жеңілдігіңіз енгізілмеді ме?
              </h2>
              <p className="mb-6 text-sm leading-relaxed text-ink-soft">
                Растасаңыз, хабарлама менеджерге жіберіледі де, қайтадан тексереді.
              </p>
              {error && (
                <p className="mb-4 rounded-xl bg-clay-400/10 px-3.5 py-2.5 text-xs font-medium text-clay-500">
                  {error}
                </p>
              )}
              <div className="flex gap-3">
                <button className="btn-secondary flex-1" disabled={loading} onClick={() => setConfirmOpen(false)}>
                  Жоқ
                </button>
                <button
                  className="flex-1 rounded-full bg-clay-500 px-6 py-3 text-sm font-semibold text-paper-soft transition hover:bg-clay-500/90 disabled:opacity-50"
                  disabled={loading}
                  onClick={report}
                >
                  {loading ? 'Жіберілуде...' : 'Иә, растаймын'}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
