import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser } from '@/lib/session';
import ScreenshotExample from '@/components/ScreenshotExample';
import RevealOnScroll from '@/components/RevealOnScroll';
import BenefitCard from '@/components/BenefitCard';
import DiscountCalculator from '@/components/DiscountCalculator';
import Tilt3D from '@/components/Tilt3D';
import PercentField from '@/components/PercentField';
import Icon from '@/components/Icon';

const BENEFITS = [
  {
    icon: 'family' as const,
    title: 'Көпбалалы отбасы',
    description: 'SOC-ID немесе жәрдемақы алушысы картасын жүктеп, жеңілдікке ие болыңыз.',
  },
  {
    icon: 'single-parent' as const,
    title: 'Толық емес отбасы',
    description: 'Тиісті мәртебені растайтын құжат арқылы жеңілдікке өтінім беріңіз.',
  },
  {
    icon: 'accessibility' as const,
    title: 'Мүгедектік жағдайы',
    description: 'Мүгедектікті растайтын құжатты жүктеп, жеңілдікті рәсімдеңіз.',
  },
];

const STEPS = [
  {
    n: '01',
    title: 'JUZ40 профиліне кіріңіз',
    description: 'juz40-edu.kz/student/profile бетін ашып, аккаунтыңызбен кіріңіз.',
  },
  {
    n: '02',
    title: 'Скриншот пен құжатты жүктеңіз',
    description: 'Профиль бетінің скриншотын және жағдайыңызды растайтын құжатты жүктеңіз.',
  },
  {
    n: '03',
    title: 'Тексеру және жеңілдік',
    description: 'Құжаттар тексеріліп, 24 сағат ішінде аккаунтыңызға жеңілдік беріледі.',
  },
];

