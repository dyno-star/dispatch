# Step 10: Verification, proof, ratings and disputes

Every handoff leaves evidence: documents, PIN, photo, ratings, history. The admin panel is where people step in.

```mermaid
flowchart LR
  subgraph Rider verification
    v1["Rider uploads<br/>NIN, licence, selfie"] --> v2["Auto ID check<br/>vendor API"] --> v3["Admin review<br/>approve or reject"] --> v4["Rider goes live"]
  end
  subgraph Proof of delivery
    p1["PIN to recipient<br/>SMS at pickup"] --> p2["Rider enters PIN<br/>server checks hash"] --> p3["Photo at door<br/>with GPS + time"] --> p4["Order completed<br/>payout released"]
  end
  subgraph Ratings
    g1["Both sides rate<br/>1–5 stars"] --> g2["One per order<br/>each direction"] --> g3["Profile updates<br/>average, deliveries"] --> g4["Flag low scores<br/>admin review"]
  end
  subgraph Disputes
    d1["Issue reported<br/>reason + photos"] --> d2["Payout held"] --> d3["Admin reviews<br/>trail, photos, log"] --> d4["Resolved<br/>refund, pay, or ban"]
  end
```

## Rider verification

- Required: name, photo (selfie), phone (OTP-verified), NIN, driver's licence, vehicle type and plate, bank details.
- In the MVP an admin reviews every application; an ID-verification vendor can automate the NIN and licence checks later.
- Documents are stored privately in object storage and only shown to admins via short-lived signed URLs.
- Rider `status`: `pending → approved` (or `rejected`), and `approved → suspended` if needed.

## Proof of delivery

- At pickup, a 4-digit PIN is sent by SMS to the recipient. Only its hash is stored.
- At drop-off, the rider enters the PIN and takes a photo; the app attaches GPS and time.
- **Fallback:** if the recipient can't give the PIN, the rider submits a photo only and the order goes to admin review instead of auto-completing.
- After 5 wrong PIN attempts the order is locked for review.

## Ratings

- After `completed`, the customer rates the rider and the rider rates the customer, once each.
- Profiles show average rating, completed deliveries and a "Verified Rider" badge.
- Riders below a threshold (e.g. 4.0 over the last 50 deliveries) are flagged for review.

## Disputes

Reasons: package damaged, package missing, rider didn't show up, customer unavailable, wrong address, payment issue, misconduct, other.

Admin sees the order timeline (`order_events`), the route trail, all photos, and both parties' history. Outcomes: full or partial refund, pay rider, warn or suspend an account.
