import type { Request } from 'express';
import type { Config } from './config';
import type { Actor } from './views/contract';

/**
 * Who is acting. Behind UDS (Istio + Authservice) the mesh has already
 * authenticated the user and forwards their ID token; we read the identity from
 * it. The token is not re-verified here, so this is only enabled with
 * TRUST_IDENTITY_HEADERS=1, i.e. when the API is reachable only through the
 * mesh. Otherwise every request acts as the configured development persona.
 */
export function actorFrom(req: Request, cfg: Config): Actor {
  if (cfg.trustIdentityHeaders) {
    const auth = req.header('authorization');
    if (auth?.startsWith('Bearer ')) {
      const claims = decodeJwt(auth.slice(7));
      const id = str(claims?.preferred_username) ?? str(claims?.email) ?? str(claims?.sub);
      if (id) {
        const groups = Array.isArray(claims?.groups) ? (claims!.groups as unknown[]).map(String) : [];
        return { id, role: groups.find((g) => /readiness|watch|planner|analyst/i.test(g))?.replace(/^\//, '') ?? groups[0]?.replace(/^\//, '') ?? 'member' };
      }
    }
    const fwd = req.header('x-auth-request-preferred-username') ?? req.header('x-forwarded-user');
    if (fwd) return { id: fwd, role: req.header('x-auth-request-groups')?.split(',')[0] ?? 'member' };
  }
  return cfg.devActor;
}

function str(x: unknown): string | undefined {
  return typeof x === 'string' && x ? x : undefined;
}

function decodeJwt(token: string): Record<string, unknown> | undefined {
  const parts = token.split('.');
  if (parts.length < 2) return undefined;
  try {
    return JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  } catch {
    return undefined;
  }
}
