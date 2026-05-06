import { type ReactNode, useRef } from 'react';
import { motion, useInView, useReducedMotion } from 'framer-motion';

const easePremium = [0.16, 1, 0.3, 1] as const;

type EyebrowRuleProps = {
  children: ReactNode;
  className?: string;
  textClass?: string;
};

/** Subtle brass/bronze rule under eyebrow — draws once in view */
export function EyebrowRule({ children, className = '', textClass = '' }: EyebrowRuleProps) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: '-5% 0px' });
  const reduce = useReducedMotion() ?? false;

  return (
    <div ref={ref} className={`eyebrowRuleWrap ${className}`.trim()}>
      <p className={`eyebrow eyebrowRuleText ${textClass}`.trim()}>{children}</p>
      <motion.span
        className="eyebrowRuleLine"
        aria-hidden="true"
        initial={reduce ? false : { scaleX: 0 }}
        animate={reduce || inView ? { scaleX: 1 } : { scaleX: 0 }}
        transition={{ duration: reduce ? 0 : 1.05, ease: easePremium, delay: reduce ? 0 : 0.08 }}
        style={{ originX: 0 }}
      />
    </div>
  );
}
