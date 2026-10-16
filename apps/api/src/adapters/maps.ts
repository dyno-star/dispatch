// Road distance and area names sit behind an interface so the maps vendor can be chosen later
// (docs/system-design/03-architecture.md, "Vendor choices").

import type { LatLng } from "@dispatch/shared";

export interface Route {
  distanceM: number;
  durationSec: number;
}

export interface MapsClient {
  /** Road distance and driving time between two points. */
  route(from: LatLng, to: LatLng): Promise<Route>;
  /** A neighbourhood name riders can see before accepting, e.g. "Lekki Phase 1". Never an exact address. */
  areaName(point: LatLng): Promise<string>;
}

// Rough neighbourhood centres, used to name an area without a maps API.
const LAGOS_AREAS: readonly [name: string, lat: number, lng: number][] = [
  ["Agege", 6.618, 3.32],
  ["Ajah", 6.4698, 3.5852],
  ["Apapa", 6.4489, 3.359],
  ["Badagry", 6.415, 2.881],
  ["Epe", 6.584, 3.983],
  ["Festac", 6.466, 3.283],
  ["Gbagada", 6.556, 3.388],
  ["Ikeja", 6.6018, 3.3515],
  ["Ikorodu", 6.6194, 3.5105],
  ["Ikotun", 6.55, 3.264],
  ["Ikoyi", 6.4549, 3.4365],
  ["Lagos Island", 6.4541, 3.3947],
  ["Lekki Phase 1", 6.4478, 3.4723],
  ["Magodo", 6.615, 3.386],
  ["Maryland", 6.5713, 3.3646],
  ["Ogba", 6.628, 3.341],
  ["Oshodi", 6.555, 3.343],
  ["Surulere", 6.4969, 3.355],
  ["Victoria Island", 6.4281, 3.4219],
  ["Yaba", 6.5095, 3.3711],
];

const EARTH_RADIUS_M = 6_371_000;

export function straightLineMetres(a: LatLng, b: LatLng): number {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/**
 * Development: no maps API. Road distance is estimated as 1.4 × the straight line at 20 km/h,
 * and the area is the nearest known Lagos neighbourhood. Prices are approximate.
 */
export class EstimateMaps implements MapsClient {
  async route(from: LatLng, to: LatLng): Promise<Route> {
    const distanceM = Math.round(straightLineMetres(from, to) * 1.4);
    return { distanceM, durationSec: Math.round(distanceM / (20_000 / 3600)) };
  }

  async areaName(point: LatLng): Promise<string> {
    let best = LAGOS_AREAS[0]!;
    let bestDistance = Infinity;
    for (const area of LAGOS_AREAS) {
      const d = straightLineMetres(point, { lat: area[1], lng: area[2] });
      if (d < bestDistance) [best, bestDistance] = [area, d];
    }
    return best[0];
  }
}

/** Tests: a fixed road distance, so prices are predictable. Areas work as in EstimateMaps. */
export class FakeMaps extends EstimateMaps {
  distanceM = 10_000;

  override async route(): Promise<Route> {
    return { distanceM: this.distanceM, durationSec: Math.round(this.distanceM / (20_000 / 3600)) };
  }
}
