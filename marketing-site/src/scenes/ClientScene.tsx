import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useInView, useReducedMotion } from 'motion/react';
import { cn } from '@/lib/utils';
import { AppWindow, SampleNote, StatusPill } from './ui';

const others = [
  { n: 'Mara K', i: 'MK', s: 'Shortlisted' },
  { n: 'Jonas S', i: 'JS', s: 'Shortlisted' },
];

/** Swipe-speed discovery: drag the card right (or let it demo itself) to send an option. */
export function ClientScene() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { margin: '-15% 0px' });
  const reduce = useReducedMotion();
  const [sent, setSent] = useState(false);
  const [fly, setFly] = useState(false);
  const touched = useRef(false);

  // Auto-demo loop until the visitor interacts.
  useEffect(() => {
    if (!inView || reduce) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const run = () => {
      if (touched.current) return;
      timers.push(setTimeout(() => setFly(true), 1800));
      timers.push(setTimeout(() => { setFly(false); setSent(true); }, 2500));
      timers.push(setTimeout(() => setSent(false), 6200));
      timers.push(setTimeout(run, 6800));
    };
    run();
    return () => timers.forEach(clearTimeout);
  }, [inView, reduce]);

  const send = () => {
    setFly(true);
    setTimeout(() => { setFly(false); setSent(true); }, 450);
    setTimeout(() => setSent(false), 4000);
  };

  return (
    <div ref={ref} className="relative grid items-start gap-4 sm:grid-cols-[1.15fr_1fr]">
      <div className="relative">
        <motion.div
          drag="x"
          dragSnapToOrigin
          dragElastic={0.5}
          onDragStart={() => { touched.current = true; }}
          onDragEnd={(_, info) => { if (info.offset.x > 90) send(); }}
          animate={fly ? { x: 140, rotate: 7, opacity: 0.2 } : { x: 0, rotate: 0, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 260, damping: 26 }}
          className="relative cursor-grab touch-pan-y overflow-hidden rounded-2xl border border-border bg-card shadow-[0_32px_70px_-30px_rgba(17,17,17,0.35),0_2px_8px_rgba(17,17,17,0.06)] active:cursor-grabbing"
        >
          <div className="relative aspect-[4/5]">
            <img
              src="/images/editorial/suit.jpg"
              alt="Model portrait in a navy double-breasted suit against a stone wall"
              width={1100}
              height={1649}
              loading="lazy"
              decoding="async"
              draggable={false}
              className="size-full select-none object-cover object-[50%_20%]"
            />
            <motion.span
              animate={{ opacity: fly ? 1 : 0, scale: fly ? 1 : 0.9 }}
              className="label absolute left-4 top-4 -rotate-6 rounded-md border-2 border-white px-3 py-1 text-[12px] text-white"
            >
              Option
            </motion.span>
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-4 pb-3 pt-14 text-white">
              <p className="text-base font-semibold tracking-wide">RUBEN E</p>
              <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-white/80">187 cm · chest 103 · waist 70</p>
            </div>
          </div>
          <div className="flex gap-2 p-3">
            {['Next', 'Pass'].map((b) => (
              <span key={b} className="label flex-1 rounded-full border border-border py-2 text-center text-[9.5px]">{b}</span>
            ))}
            <button
              type="button"
              onClick={() => { touched.current = true; send(); }}
              className="label flex-1 cursor-pointer rounded-full border border-primary bg-primary py-2 text-center text-[9.5px] text-white transition-transform active:scale-95"
            >
              Option
            </button>
          </div>
        </motion.div>
      </div>

      <AppWindow right="Projects" className="sm:mt-10">
        <div className="px-4 pb-4 pt-3">
          <p className="text-sm font-semibold">Autumn campaign</p>
          <p className="text-[11px] text-muted-foreground">Client 3 · casting Nov 23</p>
          <ul className="mt-3 divide-y divide-border">
            {others.map((o) => (
              <li key={o.n} className="flex items-center gap-3 py-2.5">
                <span className="grid size-8 place-items-center rounded-full bg-secondary text-[10px] font-semibold text-muted-foreground">{o.i}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium">{o.n}</p>
                  <p className="text-[10.5px] text-muted-foreground">{o.s}</p>
                </div>
              </li>
            ))}
            <AnimatePresence initial={false}>
              {sent && (
                <motion.li
                  key="ruben"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                  className="overflow-hidden"
                >
                  <div className="flex items-center gap-3 py-2.5">
                    <span className="grid size-8 place-items-center rounded-full bg-primary text-[10px] font-semibold text-white">RE</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium">Ruben E</p>
                      <p className="text-[10.5px] text-muted-foreground">Agency in thread</p>
                    </div>
                    <StatusPill status="sent" className={cn('shrink-0')} />
                  </div>
                </motion.li>
              )}
            </AnimatePresence>
          </ul>
        </div>
      </AppWindow>
      <SampleNote className="sm:col-span-2 sm:text-right" />
    </div>
  );
}
