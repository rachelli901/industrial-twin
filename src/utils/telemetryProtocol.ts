export const agvStatuses = ['NAVIGATING', 'PICKING', 'DELIVERING', 'IDLE', 'ALARM', 'CHARGING'] as const;
export type Pose = {
  id: string; position: { x: number; z: number }; heading: number;
  battery?: number; speed?: number; status?: typeof agvStatuses[number];
  metrics?: { motorTemp?: number; vibration?: number; mileage?: number; healthScore?: number };
};
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
export function parsePose(v: unknown): Pose | null {
  if (!record(v) || !['AGV_01', 'AGV_02'].includes(String(v.id)) || !record(v.position) ||
      !finite(v.position.x) || !finite(v.position.z) || !finite(v.heading) ||
      Math.abs(v.position.x) > 10000 || Math.abs(v.position.z) > 10000) return null;
  if (v.battery !== undefined && (!finite(v.battery) || v.battery < 0 || v.battery > 100)) return null;
  if (v.speed !== undefined && (!finite(v.speed) || v.speed < 0 || v.speed > 100)) return null;
  if (v.status !== undefined && !agvStatuses.includes(v.status as typeof agvStatuses[number])) return null;
  const pose: Pose = { id: String(v.id), position: { x: v.position.x, z: v.position.z }, heading: v.heading };
  if (v.battery !== undefined) pose.battery = v.battery as number;
  if (v.speed !== undefined) pose.speed = v.speed as number;
  if (v.status !== undefined) pose.status = v.status as Pose['status'];
  if (v.metrics !== undefined) {
    if (!record(v.metrics)) return null;
    pose.metrics = {};
    for (const key of ['motorTemp', 'vibration', 'mileage', 'healthScore'] as const) {
      const value = v.metrics[key];
      if (value !== undefined) {
        if (!finite(value) || (key !== 'motorTemp' && value < 0) || (key === 'healthScore' && value > 100)) return null;
        pose.metrics[key] = value;
      }
    }
  }
  return pose;
}
export function parseSlot(v: unknown): { id: string; status: 'EMPTY' | 'OCCUPIED' | 'PICKING' } | null {
  if (!record(v) || typeof v.id !== 'string' || !/^LOC-[1-3]-[1-4]$/.test(v.id) ||
      !['EMPTY', 'OCCUPIED', 'PICKING'].includes(String(v.status))) return null;
  return { id: v.id, status: v.status as 'EMPTY' | 'OCCUPIED' | 'PICKING' };
}
