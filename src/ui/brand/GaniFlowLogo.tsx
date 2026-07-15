import { cn } from '../../lib/utils';
import ganiFlowMarkUrl from '../../../assets/logos/gani-flow/gani-flow-mark.svg?url';

export const GANI_FLOW_MARK_URL = ganiFlowMarkUrl;

type GaniFlowLogoProps = {
  compact?: boolean;
  className?: string;
  markClassName?: string;
  showDescriptor?: boolean;
};

export function GaniFlowLogo({
  compact = false,
  className,
  markClassName,
  showDescriptor = false,
}: GaniFlowLogoProps) {
  return (
    <span className={cn('inline-flex min-w-0 items-center', compact ? 'gap-2' : 'gap-3.5', className)}>
      <img
        src={GANI_FLOW_MARK_URL}
        alt=""
        aria-hidden="true"
        className={cn('block flex-shrink-0', compact ? 'size-8' : 'size-14 sm:size-16', markClassName)}
        draggable={false}
      />
      <span className="min-w-0 text-left font-sans leading-none">
        <span className={cn('flex items-baseline whitespace-nowrap font-extrabold tracking-tight', compact ? 'text-[15px]' : 'text-[30px] sm:text-[38px]')}>
          <span className="text-[#0F172A]">GANI</span>
          <span className={cn('font-bold text-[#7C3AED]', compact ? 'ml-1.5 tracking-[0.08em]' : 'ml-2.5 tracking-[0.12em]')}>FLOW</span>
        </span>
        {showDescriptor && (
          <span className="mt-2 block whitespace-nowrap text-[10px] font-bold tracking-[0.28em] text-slate-500 sm:text-[11px]">
            DESIGN FILE WORKSPACE
          </span>
        )}
      </span>
    </span>
  );
}
