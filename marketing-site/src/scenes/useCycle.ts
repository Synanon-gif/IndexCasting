import { useEffect, useState } from 'react';
import { useReducedMotion } from 'motion/react';

/** Steps 0..count-1 on a timer while `active`; frozen on the last step for reduced motion. */
export function useCycle(count: number, ms: number, active = true) {
  const reduce = useReducedMotion();
  const [i, setI] = useState(0);
  useEffect(() => {
    if (reduce || !active) return;
    const t = setInterval(() => setI((v) => (v + 1) % count), ms);
    return () => clearInterval(t);
  }, [count, ms, active, reduce]);
  return reduce ? count - 1 : i;
}
