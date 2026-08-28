'use client';

import Link from 'next/link';
import { useState } from 'react';
import Icon from './Icon';
import { discountPercentFor } from '@/lib/discount';
import type { BenefitType } from '@prisma/client';

const OPTIONS: { key: BenefitType; icon: Parameters<typeof Icon>[0]['name']; label: string }[] = [
  { key: 'many_children_family', icon: 'family', label: 'Көпбалалы отбасы' },
  { key: 'incomplete_family', icon: 'single-parent', label: 'Толық емес отбасы' },
  { key: 'disability', icon: 'accessibility', label: 'Мүгедектік жағдайы' },
];

export default function DiscountCalculator() {
  const [selected, setSelected] = useState<Set<BenefitType>>(new Set());
  // Reuses the same rule the real application flow decides discounts
  // with (src/lib/discount.ts) instead of a hand-duplicated 10/15 —
  // this display can't silently drift from the actual business logic.
  const percent = selected.size === 0 ? 0 : discountPercentFor(Array.from(selected));

  function toggle(key: BenefitType) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className="relative overflow-hidden rounded-[1.75rem] border border-forest-900/8 bg-paper-card p-6 shadow-soft sm:p-8">
      <div
        className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-gold-300/20 blur-3xl transition-opacity duration-500"
        style={{ opacity: percent > 0 ? 1 : 0 }}
        aria-hidden
      />

      <p className="eyebrow mb-1 text-center">Жеңілдікті есептеп көріңіз</p>
      <h2 className="mb-6 text-center font-display text-xl font-medium text-forest-950 sm:text-2xl">
        Санатыңызды таңдаңыз
      </h2>

      <div className="mb-8 flex flex-col gap-2.5 sm:flex-row sm:justify-center">
        {OPTIONS.map((o) => {
          const active = selected.has(o.key);
          return (
            <button
              key={o.key}
              type="button"
              onClick={() => toggle(o.key)}
              aria-pressed={active}
              className={`flex items-center gap-2.5 rounded-2xl border-2 px-4 py-3 text-left text-sm font-semibold outline-none transition-all duration-200 focus-visible:ring-2 focus-visible:ring-forest-500/40 sm:flex-col sm:text-center ${
                active
                  ? 'border-forest-500 bg-forest-50 text-forest-900 shadow-glow'
                  : 'border-forest-900/10 bg-paper text-ink-soft hover:border-forest-300 hover:bg-forest-50/40'
              }`}
            >
              <Icon
                name={o.icon}
                className={`h-6 w-6 shrink-0 transition-transform duration-300 ${active ? 'scale-110' : ''}`}
              />
              {o.label}
            </button>
          );
        })}
      </div>

      <div className="relative flex flex-col items-center gap-1 py-2">
        <div className="relative font-display text-5xl font-extrabold text-forest-900 sm:text-6xl">
          <span
            key={percent}
            className="animate-pop-in inline-block bg-gradient-to-r from-forest-600 to-gold-500 bg-clip-text text-transparent"
          >
            {percent}%
          </span>
        </div>
        <p className="text-xs font-medium text-ink-faint">
          {selected.size === 0
            ? 'Жоғарыдан кемінде бір санатты таңдаңыз'
            : selected.size === 1
              ? 'Бір санат — 10% жеңілдік'
              : 'Екі және одан көп санат — 15% жеңілдік'}
        </p>
      </div>

      <div
        className={`overflow-hidden transition-all duration-500 ${
          percent > 0 ? 'mt-6 max-h-20 opacity-100' : 'max-h-0 opacity-0'
        }`}
      >
        <Link href="/connect" className="btn-primary w-full">
          Осы жеңілдікке өтінім беру
          <Icon name="arrow-right" className="h-4 w-4" />
        </Link>
      </div>
    </div>
  );
}
