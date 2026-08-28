import Tilt3D from './Tilt3D';
import Icon from './Icon';

export default function BenefitCard({
  icon,
  title,
  description,
}: {
  icon: Parameters<typeof Icon>[0]['name'];
  title: string;
  description: string;
}) {
  return (
    <Tilt3D max={8}>
      <div className="card-select relative overflow-hidden rounded-[1.75rem] border border-forest-900/8 bg-paper-card p-6 shadow-soft transition-shadow duration-300 group-hover:shadow-lifted">
        <div
          className="mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-forest-50 text-forest-700 shadow-soft transition-transform duration-300 [transform:translateZ(24px)] group-hover:scale-110"
          style={{ transformStyle: 'preserve-3d' }}
        >
          <Icon name={icon} className="h-6 w-6" />
        </div>
        <h3 className="mb-1.5 font-display text-lg font-medium text-forest-950 [transform:translateZ(12px)]">
          {title}
        </h3>
        <p className="text-sm leading-relaxed text-ink-soft">{description}</p>
      </div>
    </Tilt3D>
  );
}
