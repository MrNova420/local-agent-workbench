export type ModelOrbitSlot = {
  id: string;
  label: string;
  ring: 0 | 1 | 2;
  left: string;
  top: string;
  selected: boolean;
};

const RING_RADII = [34, 41, 47] as const;

export function buildModelOrbitSlots(
  modelIds: string[],
  labels: Record<string, string>,
  selectedModel: string,
): ModelOrbitSlot[] {
  return modelIds.map((id, index) => {
    const ring = (index % RING_RADII.length) as ModelOrbitSlot['ring'];
    const angle = (index * 137.508 - 90) * Math.PI / 180;
    const radius = RING_RADII[ring];
    const left = 50 + Math.cos(angle) * radius;
    const top = 49 + Math.sin(angle) * radius * 0.68;

    return {
      id,
      label: labels[id] || id.split(/[\\/]/).filter(Boolean).at(-1) || id,
      ring,
      left: `${left}%`,
      top: `${top}%`,
      selected: id === selectedModel,
    };
  });
}
