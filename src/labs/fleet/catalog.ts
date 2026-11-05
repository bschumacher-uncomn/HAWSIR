import { createContext, useContext } from 'react';
import type { FleetCatalog } from '@scenarios/fleet/model';

/** The fleet lab's reference catalog (places, fleets, missions, hulls, disruptions), served by mission-api. */
export const CatalogContext = createContext<FleetCatalog | null>(null);

export function useCatalog(): FleetCatalog {
  const c = useContext(CatalogContext);
  if (!c) throw new Error('fleet catalog not loaded');
  return c;
}
