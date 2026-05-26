import { motion, useReducedMotion, useScroll, useTransform } from 'framer-motion';
import { useRef } from 'react';
import { EyebrowRule } from '../components/EyebrowRule';
import { ProductShowcaseFrame } from '../components/ProductShowcaseFrame';
import { ProductVisual } from '../components/ProductVisual';
import { RevealTitle } from '../components/RevealTitle';
import { APP_ORIGIN } from '../constants';
import { getScreenshotSlot } from '../screenshotSlots';
import { visual } from '../productVisuals';
import { useMediaQuery } from '../hooks/useMediaQuery';

const easePremium = [0.16, 1, 0.3, 1] as const;

const heroWeb = getScreenshotSlot('hero-overview-web')!;
const heroMobile = getScreenshotSlot('hero-overview-mobile')!;
const heroAsset = visual('hero-stack');

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

  const yHero = useTransform(scrollYProgress, [0, 1], [0, parallaxOn ? -36 : 0]);

  const floatAmp = isNarrow ? 3 : 6;
  const floatDuration = isNarrow ? 11 : 9;

  return (
    <section ref={region} className="heroSection">
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

          <motion.div className="heroProductStage" aria-hidden="true" style={{ y: yHero }}>
            <motion.div
              className="heroProductFloat"
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
              <div className="heroProductGlow" />
              <div className="heroProductFrame">
                <ProductVisual
                  src={heroAsset.src}
                  alt={heroAsset.alt}
                  width={heroAsset.width}
                  height={heroAsset.height}
                  priority
                  className="heroProductImage"
                />
              </div>
            </motion.div>
          </motion.div>
        </div>

        <div className="heroShotRow" aria-label="Product overview">
          <ProductShowcaseFrame
            slotId={heroWeb.id}
            label={heroWeb.label}
            caption={heroWeb.purpose}
            variant="porcelain"
            aspect="wide"
            imagePriority
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
