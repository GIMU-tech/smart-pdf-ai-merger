import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import type { PdfSource } from '../model/types';

interface PdfPageNavigationProps {
  source: PdfSource;
  busy: boolean;
  onPageChange: (pageNumber: number) => void;
}

export function PdfPageNavigation({ source, busy, onPageChange }: PdfPageNavigationProps) {
  const { currentPage, pageCount } = source;

  return (
    <nav className="mt-4 rounded-control border border-border bg-panel p-3" aria-label="PDF 페이지 선택" aria-busy={busy}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-black text-slate-700" aria-live="polite">
          현재 {currentPage} / {pageCount}페이지
        </p>
        {busy && <Loader2 className="h-4 w-4 animate-spin text-pink-500 motion-reduce:animate-none" aria-label="PDF 페이지 렌더링 중" />}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={busy || currentPage <= 1}
          onClick={() => onPageChange(currentPage - 1)}
          className="inline-flex h-control-md items-center justify-center gap-1 rounded-control border border-border-strong bg-panel text-[11px] font-extrabold text-secondary hover:bg-subtle hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
          이전
        </button>
        <button
          type="button"
          disabled={busy || currentPage >= pageCount}
          onClick={() => onPageChange(currentPage + 1)}
          className="inline-flex h-control-md items-center justify-center gap-1 rounded-control border border-border-strong bg-panel text-[11px] font-extrabold text-secondary hover:bg-subtle hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-40"
        >
          다음
          <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>

      <p id="pdf-page-list-label" className="mt-3 text-[11px] font-bold text-slate-400">PDF 페이지 목록</p>
      <ol className="mt-2 grid max-h-36 grid-cols-4 gap-1.5 overflow-y-auto pr-1" aria-labelledby="pdf-page-list-label">
        {Array.from({ length: pageCount }, (_, index) => index + 1).map(pageNumber => (
          <li key={pageNumber}>
            <button
              type="button"
              disabled={busy}
              aria-label={`${pageNumber}페이지 선택`}
              aria-current={pageNumber === currentPage ? 'page' : undefined}
              onClick={() => onPageChange(pageNumber)}
              className={`flex min-h-8 w-full items-center justify-center rounded-md text-[11px] font-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${
                pageNumber === currentPage
                  ? 'bg-gif text-white'
                  : 'bg-subtle text-secondary hover:bg-selected hover:text-primary'
              } disabled:cursor-wait disabled:opacity-60`}
            >
              {pageNumber}
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}
