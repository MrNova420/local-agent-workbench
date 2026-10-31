import { useState } from 'react';
import { createPortal } from 'react-dom';
import { buildModelOrbitSlots, type ModelOrbitSlot } from '../shared/model-orbit';
import type { ModelInfo } from '../shared/protocol';

const ORBIT_CLASSES = ['orbit-a', 'orbit-b', 'orbit-c'] as const;

export function ModelOrbit({ slots, onModelInfo }: { slots: ModelOrbitSlot[]; onModelInfo?: (model: string) => Promise<ModelInfo> }) {
  const [openedModel, setOpenedModel] = useState<string | null>(null);
  const [info, setInfo] = useState<ModelInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [popoverPoint, setPopoverPoint] = useState<{ left: number; top: number } | null>(null);

  async function showInfo(model: string, button: HTMLButtonElement) {
    setOpenedModel(model);
    const rect = button.getBoundingClientRect();
    setPopoverPoint({ left: rect.left + rect.width / 2, top: rect.top + rect.height / 2 });
    setInfo(null);
    setError('');
    if (!onModelInfo) return;
    setLoading(true);
    try { setInfo(await onModelInfo(model)); }
    catch (reason) { setError((reason as Error).message || 'Model details are unavailable.'); }
    finally { setLoading(false); }
  }

  return <>
    {ORBIT_CLASSES.map((orbitClass, ring) => {
      const markers = slots.filter((slot) => slot.ring === ring);
      return <div className={`visual-orbit ${orbitClass}`} data-model-count={markers.length} key={orbitClass}>
        {markers.map((slot) => <button
          key={slot.id}
          className={`model-orbit-dot ring-${slot.ring}${slot.selected ? ' selected' : ''}`}
          style={{ left: slot.left, top: slot.top }}
          title={slot.label}
          aria-label={slot.label}
          aria-expanded={openedModel === slot.id}
          aria-haspopup="dialog"
          onClick={(event) => void showInfo(slot.id, event.currentTarget)}
        />)}
      </div>;
    })}
    {openedModel && (() => {
      const slot = slots.find((item) => item.id === openedModel);
      if (!slot) return null;
      const point = popoverPoint ? {
        left: Math.min(window.innerWidth - 170, Math.max(170, popoverPoint.left)),
        top: Math.min(window.innerHeight - 110, Math.max(100, popoverPoint.top + 14)),
      } : undefined;
      return createPortal(<div className="model-orbit-popover" style={point} role="dialog" aria-label={`${slot.label} model information`}>
        <button className="model-orbit-popover-close" onClick={() => setOpenedModel(null)} aria-label="Close model information">×</button>
        <span className="eyebrow-line">INSTALLED MODEL</span>
        <strong title={slot.id}>{slot.label}</strong>
        {loading ? <small role="status">Loading model details…</small> : error ? <small role="alert">{error}</small> : info && <div className="model-orbit-facts">
          <span>Provider <b>{info.provider || 'Local'}</b></span>
          <span>Context <b>{info.context_limit_known ? (info.context?.toLocaleString() ?? 'Unknown') : 'Unknown'}</b></span>
          {info.family && <span>Family <b>{info.family}</b></span>}
          {info.parameter_size && <span>Parameters <b>{info.parameter_size}</b></span>}
          {info.quantization && <span>Quantization <b>{info.quantization}</b></span>}
          <span>Runtime context <b>{info.effective_context?.toLocaleString() ?? 'Not reported'}</b></span>
          <span>Reasoning <b>{info.reasoning.default == null ? 'Model default' : String(info.reasoning.default)}</b></span>
        </div>}
      </div>, document.body);
    })()}
  </>;
}

export function LocalModelOrbit({ models, labels, selectedModel, onModelInfo }: { models: string[]; labels: Record<string, string>; selectedModel: string; onModelInfo?: (model: string) => Promise<ModelInfo> }) {
  return <ModelOrbit slots={buildModelOrbitSlots(models, labels, selectedModel)} onModelInfo={onModelInfo} />;
}
