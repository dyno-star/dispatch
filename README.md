# dispatch-ng

An on-demand dispatch and courier marketplace for Nigeria, starting in Lagos.

Instead of saving random dispatch riders' numbers and calling them one by one, a customer opens the app, requests a delivery, and gets connected to a **verified rider nearby**. Both sides see what they need, the customer tracks the rider live (and can share a tracking link with the recipient), pays in-app, and the rider proves delivery with a PIN and photo.

> **Status:** design complete, project skeleton in place. MVP build starts with step 1 of the [roadmap](ROADMAP.md).

## How it works

```mermaid
flowchart LR
  C["Customer<br/>creates delivery"] --> Q["Price quote<br/>+ payment"] --> M["Matching<br/>nearby riders get offers"]
  M --> A["Rider accepts<br/>exact address revealed"] --> T["Live tracking<br/>+ share link"] --> D["Delivered<br/>PIN + photo"] --> P["Rider paid<br/>both sides rate"]
```

## System design

The full step-by-step design lives in [`docs/system-design`](docs/system-design/README.md):

1. [Requirements](docs/system-design/01-requirements.md)
2. [Capacity estimates](docs/system-design/02-capacity.md)
3. [Architecture](docs/system-design/03-architecture.md)
4. [Data model](docs/system-design/04-data-model.md)
5. [Order lifecycle](docs/system-design/05-order-lifecycle.md)
6. [API](docs/system-design/06-api.md)
7. [Matching](docs/system-design/07-matching.md)
8. [Live tracking](docs/system-design/08-tracking.md)
9. [Pricing and payments](docs/system-design/09-payments.md)
10. [Trust flows](docs/system-design/10-trust.md)
11. [Privacy and security](docs/system-design/11-privacy-security.md)
12. [Roadmap and stack](docs/system-design/12-roadmap.md)

## Repository layout

```
dispatch-ng/
├── apps/
│   ├── api/          Node.js + TypeScript + Fastify backend (modular monolith)
│   │   ├── migrations/   SQL migrations (PostgreSQL + PostGIS)
│   │   └── src/
│   ├── web/          Next.js admin panel + public tracking page (not scaffolded yet)
│   └── mobile/       React Native customer + rider app (not scaffolded yet)
├── packages/
│   └── shared/       Types and the order status machine shared by every app
├── docs/
│   └── system-design/
├── docker-compose.yml    Postgres/PostGIS + Redis for local development
└── .env.example
```

## Getting started

Requirements: Node.js 22+, pnpm 9+, Docker.

```bash
pnpm install
cp .env.example .env
pnpm db:up          # start Postgres + Redis
pnpm db:migrate     # create the schema
pnpm dev:api        # http://localhost:4000/health
```

Run checks:

```bash
pnpm typecheck
pnpm test
```

## Tech stack

| Layer | Choice |
| --- | --- |
| Mobile | React Native (Expo) |
| Web | Next.js |
| API | Node.js, TypeScript, Fastify |
| Database | PostgreSQL + PostGIS |
| Realtime / cache / jobs | Redis, BullMQ |
| Storage | S3-compatible bucket |
| Payments | Nigerian payment gateway (vendor to confirm) |
