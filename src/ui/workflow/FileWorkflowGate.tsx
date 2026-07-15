import { Upload } from 'lucide-react';
import type { ReactNode } from 'react';
import { PageHeader } from '../layout/PageHeader';
import { UploadZone } from '../primitives/UploadZone';

type FileWorkflowGateProps = {
  title: ReactNode;
  description: ReactNode;
  featureIcon: ReactNode;
  featureIconClassName?: string;
  uploadTitle: ReactNode;
  uploadDescription: ReactNode;
  accept?: string;
  multiple?: boolean;
  actionLabel?: string;
  disabled?: boolean;
  onFiles: (files: File[]) => void;
  children?: ReactNode;
};

export function FileWorkflowGate({
  title,
  description,
  featureIcon,
  featureIconClassName,
  uploadTitle,
  uploadDescription,
  accept,
  multiple,
  actionLabel = '파일 선택',
  disabled,
  onFiles,
  children,
}: FileWorkflowGateProps) {
  return (
    <section className="flex w-full flex-col gap-6" aria-label={`${String(title)} 파일 업로드`}>
      <PageHeader
        title={title}
        description={description}
        icon={featureIcon}
        iconClassName={featureIconClassName}
      />
      <UploadZone
        className="min-h-[220px] bg-panel shadow-panel sm:min-h-[260px]"
        size="compact"
        title={uploadTitle}
        description={uploadDescription}
        icon={<Upload className="size-6" />}
        actionLabel={actionLabel}
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        onFiles={onFiles}
      />
      {children}
    </section>
  );
}
