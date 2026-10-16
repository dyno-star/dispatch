// price = round_to_50((base + km × per_km) × size × vehicle + asap_fee), all in kobo.
// See docs/system-design/09-payments.md.

import type { PackageSize, VehicleType } from "@dispatch/shared";
import type { PricingConfig } from "./city.js";

export interface PriceInput {
  distanceM: number;
  size: PackageSize;
  vehicle: VehicleType;
  asap: boolean;
}

export interface Price {
  priceKobo: number;
  riderPayoutKobo: number;
  platformFeeKobo: number;
}

export function calculatePrice(input: PriceInput, pricing: PricingConfig): Price {
  const km = input.distanceM / 1000;
  const raw =
    (pricing.baseKobo + km * pricing.perKmKobo) *
      pricing.sizeMultiplier[input.size] *
      pricing.vehicleMultiplier[input.vehicle] +
    (input.asap ? pricing.asapFeeKobo : 0);
  const priceKobo = Math.max(pricing.roundToKobo, Math.round(raw / pricing.roundToKobo) * pricing.roundToKobo);
  // The rider's share is rounded down to whole kobo; the platform keeps the remainder.
  const riderPayoutKobo = Math.floor((priceKobo * (100 - pricing.platformFeePercent)) / 100);
  return { priceKobo, riderPayoutKobo, platformFeeKobo: priceKobo - riderPayoutKobo };
}
