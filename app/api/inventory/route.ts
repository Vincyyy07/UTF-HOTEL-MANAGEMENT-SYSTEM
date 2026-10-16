import { NextResponse } from 'next/server';
import { getDatabase, saveDatabase, logAudit } from '../../../lib/db';
import { StockMovement, ExpenseEntry } from '../../../lib/types';
import { getLocalDateStr } from '../../../lib/dateUtils';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { action, userName, userRole } = body;
    const db = getDatabase();
    const todayStr = getLocalDateStr(new Date());

    if (action === 'STOCK_IN') {
      const { itemId, quantity, unitCostPaise, supplierId, invoiceNumber, notes } = body;
      const item = db.inventory.find((i) => i.id === itemId);
      if (!item) return NextResponse.json({ success: false, message: 'Item not found' }, { status: 404 });

      const supplier = db.suppliers.find((s) => s.id === supplierId || s.id === item.supplierId);
      const supplierName = supplier ? supplier.name : item.supplierName;
      const costPerUnit = unitCostPaise || item.costPerUnitPaise;
      const totalCostPaise = Math.round(costPerUnit * quantity);

      // 1. Update stock
      item.currentStock += Number(quantity);
      if (item.currentStock > item.minimumReserve) {
        item.status = 'in_stock';
      }
      item.lastRestockedDate = todayStr;

      // 2. Add stock movement
      const movement: StockMovement = {
        id: `sm-${Date.now()}`,
        itemId: item.id,
        itemName: item.name,
        type: 'in_purchase',
        quantity: Number(quantity),
        unit: item.unit,
        unitCostPaise: costPerUnit,
        totalCostPaise,
        supplierId: supplier?.id,
        supplierName,
        invoiceNumber: invoiceNumber || `INV-${Date.now().toString().slice(-4)}`,
        recordedBy: userName || 'Storekeeper',
        date: todayStr,
        notes,
        demoFlag: false,
      };
      db.stockMovements.unshift(movement);

      // 3. AUTO-POST to Finance (Procurement Expense)
      const expense: ExpenseEntry = {
        id: `exp-${Date.now()}`,
        category: 'Procurement',
        title: `${supplierName} - Purchase of ${quantity} ${item.unit} ${item.name}`,
        amountPaise: totalCostPaise,
        paymentMode: 'bank_transfer',
        payee: supplierName,
        referenceNumber: movement.invoiceNumber,
        date: todayStr,
        recordedBy: userName || 'Storekeeper',
        demoFlag: false,
      };
      db.expenses.unshift(expense);

      logAudit(db, userName || 'Storekeeper', userRole || 'kitchen', 'CREATE', 'INVENTORY_STOCK_IN', item.name, {
        newValue: `Added ${quantity} ${item.unit}. Stock now: ${item.currentStock} ${item.unit}. Auto-posted expense ₹${(totalCostPaise / 100).toLocaleString('en-IN')}`,
      });

      saveDatabase(db);
      return NextResponse.json({ success: true, item, movement, expense, data: db });
    }

    if (action === 'STOCK_OUT') {
      const { itemId, quantity, type = 'out_kitchen_usage', notes } = body;
      const item = db.inventory.find((i) => i.id === itemId);
      if (!item) return NextResponse.json({ success: false, message: 'Item not found' }, { status: 404 });

      item.currentStock = Math.max(0, item.currentStock - Number(quantity));
      if (item.currentStock <= item.minimumReserve) {
        item.status = item.currentStock === 0 ? 'critical' : 'low_stock';
      }

      const totalCostPaise = Math.round(item.costPerUnitPaise * quantity);

      const movement: StockMovement = {
        id: `sm-${Date.now()}`,
        itemId: item.id,
        itemName: item.name,
        type,
        quantity: Number(quantity),
        unit: item.unit,
        unitCostPaise: item.costPerUnitPaise,
        totalCostPaise,
        recordedBy: userName || 'Chef',
        date: todayStr,
        notes,
        demoFlag: false,
      };
      db.stockMovements.unshift(movement);

      logAudit(db, userName || 'Chef', userRole || 'kitchen', 'CREATE', 'INVENTORY_STOCK_OUT', item.name, {
        newValue: `Deducted ${quantity} ${item.unit} (${type}). Remaining: ${item.currentStock} ${item.unit}`,
      });

      saveDatabase(db);
      return NextResponse.json({ success: true, item, movement, data: db });
    }

    if (action === 'QUICK_REORDER') {
      const { itemId, quantity } = body;
      const item = db.inventory.find((i) => i.id === itemId);
      if (!item) return NextResponse.json({ success: false, message: 'Item not found' }, { status: 404 });

      // Add to upcoming liabilities
      const orderQuantity = quantity || (item.minimumReserve * 2);
      const estCost = Math.round(item.costPerUnitPaise * orderQuantity);

      db.liabilities.push({
        id: `liab-${Date.now()}`,
        title: `PO Reorder: ${item.name} (${orderQuantity} ${item.unit})`,
        amountPaise: estCost,
        dueDate: todayStr,
        category: 'Procurement',
        payee: item.supplierName,
        urgency: 'due_today',
        demoFlag: false,
      });

      logAudit(db, userName || 'Manager', userRole || 'manager', 'CREATE', 'PURCHASE_ORDER', item.name, {
        newValue: `Created PO Reorder for ${orderQuantity} ${item.unit} from ${item.supplierName}`,
      });

      saveDatabase(db);
      return NextResponse.json({ success: true, message: `PO Reorder triggered for ${item.name}`, data: db });
    }

    if (action === 'ADD_ITEM') {
      const { itemCode, name, category, unit, currentStock = 0, minimumReserve = 5, costPerUnit, supplierId, supplierName } = body;
      if (!name) return NextResponse.json({ success: false, message: 'Item name is required' }, { status: 400 });

      const supplier = db.suppliers.find((s) => s.id === supplierId);
      const assignedSupplierName = supplier ? supplier.name : supplierName || 'Local Supplier';

      const parsedCurrentStock = Number(currentStock) || 0;
      const parsedMinReserve = Number(minimumReserve) || 5;
      const parsedCostPerUnitPaise = Math.round((Number(costPerUnit) || 0) * 100);

      const newItem = {
        id: `inv-${Date.now()}`,
        itemCode: itemCode || `UFP-INV-${String(db.inventory.length + 1).padStart(3, '0')}`,
        name: name.trim(),
        category: category || 'Grains & Rice',
        unit: unit || 'kg',
        currentStock: parsedCurrentStock,
        minimumReserve: parsedMinReserve,
        costPerUnitPaise: parsedCostPerUnitPaise,
        supplierId: supplier?.id || '',
        supplierName: assignedSupplierName,
        lastRestockedDate: todayStr,
        status: (parsedCurrentStock <= parsedMinReserve ? (parsedCurrentStock === 0 ? 'critical' : 'low_stock') : 'in_stock') as any,
        demoFlag: false,
      };

      db.inventory.unshift(newItem);

      // If initial stock > 0, log initial movement
      if (parsedCurrentStock > 0) {
        db.stockMovements.unshift({
          id: `sm-${Date.now()}`,
          itemId: newItem.id,
          itemName: newItem.name,
          type: 'in_purchase',
          quantity: parsedCurrentStock,
          unit: newItem.unit,
          unitCostPaise: parsedCostPerUnitPaise,
          totalCostPaise: Math.round(parsedCostPerUnitPaise * parsedCurrentStock),
          supplierId: newItem.supplierId,
          supplierName: newItem.supplierName,
          invoiceNumber: 'INIT-OPENING',
          recordedBy: userName || 'Storekeeper',
          date: todayStr,
          notes: 'Opening stock balance entry',
          demoFlag: false,
        });
      }

      logAudit(db, userName || 'Manager', userRole || 'manager', 'CREATE', 'INVENTORY_ITEM', newItem.name, {
        newValue: `Registered item ${newItem.name} (${newItem.itemCode}) with opening stock ${newItem.currentStock} ${newItem.unit}`,
      });

      saveDatabase(db);
      return NextResponse.json({ success: true, item: newItem, data: db });
    }

    if (action === 'UPDATE_ITEM') {
      const { itemId, name, category, unit, minimumReserve, costPerUnit, supplierId } = body;
      const item = db.inventory.find((i) => i.id === itemId);
      if (!item) return NextResponse.json({ success: false, message: 'Item not found' }, { status: 404 });

      if (name) item.name = name.trim();
      if (category) item.category = category;
      if (unit) item.unit = unit;
      if (minimumReserve !== undefined) item.minimumReserve = Number(minimumReserve);
      if (costPerUnit !== undefined) item.costPerUnitPaise = Math.round(Number(costPerUnit) * 100);
      if (supplierId) {
        item.supplierId = supplierId;
        const sup = db.suppliers.find((s) => s.id === supplierId);
        if (sup) item.supplierName = sup.name;
      }

      item.status = item.currentStock <= item.minimumReserve ? (item.currentStock === 0 ? 'critical' : 'low_stock') : 'in_stock';

      logAudit(db, userName || 'Manager', userRole || 'manager', 'UPDATE', 'INVENTORY_ITEM', item.name, {
        newValue: `Updated ${item.name}: Min Reserve ${item.minimumReserve} ${item.unit}, Unit Cost ₹${item.costPerUnitPaise / 100}`,
      });

      saveDatabase(db);
      return NextResponse.json({ success: true, item, data: db });
    }

    if (action === 'DELETE_ITEM') {
      const { itemId } = body;
      const item = db.inventory.find((i) => i.id === itemId);
      if (!item) return NextResponse.json({ success: false, message: 'Item not found' }, { status: 404 });

      db.inventory = db.inventory.filter((i) => i.id !== itemId);

      logAudit(db, userName || 'Manager', userRole || 'manager', 'DELETE', 'INVENTORY_ITEM', item.name, {
        newValue: `Deleted ${item.name} (${item.itemCode}) from inventory`,
      });

      saveDatabase(db);
      return NextResponse.json({ success: true, message: 'Item deleted', data: db });
    }

    if (action === 'ADJUST_STOCK') {
      const { itemId, actualStock, reason = 'Physical Audit Reconciliation' } = body;
      const item = db.inventory.find((i) => i.id === itemId);
      if (!item) return NextResponse.json({ success: false, message: 'Item not found' }, { status: 404 });

      const prevStock = item.currentStock;
      const newStock = Number(actualStock);
      const diff = newStock - prevStock;

      item.currentStock = newStock;
      item.status = item.currentStock <= item.minimumReserve ? (item.currentStock === 0 ? 'critical' : 'low_stock') : 'in_stock';

      // Log movement to record the adjustment audit trail
      const diffTotalCostPaise = Math.round(Math.abs(diff) * item.costPerUnitPaise);
      db.stockMovements.unshift({
        id: `sm-${Date.now()}`,
        itemId: item.id,
        itemName: item.name,
        type: diff < 0 ? 'out_wastage_spoilage' : 'in_purchase',
        quantity: Math.abs(diff),
        unit: item.unit,
        unitCostPaise: item.costPerUnitPaise,
        totalCostPaise: diffTotalCostPaise,
        recordedBy: userName || 'Storekeeper Audit',
        date: todayStr,
        notes: `Physical Audit Reconciliation: ${diff >= 0 ? '+' : ''}${diff} ${item.unit} (${reason}). Book count was ${prevStock}, Actual shelf count is ${newStock}.`,
        demoFlag: false,
      });

      logAudit(db, userName || 'Storekeeper', userRole || 'manager', 'UPDATE', 'INVENTORY_AUDIT_ADJUSTMENT', item.name, {
        newValue: `Reconciled ${item.name}: Was ${prevStock} ${item.unit}, now ${newStock} ${item.unit} (Variance: ${diff >= 0 ? '+' : ''}${diff} ${item.unit}). Reason: ${reason}`,
      });

      saveDatabase(db);
      return NextResponse.json({ success: true, item, data: db });
    }

    if (action === 'ADD_SUPPLIER') {
      const { name, category, phone, email, contactPerson, gstin, address } = body;
      if (!name) return NextResponse.json({ success: false, message: 'Supplier name required' }, { status: 400 });

      const newSupplier = {
        id: `sup-${Date.now()}`,
        name: name.trim(),
        category: category || 'General Food & Provisions',
        phone: phone || '',
        email: email || '',
        contactPerson: contactPerson || '',
        gstin: gstin || '',
        address: address || '',
        demoFlag: false,
      };

      db.suppliers.push(newSupplier);

      logAudit(db, userName || 'Manager', userRole || 'manager', 'CREATE', 'SUPPLIER', newSupplier.name, {
        newValue: `Added new supplier ${newSupplier.name} (${newSupplier.category})`,
      });

      saveDatabase(db);
      return NextResponse.json({ success: true, supplier: newSupplier, data: db });
    }

    return NextResponse.json({ success: false, message: 'Unknown action' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 });
  }
}
