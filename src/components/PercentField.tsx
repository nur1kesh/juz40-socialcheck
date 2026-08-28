// Colors as raw RGB triplets (not Tailwind classes) — the color/opacity
// combo here is built from array lookups, and Tailwind's JIT scanner can't
// resolve dynamically-constructed arbitrary-value classes like
// `text-forest-500/[0.06]`, so about half of them silently failed to
// generate and fell back to the page's solid default text color. Inline
// rgba() sidesteps that entirely.
const TONES = [
  [11, 110, 133], // forest-500
  [232, 172, 46], // gold-400
  [63, 176, 155], // lime-500
];
const OPACITIES = [0.06, 0.08, 0.1, 0.12, 0.14];
const SIZES = ['text-xl', 'text-2xl', 'text-3xl', 'text-4xl', 'text-5xl', 'text-6xl', 'text-7xl'];

// Positions avoid a "safe zone" roughly behind the hero heading
// (top 0–22%, left 12–78%) so the glyphs don't visually clash with
// "Әлеуметтік жеңілдік."
const POSITIONS = [
  { top: '2%', left: '4%' },
  { top: '3%', left: '90%' },
  { top: '8%', left: '92%' },
  { top: '10%', left: '2%' },
  { top: '18%', left: '6%' },
  { top: '20%', left: '88%' },
  { top: '26%', left: '60%' },
  { top: '24%', left: '22%' },
  { top: '30%', left: '38%' },
  { top: '34%', left: '92%' },
  { top: '38%', left: '4%' },
  { top: '42%', left: '48%' },
  { top: '44%', left: '74%' },
  { top: '46%', left: '10%' },
  { top: '50%', left: '28%' },
  { top: '54%', left: '58%' },
  { top: '56%', left: '88%' },
  { top: '58%', left: '80%' },
  { top: '62%', left: '18%' },
  { top: '64%', left: '36%' },
  { top: '68%', left: '4%' },
  { top: '70%', left: '52%' },
  { top: '74%', left: '94%' },
  { top: '76%', left: '66%' },
  { top: '80%', left: '86%' },
  { top: '82%', left: '10%' },
  { top: '86%', left: '8%' },
  { top: '88%', left: '42%' },
  { top: '90%', left: '30%' },
  { top: '94%', left: '54%' },
  { top: '96%', left: '20%' },
];

const GLYPHS = POSITIONS.map((pos, i) => {
  const [r, g, b] = TONES[i % TONES.length]!;
  return {
    ...pos,
    size: SIZES[i % SIZES.length]!,
    rotate: ((i * 37) % 40) - 20,
    duration: `${8 + (i % 6)}.${(i * 3) % 10}s`,
    delay: `${((i * 0.4) % 4).toFixed(1)}s`,
    color: `rgba(${r}, ${g}, ${b}, ${OPACITIES[i % OPACITIES.length]})`,
  };
});

export default function PercentField() {
  return (
    <>
      {GLYPHS.map((g, i) => (
        <div
          key={i}
          className="animate-drift absolute"
          style={{ top: g.top, left: g.left, animationDuration: g.duration, animationDelay: g.delay }}
        >
          <span
            className={`block font-display font-extrabold ${g.size}`}
            style={{ transform: `rotate(${g.rotate}deg)`, color: g.color }}
          >
            %
          </span>
        </div>
      ))}
    </>
  );
}
