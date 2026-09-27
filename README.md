# Industrial ERP System (PERN Stack)

A complete ERP application for managing the workflow: **Customer Enquiry → Quotation → Sales Order → Inventory Reservation → Dispatch**

Built with **PostgreSQL + Express.js + React.js + Node.js (PERN Stack)**.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, React Router, Axios, Vite |
| Backend | Node.js, Express.js, JWT, bcryptjs, express-validator |
| Database | PostgreSQL (with transactions, row-level locking, optimistic concurrency via version columns) |
| Testing | Jest (18 tests covering all mandatory test cases) |
| ORM | Raw SQL with `pg` driver (full control over transactions and locking) |

---

## Features Implemented

### ✅ 1. Authentication & Roles (JWT + RBAC)
- **ADMIN**: View all records, manage inventory, confirm sales orders, process dispatch, cancel orders
- **SALES USER**: Create customers/enquiries, create quotations, convert accepted quotations → Sales Orders, view inventory
- Password hashing with `bcryptjs` (10 rounds)
- JWT tokens (24h expiry)
- Protected APIs with backend role authorization middleware (not just frontend checks)

### ✅ 2. Customer Enquiry
- Create customer on-the-fly or select existing
- Multi-product enquiries with quantities
- Status flow: `NEW → QUOTED → WON / LOST`

### ✅ 3. Product & Inventory
- 6 seeded industrial products with realistic data
- Inventory tracks **Physical Quantity** and **Reserved Quantity**
- `Available = Physical − Reserved` (computed on reads)
- Database-level `CHECK` constraints prevent negative quantities
- **Concurrency-safe reservations**: Uses PostgreSQL `FOR UPDATE` row-level locks + optimistic `version` column to prevent simultaneous over-reservation

### ✅ 4. Quotation
- Tied to an existing enquiry (auto-loads products)
- Line-item calculations **server-side validated**:
  ```
  Base Amount = Qty × Unit Price
  After Discount = Base × (1 − Discount%)
  Line Amount = After Discount × (1 + GST%)
  Grand Total = Σ Line Amounts
  ```
- Status flow: `DRAFT → SENT → ACCEPTED / REJECTED`
- Backend calculates total (does not trust frontend)

### ✅ 5. Quotation → Sales Order
- Only **ACCEPTED** quotations can be converted
- DRAFT / REJECTED → blocked
- `UNIQUE` foreign key on `quotation_id` in `sales_orders` prevents duplicate orders

### ✅ 6. Inventory Reservation (Backend-Level Concurrency)
On sales order confirmation:
1. `BEGIN` transaction
2. `SELECT ... FOR UPDATE` on both the order and relevant inventory rows (row-level locking)
3. Check `Physical − Reserved >= Required` for every item
4. Update inventory with `WHERE product_id = ? AND version = ?` optimistic check
5. If rows affected = 0 → `ROLLBACK` with 409 Conflict
6. Otherwise `COMMIT` and set order to `CONFIRMED`

**Even if two requests arrive at the exact same moment, PostgreSQL row locks ensure only one succeeds.**

### ✅ 7. Dispatch
- Reduces BOTH `physical_quantity` AND `reserved_quantity` simultaneously in a transaction
- Prevents: dispatch beyond reserved, duplicate dispatch of same qty, dispatch of cancelled orders
- Partial dispatch allowed (tracks already-dispatched quantities per line item)
- Status flow: `PENDING → CONFIRMED → DISPATCHED → CANCELLED`

---

## Project Structure
```
Funds case study/
├── backend/
│   ├── db/
│   │   ├── index.js          # PostgreSQL connection pool
│   │   └── migrate.js        # Schema creation (all tables, FKs, triggers)
│   ├── middleware/
│   │   ├── auth.js           # JWT auth + requireRoles RBAC middleware
│   │   └── common.js         # Validators, async wrapper, number generator
│   ├── routes/
│   │   ├── auth.js           # /api/auth/login, /api/auth/me
│   │   ├── customers.js      # CRUD customers
│   │   ├── enquiries.js      # Enquiries + items
│   │   ├── products.js       # Products + inventory management
│   │   ├── quotations.js     # Quotations, status changes, → SO conversion
│   │   └── salesOrders.js    # SO confirm/cancel/dispatch with inventory logic
│   ├── tests/
│   │   └── erp.test.js       # 18 automated tests (see below)
│   ├── seed.js               # Seeds users + 6 products + inventory + sample customers
│   ├── server.js             # Express entry point
│   ├── .env
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── context/
│   │   │   └── AuthContext.jsx    # Auth state + axios interceptor
│   │   ├── pages/
│   │   │   ├── Login.jsx          # Login screen
│   │   │   ├── Enquiries.jsx      # Create + view enquiries
│   │   │   ├── Quotations.jsx     # Create quotations + Accept/Reject + Convert
│   │   │   └── SalesOrders.jsx    # Orders + inventory overview + confirm/cancel/dispatch
│   │   ├── App.jsx                # Routing + role-based PrivateRoute
│   │   ├── main.jsx
│   │   └── index.css              # Full CSS (no external UI libs needed)
│   ├── index.html
│   ├── vite.config.js             # Includes /api proxy to :5000
│   └── package.json
└── README.md
```

