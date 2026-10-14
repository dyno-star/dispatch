# Step 11: Privacy and security

Riders see only the area until they accept; links never show phone numbers.

## Who sees what

| Data | Rider, before accept | Rider, after accept | Customer | Recipient via link |
| --- | :---: | :---: | :---: | :---: |
| Pickup and drop-off **area** | ✅ | ✅ | ✅ | ✅ |
| **Exact pickup address** | ❌ | ✅ | ✅ | ❌ |
| **Exact drop-off address** | ❌ | ✅ | ✅ | ❌ |
| Package size, type, photo | ✅ | ✅ | ✅ | ❌ |
| Customer name and phone | ❌ | ✅ (masked) | — | ❌ |
| Rider name, photo, plate | — | — | ✅ | ✅ |
| Rider live location | — | — | ✅ | ✅ |
| Price or payout | ✅ (payout) | ✅ | ✅ | ❌ |

The bold rows are enforced by the server: exact addresses are never sent to a rider's phone until the accept succeeds. Hiding them in the UI is not enough.

## Security basics

| Area | Approach |
| --- | --- |
| Login | Phone + OTP; short-lived access tokens, rotating refresh tokens; OTP rate limits |
| Roles | `customer`, `rider`, `admin` checked on every route |
| Files | Private bucket; signed URLs that expire in minutes |
| Contact | Masked calls or in-app chat so riders and customers don't swap personal numbers |
| Secrets | Environment variables / secret manager; never in the repo |
| Bank details | Stored at the payment gateway; we keep only the recipient code |
| Webhooks | Signature verified before processing |
| Audit | Admin actions logged with who, what and when |

## Nigeria-specific

- **NDPA 2023** (Nigeria Data Protection Act): collect consent, publish a privacy policy, keep only what's needed, and honour deletion requests. Get legal advice before launch.
- **Fake GPS:** some riders may use location spoofing apps. Phase 2 adds checks (mock-location flag on Android, impossible jumps).
- **Data cost:** keep payloads small (compressed JSON, batched pings) because riders pay for mobile data.
