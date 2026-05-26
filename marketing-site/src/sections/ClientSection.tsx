import { EyebrowRule } from '../components/EyebrowRule';
import { ProductShowcaseFrame } from '../components/ProductShowcaseFrame';
import { Reveal } from '../components/Reveal';
import { RevealTitle } from '../components/RevealTitle';
import { getScreenshotSlot } from '../screenshotSlots';

const disc = getScreenshotSlot('client-discovery-swipe')!;
const shortlist = getScreenshotSlot('client-shortlist')!;
const project = getScreenshotSlot('client-project')!;
const chat = getScreenshotSlot('client-agency-chat')!;

export function ClientSection() {
  return (
    <section id="clients" className="section clientSection">
      <div className="shell">
        <div className="clientGrid">
          <div className="clientCopy">
            <EyebrowRule className="sectionEyebrow" textClass="accentWine">
              Clients &amp; productions
            </EyebrowRule>
            <Reveal>
              <RevealTitle
                as="h2"
                className="sectionTitle"
                lines={['Visual discovery.', 'Faster decisions.']}
              />
            </Reveal>
            <Reveal delay={0.08}>
              <p className="sectionLead">
                Swipe-speed exploration — not a gimmick. Fewer PDFs. Fewer WhatsApp chains. Agencies stay in the
                thread with context intact.
              </p>
            </Reveal>
          </div>

          <ProductShowcaseFrame
            className="clientShowcase"
            slotId={disc.id}
            label={disc.label}
            caption={disc.purpose}
            variant="porcelain"
            aspect="cinema"
          />

          <div className="clientPoints">
            {[
              'Visual-first · decisive',
              'Projects stay legible',
              'Agencies linked · thread intact',
              'Holds & confirmations visible',
            ].map((t, i) => (
              <Reveal key={t} delay={i * 0.065}>
                <p className="clientPoint">{t}</p>
              </Reveal>
            ))}
          </div>
        </div>

        <div className="clientSlotsGrid">
          <ProductShowcaseFrame
            slotId={shortlist.id}
            label={shortlist.label}
            caption={shortlist.purpose}
            variant="noir"
            aspect="wide"
          />
          <ProductShowcaseFrame
            slotId={project.id}
            label={project.label}
            caption={project.purpose}
            variant="porcelain"
            aspect="wide"
          />
          <ProductShowcaseFrame
            slotId={chat.id}
            label={chat.label}
            caption={chat.purpose}
            variant="noir"
            aspect="wide"
          />
        </div>
      </div>
    </section>
  );
}
