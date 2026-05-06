import { type ReactNode, useRef } from 'react';
import { motion, useInView, useReducedMotion } from 'framer-motion';

const easePremium = [0.16, 1, 0.3, 1] as const;

type RevealTitleProps = {
  /** One string per line; each line gets a clipped vertical reveal */
  lines: string[];
  /** e.g. heroTitle, sectionTitle */
  className?: string;
  as?: 'h1' | 'h2' | 'h3' | 'p';
  delayStart?: number;
  /** `hero` = slower, wider stagger (editorial / campaign pace) */
  motionPreset?: 'default' | 'hero';
  /** Optional content after lines (e.g. punctuation) */
  suffix?: ReactNode;
};

/**
 * Editorial title reveal — quiet clip; respects reduced motion (fade only).
 */
export function RevealTitle({
  lines,
  className = '',
  as: Tag = 'h2',
  delayStart = 0,
  motionPreset = 'default',
  suffix,
}: RevealTitleProps) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: '-10% 0px -8% 0px' });
  const reduce = useReducedMotion() ?? false;
  const lineDuration = motionPreset === 'hero' ? 0.95 : 0.78;
  const lineStagger = motionPreset === 'hero' ? 0.15 : 0.11;

  return (
    <Tag ref={ref} className={`revealTitle ${className}`.trim()}>
      {lines.map((line, i) => (
        <span key={`${i}-${line}`} className="revealTitleLine">
          {reduce ? (
            line
          ) : (
            <motion.span
              className="revealTitleLineInner"
              initial={{ y: '104%' }}
              animate={inView ? { y: 0 } : { y: '104%' }}
              transition={{
                duration: lineDuration,
                ease: easePremium,
                delay: delayStart + i * lineStagger,
              }}
            >
              {line}
            </motion.span>
          )}
        </span>
      ))}
      {suffix ? <span className="revealTitleSuffix">{suffix}</span> : null}
    </Tag>
  );
}
