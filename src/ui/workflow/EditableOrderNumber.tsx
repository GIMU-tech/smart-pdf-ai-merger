import { useEffect, useState } from 'react';
import { cn } from '../../lib/utils';

type EditableOrderNumberProps = {
  value: number;
  max: number;
  itemLabel: string;
  className?: string;
  onChange: (nextValue: number) => void;
};

export function EditableOrderNumber({
  value,
  max,
  itemLabel,
  className,
  onChange,
}: EditableOrderNumberProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    if (!editing) setDraft(String(value));
  }, [editing, value]);

  const cancel = () => {
    setDraft(String(value));
    setEditing(false);
  };

  const commit = () => {
    const parsed = Number.parseInt(draft, 10);
    if (!Number.isFinite(parsed)) {
      cancel();
      return;
    }

    const nextValue = Math.min(Math.max(parsed, 1), Math.max(max, 1));
    setDraft(String(nextValue));
    setEditing(false);
    if (nextValue !== value) onChange(nextValue);
  };

  if (editing) {
    return (
      <input
        type="number"
        min={1}
        max={Math.max(max, 1)}
        value={draft}
        autoFocus
        draggable={false}
        aria-label={`${itemLabel} 이동할 순번`}
        className={cn(
          'h-7 w-10 rounded-control border border-focus bg-panel px-1 text-center font-mono text-xs font-bold text-primary outline-none ring-2 ring-focus/15',
          className,
        )}
        onFocus={event => event.currentTarget.select()}
        onChange={event => setDraft(event.target.value)}
        onBlur={commit}
        onClick={event => event.stopPropagation()}
        onDoubleClick={event => event.stopPropagation()}
        onDragStart={event => event.preventDefault()}
        onKeyDown={event => {
          if (event.key === 'Enter') {
            event.preventDefault();
            event.currentTarget.blur();
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            cancel();
          }
        }}
      />
    );
  }

  return (
    <button
      type="button"
      draggable={false}
      aria-label={`${itemLabel} 현재 순번 ${value}. 더블클릭해서 순번 변경`}
      title="더블클릭해서 순번 변경"
      className={cn(
        'h-7 w-10 shrink-0 rounded-control font-mono text-xs font-bold text-muted transition-colors hover:bg-selected hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus',
        className,
      )}
      onDoubleClick={event => {
        event.stopPropagation();
        setDraft(String(value));
        setEditing(true);
      }}
      onDragStart={event => event.preventDefault()}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          setDraft(String(value));
          setEditing(true);
        }
      }}
    >
      {value}
    </button>
  );
}