export default async function HomePage() {
  const user = await getCurrentUser();
  if (user) redirect('/profile');

  return (
    <main className="relative flex min-h-dvh flex-col overflow-hidden">
      {/* Decorative backdrop — aria-hidden on the wrapper so the 31
          PercentField glyphs and everything else here (purely visual)
          don't get announced as content by screen readers, matching the
          .bg-mesh/.grain layers in layout.tsx. */}
      <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden="true">
        <div className="animate-float absolute -left-24 -top-24 h-72 w-72 rounded-full bg-forest-300/40 blur-3xl sm:h-96 sm:w-96" />
        <div
          className="animate-float absolute -right-16 top-1/3 h-64 w-64 rounded-full bg-gold-300/35 blur-3xl"
          style={{ animationDelay: '1.2s' }}
        />
        <div
          className="animate-float absolute bottom-0 left-1/3 h-56 w-56 rounded-full bg-lime-400/25 blur-3xl"
          style={{ animationDelay: '2.4s' }}
        />
        <div
          className="animate-spin-slow absolute right-[8%] top-[12%] h-24 w-24 rounded-full border border-dashed border-forest-500/15 sm:h-36 sm:w-36"
        />
        <svg
          className="absolute inset-x-0 top-0 h-full w-full opacity-[0.08]"
          viewBox="0 0 400 800"
          preserveAspectRatio="xMidYMin slice"
        >
          <path d="M0 120 Q 200 60 400 140" stroke="#074657" strokeWidth="1.5" fill="none" />
          <path d="M0 220 Q 200 160 400 240" stroke="#074657" strokeWidth="1.5" fill="none" />
        </svg>
        <PercentField />
      </div>

      {/* Hero */}
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-8 px-6 pb-10 pt-16 sm:py-24">
        <div className="stagger flex flex-col items-center gap-4 text-center">
          <div className="flex items-center gap-2 rounded-full border border-forest-900/10 bg-paper-card px-4 py-1.5 shadow-soft">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-gold-400" />
            <span className="eyebrow">JUZ40 үшін</span>
          </div>

          <h1 className="font-display text-4xl font-extrabold leading-[1.05] text-forest-950 sm:text-5xl">
            Әлеуметтік
            <br />
            <span className="animate-gradient-x bg-[length:200%_auto] bg-gradient-to-r from-forest-600 via-gold-500 to-forest-500 bg-clip-text text-transparent">
              жеңілдік
            </span>
            <span className="text-gold-500">.</span>
          </h1>

          <p className="max-w-xs text-[15px] leading-relaxed text-ink-soft">
            Оқушыларға арналған жеңілдік сервисі — қарапайым, тез және сенімді.
          </p>
        </div>

        <div className="relative animate-scale-in" style={{ animationDelay: '260ms' }}>
          <Tilt3D max={4} glare={false}>
            <div className="card flex flex-col gap-5">
              <div>
                <h2 className="mb-2 font-display text-lg font-medium text-forest-950">
                  Алдымен JUZ40 платформасына кіріңіз
                </h2>
                <p className="text-sm leading-relaxed text-ink-soft">
                  <a
                    href="https://juz40-edu.kz/student/profile"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold text-forest-700 underline decoration-forest-300 decoration-2 underline-offset-2 hover:text-forest-900 hover:decoration-forest-600"
                  >
                    juz40-edu.kz/student/profile
                  </a>{' '}
                  бетін ашып, оған кіріңіз де, сол беттің скриншотын SocialCheck-ке жүктеңіз.
                </p>
              </div>

              <div className="flex flex-col gap-3">
                <a
                  className="btn-primary w-full"
                  href="https://juz40-edu.kz/student/profile"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  JUZ40 платформасына кіру
                  <Icon name="arrow-up-right" className="h-4 w-4" />
                </a>
                <Link href="/connect" className="btn-secondary w-full">
                  Скриншотты жүктеу
                </Link>
              </div>
            </div>
          </Tilt3D>

          {/* Floating 3D badge — nested so the float keyframes (translateY)
              and the static rotation don't fight over the transform property */}
          <div
            className="animate-float pointer-events-none absolute -right-3 -top-5 sm:-right-6"
            style={{ animationDelay: '0.6s' }}
            aria-hidden
          >
            <div className="rotate-[8deg] rounded-2xl bg-forest-900 px-3.5 py-2 shadow-lifted">
              <p className="flex items-center gap-1 font-display text-lg font-extrabold leading-none text-gold-300">
                <Icon name="zap" className="h-4 w-4" />5 мин
              </p>
              <p className="text-[9px] font-semibold uppercase tracking-wide text-paper-soft/70">өтінім беру</p>
            </div>
          </div>
        </div>
      </div>

      {/* Interactive discount calculator */}
      <RevealOnScroll className="mx-auto w-full max-w-lg px-6 pb-16">
        <Tilt3D max={3} glare={false}>
          <DiscountCalculator />
        </Tilt3D>
      </RevealOnScroll>

      {/* Benefit categories */}
      <section className="mx-auto w-full max-w-4xl px-6 pb-16">
        <RevealOnScroll className="mb-8 text-center">
          <p className="eyebrow mb-2">Кімге арналған</p>
          <h2 className="font-display text-2xl font-medium text-forest-950 sm:text-3xl">
            3 санат бойынша жеңілдік
          </h2>
        </RevealOnScroll>
        <div className="grid gap-4 sm:grid-cols-3">
          {BENEFITS.map((b, i) => (
            <RevealOnScroll key={b.title} delay={i * 100}>
              <BenefitCard {...b} />
            </RevealOnScroll>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto w-full max-w-2xl px-6 pb-20">
        <RevealOnScroll className="mb-10 text-center">
          <p className="eyebrow mb-2">Қалай жұмыс істейді</p>
          <h2 className="font-display text-2xl font-medium text-forest-950 sm:text-3xl">
            3 қадам, 5 минут
          </h2>
        </RevealOnScroll>
        <div className="relative flex flex-col gap-8">
          <div
            className="absolute bottom-4 left-6 top-4 w-px bg-gradient-to-b from-forest-300 via-forest-200 to-transparent"
            aria-hidden
          />
          {STEPS.map((s, i) => (
            <RevealOnScroll key={s.n} delay={i * 120} className="relative flex items-start gap-5">
              <span className="relative grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-forest-900 font-display text-sm font-bold text-gold-200 shadow-soft">
                {s.n}
              </span>
              <div className="pt-1.5">
                <h3 className="mb-1 font-display text-base font-medium text-forest-950">{s.title}</h3>
                <p className="text-sm leading-relaxed text-ink-soft">{s.description}</p>
              </div>
            </RevealOnScroll>
          ))}
        </div>
      </section>

      {/* Screenshot proof */}
      <section className="mx-auto w-full max-w-md px-6 pb-24">
        <RevealOnScroll>
          <p className="eyebrow mb-3 text-center">Мысал</p>
          <ScreenshotExample />
        </RevealOnScroll>
      </section>
    </main>
  );
}
