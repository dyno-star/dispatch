// Per-city settings: where we operate and how we price. Loaded from config/cities/<city>.json
// so prices can be tuned without a code change (docs/system-design/09-payments.md).

import { readFileSync } from "node:fs";
import { z } from "zod";
import { PACKAGE_SIZES, VEHICLE_TYPES, type LatLng } from "@dispatch/shared";

const multipliers = <K extends string>(keys: readonly [K, ...K[]]) =>
  z.object(Object.fromEntries(keys.map((k) => [k, z.number().positive()])) as Record<K, z.ZodNumber>);

const cityConfigSchema = z.object({
  name: z.string().min(1),
  serviceArea: z.object({
    minLat: z.number(),
    maxLat: z.number(),
    minLng: z.number(),
    maxLng: z.number(),
  }),
  pricing: z.object({
    baseKobo: z.int().nonnegative(),
    perKmKobo: z.int().nonnegative(),
    sizeMultiplier: multipliers(PACKAGE_SIZES),
    vehicleMultiplier: multipliers(VEHICLE_TYPES),
    asapFeeKobo: z.int().nonnegative(),
    roundToKobo: z.int().positive(),
    platformFeePercent: z.number().min(0).max(100),
  }),
});

export type CityConfig = z.infer<typeof cityConfigSchema>;
export type PricingConfig = CityConfig["pricing"];

export function loadCityConfig(path: string): CityConfig {
  return cityConfigSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

export function inServiceArea(city: CityConfig, point: LatLng): boolean {
  const a = city.serviceArea;
  return point.lat >= a.minLat && point.lat <= a.maxLat && point.lng >= a.minLng && point.lng <= a.maxLng;
}
