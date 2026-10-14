# Step 4: Data model

Every table hangs off the order; orders belong to an account, not a person. Money is stored as integer **kobo** (₦1 = 100 kobo) to avoid floating-point errors.

```mermaid
erDiagram
  accounts ||--o{ users : "has members"
  accounts ||--o{ orders : places
  users ||--o| rider_profiles : "is a rider"
  rider_profiles ||--o{ rider_documents : uploads
  users ||--o{ orders : "creates (customer)"
  rider_profiles ||--o{ orders : "delivers (rider)"
  orders ||--o{ order_events : "status history"
  orders ||--o{ offers : "sent to riders"
  orders ||--o{ location_trail : "route points"
  orders ||--o{ payments : "paid by"
  orders ||--o{ ledger_entries : "money moves"
  orders ||--o| proofs : "proved by"
  orders ||--o{ ratings : "rated in"
  orders ||--o{ disputes : "disputed in"
  orders ||--o{ tracking_links : "shared via"
  rider_profiles ||--o{ payouts : receives

  accounts {
    uuid id PK
    text type "personal | business"
    text name
    uuid owner_user_id FK
  }
  users {
    uuid id PK
    uuid account_id FK
    text phone UK
    text name
    text role "customer | rider | admin"
    numeric rating_avg
    int rating_count
  }
  rider_profiles {
    uuid user_id PK
    text status "pending | approved | rejected | suspended"
    text vehicle_type
    text plate
    text bank_ref "gateway recipient code, never raw account no."
    bool online
    timestamptz last_seen_at
  }
  rider_documents {
    uuid id PK
    uuid rider_id FK
    text kind "nin | licence | selfie | vehicle"
    text file_key
    uuid verified_by FK
  }
  orders {
    uuid id PK
    uuid account_id FK
    uuid customer_id FK
    uuid rider_id FK
    text status
    int version "optimistic lock"
    geography pickup_point
    geography dropoff_point
    text pickup_area "shown before accept"
    text dropoff_area
    text size
    text package_type
    text vehicle
    bigint price_kobo
    timestamptz scheduled_at
  }
  order_events {
    bigint id PK
    uuid order_id FK
    text from_status
    text to_status
    uuid actor_id
  }
  offers {
    uuid id PK
    uuid order_id FK
    uuid rider_id FK
    numeric radius_km
    text response "pending | accepted | declined | expired | lost"
  }
  location_trail {
    bigint id PK
    uuid order_id FK
    geography point
    timestamptz recorded_at
  }
  payments {
    uuid id PK
    uuid order_id FK
    text provider_ref UK
    bigint amount_kobo
    text status
  }
  ledger_entries {
    bigint id PK
    uuid order_id FK
    text account_code
    bigint debit_kobo
    bigint credit_kobo
  }
  payouts {
    uuid id PK
    uuid rider_id FK
    bigint amount_kobo
    text transfer_ref
    text status
  }
  proofs {
    uuid order_id PK
    text pin_hash
    text photo_key
  }
  ratings {
    uuid id PK
    uuid order_id FK
    uuid from_user FK
    uuid to_user FK
    int stars
  }
  disputes {
    uuid id PK
    uuid order_id FK
    uuid raised_by FK
    text reason
    text status
  }
  tracking_links {
    text token PK
    uuid order_id FK
    timestamptz expires_at
  }
```

## Key design choices

- **`orders.version`** blocks double acceptance. Accept runs `UPDATE orders SET rider_id = $1, status = 'accepted', version = version + 1 WHERE id = $2 AND status = 'searching' AND version = $3`. Zero rows updated means another rider won.
- **`pickup_area` vs `pickup_point`.** Riders see the area (e.g. "Lekki Phase 1") before accepting; the exact point is returned only to the assigned rider.
- **`bank_ref`** stores the payment gateway's transfer-recipient code, not the raw bank account number.
- **`ledger_entries`** is double-entry: every naira in or out is a debit and a matching credit, so payouts and refunds always reconcile.
- **`order_events`** is an append-only audit trail used by support and disputes.

The executable schema is in [`apps/api/migrations/001_init.sql`](../../apps/api/migrations/001_init.sql).
