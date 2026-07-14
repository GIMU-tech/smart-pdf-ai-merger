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
    <section className="rounded-2xl border border-slate-200 bg-white/95 px-4 py-4 shadow-sm" aria-label="GIF 미리보기 재생 컨트롤">
      <div className="grid items-center gap-4 sm:grid-cols-2 xl:grid-cols-[auto_minmax(180px,1fr)_145px_145px_120px_120px_120px]">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onRestart}
            disabled={disabled}
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 hover:border-pink-200 hover:text-pink-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:text-slate-300"
            aria-label="처음으로"
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={onTogglePlayback}
            disabled={playbackDisabled}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 text-xs font-black text-white hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
            aria-label={isPlaying ? '미리보기 정지' : '미리보기 재생'}
          >
            {isPlaying ? <Pause className="h-4 w-4" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}
            {isPlaying ? '정지' : '재생'}
          </button>
        </div>

        <label className="min-w-0">
          <span className="flex items-center justify-between text-[11px] font-black text-slate-500">
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
            className="mt-2 w-full accent-pink-500 disabled:cursor-not-allowed"
            aria-valuetext={`${formatTime(currentTimeMs)} / ${formatTime(durationMs)}`}
          />
        </label>

        <label>
          <span className="flex items-center justify-between text-[11px] font-black text-slate-500">
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
            className="mt-2 w-full accent-pink-500 disabled:cursor-not-allowed"
          />
        </label>

        <label>
          <span className="flex items-center justify-between text-[11px] font-black text-slate-500">
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
            className="mt-2 w-full accent-pink-500 disabled:cursor-not-allowed"
          />
        </label>

        <label>
          <span className="flex items-center justify-between text-[11px] font-black text-slate-500">
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
            className="mt-1 h-8 w-full cursor-pointer rounded-lg border border-slate-200 bg-white p-1 disabled:cursor-not-allowed"
            aria-label="강조 색상"
          />
        </label>

        <label>
          <span className="text-[11px] font-black text-slate-500">방향</span>
          <select
            value={direction}
            disabled={disabled}
            onChange={event => onDirectionChange(event.target.value as PresetDirection)}
            className="mt-1 block h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs font-bold text-slate-700 disabled:cursor-not-allowed disabled:bg-slate-50"
          >
            <option value="ltr">왼쪽 → 오른쪽</option>
            <option value="rtl">오른쪽 → 왼쪽</option>
          </select>
        </label>

        <label>
          <span className="text-[11px] font-black text-slate-500">내보내기 반복</span>
          <select
            value={loopCount}
            disabled={disabled}
            onChange={event => onLoopCountChange(Number(event.target.value))}
            className="mt-1 block h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs font-bold text-slate-700 disabled:cursor-not-allowed disabled:bg-slate-50"
          >
            <option value={0}>무한</option>
            <option value={1}>1회</option>
            <option value={2}>2회</option>
            <option value={3}>3회</option>
          </select>
        </label>
      </div>

      {prefersReducedMotion && (
        <p className="mt-3 text-[11px] font-semibold text-slate-500" role="status">
          시스템의 동작 줄이기 설정에 따라 자동 재생을 중지했습니다. scrubber로 각 프레임을 확인할 수 있습니다.
        </p>
      )}
    </section>
  );
}
