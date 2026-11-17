import { motion } from 'motion/react';
import { BlurFade } from '@/components/ui/blur-fade';
import { cn } from '@/lib/utils';
import { SampleNote, StatusPill, type Status } from './ui';
import { useCycle } from './useCycle';

const stages: Status[] = ['negotiation', 'approved', 'confirmed'];
const blockColor = ['bg-cal-orange', 'bg-cal-blue', 'bg-cal-green'];
const blockLabel = ['Option request', 'Model approved', 'Job confirmed'];

/** One booking, three surfaces: the status flips in the thread, the calendar and the card at once. */
export function HeroScene() {
  const s = useCycle(3, 2600);

  return (
    <div className="relative mx-auto aspect-[5/6] w-full max-w-[600px]" aria-hidden="true">
      {/* Discover card */}
      <BlurFade inView={false} delay={0.25} duration={0.9} blur="10px" offset={14} direction="up" className="absolute right-0 top-0 w-[70%]">
        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-[0_32px_70px_-28px_rgba(17,17,17,0.35),0_2px_8px_rgba(17,17,17,0.06)]">
          <div className="relative aspect-[4/5] bg-secondary">
            <img
              src="/images/editorial/coat.jpg"
              alt=""
              width={1100}
              height={1649}
              className="size-full object-cover object-[50%_28%]"
              fetchPriority="high"
              decoding="async"
            />
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-4 pb-3 pt-14 text-white">
              <p className="text-base font-semibold tracking-wide">RUBEN E</p>
              <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-white/80">
                187 cm · chest 103 · waist 70 · hips 78
              </p>
              <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-white/60">Innsbruck, AT</p>
            </div>
          </div>
          <div className="flex gap-2 p-3">
            {['Next', 'Pass', 'Option'].map((b) => (
              <span
                key={b}
                className={cn(
                  'label flex-1 rounded-full border py-2 text-center text-[9.5px] transition-colors duration-500',
                  b === 'Option' && s === 0 ? 'border-primary bg-primary text-white' : 'border-border text-foreground',
                )}
              >
                {b}
              </span>
            ))}
          </div>
        </div>
      </BlurFade>

      {/* Calendar slice */}
      <BlurFade delay={0.55} duration={0.9} blur="10px" offset={14} direction="up" className="absolute left-0 top-[6%] w-[44%]">
        <div className="rounded-xl border border-border bg-card p-3 shadow-[0_20px_44px_-22px_rgba(17,17,17,0.3)]">
          <div className="flex items-baseline justify-between">
            <span className="label text-[9px] text-muted-foreground">Mon</span>
            <span className="num text-lg font-semibold leading-none">23</span>
          </div>
          <div className="relative mt-3 h-[88px] border-t border-border">
            {[0, 1, 2].map((r) => (
              <div key={r} className="h-[29.3px] border-b border-border/70" />
            ))}
            <motion.div
              layout
              className={cn(
                'absolute inset-x-0.5 top-[29px] h-[29px] rounded-[5px] px-2 py-1 text-white transition-colors duration-500',
                blockColor[s],
              )}
            >
              <p className="num text-[9px] font-semibold leading-tight">09:00–10:00</p>
              <p className="truncate text-[9px] leading-tight text-white/90">{blockLabel[s]}</p>
            </motion.div>
          </div>
        </div>
      </BlurFade>

      {/* Option thread */}
      <BlurFade delay={0.85} duration={0.9} blur="10px" offset={14} direction="up" className="absolute bottom-[6%] left-[2%] w-[68%]">
        <div className="rounded-xl border border-border bg-card p-4 shadow-[0_24px_50px_-24px_rgba(17,17,17,0.32)]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">Ruben E</p>
              <p className="num mt-0.5 text-[11px] text-muted-foreground">2026-11-23 · 09:00–10:00 · Client 3</p>
            </div>
            <StatusPill status={stages[s]} />
          </div>
          <div className="mt-4 flex gap-1.5" role="presentation">
            {stages.map((_, i) => (
              <span
                key={i}
                className={cn('h-0.5 flex-1 rounded-full bg-border transition-colors duration-500', i <= s && 'bg-primary')}
              />
            ))}
          </div>
        </div>
      </BlurFade>

      <SampleNote className="absolute -bottom-1 right-0" />
    </div>
  );
}
