import { NextResponse } from 'next/server';
import { getDatabase, saveDatabase, logAudit } from '../../../lib/db';
import { Bill, BillItemSnapshot, Order, OrderItem } from '../../../lib/types';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { action, userName, userRole } = body;
    const db = getDatabase();

    if (action === 'SETTLE_BILL') {
      const {
        tableId,
        items,
        stewardName,
        guestCount,
        discountPercent = 0,
        discountReason,
        discountApprovedBy,
        paymentMode = 'upi',
        paymentDetails = {},
      } = body;

      const table = db.tables.find((t) => t.id === tableId);
      const tableName = table ? table.tableNumber : 'Counter';

      // 1. Calculate totals in paise (integers)
      let subtotalPaise = 0;
      const snapshots: BillItemSnapshot[] = items.map((item: any) => {
        const itemTotal = item.pricePaise * item.quantity;
        subtotalPaise += itemTotal;
        return {
          menuItemId: item.menuItemId || item.id,
          name: item.name,
          pricePaise: item.pricePaise,
          quantity: item.quantity,
          totalPaise: itemTotal,
          gstPercent: item.gstPercent || 5,
        };
      });

      const discountPaise = Math.round((subtotalPaise * discountPercent) / 100);
      const taxablePaise = subtotalPaise - discountPaise;
      
      const cgstPaise = Math.round((taxablePaise * (db.settings.cgstPercent || 2.5)) / 100);
      const sgstPaise = Math.round((taxablePaise * (db.settings.sgstPercent || 2.5)) / 100);
      
      let serviceChargePaise = 0;
      if (db.settings.serviceChargeEnabled && db.settings.serviceChargePercent > 0) {
        serviceChargePaise = Math.round((taxablePaise * db.settings.serviceChargePercent) / 100);
      }

      const grossPaise = taxablePaise + cgstPaise + sgstPaise + serviceChargePaise;
      const roundedTotalPaise = db.settings.roundOff ? Math.round(grossPaise / 100) * 100 : grossPaise;
      const roundOffPaise = roundedTotalPaise - grossPaise;

      // 2. Sequential bill number (cannot be reused)
      const currentSeq = db.nextBillSequence++;
      const billNumber = `UFP-2025-${String(currentSeq).padStart(4, '0')}`;

      // Find active order for this table if any
      const openOrder = tableId
        ? db.orders.find((o) => o.tableId === tableId && o.status !== 'settled' && o.status !== 'cancelled')
        : undefined;
      const linkedOrderId = openOrder?.id || table?.currentOrderId || `ord-${Date.now()}`;

      const newBill: Bill = {
        id: `bill-${Date.now()}-${currentSeq}`,
        billNumber,
        orderId: linkedOrderId,
        tableId: tableId || 'counter',
        tableNumber: tableName,
        guestCount: guestCount || 2,
        stewardName: stewardName || 'Arun Kumar',
        items: snapshots,
        subtotalPaise,
        discountPercent,
        discountPaise,
        discountReason,
        discountApprovedBy,
        serviceChargePaise,
        cgstPaise,
        sgstPaise,
        roundOffPaise,
        totalPaise: roundedTotalPaise,
        paymentStatus: 'paid',
        paymentMode,
        paymentDetails,
        createdAt: new Date().toISOString(),
        settledAt: new Date().toISOString(),
        demoFlag: false,
      };

      db.bills.unshift(newBill);

      // 3. Reset table status to vacant
      if (table) {
        table.status = 'vacant';
        table.assignedSteward = undefined;
        table.currentOrderId = undefined;
        table.guestCount = undefined;
        table.kitchenStage = undefined;
        table.totalPaise = 0;
        table.lastUpdated = 'Just now';
      }

      // Mark any open order for this table as settled
      if (openOrder) {
        openOrder.status = 'settled';
        openOrder.kitchenStage = 'served';
        openOrder.updatedAt = new Date().toISOString();
      } else if (tableId) {
        const remainingOpen = db.orders.find((o) => o.tableId === tableId && o.status !== 'settled' && o.status !== 'cancelled');
        if (remainingOpen) {
          remainingOpen.status = 'settled';
          remainingOpen.kitchenStage = 'served';
          remainingOpen.updatedAt = new Date().toISOString();
        }
      }

      // 4. Update salesCount for menu items
      snapshots.forEach((snap) => {
        const mItem = db.menuItems.find((m) => m.id === snap.menuItemId || m.name === snap.name);
        if (mItem) {
          mItem.salesCount = (mItem.salesCount || 0) + snap.quantity;
        }
      });

      logAudit(db, userName || 'Cashier', userRole || 'cashier', 'CREATE', 'BILL', billNumber, {
        newValue: `Settled ₹${(roundedTotalPaise / 100).toLocaleString('en-IN')} via ${paymentMode.toUpperCase()}`,
        reason: `Table ${tableName} Bill Settlement`,
      });

      saveDatabase(db);
      return NextResponse.json({ success: true, bill: newBill, data: db });
    }

    if (action === 'UPDATE_TABLE_STATUS') {
      const { tableId, status, guestCount, stewardName, totalPaise } = body;
      const table = db.tables.find((t) => t.id === tableId);
      if (!table) return NextResponse.json({ success: false, message: 'Table not found' }, { status: 404 });

      table.status = status;
      if (guestCount !== undefined) table.guestCount = guestCount;
      if (stewardName !== undefined) table.assignedSteward = stewardName;
      if (totalPaise !== undefined) table.totalPaise = totalPaise;
      table.lastUpdated = 'Just now';

      logAudit(db, userName || 'Floor Staff', userRole || 'waiter', 'UPDATE', 'TABLE', table.tableNumber, {
        newValue: `Status changed to ${status}`,
      });

      saveDatabase(db);
      return NextResponse.json({ success: true, table, data: db });
    }

    if (action === 'MOVE_TABLE') {
      const { sourceTableId, targetTableId } = body;
      const source = db.tables.find((t) => t.id === sourceTableId);
      const target = db.tables.find((t) => t.id === targetTableId);

      if (!source || !target) {
        return NextResponse.json({ success: false, message: 'Source or target table not found' }, { status: 404 });
      }

      // Transfer state
      target.status = source.status;
      target.assignedSteward = source.assignedSteward;
      target.guestCount = source.guestCount;
      target.totalPaise = source.totalPaise;
      target.currentOrderId = source.currentOrderId;
      target.lastUpdated = 'Just now';

      // Update active orders associated with source table to point to target table
      db.orders.forEach((ord) => {
        if (ord.tableId === sourceTableId && ord.status !== 'settled' && ord.status !== 'cancelled') {
          ord.tableId = targetTableId;
          ord.tableNumber = target.tableNumber;
          ord.updatedAt = new Date().toISOString();
        }
      });

      // Reset source
      source.status = 'vacant';
      source.assignedSteward = undefined;
      source.guestCount = undefined;
      source.totalPaise = 0;
      source.currentOrderId = undefined;
      source.lastUpdated = 'Just now';

      logAudit(db, userName || 'Captain', userRole || 'waiter', 'UPDATE', 'TABLE', `${source.tableNumber} -> ${target.tableNumber}`, {
        reason: `Moved guests and active order from ${source.tableNumber} to ${target.tableNumber}`,
      });

      saveDatabase(db);
      return NextResponse.json({ success: true, data: db });
    }

    if (action === 'CANCEL_BILL') {
      const { billId, reason } = body;
      if (!reason) {
        return NextResponse.json({ success: false, message: 'Cancellation reason is mandatory' }, { status: 400 });
      }
      const bill = db.bills.find((b) => b.id === billId);
      if (!bill) return NextResponse.json({ success: false, message: 'Bill not found' }, { status: 404 });

      bill.paymentStatus = 'cancelled';
      bill.cancellationReason = reason;

      logAudit(db, userName || 'Manager', userRole || 'manager', 'CANCEL_BILL', 'BILL', bill.billNumber, {
        oldValue: `₹${(bill.totalPaise / 100).toLocaleString('en-IN')}`,
        newValue: 'CANCELLED',
        reason,
      });

      saveDatabase(db);
      return NextResponse.json({ success: true, bill, data: db });
    }

    if (action === 'SEND_TO_KITCHEN') {
      const { tableId, items, stewardName, guestCount, notes } = body;
      const table = db.tables.find((t) => t.id === tableId);
      if (!table) {
        return NextResponse.json({ success: false, message: 'Table not found' }, { status: 404 });
      }

      if (!items || items.length === 0) {
        return NextResponse.json({ success: false, message: 'No items in order ticket' }, { status: 400 });
      }

      const currentSeq = db.nextOrderSequence ? db.nextOrderSequence++ : 201;
      const orderNumber = `KOT-${String(currentSeq).padStart(3, '0')}`;

      let subtotalPaise = 0;
      const orderItems: OrderItem[] = items.map((it: any) => {
        const itemTotal = (it.pricePaise || (it.item && it.item.pricePaise) || 0) * (it.quantity || 1);
        subtotalPaise += itemTotal;
        return {
          id: `item-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
          menuItemId: it.menuItemId || (it.item && it.item.id) || it.id,
          name: it.name || (it.item && it.item.name) || 'Dish',
          pricePaise: it.pricePaise || (it.item && it.item.pricePaise) || 0,
          quantity: it.quantity || 1,
          notes: it.notes || notes || '',
          kotStatus: 'sent',
          kotTime: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
        };
      });

      // Find if table already has an active pending/cooking order
      let existingOrder = db.orders.find(
        (o) => o.tableId === table.id && o.status !== 'settled' && o.status !== 'cancelled'
      );

      let targetOrder: Order;
      if (existingOrder) {
        existingOrder.items = orderItems;
        existingOrder.status = 'sent_to_kitchen';
        existingOrder.kitchenStage = 'pending';
        existingOrder.updatedAt = new Date().toISOString();
        if (guestCount) existingOrder.guestCount = guestCount;
        if (stewardName) existingOrder.stewardName = stewardName;
        targetOrder = existingOrder;
      } else {
        targetOrder = {
          id: `ord-${Date.now()}-${currentSeq}`,
          tableId: table.id,
          tableNumber: table.tableNumber,
          orderNumber,
          stewardName: stewardName || userName || 'Steward',
          guestCount: guestCount || table.guestCount || 2,
          items: orderItems,
          status: 'sent_to_kitchen',
          kitchenStage: 'pending',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          demoFlag: false,
        };
        db.orders.unshift(targetOrder);
      }

      // Update Table state
      table.status = 'occupied';
      table.currentOrderId = targetOrder.id;
      table.assignedSteward = targetOrder.stewardName;
      table.guestCount = targetOrder.guestCount;
      table.kitchenStage = 'pending';
      table.totalPaise = subtotalPaise;
      table.lastUpdated = 'KOT Sent to Kitchen';

      logAudit(db, userName || 'Steward', userRole || 'waiter', 'CREATE', 'ORDER', targetOrder.orderNumber, {
        newValue: `${orderItems.length} items sent to Kitchen for Table ${table.tableNumber}`,
        reason: `Kitchen Order Ticket (KOT) Generated`,
      });

      saveDatabase(db);
      return NextResponse.json({ success: true, order: targetOrder, table, data: db });
    }

    if (action === 'UPDATE_KITCHEN_ORDER_STAGE') {
      const { orderId, stage } = body; // stage: 'accepted' (50% swipe) | 'ready' (100% swipe) | 'served'
      const order = db.orders.find((o) => o.id === orderId);
      if (!order) {
        return NextResponse.json({ success: false, message: 'Order not found' }, { status: 404 });
      }

      const table = db.tables.find((t) => t.id === order.tableId);

      if (stage === 'accepted') {
        order.status = 'preparing';
        order.kitchenStage = 'accepted';
        order.kitchenAcceptedAt = new Date().toISOString();
        order.updatedAt = new Date().toISOString();
        if (table) {
          table.kitchenStage = 'accepted';
          table.lastUpdated = 'Cooking in Kitchen (50%)';
        }
        logAudit(db, userName || 'Kitchen Staff', userRole || 'kitchen', 'UPDATE', 'ORDER', order.orderNumber, {
          newValue: 'Accepted by Kitchen (Cooking in Progress)',
          reason: 'Kitchen staff swiped to 50%',
        });
      } else if (stage === 'ready') {
        order.status = 'ready_for_pickup';
        order.kitchenStage = 'ready';
        order.kitchenReadyAt = new Date().toISOString();
        order.updatedAt = new Date().toISOString();
        if (table) {
          table.kitchenStage = 'ready';
          table.lastUpdated = 'Food Ready for Pickup! (100%)';
        }
        logAudit(db, userName || 'Kitchen Staff', userRole || 'kitchen', 'UPDATE', 'ORDER', order.orderNumber, {
          newValue: 'Food Ready for Pickup / Collected',
          reason: 'Kitchen staff swiped to 100%',
        });
      } else if (stage === 'served') {
        order.status = 'served';
        order.kitchenStage = 'served';
        order.updatedAt = new Date().toISOString();
        if (table) {
          table.kitchenStage = 'served';
          table.lastUpdated = 'Food Served to Table';
        }
        logAudit(db, userName || 'Kitchen Staff', userRole || 'kitchen', 'UPDATE', 'ORDER', order.orderNumber, {
          newValue: 'Marked Food Collected / Served',
          reason: 'Kitchen cleared ticket',
        });
      } else if (stage === 'pending') {
        order.status = 'sent_to_kitchen';
        order.kitchenStage = 'pending';
        order.kitchenAcceptedAt = undefined;
        order.kitchenReadyAt = undefined;
        order.updatedAt = new Date().toISOString();
        if (table) {
          table.kitchenStage = 'pending';
          table.lastUpdated = 'KOT Sent to Kitchen';
        }
        logAudit(db, userName || 'Kitchen Staff', userRole || 'kitchen', 'UPDATE', 'ORDER', order.orderNumber, {
          newValue: 'Reverted to Incoming Ticket (Pending)',
          reason: 'Kitchen staff reverted order stage',
        });
      }

      saveDatabase(db);
      return NextResponse.json({ success: true, order, table, data: db });
    }

    return NextResponse.json({ success: false, message: 'Unknown action' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 });
  }
}
