import { useRef } from 'react';
import { motion, useReducedMotion, useScroll, useTransform, type MotionValue } from 'motion/react';
import { Heading } from '@/components/Heading';
import { BlurFade } from '@/components/ui/blur-fade';

const surfaces = [
  ['Inboxes', 'noise eats the decision'],
  ['Sheets', 'versions never meet'],
  ['PDF packs', 'frozen the moment they are sent'],
  ['Parallel chats', 'no spine at handoff'],
  ['Ad-hoc diaries', 'option and job, blurred'],
] as const;

function Row({ label, note, p, from, to, reduce }: { label: string; note: string; p: MotionValue<number>; from: number; to: number; reduce: boolean }) {
  const w = useTransform(p, [from, to], ['0%', '100%']);
  const c = useTransform(p, [from, to], ['#111111', '#a9a79f']);
  return (
    <li className="flex items-baseline justify-between gap-6 border-t border-line py-5 md:py-7">
      <motion.span style={reduce ? undefined : { color: c }} className="relative display text-[clamp(2rem,6vw,4.5rem)]">
        {label}
        <motion.span
          aria-hidden="true"
          style={{ width: reduce ? '100%' : w }}
          className="absolute left-0 top-[55%] h-[3px] bg-primary"
        />
      </motion.span>
      <span className="hidden max-w-[22ch] text-right text-sm text-muted-foreground sm:block">{note}</span>
    </li>
  );
}

export function Problem() {
  const ref = useRef<HTMLElement>(null);
  const reduce = useReducedMotion() ?? false;
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start 70%', 'end 55%'] });
  const one = useTransform(scrollYProgress, [0.78, 0.95], [0, 1]);
  const oneY = useTransform(one, [0, 1], [16, 0]);

  return (
    <section ref={ref} className="mx-auto max-w-[1280px] px-5 py-24 md:px-8 md:py-36" id="problem">
      <div className="grid gap-10 lg:grid-cols-[1fr_1.5fr] lg:gap-20">
        <div className="lg:sticky lg:top-32 lg:self-start">
          <Heading text="Still too many surfaces." className="text-[clamp(2.4rem,5vw,4.25rem)]" />
          <BlurFade inView delay={0.1}>
            <p className="mt-6 max-w-[40ch] text-lg leading-relaxed text-muted-foreground">
              The set is decisive. The ops layer rarely is. Context splits, momentum leaks.
            </p>
          </BlurFade>
        </div>
        <div>
          <ul>
            {surfaces.map(([l, n], i) => (
              <Row key={l} label={l} note={n} p={scrollYProgress} from={0.08 + i * 0.13} to={0.2 + i * 0.13} reduce={reduce} />
            ))}
          </ul>
          <motion.div
            style={reduce ? undefined : { opacity: one, y: oneY }}
            className="border-t border-foreground pt-6 md:pt-8"
          >
            <p className="display text-[clamp(2rem,6vw,4.5rem)] text-primary">One spine.</p>
            <p className="mt-3 max-w-[48ch] text-lg text-muted-foreground">
              Index holds one workflow from first look to locked date. Calendar, messaging and billing, connected.
            </p>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
