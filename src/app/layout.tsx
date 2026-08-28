import type { Metadata, Viewport } from 'next';
import { Rubik, Golos_Text } from 'next/font/google';
import './globals.css';

// cyrillic-ext (not just cyrillic) is what actually covers Kazakh-specific
// letters (ә, ғ, қ, ң, ө, ұ, ү, һ, і) — without it they'd render as boxes
// or silently fall back to a generic system font. Rubik's rounded-corner
// geometric letterforms carry the youthful energy for headings while
// staying crisp on Kazakh diacritics; Golos Text is a Cyrillic-native
// grotesk built for exactly this kind of extended-Cyrillic body copy.
const rubik = Rubik({
  subsets: ['latin', 'cyrillic', 'cyrillic-ext'],
  variable: '--font-display',
  display: 'swap',
});

const golos = Golos_Text({
  subsets: ['latin', 'cyrillic', 'cyrillic-ext'],
  variable: '--font-body',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'JUZ40 SocialCheck',
  description: 'JUZ40 оқушыларына арналған әлеуметтік жеңілдік сервисі',
  icons: {
    icon: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"%3E%3Cdefs%3E%3ClinearGradient id="g" x1="0" y1="0" x2="1" y2="1"%3E%3Cstop offset="0" stop-color="%231D869B"/%3E%3Cstop offset="1" stop-color="%23074657"/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width="100" height="100" rx="24" fill="url(%23g)"/%3E%3Ctext x="50" y="68" font-size="58" font-family="system-ui" font-weight="800" fill="%23F5C766" text-anchor="middle"%3E%25%3C/text%3E%3C/svg%3E',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0b6e85',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="kk" className={`${rubik.variable} ${golos.variable}`}>
      <body>
        <div className="bg-mesh" aria-hidden="true">
          <span />
        </div>
        <div className="grain" aria-hidden="true" />
        <div className="min-h-dvh">{children}</div>
      </body>
    </html>
  );
}
