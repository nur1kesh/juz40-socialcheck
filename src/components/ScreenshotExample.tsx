import Image from 'next/image';

export default function ScreenshotExample() {
  return (
    <div className="overflow-hidden rounded-2xl border border-forest-900/8 bg-paper-card shadow-soft">
      <div className="flex items-center gap-2 border-b border-forest-900/8 px-4 py-2.5">
        <span className="chip bg-forest-100 text-forest-700">Мысал</span>
        <p className="text-xs text-ink-faint">Профиль бөлімін осылай түсіріңіз</p>
      </div>
      <Image
        src="/example-screenshot.png"
        alt="JUZ40 профиль бетінің скриншот мысалы"
        width={2166}
        height={726}
        className="w-full"
      />
    </div>
  );
}
