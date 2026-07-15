import { Focus, Highlighter, MousePointer2, Sparkles, SquareDashed, Waves, ZoomIn } from 'lucide-react';
import { getPresetAvailability, GIF_PRESET_DEFINITIONS } from '../model/presets';
import type { GifPresetId, PresetTargetContext } from '../model/types';

interface GifPresetPanelProps {
  value: GifPresetId;
  disabled: boolean;
  targetContext: PresetTargetContext;
  onChange: (presetId: GifPresetId) => void;
}

const PRESET_ICONS = {
  'marker-sweep': Highlighter,
  spotlight: Focus,
  'border-pulse': SquareDashed,
  'fade-pulse': Waves,
  'light-sweep': Sparkles,
  'click-pointer': MousePointer2,
  'pop-zoom': ZoomIn,
} satisfies Record<GifPresetId, typeof Focus>;

export function GifPresetPanel({ value, disabled, targetContext, onChange }: GifPresetPanelProps) {
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" aria-labelledby="gif-presets-heading">
      <div className="shrink-0 border-b border-border p-panel">
        <h3 id="gif-presets-heading" className="text-sm font-extrabold text-primary">기본 프리셋</h3>
        <p className="mt-1 text-[11px] font-semibold text-muted">선택 영역에 적용할 움직임</p>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain p-panel" role="radiogroup" aria-label="GIF 애니메이션 프리셋">
        {GIF_PRESET_DEFINITIONS.map(preset => {
          const Icon = PRESET_ICONS[preset.id];
          const selected = value === preset.id;
          const availability = getPresetAvailability(preset.id, targetContext);
          const reasonId = `gif-preset-${preset.id}-reason`;
          return (
            <button
              key={preset.id}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-describedby={!disabled && !availability.supported ? reasonId : undefined}
              disabled={disabled || !availability.supported}
              title={!disabled && !availability.supported ? availability.reason : undefined}
              onClick={() => onChange(preset.id)}
              className={`w-full rounded-control border p-3 text-left transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-45 ${
                selected
                  ? 'border-gif bg-gif-subtle text-gif'
                  : 'border-border bg-panel text-secondary hover:border-border-strong hover:bg-subtle'
              }`}
            >
              <span className="flex items-center gap-2 text-xs font-black">
                <Icon className="h-4 w-4" aria-hidden="true" />
                {preset.label}
              </span>
              <span className="mt-1.5 block text-[11px] font-semibold leading-4 text-muted">{preset.description}</span>
              {!disabled && !availability.supported && (
                <span id={reasonId} className="mt-2 block text-[10px] font-bold leading-4 text-amber-700">
                  {availability.reason}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {disabled && (
        <p className="mx-panel mb-panel shrink-0 rounded-control border border-dashed border-border bg-subtle px-3 py-3 text-[11px] font-semibold leading-5 text-muted">
          PNG에서 영역을 선택하면 프리셋을 미리 볼 수 있습니다.
        </p>
      )}
    </section>
  );
}
