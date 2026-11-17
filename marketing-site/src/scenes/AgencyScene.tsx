import { useRef } from 'react';
import { motion, useInView } from 'motion/react';
import { AnimatedList } from '@/components/ui/animated-list';
import { cn } from '@/lib/utils';
import { AppWindow, SampleNote, StatusPill, type Status } from './ui';
import { useCycle } from './useCycle';

const days = [
  ['Mon', 16], ['Tue', 17], ['Wed', 18], ['Thu', 19], ['Fri', 20], ['Sat', 21], ['Sun', 22],
] as const;
const START = 8;
const ROW = 34;
const hours = [8, 9, 10, 11, 12, 13, 14, 15];

type Block = { day: number; from: number; to: number; label: string; tone: string; live?: boolean };
const blocks: Block[] = [
  { day: 1, from: 9, to: 10, label: 'Client casting', tone: 'bg-cal-green' },
  { day: 3, from: 9, to: 10, label: 'Client casting', tone: 'bg-cal-green' },
  { day: 3, from: 13, to: 15, label: 'Job', tone: 'bg-cal-blue' },
  { day: 5, from: 11, to: 13, label: 'Model casting', tone: 'bg-cal-blue' },
  { day: 0, from: 11, to: 12, label: '', tone: '', live: true },
];

const threads: { name: string; meta: string; status: Status }[] = [
  { name: 'Mara K', meta: '2026-11-19 · 09:00–10:00 · Client 3', status: 'confirmed' },
  { name: 'Jonas S', meta: '2026-11-20 · 15:00–17:00 · Client 1', status: 'action' },
  { name: 'Ruben E', meta: '2026-11-23 · 09:00–10:00 · Client 3', status: 'negotiation' },
  { name: 'Lea W', meta: '2026-11-24 · 10:00–12:00 · Client 2', status: 'approved' },
];

export function AgencyScene() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-12% 0px' });
  const s = useCycle(3, 2600, inView);
  const optionTone = ['bg-cal-orange', 'bg-cal-blue', 'bg-cal-green'][s];
  const optionLabel = ['Option request', 'Model approved', 'Confirmed'][s];

  return (
    <div ref={ref} className="relative" aria-hidden="true">
      <AppWindow right="Nov 16 – Nov 22, 2026">
        <div className="grid grid-cols-[34px_repeat(7,1fr)] text-[10px]">
          <div />
          {days.map(([d, n]) => (
            <div key={d} className="border-l border-border py-2 text-center">
              <p className="label text-[8px] text-muted-foreground">{d}</p>
              <p className="num text-sm font-semibold">{n}</p>
            </div>
          ))}
          <div>
            {hours.map((h) => (
              <div key={h} className="num flex items-start justify-end pr-1.5 pt-0.5 text-[8px] text-muted-foreground" style={{ height: ROW }}>
                {String(h).padStart(2, '0')}:00
              </div>
            ))}
          </div>
          {days.map(([d], di) => (
            <div key={d} className="relative border-l border-t border-border" style={{ height: hours.length * ROW }}>
              {hours.map((h) => (
                <div key={h} className="border-b border-border/60" style={{ height: ROW }} />
              ))}
              {blocks
                .filter((b) => b.day === di)
                .map((b, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, scaleY: 0.4 }}
                    animate={inView ? { opacity: 1, scaleY: 1 } : undefined}
                    transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1], delay: 0.15 + di * 0.08 }}
                    style={{ top: (b.from - START) * ROW + 1, height: (b.to - b.from) * ROW - 2, transformOrigin: 'top' }}
                    className={cn('absolute inset-x-0.5 rounded-[4px] px-1 py-0.5 text-white transition-colors duration-500', b.live ? optionTone : b.tone)}
                  >
                    <p className="num text-[8px] font-semibold leading-tight">
                      {String(b.from).padStart(2, '0')}:00
                    </p>
                    <p className="truncate text-[8px] leading-tight text-white/90">{b.live ? optionLabel : b.label}</p>
                  </motion.div>
                ))}
            </div>
          ))}
        </div>
      </AppWindow>

      <div className="relative z-10 -mt-6 ml-[8%] w-[92%] sm:ml-[14%] sm:w-[86%]">
        <AppWindow right="Option requests">
          <div className="min-h-[196px] divide-y divide-border">
            {inView && (
              <AnimatedList delay={650} className="gap-0">
                {threads.map((t) => (
                  <div key={t.name} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-semibold">{t.name}</p>
                      <p className="num truncate text-[10.5px] text-muted-foreground">{t.meta}</p>
                    </div>
                    <StatusPill status={t.name === 'Ruben E' ? (['negotiation', 'approved', 'confirmed'] as Status[])[s] : t.status} className="shrink-0" />
                  </div>
                ))}
              </AnimatedList>
            )}
          </div>
        </AppWindow>
      </div>
      <SampleNote className="mt-3 text-right" />
    </div>
  );
}
