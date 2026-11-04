import '@xyflow/react/dist/style.css';
import { Background, BackgroundVariant, Controls, MiniMap, ReactFlow, ReactFlowProvider, useReactFlow, type Edge, type Node } from '@xyflow/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Crosshair, Network, Share2 } from 'lucide-react';
import { fmtDur, fmtT } from '@/engine/time';
import { useEngine } from '@/state/engine';
import { useStore } from '@/state/store';
import { Pill, StatusBadge, Ticker } from '@/components/ui';
import { cn, STATUS_COLOR } from '@/lib/util';
import { FlowEdge, NavNode } from '@/features/graph/GraphNode';
import { Inspector } from '@/features/graph/Inspector';
import { buildGraph, type GEdgeData, type GNodeData } from '@/features/graph/layout';
import { useConeSlack } from '@/features/graph/hooks';

const nodeTypes = { navifi: NavNode };
const edgeTypes = { flow: FlowEdge };

function CapTabs({ mode, setMode }: { mode: 'cone' | 'full'; setMode: (m: 'cone' | 'full') => void }) {
  const { result } = useEngine();
  const selected = useStore((s) => s.selectedCap);
  const select = useStore((s) => s.selectCap);
  const selectNode = useStore((s) => s.selectNode);
  return (
    <div className="hud flex shrink-0 items-center gap-2 px-3 py-2">
      <div className="mr-2 flex items-center gap-2">
        <Network size={16} className="text-calc" />
        <div>
          <div className="label !text-[9px] !text-calc/80">Mission engineering</div>
          <div className="font-display text-[14px] font-bold tracking-[0.18em] text-white">CONSEQUENCE GRAPH</div>
        </div>
      </div>
      <div className="flex gap-1.5">
        {result.capabilities.map((c) => {
          const on = c.id === selected;
          const col = STATUS_COLOR[c.status];
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                select(c.id);
                selectNode(null);
              }}
              className={cn(
                'flex items-center gap-2 rounded-[3px] border px-2.5 py-1 transition',
                on ? 'bg-calc/[0.08]' : 'border-sky-300/10 bg-black/20 hover:border-sky-300/30',
              )}
              style={on ? { borderColor: `${col}aa`, boxShadow: `0 0 20px -6px ${col}` } : undefined}
            >
              <StatusBadge status={c.status} size="sm" />
              <span className="font-display text-[13px] font-bold tracking-[0.14em] text-white">{c.code}</span>
              <span className="font-mono text-[10px]" style={{ color: col }}>
                {c.margin >= 0 ? fmtDur(c.margin) : `−${fmtDur(-c.margin)}`}
              </span>
            </button>
          );
        })}
      </div>
      <div className="ml-auto flex overflow-hidden rounded-[3px] border border-sky-300/20">
        {(
          [
            ['cone', 'Capability cone', Crosshair],
            ['full', 'Whole ship', Share2],
          ] as const
        ).map(([m, label, Icon]) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={cn('flex items-center gap-1.5 px-3 py-1.5 font-display text-[10.5px] font-semibold uppercase tracking-[0.14em] transition', mode === m ? 'bg-calc/15 text-calc' : 'text-mute hover:text-sky-100')}
          >
            <Icon size={12} />
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Canvas({ mode, slackKey }: { mode: 'cone' | 'full'; slackKey: string }) {
  const { nodes, result, cap, scenario, whatIfActive, plannedActive } = useEngine();
  const selectedNode = useStore((s) => s.selectedNode);
  const selectNode = useStore((s) => s.selectNode);
  const selectCap = useStore((s) => s.selectCap);
  const slack = useConeSlack(cap?.id);
  const rf = useReactFlow();
  const chainColor = cap ? STATUS_COLOR[cap.status] : '#22d3ee';
  const focusId = selectedNode && nodes[selectedNode] ? selectedNode : (cap?.controlling.nodeId ?? null);

  const graph = useMemo(
    () => buildGraph(nodes, result, cap, mode, focusId, slack, chainColor),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nodes, result, cap?.id, cap?.status, cap?.chain.join(), mode, focusId, slack, chainColor],
  );

  const layoutKey = `${cap?.id}|${mode}|${graph.nodes.length}|${slackKey}`;
  const stage = useRef<HTMLElement>(null);
  useEffect(() => {
    const t = setTimeout(() => rf.fitView({ padding: 0.08, duration: 700 }), 60);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutKey]);
  useEffect(() => {
    if (!stage.current) return;
    let t: ReturnType<typeof setTimeout>;
    const ro = new ResizeObserver(() => {
      clearTimeout(t);
      t = setTimeout(() => rf.fitView({ padding: 0.08, duration: 300 }), 120);
    });
    ro.observe(stage.current);
    return () => {
      ro.disconnect();
      clearTimeout(t);
    };
  }, [rf]);

  const chainLen = cap?.chain.length ?? 0;
  const inputs = Object.keys(slack).length;
  const withSlack = Object.values(slack).filter((s) => s.noImpact > 1 / 60).length;

  return (
    <section ref={stage} className="hud relative min-h-0 min-w-0 overflow-hidden">
      <ReactFlow<Node<GNodeData>, Edge<GEdgeData>>
        nodes={graph.nodes}
        edges={graph.edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={(_, n) => {
          selectNode(n.id);
          if (nodes[n.id]?.kind === 'capability') selectCap(n.id);
        }}
        onPaneClick={() => selectNode(null)}
        nodesConnectable={false}
        nodesDraggable={false}
        minZoom={0.15}
        maxZoom={1.8}
        proOptions={{ hideAttribution: true }}
        fitView
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="rgba(56,189,248,0.18)" />
        <Controls showInteractive={false} position="bottom-right" />
        <MiniMap
          position="top-right"
          pannable
          zoomable
          maskColor="rgba(2,6,12,0.75)"
          nodeColor={(n) => {
            const d = n.data as GNodeData;
            return d.role === 'chain' ? chainColor : d.role === 'cocrit' ? '#fbbf24' : d.role === 'off' ? '#0e2235' : '#1e4a63';
          }}
          nodeStrokeWidth={0}
          style={{ width: 170, height: 110 }}
        />
      </ReactFlow>

      {cap && (
        <div className="pointer-events-none absolute left-4 top-3 max-w-[560px]">
          <div className="flex items-center gap-3">
            <StatusBadge status={cap.status} size="xl" pulse />
            <div>
              <div className="label !text-[9px]">
                {cap.code} · {cap.label}
              </div>
              <div className="flex items-baseline gap-2 font-mono">
                <span className="text-[11px] text-mute">margin</span>
                <Ticker
                  value={cap.margin}
                  format={(v) => (v >= 0 ? fmtDur(v) : `−${fmtDur(-v)}`)}
                  className="font-display text-[30px] font-bold leading-none"
                />
              </div>
              <div className="font-mono text-[10.5px] text-sky-200/60">
                ready {cap.upNow ? 'now' : fmtT(scenario, cap.ready)} · required {fmtT(scenario, cap.requiredBy)}
              </div>
            </div>
          </div>
          <div className="mt-2 inline-flex items-center gap-2 rounded-[3px] border bg-black/50 px-2 py-1" style={{ borderColor: `${chainColor}66` }}>
            <span className="label !text-[9px]" style={{ color: chainColor }}>
              Controlling constraint
            </span>
            <span className="font-mono text-[11px] text-white">{cap.controlling.label}</span>
            <span className="font-mono text-[9.5px] uppercase text-mute">{cap.controlling.kind}</span>
          </div>
        </div>
      )}

      {(whatIfActive || plannedActive) && (
        <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2">
          <Pill color="#a78bfa" className="animate-pulse">
            {whatIfActive ? 'What-if sandbox active' : 'Approved planning assumptions applied'}
          </Pill>
        </div>
      )}

      <div className="pointer-events-none absolute bottom-3 left-4 space-y-2">
        <div className="flex gap-4 font-mono text-[10.5px]">
          <span>
            <span className="text-white">{chainLen}</span> <span className="text-mute">nodes on critical chain</span>
          </span>
          <span>
            <span className="text-unc">{cap?.coCritical.length ?? 0}</span> <span className="text-mute">co-critical</span>
          </span>
          <span>
            <span className="text-calc">
              {withSlack}/{inputs}
            </span>{' '}
            <span className="text-mute">inputs with upstream slack</span>
          </span>
        </div>
        <div className="flex items-center gap-4 font-mono text-[9.5px] uppercase tracking-wider text-mute">
          <span className="flex items-center gap-1.5">
            <i className="h-[3px] w-6 rounded" style={{ background: chainColor, boxShadow: `0 0 8px ${chainColor}` }} />
            critical chain
          </span>
          <span className="flex items-center gap-1.5">
            <i className="h-0 w-6 border-t-2 border-dashed border-unc" />
            co-critical
          </span>
          <span className="flex items-center gap-1.5">
            <i className="h-0 w-6 border-t border-dashed border-[#c084fc]" />
            crew pool
          </span>
          <span className="flex items-center gap-1.5">
            <i className="rounded-[2px] border border-calc/40 bg-calc/10 px-1 text-calc normal-case">+2d slack</i>
            absorbs slip
          </span>
        </div>
      </div>
    </section>
  );
}

export default function GraphView() {
  const [mode, setMode] = useState<'cone' | 'full'>('cone');
  const { cap, nodes } = useEngine();
  const selectedNode = useStore((s) => s.selectedNode);
  const slack = useConeSlack(cap?.id);
  const focusId = selectedNode && nodes[selectedNode] ? selectedNode : (cap?.controlling.nodeId ?? null);
  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <CapTabs mode={mode} setMode={setMode} />
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_430px] gap-3">
        <ReactFlowProvider>
          <Canvas mode={mode} slackKey={cap?.id ?? ''} />
        </ReactFlowProvider>
        <Inspector nodeId={focusId} slack={slack} />
      </div>
    </div>
  );
}
