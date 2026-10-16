import { getSupabaseClient, getSupabaseAdminClient } from './supabase';
import { DatabaseSchema, MenuItem, RestaurantTable, Bill, Staff, InventoryItem, User, BusinessSettings } from './types';

/**
 * Pushes entire local database snapshot into Supabase PostgreSQL tables
 */
export async function pushAllDataToSupabase(db: DatabaseSchema): Promise<{
  success: boolean;
  message: string;
  counts: Record<string, number>;
  errors: string[];
}> {
  const client = getSupabaseAdminClient() || getSupabaseClient();
  if (!client) {
    return {
      success: false,
      message: 'Supabase client is not configured.',
      counts: {},
      errors: ['Missing Supabase credentials'],
    };
  }

  const counts: Record<string, number> = {};
  const errors: string[] = [];

  // 1. Settings (sanitized - never expose service role key to database)
  try {
    const { supabaseServiceRoleKey, ...safeSettings } = (db.settings as any) || {};
    const { error } = await client.from('business_settings').upsert({
      id: 'default',
      data: safeSettings,
      updated_at: new Date().toISOString(),
    });
    if (error) errors.push(`Settings: ${error.message}`);
    else counts.settings = 1;
  } catch (err: any) {
    errors.push(`Settings: ${err.message}`);
  }

  // 2. Categories
  try {
    if (db.categories.length > 0) {
      const records = db.categories.map((c) => ({
        id: c.id,
        name: c.name,
        icon: c.icon,
        sort_order: c.sortOrder,
      }));
      const { error } = await client.from('categories').upsert(records);
      if (error) errors.push(`Categories: ${error.message}`);
      else counts.categories = records.length;
    }
  } catch (err: any) {
    errors.push(`Categories: ${err.message}`);
  }

  // 3. Menu Items
  try {
    if (db.menuItems.length > 0) {
      const records = db.menuItems.map((m) => ({
        id: m.id,
        category_id: m.categoryId,
        name: m.name,
        description: m.description,
        price_paise: m.pricePaise,
        veg_type: m.vegType,
        gst_percent: m.gstPercent,
        is_available: m.isAvailable,
        preparation_time_mins: m.preparationTimeMins,
        is_bestseller: m.isBestseller ?? false,
        sales_count: m.salesCount ?? 0,
        demo_flag: m.demoFlag ?? false,
      }));
      const { error } = await client.from('menu_items').upsert(records);
      if (error) errors.push(`Menu Items: ${error.message}`);
      else counts.menuItems = records.length;
    }
  } catch (err: any) {
    errors.push(`Menu Items: ${err.message}`);
  }

  // 4. Tables
  try {
    if (db.tables.length > 0) {
      const records = db.tables.map((t) => ({
        id: t.id,
        table_number: t.tableNumber,
        section: t.section,
        capacity: t.capacity,
        status: t.status,
        current_order_id: t.currentOrderId || null,
        assigned_steward: t.assignedSteward || null,
        guest_count: t.guestCount || null,
        total_paise: t.totalPaise || 0,
        last_updated: t.lastUpdated || 'Just now',
      }));
      const { error } = await client.from('restaurant_tables').upsert(records);
      if (error) errors.push(`Tables: ${error.message}`);
      else counts.tables = records.length;
    }
  } catch (err: any) {
    errors.push(`Tables: ${err.message}`);
  }

  // 5. Staff
  try {
    if (db.staff.length > 0) {
      const records = db.staff.map((s: any) => ({
        id: s.id,
        employee_id: s.employeeCode || s.employeeId || s.id,
        full_name: s.fullName,
        role: s.role,
        department: s.department || 'Operations',
        phone: s.phone || null,
        email: s.email || null,
        salary_paise: s.baseSalaryPaise || s.salaryPaise || 0,
        joined_date: s.dateOfJoining || s.joinedDate || null,
        status: s.isActive !== undefined ? (s.isActive ? 'active' : 'inactive') : (s.status || 'active'),
        avatar_url: s.photoUrl || s.avatarUrl || null,
        demo_flag: s.demoFlag ?? false,
      }));
      const { error } = await client.from('staff').upsert(records);
      if (error) errors.push(`Staff: ${error.message}`);
      else counts.staff = records.length;
    }
  } catch (err: any) {
    errors.push(`Staff: ${err.message}`);
  }

  // 6. Inventory Items
  try {
    if (db.inventory.length > 0) {
      const records = db.inventory.map((i: any) => ({
        id: i.id,
        item_code: i.itemCode,
        name: i.name,
        category: i.category,
        current_stock: i.currentStock,
        unit: i.unit,
        reorder_level: i.minimumReserve || i.reorderLevel || 10,
        cost_per_unit_paise: i.costPerUnitPaise || i.unitCostPaise || 0,
        supplier_id: i.supplierId || null,
        supplier_name: i.supplierName || null,
        last_restocked: i.lastRestockedDate || i.lastRestocked || null,
        demo_flag: i.demoFlag ?? false,
      }));
      const { error } = await client.from('inventory_items').upsert(records);
      if (error) errors.push(`Inventory: ${error.message}`);
      else counts.inventory = records.length;
    }
  } catch (err: any) {
    errors.push(`Inventory: ${err.message}`);
  }

  // 7. Bills
  try {
    if (db.bills.length > 0) {
      const records = db.bills.map((b) => ({
        id: b.id,
        bill_number: b.billNumber,
        order_id: b.orderId,
        table_id: b.tableId,
        table_number: b.tableNumber,
        guest_count: b.guestCount,
        steward_name: b.stewardName,
        items: b.items,
        subtotal_paise: b.subtotalPaise,
        discount_percent: b.discountPercent,
        discount_paise: b.discountPaise,
        discount_reason: b.discountReason || null,
        discount_approved_by: b.discountApprovedBy || null,
        service_charge_paise: b.serviceChargePaise || 0,
        cgst_paise: b.cgstPaise,
        sgst_paise: b.sgstPaise,
        round_off_paise: b.roundOffPaise,
        total_paise: b.totalPaise,
        payment_mode: b.paymentMode || 'upi',
        payment_status: b.paymentStatus || 'paid',
        financial_year: (b as any).financialYear || '2024-25',
        is_audited: (b as any).isAudited ?? false,
        demo_flag: b.demoFlag ?? false,
      }));
      const { error } = await client.from('bills').upsert(records);
      if (error) errors.push(`Bills: ${error.message}`);
      else counts.bills = records.length;
    }
  } catch (err: any) {
    errors.push(`Bills: ${err.message}`);
  }

  // 8. Users
  try {
    if (db.users.length > 0) {
      const records = db.users.map((u) => ({
        id: u.id,
        username: u.username,
        name: u.name,
        role: u.role,
        pin: u.pin || '1234',
        active: u.active,
        avatar_url: u.avatarUrl || null,
      }));
      const { error } = await client.from('users').upsert(records);
      if (error) errors.push(`Users: ${error.message}`);
      else counts.users = records.length;
    }
  } catch (err: any) {
    errors.push(`Users: ${err.message}`);
  }

  // 9. Attendance
  try {
    if (db.attendance && db.attendance.length > 0) {
      const records = db.attendance.map((a: any) => ({
        id: a.id,
        staff_id: a.staffId,
        staff_name: a.staffName,
        date: a.date,
        status: a.status || 'present',
        check_in: a.checkInTime || null,
        check_out: a.checkOutTime || null,
        hours_worked: a.hoursWorked || 0,
        demo_flag: a.demoFlag ?? false,
      }));
      const { error } = await client.from('attendance').upsert(records);
      if (error) errors.push(`Attendance: ${error.message}`);
      else counts.attendance = records.length;
    }
  } catch (err: any) {
    errors.push(`Attendance: ${err.message}`);
  }

  const hasAnySuccess = Object.keys(counts).length > 0;
  return {
    success: hasAnySuccess && errors.length === 0,
    message: errors.length === 0
      ? 'All local data synchronized to Supabase PostgreSQL successfully!'
      : `Partial sync completed: ${errors.join('; ')}`,
    counts,
    errors,
  };
}

