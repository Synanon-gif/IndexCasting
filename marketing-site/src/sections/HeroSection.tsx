import { motion, useReducedMotion, useScroll, useTransform } from 'framer-motion';
import { useMemo, useRef } from 'react';
import { EyebrowRule } from '../components/EyebrowRule';
import { ProductShowcaseFrame } from '../components/ProductShowcaseFrame';
import { RevealTitle } from '../components/RevealTitle';
import { APP_ORIGIN } from '../constants';
import { getScreenshotSlot } from '../screenshotSlots';
import { useMediaQuery } from '../hooks/useMediaQuery';

const easePremium = [0.16, 1, 0.3, 1] as const;

const heroWeb = getScreenshotSlot('hero-overview-web')!;
const heroMobile = getScreenshotSlot('hero-overview-mobile')!;

export function HeroSection() {
  const region = useRef<HTMLElement>(null);
  const prefersReducedMotion = useReducedMotion() ?? false;
  const isNarrow = useMediaQuery('(max-width: 767.98px)');
  const isCoarse = useMediaQuery('(pointer: coarse)');
  const parallaxOn = !prefersReducedMotion && !isNarrow && !isCoarse;
  const floatOn = !prefersReducedMotion;

  const { scrollYProgress } = useScroll({
    target: region,
    offset: ['start start', 'end start'],
  });

  const [y1Max, y2Max, y3Max] = useMemo(
    () => (parallaxOn ? [-52, -26, -78] : [0, 0, 0]),
    [parallaxOn],
  );

  const y1 = useTransform(scrollYProgress, [0, 1], [0, y1Max]);
  const y2 = useTransform(scrollYProgress, [0, 1], [0, y2Max]);
  const y3 = useTransform(scrollYProgress, [0, 1], [0, y3Max]);

  const floatAmp = isNarrow ? 2 : 4;
  const floatDuration = isNarrow ? 11 : 9;

  return (
    <section ref={region} id="top" className="heroSection">
      <div className="shell">
        <div className="heroGrid">
          <motion.div
            className="heroCopy"
            initial={{ opacity: 0, y: prefersReducedMotion ? 0 : 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: prefersReducedMotion ? 0 : 1.05,
              ease: easePremium,
              delay: prefersReducedMotion ? 0 : 0.1,
            }}
          >
            <EyebrowRule className="heroEyebrowRule">Modern casting infrastructure</EyebrowRule>
            <RevealTitle
              as="h1"
              className="heroTitle"
              motionPreset="hero"
              lines={['Fashion moves faster when', 'everyone stays connected.']}
              delayStart={0.06}
            />
            <p className="heroSub">
              Visual discovery for clients. Operational clarity for agencies. A modern entry point into fashion for
              models.
            </p>
            <p className="heroSupport">Models stay connected through the agencies that represent them.</p>
            <ul className="heroList">
              <li>Visual speed</li>
              <li>Agency control</li>
              <li>Live calendars</li>
              <li>Threads with context</li>
              <li>EU-minded</li>
            </ul>
            <div className="heroActions">
              <a className="btn btnPrimary" href={`${APP_ORIGIN}/`} rel="noopener noreferrer">
                Open Index Casting
              </a>
              <a className="btn btnGhost" href={`${APP_ORIGIN}/trust`} rel="noopener noreferrer">
                Trust &amp; data
              </a>
            </div>
          </motion.div>

          <motion.div
            className="heroMock"
            aria-hidden="true"
            animate={floatOn ? { y: [0, -floatAmp, 0] } : undefined}
            transition={
              floatOn
                ? {
                    duration: floatDuration,
                    repeat: Infinity,
                    ease: 'easeInOut',
                  }
                : undefined
            }
          >
            <div className="heroMockGlow" />
            <motion.div
              className={`heroLayer heroLayerBack${parallaxOn ? '' : ' heroLayerStatic'}`}
              style={{ y: y3 }}
            >
              <div className="mockPanel mockPanelWide">
                <span className="mockBar" />
                <div className="mockGridCols">
                  <div className="mockThumb" />
                  <div className="mockThumb" />
                  <div className="mockThumb" />
                </div>
              </div>
            </motion.div>
            <motion.div
              className={`heroLayer heroLayerMid${parallaxOn ? '' : ' heroLayerStatic'}`}
              style={{ y: y2 }}
            >
              <div className="mockPanel mockPanelChat">
                <div className="mockChatHeader">
                  <span className="mockDot" />
                  <span className="mockChatTitle">Agency ↔ Client</span>
                </div>
                <div className="mockBubbles">
                  <span className="mockBubble mockBubbleL" />
                  <span className="mockBubble mockBubbleR" />
                  <span className="mockBubble mockBubbleL short" />
                </div>
              </div>
            </motion.div>
            <motion.div
              className={`heroLayer heroLayerFront${parallaxOn ? '' : ' heroLayerStatic'}`}
              style={{ y: y1 }}
            >
              <div className="mockPanel mockPanelCal">
                <div className="mockCalNav">
                  <span />
                  <span />
                </div>
                <div className="mockCalCells">
                  {Array.from({ length: 12 }).map((_, i) => (
                    <span key={i} className={i === 5 ? 'mockCalCell mockCalCellHot' : 'mockCalCell'} />
                  ))}
                </div>
              </div>
              <div className="mockSwipeCard">
                <div className="mockSwipePhoto" />
                <div className="mockSwipeMeta">
                  <span className="mockSwipeLine" />
                  <span className="mockSwipeLine mockSwipeLineShort" />
                </div>
              </div>
            </motion.div>
          </motion.div>
        </div>

        <div className="heroShotRow" aria-label="Product overview placeholders">
          <ProductShowcaseFrame
            slotId={heroWeb.id}
            label={heroWeb.label}
            caption={heroWeb.purpose}
            variant="noir"
            aspect="wide"
          />
          <ProductShowcaseFrame
            slotId={heroMobile.id}
            label={heroMobile.label}
            caption={heroMobile.purpose}
            variant="porcelain"
            aspect="phone"
          />
        </div>
      </div>
    </section>
  );
}
