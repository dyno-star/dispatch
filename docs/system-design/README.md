# System Design

Step-by-step design for the dispatch-ng MVP: an on-demand courier marketplace for Nigeria, starting in Lagos.

Customers post a delivery, verified riders nearby get an offer, the first to accept wins, both sides track the job live, the customer pays in-app, and the rider proves delivery with a PIN and photo. Business accounts, smarter matching and surge pricing are designed for but not built in the MVP.

| Step | Topic | What it decides |
| --- | --- | --- |
| 1 | [Requirements](01-requirements.md) | What's in the MVP, what waits, the targets the system must hit |
| 2 | [Capacity estimates](02-capacity.md) | Year-one load and where each kind of data lives |
| 3 | [Architecture](03-architecture.md) | Clients, backend modules, data stores, vendors |
| 4 | [Data model](04-data-model.md) | Core tables and how they relate |
| 5 | [Order lifecycle](05-order-lifecycle.md) | Status machine and allowed transitions |
| 6 | [API](06-api.md) | Endpoints by caller and the rules every call follows |
| 7 | [Matching](07-matching.md) | Radius expansion, offers, first-accept-wins |
| 8 | [Live tracking](08-tracking.md) | Location pipeline and shareable tracking links |
| 9 | [Pricing and payments](09-payments.md) | Price formula, money flow, payouts, refunds |
| 10 | [Trust flows](10-trust.md) | Rider verification, proof of delivery, ratings, disputes |
| 11 | [Privacy and security](11-privacy-security.md) | Who sees what, and when |
| 12 | [Roadmap and stack](12-roadmap.md) | Phases, MVP build order, tech choices |

Diagrams are written in Mermaid so they render directly on GitHub and stay editable in plain text.