---

## Database Setup (PostgreSQL)

### 1. Install PostgreSQL
Download & install from [postgresql.org](https://www.postgresql.org/download/). Remember the password you set for the `postgres` superuser.

### 2. Create the database
Open `psql` or pgAdmin and run:
```sql
CREATE DATABASE erp_db;
```

### 3. Configure connection
Edit `backend/.env` if needed (defaults shown):
```env
PORT=5000
DB_HOST=localhost
DB_PORT=5432
DB_NAME=erp_db
DB_USER=postgres
DB_PASSWORD=postgres
JWT_SECRET=your_jwt_secret_key_here_make_it_very_long_and_secure_2024
NODE_ENV=development
```

---

## Running the Project

### Step 1: Run migrations & seed (creates tables + sample data)
```powershell
cd backend
node seed.js
```
This runs all migrations AND seeds users, products, inventory, and sample customers.

### Step 2: Start the backend server
```powershell
cd backend
npm run dev
```
Server runs on **http://localhost:5000**

### Step 3: Start the frontend (new terminal)
```powershell
cd frontend
npm run dev
```
Frontend runs on **http://localhost:5173** — Vite proxies `/api` requests to the backend automatically.

### Step 4: Open browser
Navigate to **http://localhost:5173**

---

## Test Login Credentials

| Role    | Username | Password   | Permissions                                                                  |
|---------|----------|------------|------------------------------------------------------------------------------|
| **ADMIN** | `admin`  | `admin123` | Everything: confirm orders, dispatch, cancel, manage inventory, full view   |
| **SALES** | `sales`  | `sales123` | Create customers/enquiries/quotations, accept/reject, convert accepted Q→SO, view inventory |

---

## Running the Tests

```powershell
cd backend
npm test
```

### Test Coverage (18 tests across 6 suites):
| Suite | Scenarios |
|-------|-----------|
| **Test 1 – Quotation totals** | Plain, discount only, GST only, both discount+GST, grand total sum |
| **Test 2 – Rejected/Draft → Sales Order** | DRAFT blocked, REJECTED blocked, SENT blocked, ACCEPTED allowed |
| **Test 3 – Duplicate Sales Order prevention** | Duplicate quote ID rejected, new quote ID accepted |
| **Test 4 – Reservation beyond available blocked** | 80 vs 70 avail fails, 60 vs 70 passes, DB constraint `reserved <= physical` |
| **Test 5 – Unauthorized → restricted op blocked** | SALES cannot confirm order or manage inventory, missing token → 401 |
| **Bonus – Concurrent reservations** | Simulates User A reserves 80 (avail 100) then User B (still holding stale version) tries 50 → fails due to version mismatch, even retry fails because stock insufficient |

---

## Database Schema / ER Diagram

### Tables & Relationships

```
users (PK id, username, email, password_hash, role, full_name)

customers (PK id, company_name, contact_person, mobile, email, city)

products (PK id, product_code [UK], product_name, category, unit, base_price)
   │
   └──► inventory (PK id, FK product_id [UK], physical_quantity, reserved_quantity, version)

enquiries (PK id, enquiry_number [UK], FK customer_id, enquiry_date, required_date, notes, status, FK created_by)
   │
   └──► enquiry_items (PK id, FK enquiry_id, FK product_id, quantity | UK (enquiry_id, product_id))

quotations (PK id, quotation_number [UK], FK enquiry_id, FK customer_id, valid_until, grand_total, status, FK created_by)
   │
   └──► quotation_items (PK id, FK quotation_id, FK product_id, qty, unit_price, discount%, gst%, line_amount | UK (quotation_id, product_id))

sales_orders (PK id, order_number [UK], FK quotation_id [UK UNIQUE ← prevents double SO], FK customer_id, order_date, total_amount, status, FK created_by, confirmed_at, FK confirmed_by)
   │
   └──► sales_order_items (PK id, FK sales_order_id, FK product_id, quantity, unit_price | UK (sales_order_id, product_id))
           │
           └──► dispatch_items (PK id, FK dispatch_id, FK sales_order_item_id, FK product_id, quantity)

dispatches (PK id, dispatch_number [UK], FK sales_order_id, dispatch_date, vehicle_number, driver_name, FK created_by)
```

### Key Constraints
- `CHECK (reserved_quantity <= physical_quantity)` enforced via PL/pgSQL trigger
- `CHECK (physical_quantity >= 0)`, `CHECK (reserved_quantity >= 0)`
- `sales_orders.quotation_id UNIQUE` prevents duplicate SOs per quotation
- All `status` columns use `CHECK IN (list of valid statuses)`
- Cascade deletes on child item tables, restrict on parent lookups

---

## API Documentation (REST)

Base URL: `http://localhost:5000/api` — All POST/PATCH endpoints are validated with `express-validator`.

### Authentication
| Method | Endpoint | Auth | Body | Description |
|--------|----------|------|------|-------------|
| POST | `/auth/login` | Public | `{ username, password }` | Returns JWT + user |
| GET | `/auth/me` | Bearer | — | Current user profile |

### Customers
| Method | Endpoint | Roles | Description |
|--------|----------|-------|-------------|
| GET | `/customers` | SALES, ADMIN | List all (optionally `?search=`) |
| GET | `/customers/:id` | SALES, ADMIN | Get one |
| POST | `/customers` | SALES, ADMIN | Create |

### Enquiries
| Method | Endpoint | Roles | Description |
|--------|----------|-------|-------------|
| GET | `/enquiries` | SALES, ADMIN | List all with items |
| GET | `/enquiries/:id` | SALES, ADMIN | Detail with items |
| POST | `/enquiries` | SALES, ADMIN | Create (items: `[{product_id, quantity}]`) |
| PATCH | `/enquiries/:id/status` | SALES, ADMIN | `{ status: 'NEW'/'QUOTED'/'WON'/'LOST' }` |

### Products & Inventory
| Method | Endpoint | Roles | Description |
|--------|----------|-------|-------------|
| GET | `/products` | SALES, ADMIN | List with inventory (physical, reserved, available = computed) |
| GET | `/products/categories` | SALES, ADMIN | Distinct category list |
| GET | `/products/:id` | SALES, ADMIN | Detail |
| POST | `/products` | ADMIN | Create with optional initial `physical_quantity` |
| PUT | `/products/:id/inventory` | ADMIN | Update physical/reserved quantities |

### Quotations
| Method | Endpoint | Roles | Description |
|--------|----------|-------|-------------|
| GET | `/quotations` | SALES, ADMIN | List with items + customer + enquiry |
| GET | `/quotations/:id` | SALES, ADMIN | Detail |
| POST | `/quotations` | SALES, ADMIN | Create. Body: `{enquiry_id, valid_until, items: [{product_id, quantity, unit_price, discount_percent, gst_percent}]}`. **Grand total recalculated server-side.** |
| PATCH | `/quotations/:id/status` | SALES, ADMIN | `{ status: 'DRAFT'|'SENT'|'ACCEPTED'|'REJECTED' }`. Auto updates linked enquiry to WON/LOST. |
| POST | `/quotations/:id/convert` | SALES, ADMIN | ACCEPTED → Sales Order. Prevents duplicates via UNIQUE FK. |

### Sales Orders
| Method | Endpoint | Roles | Description |
|--------|----------|-------|-------------|
| GET | `/sales-orders` | SALES, ADMIN | List with items, inventory availability, and dispatches |
| GET | `/sales-orders/:id` | SALES, ADMIN | Detail |
| POST | `/sales-orders/:id/confirm` | **ADMIN only** | Checks stock in transaction, reserves, uses row locks + version. |
| POST | `/sales-orders/:id/cancel` | **ADMIN only** | Releases reserved inventory back if CONFIRMED. |
| POST | `/sales-orders/:id/dispatch` | **ADMIN only** | Dispatches items; decrements physical AND reserved in tx; validates no dispatch beyond remaining; marks order DISPATCHED when fully shipped. Body: `{ dispatch_date, vehicle_number?, driver_name?, items: [{sales_order_item_id, product_id, quantity}] }` |

---

## End-to-End Workflow Demo (5-minute script)

1. **Login** as `sales / sales123`
2. **Enquiries → + New Enquiry**
   - Select customer `ABC Engineering`
   - Add products: Ball Bearing × 100, MS Pipe × 40
   - Save → status is `NEW`
3. **Quotations → + New Quotation**
   - Select the enquiry above → items auto-populated with base prices
   - Adjust: discount 5%, GST 18%
   - Save → status `DRAFT` → click **Mark SENT** → status `SENT`
4. Click **Accept** → status becomes `ACCEPTED` (enquiry flips to `WON`)
5. Click **→ Convert to Sales Order** → SO created with status `PENDING`
6. **Logout** → login as `admin / admin123`
7. **Sales Orders**: See inventory availability per item → click **✓ Confirm & Reserve**
   - Reserved quantity increments (check Inventory Overview table)
   - SO becomes `CONFIRMED`
8. Click **🚚 Dispatch** → fill vehicle/driver → submit
   - Physical ↓ AND Reserved ↓ by the dispatched amount
   - Order becomes `DISPATCHED` when all items are shipped
9. Try **Cancel** on a PENDING or CONFIRMED order → reserved stock released.

---

## Environment-Based Configuration
All configuration comes from `backend/.env` via `dotenv`:
- `PORT`, `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `JWT_SECRET`, `NODE_ENV`
- No hardcoded secrets or DB connection strings in source code.

---

## Error Handling & Validation

- **Global Express error middleware** with stack traces only in `NODE_ENV=development`
- **400** for validation failures (field-level errors array returned)
- **401** for missing/invalid JWT
- **403** for insufficient role
- **404** for missing resources
- **409** for concurrent reservation conflicts
- **422 / 400** for business rule violations (e.g. "cannot dispatch cancelled order", "insufficient inventory")
- All mutations wrapped in **PostgreSQL transactions** so partial writes are impossible
