import { useRef, type HTMLAttributes, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '../../lib/utils';

export interface SegmentedChoiceOption {
  value: string;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}

export interface SegmentedChoiceProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange'> {
  value?: string;
  options: SegmentedChoiceOption[];
  onValueChange: (value: string) => void;
  ariaLabel: string;
  disabled?: boolean;
}

export function SegmentedChoice({
  value,
  options,
  onValueChange,
  ariaLabel,
  disabled = false,
  className,
  ...props
}: SegmentedChoiceProps) {
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const enabledIndexes = options
    .map((option, index) => (!disabled && !option.disabled ? index : -1))
    .filter((index) => index >= 0);
  const selectedIndex = options.findIndex((option) => option.value === value);

  const moveSelection = (event: KeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    if (!enabledIndexes.length) return;

    const currentPosition = enabledIndexes.indexOf(currentIndex);
    let nextPosition = currentPosition >= 0 ? currentPosition : 0;
    if (event.key === 'Home') nextPosition = 0;
    else if (event.key === 'End') nextPosition = enabledIndexes.length - 1;
    else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextPosition = (nextPosition + 1) % enabledIndexes.length;
    else nextPosition = (nextPosition - 1 + enabledIndexes.length) % enabledIndexes.length;

    const nextIndex = enabledIndexes[nextPosition];
    buttonRefs.current[nextIndex]?.focus();
    onValueChange(options[nextIndex].value);
  };

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
      className={cn('grid gap-2', className)}
      {...props}
    >
      {options.map((option, index) => {
        const checked = option.value === value;
        const optionDisabled = disabled || option.disabled;
        const isFallbackTabStop = selectedIndex < 0 && index === enabledIndexes[0];

        return (
          <button
            ref={(element) => { buttonRefs.current[index] = element; }}
            key={option.value}
            type="button"
            role="radio"
            aria-checked={checked}
            disabled={optionDisabled}
            tabIndex={checked || isFallbackTabStop ? 0 : -1}
            className={cn(
              'min-w-0 rounded-control border p-3 text-left transition-[color,background-color,border-color,box-shadow] duration-150',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2',
              checked ? 'border-action bg-selected text-primary' : 'border-border bg-panel text-secondary hover:border-border-strong hover:bg-subtle',
              'disabled:cursor-not-allowed disabled:border-disabled-border disabled:bg-disabled disabled:text-disabled-text',
            )}
            onClick={() => onValueChange(option.value)}
            onKeyDown={(event) => moveSelection(event, index)}
          >
            <span className="block text-[13px] leading-5 font-extrabold">{option.label}</span>
            {option.description && <span className="mt-0.5 block text-[11px] leading-4 text-muted">{option.description}</span>}
          </button>
        );
      })}
    </div>
  );
}
