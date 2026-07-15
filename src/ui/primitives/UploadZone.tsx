import {
  forwardRef,
  useId,
  useRef,
  useState,
  type DragEvent,
  type HTMLAttributes,
  type ReactNode,
} from 'react';
import { cn } from '../../lib/utils';
import { Button } from './Button';

export type UploadZoneSize = 'compact' | 'studio';
export type UploadZoneState = 'idle' | 'loaded' | 'error';

export interface UploadZoneProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onDrop' | 'title'> {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  actionLabel?: string;
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  size?: UploadZoneSize;
  state?: UploadZoneState;
  onFiles?: (files: File[]) => void;
}

const stateClasses: Record<UploadZoneState | 'dragging', string> = {
  idle: 'border-border-strong bg-subtle text-secondary hover:border-focus hover:bg-compare-subtle/40',
  dragging: 'border-focus bg-compare-subtle text-compare ring-2 ring-focus/15',
  loaded: 'border-success bg-success-subtle text-success',
  error: 'border-danger bg-danger-subtle text-danger',
};

export const UploadZone = forwardRef<HTMLDivElement, UploadZoneProps>(function UploadZone(
  {
    id,
    className,
    title,
    description,
    icon,
    actionLabel = '파일 선택',
    accept,
    multiple = false,
    disabled = false,
    size = 'compact',
    state = 'idle',
    onFiles,
    ...props
  },
  ref,
) {
  const generatedId = useId();
  const inputId = id ? `${id}-input` : `${generatedId}-input`;
  const descriptionId = description ? `${inputId}-description` : undefined;
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const visualState = isDragging && !disabled ? 'dragging' : state;

  const emitFiles = (files: FileList | null) => {
    if (!disabled && files?.length) onFiles?.(Array.from(files));
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    emitFiles(event.dataTransfer.files);
  };

  return (
    <div
      ref={ref}
      id={id}
      aria-disabled={disabled || undefined}
      className={cn(
        'flex min-w-0 flex-col items-center justify-center rounded-panel border border-dashed text-center',
        'transition-[color,background-color,border-color,box-shadow] duration-150',
        size === 'compact' ? 'min-h-40 gap-3 p-5' : 'min-h-72 gap-4 p-8',
        disabled ? 'cursor-not-allowed border-disabled-border bg-disabled text-disabled-text' : stateClasses[visualState],
        className,
      )}
      onDragEnter={(event) => {
        event.preventDefault();
        if (!disabled) setIsDragging(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsDragging(false);
      }}
      onDrop={handleDrop}
      {...props}
    >
      <input
        ref={inputRef}
        id={inputId}
        className="sr-only"
        type="file"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        aria-describedby={descriptionId}
        onChange={(event) => {
          emitFiles(event.currentTarget.files);
          event.currentTarget.value = '';
        }}
      />
      {icon && (
        <span aria-hidden="true" className="grid size-12 place-items-center rounded-control bg-panel text-current shadow-panel">
          {icon}
        </span>
      )}
      <div className="space-y-1">
        <div className="text-[14px] leading-5 font-extrabold text-primary">{title}</div>
        {description && (
          <div id={descriptionId} className="text-[12px] leading-5 text-secondary">
            {description}
          </div>
        )}
      </div>
      <Button
        variant="primary"
        size="sm"
        disabled={disabled}
        aria-controls={inputId}
        onClick={() => inputRef.current?.click()}
      >
        {actionLabel}
      </Button>
      {state === 'error' && <span className="sr-only" role="alert">파일을 불러오지 못했습니다.</span>}
    </div>
  );
});
