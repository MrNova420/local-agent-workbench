export type ScrollViewport = { scrollHeight: number; scrollTop: number; clientHeight: number };

export function isNearTranscriptEnd(viewport: ScrollViewport, threshold = 72): boolean {
  return viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < threshold;
}
