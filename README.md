# United Food Palace - Enterprise Restaurant Management System (HMS)

A modern, production-ready, full-stack Hospital & Restaurant Management System designed for high-volume dining operations. Built with **Next.js 14**, **TypeScript**, **Tailwind CSS**, and **Supabase (Managed PostgreSQL & Object Storage)**.

---

## 🌟 Key Features & Modules

1. **Floor Management & Real-time Table POS**
   - Live visual layout of tables (AC Grand Hall, Royal Family Suite, Garden Patio).
   - Dynamic table statuses (Vacant, Dining, Reserved, Billing).
   - High-speed order entry with real-time bill preview.

2. **Full Restaurant Menu Catalog**
   - 14 distinct categories and 172 authentic menu items.
   - Dietary classification (`Pure Veg`, `Non-Veg`, `Egg`).
   - Standard 5% GST tax rates, preparation times, and chef specials.

3. **Kitchen Display System (KDS)**
   - Real-time live tickets for kitchen operations.
   - Status transitions (Pending $\rightarrow$ Preparing $\rightarrow$ Ready $\rightarrow$ Served).
   - Sound & visual alerts on new orders.

4. **Split & Discount Billing (GST Compliance)**
   - Itemized billing with CGST (2.5%) & SGST (2.5%) calculations.
   - Split billing, custom payment methods (Cash, Card, UPI), and discounts with mandatory audit reasons.
   - 3-inch (80mm) thermal receipt printer formatting.

5. **Biometric Facial Recognition Attendance**
   - High-speed client-side facial landmark and descriptor extraction powered by `@tensorflow/tfjs-core` and `face-api.js`.
   - Minimal camera popup interface with real-time face detection.
   - Daily attendance rosters, late grace calculations, and monthly tracking.

6. **Inventory & Stock Management**
   - Stock valuation, consumption logging, minimum reserve alerts, and supplier tracking.

7. **Multi-Role Role-Based Access Control (RBAC)**
   - 6 distinct roles: Administrator, General Manager, Waiter/Steward, Kitchen Chef, Inventory Manager, and Cashier.
   - Strict role-based navigation locking with PIN protection.

---

## 🏗️ Architecture & Database

### **Database: 100% Supabase (Managed PostgreSQL)**
- **No external PostgreSQL servers or third-party ORMs.**
- All cloud database operations communicate directly with **Supabase PostgreSQL** via `@supabase/supabase-js`.
- **Hybrid Local-Cloud Sync**: To ensure the restaurant continues operating smoothly even during internet outages, orders and transactions are stored locally with automatic bidirectional background synchronization to Supabase PostgreSQL.
- **Supabase Storage**: Used for staff photos, avatars, and document snapshots.

### Database Tables (`supabase/schema.sql`)
1. `business_settings` — Restaurant metadata, tax rates, GSTIN, thermal printer headers/footers.
2. `categories` — Menu categories with display icons and sort orders.
3. `menu_items` — Dish details, price in paise, tax rates, dietary flags.
4. `restaurant_tables` — Table numbers, capacities, seating zones, and active statuses.
5. `staff` — Employee records, roles, joining dates, base salaries.
6. `inventory_items` — Stock items, reorder thresholds, supplier associations.
7. `orders` — KOT orders, itemized lines, cooking statuses.
8. `bills` — Invoices, payments, CGST/SGST breakdowns, audit trail.
9. `attendance_logs` — Daily staff check-ins, face biometric match logs.
10. `users` — Operator accounts, roles, access PINs.
11. `audit_logs` — Immutable audit trail of financial changes, deletions, and discounts.

---

## 🚀 Getting Started

### 1. Prerequisites
- Node.js 18.x or 20.x+
- npm or yarn
- A [Supabase](https://supabase.com) project

### 2. Installation
```bash
# Clone the repository
git clone <your-github-repo-url>
cd HMS

# Install dependencies
npm install
```

### 3. Environment Configuration
Create a `.env.local` file in the root directory (based on `.env.example`):
```bash
cp .env.example .env.local
```

Fill in your Supabase credentials:
```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
```

### 4. Database Schema Setup
Run the SQL migration script located in `supabase/schema.sql` inside your **Supabase Dashboard $\rightarrow$ SQL Editor**.

### 5. Running the Application
```bash
# Development Mode
npm run dev

# Production Build
npm run build
npm start
```
The application will be running at [http://localhost:3000](http://localhost:3000).

---

## 🔐 Default Operator Roles & Credentials

| Role | Username | PIN | Module Access |
| :--- | :--- | :---: | :--- |
| **Administrator** | `admin` | `1234` | Full access to all modules and settings |
| **General Manager** | `gm` | `2345` | POS, KDS, Billing, Staff, Inventory, Reports |
| **Cashier** | `cashier` | `3456` | Billing, Settlement, Split Invoices, Reports |
| **Kitchen Chef** | `chef` | `4567` | Kitchen Display System (KDS), Stock Depletion |
| **Inventory Manager** | `inventory` | `5678` | Stock In/Out, Suppliers, Minimum Reserve Alerts |
| **Waiter / Steward** | `waiter` | `6789` | Table POS, KOT Dispatch, Bill Requests |

---

## 📁 Project Structure

```
HMS/
├── app/                  # Next.js 14 App Router pages & API routes
│   ├── api/              # Server-side API Route Handlers
│   │   ├── attendance/   # Biometric check-in endpoints
│   │   ├── billing/      # Invoice generation & GST calculations
│   │   ├── data/         # Core data CRUD & backup endpoints
│   │   ├── finance/      # Revenue & expense management
│   │   ├── inventory/    # Stock transactions
│   │   ├── staff/        # Staff directory & biometric enrollments
│   │   ├── supabase/     # Cloud replication & health checks
│   │   └── upload/       # File upload handler
│   ├── globals.css       # Global styles & Tailwind directives
│   ├── layout.tsx        # Root HTML layout with Material Symbols & Inter font
│   └── page.tsx          # Main single-page application dashboard
├── components/           # UI modules (POS, KDS, Billing, Attendance, etc.)
├── data/                 # Local offline database snapshot (hms_db.json)
├── lib/                  # Utilities, types, Supabase clients, face biometrics
├── public/               # Static assets & face-api.js neural network models
├── scripts/              # Data utilities and migration helpers
├── supabase/             # PostgreSQL database schema (schema.sql)
├── .env.example          # Environment variable template
├── .gitignore            # Git exclusion rules for keys, node_modules, and builds
└── package.json          # Node dependencies and build scripts
```

---

## 🛡️ Security & Privacy
- **API Keys Protected**: Never commit `.env.local` to version control. The `.gitignore` is configured to prevent accidental exposure.
- **Biometric Privacy**: Face recognition embeddings are processed client-side in the browser using WebAssembly.
- **Audit Logging**: All discount authorizations, bill cancellations, and price adjustments are tracked in `audit_logs`.
