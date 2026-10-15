// Nigerian mobile numbers, normalised to E.164 (+234XXXXXXXXXX).
// Accepts the common ways people type them: 08012345678, 2348012345678, +234 801 234 5678.

const NG_MOBILE_E164 = /^\+234[789][01]\d{8}$/;

export function normalizeNigerianPhone(input: string): string | null {
  const compact = input.trim().replace(/[\s().-]/g, "");

  let e164: string;
  if (/^\+234\d{10}$/.test(compact)) e164 = compact;
  else if (/^234\d{10}$/.test(compact)) e164 = `+${compact}`;
  else if (/^0\d{10}$/.test(compact)) e164 = `+234${compact.slice(1)}`;
  else return null;

  return NG_MOBILE_E164.test(e164) ? e164 : null;
}

/** "+2348012345678" → "+234 801 *** 5678", for logs and admin screens. */
export function maskPhone(e164: string): string {
  return `${e164.slice(0, 4)} ${e164.slice(4, 7)} *** ${e164.slice(-4)}`;
}
