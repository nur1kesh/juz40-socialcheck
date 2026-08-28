'use client';

import { useRef } from 'react';

export default function Tilt3D({
  children,
  className = '',
  max = 10,
  glare = true,
}: {
  children: React.ReactNode;
  className?: string;
  max?: number;
  glare?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  function onMove(e: React.MouseEvent<HTMLDivElement>) {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;
    const py = (e.clientY - r.top) / r.height;
    el.style.setProperty('--rx', `${(py - 0.5) * -2 * max}deg`);
    el.style.setProperty('--ry', `${(px - 0.5) * 2 * max}deg`);
    el.style.setProperty('--mx', `${px * 100}%`);
    el.style.setProperty('--my', `${py * 100}%`);
  }

  function onLeave() {
    const el = ref.current;
    if (!el) return;
    el.style.setProperty('--rx', '0deg');
    el.style.setProperty('--ry', '0deg');
  }

  return (
    <div style={{ perspective: '1200px' }} className={className}>
      <div
        ref={ref}
        onMouseMove={onMove}
        onMouseLeave={onLeave}
        className="group relative rounded-[1.75rem] transition-transform duration-200 ease-out will-change-transform [transform:rotateX(var(--rx,0deg))_rotateY(var(--ry,0deg))] [transform-style:preserve-3d]"
      >
        {children}
        {glare && (
          <div
            // rounded-[inherit] here inherits from THIS wrapper (the
            // rounded-[1.75rem] above), not from `children` — the glare is
            // a sibling of the card, not nested inside it, so it needs its
            // own matching radius or its corners render square and poke
            // out past the card's rounded corners on hover.
            className="pointer-events-none absolute inset-0 rounded-[inherit] opacity-0 transition-opacity duration-300 group-hover:opacity-100"
            style={{
              background:
                'radial-gradient(260px circle at var(--mx, 50%) var(--my, 50%), rgba(255,255,255,0.4), transparent 60%)',
            }}
            aria-hidden
          />
        )}
      </div>
    </div>
  );
}
