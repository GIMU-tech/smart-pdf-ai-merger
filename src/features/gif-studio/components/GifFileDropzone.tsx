import { useRef, useState } from 'react';
import { FileImage, Upload } from 'lucide-react';
import { cn } from '../../../lib/utils';

interface GifFileDropzoneProps {
  onFileSelected: (file: File) => void;
  hasSource: boolean;
}

export function GifFileDropzone({ onFileSelected, hasSource }: GifFileDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const selectFirstFile = (files: FileList | null) => {
    const file = files?.item(0);
    if (file) onFileSelected(file);
  };

  return (
    <div
      onDragOver={event => {
        event.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={event => {
        event.preventDefault();
        setIsDragging(false);
        selectFirstFile(event.dataTransfer.files);
      }}
      className={cn(
        'rounded-panel border border-dashed px-4 py-5 text-center transition-colors motion-reduce:transition-none',
        isDragging ? 'border-gif bg-gif-subtle' : 'border-border bg-subtle',
      )}
    >
      <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-control border border-border bg-panel text-secondary shadow-panel">
        {hasSource ? <FileImage className="h-5 w-5" aria-hidden="true" /> : <Upload className="h-5 w-5" aria-hidden="true" />}
      </span>
      <p className="mt-3 text-sm font-black text-slate-800">{hasSource ? '다른 파일로 교체' : 'PNG · SVG · PSD · PDF · AI · EPS · HTML 불러오기'}</p>
      <p className="mt-1 text-xs font-medium leading-5 text-slate-500">파일을 놓거나 버튼으로 선택하세요.</p>
      <input
        ref={inputRef}
        type="file"
        accept=".png,.svg,.psd,.pdf,.ai,.eps,.html,.htm,image/png,image/svg+xml,image/vnd.adobe.photoshop,application/pdf,application/postscript,text/html"
        className="sr-only"
        tabIndex={-1}
        aria-label="GIF Studio에서 편집할 PNG, SVG, PSD, PDF, AI, EPS 또는 HTML 파일"
        onChange={event => {
          selectFirstFile(event.target.files);
          event.target.value = '';
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="mt-4 inline-flex h-control-md items-center justify-center rounded-control bg-action px-4 text-xs font-extrabold text-on-action shadow-panel transition-colors hover:bg-action-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2"
      >
        파일 선택
      </button>
      <p className="mt-3 text-[11px] font-bold text-slate-400">HTML 2MB 이하 · 기타 형식은 각 가져오기 제한 적용</p>
    </div>
  );
}
