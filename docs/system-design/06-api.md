# Step 6: Core API

Three callers, about twenty endpoints, one set of safety rules. REST for actions; one WebSocket per active order for live updates.

```mermaid
flowchart LR
  subgraph CUST["Customer app"]
    c1[POST /quotes]
    c2[POST /orders]
    c3["GET /orders/:id"]
    c4["POST /orders/:id/cancel"]
    c5["POST /orders/:id/share-link"]
    c6["POST /orders/:id/rating"]
    c7["POST /orders/:id/disputes"]
  end
  subgraph RIDER["Rider app"]
    r1[POST /riders/apply]
    r2[PUT /riders/me/online]
    r3[POST /riders/me/location]
    r4["POST /offers/:id/accept"]
    r5["POST /orders/:id/status"]
    r6["POST /orders/:id/proof"]
    r7[GET /riders/me/earnings]
  end
  subgraph PUB["Public, admin, webhooks"]
    p1["GET /t/:token"]
    p2["WS /ws/orders/:id"]
    p3[POST /webhooks/payments]
    p4[GET /admin/riders]
    p5["POST /admin/riders/:id/verify"]
    p6[GET /admin/disputes]
    p7["POST /admin/disputes/:id"]
  end
  rules["Every call: OTP login token · idempotency key on orders and payments · version check on status changes"]
  CUST --> rules
  RIDER --> rules
  PUB --> rules
```

## Auth

| Endpoint | Purpose |
| --- | --- |
| `POST /auth/otp` | Send a 6-digit code by SMS to a Nigerian phone number |
| `POST /auth/verify` | Exchange the code for a short-lived access token + refresh token |
| `POST /auth/refresh` | Rotate tokens |

## Examples

**Create a quote**

```http
POST /quotes
{
  "pickup":  { "lat": 6.4474, "lng": 3.4723 },
  "dropoff": { "lat": 6.4281, "lng": 3.4219 },
  "size": "small",
  "vehicle": "bike",
  "asap": true
}
→ 200 { "quoteId": "q_…", "priceKobo": 450000, "distanceKm": 7.2, "expiresAt": "…" }
```

**Create an order** (uses the quote; `Idempotency-Key` header required)

```http
POST /orders
Idempotency-Key: 7c1e…
{ "quoteId": "q_…", "packageType": "food", "notes": "Call at gate", "recipient": { "name": "Ada", "phone": "+2348012345678" } }
→ 201 { "orderId": "o_…", "status": "created", "payment": { "authorizationUrl": "…" } }
```

**Offer as a rider sees it before accepting**

```json
{
  "offerId": "of_…",
  "pickupArea": "Lekki",
  "dropoffArea": "Victoria Island",
  "size": "small",
  "packageType": "food",
  "asap": true,
  "payoutKobo": 360000,
  "distanceToPickupKm": 1.4,
  "expiresInSec": 20
}
```

**Accept** returns `200` with the exact addresses and recipient contact, or `409 Conflict` if another rider got there first.

## Rules every call follows

- **Auth:** bearer token from phone OTP; role checked per route.
- **Idempotency:** `Idempotency-Key` on order creation, payment and payout calls; repeats return the first response.
- **Concurrency:** status changes send the order `version`; a stale version returns `409`.
- **Errors:** JSON `{ "error": { "code": "offer_taken", "message": "…" } }`.
- **Rate limits:** per user and per IP; stricter on `/auth/otp` and `/t/:token`.
