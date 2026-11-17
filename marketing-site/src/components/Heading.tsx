import { useReducedMotion } from 'motion/react';
import SplitText from '@/components/SplitText';
import { cn } from '@/lib/utils';

type Props = {
  text: string;
  as?: 'h1' | 'h2' | 'h3';
  className?: string;
  trigger?: 'view' | 'load';
  delay?: number;
};

/** Display heading: word-by-word rise via React Bits SplitText; plain text when motion is reduced. */
export function Heading({ text, as = 'h2', className, trigger = 'view', delay = 0 }: Props) {
  const reduce = useReducedMotion();
  const Tag = as;
  if (reduce) return <Tag className={cn('display', className)}>{text}</Tag>;
  return (
    <SplitText
      text={text}
      tag={as}
      className={cn('display', className)}
      splitType="words"
      effect="rise"
      trigger={trigger}
      delay={delay}
      textAlign="left"
    />
  );
}
