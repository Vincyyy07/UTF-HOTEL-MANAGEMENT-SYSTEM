export const SUPABASE_SCHEMA_SQL = `-- ==============================================================================
-- UNITED FOOD PALACE - HMS SUPABASE POSTGRESQL SCHEMA & STORAGE CONFIGURATION
-- ==============================================================================
-- Run this script in the Supabase Dashboard SQL Editor (https://supabase.com/dashboard)
-- It will create all application tables, indexes, row-level security policies,
-- and public storage buckets for images and documents.
-- ==============================================================================

-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. SYSTEM SETTINGS TABLE
CREATE TABLE IF NOT EXISTS business_settings (
    id TEXT PRIMARY KEY DEFAULT 'default',
    data JSONB NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. MENU CATEGORIES
CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    icon TEXT DEFAULT 'restaurant',
    sort_order INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. MENU ITEMS
CREATE TABLE IF NOT EXISTS menu_items (
    id TEXT PRIMARY KEY,
    category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    description TEXT,
    price_paise INT NOT NULL,
    veg_type TEXT DEFAULT 'veg',
    gst_percent NUMERIC DEFAULT 5,
    is_available BOOLEAN DEFAULT TRUE,
    preparation_time_mins INT DEFAULT 15,
    is_bestseller BOOLEAN DEFAULT FALSE,
    sales_count INT DEFAULT 0,
    image_url TEXT,
    demo_flag BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. DINING TABLES
CREATE TABLE IF NOT EXISTS restaurant_tables (
    id TEXT PRIMARY KEY,
    table_number TEXT NOT NULL,
    section TEXT NOT NULL,
    capacity INT NOT NULL,
    status TEXT DEFAULT 'vacant',
    current_order_id TEXT,
    assigned_steward TEXT,
    guest_count INT,
    total_paise INT DEFAULT 0,
    last_updated TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. ORDERS
CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    table_id TEXT,
    table_number TEXT,
    order_number TEXT,
    steward_name TEXT,
    guest_count INT,
    items JSONB DEFAULT '[]'::jsonb,
    status TEXT DEFAULT 'open',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    demo_flag BOOLEAN DEFAULT FALSE
);

-- 7. BILLS & INVOICES
CREATE TABLE IF NOT EXISTS bills (
    id TEXT PRIMARY KEY,
    bill_number TEXT UNIQUE NOT NULL,
    order_id TEXT,
    table_id TEXT,
    table_number TEXT,
    guest_count INT,
    steward_name TEXT,
    items JSONB DEFAULT '[]'::jsonb,
    subtotal_paise INT NOT NULL,
    discount_percent NUMERIC DEFAULT 0,
    discount_paise INT DEFAULT 0,
    discount_reason TEXT,
    discount_approved_by TEXT,
    service_charge_paise INT DEFAULT 0,
    cgst_paise INT DEFAULT 0,
    sgst_paise INT DEFAULT 0,
    round_off_paise INT DEFAULT 0,
    total_paise INT NOT NULL,
    payment_mode TEXT DEFAULT 'upi',
    payment_status TEXT DEFAULT 'paid',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    financial_year TEXT DEFAULT '2024-25',
    is_audited BOOLEAN DEFAULT FALSE,
    demo_flag BOOLEAN DEFAULT FALSE
);

-- 8. STAFF DIRECTORY
CREATE TABLE IF NOT EXISTS staff (
    id TEXT PRIMARY KEY,
    employee_id TEXT UNIQUE NOT NULL,
    full_name TEXT NOT NULL,
    role TEXT NOT NULL,
    department TEXT,
    phone TEXT,
    email TEXT,
    salary_paise INT NOT NULL,
    joined_date TEXT,
    status TEXT DEFAULT 'active',
    avatar_url TEXT,
    demo_flag BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 9. ATTENDANCE LOGS
CREATE TABLE IF NOT EXISTS attendance (
    id TEXT PRIMARY KEY,
    staff_id TEXT,
    staff_name TEXT,
    date TEXT NOT NULL,
    status TEXT NOT NULL,
    check_in TEXT,
    check_out TEXT,
    hours_worked NUMERIC DEFAULT 0,
    demo_flag BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 10. INVENTORY ITEMS
CREATE TABLE IF NOT EXISTS inventory_items (
    id TEXT PRIMARY KEY,
    item_code TEXT UNIQUE,
    name TEXT NOT NULL,
    category TEXT,
    current_stock NUMERIC NOT NULL,
    unit TEXT NOT NULL,
    reorder_level NUMERIC DEFAULT 10,
    cost_per_unit_paise INT DEFAULT 0,
    supplier_id TEXT,
    supplier_name TEXT,
    last_restocked TEXT,
    demo_flag BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 11. STOCK MOVEMENTS
CREATE TABLE IF NOT EXISTS stock_movements (
    id TEXT PRIMARY KEY,
    inventory_id TEXT,
    item_name TEXT,
    type TEXT,
    quantity NUMERIC,
    unit TEXT,
    reason TEXT,
    reference TEXT,
    timestamp TEXT,
    recorded_by TEXT,
    demo_flag BOOLEAN DEFAULT FALSE
);

-- 12. SUPPLIERS
CREATE TABLE IF NOT EXISTS suppliers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    contact_person TEXT,
    phone TEXT,
    email TEXT,
    gstin TEXT,
    address TEXT,
    payment_terms TEXT,
    demo_flag BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 13. EXPENSES & PAYROLL
CREATE TABLE IF NOT EXISTS expenses (
    id TEXT PRIMARY KEY,
    expense_number TEXT,
    title TEXT NOT NULL,
    category TEXT,
    amount_paise INT NOT NULL,
    payment_mode TEXT,
    date TEXT,
    approved_by TEXT,
    receipt_url TEXT,
    notes TEXT,
    demo_flag BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 14. AUDIT LOGS (Immutable Event Ledger)
CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    timestamp TEXT,
    user_name TEXT,
    user_role TEXT,
    action TEXT,
    entity_type TEXT,
    entity_id TEXT,
    old_value TEXT,
    new_value TEXT,
    reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 15. OPERATOR USERS
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    pin TEXT DEFAULT '1234',
    active BOOLEAN DEFAULT TRUE,
    avatar_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ==============================================================================
ALTER TABLE business_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE restaurant_tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    EXECUTE 'CREATE POLICY "Allow all operations for anon" ON business_settings FOR ALL USING (true) WITH CHECK (true)';
    EXECUTE 'CREATE POLICY "Allow all operations for anon" ON categories FOR ALL USING (true) WITH CHECK (true)';
    EXECUTE 'CREATE POLICY "Allow all operations for anon" ON menu_items FOR ALL USING (true) WITH CHECK (true)';
    EXECUTE 'CREATE POLICY "Allow all operations for anon" ON restaurant_tables FOR ALL USING (true) WITH CHECK (true)';
    EXECUTE 'CREATE POLICY "Allow all operations for anon" ON orders FOR ALL USING (true) WITH CHECK (true)';
    EXECUTE 'CREATE POLICY "Allow all operations for anon" ON bills FOR ALL USING (true) WITH CHECK (true)';
    EXECUTE 'CREATE POLICY "Allow all operations for anon" ON staff FOR ALL USING (true) WITH CHECK (true)';
    EXECUTE 'CREATE POLICY "Allow all operations for anon" ON attendance FOR ALL USING (true) WITH CHECK (true)';
    EXECUTE 'CREATE POLICY "Allow all operations for anon" ON inventory_items FOR ALL USING (true) WITH CHECK (true)';
    EXECUTE 'CREATE POLICY "Allow all operations for anon" ON stock_movements FOR ALL USING (true) WITH CHECK (true)';
    EXECUTE 'CREATE POLICY "Allow all operations for anon" ON suppliers FOR ALL USING (true) WITH CHECK (true)';
    EXECUTE 'CREATE POLICY "Allow all operations for anon" ON expenses FOR ALL USING (true) WITH CHECK (true)';
    EXECUTE 'CREATE POLICY "Allow all operations for anon" ON audit_logs FOR ALL USING (true) WITH CHECK (true)';
    EXECUTE 'CREATE POLICY "Allow all operations for anon" ON users FOR ALL USING (true) WITH CHECK (true)';
EXCEPTION WHEN duplicate_object THEN
    NULL;
END $$;

-- ==============================================================================
-- STORAGE BUCKETS SETUP
-- ==============================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES 
    ('menu-dishes', 'menu-dishes', true, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
    ('branding', 'branding', true, 5242880, ARRAY['image/jpeg', 'image/png', 'image/svg+xml', 'image/webp']),
    ('staff-docs', 'staff-docs', true, 10485760, ARRAY['image/jpeg', 'image/png', 'application/pdf']),
    ('receipts', 'receipts', true, 10485760, ARRAY['image/jpeg', 'image/png', 'application/pdf'])
ON CONFLICT (id) DO UPDATE SET public = true;

DO $$
BEGIN
    EXECUTE 'CREATE POLICY "Public Read Access" ON storage.objects FOR SELECT USING (bucket_id IN (''menu-dishes'', ''branding'', ''staff-docs'', ''receipts''))';
    EXECUTE 'CREATE POLICY "Public Insert Access" ON storage.objects FOR INSERT WITH CHECK (bucket_id IN (''menu-dishes'', ''branding'', ''staff-docs'', ''receipts''))';
    EXECUTE 'CREATE POLICY "Public Update Access" ON storage.objects FOR UPDATE USING (bucket_id IN (''menu-dishes'', ''branding'', ''staff-docs'', ''receipts''))';
    EXECUTE 'CREATE POLICY "Public Delete Access" ON storage.objects FOR DELETE USING (bucket_id IN (''menu-dishes'', ''branding'', ''staff-docs'', ''receipts''))';
EXCEPTION WHEN duplicate_object THEN
    NULL;
END $$;
`;
