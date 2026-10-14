# Step 3: High-level architecture

Four apps share one backend; live rider positions sit in Redis. The backend is one modular service, split into separate services only when load demands it.

```mermaid
flowchart TB
  subgraph Clients
    CA["Customer app<br/>book, pay, track"]
    RA["Rider app<br/>jobs, GPS, payouts"]
    TP["Tracking page<br/>web link, no login"]
    AP["Admin panel<br/>verify, disputes"]
  end

  GW["API gateway<br/>REST + WebSocket, auth, rate limits"]

  subgraph Backend["Backend service (modules)"]
    ACC["Accounts & Auth<br/>OTP, roles, KYC"]
    ORD["Orders<br/>lifecycle, status"]
    MAT["Matching<br/>nearby rider offers"]
    TRK["Tracking<br/>live GPS over WS"]
    PRI["Pricing<br/>quote by distance"]
    PAY["Payments<br/>charge, payout"]
    POD["Delivery proof<br/>PIN, photo, ratings"]
    SUP["Support<br/>disputes, reports"]
  end

  subgraph Stores["Data stores"]
    PG[("PostgreSQL + PostGIS<br/>orders, users, money")]
    RD[("Redis<br/>rider geo, pub/sub")]
    OS[("Object storage<br/>photos, ID docs")]
    JQ[("Job queue<br/>timeouts, alerts")]
  end

  subgraph Vendors["Third-party services"]
    MAPS["Maps API<br/>geocode, distance"]
    PGW["Payment gateway<br/>Paystack / Flutterwave"]
    SMS["SMS + push<br/>OTP, job alerts"]
    KYC["ID verification<br/>NIN, licence"]
  end

  CA & RA & TP & AP --> GW --> Backend
  Backend --> Stores
  Backend --> Vendors

  style MAT fill:#dbe7f7,stroke:#2f6fd6,stroke-width:2px
```

## Components

| Component | Responsibility | Notes |
| --- | --- | --- |
| Customer app | Create orders, pay, track, rate, report | React Native |
| Rider app | Go online, receive offers, accept, update status, upload proof | React Native, background GPS |
| Tracking page | Public read-only page behind a random token | Next.js, no login |
| Admin panel | Approve riders, manage orders, resolve disputes | Next.js, staff login |
| API gateway | Auth, rate limits, routes REST and WebSocket | Same Node process in MVP |
| Matching | Finds riders, sends offers, expands radius | The core of the product |
| Tracking | Ingests pings, fans out via Redis pub/sub | Separate process if load grows |
| Payments | Gateway charge, webhook, ledger, payouts | Idempotent everywhere |

## Why a modular monolith

At MVP scale (Step 2) a single service is cheaper to run, debug and deploy. Modules talk through in-process interfaces with clear boundaries, so Tracking or Matching can be pulled out into their own services later without rewriting callers.

## Vendor choices (to confirm)

Payment gateway, SMS and ID-verification vendors are options, not decisions. Compare current pricing, coverage and settlement terms before integrating. Each vendor sits behind an adapter interface so it can be swapped.
