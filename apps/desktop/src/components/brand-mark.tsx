import codeVetterMarkUrl from '../../src-tauri/icons/icon.svg';

import { cn } from '@/lib/utils';

export function BrandMark({ className }: { className?: string }) {
  return (
    <img
      src={codeVetterMarkUrl}
      alt=""
      aria-hidden="true"
      className={cn('h-8 w-8 rounded-lg', className)}
    />
  );
}
