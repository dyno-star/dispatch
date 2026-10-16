import { describe, expect, it } from "vitest";
import { EstimateMaps } from "../../adapters/maps.js";
import { LAGOS } from "../../../test/helpers.js";
import { inServiceArea } from "./city.js";
import { calculatePrice } from "./price.js";

const pricing = LAGOS.pricing;

describe("calculatePrice", () => {
  it("follows the formula: (base + km × per_km) × size × vehicle + asap fee", () => {
    // (₦1,000 + 10 km × ₦250) × 1.0 × 1.0 + ₦500 = ₦4,000
    expect(calculatePrice({ distanceM: 10_000, size: "small", vehicle: "bike", asap: true }, pricing)).toEqual({
      priceKobo: 400_000,
      riderPayoutKobo: 320_000,
      platformFeeKobo: 80_000,
    });
  });

  it("applies size and vehicle multipliers", () => {
    // (₦1,000 + ₦2,500) × 1.5 × 2.5 = ₦13,125, rounds to ₦13,150
    const price = calculatePrice({ distanceM: 10_000, size: "large", vehicle: "van", asap: false }, pricing);
    expect(price.priceKobo).toBe(1_315_000);
  });

  it("only charges the ASAP fee for ASAP orders", () => {
    const asap = calculatePrice({ distanceM: 5_000, size: "small", vehicle: "bike", asap: true }, pricing);
    const scheduled = calculatePrice({ distanceM: 5_000, size: "small", vehicle: "bike", asap: false }, pricing);
    expect(asap.priceKobo - scheduled.priceKobo).toBe(pricing.asapFeeKobo);
  });

  it("rounds to the nearest ₦50", () => {
    // ₦1,000 + 7.23 km × ₦250 = ₦2,807.50 → ₦2,800
    expect(calculatePrice({ distanceM: 7_230, size: "small", vehicle: "bike", asap: false }, pricing).priceKobo).toBe(
      280_000,
    );
    // ₦1,000 + 7.31 km × ₦250 = ₦2,827.50 → ₦2,850
    expect(calculatePrice({ distanceM: 7_310, size: "small", vehicle: "bike", asap: false }, pricing).priceKobo).toBe(
      285_000,
    );
  });

  it("always splits the whole price between rider and platform", () => {
    for (const distanceM of [0, 1_234, 9_999, 48_765]) {
      for (const size of ["small", "medium", "large"] as const) {
        const p = calculatePrice({ distanceM, size, vehicle: "car", asap: true }, pricing);
        expect(Number.isInteger(p.priceKobo)).toBe(true);
        expect(Number.isInteger(p.riderPayoutKobo)).toBe(true);
        expect(p.riderPayoutKobo + p.platformFeeKobo).toBe(p.priceKobo);
        expect(p.priceKobo % pricing.roundToKobo).toBe(0);
      }
    }
  });

  it("reads the settings from config/cities/lagos.json", () => {
    expect(pricing).toMatchObject({ baseKobo: 100_000, perKmKobo: 25_000, asapFeeKobo: 50_000, platformFeePercent: 20 });
  });
});

describe("service area and areas", () => {
  it("covers Lagos and nothing else", () => {
    expect(inServiceArea(LAGOS, { lat: 6.4474, lng: 3.4723 })).toBe(true); // Lekki
    expect(inServiceArea(LAGOS, { lat: 9.0765, lng: 7.3986 })).toBe(false); // Abuja
  });

  it("names the nearest neighbourhood, not the address", async () => {
    const maps = new EstimateMaps();
    expect(await maps.areaName({ lat: 6.4474, lng: 3.4723 })).toBe("Lekki Phase 1");
    expect(await maps.areaName({ lat: 6.6, lng: 3.35 })).toBe("Ikeja");
  });

  it("estimates road distance above the straight line", async () => {
    // Lekki Phase 1 to Victoria Island is about 5.8 km in a straight line.
    const route = await new EstimateMaps().route({ lat: 6.4474, lng: 3.4723 }, { lat: 6.4281, lng: 3.4219 });
    expect(route.distanceM).toBeGreaterThan(7_500);
    expect(route.distanceM).toBeLessThan(8_500);
  });
});
