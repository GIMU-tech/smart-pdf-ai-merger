import { Pause, Play, RotateCcw } from 'lucide-react';
import type { PresetDirection } from '../model/types';

interface GifPlaybackControlsProps {
  currentTimeMs: number;
  durationMs: number;
  intensity: number;
  accentColor: string;
  direction: PresetDirection;
  loopCount: number;
  isPlaying: boolean;
  disabled: boolean;
  prefersReducedMotion: boolean;
  onTogglePlayback: () => void;
  onRestart: () => void;
  onScrub: (timeMs: number) => void;
  onDurationChange: (durationMs: number) => void;
  onIntensityChange: (intensity: number) => void;
  onAccentColorChange: (accentColor: string) => void;
  onDirectionChange: (direction: PresetDirection) => void;
  onLoopCountChange: (loopCount: number) => void;
  onEditGestureStart: () => void;
  onEditGestureEnd: () => void;
}

function formatTime(timeMs: number) {
  return `${(timeMs / 1000).toFixed(1)}초`;
}

export function GifPlaybackControls({
  currentTimeMs,
  durationMs,
  intensity,
  accentColor,
  direction,
  loopCount,
  isPlaying,
  disabled,
  prefersReducedMotion,
  onTogglePlayback,
  onRestart,
  onScrub,
  onDurationChange,
  onIntensityChange,
  onAccentColorChange,
  onDirectionChange,
  onLoopCountChange,
  onEditGestureStart,
  onEditGestureEnd,
}: GifPlaybackControlsProps) {
  const playbackDisabled = disabled || prefersReducedMotion;
  const editGestureProps = {
    onPointerDown: onEditGestureStart,
    onPointerUp: onEditGestureEnd,
    onPointerCancel: onEditGestureEnd,
    onKeyDown: onEditGestureStart,
    onKeyUp: onEditGestureEnd,
    onBlur: onEditGestureEnd,
  };

  return (
    <section className="min-w-0 shrink-0 border-t border-border bg-panel-translucent p-3" aria-label="GIF 미리보기 재생 컨트롤">
      <div className="grid min-w-0 items-center gap-3 sm:grid-cols-[auto_minmax(140px,1fr)]">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onRestart}
            disabled={disabled}
            className="inline-flex h-control-md w-control-md items-center justify-center rounded-control border border-border-strong bg-panel text-secondary transition-colors hover:bg-subtle hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:border-disabled-border disabled:bg-disabled disabled:text-disabled-text"
            aria-label="처음으로"
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={onTogglePlayback}
            disabled={playbackDisabled}
            className="inline-flex h-control-md items-center justify-center gap-2 rounded-control bg-action px-4 text-xs font-extrabold text-on-action transition-colors hover:bg-action-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-disabled disabled:text-disabled-text"
            aria-label={isPlaying ? '미리보기 정지' : '미리보기 재생'}
          >
            {isPlaying ? <Pause className="h-4 w-4" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}
            {isPlaying ? '정지' : '재생'}
          </button>
        </div>

        <label className="min-w-0">
          <span className="flex items-center justify-between gap-2 text-[11px] font-extrabold text-muted">
            <span>재생 위치</span>
            <span>{formatTime(currentTimeMs)} / {formatTime(durationMs)}</span>
          </span>
          <input
            type="range"
            min={0}
            max={durationMs}
            step={10}
            value={Math.min(currentTimeMs, durationMs)}
            disabled={disabled}
            onChange={event => onScrub(Number(event.target.value))}
            className="mt-2 w-full accent-gif disabled:cursor-not-allowed"
            aria-valuetext={`${formatTime(currentTimeMs)} / ${formatTime(durationMs)}`}
          />
        </label>

      </div>

      <div className="mt-3 grid min-w-0 gap-3 border-t border-border pt-3 sm:grid-cols-2 lg:grid-cols-5">
        <label className="min-w-0">
          <span className="flex items-center justify-between gap-2 text-[11px] font-extrabold text-muted">
            <span>지속시간</span>
            <span>{formatTime(durationMs)}</span>
          </span>
          <input
            type="range"
            min={600}
            max={4000}
            step={100}
            value={durationMs}
            disabled={disabled}
            onChange={event => onDurationChange(Number(event.target.value))}
            {...editGestureProps}
            className="mt-2 w-full accent-gif disabled:cursor-not-allowed"
          />
        </label>

        <label className="min-w-0">
          <span className="flex items-center justify-between gap-2 text-[11px] font-extrabold text-muted">
            <span>강도</span>
            <span>{Math.round(intensity * 100)}%</span>
          </span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={intensity}
            disabled={disabled}
            onChange={event => onIntensityChange(Number(event.target.value))}
            {...editGestureProps}
            className="mt-2 w-full accent-gif disabled:cursor-not-allowed"
          />
        </label>

        <label className="min-w-0">
          <span className="flex items-center justify-between gap-2 text-[11px] font-extrabold text-muted">
            <span>강조 색상</span>
            <span className="font-mono uppercase">{accentColor}</span>
          </span>
          <input
            type="color"
            value={accentColor}
            disabled={disabled}
            onChange={event => {
              if (/^#[0-9a-fA-F]{6}$/.test(event.target.value)) onAccentColorChange(event.target.value);
            }}
            {...editGestureProps}
            className="mt-1 h-control-sm w-full cursor-pointer rounded-control border border-border-strong bg-panel p-1 disabled:cursor-not-allowed"
            aria-label="강조 색상"
          />
        </label>

        <label className="min-w-0">
          <span className="text-[11px] font-extrabold text-muted">방향</span>
          <select
            value={direction}
            disabled={disabled}
            onChange={event => onDirectionChange(event.target.value as PresetDirection)}
            className="mt-1 block h-control-sm w-full rounded-control border border-border-strong bg-panel px-2 text-xs font-bold text-secondary disabled:cursor-not-allowed disabled:bg-disabled disabled:text-disabled-text"
          >
            <option value="ltr">왼쪽 → 오른쪽</option>
            <option value="rtl">오른쪽 → 왼쪽</option>
          </select>
        </label>

        <label className="min-w-0">
          <span className="text-[11px] font-extrabold text-muted">내보내기 반복</span>
          <select
            value={loopCount}
            disabled={disabled}
            onChange={event => onLoopCountChange(Number(event.target.value))}
            className="mt-1 block h-control-sm w-full rounded-control border border-border-strong bg-panel px-2 text-xs font-bold text-secondary disabled:cursor-not-allowed disabled:bg-disabled disabled:text-disabled-text"
          >
            <option value={0}>무한</option>
            <option value={1}>1회</option>
            <option value={2}>2회</option>
            <option value={3}>3회</option>
          </select>
        </label>
      </div>

      {prefersReducedMotion && (
        <p className="mt-3 text-[11px] font-semibold text-muted" role="status">
          시스템의 동작 줄이기 설정에 따라 자동 재생을 중지했습니다. scrubber로 각 프레임을 확인할 수 있습니다.
        </p>
      )}
    </section>
  );
}
