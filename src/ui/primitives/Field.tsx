import {
  cloneElement,
  forwardRef,
  isValidElement,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
} from 'react';
import { cn } from '../../lib/utils';

type FieldControlProps = {
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
  'aria-required'?: boolean;
};

export interface FieldProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  id: string;
  label: ReactNode;
  children: ReactElement<FieldControlProps>;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
}

export const Field = forwardRef<HTMLDivElement, FieldProps>(function Field(
  { id, label, children, hint, error, required = false, className, ...props },
  ref,
) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const ownDescription = children.props['aria-describedby'];
  const describedBy = [ownDescription, hintId, errorId].filter(Boolean).join(' ') || undefined;
  const control = isValidElement(children)
    ? cloneElement(children, {
        id: children.props.id ?? id,
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : children.props['aria-invalid'],
        'aria-required': required || children.props['aria-required'] || undefined,
      })
    : children;

  return (
    <div ref={ref} className={cn('grid gap-1.5', className)} {...props}>
      <label htmlFor={children.props.id ?? id} className="text-[13px] leading-5 font-bold text-primary">
        {label}
        {required && <span className="ml-1 text-danger" aria-hidden="true">*</span>}
      </label>
      {control}
      {hint && <div id={hintId} className="text-[11px] leading-4 text-muted">{hint}</div>}
      {error && <div id={errorId} role="alert" className="text-[11px] leading-4 font-semibold text-danger">{error}</div>}
    </div>
  );
});

export const fieldControlClassName = cn(
  'h-control-md w-full rounded-control border border-border-strong bg-panel px-3 text-[13px] text-primary',
  'placeholder:text-muted transition-[border-color,box-shadow,background-color] duration-150',
  'focus-visible:border-focus focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/20',
  'aria-invalid:border-danger aria-invalid:ring-danger/15',
  'disabled:cursor-not-allowed disabled:border-disabled-border disabled:bg-disabled disabled:text-disabled-text',
);
