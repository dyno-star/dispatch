// What each kind of viewer may see of an order (docs/system-design/11-privacy-security.md).
// Exact addresses only ever go to the customer, the assigned rider and admins.

import { CUSTOMER_STATUS_LABELS, maskPhone } from "@dispatch/shared";
import type { OrderStatus, PackageSize, PackageType, VehicleType } from "@dispatch/shared";

export const ORDER_COLUMNS = `o.id, o.status, o.version, o.customer_id, o.rider_id,
  ST_Y(o.pickup_point::geometry) AS pickup_lat, ST_X(o.pickup_point::geometry) AS pickup_lng,
  o.pickup_address, o.pickup_area,
  ST_Y(o.dropoff_point::geometry) AS dropoff_lat, ST_X(o.dropoff_point::geometry) AS dropoff_lng,
  o.dropoff_address, o.dropoff_area,
  o.recipient_name, o.recipient_phone, o.size, o.package_type, o.vehicle, o.notes,
  o.asap, o.scheduled_at, o.deliver_by, o.distance_m, o.price_kobo, o.rider_payout_kobo,
  o.request_hash, o.created_at, o.updated_at,
  u.name AS customer_name, u.phone AS customer_phone`;

/** Use with ORDER_COLUMNS: `SELECT ${ORDER_COLUMNS} ${ORDER_FROM} WHERE o.id = $1`. */
export const ORDER_FROM = "FROM orders o JOIN users u ON u.id = o.customer_id";

export interface OrderRow {
  id: string;
  status: OrderStatus;
  version: number;
  customer_id: string;
  rider_id: string | null;
  pickup_lat: number;
  pickup_lng: number;
  pickup_address: string;
  pickup_area: string;
  dropoff_lat: number;
  dropoff_lng: number;
  dropoff_address: string;
  dropoff_area: string;
  recipient_name: string;
  recipient_phone: string;
  size: PackageSize;
  package_type: PackageType;
  vehicle: VehicleType;
  notes: string | null;
  asap: boolean;
  scheduled_at: Date | null;
  deliver_by: Date | null;
  distance_m: number;
  price_kobo: string; // bigint comes back from pg as a string
  rider_payout_kobo: string;
  request_hash: string | null;
  created_at: Date;
  updated_at: Date;
  customer_name: string;
  customer_phone: string;
}

export interface OrderEventRow {
  to_status: OrderStatus;
  actor_id: string | null;
  note: string | null;
  created_at: Date;
}

function places(o: OrderRow) {
  return {
    pickup: { lat: o.pickup_lat, lng: o.pickup_lng, address: o.pickup_address, area: o.pickup_area },
    dropoff: { lat: o.dropoff_lat, lng: o.dropoff_lng, address: o.dropoff_address, area: o.dropoff_area },
  };
}

function packageDetails(o: OrderRow) {
  return {
    size: o.size,
    packageType: o.package_type,
    vehicle: o.vehicle,
    notes: o.notes,
    asap: o.asap,
    scheduledAt: o.scheduled_at,
    deliverBy: o.deliver_by,
    distanceM: o.distance_m,
  };
}

export function customerView(o: OrderRow, events: OrderEventRow[]) {
  return {
    id: o.id,
    status: o.status,
    statusLabel: CUSTOMER_STATUS_LABELS[o.status],
    version: o.version,
    ...places(o),
    recipient: { name: o.recipient_name, phone: o.recipient_phone },
    ...packageDetails(o),
    priceKobo: Number(o.price_kobo),
    timeline: events.map((e) => ({ status: e.to_status, at: e.created_at })),
    createdAt: o.created_at,
    updatedAt: o.updated_at,
  };
}

/** For the assigned rider only. Shows the payout, not the price, and masks the customer's number. */
export function riderView(o: OrderRow) {
  return {
    id: o.id,
    status: o.status,
    version: o.version,
    ...places(o),
    recipient: { name: o.recipient_name, phone: o.recipient_phone },
    customer: { name: o.customer_name, phone: maskPhone(o.customer_phone) },
    ...packageDetails(o),
    payoutKobo: Number(o.rider_payout_kobo),
    createdAt: o.created_at,
    updatedAt: o.updated_at,
  };
}

export function adminView(o: OrderRow, events: OrderEventRow[]) {
  return {
    ...customerView(o, events),
    customer: { id: o.customer_id, name: o.customer_name, phone: o.customer_phone },
    riderId: o.rider_id,
    riderPayoutKobo: Number(o.rider_payout_kobo),
    timeline: events.map((e) => ({ status: e.to_status, at: e.created_at, actorId: e.actor_id, note: e.note })),
  };
}
