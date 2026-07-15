import { Eye, EyeOff, Folder, Image, Type } from 'lucide-react';
import type { GifSelection, PsdLayerNode, PsdSource } from '../model/types';
import { flattenPsdLayerTree } from '../utils/psdLayers';

interface PsdLayerListProps {
  source: PsdSource;
  selection: GifSelection | null;
  onSelectionChange: (selection: GifSelection | null) => void;
}

function LayerIcon({ layer }: { layer: PsdLayerNode }) {
  if (layer.type === 'group') return <Folder className="h-3.5 w-3.5" aria-hidden="true" />;
  if (layer.hasText) return <Type className="h-3.5 w-3.5" aria-hidden="true" />;
  return <Image className="h-3.5 w-3.5" aria-hidden="true" />;
}

export function PsdLayerList({ source, selection, onSelectionChange }: PsdLayerListProps) {
  const layers = flattenPsdLayerTree(source.layerTree);
  return (
    <section className="mt-4 border-t border-slate-100 pt-4" aria-labelledby="gif-psd-layers-heading">
      <div className="flex items-center justify-between gap-2">
        <h4 id="gif-psd-layers-heading" className="text-xs font-black text-slate-800">PSD 레이어</h4>
        <span className="text-[10px] font-bold text-slate-400">선택 가능 {source.selectableLayerCount}/{source.layerCount}</span>
      </div>
      <div className="mt-2 max-h-72 space-y-1 overflow-y-auto pr-1" role="list" aria-label="PSD 레이어 트리">
        {layers.map(layer => {
          const active = selection?.kind === 'object' && selection.objectId === layer.id;
          return (
            <button
              key={layer.id}
              type="button"
              role="listitem"
              disabled={!layer.selectable}
              aria-current={active ? 'true' : undefined}
              onClick={() => {
                if (!layer.bounds) return;
                onSelectionChange({
                  kind: 'object',
                  rect: layer.bounds,
                  objectId: layer.id,
                  objectType: layer.type,
                  label: layer.name,
                });
              }}
              className={`flex min-h-9 w-full items-center gap-2 rounded-control border px-2 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-45 ${
                active
                  ? 'border-gif bg-gif-subtle text-gif'
                  : 'border-transparent text-secondary hover:border-border hover:bg-subtle disabled:hover:border-transparent disabled:hover:bg-transparent'
              }`}
              style={{ paddingLeft: `${8 + Math.min(layer.depth, 12) * 12}px` }}
              title={layer.selectable ? `${layer.name} 선택` : `${layer.name}: 선택할 수 없는 그룹 또는 빈 레이어`}
            >
              <span className="shrink-0 text-slate-400"><LayerIcon layer={layer} /></span>
              <span className="min-w-0 flex-1 truncate text-[11px] font-bold">{layer.name}</span>
              <span className="shrink-0 text-slate-300">
                {layer.visible ? <Eye className="h-3.5 w-3.5" aria-label="표시 레이어" /> : <EyeOff className="h-3.5 w-3.5" aria-label="숨김 레이어" />}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
