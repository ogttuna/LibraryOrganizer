import type { ReactNode } from 'react';
import * as Primitive from '@radix-ui/react-popover';
export function Popover({
  trigger,
  children,
  className = '',
  align = 'start',
}: {
  trigger: ReactNode;
  children: ReactNode;
  className?: string;
  align?: 'start' | 'end';
}) {
  return (
    <Primitive.Root>
      <Primitive.Trigger asChild>{trigger}</Primitive.Trigger>
      <Primitive.Portal>
        <Primitive.Content sideOffset={8} align={align} className={`popover ${className}`}>
          {children}
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  );
}
