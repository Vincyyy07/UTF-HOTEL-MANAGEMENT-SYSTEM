'use client';

import React, { useState, useEffect } from 'react';
import { DatabaseSchema, InventoryItem, Supplier, User, StockMovement } from '../lib/types';
import { getLocalDateStr } from '../lib/dateUtils';

interface InventoryModuleProps {
  db: DatabaseSchema;
  currentUser: User;
  onStockIn: (data: any) => Promise<void>;
  onStockOut: (data: any) => Promise<void>;
  onQuickReorder: (itemId: string, quantity?: number) => Promise<void>;
  onInventoryAction?: (action: string, payload: any) => Promise<any>;
}

export const InventoryModule: React.FC<InventoryModuleProps> = ({
  db,
  currentUser,
  onStockIn,
  onStockOut,
  onQuickReorder,
  onInventoryAction,
}) => {
  // Navigation tabs
  const [activeTab, setActiveTab] = useState<'inventory' | 'reorder_desk' | 'movements' | 'suppliers'>('inventory');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCategory, setFilterCategory] = useState('All');
  const [filterStatus, setFilterStatus] = useState<'all' | 'healthy' | 'low_only' | 'out_of_stock'>('all');
  const [showConceptGuide, setShowConceptGuide] = useState(false);

  // Stock In Modal
  const [showStockInModal, setShowStockInModal] = useState(false);
  const [stockInItemId, setStockInItemId] = useState(db.inventory[0]?.id || '');
  const [stockInSupplierId, setStockInSupplierId] = useState(db.inventory[0]?.supplierId || db.suppliers[0]?.id || '');
  const [stockInQty, setStockInQty] = useState<number>(10);
  const [stockInUnitCost, setStockInUnitCost] = useState<number>(135);
  const [stockInInvoice, setStockInInvoice] = useState(`INV-${Date.now().toString().slice(-4)}`);
  const [stockInNotes, setStockInNotes] = useState('');

  // Auto-sync item selections if inventory changes or items are deleted
  useEffect(() => {
    if (db.inventory.length > 0) {
      if (!db.inventory.some((i) => i.id === stockInItemId)) {
        const first = db.inventory[0];
        setStockInItemId(first.id);
        setStockInSupplierId(first.supplierId || db.suppliers[0]?.id || '');
        setStockInUnitCost(Math.round(first.costPerUnitPaise / 100));
      }
      if (!db.inventory.some((i) => i.id === stockOutItemId)) {
        setStockOutItemId(db.inventory[0].id);
      }
      if (!db.inventory.some((i) => i.id === auditItemId)) {
        setAuditItemId(db.inventory[0].id);
      }
    }
  }, [db.inventory]);

  // Stock Out Modal
  const [showStockOutModal, setShowStockOutModal] = useState(false);
  const [stockOutItemId, setStockOutItemId] = useState(db.inventory[0]?.id || '');
  const [stockOutQty, setStockOutQty] = useState<number>(5);
  const [stockOutType, setStockOutType] = useState<'out_kitchen_usage' | 'out_wastage_spoilage'>('out_kitchen_usage');
  const [stockOutNotes, setStockOutNotes] = useState('');

  // Add Item Modal
  const [showAddItemModal, setShowAddItemModal] = useState(false);
  const [newItemName, setNewItemName] = useState('');
  const [newItemCode, setNewItemCode] = useState('');
  const [newItemCategory, setNewItemCategory] = useState('Grains & Rice');
  const [newItemUnit, setNewItemUnit] = useState<'kg' | 'liters' | 'packets' | 'cylinders' | 'boxes' | 'tins' | 'pieces'>('kg');
  const [newItemStock, setNewItemStock] = useState<number>(10);
  const [newItemMinReserve, setNewItemMinReserve] = useState<number>(5);
  const [newItemCost, setNewItemCost] = useState<number>(120);
  const [newItemSupplierId, setNewItemSupplierId] = useState(db.suppliers[0]?.id || '');

  // Edit Item Modal
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [editName, setEditName] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [editUnit, setEditUnit] = useState<any>('kg');
  const [editMinReserve, setEditMinReserve] = useState<number>(5);
  const [editCost, setEditCost] = useState<number>(0);
  const [editSupplierId, setEditSupplierId] = useState('');

  // Physical Audit Reconciliation Modal
  const [showAuditModal, setShowAuditModal] = useState(false);
  const [auditItemId, setAuditItemId] = useState(db.inventory[0]?.id || '');
  const [auditActualCount, setAuditActualCount] = useState<number>(0);
  const [auditReason, setAuditReason] = useState('Weekly Physical Count');

  // Add Supplier Modal
  const [showSupplierModal, setShowSupplierModal] = useState(false);
  const [supName, setSupName] = useState('');
  const [supCategory, setSupCategory] = useState('General Food & Provisions');
  const [supPhone, setSupPhone] = useState('');
  const [supEmail, setSupEmail] = useState('');
  const [supContact, setSupContact] = useState('');
  const [supGstin, setSupGstin] = useState('');
  const [supAddress, setSupAddress] = useState('');

  const [notificationMsg, setNotificationMsg] = useState<string | null>(null);

  const showNotification = (msg: string) => {
    setNotificationMsg(msg);
    setTimeout(() => setNotificationMsg(null), 4000);
  };

  const categories = ['All', 'Grains & Rice', 'Dairy', 'Produce', 'Meat & Seafood', 'Fuel', 'Spices', 'Oils & Ghee', 'Packaging'];

  // Calculations for KPI Cards
  const totalValuationPaise = db.inventory.reduce((sum, item) => sum + item.currentStock * item.costPerUnitPaise, 0);
  const totalValuationRupees = Math.round(totalValuationPaise / 100);

  const lowStockItems = db.inventory.filter((i) => i.currentStock > 0 && i.currentStock <= i.minimumReserve);
  const outOfStockItems = db.inventory.filter((i) => i.currentStock === 0);
  const healthyItems = db.inventory.filter((i) => i.currentStock > i.minimumReserve);

  const todayStr = getLocalDateStr();
  const todayMovements = db.stockMovements.filter((m) => m.date === todayStr);
  const todayInCost = todayMovements
    .filter((m) => m.type === 'in_purchase')
    .reduce((sum, m) => sum + m.totalCostPaise, 0);
  const todayOutUsageCount = todayMovements.filter((m) => m.type === 'out_kitchen_usage').length;
  const todayWastageCost = todayMovements
    .filter((m) => m.type === 'out_wastage_spoilage')
    .reduce((sum, m) => sum + m.totalCostPaise, 0);

  // Filtered items for main catalog
  const filteredItems = db.inventory.filter((item) => {
    if (filterCategory !== 'All' && item.category !== filterCategory) return false;
    if (filterStatus === 'low_only' && (item.currentStock > item.minimumReserve || item.currentStock === 0)) return false;
    if (filterStatus === 'out_of_stock' && item.currentStock !== 0) return false;
    if (filterStatus === 'healthy' && item.currentStock <= item.minimumReserve) return false;
    if (searchQuery.trim() !== '') {
      const q = searchQuery.toLowerCase();
      return (
        item.name.toLowerCase().includes(q) ||
        item.itemCode.toLowerCase().includes(q) ||
        item.supplierName.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q)
      );
    }
    return true;
  });

  // Action handlers
  const handleOpenStockIn = (item?: InventoryItem) => {
    const targetItem = item || db.inventory[0];
    if (targetItem) {
      setStockInItemId(targetItem.id);
      setStockInUnitCost(Math.round(targetItem.costPerUnitPaise / 100));
      setStockInQty(10);
      setStockInInvoice(`INV-${Date.now().toString().slice(-4)}`);
      setStockInNotes('');
    }
    setShowStockInModal(true);
  };

  const handleOpenStockOut = (item?: InventoryItem) => {
    const targetItem = item || db.inventory[0];
    if (targetItem) {
      setStockOutItemId(targetItem.id);
      setStockOutQty(Math.min(targetItem.currentStock > 0 ? 5 : 1, targetItem.currentStock || 1));
      setStockOutType('out_kitchen_usage');
      setStockOutNotes('');
    }
    setShowStockOutModal(true);
  };

  const handleOpenEdit = (item: InventoryItem) => {
    setEditingItem(item);
    setEditName(item.name);
    setEditCategory(item.category);
    setEditUnit(item.unit);
    setEditMinReserve(item.minimumReserve);
    setEditCost(Math.round(item.costPerUnitPaise / 100));
    setEditSupplierId(item.supplierId || '');
    setShowEditModal(true);
  };

  const handleOpenAudit = (item?: InventoryItem) => {
    const targetItem = item || db.inventory[0];
    if (targetItem) {
      setAuditItemId(targetItem.id);
      setAuditActualCount(targetItem.currentStock);
      setAuditReason('Weekly Physical Stock Count');
    }
    setShowAuditModal(true);
  };

  const handleExecuteStockIn = async (e: React.FormEvent) => {
    e.preventDefault();
    const item = db.inventory.find((i) => i.id === stockInItemId);
    await onStockIn({
      itemId: stockInItemId,
      supplierId: stockInSupplierId || item?.supplierId,
      quantity: Number(stockInQty),
      unitCostPaise: Number(stockInUnitCost) * 100,
      invoiceNumber: stockInInvoice,
      notes: stockInNotes,
    });
    setShowStockInModal(false);
    showNotification(`✅ Stock In Recorded: +${stockInQty} ${item?.unit || 'units'} of ${item?.name}. ₹${(stockInQty * stockInUnitCost).toLocaleString('en-IN')} posted to Finance ledger.`);
  };

  const handleExecuteStockOut = async (e: React.FormEvent) => {
    e.preventDefault();
    const item = db.inventory.find((i) => i.id === stockOutItemId);
    await onStockOut({
      itemId: stockOutItemId,
      quantity: Number(stockOutQty),
      type: stockOutType,
      notes: stockOutNotes,
    });
    setShowStockOutModal(false);
    showNotification(`✅ Stock Out Logged: -${stockOutQty} ${item?.unit || 'units'} of ${item?.name} (${stockOutType === 'out_kitchen_usage' ? 'Kitchen Usage' : 'Wastage/Spoilage'}).`);
  };

  const handleExecuteAddItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onInventoryAction) {
      alert('Action not supported');
      return;
    }
    await onInventoryAction('ADD_ITEM', {
      name: newItemName,
      itemCode: newItemCode || undefined,
      category: newItemCategory,
      unit: newItemUnit,
      currentStock: Number(newItemStock),
      minimumReserve: Number(newItemMinReserve),
      costPerUnit: Number(newItemCost),
      supplierId: newItemSupplierId,
    });
    setShowAddItemModal(false);
    setNewItemName('');
    showNotification(`✅ New item "${newItemName}" registered successfully with ${newItemStock} ${newItemUnit} opening stock.`);
  };

  const handleExecuteUpdateItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingItem || !onInventoryAction) return;
    await onInventoryAction('UPDATE_ITEM', {
      itemId: editingItem.id,
      name: editName,
      category: editCategory,
      unit: editUnit,
      minimumReserve: Number(editMinReserve),
      costPerUnit: Number(editCost),
      supplierId: editSupplierId,
    });
    setShowEditModal(false);
    showNotification(`✅ Item "${editName}" updated successfully.`);
  };

  const handleDeleteItem = async (item: InventoryItem) => {
    if (!window.confirm(`Are you sure you want to delete ${item.name} (${item.itemCode}) from inventory?`)) return;
    if (onInventoryAction) {
      await onInventoryAction('DELETE_ITEM', { itemId: item.id });
      showNotification(`🗑️ Item "${item.name}" deleted.`);
    }
  };

  const handleExecuteAuditCount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onInventoryAction) return;
    const target = db.inventory.find((i) => i.id === auditItemId);
    await onInventoryAction('ADJUST_STOCK', {
      itemId: auditItemId,
      actualStock: Number(auditActualCount),
      reason: auditReason,
    });
    setShowAuditModal(false);
    showNotification(`⚖️ Physical count reconciled for "${target?.name}": Adjusted to ${auditActualCount} ${target?.unit}. Variance logged to audit ledger.`);
  };

  const handleExecuteAddSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onInventoryAction) return;
    await onInventoryAction('ADD_SUPPLIER', {
      name: supName,
      category: supCategory,
      phone: supPhone,
      email: supEmail,
      contactPerson: supContact,
      gstin: supGstin,
      address: supAddress,
    });
    setShowSupplierModal(false);
    setSupName('');
    setSupPhone('');
    showNotification(`✅ New supplier "${supName}" added to vendor directory.`);
  };

  const handleTriggerReorder = async (item: InventoryItem) => {
    await onQuickReorder(item.id);
    showNotification(`🛒 Reorder PO created for ${item.name} (${item.minimumReserve * 2} ${item.unit}) -> Added to upcoming liabilities!`);
  };

  // Selected item helpers for modals
  const selectedStockInItem = db.inventory.find((i) => i.id === stockInItemId);
  const selectedStockOutItem = db.inventory.find((i) => i.id === stockOutItemId);
  const selectedAuditItem = db.inventory.find((i) => i.id === auditItemId);

  return (
    <div className="p-3.5 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-5 animate-in fade-in duration-200">
      
      {/* Toast Notification */}
      {notificationMsg && (
        <div className="fixed top-5 right-5 z-50 bg-slate-900 text-white px-4 py-3 rounded-2xl shadow-2xl border border-slate-700 text-xs font-semibold flex items-center gap-2 animate-in slide-in-from-top-4 duration-200">
          <span>{notificationMsg}</span>
          <button onClick={() => setNotificationMsg(null)} className="ml-2 text-slate-400 hover:text-white">✕</button>
        </div>
      )}

      {/* 1. TOP HEADER & MAIN ACTION BUTTONS */}
      <div className="relative overflow-hidden rounded-[26px] bg-white/90 backdrop-blur-2xl border border-white/80 shadow-[0_12px_40px_rgba(0,0,0,0.04),inset_0_1px_2px_rgba(255,255,255,0.95)] p-5 sm:p-6 transition-all space-y-4">
        {/* Subtle royal ambient glow in top-right corner */}
        <div className="pointer-events-none absolute -top-24 -right-24 w-80 h-80 rounded-full bg-gradient-to-br from-emerald-400/10 via-gold-400/8 to-transparent blur-3xl" />

        {/* Top Tier: Title, Identity & Action Buttons */}
        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          {/* Left: Emblem, Title & Subtitle */}
          <div className="flex items-center gap-3.5 min-w-0 flex-1">
            {/* 3D Glass Emblem Icon */}
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-600 to-forest-950 text-gold-300 flex items-center justify-center shadow-[0_4px_16px_rgba(5,39,31,0.25)] border border-gold-400/30 shrink-0">
              <span className="material-symbols-outlined text-2xl text-gold-300">inventory_2</span>
            </div>

            <div className="min-w-0 flex-1 space-y-0.5">
              <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight leading-tight">
                Restaurant Inventory &amp; Stock Control
              </h1>
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 flex-wrap">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                <span className="text-slate-700 font-medium">Centralized Live Ledger Connected</span>
                <span className="text-slate-300">•</span>
                <span className="text-slate-500 font-medium">Finance &amp; POS Linked</span>
              </div>
            </div>
          </div>

          {/* Right: Global Action Buttons */}
          <div className="flex flex-wrap items-center gap-2 sm:gap-2.5 shrink-0">
            {/* Primary Stock In */}
            <button
              onClick={() => handleOpenStockIn()}
              className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 via-emerald-600 to-teal-700 hover:from-emerald-500 hover:to-teal-600 text-white text-xs font-bold shadow-[0_4px_16px_rgba(16,185,129,0.25)] border border-emerald-500/40 transition-all flex items-center gap-1.5 active:scale-[0.97]"
              title="Record goods delivery from supplier. Automatically creates Finance expense."
            >
              <span className="material-symbols-outlined text-base">add_shopping_cart</span>
              <span>+ Stock In</span>
            </button>

            {/* Secondary Stock Out */}
            <button
              onClick={() => handleOpenStockOut()}
              className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-slate-900 to-[#05271f] hover:from-slate-800 hover:to-forest-900 text-white text-xs font-bold shadow-[0_4px_16px_rgba(0,0,0,0.15)] border border-slate-700/60 transition-all flex items-center gap-1.5 active:scale-[0.97]"
              title="Deduct ingredients issued for cooking or wasted in kitchen."
            >
              <span className="material-symbols-outlined text-base text-gold-300">soup_kitchen</span>
              <span>- Stock Out</span>
            </button>

            {/* New Item */}
            <button
              onClick={() => setShowAddItemModal(true)}
              className="px-3.5 py-2.5 rounded-xl bg-white hover:bg-slate-50 text-slate-800 hover:text-slate-900 border border-slate-200/90 text-xs font-bold shadow-2xs transition-all flex items-center gap-1.5 active:scale-[0.97]"
              title="Register a new raw material or ingredient into the restaurant catalog."
            >
              <span className="material-symbols-outlined text-base text-emerald-600">add_circle</span>
              <span>New Item</span>
            </button>

            {/* Audit Count */}
            <button
              onClick={() => handleOpenAudit()}
              className="px-3.5 py-2.5 rounded-xl bg-white hover:bg-slate-50 text-slate-800 hover:text-slate-900 border border-slate-200/90 text-xs font-bold shadow-2xs transition-all flex items-center gap-1.5 active:scale-[0.97]"
              title="Perform physical shelf stock count and reconcile system balance."
            >
              <span className="material-symbols-outlined text-base text-amber-600">balance</span>
              <span>Audit Count</span>
            </button>
          </div>
        </div>

        {/* Bottom Tier: Feature Pillars & Live Ledger Sync Status */}
        <div className="relative z-10 pt-3 border-t border-slate-100/90 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            {/* 1. Raw Material Tracking */}
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-slate-50/90 hover:bg-emerald-50/70 border border-slate-200/70 hover:border-emerald-200/80 text-slate-700 transition-colors shadow-2xs">
              <span className="material-symbols-outlined text-[15px] text-emerald-600">inventory</span>
              <span className="font-semibold text-slate-800">Raw Material Tracking</span>
              <span className="text-[10px] text-slate-400 font-medium">({db.inventory.length} SKUs)</span>
            </div>

            {/* 2. Kitchen Consumption */}
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-slate-50/90 hover:bg-amber-50/70 border border-slate-200/70 hover:border-amber-200/80 text-slate-700 transition-colors shadow-2xs">
              <span className="material-symbols-outlined text-[15px] text-amber-600">skillet</span>
              <span className="font-semibold text-slate-800">Kitchen Consumption</span>
              <span className="text-[10px] text-slate-400 font-medium">({todayOutUsageCount} logged)</span>
            </div>

            {/* 3. Wastage Control */}
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-slate-50/90 hover:bg-rose-50/70 border border-slate-200/70 hover:border-rose-200/80 text-slate-700 transition-colors shadow-2xs">
              <span className="material-symbols-outlined text-[15px] text-rose-600">delete_sweep</span>
              <span className="font-semibold text-slate-800">Wastage Control</span>
              <span className="text-[10px] text-slate-400 font-medium">(₹{(todayWastageCost / 100).toFixed(0)} today)</span>
            </div>

            {/* 4. Automated Finance Procurement Sync */}
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-slate-50/90 hover:bg-blue-50/70 border border-slate-200/70 hover:border-blue-200/80 text-slate-700 transition-colors shadow-2xs">
              <span className="material-symbols-outlined text-[15px] text-blue-600">account_balance_wallet</span>
              <span className="font-semibold text-slate-800">Automated Finance Sync</span>
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            </div>
          </div>
        </div>
      </div>

      {/* 2. EDUCATIONAL CONCEPT WALKTHROUGH BANNER (Explains the whole lifecycle clearly) */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-950 text-white rounded-2xl p-4 sm:p-5 shadow-sm border border-slate-700/60 overflow-hidden">
        <div className="flex items-center justify-between gap-2 cursor-pointer" onClick={() => setShowConceptGuide(!showConceptGuide)}>
          <div className="flex items-center gap-2.5">
            <span className="w-7 h-7 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold text-sm border border-emerald-500/30">
              💡
            </span>
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                Understanding the Restaurant Inventory Lifecycle
                <span className="text-[10px] font-medium bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-full border border-emerald-500/30">
                  Core Guide
                </span>
              </h3>
              <p className="text-[11px] text-slate-300">
                How United Food Palace connects daily deliveries, cooking consumption, waste control, and money accounting.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setShowConceptGuide(!showConceptGuide);
            }}
            className="text-xs text-slate-300 hover:text-white px-2.5 py-1 rounded-lg bg-slate-800/90 hover:bg-slate-700 border border-slate-700/80 transition-all font-semibold flex items-center gap-1 shrink-0"
          >
            <span>{showConceptGuide ? 'Hide Guide ▲' : 'Show Guide ▼'}</span>
          </button>
        </div>

        {showConceptGuide && (
          <div className="mt-4 pt-4 border-t border-slate-700/60 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs animate-in fade-in duration-200">
            {/* Step 1 */}
            <div className="bg-slate-800/80 p-3.5 rounded-xl border border-slate-700/80 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-2 text-emerald-400 font-bold mb-1">
                  <span className="w-5 h-5 rounded-full bg-emerald-500/20 flex items-center justify-center text-[10px]">1</span>
                  <span>Stock In (Delivery)</span>
                </div>
                <p className="text-[11px] text-slate-300 leading-relaxed">
                  When a vendor delivers goods (rice, chicken, oil, spices), click <strong>"+ Stock In"</strong>. It adds to current stock and <strong>auto-posts a direct expense</strong> to the Finance module.
                </p>
              </div>
              <span className="mt-2 text-[10px] text-emerald-300 font-mono">Role: Storekeeper / Purchase Manager</span>
            </div>

            {/* Step 2 */}
            <div className="bg-slate-800/80 p-3.5 rounded-xl border border-slate-700/80 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-2 text-blue-400 font-bold mb-1">
                  <span className="w-5 h-5 rounded-full bg-blue-500/20 flex items-center justify-center text-[10px]">2</span>
                  <span>Stock Out (Kitchen Usage)</span>
                </div>
                <p className="text-[11px] text-slate-300 leading-relaxed">
                  When the chef issues raw materials for daily cooking prep, click <strong>"- Stock Out"</strong> and choose <em>Kitchen Usage</em>. Keeps stock records accurate in real time.
                </p>
              </div>
              <span className="mt-2 text-[10px] text-blue-300 font-mono">Role: Head Chef / Kitchen Cooks</span>
            </div>

            {/* Step 3 */}
            <div className="bg-slate-800/80 p-3.5 rounded-xl border border-slate-700/80 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-2 text-rose-400 font-bold mb-1">
                  <span className="w-5 h-5 rounded-full bg-rose-500/20 flex items-center justify-center text-[10px]">3</span>
                  <span>Wastage &amp; Spoilage</span>
                </div>
                <p className="text-[11px] text-slate-300 leading-relaxed">
                  If vegetables spoil, milk curdles, or food is damaged, log it as <strong>Wastage</strong>. This isolates kitchen shrinkage so management can monitor food cost leakage.
                </p>
              </div>
              <span className="mt-2 text-[10px] text-rose-300 font-mono">Role: Kitchen In-charge / Auditor</span>
            </div>

            {/* Step 4 */}
            <div className="bg-slate-800/80 p-3.5 rounded-xl border border-slate-700/80 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-2 text-amber-400 font-bold mb-1">
                  <span className="w-5 h-5 rounded-full bg-amber-500/20 flex items-center justify-center text-[10px]">4</span>
                  <span>Par Level Safety Buffer</span>
                </div>
                <p className="text-[11px] text-slate-300 leading-relaxed">
                  Each ingredient has a <strong>Minimum Reserve</strong> (par level). When stock hits this floor, the system flags it in yellow/red with a <strong>1-Click PO Reorder</strong> button.
                </p>
              </div>
              <span className="mt-2 text-[10px] text-amber-300 font-mono">Role: Restaurant General Manager</span>
            </div>
          </div>
        )}
      </div>

      {/* 3. LIVE INVENTORY HEALTH & KPI METRICS */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* Card 1: Total Valuation */}
        <div className="ios27-glass-card p-4 sm:p-5 rounded-[22px] flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Stock Value</span>
            <div className="w-8 h-8 rounded-apple bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined text-base">payments</span>
            </div>
          </div>
          <div className="mt-2.5">
            <h3 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight tabular-nums">
              ₹{totalValuationRupees.toLocaleString('en-IN')}
            </h3>
            <p className="text-[11px] text-slate-500 mt-1 font-medium">
              Across {db.inventory.length} ingredients &amp; supplies
            </p>
          </div>
        </div>

        {/* Card 2: Stock Health Ratio */}
        <div className="ios27-glass-card p-4 sm:p-5 rounded-[22px] flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Stock Health</span>
            <div className="w-8 h-8 rounded-apple bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined text-base">health_and_safety</span>
            </div>
          </div>
          <div className="mt-2.5">
            <div className="flex items-center gap-2">
              <span className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight tabular-nums">
                {healthyItems.length}
              </span>
              <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200/60">
                Healthy ({Math.round((healthyItems.length / (db.inventory.length || 1)) * 100)}%)
              </span>
            </div>
            <p className="text-[11px] text-slate-500 mt-1 font-medium">
              {lowStockItems.length} Low Buffer • {outOfStockItems.length} Empty
            </p>
          </div>
        </div>

        {/* Card 3: Today's Purchases */}
        <div className="ios27-glass-card p-4 sm:p-5 rounded-[22px] flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Today's Inflow</span>
            <div className="w-8 h-8 rounded-apple bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined text-base">local_shipping</span>
            </div>
          </div>
          <div className="mt-2.5">
            <h3 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight tabular-nums">
              ₹{(todayInCost / 100).toLocaleString('en-IN')}
            </h3>
            <p className="text-[11px] text-slate-500 mt-1 font-medium">
              Auto-posted to Finance Procurement
            </p>
          </div>
        </div>

        {/* Card 4: Kitchen Usage & Wastage */}
        <div className="ios27-glass-card p-4 sm:p-5 rounded-[22px] flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Today's Consumption</span>
            <div className="w-8 h-8 rounded-apple bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined text-base">cooking</span>
            </div>
          </div>
          <div className="mt-2.5">
            <div className="flex items-center gap-2">
              <h3 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight tabular-nums">
                {todayOutUsageCount} Logs
              </h3>
              {todayWastageCost > 0 && (
                <span className="text-[10px] font-semibold text-rose-700 bg-rose-50 px-2 py-0.5 rounded-full border border-rose-200/60">
                  ₹{(todayWastageCost / 100).toFixed(0)} Waste
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-500 mt-1 font-medium">
              Issued to cooks &amp; chefs today
            </p>
          </div>
        </div>
      </div>

      {/* 4. SUB-MODULE NAVIGATION TABS */}
      <div className="ios27-glass-card p-2.5 rounded-[20px] flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5 text-xs font-semibold">
          <button
            onClick={() => setActiveTab('inventory')}
            className={`px-4 py-2 rounded-xl transition-all flex items-center gap-1.5 ${
              activeTab === 'inventory'
                ? 'bg-slate-900 text-white shadow-xs font-bold'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <span className="material-symbols-outlined text-base">shelves</span>
            <span>All Stock Items ({db.inventory.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('reorder_desk')}
            className={`px-4 py-2 rounded-xl transition-all flex items-center gap-1.5 ${
              activeTab === 'reorder_desk'
                ? 'bg-amber-600 text-white shadow-xs font-bold'
                : 'text-amber-800 hover:bg-amber-50'
            }`}
          >
            <span className="material-symbols-outlined text-base">warning</span>
            <span>Reorder Desk ({lowStockItems.length + outOfStockItems.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('movements')}
            className={`px-4 py-2 rounded-xl transition-all flex items-center gap-1.5 ${
              activeTab === 'movements'
                ? 'bg-slate-900 text-white shadow-xs font-bold'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <span className="material-symbols-outlined text-base">history_edu</span>
            <span>Movements &amp; Audit Ledger ({db.stockMovements.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('suppliers')}
            className={`px-4 py-2 rounded-xl transition-all flex items-center gap-1.5 ${
              activeTab === 'suppliers'
                ? 'bg-slate-900 text-white shadow-xs font-bold'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <span className="material-symbols-outlined text-base">store</span>
            <span>Suppliers Directory ({db.suppliers.length})</span>
          </button>
        </div>

        {/* Quick Filter Badges when on Inventory tab */}
        {activeTab === 'inventory' && (
          <div className="flex items-center gap-1 text-xs">
            <button
              onClick={() => setFilterStatus('all')}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-bold ${
                filterStatus === 'all' ? 'bg-slate-200 text-slate-800' : 'text-slate-500 hover:bg-slate-100'
              }`}
            >
              All ({db.inventory.length})
            </button>
            <button
              onClick={() => setFilterStatus('healthy')}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-bold ${
                filterStatus === 'healthy' ? 'bg-emerald-100 text-emerald-800' : 'text-slate-500 hover:bg-slate-100'
              }`}
            >
              Healthy ({healthyItems.length})
            </button>
            <button
              onClick={() => setFilterStatus('low_only')}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-bold ${
                filterStatus === 'low_only' ? 'bg-amber-100 text-amber-800' : 'text-slate-500 hover:bg-slate-100'
              }`}
            >
              Low Buffer ({lowStockItems.length})
            </button>
            <button
              onClick={() => setFilterStatus('out_of_stock')}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-bold ${
                filterStatus === 'out_of_stock' ? 'bg-rose-100 text-rose-800' : 'text-slate-500 hover:bg-slate-100'
              }`}
            >
              Empty ({outOfStockItems.length})
            </button>
          </div>
        )}
      </div>

      {/* 5. TAB 1: ALL STOCK ITEMS */}
      {activeTab === 'inventory' && (
        <div className="space-y-4">
          {/* Category Pills & Search */}
          <div className="bg-white p-3.5 rounded-2xl shadow-sm border border-slate-200/80 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-1.5 overflow-x-auto text-xs py-0.5">
              {categories.map((c) => (
                <button
                  key={c}
                  onClick={() => setFilterCategory(c)}
                  className={`px-3 py-1.5 rounded-xl font-semibold whitespace-nowrap transition-all text-xs ${
                    filterCategory === c
                      ? 'bg-emerald-600 text-white shadow-xs'
                      : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>

            <div className="relative w-full sm:w-72">
              <span className="material-symbols-outlined absolute left-3 top-2.5 text-base text-slate-400">search</span>
              <input
                type="text"
                placeholder="Search raw material, code, vendor..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full h-9 pl-9 pr-3 text-xs rounded-xl bg-slate-50 border border-slate-200 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 text-slate-900 transition-all placeholder:text-slate-400"
              />
            </div>
          </div>

          {/* Table Card */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200/80 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 border-b border-slate-200/80 text-slate-500 font-bold uppercase tracking-wider text-[11px]">
                  <tr>
                    <th className="py-3 px-4">Item &amp; SKU</th>
                    <th className="py-3 px-4">Category</th>
                    <th className="py-3 px-4">Current Stock / Par Buffer</th>
                    <th className="py-3 px-4">Stock Health</th>
                    <th className="py-3 px-4">Unit Cost</th>
                    <th className="py-3 px-4">Total Value</th>
                    <th className="py-3 px-4">Preferred Vendor</th>
                    <th className="py-3 px-4 text-right">Quick Stock Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredItems.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-12 text-center text-slate-400">
                        <div className="flex flex-col items-center gap-2">
                          <span className="material-symbols-outlined text-4xl text-slate-300">inventory_2</span>
                          <p className="font-bold text-slate-600 text-sm">No inventory items matched your filter.</p>
                          <p className="text-xs text-slate-400">Try changing categories, status filters, or search keywords.</p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    filteredItems.map((item) => {
                      const isLow = item.currentStock <= item.minimumReserve && item.currentStock > 0;
                      const isOut = item.currentStock === 0;
                      const bufferPercent = item.minimumReserve > 0 
                        ? Math.min(100, Math.round((item.currentStock / (item.minimumReserve * 2)) * 100))
                        : 100;
                      const itemTotalValueRupees = Math.round((item.currentStock * item.costPerUnitPaise) / 100);

                      return (
                        <tr key={item.id} className="hover:bg-slate-50/80 transition-colors">
                          {/* Item & Code */}
                          <td className="py-3.5 px-4">
                            <div className="flex flex-col">
                              <span className="font-mono text-[10px] text-slate-400 font-semibold">{item.itemCode}</span>
                              <span className="font-bold text-slate-900 text-xs sm:text-sm">{item.name}</span>
                              <span className="text-[10px] text-slate-400 mt-0.5">Last restocked: {item.lastRestockedDate || '—'}</span>
                            </div>
                          </td>

                          {/* Category */}
                          <td className="py-3.5 px-4">
                            <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 font-medium text-[11px] whitespace-nowrap">
                              {item.category}
                            </span>
                          </td>

                          {/* Current Stock vs Minimum Reserve */}
                          <td className="py-3.5 px-4">
                            <div className="flex flex-col gap-1 min-w-[120px]">
                              <div className="flex items-center justify-between font-mono">
                                <span className={`text-xs font-black ${isOut ? 'text-rose-600' : isLow ? 'text-amber-600' : 'text-slate-900'}`}>
                                  {item.currentStock} {item.unit}
                                </span>
                                <span className="text-[10px] text-slate-400">
                                  Min: {item.minimumReserve} {item.unit}
                                </span>
                              </div>
                              {/* Stock Level Progress Bar */}
                              <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full transition-all ${
                                    isOut ? 'bg-rose-500 w-1' : isLow ? 'bg-amber-500' : 'bg-emerald-500'
                                  }`}
                                  style={{ width: `${Math.max(4, bufferPercent)}%` }}
                                />
                              </div>
                            </div>
                          </td>

                          {/* Stock Health Badge */}
                          <td className="py-3.5 px-4">
                            <span
                              className={`px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-wider inline-flex items-center gap-1.5 ${
                                isOut
                                  ? 'bg-rose-50 text-rose-700 border border-rose-200'
                                  : isLow
                                  ? 'bg-amber-50 text-amber-700 border border-amber-200'
                                  : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              }`}
                            >
                              <span className={`w-1.5 h-1.5 rounded-full ${isOut ? 'bg-rose-500 animate-ping' : isLow ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                              {isOut ? 'Out of Stock' : isLow ? 'Low Buffer' : 'In Stock'}
                            </span>
                          </td>

                          {/* Unit Cost */}
                          <td className="py-3.5 px-4 font-mono">
                            <span className="font-bold text-slate-800">₹{(item.costPerUnitPaise / 100).toFixed(0)}</span>
                            <span className="text-[10px] text-slate-400">/{item.unit}</span>
                          </td>

                          {/* Total Valuation */}
                          <td className="py-3.5 px-4 font-mono font-bold text-slate-900">
                            ₹{itemTotalValueRupees.toLocaleString('en-IN')}
                          </td>

                          {/* Preferred Vendor */}
                          <td className="py-3.5 px-4">
                            <span className="text-slate-700 font-medium block truncate max-w-[130px]" title={item.supplierName}>
                              {item.supplierName}
                            </span>
                          </td>

                          {/* Quick Actions */}
                          <td className="py-3.5 px-4 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              {/* Quick Stock In */}
                              <button
                                onClick={() => handleOpenStockIn(item)}
                                className="px-2.5 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200/80 text-[11px] font-bold transition-all"
                                title="Add delivered stock for this item"
                              >
                                + In
                              </button>

                              {/* Quick Stock Out */}
                              <button
                                onClick={() => handleOpenStockOut(item)}
                                className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 text-[11px] font-bold transition-all"
                                title="Record kitchen usage or wastage for this item"
                              >
                                - Out
                              </button>

                              {/* Quick Reorder if low or out */}
                              {(isLow || isOut) && (
                                <button
                                  onClick={() => handleTriggerReorder(item)}
                                  className="px-2.5 py-1 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200/80 text-[11px] font-bold transition-all shadow-2xs"
                                  title="Trigger 1-Click Purchase Order Reorder"
                                >
                                  🛒 PO
                                </button>
                              )}

                              {/* Edit Item */}
                              <button
                                onClick={() => handleOpenEdit(item)}
                                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-all"
                                title="Edit min reserve or price"
                              >
                                <span className="material-symbols-outlined text-sm">edit</span>
                              </button>

                              {/* Delete Item */}
                              <button
                                onClick={() => handleDeleteItem(item)}
                                className="p-1 rounded-lg text-slate-300 hover:text-rose-600 hover:bg-rose-50 transition-all"
                                title="Delete item"
                              >
                                <span className="material-symbols-outlined text-sm">delete</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* 6. TAB 2: REORDER DESK (Low Stock Focus) */}
      {activeTab === 'reorder_desk' && (
        <div className="space-y-4">
          <div className="bg-amber-50 border border-amber-200/80 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-800 flex items-center justify-center font-bold">
                <span className="material-symbols-outlined text-2xl">priority_high</span>
              </div>
              <div>
                <h3 className="font-extrabold text-amber-900 text-sm sm:text-base">
                  Purchase Reorder Desk ({lowStockItems.length + outOfStockItems.length} Urgent Items)
                </h3>
                <p className="text-xs text-amber-800/80 mt-0.5">
                  These raw materials have fallen below the kitchen's minimum safety buffer. Reorder now to prevent stockouts during dining service.
                </p>
              </div>
            </div>

            <div className="text-xs font-bold text-amber-900">
              Estimated Total Reorder Cost: ₹
              {(
                [...lowStockItems, ...outOfStockItems].reduce(
                  (sum, i) => sum + (i.minimumReserve * 2 * i.costPerUnitPaise) / 100,
                  0
                )
              ).toLocaleString('en-IN')}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[...outOfStockItems, ...lowStockItems].length === 0 ? (
              <div className="col-span-full bg-white rounded-2xl p-8 border border-slate-200/80 text-center space-y-2">
                <span className="material-symbols-outlined text-4xl text-emerald-600 block">check_circle</span>
                <h4 className="text-base font-bold text-slate-900">All Kitchen Stock Levels are Healthy</h4>
                <p className="text-xs text-slate-500 max-w-md mx-auto">
                  No raw materials or grocery items are currently below minimum par buffer reserves. Kitchen inventory is fully stocked and ready for dining service.
                </p>
              </div>
            ) : (
              [...outOfStockItems, ...lowStockItems].map((item) => {
              const recommendedOrder = item.minimumReserve * 2;
              const estCost = Math.round((recommendedOrder * item.costPerUnitPaise) / 100);
              const isOut = item.currentStock === 0;

              return (
                <div
                  key={item.id}
                  className={`bg-white rounded-2xl p-5 border shadow-xs flex flex-col justify-between ${
                    isOut ? 'border-rose-300 ring-1 ring-rose-200' : 'border-amber-200 ring-1 ring-amber-100'
                  }`}
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs text-slate-400 font-semibold">{item.itemCode}</span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${
                          isOut ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {isOut ? 'Out of Stock' : 'Low Buffer'}
                      </span>
                    </div>

                    <div>
                      <h4 className="text-base font-bold text-slate-900">{item.name}</h4>
                      <p className="text-xs text-slate-500">{item.category} • Preferred: {item.supplierName}</p>
                    </div>

                    <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 space-y-1.5 text-xs">
                      <div className="flex justify-between">
                        <span className="text-slate-500">Current Stock:</span>
                        <span className={`font-mono font-bold ${isOut ? 'text-rose-600' : 'text-amber-600'}`}>
                          {item.currentStock} {item.unit}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Minimum Par Buffer:</span>
                        <span className="font-mono font-bold text-slate-800">{item.minimumReserve} {item.unit}</span>
                      </div>
                      <div className="flex justify-between pt-1 border-t border-slate-200/60 font-semibold">
                        <span className="text-slate-700">Recommended PO Order:</span>
                        <span className="font-mono text-emerald-700">{recommendedOrder} {item.unit} (₹{estCost})</span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                    <button
                      onClick={() => handleOpenStockIn(item)}
                      className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold transition-all"
                    >
                      + Received Bill
                    </button>
                    <button
                      onClick={() => handleTriggerReorder(item)}
                      className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-xs transition-all flex items-center gap-1"
                    >
                      <span className="material-symbols-outlined text-sm">shopping_cart</span>
                      <span>1-Click PO Order</span>
                    </button>
                  </div>
                </div>
              );
            }))}
          </div>
        </div>
      )}

      {/* 7. TAB 3: MOVEMENTS & AUDIT LEDGER */}
      {activeTab === 'movements' && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200/80 overflow-hidden">
          <div className="p-4 border-b border-slate-200/80 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Stock Movements &amp; Deductions Audit Trail
              </h3>
              <p className="text-xs text-slate-500">
                Chronological real-time ledger of supplier receipts (+), culinary kitchen cooking issues (-), wastage (-), and audit counts
              </p>
            </div>
            <span className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 text-xs font-bold">
              {db.stockMovements.length} Total Logs
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 border-b border-slate-200/80 text-slate-500 font-bold uppercase tracking-wider text-[11px]">
                <tr>
                  <th className="py-3 px-4">Date</th>
                  <th className="py-3 px-4">Item Name</th>
                  <th className="py-3 px-4">Movement Type</th>
                  <th className="py-3 px-4">Quantity</th>
                  <th className="py-3 px-4">Cost Value</th>
                  <th className="py-3 px-4">Recorded By</th>
                  <th className="py-3 px-4">Invoice / Audit Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {db.stockMovements.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-slate-400">
                      <span className="material-symbols-outlined text-4xl mb-1 text-slate-300 block">inventory_2</span>
                      <p className="font-bold text-slate-700 text-sm">No Stock Movements Logged Today</p>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Use "+ Stock In" to record a supplier delivery or "- Stock Out" to issue ingredients for kitchen cooking.
                      </p>
                    </td>
                  </tr>
                ) : (
                  db.stockMovements.map((sm) => (
                  <tr key={sm.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-3 px-4 font-mono text-slate-500">{sm.date}</td>
                    <td className="py-3 px-4 font-bold text-slate-900">{sm.itemName}</td>
                    <td className="py-3 px-4">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                          sm.type === 'in_purchase'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : sm.type === 'out_kitchen_usage'
                            ? 'bg-blue-50 text-blue-700 border border-blue-200'
                            : 'bg-rose-50 text-rose-700 border border-rose-200'
                        }`}
                      >
                        {sm.type === 'in_purchase' ? '+ Stock In (Purchase)' : sm.type === 'out_kitchen_usage' ? '- Kitchen Usage' : '- Wastage'}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-mono font-bold text-slate-800">
                      {sm.type === 'in_purchase' ? '+' : '-'}{sm.quantity} {sm.unit}
                    </td>
                    <td className="py-3 px-4 font-bold text-slate-900 font-mono">
                      ₹{(sm.totalCostPaise / 100).toLocaleString('en-IN')}
                    </td>
                    <td className="py-3 px-4 text-slate-600 font-medium">{sm.recordedBy}</td>
                    <td className="py-3 px-4 text-slate-500 font-mono text-[11px]">
                      {sm.invoiceNumber ? `Inv: ${sm.invoiceNumber} ` : ''}
                      {sm.notes ? `(${sm.notes})` : '—'}
                    </td>
                  </tr>
                )))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 8. TAB 4: SUPPLIERS DIRECTORY */}
      {activeTab === 'suppliers' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h3 className="text-base font-bold text-slate-900">Approved Food &amp; Provision Suppliers</h3>
              <p className="text-xs text-slate-500">Registered vendors with contracts, GSTIN details, and contact points.</p>
            </div>
            <button
              onClick={() => setShowSupplierModal(true)}
              className="px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-black text-white text-xs font-bold shadow-xs transition-all flex items-center gap-1.5"
            >
              <span className="material-symbols-outlined text-base">person_add</span>
              <span>+ Add New Supplier</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {db.suppliers.map((sup) => (
              <div
                key={sup.id}
                className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200/80 flex flex-col justify-between hover:shadow-md transition-shadow"
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] bg-slate-100 text-slate-700 font-bold border border-slate-200">
                      {sup.category}
                    </span>
                    <span className="text-[10px] font-mono font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100">
                      Verified Vendor
                    </span>
                  </div>
                  <div>
                    <h4 className="text-base font-bold text-slate-900">{sup.name}</h4>
                    <p className="text-xs text-slate-500 font-medium mt-0.5">Contact: {sup.contactPerson || 'Office'}</p>
                  </div>
                  <div className="space-y-1 text-xs text-slate-600 bg-slate-50 p-3 rounded-xl border border-slate-100 font-medium">
                    <div className="flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-sm text-slate-400">call</span>
                      <a href={`tel:${sup.phone}`} className="text-emerald-700 hover:underline font-mono font-bold">
                        {sup.phone}
                      </a>
                    </div>
                    {sup.email && (
                      <div className="flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-sm text-slate-400">mail</span>
                        <span>{sup.email}</span>
                      </div>
                    )}
                    {sup.gstin && (
                      <div className="flex items-center gap-1.5 pt-1 border-t border-slate-200/60 font-mono text-[10px] text-slate-500">
                        <span>GSTIN:</span>
                        <span className="font-bold text-slate-700">{sup.gstin}</span>
                      </div>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-500 line-clamp-2">{sup.address || 'Local wholesale market'}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 1: STOCK IN (PURCHASE ENTRY) */}
      {/* ========================================================================= */}
      {showStockInModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white max-w-lg w-full rounded-2xl shadow-2xl border border-slate-200 p-6 space-y-4 animate-in fade-in zoom-in duration-150">
            <div>
              <div className="flex items-center gap-2 text-emerald-600 mb-1">
                <span className="material-symbols-outlined text-2xl">add_shopping_cart</span>
                <h3 className="text-base font-bold text-slate-900">
                  Record Stock In (Delivery Arrival)
                </h3>
              </div>
              <p className="text-xs text-slate-500">
                Increases stock count and <strong>automatically registers a Procurement Expense</strong> in the Finance ledger.
              </p>
            </div>

            <form onSubmit={handleExecuteStockIn} className="space-y-3.5 text-xs">
              <div className="space-y-1">
                <label className="font-bold text-slate-700">Select Raw Material / Item *</label>
                <select
                  value={stockInItemId}
                  onChange={(e) => {
                    const newId = e.target.value;
                    setStockInItemId(newId);
                    const selected = db.inventory.find((i) => i.id === newId);
                    if (selected) {
                      setStockInUnitCost(Math.round(selected.costPerUnitPaise / 100));
                      if (selected.supplierId) setStockInSupplierId(selected.supplierId);
                    }
                  }}
                  className="w-full h-10 px-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 font-medium"
                >
                  {db.inventory.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name} (Current: {i.currentStock} {i.unit}) - {i.supplierName}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-700">Supplying Vendor *</label>
                <select
                  value={stockInSupplierId}
                  onChange={(e) => setStockInSupplierId(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 font-medium"
                >
                  {db.suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.category})
                    </option>
                  ))}
                </select>
              </div>

              {selectedStockInItem && (
                <div className="p-2.5 bg-slate-50 border border-slate-200/80 rounded-xl text-[11px] flex items-center justify-between">
                  <span className="text-slate-500">Current Shelf Stock: <strong>{selectedStockInItem.currentStock} {selectedStockInItem.unit}</strong></span>
                  <span className="text-emerald-700 font-bold">
                    After Inflow: {selectedStockInItem.currentStock + Number(stockInQty || 0)} {selectedStockInItem.unit}
                  </span>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Quantity Received *</label>
                  <input
                    type="number"
                    required
                    min={1}
                    value={stockInQty}
                    onChange={(e) => setStockInQty(Number(e.target.value))}
                    className="w-full h-10 px-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 font-mono font-bold"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Cost per Unit (₹) *</label>
                  <input
                    type="number"
                    required
                    value={stockInUnitCost}
                    onChange={(e) => setStockInUnitCost(Number(e.target.value))}
                    className="w-full h-10 px-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 font-mono font-bold"
                  />
                </div>
              </div>

              {/* Total Calculation & Finance Notice */}
              <div className="p-3 bg-emerald-50 border border-emerald-200/80 rounded-xl space-y-1 text-emerald-950">
                <div className="flex justify-between items-center font-bold">
                  <span className="text-xs">Total Purchase Expense:</span>
                  <span className="text-sm font-mono font-black text-emerald-800">
                    ₹{(Number(stockInQty || 0) * Number(stockInUnitCost || 0)).toLocaleString('en-IN')}
                  </span>
                </div>
                <p className="text-[10px] text-emerald-700">
                  💳 Auto-posted as an outflow under Procurement Expenses in the Finance module.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Vendor Bill / Invoice #</label>
                  <input
                    type="text"
                    value={stockInInvoice}
                    onChange={(e) => setStockInInvoice(e.target.value)}
                    className="w-full h-10 px-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 font-mono font-semibold"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Batch / Notes</label>
                  <input
                    type="text"
                    placeholder="Fresh morning delivery"
                    value={stockInNotes}
                    onChange={(e) => setStockInNotes(e.target.value)}
                    className="w-full h-10 px-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2.5 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowStockInModal(false)}
                  className="px-4 py-2 rounded-xl text-slate-600 hover:bg-slate-100 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold shadow-sm transition-all"
                >
                  Confirm Stock In &amp; Post Expense
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 2: STOCK OUT (KITCHEN USAGE / WASTAGE) */}
      {/* ========================================================================= */}
      {showStockOutModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white max-w-lg w-full rounded-2xl shadow-2xl border border-slate-200 p-6 space-y-4 animate-in fade-in zoom-in duration-150">
            <div>
              <div className="flex items-center gap-2 text-slate-800 mb-1">
                <span className="material-symbols-outlined text-2xl text-amber-600">soup_kitchen</span>
                <h3 className="text-base font-bold text-slate-900">
                  Record Stock Out (Usage or Wastage)
                </h3>
              </div>
              <p className="text-xs text-slate-500">
                Deducts ingredient quantity from stock reserves and logs reason in the kitchen audit ledger.
              </p>
            </div>

            <form onSubmit={handleExecuteStockOut} className="space-y-3.5 text-xs">
              <div className="space-y-1">
                <label className="font-bold text-slate-700">Select Item *</label>
                <select
                  value={stockOutItemId}
                  onChange={(e) => setStockOutItemId(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 font-medium"
                >
                  {db.inventory.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name} (Current: {i.currentStock} {i.unit})
                    </option>
                  ))}
                </select>
              </div>

              {selectedStockOutItem && (
                <div className="p-2.5 bg-slate-50 border border-slate-200/80 rounded-xl text-[11px] flex items-center justify-between">
                  <span className="text-slate-500">Current Stock: <strong>{selectedStockOutItem.currentStock} {selectedStockOutItem.unit}</strong></span>
                  <span className={`font-bold ${
                    selectedStockOutItem.currentStock - Number(stockOutQty || 0) <= selectedStockOutItem.minimumReserve
                      ? 'text-amber-600'
                      : 'text-slate-700'
                  }`}>
                    Remaining: {Math.max(0, selectedStockOutItem.currentStock - Number(stockOutQty || 0))} {selectedStockOutItem.unit}
                  </span>
                </div>
              )}

              {/* Deduction Type Selector */}
              <div className="space-y-1.5">
                <label className="font-bold text-slate-700">Deduction Reason Type *</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setStockOutType('out_kitchen_usage')}
                    className={`p-2.5 rounded-xl border text-left flex items-center gap-2 transition-all ${
                      stockOutType === 'out_kitchen_usage'
                        ? 'border-blue-500 bg-blue-50 text-blue-900 font-bold'
                        : 'border-slate-200 bg-slate-50 text-slate-600'
                    }`}
                  >
                    <span className="material-symbols-outlined text-base">restaurant</span>
                    <div>
                      <div className="text-xs">Kitchen Cooking</div>
                      <div className="text-[10px] text-slate-400">Regular meal preparation</div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setStockOutType('out_wastage_spoilage')}
                    className={`p-2.5 rounded-xl border text-left flex items-center gap-2 transition-all ${
                      stockOutType === 'out_wastage_spoilage'
                        ? 'border-rose-500 bg-rose-50 text-rose-900 font-bold'
                        : 'border-slate-200 bg-slate-50 text-slate-600'
                    }`}
                  >
                    <span className="material-symbols-outlined text-base">delete_forever</span>
                    <div>
                      <div className="text-xs">Wastage / Spoilage</div>
                      <div className="text-[10px] text-slate-400">Spoiled, burnt, or expired</div>
                    </div>
                  </button>
                </div>
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-700">Quantity to Deduct *</label>
                <input
                  type="number"
                  required
                  min={1}
                  max={selectedStockOutItem ? selectedStockOutItem.currentStock : 9999}
                  value={stockOutQty}
                  onChange={(e) => setStockOutQty(Number(e.target.value))}
                  className="w-full h-10 px-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 font-mono font-bold"
                />
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-700">Shift / Notes</label>
                <input
                  type="text"
                  placeholder="e.g. Biryani evening batch prep or milk curdled"
                  value={stockOutNotes}
                  onChange={(e) => setStockOutNotes(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                />
              </div>

              <div className="flex justify-end gap-2.5 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowStockOutModal(false)}
                  className="px-4 py-2 rounded-xl text-slate-600 hover:bg-slate-100 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-black text-white font-bold shadow-sm transition-all"
                >
                  Confirm Stock Deduction
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 3: ADD NEW RAW MATERIAL ITEM */}
      {/* ========================================================================= */}
      {showAddItemModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white max-w-lg w-full rounded-2xl shadow-2xl border border-slate-200 p-6 space-y-4 animate-in fade-in zoom-in duration-150">
            <div>
              <div className="flex items-center gap-2 text-indigo-600 mb-1">
                <span className="material-symbols-outlined text-2xl">add_box</span>
                <h3 className="text-base font-bold text-slate-900">
                  Register New Raw Material / Item
                </h3>
              </div>
              <p className="text-xs text-slate-500">
                Add a new ingredient or supply to the restaurant's central inventory directory.
              </p>
            </div>

            <form onSubmit={handleExecuteAddItem} className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Item Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Paneer (Fresh Dairy)"
                    value={newItemName}
                    onChange={(e) => setNewItemName(e.target.value)}
                    className="w-full h-10 px-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 font-medium"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Item Code (SKU)</label>
                  <input
                    type="text"
                    placeholder={`UFP-INV-${String(db.inventory.length + 1).padStart(3, '0')}`}
                    value={newItemCode}
                    onChange={(e) => setNewItemCode(e.target.value)}
                    className="w-full h-10 px-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Category *</label>
                  <select
                    value={newItemCategory}
                    onChange={(e) => setNewItemCategory(e.target.value)}
                    className="w-full h-10 px-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 font-medium"
                  >
                    {categories.filter((c) => c !== 'All').map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Unit of Measurement *</label>
                  <select
                    value={newItemUnit}
                    onChange={(e) => setNewItemUnit(e.target.value as any)}
                    className="w-full h-10 px-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 font-medium"
                  >
                    <option value="kg">kg (Kilograms)</option>
                    <option value="liters">liters (Liters)</option>
                    <option value="packets">packets</option>
                    <option value="cylinders">cylinders (Gas)</option>
                    <option value="boxes">boxes</option>
                    <option value="tins">tins</option>
                    <option value="pieces">pieces</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Opening Stock</label>
                  <input
                    type="number"
                    min={0}
                    value={newItemStock}
                    onChange={(e) => setNewItemStock(Number(e.target.value))}
                    className="w-full h-10 px-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 font-mono font-bold"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-bold text-slate-700" title="Low stock alert trigger">
                    Min Reserve (Par) *
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={newItemMinReserve}
                    onChange={(e) => setNewItemMinReserve(Number(e.target.value))}
                    className="w-full h-10 px-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 font-mono font-bold"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Cost/Unit (₹) *</label>
                  <input
                    type="number"
                    min={0}
                    value={newItemCost}
                    onChange={(e) => setNewItemCost(Number(e.target.value))}
                    className="w-full h-10 px-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 font-mono font-bold"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-700">Preferred Supplier</label>
                <select
                  value={newItemSupplierId}
                  onChange={(e) => setNewItemSupplierId(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 font-medium"
                >
                  {db.suppliers.map((s) => (
                    <option key={s.id} value={s.id}>{s.name} ({s.category})</option>
                  ))}
                </select>
              </div>

              <div className="flex justify-end gap-2.5 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowAddItemModal(false)}
                  className="px-4 py-2 rounded-xl text-slate-600 hover:bg-slate-100 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold shadow-sm transition-all"
                >
                  Save &amp; Add Item
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 4: EDIT ITEM (PAR LEVEL & PRICING) */}
      {/* ========================================================================= */}
      {showEditModal && editingItem && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white max-w-md w-full rounded-2xl shadow-2xl border border-slate-200 p-6 space-y-4 animate-in fade-in zoom-in duration-150">
            <div>
              <div className="flex items-center gap-2 text-slate-800 mb-1">
                <span className="material-symbols-outlined text-2xl text-slate-600">edit</span>
                <h3 className="text-base font-bold text-slate-900">
                  Edit Item: {editingItem.name}
                </h3>
              </div>
              <p className="text-xs text-slate-500">
                Adjust par level minimum buffer, category, or purchase unit cost.
              </p>
            </div>

            <form onSubmit={handleExecuteUpdateItem} className="space-y-3.5 text-xs">
              <div className="space-y-1">
                <label className="font-bold text-slate-700">Item Name</label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-slate-500/20 font-medium"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Category</label>
                  <select
                    value={editCategory}
                    onChange={(e) => setEditCategory(e.target.value)}
                    className="w-full h-10 px-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 font-medium"
                  >
                    {categories.filter((c) => c !== 'All').map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Unit</label>
                  <select
                    value={editUnit}
                    onChange={(e) => setEditUnit(e.target.value)}
                    className="w-full h-10 px-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 font-medium"
                  >
                    <option value="kg">kg</option>
                    <option value="liters">liters</option>
                    <option value="packets">packets</option>
                    <option value="cylinders">cylinders</option>
                    <option value="boxes">boxes</option>
                    <option value="tins">tins</option>
                    <option value="pieces">pieces</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Min Reserve Buffer ({editUnit})</label>
                  <input
                    type="number"
                    min={1}
                    value={editMinReserve}
                    onChange={(e) => setEditMinReserve(Number(e.target.value))}
                    className="w-full h-10 px-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 font-mono font-bold"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Cost/Unit (₹)</label>
                  <input
                    type="number"
                    min={0}
                    value={editCost}
                    onChange={(e) => setEditCost(Number(e.target.value))}
                    className="w-full h-10 px-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 font-mono font-bold"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-700">Preferred Supplier</label>
                <select
                  value={editSupplierId}
                  onChange={(e) => setEditSupplierId(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 font-medium"
                >
                  {db.suppliers.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>

              <div className="flex justify-end gap-2.5 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  className="px-4 py-2 rounded-xl text-slate-600 hover:bg-slate-100 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-black text-white font-bold shadow-sm transition-all"
                >
                  Update Item
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 5: PHYSICAL STOCK AUDIT RECONCILIATION */}
      {/* ========================================================================= */}
      {showAuditModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white max-w-md w-full rounded-2xl shadow-2xl border border-slate-200 p-6 space-y-4 animate-in fade-in zoom-in duration-150">
            <div>
              <div className="flex items-center gap-2 text-indigo-600 mb-1">
                <span className="material-symbols-outlined text-2xl">balance</span>
                <h3 className="text-base font-bold text-slate-900">
                  Physical Stock Audit Reconciliation
                </h3>
              </div>
              <p className="text-xs text-slate-500">
                Match actual physical count on kitchen/store shelves with system count. Any variance is recorded into the audit trail.
              </p>
            </div>

            <form onSubmit={handleExecuteAuditCount} className="space-y-3.5 text-xs">
              <div className="space-y-1">
                <label className="font-bold text-slate-700">Select Item to Reconcile *</label>
                <select
                  value={auditItemId}
                  onChange={(e) => {
                    setAuditItemId(e.target.value);
                    const selected = db.inventory.find((i) => i.id === e.target.value);
                    if (selected) setAuditActualCount(selected.currentStock);
                  }}
                  className="w-full h-10 px-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 font-medium"
                >
                  {db.inventory.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name} (System: {i.currentStock} {i.unit})
                    </option>
                  ))}
                </select>
              </div>

              {selectedAuditItem && (
                <div className="p-3 bg-slate-50 border border-slate-200/80 rounded-xl space-y-2">
                  <div className="flex justify-between items-center text-slate-600">
                    <span>System Book Balance:</span>
                    <span className="font-mono font-bold text-slate-900">{selectedAuditItem.currentStock} {selectedAuditItem.unit}</span>
                  </div>
                  <div className="flex justify-between items-center text-slate-600">
                    <span>Physical Shelf Count:</span>
                    <span className="font-mono font-bold text-indigo-700">{auditActualCount} {selectedAuditItem.unit}</span>
                  </div>
                  <div className="flex justify-between items-center pt-1 border-t border-slate-200 text-xs font-bold">
                    <span>Variance Discrepancy:</span>
                    <span className={`font-mono ${
                      auditActualCount - selectedAuditItem.currentStock < 0
                        ? 'text-rose-600'
                        : auditActualCount - selectedAuditItem.currentStock > 0
                        ? 'text-emerald-600'
                        : 'text-slate-500'
                    }`}>
                      {auditActualCount - selectedAuditItem.currentStock > 0 ? '+' : ''}
                      {auditActualCount - selectedAuditItem.currentStock} {selectedAuditItem.unit}
                    </span>
                  </div>
                </div>
              )}

              <div className="space-y-1">
                <label className="font-bold text-slate-700">Actual Count on Shelf *</label>
                <input
                  type="number"
                  min={0}
                  required
                  value={auditActualCount}
                  onChange={(e) => setAuditActualCount(Number(e.target.value))}
                  className="w-full h-10 px-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 font-mono font-bold text-sm"
                />
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-700">Audit Reason / Shift</label>
                <input
                  type="text"
                  value={auditReason}
                  onChange={(e) => setAuditReason(e.target.value)}
                  placeholder="e.g. Weekly physical verification or stock leakage check"
                  className="w-full h-10 px-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-900"
                />
              </div>

              <div className="flex justify-end gap-2.5 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowAuditModal(false)}
                  className="px-4 py-2 rounded-xl text-slate-600 hover:bg-slate-100 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold shadow-sm transition-all"
                >
                  Reconcile &amp; Save Discrepancy
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 6: ADD NEW SUPPLIER */}
      {/* ========================================================================= */}
      {showSupplierModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white max-w-md w-full rounded-2xl shadow-2xl border border-slate-200 p-6 space-y-4 animate-in fade-in zoom-in duration-150">
            <div>
              <div className="flex items-center gap-2 text-slate-800 mb-1">
                <span className="material-symbols-outlined text-2xl text-slate-700">person_add</span>
                <h3 className="text-base font-bold text-slate-900">
                  Register New Supplier / Vendor
                </h3>
              </div>
              <p className="text-xs text-slate-500">
                Add vendor details to streamline purchase orders and direct invoicing.
              </p>
            </div>

            <form onSubmit={handleExecuteAddSupplier} className="space-y-3 text-xs">
              <div className="space-y-1">
                <label className="font-bold text-slate-700">Supplier / Business Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Sri Krishna Spices & Provisions"
                  value={supName}
                  onChange={(e) => setSupName(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 font-medium"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Category</label>
                  <input
                    type="text"
                    placeholder="e.g. Dairy / Meat / Spices"
                    value={supCategory}
                    onChange={(e) => setSupCategory(e.target.value)}
                    className="w-full h-10 px-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-900"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Contact Person</label>
                  <input
                    type="text"
                    placeholder="Mr. Suresh"
                    value={supContact}
                    onChange={(e) => setSupContact(e.target.value)}
                    className="w-full h-10 px-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-900"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Phone Number *</label>
                  <input
                    type="tel"
                    required
                    placeholder="+91 98765 43210"
                    value={supPhone}
                    onChange={(e) => setSupPhone(e.target.value)}
                    className="w-full h-10 px-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 font-mono font-semibold"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">GSTIN Number</label>
                  <input
                    type="text"
                    placeholder="36AAAAA0000A1Z5"
                    value={supGstin}
                    onChange={(e) => setSupGstin(e.target.value)}
                    className="w-full h-10 px-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 font-mono"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-700">Email Address</label>
                <input
                  type="email"
                  placeholder="orders@vendor.com"
                  value={supEmail}
                  onChange={(e) => setSupEmail(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-900"
                />
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-700">Market / Warehouse Address</label>
                <input
                  type="text"
                  placeholder="Shop #12, Wholesale Market, Hyderabad"
                  value={supAddress}
                  onChange={(e) => setSupAddress(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-900"
                />
              </div>

              <div className="flex justify-end gap-2.5 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowSupplierModal(false)}
                  className="px-4 py-2 rounded-xl text-slate-600 hover:bg-slate-100 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-black text-white font-bold shadow-sm transition-all"
                >
                  Register Supplier
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
