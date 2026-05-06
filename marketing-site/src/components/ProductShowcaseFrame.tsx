import { type ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';

export type ShowcaseVariant = 'porcelain' | 'noir' | 'wine';
export type ShowcaseAspect = 'cinema' | 'phone' | 'square' | 'wide';

type ProductShowcaseFrameProps = {
  label: string;
  caption?: string;
  variant?: ShowcaseVariant;
  aspect?: ShowcaseAspect;
  /** Optional abstract placeholder content; defaults to built-in mesh. */
  children?: ReactNode;
  className?: string;
  /** Stable id from `screenshotSlots.ts` — links frame to production map */
  slotId?: string;
};

const aspectClass: Record<ShowcaseAspect, string> = {
  cinema: 'showcaseAspectCinema',
  phone: 'showcaseAspectPhone',
  square: 'showcaseAspectSquare',
  wide: 'showcaseAspectWide',
};

const variantClass: Record<ShowcaseVariant, string> = {
  porcelain: 'showcaseVariantPorcelain',
  noir: 'showcaseVariantNoir',
  wine: 'showcaseVariantWine',
};

export function ProductShowcaseFrame({
  label,
  caption,
  variant = 'porcelain',
  aspect = 'wide',
  children,
  className = '',
  slotId,
}: ProductShowcaseFrameProps) {
  const reduceMotion = useReducedMotion() ?? false;

  return (
    <motion.div
      className={`showcaseWrap ${className}`.trim()}
      data-slot={slotId}
      initial={{ opacity: reduceMotion ? 1 : 0, y: reduceMotion ? 0 : 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-10% 0px', amount: 0.12 }}
      transition={{
        duration: reduceMotion ? 0 : 0.85,
        ease: [0.16, 1, 0.3, 1],
        delay: reduceMotion ? 0 : 0.06,
      }}
      whileHover={
        reduceMotion
          ? undefined
          : {
              y: -4,
              transition: { duration: 0.35, ease: [0.16, 1, 0.3, 1] },
            }
      }
    >
      <div className={`showcaseFrame ${variantClass[variant]}`}>
        <div className="showcaseFrameBezel" aria-hidden="true" />
        <div className={`showcaseFrameViewport ${aspectClass[aspect]}`}>
          <p className="showcaseFrameLabel">{label}</p>
          <div className="showcaseFrameInner">
            {children ?? (
              <>
                <span className="showcaseMesh" aria-hidden="true" />
                <span className="showcaseShine" aria-hidden="true" />
              </>
            )}
          </div>
        </div>
      </div>
      {caption ? (
        <p className="showcaseFrameCaption">
          <span className="showcaseFrameCaptionDot" aria-hidden="true" />
          {caption}
        </p>
      ) : null}
    </motion.div>
  );
}
