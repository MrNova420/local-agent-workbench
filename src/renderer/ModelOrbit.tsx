import { buildModelOrbitSlots, type ModelOrbitSlot } from '../shared/model-orbit';

const ORBIT_CLASSES = ['orbit-a', 'orbit-b', 'orbit-c'] as const;

export function ModelOrbit({ slots }: { slots: ModelOrbitSlot[] }) {
  return <>
    {ORBIT_CLASSES.map((orbitClass, ring) => {
      const markers = slots.filter((slot) => slot.ring === ring);
      return <div className={`visual-orbit ${orbitClass}`} data-model-count={markers.length} key={orbitClass}>
        {markers.map((slot) => <span
          key={slot.id}
          className={`model-orbit-dot ring-${slot.ring}${slot.selected ? ' selected' : ''}`}
          style={{ left: slot.left, top: slot.top }}
          title={slot.label}
          aria-label={slot.label}
        />)}
      </div>;
    })}
  </>;
}

export function LocalModelOrbit({ models, labels, selectedModel }: { models: string[]; labels: Record<string, string>; selectedModel: string }) {
  return <ModelOrbit slots={buildModelOrbitSlots(models, labels, selectedModel)} />;
}
