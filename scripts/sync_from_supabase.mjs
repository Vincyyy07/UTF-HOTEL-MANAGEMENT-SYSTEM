import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

// Load environment variables from .env.local if present
const envPath = path.join(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  envContent.split('\n').forEach((line) => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
      const idx = trimmed.indexOf('=');
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  });
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://ioesvhzkbgjplvhmmrga.supabase.co';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
if (!serviceKey) {
  console.error('SUPABASE_SERVICE_ROLE_KEY is required in environment to sync.');
  process.exit(1);
}
const client = createClient(url, serviceKey);

async function pullAndMerge() {
  const [
    settingsRes,
    categoriesRes,
    menuItemsRes,
    tablesRes,
    billsRes,
    staffRes,
    inventoryRes,
    usersRes,
    attendanceRes,
    expensesRes,
    suppliersRes,
  ] = await Promise.all([
    client.from('business_settings').select('*').eq('id', 'default').maybeSingle(),
    client.from('categories').select('*').order('sort_order', { ascending: true }),
    client.from('menu_items').select('*'),
    client.from('restaurant_tables').select('*'),
    client.from('bills').select('*').order('created_at', { ascending: false }),
    client.from('staff').select('*'),
    client.from('inventory_items').select('*'),
    client.from('users').select('*'),
    client.from('attendance').select('*'),
    client.from('expenses').select('*'),
    client.from('suppliers').select('*'),
  ]);

  console.log('Fetched from Supabase:');
  console.log('- Settings:', !!settingsRes.data);
  console.log('- Categories:', categoriesRes.data?.length || 0);
  console.log('- Menu Items:', menuItemsRes.data?.length || 0);
  console.log('- Tables:', tablesRes.data?.length || 0);
  console.log('- Bills:', billsRes.data?.length || 0);
  console.log('- Staff:', staffRes.data?.length || 0);
  console.log('- Inventory:', inventoryRes.data?.length || 0);
  console.log('- Users:', usersRes.data?.length || 0);
  console.log('- Attendance:', attendanceRes.data?.length || 0);
  console.log('- Expenses:', expensesRes.data?.length || 0);
  console.log('- Suppliers:', suppliersRes.data?.length || 0);

  const dbPath = path.join(process.cwd(), 'data', 'hms_db.json');
  const localDb = JSON.parse(fs.readFileSync(dbPath, 'utf-8'));

  // Update local settings with Supabase settings
  if (settingsRes.data?.data) {
    localDb.settings = {
      ...localDb.settings,
      ...settingsRes.data.data,
      supabaseUrl: url,
    };
  } else {
    localDb.settings.supabaseUrl = url;
  }

  // Categories
  if (categoriesRes.data && categoriesRes.data.length > 0) {
    localDb.categories = categoriesRes.data.map((c) => ({
      id: c.id,
      name: c.name,
      icon: c.icon || 'restaurant',
      sortOrder: c.sort_order || 0,
    }));
  }

  // Menu items
  if (menuItemsRes.data && menuItemsRes.data.length > 0) {
    localDb.menuItems = menuItemsRes.data.map((m) => ({
      id: m.id,
      categoryId: m.category_id,
      name: m.name,
      description: m.description || '',
      pricePaise: m.price_paise,
      vegType: m.veg_type || 'veg',
      gstPercent: Number(m.gst_percent) || 5,
      isAvailable: m.is_available,
      preparationTimeMins: m.preparation_time_mins || 15,
      isBestseller: m.is_bestseller,
      salesCount: m.sales_count,
      demoFlag: m.demo_flag,
    }));
  }

  // Tables
  if (tablesRes.data && tablesRes.data.length > 0) {
    localDb.tables = tablesRes.data.map((t) => ({
      id: t.id,
      tableNumber: t.table_number,
      section: t.section,
      capacity: t.capacity,
      status: t.status,
      currentOrderId: t.current_order_id,
      assignedSteward: t.assigned_steward,
      guestCount: t.guest_count,
      totalPaise: t.total_paise,
      lastUpdated: t.last_updated,
    }));
  }

  // Bills
  if (billsRes.data && billsRes.data.length > 0) {
    localDb.bills = billsRes.data.map((b) => ({
      id: b.id,
      billNumber: b.bill_number,
      orderId: b.order_id || `ord-${b.id}`,
      tableId: b.table_id || 'counter',
      tableNumber: b.table_number || 'Takeaway',
      guestCount: b.guest_count || 1,
      stewardName: b.steward_name || 'Staff',
      items: b.items || [],
      subtotalPaise: b.subtotal_paise || 0,
      discountPercent: b.discount_percent || 0,
      discountPaise: b.discount_paise || 0,
      discountReason: b.discount_reason,
      discountApprovedBy: b.discount_approved_by,
      serviceChargePaise: b.service_charge_paise || 0,
      cgstPaise: b.cgst_paise || 0,
      sgstPaise: b.sgst_paise || 0,
      roundOffPaise: b.round_off_paise || 0,
      totalPaise: b.total_paise || 0,
      paymentStatus: b.payment_status || 'paid',
      paymentMode: b.payment_mode || 'cash',
      paymentDetails: b.payment_details,
      createdAt: b.created_at || new Date().toISOString(),
      settledAt: b.settled_at || new Date().toISOString(),
      demoFlag: Boolean(b.demo_flag),
    }));
  }

  // Staff
  if (staffRes.data && staffRes.data.length > 0) {
    localDb.staff = staffRes.data.map((s) => ({
      id: s.id,
      employeeCode: s.employee_code || s.employee_id || `EMP-${s.id}`,
      fullName: s.full_name || s.name,
      role: s.role || 'Staff',
      department: s.department || 'Service',
      phone: s.phone || '',
      email: s.email || '',
      aadhaarNumber: s.aadhaar_number || '',
      familyDetails: s.family_details || '',
      currentAddress: s.current_address || '',
      permanentAddress: s.permanent_address || '',
      dateOfJoining: s.joined_date || s.date_of_joining || '2024-01-01',
      salaryType: s.salary_type || 'monthly',
      baseSalaryPaise: s.salary_paise || s.base_salary_paise || 2000000,
      bankAccountNumber: s.bank_account_number || '',
      bankIfsc: s.bank_ifsc || '',
      bankName: s.bank_name || '',
      emergencyContactName: s.emergency_contact_name || '',
      emergencyContactPhone: s.emergency_contact_phone || '',
      photoUrl: s.photo_url || s.avatar_url || '',
      hasFaceEnrolled: Boolean(s.has_face_enrolled),
      faceEmbeddingId: s.face_embedding_id,
      faceDescriptor: s.face_descriptor,
      isActive: s.status === 'active' || s.is_active !== false,
      demoFlag: s.demo_flag,
    }));
  }

  // Inventory
  if (inventoryRes.data && inventoryRes.data.length > 0) {
    localDb.inventory = inventoryRes.data.map((i) => ({
      id: i.id,
      itemCode: i.item_code || `INV-${i.id}`,
      name: i.name,
      category: i.category || 'Kitchen Supplies',
      unit: i.unit || 'kg',
      currentStock: Number(i.current_stock || 0),
      minimumReserve: Number(i.minimum_reserve || i.reorder_level || 5),
      costPerUnitPaise: Number(i.cost_per_unit_paise || 0),
      supplierId: i.supplier_id || '',
      supplierName: i.supplier_name || 'Local Vendor',
      lastRestockedDate: i.last_restocked || i.last_restocked_date || '2025-01-01',
      status: (Number(i.current_stock || 0) <= Number(i.minimum_reserve || i.reorder_level || 5)) ? 'low_stock' : 'in_stock',
      demoFlag: i.demo_flag,
    }));
  }

  // Users
  if (usersRes.data && usersRes.data.length > 0) {
    localDb.users = usersRes.data.map((u) => ({
      id: u.id,
      username: u.username,
      name: u.name,
      role: u.role,
      pin: u.pin,
      active: u.active,
      avatarUrl: u.avatar_url,
    }));
  }

  // Write updated local database
  fs.writeFileSync(dbPath, JSON.stringify(localDb, null, 2), 'utf-8');
  console.log('Successfully synchronized local database with Supabase cloud state!');
}

pullAndMerge();
