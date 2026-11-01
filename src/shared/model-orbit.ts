export type ModelOrbitSlot = {
  id: string;
  label: string;
  ring: 0 | 1 | 2;
  left: string;
  top: string;
  selected: boolean;
};

const ORBIT_RADII = [
  [114.5, 114.5],
  [152.5, 91.5],
  [91.5, 152.5],
] as const;

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function buildModelOrbitSlots(
  modelIds: string[],
  labels: Record<string, string>,
  selectedModel: string,
): ModelOrbitSlot[] {
  // A marker is keyed to the installed model identity, not the catalog's array
  // position. The same inventory therefore keeps its layout across refreshes
  // and app restarts, while new/removed models cannot create fake placeholders.
  const uniqueIds = [...new Set(modelIds.filter((id) => typeof id === 'string' && id.trim()))];

  return uniqueIds.map((id) => {
    const hash = stableHash(id);
    const ring = (hash % ORBIT_RADII.length) as ModelOrbitSlot['ring'];
    const angle = ((hash / 0x1_0000_0000) * Math.PI * 2) - Math.PI / 2;
    const label = labels[id] || id.split(/[\\/]/).filter(Boolean).at(-1) || id;
    return {
      id,
      label,
      ring,
      left: `${50 + Math.cos(angle) * 50}%`,
      top: `${50 + Math.sin(angle) * 50}%`,
      selected: id === selectedModel,
    };
  }).sort((left, right) => left.id.localeCompare(right.id));
}
