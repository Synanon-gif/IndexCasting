import { motion, useReducedMotion } from 'framer-motion';
import { Reveal } from '../components/Reveal';
import { APP_ORIGIN, EARLY_ACCESS_EMAIL } from '../constants';

const easePremium = [0.16, 1, 0.3, 1] as const;

const pillars = [
  {
    title: 'One workflow',
    body: 'Discovery through booking — without the chaos between tools.',
  },
  {
    title: 'Every stakeholder',
    body: 'Agency · Client · Model · Billing on the same spine.',
  },
  {
    title: 'Trust baseline',
    body: 'Built in Innsbruck. GDPR-first by design.',
  },
];

export function FinalCtaSection() {
  const reduceMotion = useReducedMotion() ?? false;

  return (
    <section id="cta" className="section finalCtaSection">
      <div className="shell">
        <motion.div
          className="finalCtaCard"
          initial={{ opacity: reduceMotion ? 1 : 0, y: reduceMotion ? 0 : 22 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-12% 0px', amount: 0.15 }}
          transition={{ duration: reduceMotion ? 0 : 0.9, ease: easePremium }}
        >
          <Reveal>
            <p className="eyebrow sectionEyebrow lightEyebrow">Now</p>
            <h2 className="finalCtaTitle">
              Casting finally gets a <span className="finalCtaAccent">system</span>.
            </h2>
            <p className="finalCtaLead">
              One workflow. Every stakeholder. From discovery to booking — without the chaos.
            </p>
          </Reveal>

          <div className="finalCtaPillars">
            {pillars.map((p) => (
              <article key={p.title} className="finalCtaPillar">
                <h3>{p.title}</h3>
                <p>{p.body}</p>
              </article>
            ))}
          </div>

          <div className="finalCtaActions">
            <a className="btn btnLight" href={`${APP_ORIGIN}/`} rel="noopener noreferrer">
              Open Index Casting
            </a>
            <a className="btn btnOutlineLight" href={`${APP_ORIGIN}/trust`} rel="noopener noreferrer">
              Trust &amp; security
            </a>
          </div>
          <div className="earlyAccess">
            <p className="earlyAccessInner">
              Currently onboarding selected agencies. Independent teams and small shops can test the product during
              rollout — for early access, write{' '}
              <a href={`mailto:${EARLY_ACCESS_EMAIL}?subject=Index%20Casting%20—%20early%20access`}>
                {EARLY_ACCESS_EMAIL}
              </a>
              .
            </p>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