/**
 * Fetches data from Supabase if available
 */
export async function pullDatabaseFromSupabase(): Promise<{
  success: boolean;
  data?: Partial<DatabaseSchema>;
  error?: string;
}> {
  const client = getSupabaseClient();
  if (!client) {
    return { success: false, error: 'Supabase client not configured' };
  }

  try {
    const [
      settingsRes,
      categoriesRes,
      menuItemsRes,
      tablesRes,
      billsRes,
      staffRes,
      inventoryRes,
      usersRes,
    ] = await Promise.all([
      client.from('business_settings').select('*').eq('id', 'default').maybeSingle(),
      client.from('categories').select('*').order('sort_order', { ascending: true }),
      client.from('menu_items').select('*'),
      client.from('restaurant_tables').select('*'),
      client.from('bills').select('*').order('created_at', { ascending: false }).limit(200),
      client.from('staff').select('*'),
      client.from('inventory_items').select('*'),
      client.from('users').select('*'),
    ]);

    const partialDb: Partial<DatabaseSchema> = {};

    if (settingsRes.data?.data) {
      partialDb.settings = settingsRes.data.data;
    }

    if (categoriesRes.data && categoriesRes.data.length > 0) {
      partialDb.categories = categoriesRes.data.map((c: any) => ({
        id: c.id,
        name: c.name,
        icon: c.icon || 'restaurant',
        sortOrder: c.sort_order || 0,
      }));
    }

    if (menuItemsRes.data && menuItemsRes.data.length > 0) {
      partialDb.menuItems = menuItemsRes.data.map((m: any) => ({
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

    if (tablesRes.data && tablesRes.data.length > 0) {
      partialDb.tables = tablesRes.data.map((t: any) => ({
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

    if (billsRes.data && billsRes.data.length > 0) {
      partialDb.bills = billsRes.data.map((b: any) => ({
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

    if (staffRes.data && staffRes.data.length > 0) {
      partialDb.staff = staffRes.data.map((s: any) => ({
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

    if (inventoryRes.data && inventoryRes.data.length > 0) {
      partialDb.inventory = inventoryRes.data.map((i: any) => ({
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

    if (usersRes.data && usersRes.data.length > 0) {
      partialDb.users = usersRes.data.map((u: any) => ({
        id: u.id,
        username: u.username,
        name: u.name,
        role: u.role,
        pin: u.pin,
        active: u.active,
        avatarUrl: u.avatar_url,
      }));
    }

    return {
      success: true,
      data: partialDb,
    };
  } catch (err: any) {
    return {
      success: false,
      error: err.message,
    };
  }
}
