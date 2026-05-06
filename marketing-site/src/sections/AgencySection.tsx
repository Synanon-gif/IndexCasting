import { motion, useReducedMotion } from 'framer-motion';
import { EyebrowRule } from '../components/EyebrowRule';
import { ProductShowcaseFrame } from '../components/ProductShowcaseFrame';
import { Reveal } from '../components/Reveal';
import { RevealTitle } from '../components/RevealTitle';
import { getScreenshotSlot } from '../screenshotSlots';

const easePremium = [0.16, 1, 0.3, 1] as const;

const pillars = [
  'Roster & territories',
  'Recruiting pipeline',
  'Live calendars & holds',
  'Messaging · context intact',
  'Client rooms & projects',
  'Bookings through confirmation',
  'Built-in assistance layer',
  'Web + mobile · one spine',
];

const agencySlotOrder = [
  'agency-dashboard',
  'agency-roster',
  'agency-recruiting',
  'agency-calendar',
  'agency-client-thread',
  'agency-projects',
] as const;

export function AgencySection() {
  const reduceMotion = useReducedMotion() ?? false;

  return (
    <section id="agency" className="section agencySection">
      <div className="shell">
        <div className="agencyLayout">
          <div className="agencyCopy">
            <EyebrowRule className="sectionEyebrow" textClass="accentForest">
              Agency
            </EyebrowRule>
            <Reveal>
              <RevealTitle
                as="h2"
                className="sectionTitle"
                lines={['Built for speed', 'without losing control.']}
              />
            </Reveal>
            <Reveal delay={0.07}>
              <p className="sectionLead">
                One connected system around production: roster, recruiting, client comms, calendars. The field as it
                is — not rebuilt from five threads.
              </p>
            </Reveal>
            <Reveal delay={0.09}>
              <p className="agencyReassurance">Clients move faster — without agencies losing the relationship.</p>
            </Reveal>
            <Reveal delay={0.12}>
              <p className="agencyHighlight">
                Models meet you on the same spine. Operational intelligence clears routine friction; judgment stays
                yours.
              </p>
            </Reveal>
            <ul className="agencyList">
              {pillars.map((p, i) => (
                <Reveal key={p} delay={0.04 + i * 0.04}>
                  <li>
                    <span className="agencyTick" aria-hidden="true" />
                    {p}
                  </li>
                </Reveal>
              ))}
            </ul>
            <Reveal delay={0.1}>
              <p className="agencyClosing">
                Less re-syncing. Fewer handover mistakes. Massive operational relief at volume.
              </p>
            </Reveal>
          </div>

          <motion.div
            className="agencyFrame"
            initial={{ opacity: reduceMotion ? 1 : 0, y: reduceMotion ? 0 : 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-10% 0px', amount: 0.12 }}
            transition={{ duration: reduceMotion ? 0 : 0.98, ease: easePremium }}
          >
            <div className="agencyFrameInner">
              <div className="agencyOrb" />
              <motion.div
                className="agencyStack"
                initial={reduceMotion ? 'show' : 'hidden'}
                whileInView="show"
                viewport={{ once: true, margin: '-8% 0px', amount: 0.2 }}
                variants={{
                  hidden: {},
                  show: {
                    transition: {
                      staggerChildren: reduceMotion ? 0 : 0.08,
                      delayChildren: reduceMotion ? 0 : 0.04,
                    },
                  },
                }}
              >
                <motion.div
                  className="agencyRow"
                  variants={{
                    hidden: { opacity: 0, y: 10 },
                    show: {
                      opacity: 1,
                      y: 0,
                      transition: { duration: 0.58, ease: easePremium },
                    },
                  }}
                >
                  <span className="agencyChip">Roster</span>
                  <span className="agencyChip">Calendar</span>
                </motion.div>
                <motion.div
                  className="agencyRow"
                  variants={{
                    hidden: { opacity: 0, y: 10 },
                    show: {
                      opacity: 1,
                      y: 0,
                      transition: { duration: 0.58, ease: easePremium },
                    },
                  }}
                >
                  <span className="agencyChip agencyChipWide">Client threads</span>
                </motion.div>
                <motion.div
                  className="agencyTimeline"
                  variants={{
                    hidden: { opacity: 0, y: 10 },
                    show: {
                      opacity: 1,
                      y: 0,
                      transition: { duration: 0.58, ease: easePremium },
                    },
                  }}
                >
                  <span className="agencyDot" />
                  <span className="agencyLine" />
                  <span className="agencyDot agencyDotHot" />
                  <span className="agencyLine" />
                  <span className="agencyDot" />
                </motion.div>
                <motion.p
                  className="agencyFrameCaption"
                  variants={{
                    hidden: { opacity: 0 },
                    show: {
                      opacity: 1,
                      transition: { duration: 0.52, ease: easePremium },
                    },
                  }}
                >
                  One workflow · every stakeholder
                </motion.p>
              </motion.div>
            </div>
          </motion.div>
        </div>

        <p className="slotsSectionNote slotsNoteLabel">Agency · reserved captures</p>
        <div className="agencyShowcaseGrid">
          {agencySlotOrder.map((id) => {
            const slot = getScreenshotSlot(id)!;
            const span = id === 'agency-client-thread';
            return (
              <ProductShowcaseFrame
                key={id}
                slotId={slot.id}
                className={span ? 'agencyShowcaseSpan2' : ''}
                label={slot.label}
                caption={slot.purpose}
                variant={id === 'agency-recruiting' ? 'noir' : 'porcelain'}
                aspect={span ? 'cinema' : 'wide'}
              />
            );
          })}
        </div>
      </div>
    </section>
  );
}
