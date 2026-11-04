import type { ThreadSpec, ThreadStepKind } from '@/engine/types';

export const SIZE: Record<ThreadStepKind, { w: number; h: number }> = {
  start: { w: 152, h: 54 },
  task: { w: 214, h: 88 },
  gate: { w: 214, h: 88 },
  decision: { w: 182, h: 84 },
  end: { w: 232, h: 98 },
  branch: { w: 182, h: 58 },
};

export const LANE_HEAD = 160;
const ROW_H = 110;
const GAP_X = 38;
const PAD = 10;

export interface LaneBox {
  id: string;
  label: string;
  sub?: string;
  color: string;
  y: number;
  h: number;
}

export interface ThreadLayout {
  pos: Record<string, { x: number; y: number; w: number; h: number }>;
  lanes: LaneBox[];
  width: number;
  height: number;
}

/** Swimlanes top to bottom, columns left to right; steps sharing a lane and column stack. */
export function layoutThread(spec: ThreadSpec): ThreadLayout {
  const cols = Math.max(0, ...spec.steps.map((s) => s.col)) + 1;
  const colW = Array.from({ length: cols }, (_, c) => Math.max(110, ...spec.steps.filter((s) => s.col === c).map((s) => SIZE[s.kind].w)));
  const colX: number[] = [];
  let x = LANE_HEAD + 28;
  for (let c = 0; c < cols; c++) {
    colX.push(x);
    x += colW[c] + GAP_X;
  }
  const width = x - GAP_X + 30;

  const stackIdx: Record<string, number> = {};
  const rows: Record<string, number> = {};
  for (const s of spec.steps) {
    const k = `${s.lane}|${s.col}`;
    stackIdx[s.id] = rows[k] ?? 0;
    rows[k] = (rows[k] ?? 0) + 1;
  }
  const lanes: LaneBox[] = [];
  let y = 0;
  for (const l of spec.lanes) {
    const n = Math.max(1, ...Object.entries(rows).filter(([k]) => k.startsWith(`${l.id}|`)).map(([, v]) => v));
    const h = n * ROW_H + PAD;
    lanes.push({ ...l, y, h });
    y += h;
  }
  const laneById = Object.fromEntries(lanes.map((l) => [l.id, l]));
  const pos: ThreadLayout['pos'] = {};
  for (const s of spec.steps) {
    const lane = laneById[s.lane] ?? lanes[0];
    const { w, h } = SIZE[s.kind];
    pos[s.id] = {
      x: colX[s.col] + (colW[s.col] - w) / 2,
      y: lane.y + PAD / 2 + stackIdx[s.id] * ROW_H + (ROW_H - h) / 2,
      w,
      h,
    };
  }
  return { pos, lanes, width, height: y };
}
