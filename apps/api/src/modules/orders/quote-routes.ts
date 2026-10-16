// POST /quotes: price a delivery and lock that price for 10 minutes.

import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { PACKAGE_SIZES, VEHICLE_TYPES } from "@dispatch/shared";
import type { AppDeps } from "../../deps.js";
import { badRequest } from "../../http/errors.js";
import { currentUser, makeGuard } from "../../http/auth-guard.js";
import { straightLineMetres } from "../../adapters/maps.js";
import { inServiceArea } from "../pricing/city.js";
import { calculatePrice } from "../pricing/price.js";

export const QUOTE_TTL_SEC = 10 * 60;
/** Scheduled pickups must be at least this far ahead, so the quote can't outlive the pickup time. */
export const MIN_SCHEDULE_AHEAD_MIN = 30;
export const MAX_SCHEDULE_AHEAD_DAYS = 7;
const MIN_TRIP_M = 50;

const place = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  address: z.string().trim().min(3).max(300),
});

const quoteBody = z.object({
  pickup: place,
  dropoff: place,
  size: z.enum(PACKAGE_SIZES),
  vehicle: z.enum(VEHICLE_TYPES).default("bike"),
  asap: z.boolean().default(true),
  scheduledAt: z.iso.datetime({ offset: true }).optional(),
  deliverBy: z.iso.datetime({ offset: true }).optional(),
});

type QuoteBody = z.infer<typeof quoteBody>;

function checkTimes(body: QuoteBody): { scheduledAt: Date | null; deliverBy: Date | null } {
  const now = Date.now();
  const scheduledAt = body.scheduledAt ? new Date(body.scheduledAt) : null;
  const deliverBy = body.deliverBy ? new Date(body.deliverBy) : null;

  if (body.asap && scheduledAt) {
    throw badRequest("invalid_schedule", "Choose either ASAP or a scheduled pickup time, not both");
  }
  if (!body.asap) {
    if (!scheduledAt) throw badRequest("invalid_schedule", "Choose a pickup time");
    const ahead = scheduledAt.getTime() - now;
    if (ahead < MIN_SCHEDULE_AHEAD_MIN * 60_000 || ahead > MAX_SCHEDULE_AHEAD_DAYS * 86_400_000) {
      throw badRequest(
        "invalid_schedule",
        `Pickup must be between ${MIN_SCHEDULE_AHEAD_MIN} minutes and ${MAX_SCHEDULE_AHEAD_DAYS} days from now`,
      );
    }
  }
  if (deliverBy && deliverBy.getTime() <= (scheduledAt?.getTime() ?? now)) {
    throw badRequest("invalid_schedule", "Delivery time must be after the pickup time");
  }
  return { scheduledAt, deliverBy };
}

export function quoteRoutes(deps: AppDeps): FastifyPluginAsync {
  const guard = makeGuard(deps);

  return async (app) => {
    // Each quote calls the maps API, which is billed per request.
    const rateLimit = { max: 60, timeWindow: "1 minute" };

    app.post("/", { preHandler: guard("customer"), config: { rateLimit } }, async (req) => {
      const user = currentUser(req);
      const body = quoteBody.parse(req.body);
      const { scheduledAt, deliverBy } = checkTimes(body);

      for (const p of [body.pickup, body.dropoff]) {
        if (!inServiceArea(deps.city, p)) {
          throw badRequest("outside_service_area", `We only deliver within ${deps.city.name} for now`);
        }
      }
      if (straightLineMetres(body.pickup, body.dropoff) < MIN_TRIP_M) {
        throw badRequest("same_location", "Pickup and drop-off are the same place");
      }

      const [route, pickupArea, dropoffArea] = await Promise.all([
        deps.maps.route(body.pickup, body.dropoff),
        deps.maps.areaName(body.pickup),
        deps.maps.areaName(body.dropoff),
      ]);
      const price = calculatePrice(
        { distanceM: route.distanceM, size: body.size, vehicle: body.vehicle, asap: body.asap },
        deps.city.pricing,
      );

      const { rows } = await deps.db.query<{ id: string; expires_at: Date }>(
        `INSERT INTO quotes (customer_id, pickup_point, pickup_address, pickup_area,
                             dropoff_point, dropoff_address, dropoff_area, size, vehicle, asap,
                             scheduled_at, deliver_by, distance_m, price_kobo, rider_payout_kobo, pricing, expires_at)
         VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, $4, $5,
                 ST_SetSRID(ST_MakePoint($6, $7), 4326)::geography, $8, $9, $10, $11, $12,
                 $13, $14, $15, $16, $17, $18, now() + make_interval(secs => $19))
         RETURNING id, expires_at`,
        [
          user.id,
          body.pickup.lng,
          body.pickup.lat,
          body.pickup.address,
          pickupArea,
          body.dropoff.lng,
          body.dropoff.lat,
          body.dropoff.address,
          dropoffArea,
          body.size,
          body.vehicle,
          body.asap,
          scheduledAt,
          deliverBy,
          route.distanceM,
          price.priceKobo,
          price.riderPayoutKobo,
          JSON.stringify(deps.city.pricing),
          QUOTE_TTL_SEC,
        ],
      );
      const quote = rows[0]!;

      return {
        quoteId: quote.id,
        priceKobo: price.priceKobo,
        distanceKm: Math.round(route.distanceM / 100) / 10,
        durationMin: Math.ceil(route.durationSec / 60),
        pickupArea,
        dropoffArea,
        expiresAt: quote.expires_at,
      };
    });
  };
}
