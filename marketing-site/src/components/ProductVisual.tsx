type ProductVisualProps = {
  src: string;
  alt: string;
  width: number;
  height: number;
  className?: string;
  /** LCP / above-the-fold */
  priority?: boolean;
  objectFit?: 'cover' | 'contain';
  objectPosition?: string;
};

export function ProductVisual({
  src,
  alt,
  width,
  height,
  className = '',
  priority = false,
  objectFit = 'contain',
  objectPosition = 'center top',
}: ProductVisualProps) {
  return (
    <img
      src={src}
      alt={alt}
      width={width}
      height={height}
      loading={priority ? 'eager' : 'lazy'}
      decoding="async"
      fetchPriority={priority ? 'high' : 'auto'}
      className={`productVisual productVisual--${objectFit} ${className}`.trim()}
      style={{ objectPosition }}
    />
  );
}
