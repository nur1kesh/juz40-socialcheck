'use client';

import { useEffect, useRef, useState } from 'react';

export default function RevealOnScroll({
  children,
  delay = 0,
  className = '',
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Safety net: never leave content permanently invisible if the
    // observer doesn't fire (e.g. element already past the viewport on
    // mount, or an environment where IntersectionObserver misbehaves).
    // Declared before the observer so its callback can clear it too —
    // otherwise it stays pending and fires a redundant setVisible(true)
    // at 2s even on the normal path where the observer fired first.
    const fallback = setTimeout(() => setVisible(true), 2000);
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true);
          clearTimeout(fallback);
          io.disconnect();
        }
      },
      { threshold: 0.15, rootMargin: '0px 0px -80px 0px' },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      clearTimeout(fallback);
    };
  }, []);

  return (
    <div
      ref={ref}
      className={`transition-all duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] ${
        visible ? 'translate-y-0 opacity-100' : 'translate-y-8 opacity-0'
      } ${className}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}
