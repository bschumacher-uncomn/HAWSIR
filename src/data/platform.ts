export interface StackLayer {
  id: string;
  name: string;
  sub: string;
  color: string;
  chips: { label: string; note?: string }[];
}

export const STACK: StackLayer[] = [
  {
    id: 'app',
    name: 'NAVIFI',
    sub: 'Mission consequence engine · namespace navifi',
    color: '#22d3ee',
    chips: [{ label: 'navifi-web', note: 'static UI' }, { label: 'navifi-edge', note: 'engine API + audit' }, { label: 'vllm-narrator', note: 'optional, in-cluster' }, { label: 'audit-pvc', note: 'append-only' }],
  },
  {
    id: 'uds',
    name: 'UDS CORE',
    sub: 'Defense Unicorns secure runtime',
    color: '#2dd4bf',
    chips: [{ label: 'Istio', note: 'mTLS everywhere' }, { label: 'Keycloak', note: 'CAC / SSO' }, { label: 'Pepr', note: 'admission policy' }, { label: 'NeuVector', note: 'runtime security' }, { label: 'Loki + Prometheus', note: 'logs, metrics' }, { label: 'Velero', note: 'backup' }],
  },
  {
    id: 'rke2',
    name: 'RKE2',
    sub: 'CIS-hardened Kubernetes · FIPS crypto · SELinux',
    color: '#60a5fa',
    chips: [{ label: 'edge-01', note: 'control + worker' }, { label: 'edge-02', note: 'worker' }, { label: 'edge-03', note: 'worker' }, { label: 'local registry', note: 'Zarf seeded' }],
  },
  {
    id: 'rhel',
    name: 'RHEL 9',
    sub: 'DISA STIG · FIPS 140-3 mode · SELinux enforcing',
    color: '#f87171',
    chips: [{ label: 'STIG profile', note: 'OpenSCAP' }, { label: 'FIPS mode', note: 'kernel + OpenSSL' }, { label: 'auditd', note: 'shipped to Loki' }, { label: 'LUKS', note: 'disk encryption' }],
  },
];

export type StageKind = 'source' | 'ai' | 'human' | 'test' | 'security' | 'build' | 'supply' | 'compliance' | 'deploy';

export interface Stage {
  id: string;
  name: string;
  tool: string;
  kind: StageKind;
  result: string;
  secs: number;
}

export const PIPELINE: Stage[] = [
  { id: 'commit', name: 'Signed commit', tool: 'git + gitsign', kind: 'source', result: 'verified signature', secs: 1 },
  { id: 'ai', name: 'AI code review', tool: 'ci/ai-review.mjs → in-cluster LLM', kind: 'ai', result: '2 suggestions · 0 blocking', secs: 38 },
  { id: 'human', name: 'Human approval', tool: 'two-person rule', kind: 'human', result: 'approved · reviewer of record', secs: 0 },
  { id: 'test', name: 'Engine tests', tool: 'vitest', kind: 'test', result: '39 / 39 pass', secs: 3 },
  { id: 'types', name: 'Typecheck + lint', tool: 'tsc --strict', kind: 'test', result: '0 errors', secs: 11 },
  { id: 'sast', name: 'Static analysis', tool: 'Semgrep', kind: 'security', result: '0 high · 0 critical', secs: 22 },
  { id: 'build', name: 'Hardened image', tool: 'Iron Bank UBI9 base · non-root', kind: 'build', result: 'navifi:0.10.0', secs: 64 },
  { id: 'sbom', name: 'SBOM', tool: 'Syft (SPDX + CycloneDX)', kind: 'supply', result: '412 components', secs: 7 },
  { id: 'cve', name: 'CVE scan', tool: 'Grype', kind: 'security', result: '0 critical · 0 high', secs: 14 },
  { id: 'sign', name: 'Sign + attest', tool: 'cosign (keyless)', kind: 'supply', result: 'signature + SBOM attestation', secs: 4 },
  { id: 'lula', name: 'Compliance check', tool: 'Lula → OSCAL', kind: 'compliance', result: '47 / 48 controls satisfied', secs: 9 },
  { id: 'zarf', name: 'Air-gap package', tool: 'Zarf + UDS bundle', kind: 'deploy', result: 'navifi-0.10.0.tar.zst', secs: 41 },
  { id: 'ship', name: 'Deploy to hull', tool: 'uds deploy · sneakernet or DDIL', kind: 'deploy', result: 'DDG-170 healthy', secs: 95 },
];

export interface Control {
  id: string;
  family: string;
  title: string;
  satisfied: boolean;
  by: string;
}

