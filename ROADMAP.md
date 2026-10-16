# Roadmap

Full reasoning in [`docs/system-design/12-roadmap.md`](docs/system-design/12-roadmap.md).

## Phase 1 — MVP (Lagos, bikes)

Each step ends with something demoable and tested.

- [x] **Step 0 — Foundations:** system design docs, monorepo, shared order status machine, database schema, local Postgres + Redis
- [x] **Step 1 — Accounts + riders:** phone OTP login, tokens, roles; rider application with document upload; admin approve/reject ([API](docs/api/step-1-auth-and-riders.md)). Rider bank details move to Step 5, where they are registered with the payment gateway.
- [ ] **Step 2 — Orders + pricing:** quote endpoint (maps distance + price formula), create order, status transitions with `order_events`, cancel
- [ ] **Step 3 — Matching:** rider online/offline, Redis geo positions, offers to closest 5, 20 s timeout and radius expansion, atomic accept
- [ ] **Step 4 — Tracking:** location ingest, Redis pub/sub, WebSocket to customer, public share-link page
- [ ] **Step 5 — Payments:** gateway checkout, verified webhooks, double-entry ledger, rider bank details (gateway transfer recipient), rider payouts, refunds
- [ ] **Step 6 — Proof + admin:** delivery PIN and photo, ratings, disputes, admin panel

## Phase 2 — Scale

Scored matching · traffic-aware ETA and surge pricing · wallets and cash on delivery · signature proof · fake-GPS and fraud checks · more cities and vehicle types · split services if load demands it

## Phase 3 — Businesses

Team members and roles · saved addresses · bulk and scheduled orders · monthly invoices · business dashboard · delivery API for online shops

## Open decisions

- Payment gateway, SMS and ID-verification vendors
- Cancellation fee after the rider is on the way
- Platform fee percentage (placeholder: 20%)
- Starting price parameters (placeholders in [`09-payments.md`](docs/system-design/09-payments.md))
