import { Edges, Html, Line, OrbitControls, Sparkles } from '@react-three/drei';
import { Canvas, useFrame, type ThreeEvent } from '@react-three/fiber';
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as THREE from 'three';
import type { ShipPart } from '@/engine/types';
import type { PartState } from './shipState';

const BASE = '#22d3ee';
const SEV_COLOR = { ok: BASE, info: '#38bdf8', warn: '#fbbf24', crit: '#fb3b5c' };

/* ------------------------------------------------------------------ */
/* Hologram material                                                  */
/* ------------------------------------------------------------------ */

const VERT = /* glsl */ `
varying vec3 vN; varying vec3 vV; varying vec3 vW;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  vV = normalize(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const FRAG = /* glsl */ `
uniform vec3 uColor; uniform float uTime; uniform float uOpacity; uniform float uPulse;
varying vec3 vN; varying vec3 vV; varying vec3 vW;
void main() {
  float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.0);
  float scanX = mod(uTime * 2.2, 16.0) - 8.0;
  float band = exp(-pow((vW.x - scanX) * 3.0, 2.0));
  float lines = smoothstep(0.92, 1.0, sin(vW.y * 90.0 + uTime * 2.0) * 0.5 + 0.5) * 0.25;
  float pulse = 1.0 + uPulse * (0.6 + 0.6 * sin(uTime * 6.0));
  vec3 c = uColor * (0.10 + f * 1.25 + band * 0.9 + lines) * pulse;
  float a = (0.06 + f * 0.75 + band * 0.35 + lines * 0.3) * uOpacity;
  gl_FragColor = vec4(c, a);
}`;

function useHolo(color: string, opacity = 1, pulse = 0) {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color(color) }, uTime: { value: 0 }, uOpacity: { value: opacity }, uPulse: { value: pulse } },
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  useEffect(() => {
    mat.uniforms.uColor.value.set(color);
    mat.uniforms.uOpacity.value = opacity;
    mat.uniforms.uPulse.value = pulse;
  }, [color, opacity, pulse, mat]);
  useFrame(({ clock }) => {
    mat.uniforms.uTime.value = clock.elapsedTime;
  });
  return mat;
}

/* ------------------------------------------------------------------ */
/* Procedural geometry                                                */
/* ------------------------------------------------------------------ */

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const halfBeam = (u: number) => {
  if (u < 0.08) return 0.5 + 0.12 * (u / 0.08);
  if (u < 0.55) return 0.62 + 0.06 * Math.sin(((u - 0.08) / 0.47) * (Math.PI / 2));
  return 0.68 * Math.pow(1 - (u - 0.55) / 0.45, 0.62);
};
const deckY = (u: number) => 0.42 + 0.26 * Math.pow(Math.max(0, u - 0.4) / 0.6, 2.2);
const keelY = (u: number) => {
  if (u < 0.12) return -0.18 - 0.37 * (u / 0.12);
  if (u < 0.86) return -0.55;
  return -0.55 + 0.45 * Math.pow((u - 0.86) / 0.14, 1.6);
};

function buildHull() {
  const N = 64;
  const M = 18;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    const x = -5 + 10 * u;
    const hb = halfBeam(u);
    const dk = deckY(u);
    const kl = keelY(u);
    const e = 0.3 + 0.7 * smooth(0.55, 1, u);
    for (let j = 0; j <= M; j++) {
      const a = (-1 + (2 * j) / M) * (Math.PI / 2);
      const sa = Math.sin(a);
      const ca = Math.cos(a);
      const z = hb * Math.sign(sa) * Math.pow(Math.abs(sa), e);
      const y = kl + (dk - kl) * (1 - Math.pow(Math.abs(ca), 0.5 / e + 0.5));
      pos.push(x, y, z);
    }
  }
  for (let i = 0; i < N; i++)
    for (let j = 0; j < M; j++) {
      const a = i * (M + 1) + j;
      const b = a + M + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  const c = pos.length / 3;
  pos.push(-5, (deckY(0) + keelY(0)) / 2, 0);
  for (let j = 0; j < M; j++) idx.push(c, j + 1, j);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();

  const dpos: number[] = [];
  const didx: number[] = [];
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    const x = -5 + 10 * u;
    dpos.push(x, deckY(u), -halfBeam(u), x, deckY(u), halfBeam(u));
    if (i < N) {
      const a = i * 2;
      didx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const d = new THREE.BufferGeometry();
  d.setAttribute('position', new THREE.Float32BufferAttribute(dpos, 3));
  d.setIndex(didx);
  d.computeVertexNormals();
  return { hull: g, deck: d };
}

function frustum(lx: number, wz: number, h: number, taper = 0.8, seg = 4) {
  const g = new THREE.CylinderGeometry(0.7071 * taper, 0.7071, h, seg, 1);
  if (seg === 4) g.rotateY(Math.PI / 4);
  g.scale(lx, 1, wz);
  return g;
}

/* ------------------------------------------------------------------ */
/* Parts                                                              */
/* ------------------------------------------------------------------ */

type Pick = (p: ShipPart) => void;

interface PieceProps {
  geometry: THREE.BufferGeometry;
  color?: string;
  opacity?: number;
  pulse?: number;
  position?: [number, number, number];
  rotation?: [number, number, number];
  part?: ShipPart;
  onPick?: Pick;
  edges?: boolean;
  children?: ReactNode;
}

function Piece({ geometry, color = BASE, opacity = 1, pulse = 0, position, rotation, part, onPick, edges = true, children }: PieceProps) {
  const mat = useHolo(color, opacity, pulse);
  const [hover, setHover] = useState(false);
  return (
    <mesh
      geometry={geometry}
      material={mat}
      position={position}
      rotation={rotation}
      onClick={part && onPick ? (e: ThreeEvent<MouseEvent>) => (e.stopPropagation(), onPick(part)) : undefined}
      onPointerOver={part ? (e: ThreeEvent<PointerEvent>) => (e.stopPropagation(), setHover(true), (document.body.style.cursor = 'pointer')) : undefined}
      onPointerOut={part ? () => (setHover(false), (document.body.style.cursor = '')) : undefined}
    >
      {edges && <Edges threshold={18} color={hover ? '#ffffff' : color} />}
      {children}
    </mesh>
  );
}

function Glow({ geometry, color, position, rotation, blink, part, onPick }: { geometry: THREE.BufferGeometry; color: string; position: [number, number, number]; rotation?: [number, number, number]; blink?: boolean; part?: ShipPart; onPick?: Pick }) {
  const ref = useRef<THREE.MeshBasicMaterial>(null);
  const c = useMemo(() => new THREE.Color(color).multiplyScalar(2.2), [color]);
  useFrame(({ clock }) => {
    if (ref.current) ref.current.opacity = blink ? 0.45 + 0.55 * Math.abs(Math.sin(clock.elapsedTime * 3.5)) : 0.9;
  });
  return (
    <mesh
      geometry={geometry}
      position={position}
      rotation={rotation}
      onClick={part && onPick ? (e) => (e.stopPropagation(), onPick(part)) : undefined}
      onPointerOver={part ? () => (document.body.style.cursor = 'pointer') : undefined}
      onPointerOut={part ? () => (document.body.style.cursor = '') : undefined}
    >
      <meshBasicMaterial ref={ref} color={c} transparent toneMapped={false} side={THREE.DoubleSide} />
    </mesh>
  );
}

const PART_POS: Partial<Record<ShipPart, [number, number, number]>> = {
  spy_a: [1.85, 1.25, 0.5],
  spy_b: [0.75, 1.25, 0.5],
  spy_c: [0.75, 1.25, -0.5],
  spy_d: [1.85, 1.25, -0.5],
  aegis: [1.3, 1.9, 0],
  vls: [2.75, 0.62, 0],
  gun: [3.55, 0.8, 0],
  ciws: [2.05, 1.75, 0],
  sonar: [3.9, -0.65, 0],
  helo: [-4.2, 0.75, 0],
  gtm: [0.1, -0.15, 0],
  ssgtg: [-1.3, -0.15, 0],
  steering: [-4.7, -0.4, 0],
  nav: [1.1, 2.6, 0],
  link16: [1.05, 2.35, 0.2],
  satcom: [0.9, 2.15, -0.25],
  ew: [1.3, 1.25, 0.62],
  spq9: [1.1, 2.75, 0],
  svtt: [-0.9, 0.6, 0.55],
  ssm: [-0.55, 0.62, 0],
};

function stateColor(s?: PartState, selected?: boolean) {
  if (!s) return BASE;
  if (!s.up || s.flagged) return SEV_COLOR[s.sev];
  return selected ? '#a5f3fc' : BASE;
}

function Ship({ parts, selected, onPick }: { parts: Partial<Record<ShipPart, PartState>>; selected: Set<ShipPart>; onPick: Pick }) {
  const group = useRef<THREE.Group>(null);
  const { hull, deck } = useMemo(buildHull, []);
  const geo = useMemo(
    () => ({
      deckhouse: frustum(1.7, 1.15, 0.85, 0.78),
      bridge: frustum(0.9, 0.9, 0.35, 0.85),
      mast: frustum(0.35, 0.35, 1.1, 0.35),
      stack: frustum(0.55, 0.6, 0.6, 0.75),
      hangar: frustum(1.4, 1.05, 0.55, 0.85),
      turret: new THREE.CylinderGeometry(0.16, 0.24, 0.22, 6),
      barrel: new THREE.CylinderGeometry(0.025, 0.035, 0.9, 8),
      octagon: new THREE.CircleGeometry(0.27, 8),
      vls: new THREE.BoxGeometry(0.62, 0.05, 0.5),
      ciws: new THREE.CylinderGeometry(0.07, 0.09, 0.22, 10),
      dome: new THREE.SphereGeometry(0.11, 16, 12),
      sonar: new THREE.SphereGeometry(0.5, 24, 16).scale(1, 0.38, 0.4),
      gtm: new THREE.CylinderGeometry(0.09, 0.09, 0.45, 12).rotateZ(Math.PI / 2),
      ssgtg: new THREE.BoxGeometry(0.28, 0.16, 0.16),
      rudder: new THREE.BoxGeometry(0.28, 0.32, 0.03),
      yard: new THREE.BoxGeometry(0.04, 0.03, 1.0),
      helo: new THREE.CapsuleGeometry(0.1, 0.55, 4, 10).rotateZ(Math.PI / 2),
      rotor: new THREE.CylinderGeometry(0.42, 0.42, 0.01, 32),
      pad: new THREE.RingGeometry(0.34, 0.37, 48).rotateX(-Math.PI / 2),
      box: new THREE.BoxGeometry(0.4, 0.12, 0.12),
      ew: new THREE.BoxGeometry(0.25, 0.18, 0.04),
    }),
    [],
  );

  useFrame(({ clock }) => {
    if (!group.current) return;
    const t = clock.elapsedTime;
    group.current.position.y = Math.sin(t * 0.8) * 0.035;
    group.current.rotation.x = Math.sin(t * 0.6) * 0.012;
    group.current.rotation.z = Math.sin(t * 0.45) * 0.008;
  });

  const P = (p: ShipPart) => parts[p];
  const col = (p: ShipPart) => stateColor(P(p), selected.has(p));
  const pulse = (p: ShipPart) => (P(p) && !P(p)!.up ? 1 : 0);
  const spyRot = (yaw: number): [number, number, number] => [0, yaw, 0];
  const heloUp = P('helo')?.up ?? true;

  return (
    <group ref={group}>
      <Piece geometry={hull} opacity={0.75} />
      <Piece geometry={deck} opacity={0.25} edges={false} />

      <Piece geometry={geo.deckhouse} position={[1.3, 0.62 + 0.42, 0]} color={col('aegis')} part="aegis" onPick={onPick} />
      <Piece geometry={geo.bridge} position={[1.45, 1.62, 0]} color={col('aegis')} part="aegis" onPick={onPick} />
      <Piece geometry={geo.mast} position={[1.1, 2.15, 0]} color={col('nav')} part="nav" onPick={onPick} />
      <Piece geometry={geo.yard} position={[1.1, 2.4, 0]} color={col('link16')} part="link16" onPick={onPick} />
      <Piece geometry={geo.dome} position={[1.1, 2.78, 0]} color={col('spq9')} part="spq9" onPick={onPick} />
      <Piece geometry={geo.dome} position={[0.9, 2.12, -0.28]} color={col('satcom')} part="satcom" onPick={onPick} />
      <Piece geometry={geo.dome} position={[0.9, 2.12, 0.28]} color={col('satcom')} part="satcom" onPick={onPick} />

      {(
        [
          ['spy_a', [1.86, 1.2, 0.47], -Math.PI / 4 + Math.PI / 2],
          ['spy_d', [1.86, 1.2, -0.47], Math.PI / 4 + Math.PI / 2],
          ['spy_b', [0.74, 1.2, 0.47], -Math.PI / 4 - Math.PI / 2 + Math.PI],
          ['spy_c', [0.74, 1.2, -0.47], Math.PI / 4 - Math.PI / 2],
        ] as [ShipPart, [number, number, number], number][]
      ).map(([p, pos, yaw]) => (
        <group key={p} position={pos} rotation={spyRot(yaw)}>
          <group rotation={[0, 0, Math.PI / 8]}>
            <Glow geometry={geo.octagon} color={col(p)} position={[0, 0, 0]} blink={pulse(p) > 0} part={p} onPick={onPick} />
          </group>
        </group>
      ))}

      <Glow geometry={geo.ew} color={col('ew')} position={[1.3, 1.0, 0.6]} part="ew" onPick={onPick} />
      <Glow geometry={geo.ew} color={col('ew')} position={[1.3, 1.0, -0.6]} part="ew" onPick={onPick} />

      <Piece geometry={geo.stack} position={[0.05, 0.62 + 0.3, 0]} />
      <Piece geometry={geo.stack} position={[-1.05, 0.62 + 0.3, 0]} />
      <Piece geometry={geo.hangar} position={[-2.65, 0.5 + 0.27, 0]} />
      <Piece geometry={geo.box} position={[-0.55, 0.55, 0.25]} color={col('ssm')} part="ssm" onPick={onPick} />
      <Piece geometry={geo.box} position={[-0.55, 0.55, -0.25]} color={col('ssm')} part="ssm" onPick={onPick} />
      <Piece geometry={geo.box} position={[-0.9, 0.55, 0.5]} rotation={[0, 0, 0]} color={col('svtt')} part="svtt" onPick={onPick} />

      <Piece geometry={geo.turret} position={[3.55, 0.68, 0]} color={col('gun')} part="gun" onPick={onPick} pulse={pulse('gun')} />
      <Piece geometry={geo.barrel} position={[4.0, 0.72, 0]} rotation={[0, 0, Math.PI / 2 - 0.08]} color={col('gun')} part="gun" onPick={onPick} />
      <Piece geometry={geo.vls} position={[2.75, 0.6, 0]} color={col('vls')} part="vls" onPick={onPick} />
      <Piece geometry={geo.vls} position={[-1.75, 0.47, 0]} color={col('vls')} part="vls" onPick={onPick} />

      <Piece geometry={geo.ciws} position={[2.1, 1.6, 0]} color={col('ciws')} part="ciws" onPick={onPick} />
      <Piece geometry={geo.dome} position={[2.1, 1.75, 0]} color={col('ciws')} part="ciws" onPick={onPick} />
      <Piece geometry={geo.ciws} position={[-3.1, 1.15, 0]} color={col('ciws')} part="ciws" onPick={onPick} />

      <Piece geometry={geo.sonar} position={[3.9, -0.62, 0]} color={col('sonar')} part="sonar" onPick={onPick} pulse={pulse('sonar')} />
      {[-0.25, 0.25].map((z) => (
        <Piece key={z} geometry={geo.rudder} position={[-4.6, -0.42, z]} color={col('steering')} part="steering" onPick={onPick} />
      ))}

      {[-0.25, 0.05, 0.35, 0.65].map((x, i) => (
        <Glow key={x} geometry={geo.gtm} color={col('gtm')} position={[x, -0.2, i % 2 ? 0.18 : -0.18]} part="gtm" onPick={onPick} blink={pulse('gtm') > 0} />
      ))}
      {[-1.6, -1.25, -0.9].map((x, i) => {
        const s = P('ssgtg');
        const isTwo = i === 1 && s && (s.partial || !s.up);
        return <Glow key={x} geometry={geo.ssgtg} color={isTwo ? SEV_COLOR.warn : BASE} position={[x, -0.2, 0]} part="ssgtg" onPick={onPick} blink={!!isTwo} />;
      })}

      <Piece geometry={geo.pad} position={[-4.15, 0.44, 0]} color={col('helo')} edges={false} />
      <group position={[-4.15, 0.62, 0]}>
        <Piece geometry={geo.helo} color={col('helo')} opacity={heloUp ? 1 : 0.25} part="helo" onPick={onPick} />
        <Rotor geometry={geo.rotor} color={col('helo')} spinning={heloUp} />
      </group>
    </group>
  );
}

function Rotor({ geometry, color, spinning }: { geometry: THREE.BufferGeometry; color: string; spinning: boolean }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((_, dt) => {
    if (ref.current && spinning) ref.current.rotation.y += dt * 9;
  });
  const mat = useHolo(color, spinning ? 0.5 : 0.15);
  return <mesh ref={ref} geometry={geometry} material={mat} position={[0, 0.16, 0]} />;
}

function Ocean() {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: { uTime: { value: 0 } },
        vertexShader: `varying vec2 vUv; varying vec3 vW; void main(){ vUv=uv; vec4 w=modelMatrix*vec4(position,1.); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`,
        fragmentShader: `uniform float uTime; varying vec3 vW;
          void main(){
            vec2 p = vW.xz;
            vec2 g = abs(fract(p*1.0 - 0.5) - 0.5) / fwidth(p*1.0);
            float line = 1.0 - min(min(g.x, g.y), 1.0);
            float d = length(p);
            float ring = smoothstep(0.06, 0.0, abs(fract(d*0.25 - uTime*0.25) - 0.5) - 0.44);
            float fade = smoothstep(11.0, 1.5, d);
            vec3 c = vec3(0.10, 0.62, 0.75);
            float a = (line*0.06 + ring*0.10) * fade;
            gl_FragColor = vec4(c*(0.6+ring), a);
          }`,
      }),
    [],
  );
  useFrame(({ clock }) => {
    mat.uniforms.uTime.value = clock.elapsedTime;
  });
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} material={mat}>
      <planeGeometry args={[40, 40, 1, 1]} />
    </mesh>
  );
}

function Projector() {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.y += dt * 0.25;
  });
  return (
    <group ref={ref} position={[0, -0.9, 0]}>
      {[5.6, 6.0, 6.8].map((r, i) => (
        <mesh key={r} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[r, r + (i === 1 ? 0.06 : 0.015), 128, 1, 0, i === 1 ? Math.PI * 1.4 : Math.PI * 2]} />
          <meshBasicMaterial color={new THREE.Color('#22d3ee').multiplyScalar(1.6)} transparent opacity={i === 1 ? 0.5 : 0.25} toneMapped={false} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </group>
  );
}

function Callouts({ parts, focus }: { parts: Partial<Record<ShipPart, PartState>>; focus: Set<ShipPart>; }) {
  const shown = (Object.values(parts) as PartState[]).filter((p) => (!p.up || p.flagged || focus.has(p.part)) && PART_POS[p.part] && p.part !== 'crew');
  return (
    <>
      {shown.slice(0, 6).map((p, i) => {
        const pos = PART_POS[p.part]!;
        const side = i % 2 ? -1 : 1;
        const tip: [number, number, number] = [pos[0] + 0.4 * side, pos[1] + 1.1 + (i % 3) * 0.35, pos[2] + 0.9 * side];
        const color = p.up && !p.flagged ? '#67e8f9' : SEV_COLOR[p.sev];
        return (
          <group key={p.part}>
            <Line points={[pos, tip]} color={color} lineWidth={1} transparent opacity={0.8} dashed dashSize={0.06} gapSize={0.04} />
            <Html position={tip} center distanceFactor={9} zIndexRange={[10, 0]}>
              <div className="pointer-events-none whitespace-nowrap rounded-[2px] border bg-[#020a12]/85 px-2 py-1 backdrop-blur" style={{ borderColor: `${color}88`, boxShadow: `0 0 18px -4px ${color}` }}>
                <div className="font-display text-[11px] font-semibold uppercase tracking-[0.12em]" style={{ color }}>
                  {p.label}
                </div>
                <div className="font-mono text-[10px] text-sky-100/80">
                  {p.up ? (p.flagged ? 'DATA FLAG' : 'UP') : p.partial ? 'REDUNDANCY LOST' : p.part === 'helo' ? 'NOT EMBARKED' : 'DOWN'}
                  {!p.up && !p.partial && p.etaLabel ? ` · ${p.etaLabel}` : ''}
                </div>
              </div>
            </Html>
          </group>
        );
      })}
    </>
  );
}

export function HoloShip({
  parts,
  focus,
  onPick,
  autoRotate = true,
}: {
  parts: Partial<Record<ShipPart, PartState>>;
  focus: Set<ShipPart>;
  onPick: Pick;
  autoRotate?: boolean;
}) {
  return (
    <Canvas camera={{ position: [6.4, 3.5, 7.2], fov: 34 }} dpr={[1, 2]} gl={{ antialias: true, alpha: true }} onPointerMissed={() => (document.body.style.cursor = '')}>
      <fog attach="fog" args={['#02060c', 12, 30]} />
      <group position={[0, -0.4, 0]}>
        <Ship parts={parts} selected={focus} onPick={onPick} />
        <Callouts parts={parts} focus={focus} />
        <Ocean />
        <Projector />
        <Sparkles count={70} scale={[14, 4, 8]} size={1.6} speed={0.25} color="#67e8f9" opacity={0.5} position={[0, 1.5, 0]} />
      </group>
      <OrbitControls enablePan={false} minDistance={6} maxDistance={18} maxPolarAngle={Math.PI / 2.05} autoRotate={autoRotate} autoRotateSpeed={0.45} enableDamping target={[0, 0.3, 0]} />
      <EffectComposer>
        <Bloom intensity={0.85} luminanceThreshold={0.22} luminanceSmoothing={0.35} mipmapBlur />
        <Vignette eskil={false} offset={0.2} darkness={0.75} />
      </EffectComposer>
    </Canvas>
  );
}
