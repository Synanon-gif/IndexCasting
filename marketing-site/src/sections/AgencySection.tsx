import { EyebrowRule } from '../components/EyebrowRule';
import { ProductShot } from '../components/ProductShot';
import { Reveal } from '../components/Reveal';
import { RevealTitle } from '../components/RevealTitle';
import { visual } from '../productVisuals';

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

const agencyHero = visual('agency-workflow');
const agencyOptionThreads = visual('agency-option-threads');
const agencyClientChat = visual('agency-client-chat');

export function AgencySection() {
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

          <ProductShot
            src={agencyHero.src}
            alt={agencyHero.alt}
            width={agencyHero.width}
            height={agencyHero.height}
            className="agencyHeroShot"
          />
        </div>

        <div className="agencyProductStrip">
          <ProductShot
            src={agencyOptionThreads.src}
            alt={agencyOptionThreads.alt}
            width={agencyOptionThreads.width}
            height={agencyOptionThreads.height}
            wide
          />
          <ProductShot
            src={agencyClientChat.src}
            alt={agencyClientChat.alt}
            width={agencyClientChat.width}
            height={agencyClientChat.height}
            wide
          />
        </div>
      </div>
    </section>
  );
}
