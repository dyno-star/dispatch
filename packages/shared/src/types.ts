// Shared domain types used by the API, web and mobile apps.
// See docs/system-design/01-requirements.md and 04-data-model.md.

export const PACKAGE_SIZES = ["small", "medium", "large"] as const;
export type PackageSize = (typeof PACKAGE_SIZES)[number];

export const PACKAGE_TYPES = [
  "food",
  "perishable",
  "non_perishable",
  "fragile",
  "documents",
  "clothing",
  "other",
] as const;
export type PackageType = (typeof PACKAGE_TYPES)[number];

export const VEHICLE_TYPES = ["bike", "car", "van"] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];

export const USER_ROLES = ["customer", "rider", "admin"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const ACCOUNT_TYPES = ["personal", "business"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const RIDER_STATUSES = ["pending", "approved", "rejected", "suspended"] as const;
export type RiderStatus = (typeof RIDER_STATUSES)[number];

export const DISPUTE_REASONS = [
  "package_damaged",
  "package_missing",
  "rider_no_show",
  "customer_unavailable",
  "wrong_address",
  "payment_issue",
  "misconduct",
  "other",
] as const;
export type DisputeReason = (typeof DISPUTE_REASONS)[number];

export interface LatLng {
  lat: number;
  lng: number;
}

/** Money is always integer kobo (₦1 = 100 kobo). */
export type Kobo = number;
