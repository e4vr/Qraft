import { Gift, PartyPopper, Sparkles, Trophy } from 'lucide-react';

export function CelebrationArtwork({
  kind,
}: {
  kind: 'goal' | 'redeemed' | 'admin-gift';
}) {
  const Icon =
    kind === 'goal' ? Trophy : kind === 'admin-gift' ? Gift : PartyPopper;
  const pieces = [
    ['12%', '18%', '#5ee0bd', '0ms'],
    ['24%', '64%', '#ffffff', '180ms'],
    ['38%', '12%', '#fbbf24', '340ms'],
    ['55%', '72%', '#67e8f9', '90ms'],
    ['69%', '19%', '#ffffff', '260ms'],
    ['82%', '58%', '#5ee0bd', '420ms'],
    ['91%', '27%', '#fbbf24', '140ms'],
  ] as const;
  return (
    <div className="relative grid min-h-48 place-items-center overflow-hidden bg-[radial-gradient(circle_at_50%_20%,rgba(94,224,189,0.34),transparent_42%),linear-gradient(135deg,#07233e,#0c4f60_58%,#228e85)] px-6 py-9 text-white">
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-70 [background-image:linear-gradient(rgba(255,255,255,.06)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.06)_1px,transparent_1px)] [background-size:28px_28px] [mask-image:linear-gradient(to_bottom,black,transparent)]"
      />
      {pieces.map(([left, top, color, delay], index) => (
        <span
          aria-hidden="true"
          className="q-celebration-confetti absolute h-2.5 w-1.5 rounded-full"
          key={`${left}:${top}`}
          style={{
            left,
            top,
            backgroundColor: color,
            animationDelay: delay,
            rotate: `${index * 23}deg`,
          }}
        />
      ))}
      <div className="relative flex flex-col items-center">
        <div className="grid size-20 place-items-center rounded-[1.75rem] border border-white/35 bg-white/15 shadow-[0_18px_55px_rgba(0,0,0,.28)] backdrop-blur-md">
          <Icon className="size-10" strokeWidth={1.8} />
        </div>
        <div className="mt-5 flex items-center gap-2 text-[11px] font-black tracking-[0.24em] text-emerald-100">
          <Sparkles className="size-3.5" /> CONGRATULATIONS{' '}
          <Sparkles className="size-3.5" />
        </div>
      </div>
    </div>
  );
}
