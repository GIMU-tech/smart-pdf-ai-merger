import { FilePlus2 } from 'lucide-react';
import { Button } from '../primitives/Button';

type NewWorkButtonProps = {
  onConfirm: () => void;
  label?: string;
  confirmationMessage?: string;
  disabled?: boolean;
  className?: string;
};

export function NewWorkButton({
  onConfirm,
  label = '새 작업',
  confirmationMessage = '현재 작업 내용을 비우고 새 작업을 시작할까요?',
  disabled,
  className,
}: NewWorkButtonProps) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={className}
      disabled={disabled}
      startIcon={<FilePlus2 className="size-4" />}
      onClick={() => {
        if (window.confirm(confirmationMessage)) onConfirm();
      }}
    >
      {label}
    </Button>
  );
}
