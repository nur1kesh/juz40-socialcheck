'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function ResubmitButton({ applicationId }: { applicationId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function resubmit() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/applications/${applicationId}/resubmit`, { method: 'POST' });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? 'Қате шықты. Қайта көріңіз.');
        setLoading(false);
        return;
      }
      router.push(`/apply?applicationId=${data.application.id}`);
    } catch {
      setError('Желі қатесі. Қайта көріңіз.');
      setLoading(false);
    }
  }

  return (
    <div>
      <button className="btn-primary w-full" disabled={loading} onClick={resubmit}>
        {loading ? 'Жіберілуде...' : 'Өтінімді қайта жіберу'}
      </button>
      {error && (
        <p className="mt-3 rounded-xl bg-clay-400/10 px-4 py-3 text-sm font-medium text-clay-500">{error}</p>
      )}
    </div>
  );
}
