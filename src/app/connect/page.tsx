import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser } from '@/lib/session';
import ScreenshotConnect from './ScreenshotConnect';
import ScreenshotExample from '@/components/ScreenshotExample';
import Icon from '@/components/Icon';

export default async function ConnectPage() {
  // Already-authenticated students landing here (back button, stale tab,
  // bookmark) should see their own profile, not the identity-confirmation
  // flow again — re-running it with a different email would silently
  // switch them to a different account (email is the upsert key).
  const user = await getCurrentUser();
  if (user) redirect('/profile');

  return (
    <main className="mx-auto min-h-dvh w-full max-w-xl px-5 py-10 sm:px-6 sm:py-14">
      <Link href="/" className="btn-ghost mb-6 inline-flex no-underline">
        <Icon name="arrow-left" className="h-4 w-4" /> Артқа
      </Link>

      <div className="stagger mb-8">
        <p className="eyebrow mb-2">Байланыс</p>
        <h1 className="font-display text-3xl font-medium text-forest-950 sm:text-4xl">
          JUZ40-ға қосылу
        </h1>
        <p className="mt-3 max-w-md text-[15px] leading-relaxed text-ink-soft">
          <a
            href="https://juz40-edu.kz/student/profile"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded bg-forest-50 px-1.5 py-0.5 font-mono text-[13px] text-forest-800 underline decoration-forest-300 decoration-2 underline-offset-2 hover:text-forest-900 hover:decoration-forest-600"
          >
            juz40-edu.kz/student/profile
          </a>{' '}
          бетін ашып, оған кіріңіз және сол беттің скриншотын түсіріңіз.
        </p>
      </div>

      <div className="animate-scale-in mb-6" style={{ animationDelay: '120ms' }}>
        <ScreenshotExample />
      </div>

      <div className="animate-scale-in" style={{ animationDelay: '200ms' }}>
        <ScreenshotConnect />
      </div>
    </main>
  );
}
