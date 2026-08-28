'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      setError(data.error ?? 'Қате шықты');
      return;
    }
    router.push('/admin');
  }

  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-forest-950 px-6">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-0 h-96 w-96 -translate-x-1/2 rounded-full bg-forest-700/30 blur-3xl" />
      </div>

      <div className="relative z-10 w-full max-w-sm">
        <div className="stagger mb-6 text-center">
          <p className="eyebrow mb-1 text-gold-300">SocialCheck</p>
          <h1 className="font-display text-2xl font-medium text-paper-soft">Admin кіру</h1>
        </div>

        <form
          onSubmit={handleSubmit}
          className="animate-scale-in flex flex-col gap-4 rounded-2xl border border-white/10 bg-forest-900/70 p-6 shadow-lifted backdrop-blur"
          style={{ animationDelay: '120ms' }}
        >
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-forest-300">
              Email
            </span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-[15px] text-paper-soft outline-none transition placeholder:text-forest-400 focus:border-gold-400/60 focus:ring-2 focus:ring-gold-400/20"
              required
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-forest-300">
              Құпия сөз
            </span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-[15px] text-paper-soft outline-none transition placeholder:text-forest-400 focus:border-gold-400/60 focus:ring-2 focus:ring-gold-400/20"
              required
            />
          </label>
          {error && (
            <p className="rounded-xl bg-clay-500/15 px-4 py-3 text-sm font-medium text-clay-400">
              {error}
            </p>
          )}
          <button
            className="inline-flex items-center justify-center rounded-full bg-gold-400 px-6 py-3.5 text-[15px] font-semibold text-forest-950 transition hover:bg-gold-300 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={loading}
          >
            {loading ? '...' : 'Кіру'}
          </button>
        </form>
      </div>
    </main>
  );
}
