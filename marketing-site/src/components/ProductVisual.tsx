type ProductVisualProps = {
  src: string;
  alt: string;
  width: number;
  height: number;
  className?: string;
  /** LCP / above-the-fold */
  priority?: boolean;
  objectFit?: 'natural' | 'cover' | 'contain';
  objectPosition?: string;
};

export function ProductVisual({
  src,
  alt,
  width,
  height,
  className = '',
  priority = false,
  objectFit = 'natural',
  objectPosition = 'center top',
}: ProductVisualProps) {
  const fitClass =
    objectFit === 'natural' ? 'productVisual--natural' : `productVisual--${objectFit}`;

  return (
    <img
      src={src}
      alt={alt}
      width={width}
      height={height}
      loading={priority ? 'eager' : 'lazy'}
      decoding="async"
      fetchPriority={priority ? 'high' : 'auto'}
      className={`productVisual ${fitClass} ${className}`.trim()}
      style={objectFit === 'natural' ? undefined : { objectPosition }}
    />
  );
}
