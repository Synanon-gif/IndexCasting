import { type ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ProductShot } from './ProductShot';
import { visualForSlot } from '../productVisuals';

export type ShowcaseVariant = 'porcelain' | 'noir' | 'wine';
export type ShowcaseAspect = 'cinema' | 'phone' | 'square' | 'wide';

type ProductShowcaseFrameProps = {
  label: string;
  caption?: string;
  variant?: ShowcaseVariant;
  aspect?: ShowcaseAspect;
  children?: ReactNode;
  className?: string;
  slotId?: string;
  imagePriority?: boolean;
  wide?: boolean;
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
  wide = false,
}: ProductShowcaseFrameProps) {
  const reduceMotion = useReducedMotion() ?? false;
  const asset = slotId ? visualForSlot(slotId) : undefined;

  if (asset && !children) {
    return (
      <ProductShot
        src={asset.src}
        alt={asset.alt}
        width={asset.width}
        height={asset.height}
        priority={imagePriority}
        wide={wide}
        className={className}
      />
    );
  }

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

  return (
    <motion.div
      className={`showcaseWrap showcaseWrap--placeholder ${className}`.trim()}
      data-slot={slotId}
      initial={{ opacity: reduceMotion ? 1 : 0, y: reduceMotion ? 0 : 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-10% 0px', amount: 0.12 }}
      transition={{
        duration: reduceMotion ? 0 : 0.85,
        ease: [0.16, 1, 0.3, 1],
        delay: reduceMotion ? 0 : 0.06,
      }}
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
