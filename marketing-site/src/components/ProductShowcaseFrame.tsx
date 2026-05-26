import { type ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ProductVisual } from './ProductVisual';
import { visualForSlot } from '../productVisuals';

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
  /** Override slot lookup with explicit product visual */
  imagePriority?: boolean;
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
  imagePriority = false,
}: ProductShowcaseFrameProps) {
  const reduceMotion = useReducedMotion() ?? false;
  const asset = slotId ? visualForSlot(slotId) : undefined;
  const hasImage = Boolean(asset) && !children;

  return (
    <motion.div
      className={`showcaseWrap ${hasImage ? 'showcaseWrap--live' : ''} ${className}`.trim()}
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
      <div className={`showcaseFrame ${variantClass[variant]}${hasImage ? ' showcaseFrame--live' : ''}`}>
        <div className="showcaseFrameBezel" aria-hidden="true" />
        <div className={`showcaseFrameViewport ${aspectClass[aspect]}`}>
          {!hasImage ? <p className="showcaseFrameLabel">{label}</p> : null}
          <div className={`showcaseFrameInner${hasImage ? ' showcaseFrameInner--image' : ''}`}>
            {children ??
              (asset ? (
                <ProductVisual
                  src={asset.src}
                  alt={asset.alt}
                  width={asset.width}
                  height={asset.height}
                  priority={imagePriority}
                />
              ) : (
                <>
                  <span className="showcaseMesh" aria-hidden="true" />
                  <span className="showcaseShine" aria-hidden="true" />
                </>
              ))}
          </div>
        </div>
      </div>
      {caption && !hasImage ? (
        <p className="showcaseFrameCaption">
          <span className="showcaseFrameCaptionDot" aria-hidden="true" />
          {caption}
        </p>
      ) : null}
    </motion.div>
  );
}