export const CONTROLS: Control[] = [
  ...[
    ['AC-2', 'Account management', 'Keycloak'],
    ['AC-3', 'Access enforcement', 'Istio AuthorizationPolicy'],
    ['AC-4', 'Information flow enforcement', 'Istio + NetworkPolicy'],
    ['AC-6', 'Least privilege', 'Pepr: non-root, no privilege escalation'],
    ['AC-17', 'Remote access', 'Keycloak + Istio ingress'],
    ['AU-2', 'Event logging', 'NAVIFI audit chain + auditd'],
    ['AU-3', 'Content of audit records', 'NAVIFI audit schema'],
    ['AU-6', 'Audit review', 'Decision log UI + Grafana'],
    ['AU-9', 'Protection of audit information', 'SHA-256 hash chain, edge copy'],
    ['AU-10', 'Non-repudiation', 'Hash chain + reviewer of record'],
    ['AU-11', 'Audit record retention', 'Loki retention + PVC'],
    ['AU-12', 'Audit record generation', 'navifi-edge'],
    ['CM-2', 'Baseline configuration', 'Zarf package + Helm values'],
    ['CM-3', 'Change control', 'Signed commits, two-person rule'],
    ['CM-6', 'Configuration settings', 'RHEL STIG + RKE2 CIS'],
    ['CM-7', 'Least functionality', 'Distroless-style UBI9 minimal'],
    ['CM-8', 'Component inventory', 'Syft SBOM'],
    ['CM-14', 'Signed components', 'cosign'],
    ['CP-9', 'System backup', 'Velero'],
    ['CP-10', 'Recovery and reconstitution', 'Velero + Zarf redeploy'],
    ['IA-2', 'Identification and authentication', 'Keycloak (CAC)'],
    ['IA-5', 'Authenticator management', 'Keycloak'],
    ['IA-7', 'Cryptographic module authentication', 'FIPS mode'],
    ['IR-4', 'Incident handling', 'NeuVector alerts → Loki'],
    ['RA-5', 'Vulnerability scanning', 'Grype in CI, NeuVector at runtime'],
    ['SA-10', 'Developer configuration management', 'Git + signed tags'],
    ['SA-11', 'Developer testing', 'vitest + failure-case matrix'],
    ['SA-15', 'Development process', 'AI review + human gate'],
    ['SC-5', 'Denial-of-service protection', 'Istio rate limits'],
    ['SC-7', 'Boundary protection', 'Istio gateways, default-deny'],
    ['SC-8', 'Transmission confidentiality', 'Istio mTLS'],
    ['SC-12', 'Key management', 'Istio CA + cosign'],
    ['SC-13', 'Cryptographic protection', 'FIPS 140-3 modules'],
    ['SC-23', 'Session authenticity', 'Istio mTLS'],
    ['SC-39', 'Process isolation', 'Containers + SELinux'],
    ['SI-2', 'Flaw remediation', 'Renovate + Grype gates'],
    ['SI-3', 'Malicious code protection', 'NeuVector'],
    ['SI-4', 'System monitoring', 'Prometheus + NeuVector'],
    ['SI-7', 'Software integrity', 'cosign verify at admission (Pepr)'],
    ['SI-10', 'Input validation', 'Engine flags malformed records'],
    ['SI-11', 'Error handling', 'Failure-case matrix'],
    ['SR-3', 'Supply chain controls', 'Iron Bank base images'],
    ['SR-4', 'Provenance', 'SBOM + SLSA attestation'],
    ['SR-11', 'Component authenticity', 'cosign'],
    ['PL-8', 'Security architecture', 'docs/ARCHITECTURE.md'],
    ['PM-5', 'System inventory', 'UDS bundle manifest'],
    ['CA-7', 'Continuous monitoring', 'Lula in CI'],
  ].map(([id, title, by]) => ({ id, family: id.split('-')[0], title, satisfied: true, by })),
  { id: 'SC-28', family: 'SC', title: 'Protection of information at rest', satisfied: false, by: 'Open: audit PVC on LUKS verified per hull at install' },
];

export interface Hull {
  hull: string;
  cls: string;
  state: 'live' | 'staged' | 'syncing' | 'pending';
  version?: string;
}

/** Synthetic fleet: fictional hull numbers, illustrative rollout states. */
export const HULLS: Hull[] = [
  { hull: 'DDG-170', cls: 'DDG Flt III', state: 'live', version: '0.10.0' },
  { hull: 'DDG-171', cls: 'DDG Flt III', state: 'live', version: '0.10.0' },
  { hull: 'DDG-172', cls: 'DDG Flt IIA', state: 'syncing', version: '0.9.2 → 0.10.0' },
  { hull: 'DDG-173', cls: 'DDG Flt IIA', state: 'live', version: '0.10.0' },
  { hull: 'DDG-174', cls: 'DDG Flt IIA', state: 'staged', version: '0.10.0 · awaits port' },
  { hull: 'DDG-175', cls: 'DDG Flt IIA', state: 'pending' },
  { hull: 'CG-176', cls: 'CG', state: 'live', version: '0.10.0' },
  { hull: 'DDG-177', cls: 'DDG Flt III', state: 'pending' },
  { hull: 'LPD-178', cls: 'LPD', state: 'syncing', version: '0.9.1 → 0.10.0' },
  { hull: 'FFG-179', cls: 'FFG', state: 'staged', version: '0.10.0' },
  { hull: 'LHA-180', cls: 'LHA', state: 'pending' },
  { hull: 'DDG-181', cls: 'DDG Flt III', state: 'pending' },
];
