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
const ORBIT_COUNT = ORBIT_RADII.length;
const PERIMETER_SAMPLES = 4096;

function ellipseAngles(count: number, radiusX: number, radiusY: number): number[] {
  if (count === 0) return [];

  const step = Math.PI * 2 / PERIMETER_SAMPLES;
  const cumulative = new Float64Array(PERIMETER_SAMPLES + 1);
  let previousX = 0;
  let previousY = -radiusY;

  for (let sample = 1; sample <= PERIMETER_SAMPLES; sample += 1) {
    const angle = -Math.PI / 2 + sample * step;
    const x = radiusX * Math.cos(angle);
    const y = radiusY * Math.sin(angle);
    cumulative[sample] = cumulative[sample - 1] + Math.hypot(x - previousX, y - previousY);
    previousX = x;
    previousY = y;
  }

  const perimeter = cumulative[PERIMETER_SAMPLES];
  return Array.from({ length: count }, (_, position) => {
    const target = perimeter * position / count;
    let low = 0;
    let high = PERIMETER_SAMPLES;
    while (low + 1 < high) {
      const middle = (low + high) >> 1;
      if (cumulative[middle] < target) low = middle;
      else high = middle;
    }
    const segmentLength = cumulative[high] - cumulative[low];
    const withinSegment = segmentLength === 0 ? 0 : (target - cumulative[low]) / segmentLength;
    return -Math.PI / 2 + (low + withinSegment) * step;
  });
}

export function buildModelOrbitSlots(
  modelIds: string[],
  labels: Record<string, string>,
  selectedModel: string,
): ModelOrbitSlot[] {
  const ringCounts = Array.from({ length: ORBIT_COUNT }, (_, ring) =>
    modelIds.reduce((total, _id, index) => total + Number(index % ORBIT_COUNT === ring), 0),
  );
  const ringOffsets = Array.from({ length: ORBIT_COUNT }, () => 0);
  const angles = ORBIT_RADII.map(([radiusX, radiusY], ring) =>
    ellipseAngles(ringCounts[ring], radiusX, radiusY),
  );

  return modelIds.map((id, index) => {
    const ring = (index % ORBIT_COUNT) as ModelOrbitSlot['ring'];
    const angle = angles[ring][ringOffsets[ring]++];
    const left = 50 + Math.cos(angle) * 50;
    const top = 50 + Math.sin(angle) * 50;

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
