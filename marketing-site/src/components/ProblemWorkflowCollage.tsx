import { motion, useReducedMotion } from 'framer-motion';
import { ProductVisual } from './ProductVisual';
import { visual } from '../productVisuals';

const fragments = [
  { key: 'problem-options' as const, className: 'problemFragment problemFragmentOptions' },
  { key: 'problem-calendar' as const, className: 'problemFragment problemFragmentCalendar' },
  { key: 'problem-invoices' as const, className: 'problemFragment problemFragmentInvoices' },
  { key: 'problem-chat' as const, className: 'problemFragment problemFragmentChat' },
];

const easePremium = [0.16, 1, 0.3, 1] as const;

export function ProblemWorkflowCollage() {
  const reduceMotion = useReducedMotion() ?? false;

  return (
    <div className="problemCollage" aria-hidden="true">
      <div className="problemCollageGlow" />
      {fragments.map((item, i) => {
        const meta = visual(item.key);
        return (
          <motion.div
            key={item.key}
            className={item.className}
            initial={{ opacity: reduceMotion ? 0.68 : 0, y: reduceMotion ? 0 : 12 }}
            whileInView={{ opacity: 0.68, y: 0 }}
            viewport={{ once: true, margin: '-8% 0px', amount: 0.15 }}
            transition={{ duration: reduceMotion ? 0 : 0.75, delay: reduceMotion ? 0 : i * 0.07, ease: easePremium }}
          >
            <ProductVisual src={meta.src} alt="" width={meta.width} height={meta.height} />
          </motion.div>
        );
      })}
    </div>
  );
}
