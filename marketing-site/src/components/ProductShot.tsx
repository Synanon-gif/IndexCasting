import { motion, useReducedMotion } from 'framer-motion';

type ProductShotProps = {
  src: string;
  alt: string;
  width: number;
  height: number;
  className?: string;
  priority?: boolean;
  /** Full grid width on desktop */
  wide?: boolean;
};

export function ProductShot({
  src,
  alt,
  width,
  height,
  className = '',
  priority = false,
  wide = false,
}: ProductShotProps) {
  const reduceMotion = useReducedMotion() ?? false;

  return (
    <motion.figure
      className={`productShot${wide ? ' productShot--wide' : ''} ${className}`.trim()}
      initial={{ opacity: reduceMotion ? 1 : 0, y: reduceMotion ? 0 : 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-8% 0px', amount: 0.08 }}
      transition={{ duration: reduceMotion ? 0 : 0.75, ease: [0.16, 1, 0.3, 1] }}
    >
      <img
        src={src}
        alt={alt}
        width={width}
        height={height}
        loading={priority ? 'eager' : 'lazy'}
        decoding="async"
        fetchPriority={priority ? 'high' : 'auto'}
        className="productShotImg"
        sizes={wide ? '(min-width: 900px) 100vw, 100vw' : '(min-width: 720px) 50vw, 100vw'}
      />
    </motion.figure>
  );
}
