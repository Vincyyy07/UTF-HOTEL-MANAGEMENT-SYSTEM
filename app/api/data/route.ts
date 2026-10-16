import { NextResponse } from 'next/server';
import { getDatabase, saveDatabase, clearDemoData, restoreDemoData, logAudit } from '../../../lib/db';
import { MenuItem, User, RestaurantTable } from '../../../lib/types';

export async function GET() {
  try {
    const db = getDatabase();
    return NextResponse.json({ success: true, data: db });
  } catch (error) {
    return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { action } = body;
    const db = getDatabase();

    if (action === 'CLEAR_DEMO_DATA') {
      const { confirmationText, adminPassword, userName } = body;
      const res = clearDemoData(confirmationText, adminPassword, userName || 'Rajeshvardhan M.');
      if (!res.success) {
        return NextResponse.json({ success: false, message: res.message }, { status: 400 });
      }
      return NextResponse.json({ success: true, message: res.message, backupPath: res.backupPath, data: getDatabase() });
    }

    if (action === 'RESTORE_DEMO_DATA') {
      const { userName } = body;
      const res = restoreDemoData(userName || 'Rajeshvardhan M.');
      return NextResponse.json({ success: true, message: res.message, data: getDatabase() });
    }

    if (action === 'UPDATE_SETTINGS') {
      const { settings, userName, userRole } = body;
      const oldSettings = { ...db.settings };
      db.settings = { ...db.settings, ...settings };
      logAudit(db, userName || 'Admin', userRole || 'admin', 'UPDATE', 'SETTINGS', 'BUSINESS', {
        oldValue: JSON.stringify({ name: oldSettings.restaurantName, gstin: oldSettings.gstin }),
        newValue: JSON.stringify({ name: db.settings.restaurantName, gstin: db.settings.gstin }),
        reason: 'Business profile updated by Admin',
      });
      saveDatabase(db);
      return NextResponse.json({ success: true, data: db });
    }

    // --- ADMIN MENU MANAGEMENT ---
    if (action === 'ADD_MENU_ITEM') {
      const {
        name,
        categoryId,
        categoryName,
        pricePaise,
        priceRs,
        vegType,
        description,
        preparationTimeMins,
        gstPercent,
        isAvailable,
        isBestseller,
        imageUrl,
        userName,
        userRole,
      } = body;

      if (!name || (!pricePaise && !priceRs)) {
        return NextResponse.json({ success: false, message: 'Item name and price are required.' }, { status: 400 });
      }

      let assignedCatId = categoryId || 'cat-1';
      if (categoryName && !db.categories.some((c) => c.id === assignedCatId)) {
        assignedCatId = `cat-${Date.now()}`;
        db.categories.push({
          id: assignedCatId,
          name: categoryName,
          icon: 'restaurant',
          sortOrder: db.categories.length + 1,
        });
      }

      const newItem: MenuItem = {
        id: `item-${Date.now()}`,
        categoryId: assignedCatId,
        name: name.trim(),
        description: description?.trim() || '',
        pricePaise: Number(pricePaise) || Math.round(Number(priceRs) * 100),
        vegType: vegType || 'veg',
        gstPercent: Number(gstPercent) || 5,
        isAvailable: isAvailable !== false,
        preparationTimeMins: Number(preparationTimeMins) || 15,
        isBestseller: !!isBestseller,
        imageUrl: imageUrl || undefined,
        salesCount: 0,
        demoFlag: false,
      };

      db.menuItems.unshift(newItem);

      logAudit(db, userName || 'Admin', userRole || 'admin', 'CREATE', 'MENU_ITEM', newItem.id, {
        newValue: `${newItem.name} (₹${(newItem.pricePaise / 100).toFixed(0)})`,
        reason: 'Admin added dish to processing billing menu',
      });

      saveDatabase(db);
      return NextResponse.json({ success: true, message: 'Menu item created successfully', data: db, newItem });
    }

    if (action === 'UPDATE_MENU_ITEM') {
      const { itemId, updates, userName, userRole } = body;
      const index = db.menuItems.findIndex((i) => i.id === itemId);
      if (index === -1) {
        return NextResponse.json({ success: false, message: 'Menu item not found.' }, { status: 404 });
      }

      const oldItem = db.menuItems[index];
      db.menuItems[index] = {
        ...oldItem,
        ...updates,
        pricePaise: updates.priceRs ? Math.round(Number(updates.priceRs) * 100) : updates.pricePaise ?? oldItem.pricePaise,
      };

      logAudit(db, userName || 'Admin', userRole || 'admin', 'UPDATE', 'MENU_ITEM', itemId, {
        oldValue: `${oldItem.name} - ₹${(oldItem.pricePaise / 100).toFixed(0)}`,
        newValue: `${db.menuItems[index].name} - ₹${(db.menuItems[index].pricePaise / 100).toFixed(0)}`,
        reason: 'Menu item updated by Admin',
      });

      saveDatabase(db);
      return NextResponse.json({ success: true, message: 'Menu item updated successfully', data: db });
    }

    if (action === 'DELETE_MENU_ITEM') {
      const { itemId, userName, userRole } = body;
      const itemToDelete = db.menuItems.find((i) => i.id === itemId);
      if (!itemToDelete) {
        return NextResponse.json({ success: false, message: 'Menu item not found.' }, { status: 404 });
      }

      db.menuItems = db.menuItems.filter((i) => i.id !== itemId);

      logAudit(db, userName || 'Admin', userRole || 'admin', 'DELETE', 'MENU_ITEM', itemId, {
        oldValue: itemToDelete.name,
        reason: 'Menu item removed by Admin',
      });

      saveDatabase(db);
      return NextResponse.json({ success: true, message: 'Menu item deleted successfully', data: db });
    }

    // --- ADMIN ACCESS SETUP & ROLE PERMISSIONS ---
    if (action === 'UPDATE_ROLE_PERMISSIONS') {
      const { rolePermissions, userName, userRole } = body;
      if (!db.settings.rolePermissions) {
        db.settings.rolePermissions = {};
      }
      db.settings.rolePermissions = {
        ...db.settings.rolePermissions,
        ...rolePermissions,
      };

      logAudit(db, userName || 'Admin', userRole || 'admin', 'UPDATE', 'ACCESS_CONTROL', 'ROLE_PERMISSIONS', {
        newValue: 'Updated role capability flags',
        reason: 'Admin modified system-wide role permissions',
      });

      saveDatabase(db);
      return NextResponse.json({ success: true, message: 'Access permissions updated successfully', data: db });
    }

    // --- ADMIN USER MANAGEMENT ---
    if (action === 'ADD_USER') {
      const { name, username, role, pin, userName: adminName, userRole: adminRole } = body;
      if (!name || !username || !role) {
        return NextResponse.json({ success: false, message: 'Name, username, and role are required.' }, { status: 400 });
      }

      const newUser: User = {
        id: `usr-${Date.now()}`,
        name: name.trim(),
        username: username.trim().toLowerCase(),
        role,
        pin: pin || '1234',
        active: true,
      };

      db.users.push(newUser);

      logAudit(db, adminName || 'Admin', adminRole || 'admin', 'CREATE', 'USER', newUser.id, {
        newValue: `${newUser.name} (${newUser.role})`,
        reason: 'New system operator registered by Admin',
      });

      saveDatabase(db);
      return NextResponse.json({ success: true, message: 'User added successfully', data: db, newUser });
    }

    if (action === 'UPDATE_USER') {
      const { userId, updates, userName: adminName, userRole: adminRole } = body;
      const index = db.users.findIndex((u) => u.id === userId);
      if (index === -1) {
        return NextResponse.json({ success: false, message: 'User not found.' }, { status: 404 });
      }

      db.users[index] = { ...db.users[index], ...updates };

      logAudit(db, adminName || 'Admin', adminRole || 'admin', 'UPDATE', 'USER', userId, {
        newValue: JSON.stringify(updates),
        reason: 'User profile updated by Admin',
      });

      saveDatabase(db);
      return NextResponse.json({ success: true, message: 'User updated successfully', data: db });
    }

    if (action === 'DELETE_USER') {
      const { userId, userName: adminName, userRole: adminRole } = body;
      if (adminRole !== 'admin') {
        return NextResponse.json({ success: false, message: 'Only administrators have authority to delete user accounts.' }, { status: 403 });
      }

      const index = db.users.findIndex((u) => u.id === userId);
      if (index === -1) {
        return NextResponse.json({ success: false, message: 'User account not found.' }, { status: 404 });
      }

      const targetUser = db.users[index];
      if (db.users.length <= 1) {
        return NextResponse.json({ success: false, message: 'Cannot delete the sole remaining user account.' }, { status: 400 });
      }

      db.users.splice(index, 1);

      logAudit(db, adminName || 'Admin', adminRole || 'admin', 'DELETE', 'USER', userId, {
        oldValue: `${targetUser.name} (${targetUser.username} / ${targetUser.role})`,
        reason: 'User operator account deleted by Admin',
      });

      saveDatabase(db);
      return NextResponse.json({ success: true, message: `User ${targetUser.name} deleted successfully.`, data: db });
    }

    // --- ADMIN TABLE & FLOOR MANAGEMENT ---
    if (action === 'ADD_TABLE') {
      const { tableNumber, section, capacity, status, userName: adminName, userRole: adminRole } = body;
      if (!tableNumber || !tableNumber.trim()) {
        return NextResponse.json({ success: false, message: 'Table number is required.' }, { status: 400 });
      }

      const trimmedNumber = tableNumber.trim().toUpperCase();
      if (db.tables.some((t) => t.tableNumber.toUpperCase() === trimmedNumber)) {
        return NextResponse.json({ success: false, message: `Table ${trimmedNumber} already exists on the floor.` }, { status: 400 });
      }

      const newTable: RestaurantTable = {
        id: `tbl-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        tableNumber: trimmedNumber,
        section: section?.trim() || 'AC Grand Hall',
        capacity: Number(capacity) > 0 ? Number(capacity) : 4,
        status: status || 'vacant',
        totalPaise: 0,
        lastUpdated: 'Just now',
      };

      db.tables.push(newTable);

      logAudit(db, adminName || 'Admin', adminRole || 'admin', 'CREATE', 'TABLE', newTable.id, {
        newValue: `${newTable.tableNumber} - ${newTable.section} (${newTable.capacity} Seater)`,
        reason: 'New dining table added by Admin',
      });

      saveDatabase(db);
      return NextResponse.json({ success: true, message: `Table ${newTable.tableNumber} added successfully.`, data: db, newTable });
    }

    if (action === 'UPDATE_TABLE') {
      const { tableId, updates, userName: adminName, userRole: adminRole } = body;
      const index = db.tables.findIndex((t) => t.id === tableId);
      if (index === -1) {
        return NextResponse.json({ success: false, message: 'Table not found.' }, { status: 404 });
      }

      const oldTable = db.tables[index];

      // If table number is changing, verify no collision
      if (updates.tableNumber && updates.tableNumber.trim().toUpperCase() !== oldTable.tableNumber.toUpperCase()) {
        const nextNum = updates.tableNumber.trim().toUpperCase();
        if (db.tables.some((t) => t.id !== tableId && t.tableNumber.toUpperCase() === nextNum)) {
          return NextResponse.json({ success: false, message: `Table ${nextNum} already exists on the floor.` }, { status: 400 });
        }
        updates.tableNumber = nextNum;
      }

      if (updates.capacity) {
        updates.capacity = Number(updates.capacity) > 0 ? Number(updates.capacity) : oldTable.capacity;
      }

      db.tables[index] = {
        ...oldTable,
        ...updates,
        lastUpdated: 'Just now',
      };

      logAudit(db, adminName || 'Admin', adminRole || 'admin', 'UPDATE', 'TABLE', tableId, {
        oldValue: `${oldTable.tableNumber} (${oldTable.section}, ${oldTable.capacity}p, ${oldTable.status})`,
        newValue: `${db.tables[index].tableNumber} (${db.tables[index].section}, ${db.tables[index].capacity}p, ${db.tables[index].status})`,
        reason: 'Table configuration updated by Admin',
      });

      saveDatabase(db);
      return NextResponse.json({ success: true, message: `Table ${db.tables[index].tableNumber} updated successfully.`, data: db });
    }

    if (action === 'DELETE_TABLE') {
      const { tableId, force, userName: adminName, userRole: adminRole } = body;
      const index = db.tables.findIndex((t) => t.id === tableId);
      if (index === -1) {
        return NextResponse.json({ success: false, message: 'Table not found.' }, { status: 404 });
      }

      const targetTable = db.tables[index];

      // Check if table currently has an active order
      const hasActiveOrder = (targetTable.status === 'occupied' || targetTable.status === 'bill_printed') &&
        db.orders.some((o) => o.tableId === tableId && o.status !== 'settled' && o.status !== 'cancelled');

      if (hasActiveOrder && !force) {
        return NextResponse.json({
          success: false,
          message: `Cannot delete Table ${targetTable.tableNumber} because it currently has an active unpaid order. Please settle or cancel the order first.`,
        }, { status: 400 });
      }

      db.tables.splice(index, 1);

      logAudit(db, adminName || 'Admin', adminRole || 'admin', 'DELETE', 'TABLE', tableId, {
        oldValue: `${targetTable.tableNumber} - ${targetTable.section} (${targetTable.capacity} Seater)`,
        reason: 'Table removed from floor layout by Admin',
      });

      saveDatabase(db);
      return NextResponse.json({ success: true, message: `Table ${targetTable.tableNumber} deleted successfully.`, data: db });
    }

    return NextResponse.json({ success: false, message: 'Unknown action' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 });
  }
}
