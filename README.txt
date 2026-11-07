NF Restro — Partial Item Cancellation Patch

Replace the files in your GitHub repository with the matching paths in this ZIP.
Do not upload the ZIP itself into the repository root.

Files included:
- client/src/pages/OrderDetails.tsx
- client/src/pages/Kitchen.tsx
- client/src/pages/Orders.tsx
- src/modules/orders/orders.types.ts
- src/modules/orders/orders.repository.ts
- src/modules/orders/orders.service.ts
- src/modules/orders/orders.controller.ts
- src/modules/orders/orders.routes.ts
- src/modules/reports/reports.repository.ts
- src/modules/tables/tables.repository.ts
- migrations/040_order_item_cancellation.sql

IMPORTANT DATABASE STEP:
After the updated code is deployed, run this from the backend service's Railway shell:
  npm run migrate

This applies migration 040_order_item_cancellation.sql, adding CANCELLED as an order-item status.
Do not skip this step; otherwise the backend may reject item cancellation.

Then refresh the order details page. Open an active order and use Cancel item beside the specific dish.
The other dishes remain on the same order and the bill total is recalculated. If the last active item is cancelled, the order is automatically closed.

Build verification note: dependencies were not available in this environment, so a full TypeScript/Vite build was not run.
