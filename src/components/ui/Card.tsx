import { cn } from '@/lib/utils';
import type { HTMLAttributes } from 'react';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  gold?: boolean;
}

export default function Card({ className, gold, children, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-xl border bg-dark-100 p-6',
        gold ? 'border-gold/30' : 'border-dark-300',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}
