'use client';

import React, { useState, useEffect } from 'react';
import { DatabaseSchema, RestaurantTable, MenuItem, Bill, User } from '../lib/types';
import { ThermalReceiptModal } from './ThermalReceiptModal';

interface BillingPOSModuleProps {
  db: DatabaseSchema;
  currentUser: User;
  selectedTable: RestaurantTable | null;
  onSelectTable: (table: RestaurantTable | null) => void;
  onSettleBill: (billData: any) => Promise<Bill | null>;
  onUpdateTableStatus: (tableId: string, status: any, details?: any) => Promise<void>;
  onMoveTable: (sourceId: string, targetId: string) => Promise<void>;
  onCancelBill: (billId: string, reason: string) => Promise<void>;
  onAddMenuItem?: (data: any) => Promise<any>;
  onSendToKitchen?: (tableId: string, items: any[], guestCount?: number, stewardName?: string, notes?: string) => Promise<any>;
  onOpenOrderAlerts?: () => void;
  orderAlertsCount?: number;
}

export const BillingPOSModule: React.FC<BillingPOSModuleProps> = ({
  db,
  currentUser,
  selectedTable,
  onSelectTable,
  onSettleBill,
  onUpdateTableStatus,
  onMoveTable,
  onCancelBill,
  onAddMenuItem,
  onSendToKitchen,
  onOpenOrderAlerts,
  orderAlertsCount = 0,
}) => {
  // Category & Filter state
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [vegFilter, setVegFilter] = useState<'all' | 'veg' | 'non-veg'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Add Dish Modal State
  const [showAddDishModal, setShowAddDishModal] = useState(false);
  const [newDishName, setNewDishName] = useState('');
  const [newDishCat, setNewDishCat] = useState(db.categories[0]?.id || 'cat-1');
  const [newDishCustomCat, setNewDishCustomCat] = useState('');
  const [newDishPrice, setNewDishPrice] = useState('');
  const [newDishVegType, setNewDishVegType] = useState<'veg' | 'non-veg' | 'egg'>('veg');
  const [newDishDesc, setNewDishDesc] = useState('');
  const [newDishPrepTime, setNewDishPrepTime] = useState('15');
  const [newDishIsBestseller, setNewDishIsBestseller] = useState(false);
  const [newDishImageFile, setNewDishImageFile] = useState<File | null>(null);
  const [addDishLoading, setAddDishLoading] = useState(false);
  
  // Cart items
  const [cartItems, setCartItems] = useState<{ item: MenuItem; quantity: number; notes?: string }[]>([]);
  const [guestCount, setGuestCount] = useState(4);
  const [stewardName, setStewardName] = useState('Arun Kumar');
  const [discountPercent, setDiscountPercent] = useState(0);
  const [managerPin, setManagerPin] = useState('');
  const [discountReason, setDiscountReason] = useState('');

  // Kitchen KOT state
  const [sendingToKitchen, setSendingToKitchen] = useState(false);
  const [kitchenNotice, setKitchenNotice] = useState<string | null>(null);
  
  // Modals
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showMoveTableModal, setShowMoveTableModal] = useState(false);
  const [targetTableId, setTargetTableId] = useState('');
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [selectedBillForCancel, setSelectedBillForCancel] = useState<Bill | null>(null);
  const [activeReceiptBill, setActiveReceiptBill] = useState<Bill | null>(null);
  const [isSettlingBill, setIsSettlingBill] = useState(false);
  const [isMovingTable, setIsMovingTable] = useState(false);
  const [isCancellingBill, setIsCancellingBill] = useState(false);
  
  // Payment settlement state - UPI and Cash ONLY
  const [paymentMode, setPaymentMode] = useState<'upi' | 'cash' | 'card'>('upi');

  // Mobile segmented view (tables vs order)
  const [mobilePosTab, setMobilePosTab] = useState<'tables' | 'order'>('tables');

  // Seater Capacity filter (4 Seater, 6 Seater, Family Seater 8-10)
  const [activeSection, setActiveSection] = useState<'All Tables' | '4 Seater' | '6 Seater' | 'Family Seater (8-10)'>('All Tables');

  // Per-table order cache to keep items persistent per table
  const [tableCartMap, setTableCartMap] = useState<Record<string, { item: MenuItem; quantity: number; notes?: string }[]>>({});

  // Per-table snapshot of quantities already sent to kitchen
  const [sentCartSnapshotMap, setSentCartSnapshotMap] = useState<Record<string, Record<string, number>>>({});

  // Mobile sliding cart sheet drawer
  const [showMobileCartDrawer, setShowMobileCartDrawer] = useState(false);

  // Active table synced reactively with latest db.tables state
  const activeTable = selectedTable ? (db.tables.find((t) => t.id === selectedTable.id) || selectedTable) : null;

  // Ensure module always starts scrolled to the top
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, []);

  // Sync selectedTable when passed from props (e.g. from Dashboard or Order Alerts)
  useEffect(() => {
    if (selectedTable) {
      if (tableCartMap[selectedTable.id] === undefined) {
        handleSelectTable(selectedTable);
      } else if (
        (selectedTable.status === 'occupied' || selectedTable.status === 'bill_printed') &&
        !sentCartSnapshotMap[selectedTable.id]
      ) {
        const currentCart = tableCartMap[selectedTable.id] || cartItems;
        const snap: Record<string, number> = {};
        currentCart.forEach((ci) => {
          if (ci.item) {
            snap[ci.item.id] = ci.quantity;
            snap[ci.item.name] = ci.quantity;
          }
        });
        setSentCartSnapshotMap((prev) => ({ ...prev, [selectedTable.id]: snap }));
      }
    }
  }, [selectedTable?.id]);

  // Handle table selection
  const handleSelectTable = (tbl: RestaurantTable) => {
    onSelectTable(tbl);
    setMobilePosTab('order'); // Auto-switch to order view on mobile devices
    setGuestCount(tbl.guestCount || tbl.capacity || 4);
    setStewardName(tbl.assignedSteward || currentUser.name || 'Arun Kumar');
    setDiscountPercent(0);
    setManagerPin('');
    setKitchenNotice(null);

    // 1. Check if table has an active order in db.orders
    const activeOrder = db.orders.find(
      (o) => o.tableId === tbl.id && o.status !== 'settled' && o.status !== 'cancelled'
    );

    if (activeOrder && activeOrder.items.length > 0) {
      const loadedItems = activeOrder.items.map((it) => {
        const found = db.menuItems.find((m) => m.id === it.menuItemId || m.name === it.name) || {
          id: it.menuItemId,
          name: it.name,
          pricePaise: it.pricePaise,
          categoryId: 'cat-1',
          description: '',
          vegType: 'non-veg' as const,
          gstPercent: 5,
          isAvailable: true,
          preparationTimeMins: 15,
          demoFlag: false,
        };
        return { item: found, quantity: it.quantity, notes: it.notes };
      });
      setCartItems(loadedItems);
      setTableCartMap((prev) => ({ ...prev, [tbl.id]: loadedItems }));
      setSentCartSnapshotMap((prev) => {
        const snap: Record<string, number> = { ...(prev[tbl.id] || {}) };
        loadedItems.forEach((ci) => {
          snap[ci.item.id] = Math.max(snap[ci.item.id] || 0, ci.quantity);
          snap[ci.item.name] = Math.max(snap[ci.item.name] || 0, ci.quantity);
        });
        return { ...prev, [tbl.id]: snap };
      });
    } else if (tableCartMap[tbl.id] !== undefined) {
      setCartItems(tableCartMap[tbl.id]);
    } else {
      // Check localStorage for saved hold ticket for this table
      try {
        const saved = typeof window !== 'undefined' ? localStorage.getItem(`ufp_held_cart_${tbl.id}`) : null;
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setCartItems(parsed);
            setTableCartMap((prev) => ({ ...prev, [tbl.id]: parsed }));
            return;
          }
        }
      } catch {}
      setCartItems([]);
      setTableCartMap((prev) => ({ ...prev, [tbl.id]: [] }));
    }
  };

  const handleSendToKitchen = async () => {
    if (!selectedTable || cartItems.length === 0) return;
    setSendingToKitchen(true);
    setKitchenNotice(null);
    try {
      if (onSendToKitchen) {
        const res = await onSendToKitchen(selectedTable.id, cartItems, guestCount, stewardName);
        if (res && !res.success) {
          throw new Error(res.message || 'Failed to send order to kitchen');
        }
      } else {
        const res = await fetch('/api/billing', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'SEND_TO_KITCHEN',
            tableId: selectedTable.id,
            items: cartItems.map((ci) => ({
              menuItemId: ci.item.id,
              name: ci.item.name,
              pricePaise: ci.item.pricePaise,
              quantity: ci.quantity,
              notes: ci.notes,
            })),
            stewardName,
            guestCount,
            userName: currentUser.name,
            userRole: currentUser.role,
          }),
        });
        const data = await res.json();
        if (!data.success) {
          throw new Error(data.message || 'Failed to send order to kitchen');
        }
      }
      // Record snapshot of current cart items as sent to kitchen
      const currentTableId = selectedTable.id;
      const sentSnapshot: Record<string, number> = {};
      cartItems.forEach((ci) => {
        sentSnapshot[ci.item.id] = ci.quantity;
        sentSnapshot[ci.item.name] = ci.quantity;
      });
      setSentCartSnapshotMap((prev) => ({ ...prev, [currentTableId]: sentSnapshot }));

      setKitchenNotice(`✓ Order sent to Kitchen KOT for Table ${selectedTable.tableNumber}!`);
      setTimeout(() => setKitchenNotice(null), 4000);
    } catch (err: any) {
      alert(`Error sending to kitchen: ${err.message}`);
    } finally {
      setSendingToKitchen(false);
    }
  };

  // Helper to determine if the "Send Order to Kitchen" button should be visible
  const getKitchenSendStatus = (tbl: RestaurantTable | null, items: typeof cartItems) => {
    if (!tbl || items.length === 0) {
      return { hasSent: false, hasMore: false, shouldShow: false };
    }

    const activeOrd = db.orders.find(
      (o) => o.tableId === tbl.id && o.status !== 'settled' && o.status !== 'cancelled'
    );

    const hasSent = Boolean(
      activeOrd ||
      sentCartSnapshotMap[tbl.id] ||
      tbl.status === 'occupied' ||
      tbl.status === 'bill_printed'
    );

    // Initial order for table has never been sent yet
    if (!hasSent) {
      return { hasSent: false, hasMore: false, shouldShow: true };
    }

    const snapshot = sentCartSnapshotMap[tbl.id];
    if (snapshot) {
      for (const ci of items) {
        const sentQty = snapshot[ci.item.id] ?? snapshot[ci.item.name] ?? 0;
        if (ci.quantity > sentQty) {
          return { hasSent: true, hasMore: true, shouldShow: true };
        }
      }
      return { hasSent: true, hasMore: false, shouldShow: false };
    }

    if (activeOrd && activeOrd.items.length > 0) {
      for (const ci of items) {
        const existing = activeOrd.items.find(
          (oi) => oi.menuItemId === ci.item.id || oi.name === ci.item.name
        );
        if (!existing || ci.quantity > existing.quantity) {
          return { hasSent: true, hasMore: true, shouldShow: true };
        }
      }
      return { hasSent: true, hasMore: false, shouldShow: false };
    }

    // If no active order yet, any item in cart should be sendable to kitchen
    return { hasSent: false, hasMore: items.length > 0, shouldShow: items.length > 0 };
  };

  const handleCreateDish = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDishName.trim() || !newDishPrice) return;
    setAddDishLoading(true);
    try {
      let uploadedImageUrl: string | undefined = undefined;
      if (newDishImageFile) {
        try {
          const formData = new FormData();
          formData.append('file', newDishImageFile);
          formData.append('bucket', 'menu-dishes');
          const upRes = await fetch('/api/upload', { method: 'POST', body: formData });
          const upJson = await upRes.json();
          if (upJson.success) {
            uploadedImageUrl = upJson.url;
          }
        } catch (imgErr) {
          console.warn('Dish image upload error:', imgErr);
        }
      }

      if (onAddMenuItem) {
        await onAddMenuItem({
          name: newDishName.trim(),
          categoryId: newDishCat,
          categoryName: newDishCat === 'custom' ? newDishCustomCat.trim() : undefined,
          priceRs: Number(newDishPrice),
          vegType: newDishVegType,
          description: newDishDesc.trim(),
          preparationTimeMins: Number(newDishPrepTime) || 15,
          isBestseller: newDishIsBestseller,
          imageUrl: uploadedImageUrl,
        });
      }
      setShowAddDishModal(false);
      setNewDishName('');
      setNewDishPrice('');
      setNewDishDesc('');
      setNewDishCustomCat('');
      setNewDishImageFile(null);
    } catch (err: any) {
      alert(err.message || 'Failed to add dish');
    } finally {
      setAddDishLoading(false);
    }
  };

  const handleAddItem = (item: MenuItem) => {
    if (item.isAvailable === false) {
      alert(`"${item.name}" is currently Out of Stock in the kitchen and cannot be added to the order.`);
      return;
    }
    setCartItems((prev) => {
      const idx = prev.findIndex((p) => p.item.id === item.id);
      let updated: { item: MenuItem; quantity: number; notes?: string }[];
      if (idx > -1) {
        updated = prev.map((p, i) => (i === idx ? { ...p, quantity: p.quantity + 1 } : p));
      } else {
        updated = [...prev, { item, quantity: 1 }];
      }
      if (selectedTable) {
        setTableCartMap((m) => ({ ...m, [selectedTable.id]: updated }));
      }
      return updated;
    });
  };

  const handleUpdateQuantity = (itemId: string, delta: number) => {
    setCartItems((prev) => {
      const updated = prev
        .map((p) => {
          if (p.item.id === itemId) {
            const newQty = p.quantity + delta;
            return newQty > 0 ? { ...p, quantity: newQty } : null;
          }
          return p;
        })
        .filter(Boolean) as { item: MenuItem; quantity: number; notes?: string }[];
      if (selectedTable) {
        setTableCartMap((m) => ({ ...m, [selectedTable.id]: updated }));
      }
      return updated;
    });
  };

  // Paise Arithmetic
  const subtotalPaise = cartItems.reduce((acc, ci) => acc + ci.item.pricePaise * ci.quantity, 0);
  const discountPaise = Math.round((subtotalPaise * discountPercent) / 100);
  const taxablePaise = subtotalPaise - discountPaise;
  const cgstPaise = Math.round((taxablePaise * db.settings.cgstPercent) / 100);
  const sgstPaise = Math.round((taxablePaise * db.settings.sgstPercent) / 100);
  const totalTaxPaise = cgstPaise + sgstPaise;
  const grossPaise = taxablePaise + totalTaxPaise;
  const roundedTotalPaise = db.settings.roundOff ? Math.round(grossPaise / 100) * 100 : grossPaise;
  const roundOffPaise = roundedTotalPaise - grossPaise;

  const filteredMenuItems = db.menuItems.filter((item) => {
    if (selectedCategory !== 'all' && item.categoryId !== selectedCategory) return false;
    if (vegFilter === 'veg' && item.vegType !== 'veg') return false;
    if (vegFilter === 'non-veg' && item.vegType === 'veg') return false;
    if (searchQuery.trim() !== '') {
      const q = searchQuery.toLowerCase();
      return item.name.toLowerCase().includes(q) || item.description.toLowerCase().includes(q);
    }
    return true;
  });

  const filteredTables = db.tables.filter((t) => {
    if (activeSection === 'All Tables') return true;
    if (activeSection === '4 Seater') return t.capacity <= 4;
    if (activeSection === '6 Seater') return t.capacity === 6;
    if (activeSection === 'Family Seater (8-10)') return t.capacity >= 8;
    return true;
  });

  const handleConfirmSettlement = async () => {
    if (!selectedTable || cartItems.length === 0 || isSettlingBill) return;

    const validManagerPin = db.users?.find((u) => u.role === 'manager' || u.role === 'admin')?.pin || '1234';
    if (discountPercent > 0 && currentUser.role !== 'admin' && managerPin !== validManagerPin && managerPin !== '1234') {
      alert('Valid Manager PIN required for discount approval');
      return;
    }

    setIsSettlingBill(true);
    try {
      const currentTblId = selectedTable.id;
      const payload = {
        tableId: currentTblId,
        items: cartItems.map((ci) => ({
          menuItemId: ci.item.id,
          name: ci.item.name,
          pricePaise: ci.item.pricePaise,
          quantity: ci.quantity,
          gstPercent: ci.item.gstPercent,
        })),
        guestCount,
        stewardName,
        discountPercent,
        discountReason: discountPercent > 0 ? discountReason || 'Manager Courtesy' : undefined,
        discountApprovedBy: discountPercent > 0 ? (currentUser.role === 'admin' ? 'Admin' : 'Manager') : undefined,
        paymentMode,
        paymentDetails: {
          cashPaise: paymentMode === 'cash' ? roundedTotalPaise : undefined,
          upiPaise: paymentMode === 'upi' ? roundedTotalPaise : undefined,
          cardPaise: paymentMode === 'card' ? roundedTotalPaise : undefined,
        },
      };

      const newBill = await onSettleBill(payload);
      if (!newBill) {
        alert('Bill settlement failed. Please try again.');
        return;
      }
      try {
        localStorage.removeItem(`ufp_held_cart_${currentTblId}`);
      } catch {}
      setShowPaymentModal(false);
      setCartItems([]);
      setTableCartMap((prev) => {
        const copy = { ...prev };
        delete copy[currentTblId];
        return copy;
      });
      setSentCartSnapshotMap((prev) => {
        const copy = { ...prev };
        delete copy[currentTblId];
        return copy;
      });
      onSelectTable(null);
      setActiveReceiptBill(newBill);
    } finally {
      setIsSettlingBill(false);
    }
  };

  const handleConfirmMoveTable = async () => {
    if (!selectedTable || !targetTableId || isMovingTable) return;
    setIsMovingTable(true);
    try {
      const srcId = selectedTable.id;
      const tgtId = targetTableId;
      await onMoveTable(srcId, tgtId);

      // Migrate held cart in localStorage if any
      try {
        const saved = localStorage.getItem(`ufp_held_cart_${srcId}`);
        if (saved) {
          localStorage.setItem(`ufp_held_cart_${tgtId}`, saved);
          localStorage.removeItem(`ufp_held_cart_${srcId}`);
        }
      } catch {}

      // Migrate client cart state to target table
      setTableCartMap((prev) => {
        const copy = { ...prev };
        if (copy[srcId]) {
          copy[tgtId] = copy[srcId];
          delete copy[srcId];
        }
        return copy;
      });
      setSentCartSnapshotMap((prev) => {
        const copy = { ...prev };
        if (copy[srcId]) {
          copy[tgtId] = copy[srcId];
          delete copy[srcId];
        }
        return copy;
      });

      setShowMoveTableModal(false);
      onSelectTable(null);
    } finally {
      setIsMovingTable(false);
    }
  };

  const handleHoldOrder = async () => {
    if (!selectedTable || cartItems.length === 0) return;
    try {
      localStorage.setItem(`ufp_held_cart_${selectedTable.id}`, JSON.stringify(cartItems));
    } catch {}
    await onUpdateTableStatus(selectedTable.id, 'occupied', {
      guestCount,
      stewardName,
      totalPaise: roundedTotalPaise,
    });
    alert(`Order saved for Table ${selectedTable.tableNumber}. Total: ₹${(roundedTotalPaise / 100).toLocaleString('en-IN')}`);
    onSelectTable(null);
  };

  const handlePrintBillPreview = async () => {
    if (!selectedTable || cartItems.length === 0) return;
    await onUpdateTableStatus(selectedTable.id, 'bill_printed', {
      guestCount,
      stewardName,
      totalPaise: roundedTotalPaise,
    });

    const previewBill: Bill = {
      id: `preview-${Date.now()}`,
      billNumber: `PREVIEW-${selectedTable.tableNumber}`,
      orderId: 'preview-ord',
      tableId: selectedTable.id,
      tableNumber: selectedTable.tableNumber,
      guestCount,
      stewardName,
      items: cartItems.map((ci) => ({
        menuItemId: ci.item.id,
        name: ci.item.name,
        pricePaise: ci.item.pricePaise,
        quantity: ci.quantity,
        totalPaise: ci.item.pricePaise * ci.quantity,
        gstPercent: ci.item.gstPercent,
      })),
      subtotalPaise,
      discountPercent,
      discountPaise,
      serviceChargePaise: 0,
      cgstPaise,
      sgstPaise,
      roundOffPaise,
      totalPaise: roundedTotalPaise,
      paymentStatus: 'unpaid',
      createdAt: new Date().toISOString(),
      demoFlag: false,
    };
    setActiveReceiptBill(previewBill);
  };

  return (
    <div className="p-3.5 sm:p-6 lg:p-8 flex flex-col gap-5 sm:gap-6 max-w-7xl mx-auto">
      {/* 1. Floor Navigation Bar */}
      <div className="ios27-glass-card p-3.5 sm:p-4 rounded-[22px] border border-white/80 shadow-[0_8px_32px_rgba(0,0,0,0.04),inset_0_1px_1.5px_rgba(255,255,255,0.95)] flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 sm:gap-3 overflow-x-auto max-w-full pb-1 sm:pb-0">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5 shrink-0">
            <span className="material-symbols-outlined text-slate-700 text-lg">table_restaurant</span>
            Sections:
          </span>
          <div className="flex items-center gap-1 bg-black/[0.05] p-1 rounded-full overflow-x-auto">
            {(['All Tables', '4 Seater', '6 Seater', 'Family Seater (8-10)'] as const).map((sec) => (
              <button
                key={sec}
                onClick={() => setActiveSection(sec)}
                className={`px-3.5 py-1.5 rounded-full text-xs font-medium transition-all whitespace-nowrap active:scale-[0.97] ${
                  activeSection === sec
                    ? 'bg-[#05271f] text-gold-300 font-semibold shadow-apple-subtle'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {sec}
              </button>
            ))}
          </div>
        </div>

        {/* Legend & Admin Action (Standardized iOS 27 Button Heights & Alignments) */}
        <div className="flex items-center gap-3 text-xs font-medium text-slate-600">
          <div className="hidden sm:flex items-center gap-3 mr-1">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span> Vacant
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500"></span> Occupied
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-500"></span> Bill Printed
            </span>
          </div>

          {onOpenOrderAlerts && (
            <button
              type="button"
              onClick={onOpenOrderAlerts}
              className={`h-9 px-3.5 rounded-full font-semibold text-xs inline-flex items-center justify-center gap-1.5 transition-all shadow-apple-subtle border active:scale-[0.96] ${
                orderAlertsCount > 0
                  ? 'bg-rose-600 hover:bg-rose-700 text-white border-rose-500 animate-pulse'
                  : 'bg-white/70 hover:bg-white/90 text-slate-800 border-white/80 shadow-[0_2px_8px_rgba(0,0,0,0.04),inset_0_1px_1px_rgba(255,255,255,0.85)]'
              }`}
              title="Open Waiter Order Alerts & Kitchen Notifications"
            >
              <span className="material-symbols-outlined text-sm">
                {orderAlertsCount > 0 ? 'notifications_active' : 'notifications'}
              </span>
              <span>Order Alerts</span>
              {orderAlertsCount > 0 && (
                <span className="px-1.5 py-0.2 rounded-full bg-white text-rose-700 font-bold text-[10px] tabular-nums">
                  {orderAlertsCount}
                </span>
              )}
            </button>
          )}

          {(currentUser.role === 'admin' || currentUser.role === 'manager') && (
            <button
              onClick={() => setShowAddDishModal(true)}
              className="btn-royal-primary h-9 px-4 rounded-full text-xs gap-2"
            >
              <span className="material-symbols-outlined text-sm text-gold-300">add_circle</span>
              <span className="pl-0.5">Add Menu Dish</span>
            </button>
          )}
        </div>
      </div>

      {/* Mobile Tab Switcher (Visible on mobile/tablet below lg) */}
      <div className="lg:hidden flex items-center p-1 bg-black/[0.05] rounded-full mb-4 font-semibold text-xs">
        <button
          type="button"
          onClick={() => setMobilePosTab('tables')}
          className={`flex-1 py-2 rounded-full transition-all flex items-center justify-center gap-1.5 active:scale-[0.98] ${
            mobilePosTab === 'tables'
              ? 'bg-white text-slate-900 shadow-apple-subtle'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <span className="material-symbols-outlined text-sm">table_bar</span>
          <span>Tables ({filteredTables.length})</span>
        </button>
        <button
          type="button"
          onClick={() => setMobilePosTab('order')}
          className={`flex-1 py-2 rounded-full transition-all flex items-center justify-center gap-1.5 active:scale-[0.98] ${
            mobilePosTab === 'order'
              ? 'bg-[#05271f] text-gold-300 font-semibold shadow-apple-subtle'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <span className="material-symbols-outlined text-sm">restaurant_menu</span>
          <span>
            {activeTable ? `Table ${activeTable.tableNumber}` : 'Order Ticket'} {cartItems.length > 0 ? `(${cartItems.length})` : ''}
          </span>
        </button>
      </div>

      {/* 2. Main Workspace: Floor Grid (Left) + Order Builder (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Table Floor Grid (4 Cols) */}
        <div className={`lg:col-span-4 ios27-glass-card p-3.5 sm:p-5 rounded-[22px] border border-white/80 shadow-[0_8px_32px_rgba(0,0,0,0.04),inset_0_1px_1.5px_rgba(255,255,255,0.95)] flex flex-col gap-3 ${mobilePosTab === 'order' ? 'hidden lg:flex' : 'flex'}`}>
          <div className="flex items-center justify-between pb-3 border-b border-slate-100/80">
            <h3 className="font-bold text-slate-900 text-sm tracking-tight">Dining Tables</h3>
            <span className="text-xs text-slate-400 font-medium tabular-nums">{filteredTables.length} Tables</span>
          </div>

          <div className="grid grid-cols-2 gap-3 max-h-[calc(100vh-230px)] sm:max-h-[calc(100vh-210px)] lg:max-h-[calc(100vh-210px)] xl:max-h-[720px] overflow-y-auto overscroll-contain p-1.5 sm:p-2 pr-2.5 sm:pr-3 pb-28 sm:pb-32 lg:pb-8">
            {filteredTables.map((table) => {
              const isSelected = selectedTable?.id === table.id;
              const isOccupied = table.status === 'occupied';
              const isBillPrinted = table.status === 'bill_printed';
              
              // Check live kitchen status from table or active order
              const activeOrder = db.orders.find(
                (o) => o.tableId === table.id && o.status !== 'settled' && o.status !== 'cancelled'
              );
              const kStage = table.kitchenStage || activeOrder?.kitchenStage;

              return (
                <div
                  key={table.id}
                  onClick={() => handleSelectTable(table)}
                  className={`p-3 sm:p-3.5 rounded-[18px] text-left cursor-pointer transition-all flex flex-col justify-between min-h-[120px] relative active:scale-[0.96] ${
                    isSelected
                      ? 'ring-2 ring-gold-300 border-gold-400 bg-forest-50/80 shadow-[0_0_16px_rgba(229,184,76,0.35)]'
                      : kStage === 'ready'
                      ? 'bg-emerald-50/90 border border-emerald-400/80 ring-2 ring-emerald-500/20 shadow-apple-subtle'
                      : kStage === 'accepted'
                      ? 'bg-amber-50/90 border border-amber-300/80 ring-1 ring-amber-400/20'
                      : kStage === 'pending'
                      ? 'bg-rose-50/80 border border-rose-200'
                      : isBillPrinted
                      ? 'bg-blue-50/90 border border-blue-300/80 hover:bg-blue-100/90 shadow-[0_2px_8px_rgba(59,130,246,0.1),inset_0_1px_1px_rgba(255,255,255,0.8)]'
                      : isOccupied
                      ? 'bg-amber-50/90 border border-gold-400/80 hover:bg-amber-100/90 shadow-[0_2px_12px_rgba(229,184,76,0.25),inset_0_1px_1.5px_rgba(255,248,220,0.85)] ring-1 ring-gold-400/40'
                      : 'bg-white/80 border border-white/80 hover:bg-white hover:border-gold-400/50 shadow-[0_2px_8px_rgba(0,0,0,0.03),inset_0_1px_1px_rgba(255,255,255,0.9)]'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-base text-slate-900 tracking-tight">
                      <span className="hidden md:inline">
                        {table.tableNumber.startsWith('T-') ? table.tableNumber.replace(/^T-/, 'Table - ') : table.tableNumber}
                      </span>
                      <span className="md:hidden">
                        {table.tableNumber}
                      </span>
                    </span>
                    <div className="flex items-center gap-1.5">
                      {kStage === 'ready' ? (
                        <span className="w-3 h-3 rounded-full bg-emerald-500 animate-ping" title="Food Ready for Pickup!" />
                      ) : (
                        <span
                          className={`w-2.5 h-2.5 rounded-full ${
                            isBillPrinted ? 'bg-blue-500' : isOccupied ? 'bg-gold-400 shadow-[0_0_6px_rgba(229,184,76,0.85)]' : 'bg-emerald-500'
                          }`}
                        />
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col my-1">
                    <div className="flex items-center justify-between text-[11px] text-slate-500 font-medium">
                      <span>{table.capacity <= 4 ? `${table.capacity} Seater` : table.capacity === 6 ? '6 Seater' : `Family (${table.capacity}S)`}</span>
                      <span className="text-[10px] text-slate-400 font-semibold">{table.section.split(' ')[0]}</span>
                    </div>
                    <div className="flex items-baseline justify-between mt-0.5">
                      <span className="text-xs font-bold tabular-nums">
                        {isBillPrinted ? (
                          <span className="text-blue-700 font-extrabold">₹{((table.totalPaise || 0) / 100).toLocaleString('en-IN')}</span>
                        ) : isOccupied ? (
                          <span className="text-gold-950 font-extrabold">₹{((table.totalPaise || 0) / 100).toLocaleString('en-IN')}</span>
                        ) : (
                          <span className="text-emerald-700 font-medium">Available</span>
                        )}
                      </span>
                      {isOccupied && table.assignedSteward && (
                        <span className="text-[10px] text-slate-500 font-medium truncate max-w-[70px] text-right" title={table.assignedSteward}>
                          {table.assignedSteward.split(' ')[0]}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Kitchen Status Badges */}
                  <div className="flex items-center justify-between gap-1 text-[10px] pt-1 border-t border-black/[0.04]">
                    <span className="text-slate-400 text-[10px]">
                      {isBillPrinted ? 'Bill Printed' : isOccupied ? 'Occupied' : 'Vacant'}
                    </span>

                    {kStage === 'ready' && (
                      <span className="px-2 py-0.5 rounded-full bg-emerald-600 text-white font-bold text-[9px] uppercase tracking-wider flex items-center gap-0.5 animate-pulse shrink-0">
                        <span className="material-symbols-outlined text-[10px]">notifications_active</span>
                        Ready!
                      </span>
                    )}
                    {kStage === 'accepted' && (
                      <span className="px-2 py-0.5 rounded-full bg-amber-500 text-white font-bold text-[9px] uppercase tracking-wider flex items-center gap-0.5 shrink-0">
                        <span className="material-symbols-outlined text-[10px]">skillet</span>
                        Cook 50%
                      </span>
                    )}
                    {kStage === 'pending' && (
                      <span className="px-2 py-0.5 rounded-full bg-rose-500 text-white font-bold text-[9px] uppercase tracking-wider shrink-0">
                        KOT Sent
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: Active POS Terminal & KOT Ticket (8 Cols) */}
        <div className={`lg:col-span-8 flex flex-col gap-5 ${mobilePosTab === 'tables' ? 'hidden lg:flex' : 'flex'}`}>
          {activeTable ? (
            <div className="ios27-glass-card p-4 sm:p-6 rounded-[22px] border border-white/80 shadow-[0_8px_32px_rgba(0,0,0,0.04),inset_0_1px_1.5px_rgba(255,255,255,0.95)] flex flex-col gap-5">
              {/* DESKTOP Selected Table Bar (All Badges in One Line) */}
              <div className="hidden md:flex flex-col gap-2.5 pb-3.5 border-b border-slate-100/80">
                {/* Row 1: Avatar + Badges in ONE LINE horizontally */}
                <div className="flex items-center gap-2.5 min-w-0">
                  {/* Luxury iOS 27 Table Badge (Rounded Pill) */}
                  <div className="h-10 px-3.5 rounded-full bg-gradient-to-br from-[#05271f] via-[#031d16] to-[#01140e] border border-gold-400/40 flex items-center justify-center shadow-md shrink-0 transition-all">
                    <span className="text-sm sm:text-base font-black text-gold-300 tracking-tight leading-none drop-shadow-xs whitespace-nowrap">
                      {activeTable.tableNumber.startsWith('T-') ? activeTable.tableNumber.replace(/^T-/, 'Table - ') : activeTable.tableNumber}
                    </span>
                  </div>

                  {/* All Badges strictly in ONE LINE horizontally across the card */}
                  <div className="flex items-center gap-2 flex-nowrap overflow-x-auto no-scrollbar py-0.5">
                    {/* 1. Dining Section Pill */}
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-200/80 shadow-2xs whitespace-nowrap shrink-0">
                      <span className="material-symbols-outlined text-[13px] text-slate-500">deck</span>
                      <span>{activeTable.section}</span>
                    </span>

                    {/* 2. Table Status Badge */}
                    {activeTable.status === 'occupied' && (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-500/10 text-amber-900 border border-amber-500/25 shadow-2xs whitespace-nowrap shrink-0">
                        <span className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                        </span>
                        <span>Table: Occupied</span>
                      </span>
                    )}
                    {activeTable.status === 'bill_printed' && (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-blue-500/10 text-blue-900 border border-blue-500/25 shadow-2xs whitespace-nowrap shrink-0">
                        <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0"></span>
                        <span>Table: Bill Printed</span>
                      </span>
                    )}
                    {activeTable.status !== 'occupied' && activeTable.status !== 'bill_printed' && (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-500/10 text-emerald-900 border border-emerald-500/25 shadow-2xs whitespace-nowrap shrink-0">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0"></span>
                        <span>Table: Available</span>
                      </span>
                    )}

                    {/* 3. Kitchen Progress Stage Badge */}
                    {(() => {
                      const activeOrd = db.orders.find(
                        (o) => o.tableId === activeTable.id && o.status !== 'settled' && o.status !== 'cancelled'
                      );
                      const kStg = activeTable.kitchenStage || activeOrd?.kitchenStage;
                      if (kStg === 'ready') {
                        return (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-gradient-to-r from-emerald-50 to-emerald-100/90 text-emerald-950 border border-emerald-400/50 shadow-2xs animate-pulse whitespace-nowrap shrink-0">
                            <span className="material-symbols-outlined text-sm text-emerald-600">notifications_active</span>
                            <span>Food Ready for Pickup!</span>
                            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-black bg-emerald-600 text-white leading-none shadow-xs">
                              100%
                            </span>
                          </span>
                        );
                      }
                      if (kStg === 'accepted') {
                        return (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-gradient-to-r from-amber-50 to-amber-100/90 text-amber-950 border border-amber-400/50 shadow-2xs whitespace-nowrap shrink-0">
                            <span className="material-symbols-outlined text-sm text-amber-600 animate-spin-slow">skillet</span>
                            <span>Cooking in Kitchen</span>
                            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-black bg-amber-500 text-white leading-none shadow-xs">
                              50%
                            </span>
                          </span>
                        );
                      }
                      if (kStg === 'pending') {
                        return (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-gradient-to-r from-rose-50 to-rose-100/90 text-rose-950 border border-rose-400/50 shadow-2xs whitespace-nowrap shrink-0">
                            <span className="material-symbols-outlined text-sm text-rose-600">hourglass_top</span>
                            <span>KOT Sent • Waiting</span>
                          </span>
                        );
                      }
                      return null;
                    })()}
                  </div>
                </div>

                {/* Row 2: Guests & Steward Controls + Move & Close Table Buttons placed directly beside them */}
                <div className="flex items-center gap-2.5 text-xs pt-1.5 border-t border-black/[0.04] flex-wrap">
                  {/* Guests */}
                  <div className="flex items-center gap-1.5 bg-black/[0.04] px-3 py-1.5 rounded-full border border-black/[0.05]">
                    <span className="material-symbols-outlined text-[14px] text-slate-500">group</span>
                    <span className="text-slate-500 font-medium">Guests:</span>
                    <select
                      value={guestCount}
                      onChange={(e) => setGuestCount(Number(e.target.value))}
                      className="bg-transparent font-bold text-slate-900 focus:outline-none cursor-pointer"
                    >
                      {[1, 2, 3, 4, 5, 6, 8, 10, 12].map((n) => (
                        <option key={n} value={n}>{n}</option>
                      ))}
                    </select>
                  </div>

                  {/* Steward */}
                  <div className="flex items-center gap-1.5 bg-black/[0.04] px-3 py-1.5 rounded-full border border-black/[0.05]">
                    <span className="material-symbols-outlined text-[14px] text-slate-500">badge</span>
                    <span className="text-slate-500 font-medium">Steward:</span>
                    <input
                      type="text"
                      value={stewardName}
                      onChange={(e) => setStewardName(e.target.value)}
                      className="bg-transparent font-bold text-slate-900 w-36 focus:outline-none"
                    />
                  </div>

                  {/* Move & Close Table Buttons placed beside Guests and Steward */}
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setShowMoveTableModal(true)}
                      className="h-8 px-3 rounded-full bg-white/80 hover:bg-white backdrop-blur-md border border-slate-200/80 text-slate-700 font-semibold text-xs inline-flex items-center gap-1.5 shadow-2xs transition-all active:scale-[0.96]"
                    >
                      <span className="material-symbols-outlined text-sm">swap_horiz</span>
                      <span>Move</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => onSelectTable(null)}
                      className="h-8 px-3 rounded-full bg-white/80 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-200 backdrop-blur-md border border-slate-200/80 text-slate-700 font-semibold text-xs inline-flex items-center gap-1.5 shadow-2xs transition-all active:scale-[0.96]"
                      title="Close Table and return to floor view"
                    >
                      <span className="material-symbols-outlined text-sm">close</span>
                      <span>Close Table</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* MOBILE Selected Table Bar (Responsive Redesign) */}
              <div className="md:hidden flex flex-col gap-2.5 pb-3 border-b border-slate-100/80">
                {/* Row 1: Table Badge + Section + Move & Close Actions */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {/* Compact Table Avatar (Rounded) */}
                    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#05271f] via-[#031d16] to-[#01140e] border border-gold-400/40 flex items-center justify-center shadow-md shrink-0">
                      <span className="text-xs font-black text-gold-300 tracking-tight leading-none">
                        {activeTable.tableNumber}
                      </span>
                    </div>

                    {/* Section Pill */}
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-700 border border-slate-200/80 whitespace-nowrap shrink-0">
                      <span className="material-symbols-outlined text-[12px] text-slate-500">deck</span>
                      <span>{activeTable.section}</span>
                    </span>
                  </div>

                  {/* Actions: Move & Close */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => setShowMoveTableModal(true)}
                      className="h-7.5 px-2 rounded-full bg-slate-100 hover:bg-slate-200 active:scale-95 border border-slate-200/80 text-slate-700 font-semibold text-[11px] inline-flex items-center gap-0.5 transition-all"
                    >
                      <span className="material-symbols-outlined text-[12px] text-slate-600">swap_horiz</span>
                      <span>Move</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => onSelectTable(null)}
                      className="h-7.5 px-2 rounded-full bg-slate-100 hover:bg-rose-50 hover:text-rose-600 active:scale-95 border border-slate-200/80 text-slate-700 font-semibold text-[11px] inline-flex items-center gap-0.5 transition-all"
                      title="Close Table"
                    >
                      <span className="material-symbols-outlined text-[12px] text-slate-600">close</span>
                      <span>Close</span>
                    </button>
                  </div>
                </div>

                {/* Row 2: Status Badges (Occupied & KOT Ticket) */}
                <div className="flex items-center gap-2 flex-wrap">
                  {/* Table Status Badge */}
                  {activeTable.status === 'occupied' && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-500/10 text-amber-900 border border-amber-500/25 whitespace-nowrap">
                      <span className="relative flex h-1.5 w-1.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-amber-500"></span>
                      </span>
                      <span>Table: Occupied</span>
                    </span>
                  )}
                  {activeTable.status === 'bill_printed' && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-blue-500/10 text-blue-900 border border-blue-500/25 whitespace-nowrap">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0"></span>
                      <span>Table: Bill Printed</span>
                    </span>
                  )}
                  {activeTable.status !== 'occupied' && activeTable.status !== 'bill_printed' && (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-500/10 text-emerald-900 border border-emerald-500/25 whitespace-nowrap">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0"></span>
                      <span>Table: Available</span>
                    </span>
                  )}


                </div>

                {/* Row 3: Kitchen Stage Progress Banner */}
                {(() => {
                  const activeOrd = db.orders.find(
                    (o) => o.tableId === activeTable.id && o.status !== 'settled' && o.status !== 'cancelled'
                  );
                  const kStg = activeTable.kitchenStage || activeOrd?.kitchenStage;
                  if (!kStg) return null;

                  return (
                    <div className="w-full">
                      {kStg === 'ready' && (
                        <div className="w-full flex items-center justify-between px-3 py-1.5 rounded-xl text-xs font-bold bg-gradient-to-r from-emerald-50 to-emerald-100/90 text-emerald-950 border border-emerald-400/50 shadow-2xs animate-pulse">
                          <span className="inline-flex items-center gap-1.5">
                            <span className="material-symbols-outlined text-sm text-emerald-600">notifications_active</span>
                            <span>Food Ready for Pickup!</span>
                          </span>
                          <span className="px-1.5 py-0.5 rounded-full text-[10px] font-black bg-emerald-600 text-white leading-none shadow-xs">
                            100%
                          </span>
                        </div>
                      )}
                      {kStg === 'accepted' && (
                        <div className="w-full flex items-center justify-between px-3 py-1.5 rounded-xl text-xs font-bold bg-gradient-to-r from-amber-50 to-amber-100/90 text-amber-950 border border-amber-400/50 shadow-2xs">
                          <span className="inline-flex items-center gap-1.5">
                            <span className="material-symbols-outlined text-sm text-amber-600 animate-spin-slow">skillet</span>
                            <span>Cooking in Kitchen</span>
                          </span>
                          <span className="px-1.5 py-0.5 rounded-full text-[10px] font-black bg-amber-500 text-white leading-none shadow-xs">
                            50%
                          </span>
                        </div>
                      )}
                      {kStg === 'pending' && (
                        <div className="w-full flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-gradient-to-r from-rose-50 to-rose-100/90 text-rose-950 border border-rose-400/50 shadow-2xs">
                          <span className="material-symbols-outlined text-sm text-rose-600">hourglass_top</span>
                          <span>KOT Sent • Waiting</span>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Row 4: Guests & Steward Controls */}
                <div className="flex items-center gap-2 text-xs">
                  {/* Guests */}
                  <div className="flex items-center gap-1 bg-slate-100/80 border border-slate-200/80 px-2 py-1.5 rounded-xl shrink-0">
                    <span className="material-symbols-outlined text-[14px] text-slate-500">group</span>
                    <select
                      value={guestCount}
                      onChange={(e) => setGuestCount(Number(e.target.value))}
                      className="bg-transparent font-bold text-slate-900 focus:outline-none cursor-pointer text-xs pr-1"
                    >
                      {[1, 2, 3, 4, 5, 6, 8, 10, 12].map((n) => (
                        <option key={n} value={n}>{n} Guests</option>
                      ))}
                    </select>
                  </div>

                  {/* Steward */}
                  <div className="flex-1 flex items-center gap-1.5 bg-slate-100/80 border border-slate-200/80 px-2.5 py-1.5 rounded-xl min-w-0">
                    <span className="material-symbols-outlined text-[14px] text-slate-500 shrink-0">badge</span>
                    <span className="text-slate-500 font-medium text-xs shrink-0">Steward:</span>
                    <input
                      type="text"
                      value={stewardName}
                      onChange={(e) => setStewardName(e.target.value)}
                      className="bg-transparent font-bold text-slate-900 w-full focus:outline-none min-w-0 text-xs"
                      placeholder="Name"
                    />
                  </div>
                </div>
              </div>


              {/* 2-Column POS Layout: Menu Picker (7 cols) + KOT Order Ticket (5 cols) */}
              <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
                {/* Menu Catalog (7 Cols) */}
                <div className="md:col-span-7 flex flex-col gap-3">
                  {/* Category Pills */}
                  <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs no-scrollbar">
                    <button
                      onClick={() => setSelectedCategory('all')}
                      className={`px-3.5 py-1.5 rounded-full font-semibold whitespace-nowrap transition-all active:scale-[0.96] ${
                        selectedCategory === 'all'
                          ? 'bg-[#05271f] text-gold-300 shadow-apple-subtle'
                          : 'bg-black/[0.04] text-slate-700 hover:bg-black/[0.07]'
                      }`}
                    >
                      All Items
                    </button>
                    {db.categories.map((cat) => (
                      <button
                        key={cat.id}
                        onClick={() => setSelectedCategory(cat.id)}
                        className={`px-3.5 py-1.5 rounded-full font-semibold whitespace-nowrap transition-all active:scale-[0.96] ${
                          selectedCategory === cat.id
                            ? 'bg-[#05271f] text-gold-300 shadow-apple-subtle'
                            : 'bg-black/[0.04] text-slate-700 hover:bg-black/[0.07]'
                        }`}
                      >
                        {cat.name}
                      </button>
                    ))}
                  </div>

                  {/* Search & Veg/Non-Veg */}
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <span className="material-symbols-outlined absolute left-3 top-2.5 text-slate-400 text-sm">search</span>
                      <input
                        type="text"
                        placeholder="Search 172 dishes (Biryani, Tikka, Naan)..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full h-10 pl-9 pr-3 text-xs rounded-full bg-black/[0.03] border border-black/[0.06] focus:outline-none focus:ring-2 focus:ring-gold-500/30 focus:border-gold-500/60 focus:bg-white transition-all"
                      />
                    </div>
                    <div className="flex items-center gap-1 bg-black/[0.05] p-1 rounded-full text-xs">
                      {(['all', 'veg', 'non-veg'] as const).map((vf) => (
                        <button
                          key={vf}
                          onClick={() => setVegFilter(vf)}
                          className={`px-2.5 py-1 rounded-full text-[11px] font-medium capitalize transition-all active:scale-[0.96] ${
                            vegFilter === vf
                              ? 'bg-[#05271f] text-gold-300 font-semibold shadow-apple-subtle'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          {vf}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Menu Items Grid */}
                  <div className="grid grid-cols-2 gap-2.5 max-h-[380px] overflow-y-auto pr-1">
                    {filteredMenuItems.map((item) => {
                      const inCart = cartItems.find((ci) => ci.item.id === item.id);
                      const isItemSoldOut = item.isAvailable === false;

                      return (
                        <div
                          key={item.id}
                          className={`p-3.5 rounded-[18px] border shadow-[0_4px_16px_rgba(0,0,0,0.04),inset_0_1px_1px_rgba(255,255,255,0.9)] flex flex-col justify-between transition-all ${
                            isItemSoldOut
                              ? 'bg-slate-50/90 border-rose-200/80 opacity-70'
                              : 'bg-white/85 hover:bg-white border-white/80 hover:border-gold-400/50 active:scale-[0.98]'
                          }`}
                        >
                          <div>
                            {item.imageUrl && (
                              <img
                                src={item.imageUrl}
                                alt={item.name}
                                className={`w-full h-20 object-cover rounded-xl mb-2 border border-black/[0.05] ${isItemSoldOut ? 'grayscale' : ''}`}
                              />
                            )}
                            <div className="flex items-center justify-between gap-1">
                              <div className="flex items-center gap-1.5">
                                <span
                                  className={`w-2.5 h-2.5 rounded-full ${item.vegType === 'veg' ? 'bg-emerald-500' : 'bg-rose-500'}`}
                                  title={item.vegType}
                                ></span>
                                {isItemSoldOut && (
                                  <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase bg-rose-600 text-white shadow-2xs">
                                    Out of Stock
                                  </span>
                                )}
                              </div>
                              <span className="text-[10px] text-slate-400 font-medium tabular-nums">{item.preparationTimeMins}m</span>
                            </div>
                            <h4 className="font-semibold text-xs text-slate-900 mt-1 line-clamp-1 tracking-tight">
                              {item.name}
                            </h4>
                            <p className="text-[10px] text-slate-500 line-clamp-1 mt-0.5">
                              {item.description}
                            </p>
                          </div>

                          <div className="flex items-center justify-between mt-3 pt-2 border-t border-slate-100/80">
                            <span className="font-bold text-xs text-slate-900 tabular-nums">
                              ₹{(item.pricePaise / 100).toFixed(0)}
                            </span>
                            
                            {isItemSoldOut ? (
                              <button
                                disabled
                                className="h-8 px-3 rounded-full text-[11px] font-bold bg-slate-200 text-slate-500 cursor-not-allowed flex items-center gap-1"
                                title="Dish currently marked unavailable by Kitchen Chef"
                              >
                                <span className="material-symbols-outlined text-xs">block</span>
                                <span>Sold Out</span>
                              </button>
                            ) : inCart ? (
                              <div className="h-8 px-1.5 rounded-full bg-[#05271f] inline-flex items-center gap-1.5 border border-gold-400/35 shadow-apple-subtle">
                                <button
                                  type="button"
                                  onClick={() => handleUpdateQuantity(item.id, -1)}
                                  className="w-5.5 h-5.5 rounded-full bg-forest-900 hover:bg-forest-800 text-gold-300 font-bold text-xs flex items-center justify-center active:scale-90 transition-all"
                                  title="Reduce quantity"
                                >
                                  -
                                </button>
                                <span className="text-xs font-bold text-gold-300 min-w-4 text-center tabular-nums">
                                  {inCart.quantity}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => handleUpdateQuantity(item.id, 1)}
                                  className="w-5.5 h-5.5 rounded-full bg-gold-500 hover:bg-gold-400 text-forest-950 font-bold text-xs flex items-center justify-center active:scale-90 transition-all"
                                  title="Add one more"
                                >
                                  +
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => handleAddItem(item)}
                                className="btn-royal-primary h-8 px-3.5 rounded-full text-xs gap-1"
                              >
                                <span className="material-symbols-outlined text-sm">add</span> Add
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* KOT Order Ticket Panel (5 Cols, iOS 27 Liquid Glass) */}
                <div className="md:col-span-5 ios27-glass-card p-4 sm:p-5 rounded-[22px] border border-white/80 shadow-[0_8px_32px_rgba(0,0,0,0.04),inset_0_1px_1.5px_rgba(255,255,255,0.95)] flex flex-col justify-between">
                  <div className="flex flex-col gap-2.5">
                    <div className="flex items-center justify-between pb-2.5 border-b border-black/[0.06]">
                      <span className="font-bold text-xs text-slate-900 tracking-tight flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-slate-600 text-sm">receipt</span>
                        Active Order Ticket
                      </span>
                      <div className="flex items-center gap-2">
                        {cartItems.length > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              setCartItems([]);
                              if (selectedTable) {
                                setTableCartMap((m) => ({ ...m, [selectedTable.id]: [] }));
                              }
                            }}
                            className="text-[11px] text-rose-600 hover:text-rose-700 font-semibold transition-colors active:scale-[0.96]"
                          >
                            Clear
                          </button>
                        )}
                        <span className="text-xs bg-black/[0.05] px-2.5 py-0.5 rounded-full font-semibold text-slate-700 tabular-nums">
                          {cartItems.reduce((acc, ci) => acc + ci.quantity, 0)} Items
                        </span>
                      </div>
                    </div>

                    {/* Items List */}
                    <div className="max-h-[200px] overflow-y-auto space-y-1.5 pr-1">
                      {cartItems.length === 0 ? (
                        <div className="text-center py-10 text-slate-400 text-xs font-medium">
                          Cart is empty.<br />Select items from menu to start order.
                        </div>
                      ) : (
                        cartItems.map((ci) => (
                          <div
                            key={ci.item.id}
                            className="bg-white/90 p-3 rounded-2xl flex items-center justify-between border border-white/80 shadow-2xs"
                          >
                            <div className="flex flex-col min-w-0 flex-1 pr-2">
                              <span className="text-xs font-semibold text-slate-900 truncate tracking-tight">
                                {ci.item.name}
                              </span>
                              <span className="text-[11px] text-slate-500 font-medium tabular-nums">
                                ₹{(ci.item.pricePaise / 100).toFixed(0)} x {ci.quantity} = ₹{((ci.item.pricePaise * ci.quantity) / 100).toFixed(0)}
                              </span>
                            </div>

                            <div className="flex items-center gap-1.5">
                              <button
                                onClick={() => handleUpdateQuantity(ci.item.id, -1)}
                                className="w-7 h-7 rounded-full bg-black/[0.04] hover:bg-rose-50 hover:text-rose-700 flex items-center justify-center text-sm font-bold text-slate-700 transition-all active:scale-90"
                                title="Decrease quantity"
                              >
                                -
                              </button>
                              <span className="text-xs font-bold min-w-5 text-center text-slate-900 tabular-nums">{ci.quantity}</span>
                              <button
                                onClick={() => handleUpdateQuantity(ci.item.id, 1)}
                                className="w-7 h-7 rounded-full bg-[#05271f] hover:bg-[#031d16] text-gold-300 border border-gold-400/30 flex items-center justify-center text-sm font-bold transition-all active:scale-90"
                                title="Increase quantity"
                              >
                                +
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {/* Pricing Breakdown & Settlement Actions */}
                  <div className="pt-3 border-t border-black/[0.06] flex flex-col gap-1.5 text-xs">
                    <div className="flex justify-between text-slate-600 font-medium">
                      <span>Subtotal:</span>
                      <span className="text-slate-900 font-bold tabular-nums">₹{(subtotalPaise / 100).toFixed(2)}</span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-slate-600 flex items-center gap-1 font-medium">
                        Discount %:
                        <select
                          value={discountPercent}
                          onChange={(e) => setDiscountPercent(Number(e.target.value))}
                          className="bg-white border border-black/[0.08] text-xs rounded-full px-2 py-0.5 font-semibold"
                        >
                          <option value={0}>0%</option>
                          <option value={5}>5%</option>
                          <option value={10}>10%</option>
                          <option value={15}>15%</option>
                        </select>
                      </span>
                      {discountPercent > 0 && (
                        <span className="text-rose-600 font-semibold tabular-nums">-₹{(discountPaise / 100).toFixed(2)}</span>
                      )}
                    </div>

                    {discountPercent > 0 && (
                      <div className="bg-amber-500/[0.08] border border-amber-500/20 p-2.5 rounded-xl flex flex-col gap-2 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="text-amber-900 font-semibold">Reason:</span>
                          <select
                            value={discountReason}
                            onChange={(e) => setDiscountReason(e.target.value)}
                            className="bg-white border border-amber-300 text-xs rounded-lg px-2 py-1 font-medium text-slate-800"
                          >
                            <option value="Manager Courtesy">Manager Courtesy</option>
                            <option value="Loyal Customer">Loyal Customer</option>
                            <option value="Festival Offer">Festival Offer</option>
                            <option value="Service Recovery">Service Recovery</option>
                            <option value="Staff Family">Staff Family</option>
                          </select>
                        </div>
                        {currentUser.role !== 'admin' && (
                          <div className="flex items-center justify-between pt-1 border-t border-amber-500/15">
                            <span className="text-amber-900 font-semibold">Manager PIN:</span>
                            <input
                              type="password"
                              placeholder="PIN"
                              value={managerPin}
                              onChange={(e) => setManagerPin(e.target.value)}
                              className="w-16 px-2 py-0.5 rounded-full border border-amber-300 bg-white font-mono text-center"
                            />
                          </div>
                        )}
                      </div>
                    )}

                    <div className="flex justify-between text-slate-600 font-medium">
                      <span>GST (5% CGST + SGST):</span>
                      <span className="text-slate-900 font-bold tabular-nums">₹{(totalTaxPaise / 100).toFixed(2)}</span>
                    </div>

                    <div className="flex justify-between items-baseline pt-2 border-t border-black/[0.06] mt-1">
                      <span className="font-bold text-sm text-slate-900 tracking-tight">Total Payable:</span>
                      <span className="text-xl font-bold text-slate-900 tabular-nums">
                        ₹{(roundedTotalPaise / 100).toLocaleString('en-IN')}
                      </span>
                    </div>

                    {/* Primary Action: Send Order to Kitchen */}
                    {(() => {
                      const activeOrd = db.orders.find(
                        (o) => o.tableId === selectedTable.id && o.status !== 'settled' && o.status !== 'cancelled'
                      );
                      const kStg = selectedTable.kitchenStage || activeOrd?.kitchenStage;
                      const { hasSent, hasMore, shouldShow } = getKitchenSendStatus(selectedTable, cartItems);

                      if (!shouldShow) {
                        return (
                          <div className="flex flex-col gap-1 mt-2">
                            {kitchenNotice && (
                              <div className="p-2 bg-emerald-500/[0.08] border border-emerald-500/20 rounded-full text-[11px] font-semibold text-emerald-800 text-center animate-in fade-in">
                                {kitchenNotice}
                              </div>
                            )}
                          </div>
                        );
                      }

                      return (
                        <div className="flex flex-col gap-1.5 mt-2 animate-in fade-in duration-200">
                          <button
                            type="button"
                            onClick={handleSendToKitchen}
                            disabled={cartItems.length === 0 || sendingToKitchen}
                            className={`w-full h-11 rounded-full text-white font-bold text-xs shadow-apple-subtle transition-all flex items-center justify-center gap-2 active:scale-[0.97] ${
                              kStg === 'ready'
                                ? 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-600/20'
                                : kStg === 'accepted'
                                ? 'bg-amber-600 hover:bg-amber-700 shadow-amber-600/20'
                                : 'bg-rose-600 hover:bg-rose-700 shadow-rose-600/20'
                            }`}
                          >
                            <span className={`material-symbols-outlined text-base ${sendingToKitchen ? 'animate-spin' : ''}`}>
                              {sendingToKitchen
                                ? 'refresh'
                                : 'soup_kitchen'}
                            </span>
                            {sendingToKitchen
                              ? 'Sending to Kitchen...'
                              : hasSent
                              ? '🔥 Send Additional Items (KOT)'
                              : '🔥 Send Order to Kitchen (KOT)'}
                          </button>

                          {kitchenNotice && (
                            <div className="p-2 bg-emerald-500/[0.08] border border-emerald-500/20 rounded-full text-[11px] font-semibold text-emerald-800 text-center animate-in fade-in">
                              {kitchenNotice}
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    {/* Aligned iOS 27 Button Row */}
                    <div className="grid grid-cols-2 gap-3 mt-2">
                      <button
                        onClick={handleHoldOrder}
                        disabled={cartItems.length === 0}
                        className="h-10 px-4 rounded-full bg-white/70 hover:bg-white/90 backdrop-blur-md border border-white/80 text-slate-800 text-xs font-semibold shadow-[0_1px_4px_rgba(0,0,0,0.04)] inline-flex items-center justify-center gap-2 transition-all disabled:opacity-40 active:scale-[0.97]"
                      >
                        <span className="material-symbols-outlined text-sm">pause_circle</span>
                        <span>Hold Ticket</span>
                      </button>
                      <button
                        onClick={handlePrintBillPreview}
                        disabled={cartItems.length === 0}
                        className="h-10 px-4 rounded-full bg-blue-500/[0.1] hover:bg-blue-500/[0.15] text-blue-700 border border-blue-500/25 text-xs font-semibold inline-flex items-center justify-center gap-2 transition-all disabled:opacity-40 active:scale-[0.97]"
                      >
                        <span className="material-symbols-outlined text-sm">print</span>
                        <span>Print Bill</span>
                      </button>
                    </div>

                    <button
                      onClick={() => setShowPaymentModal(true)}
                      disabled={cartItems.length === 0}
                      className="btn-royal-primary w-full h-12 mt-2.5 rounded-full text-sm gap-2.5 disabled:opacity-40 shadow-md"
                    >
                      <span className="material-symbols-outlined text-base text-gold-300">payments</span>
                      <span>Settle Bill (₹{(roundedTotalPaise / 100).toLocaleString('en-IN')})</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="ios27-glass-card p-16 rounded-[22px] border border-white/80 shadow-[0_8px_32px_rgba(0,0,0,0.04),inset_0_1px_1.5px_rgba(255,255,255,0.95)] text-center flex flex-col items-center justify-center gap-3">
              <div className="w-16 h-16 rounded-full bg-black/[0.04] flex items-center justify-center text-slate-500 border border-black/[0.05]">
                <span className="material-symbols-outlined text-3xl">table_bar</span>
              </div>
              <h3 className="font-bold text-base text-slate-900 tracking-tight">Select a Table to Begin POS Billing</h3>
              <p className="text-xs text-slate-500 max-w-sm">
                Choose any table from the floor map on the left to start adding orders, view active tickets, or print bills.
              </p>
            </div>
          )}

          {/* Mobile Sticky Quick Cart Action Bar (Visible only when viewing Tables list so it doesn't overlap the active order ticket) */}
          {activeTable && cartItems.length > 0 && mobilePosTab === 'tables' && (
            <div className="lg:hidden fixed bottom-[72px] md:bottom-6 left-3 right-3 md:left-auto md:right-6 md:w-96 z-40 bg-[#031d16]/90 backdrop-blur-2xl backdrop-saturate-180 text-white p-3.5 rounded-apple-xl shadow-apple-card border border-white/[0.12] flex items-center justify-between gap-3 animate-in slide-in-from-bottom-2">
              <div className="flex flex-col min-w-0">
                <span className="text-[11px] font-semibold text-gold-400 truncate">
                  Table {activeTable.tableNumber} • {cartItems.reduce((acc, ci) => acc + ci.quantity, 0)} Items
                </span>
                <span className="text-base font-bold text-white tabular-nums">
                  ₹{(roundedTotalPaise / 100).toLocaleString('en-IN')}
                </span>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setShowMobileCartDrawer(true)}
                  className="px-3 py-1.5 rounded-full bg-white/[0.08] hover:bg-white/[0.12] border border-white/[0.08] text-gold-300 font-semibold text-xs flex items-center gap-1 active:scale-[0.96] transition-all"
                  title="View full order details"
                >
                  <span className="material-symbols-outlined text-sm">receipt_long</span>
                  Ticket
                </button>
                {(() => {
                  const { hasSent, shouldShow } = getKitchenSendStatus(activeTable, cartItems);
                  if (!shouldShow) return null;
                  return (
                    <button
                      type="button"
                      onClick={handleSendToKitchen}
                      disabled={sendingToKitchen}
                      className="px-3.5 py-1.5 rounded-full bg-amber-500 hover:bg-amber-600 active:scale-[0.96] text-slate-950 font-semibold text-xs flex items-center gap-1 shadow-apple-subtle transition-all disabled:opacity-50"
                    >
                      <span className="material-symbols-outlined text-sm">skillet</span>
                      {hasSent ? 'KOT +' : 'KOT'}
                    </button>
                  );
                })()}
                <button
                  type="button"
                  onClick={() => setShowPaymentModal(true)}
                  className="px-3.5 py-1.5 rounded-full bg-gold-500 hover:bg-gold-400 active:scale-[0.96] text-forest-950 font-bold text-xs flex items-center gap-1 shadow-apple-subtle transition-all"
                >
                  <span className="material-symbols-outlined text-sm">payments</span>
                  Settle
                </button>
              </div>
            </div>
          )}

          {/* Mobile Sliding Cart Drawer Sheet */}
          {showMobileCartDrawer && activeTable && (
            <div
              className="lg:hidden fixed inset-0 bg-slate-950/70 backdrop-blur-sm z-50 flex flex-col justify-end animate-in fade-in duration-200"
              onClick={() => setShowMobileCartDrawer(false)}
            >
              <div
                className="bg-white rounded-t-3xl shadow-2xl border-t border-gold-500/30 max-h-[85vh] flex flex-col overflow-hidden animate-in slide-in-from-bottom duration-200"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Drawer Header */}
                <div className="p-4 bg-forest-950 text-white flex items-center justify-between border-b border-gold-500/30">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-full bg-gold-500 text-forest-950 font-black text-sm flex items-center justify-center">
                      {activeTable.tableNumber}
                    </div>
                    <div>
                      <h3 className="font-extrabold text-sm text-gold-300">
                        Order Ticket
                      </h3>
                      <p className="text-[10px] text-slate-300">
                        {cartItems.reduce((acc, ci) => acc + ci.quantity, 0)} Items Selected • Steward: {stewardName}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowMobileCartDrawer(false)}
                    className="w-8 h-8 rounded-xl bg-forest-900 text-gold-300 hover:bg-forest-800 flex items-center justify-center border border-gold-500/30"
                  >
                    <span className="material-symbols-outlined text-lg">close</span>
                  </button>
                </div>

                {/* Items List */}
                <div className="p-4 overflow-y-auto space-y-2 max-h-[45vh] divide-y divide-slate-100">
                  {cartItems.map((ci) => (
                    <div key={ci.item.id} className="pt-2 flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <span className="text-xs font-bold text-slate-900 block truncate">
                          {ci.item.name}
                        </span>
                        <span className="text-[11px] text-slate-500">
                          ₹{(ci.item.pricePaise / 100).toFixed(0)} × {ci.quantity} = <strong>₹{((ci.item.pricePaise * ci.quantity) / 100).toFixed(0)}</strong>
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleUpdateQuantity(ci.item.id, -1)}
                          className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-rose-50 hover:text-rose-700 text-slate-800 font-black text-base flex items-center justify-center active:scale-90"
                        >
                          -
                        </button>
                        <span className="text-sm font-black text-slate-900 min-w-6 text-center">
                          {ci.quantity}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleUpdateQuantity(ci.item.id, 1)}
                          className="w-9 h-9 rounded-xl bg-forest-950 text-gold-400 font-black text-base flex items-center justify-center active:scale-90 border border-gold-500/30"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Bill Summary & Actions in Drawer */}
                <div className="p-4 bg-slate-50 border-t border-slate-200 flex flex-col gap-2.5">
                  <div className="flex items-center justify-between text-xs text-slate-600">
                    <span>Subtotal:</span>
                    <strong className="text-slate-900">₹{(subtotalPaise / 100).toFixed(2)}</strong>
                  </div>
                  <div className="flex items-center justify-between text-xs text-slate-600">
                    <span>GST (5%):</span>
                    <strong className="text-slate-900">₹{(totalTaxPaise / 100).toFixed(2)}</strong>
                  </div>
                  <div className="flex items-center justify-between text-sm font-extrabold text-slate-900 pt-1 border-t border-slate-200">
                    <span>Total Payable:</span>
                    <span className="text-lg font-black text-forest-950">
                      ₹{(roundedTotalPaise / 100).toLocaleString('en-IN')}
                    </span>
                  </div>

                  {(() => {
                    const { hasSent, shouldShow } = getKitchenSendStatus(activeTable, cartItems);

                    return shouldShow ? (
                      <div className="grid grid-cols-2 gap-2 pt-1 animate-in fade-in duration-150">
                        <button
                          type="button"
                          onClick={async () => {
                            await handleSendToKitchen();
                            setShowMobileCartDrawer(false);
                          }}
                          disabled={cartItems.length === 0 || sendingToKitchen}
                          className="h-11 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-xs flex items-center justify-center gap-1.5 active:scale-95 shadow-md"
                        >
                          <span className="material-symbols-outlined text-base">soup_kitchen</span>
                          {sendingToKitchen ? 'Sending...' : hasSent ? '🔥 Send Additional Items' : '🔥 Send Order to Kitchen'}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setShowMobileCartDrawer(false);
                            setShowPaymentModal(true);
                          }}
                          disabled={cartItems.length === 0}
                          className="h-11 rounded-xl bg-forest-950 text-gold-400 border border-gold-500/40 font-extrabold text-xs flex items-center justify-center gap-1.5 active:scale-95 shadow-md"
                        >
                          <span className="material-symbols-outlined text-base">payments</span>
                          Settle Bill
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => {
                            setShowMobileCartDrawer(false);
                            setShowPaymentModal(true);
                          }}
                          disabled={cartItems.length === 0}
                          className="w-full h-11 rounded-xl bg-forest-950 text-gold-400 border border-gold-500/40 font-extrabold text-xs flex items-center justify-center gap-1.5 active:scale-95 shadow-md"
                        >
                          <span className="material-symbols-outlined text-base">payments</span>
                          Settle Bill
                        </button>
                      </div>
                    );
                  })()}
                </div>
              </div>
            </div>
          )}

          {/* Recent Closed Bills Table */}
          <div className="ios27-glass-card p-6 rounded-[24px] border border-white/80 shadow-[0_8px_32px_rgba(0,0,0,0.04),inset_0_1px_1.5px_rgba(255,255,255,0.95)] flex flex-col gap-3">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100/80">
              <span className="font-bold text-xs text-slate-900 flex items-center gap-1.5">
                <span className="material-symbols-outlined text-slate-600 text-base">receipt_long</span>
                Recent Closed Bills Ledger
              </span>
              <span className="text-xs text-slate-500">Live Settlements</span>
            </div>

            <div className="overflow-x-auto max-h-52">
              <table className="w-full text-xs text-left">
                <thead className="bg-black/[0.02] text-slate-500 uppercase font-bold text-[10px] border-y border-black/[0.04]">
                  <tr>
                    <th className="p-2.5">Bill No</th>
                    <th className="p-2.5">Table</th>
                    <th className="p-2.5">Steward</th>
                    <th className="p-2.5">Amount</th>
                    <th className="p-2.5">Mode</th>
                    <th className="p-2.5">Status</th>
                    <th className="p-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100/80">
                  {db.bills.slice(0, 8).map((b) => (
                    <tr key={b.id} className="hover:bg-black/[0.02] transition-colors">
                      <td className="p-2.5 font-mono font-bold text-slate-900">{b.billNumber}</td>
                      <td className="p-2.5 font-bold text-slate-700">{b.tableNumber}</td>
                      <td className="p-2.5 text-slate-600">{b.stewardName}</td>
                      <td className="p-2.5 font-extrabold text-slate-900">₹{(b.totalPaise / 100).toLocaleString('en-IN')}</td>
                      <td className="p-2.5 uppercase font-bold text-slate-500 text-[11px]">{b.paymentMode || 'UPI'}</td>
                      <td className="p-2.5">
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                            b.paymentStatus === 'paid'
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : 'bg-rose-50 text-rose-700 border border-rose-200'
                          }`}
                        >
                          {b.paymentStatus}
                        </span>
                      </td>
                      <td className="p-2.5 text-right space-x-1.5">
                        <button
                          onClick={() => setActiveReceiptBill(b)}
                          className="w-8 h-8 rounded-full bg-white/80 hover:bg-white text-slate-700 border border-white/80 shadow-[0_1px_4px_rgba(0,0,0,0.04)] inline-flex items-center justify-center active:scale-[0.96] transition-all"
                          title="Print Bill"
                        >
                          <span className="material-symbols-outlined text-sm">print</span>
                        </button>
                        {b.paymentStatus === 'paid' && (currentUser.role === 'admin' || currentUser.role === 'manager') && (
                          <button
                            onClick={() => {
                              setSelectedBillForCancel(b);
                              setShowCancelModal(true);
                            }}
                            className="w-8 h-8 rounded-full bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200/60 inline-flex items-center justify-center active:scale-[0.96] transition-all"
                            title="Cancel Bill (Audit Logged)"
                          >
                            <span className="material-symbols-outlined text-sm">cancel</span>
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {/* Settle Payment Modal */}
      {showPaymentModal && selectedTable && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowPaymentModal(false);
          }}
          className="fixed inset-0 bg-black/40 backdrop-blur-xl z-50 flex items-center justify-center p-4 animate-in fade-in duration-200"
        >
          <div className="bg-white/95 backdrop-blur-2xl backdrop-saturate-180 max-w-md w-full rounded-apple-xl shadow-apple-card border border-black/[0.08] overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-5 bg-gradient-to-r from-[#05271f] to-[#021812] text-white border-b border-gold-400/20 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-apple bg-white/[0.08] border border-white/[0.1] text-gold-300 flex items-center justify-center">
                  <span className="material-symbols-outlined text-base">payments</span>
                </div>
                <h3 className="text-sm font-bold text-white tracking-tight">
                  Payment Checkout • Table {selectedTable.tableNumber}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowPaymentModal(false)}
                className="w-8 h-8 rounded-full hover:bg-white/[0.1] flex items-center justify-center text-slate-300 hover:text-white transition-colors active:scale-90"
                title="Close"
              >
                <span className="material-symbols-outlined text-base">close</span>
              </button>
            </div>

            <div className="p-6 flex flex-col gap-4 text-xs">
              <div className="text-center p-4 bg-[#05271f]/[0.04] rounded-apple border border-gold-400/20">
                <span className="text-[11px] uppercase tracking-wider font-semibold text-gold-800">
                  Total Amount Due
                </span>
                <h2 className="text-3xl font-bold text-slate-900 mt-1 tabular-nums tracking-tight">
                  ₹{(roundedTotalPaise / 100).toLocaleString('en-IN')}
                </h2>
              </div>

              {/* Payment Method Selection: ONLY UPI & CASH */}
              <div className="flex flex-col gap-2.5">
                <div className="flex items-center justify-between">
                  <label className="font-bold text-slate-900 text-xs tracking-tight">Select Payment Method:</label>
                  <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">
                    Finance Revenue Split
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2.5">
                  <button
                    type="button"
                    onClick={() => setPaymentMode('upi')}
                    className={`py-3.5 px-2 rounded-apple font-semibold text-xs flex flex-col items-center justify-center gap-1.5 transition-all active:scale-[0.97] border cursor-pointer ${
                      paymentMode === 'upi'
                        ? 'bg-[#05271f] text-gold-300 border-gold-400/40 shadow-apple-subtle'
                        : 'bg-black/[0.03] text-slate-700 border-black/[0.06] hover:bg-black/[0.05]'
                    }`}
                  >
                    <span className="material-symbols-outlined text-xl">qr_code_scanner</span>
                    <span>📱 UPI</span>
                    <span className={`text-[9px] font-medium ${paymentMode === 'upi' ? 'text-gold-200' : 'text-slate-400'}`}>
                      QR / Apps
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setPaymentMode('cash')}
                    className={`py-3.5 px-2 rounded-apple font-semibold text-xs flex flex-col items-center justify-center gap-1.5 transition-all active:scale-[0.97] border cursor-pointer ${
                      paymentMode === 'cash'
                        ? 'bg-[#05271f] text-gold-300 border-gold-400/40 shadow-apple-subtle'
                        : 'bg-black/[0.03] text-slate-700 border-black/[0.06] hover:bg-black/[0.05]'
                    }`}
                  >
                    <span className="material-symbols-outlined text-xl">payments</span>
                    <span>💵 Cash</span>
                    <span className={`text-[9px] font-medium ${paymentMode === 'cash' ? 'text-gold-200' : 'text-slate-400'}`}>
                      Register
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setPaymentMode('card')}
                    className={`py-3.5 px-2 rounded-apple font-semibold text-xs flex flex-col items-center justify-center gap-1.5 transition-all active:scale-[0.97] border cursor-pointer ${
                      paymentMode === 'card'
                        ? 'bg-[#05271f] text-gold-300 border-gold-400/40 shadow-apple-subtle'
                        : 'bg-black/[0.03] text-slate-700 border-black/[0.06] hover:bg-black/[0.05]'
                    }`}
                  >
                    <span className="material-symbols-outlined text-xl">credit_card</span>
                    <span>💳 Card</span>
                    <span className={`text-[9px] font-medium ${paymentMode === 'card' ? 'text-gold-200' : 'text-slate-400'}`}>
                      Swipe / POS
                    </span>
                  </button>
                </div>

                <div className="p-3 bg-black/[0.02] rounded-apple border border-black/[0.05] text-[11px] text-slate-600 flex items-center gap-2">
                  <span className="material-symbols-outlined text-base text-slate-400 shrink-0">info</span>
                  <span>
                    Select how the customer settled. The bill is recorded immediately with UPI and Cash revenue separated in the Finance Ledger.
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowPaymentModal(false)}
                  className="flex-1 h-11 rounded-full bg-black/[0.04] hover:bg-black/[0.07] text-slate-700 font-semibold text-xs transition-all border border-black/[0.05] active:scale-[0.97]"
                >
                  Cancel &amp; Close
                </button>
                <button
                  type="button"
                  onClick={handleConfirmSettlement}
                  disabled={isSettlingBill}
                  className="flex-2 h-11 px-4 rounded-full bg-[#05271f] hover:bg-[#031d16] text-gold-300 border border-gold-400/30 font-bold text-xs shadow-apple-subtle transition-all flex items-center justify-center gap-2 active:scale-[0.97] disabled:opacity-50"
                >
                  <span className={`material-symbols-outlined text-base ${isSettlingBill ? 'animate-spin' : ''}`}>
                    {isSettlingBill ? 'sync' : 'receipt_long'}
                  </span>
                  {isSettlingBill ? 'Generating Bill...' : 'Confirm & Generate Bill'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Move Table Modal */}
      {showMoveTableModal && selectedTable && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowMoveTableModal(false);
          }}
          className="fixed inset-0 bg-black/40 backdrop-blur-xl z-50 flex items-center justify-center p-4 animate-in fade-in duration-200"
        >
          <div className="bg-white/95 backdrop-blur-2xl backdrop-saturate-180 max-w-sm w-full rounded-apple-xl shadow-apple-card border border-black/[0.08] p-5 text-xs">
            <h3 className="font-bold text-slate-900 text-sm mb-1 tracking-tight">
              Move Guests from Table {selectedTable.tableNumber}
            </h3>
            <p className="text-slate-500 mb-3">
              Select destination vacant table to transfer active tickets:
            </p>
            <select
              value={targetTableId}
              onChange={(e) => setTargetTableId(e.target.value)}
              className="w-full h-10 px-3 rounded-apple border border-black/[0.08] bg-black/[0.02] text-xs mb-4 focus:outline-none focus:ring-2 focus:ring-gold-500/30"
            >
              <option value="">-- Choose Vacant Table --</option>
              {db.tables
                .filter((t) => t.status === 'vacant' && t.id !== selectedTable.id)
                .map((vt) => (
                  <option key={vt.id} value={vt.id}>
                    {vt.tableNumber} ({vt.section} - {vt.capacity} Seats)
                  </option>
                ))}
            </select>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowMoveTableModal(false)}
                className="px-3 py-1.5 rounded-full text-slate-600 hover:bg-black/[0.04] font-semibold transition-all active:scale-[0.97]"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmMoveTable}
                disabled={!targetTableId || isMovingTable}
                className="px-4 py-1.5 rounded-full bg-[#05271f] hover:bg-[#031d16] text-gold-300 font-semibold disabled:opacity-40 shadow-apple-subtle transition-all active:scale-[0.97] flex items-center gap-1.5"
              >
                {isMovingTable && <span className="material-symbols-outlined text-xs animate-spin">sync</span>}
                {isMovingTable ? 'Moving...' : 'Confirm Move'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cancel Bill Modal */}
      {showCancelModal && selectedBillForCancel && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowCancelModal(false);
          }}
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-150"
        >
          <div className="bg-white max-w-sm w-full rounded-2xl shadow-xl border border-slate-200 p-5 text-xs">
            <h3 className="font-bold text-rose-600 text-sm mb-1">
              Cancel Bill {selectedBillForCancel.billNumber}
            </h3>
            <p className="text-slate-500 mb-3">
              Paid bills cannot be deleted, only cancelled with a mandatory written audit reason.
            </p>
            <textarea
              required
              rows={3}
              placeholder="Enter mandatory cancellation reason..."
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              className="w-full p-2.5 rounded-xl border border-slate-300 bg-slate-50 text-xs mb-4"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowCancelModal(false)}
                className="px-3 py-1.5 rounded-xl text-slate-600 hover:bg-slate-100 font-semibold"
              >
                Close
              </button>
              <button
                disabled={isCancellingBill}
                onClick={async () => {
                  if (!cancelReason.trim()) return alert('Please provide a reason');
                  setIsCancellingBill(true);
                  try {
                    await onCancelBill(selectedBillForCancel.id, cancelReason);
                    setShowCancelModal(false);
                    setCancelReason('');
                  } finally {
                    setIsCancellingBill(false);
                  }
                }}
                className="px-4 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white font-bold flex items-center gap-1.5"
              >
                {isCancellingBill && <span className="material-symbols-outlined text-xs animate-spin">sync</span>}
                {isCancellingBill ? 'Cancelling...' : 'Confirm Cancellation'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Menu Dish Modal (Admin) */}
      {showAddDishModal && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowAddDishModal(false);
          }}
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4 animate-in fade-in duration-150"
        >
          <div className="bg-white max-w-lg w-full rounded-2xl shadow-2xl border border-slate-200 p-6 space-y-4 animate-in fade-in zoom-in duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2 text-forest-950">
                <span className="material-symbols-outlined text-2xl text-gold-600">restaurant</span>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Add New Dish to Menu</h3>
                  <p className="text-xs text-slate-500">Dish will immediately appear in the catalog for billing</p>
                </div>
              </div>
              <button
                onClick={() => setShowAddDishModal(false)}
                className="w-8 h-8 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 flex items-center justify-center"
              >
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>

            <form onSubmit={handleCreateDish} className="space-y-3.5 text-xs">
              <div className="space-y-1">
                <label className="font-bold text-slate-700">Dish / Item Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Butter Chicken, Paneer Tikka, Mango Lassi"
                  value={newDishName}
                  onChange={(e) => setNewDishName(e.target.value)}
                  className="w-full h-10 px-3.5 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 font-medium"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Category / Cuisine *</label>
                  <select
                    value={newDishCat}
                    onChange={(e) => setNewDishCat(e.target.value)}
                    className="w-full h-10 px-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 font-medium"
                  >
                    {db.categories.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                    <option value="custom">+ Create New Category</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Selling Price (₹) *</label>
                  <div className="relative">
                    <span className="absolute left-3 top-2.5 font-bold text-slate-400">₹</span>
                    <input
                      type="number"
                      required
                      min={1}
                      placeholder="280"
                      value={newDishPrice}
                      onChange={(e) => setNewDishPrice(e.target.value)}
                      className="w-full h-10 pl-7 pr-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 font-mono font-bold"
                    />
                  </div>
                </div>
              </div>

              {newDishCat === 'custom' && (
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">New Category Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Continental, Desserts, Mocktails"
                    value={newDishCustomCat}
                    onChange={(e) => setNewDishCustomCat(e.target.value)}
                    className="w-full h-10 px-3.5 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                  />
                </div>
              )}

              {/* Dietary Type Selector */}
              <div className="space-y-1">
                <label className="font-bold text-slate-700">Dietary Classification *</label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setNewDishVegType('veg')}
                    className={`py-2 px-3 rounded-xl border font-bold flex items-center justify-center gap-1.5 transition-all ${
                      newDishVegType === 'veg'
                        ? 'bg-emerald-50 text-emerald-800 border-emerald-500 ring-1 ring-emerald-500'
                        : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-600"></span>
                    Pure Veg
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewDishVegType('non-veg')}
                    className={`py-2 px-3 rounded-xl border font-bold flex items-center justify-center gap-1.5 transition-all ${
                      newDishVegType === 'non-veg'
                        ? 'bg-rose-50 text-rose-800 border-rose-500 ring-1 ring-rose-500'
                        : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    <span className="w-2.5 h-2.5 rounded-full bg-rose-600"></span>
                    Non-Veg
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewDishVegType('egg')}
                    className={`py-2 px-3 rounded-xl border font-bold flex items-center justify-center gap-1.5 transition-all ${
                      newDishVegType === 'egg'
                        ? 'bg-amber-50 text-amber-800 border-amber-500 ring-1 ring-amber-500'
                        : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-600"></span>
                    Contains Egg
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Prep Time (Mins)</label>
                  <input
                    type="number"
                    value={newDishPrepTime}
                    onChange={(e) => setNewDishPrepTime(e.target.value)}
                    className="w-full h-10 px-3.5 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 font-mono"
                  />
                </div>
                <div className="flex items-center gap-2 pt-5">
                  <input
                    type="checkbox"
                    id="bestseller_check"
                    checked={newDishIsBestseller}
                    onChange={(e) => setNewDishIsBestseller(e.target.checked)}
                    className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500 border-slate-300"
                  />
                  <label htmlFor="bestseller_check" className="font-bold text-slate-700 cursor-pointer">
                    Chef's Special / Bestseller
                  </label>
                </div>
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-700">Description / Key Notes (Optional)</label>
                <textarea
                  rows={2}
                  placeholder="e.g. Classic spiced butter gravy with marinated grilled chicken pieces"
                  value={newDishDesc}
                  onChange={(e) => setNewDishDesc(e.target.value)}
                  className="w-full p-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                />
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-700 flex items-center justify-between">
                  <span>Dish Photo</span>
                </label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => setNewDishImageFile(e.target.files?.[0] || null)}
                  className="w-full text-xs text-slate-600 file:mr-2 file:py-1 file:px-2.5 file:rounded-xl file:border-0 file:text-[11px] file:font-bold file:bg-slate-200 file:text-slate-800"
                />
                {newDishImageFile && (
                  <span className="text-[10px] text-emerald-700 font-bold block">
                    ✓ Selected: {newDishImageFile.name} ({Math.round(newDishImageFile.size / 1024)} KB)
                  </span>
                )}
              </div>

              <div className="flex justify-end gap-2.5 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAddDishModal(false)}
                  className="px-4 py-2 rounded-xl text-slate-600 hover:bg-slate-100 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={addDishLoading}
                  className="px-5 py-2.5 rounded-xl bg-forest-950 hover:bg-forest-900 border border-gold-500/40 disabled:opacity-50 text-gold-300 font-bold shadow-sm transition-all flex items-center gap-1.5 active:scale-95"
                >
                  {addDishLoading ? (
                    <span className="material-symbols-outlined text-sm animate-spin">progress_activity</span>
                  ) : (
                    <span className="material-symbols-outlined text-sm text-gold-400">check</span>
                  )}
                  Save &amp; Add to Active Menu
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Thermal Receipt Preview Modal */}
      {activeReceiptBill && (
        <ThermalReceiptModal
          bill={activeReceiptBill}
          settings={db.settings}
          onClose={() => setActiveReceiptBill(null)}
        />
      )}
    </div>
  );
};
