// Tiny shared value: the effects chain writes the processed-output level, the orb reads it each frame.
const K = "__jarvisRtLevel";
const g = globalThis as unknown as Record<string, number>;
export const setRealtimeLevel = (v: number) => { g[K] = v; };
export const getRealtimeLevel = (): number => g[K] ?? 0;
