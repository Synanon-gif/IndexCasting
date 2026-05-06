import { type ReactNode, useRef } from 'react';
import { motion, useInView, useReducedMotion } from 'framer-motion';
import { useMediaQuery } from '../hooks/useMediaQuery';

/** Premium editorial easing — soft deceleration */
const easePremium = [0.16, 1, 0.3, 1] as const;

type RevealProps = {
  children: ReactNode;
  className?: string;
  delay?: number;
  y?: number;
};

export function Reveal({ children, className, delay = 0, y }: RevealProps) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: '-12% 0px -6% 0px' });
  const reduceMotion = useReducedMotion() ?? false;
  const compact = useMediaQuery('(max-width: 639.98px)');
  const motionY = y ?? (compact ? 12 : 20);
  const duration = reduceMotion ? 0 : compact ? 0.74 : 0.98;

  return (
    <motion.div
      ref={ref}
      className={className}
      initial={reduceMotion ? false : 'hidden'}
      animate={reduceMotion || inView ? 'visible' : 'hidden'}
      variants={{
        hidden: { opacity: 0, y: motionY },
        visible: {
          opacity: 1,
          y: 0,
          transition: { duration, ease: easePremium, delay },
        },
      }}
    >
      {children}
    </motion.div>
  );
}
