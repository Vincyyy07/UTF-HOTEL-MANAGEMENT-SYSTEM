'use client';

import React from 'react';
import { DatabaseSchema, RestaurantTable, MenuItem, User } from '../lib/types';
import { getLocalDateStr } from '../lib/dateUtils';

interface DashboardModuleProps {
  db: DatabaseSchema;
  currentUser?: User;
  onNavigateTab: (tab: string) => void;
  onSelectTableForOrder: (table: RestaurantTable) => void;
  onQuickReorder: (itemId: string) => void;
}

export const DashboardModule: React.FC<DashboardModuleProps> = ({
  db,
  currentUser,
  onNavigateTab,
  onSelectTableForOrder,
  onQuickReorder,
}) => {
  const [statusFilter, setStatusFilter] = React.useState<'all' | 'occupied' | 'vacant' | 'bill_printed'>('all');
  const todayStr = getLocalDateStr();
  const todaysBills = db.bills.filter((b) => getLocalDateStr(b.createdAt) === todayStr);
  const todaysPaidBills = todaysBills.filter((b) => b.paymentStatus === 'paid');
  
  // Total Gross Sales Today
  const totalSalesPaise = todaysPaidBills.reduce(
    (acc, b) => acc + (b.totalPaise || 0),
    0
  );
  const billCount = todaysPaidBills.length;
  const avgTicketPaise = billCount > 0 ? Math.round(totalSalesPaise / billCount) : 0;

  // Dine-in vs Takeaway split
  const dineInPaise = todaysBills
    .filter((b) => b.tableNumber !== 'Takeaway' && (b as any).orderType !== 'takeaway' && b.paymentStatus === 'paid')
    .reduce((acc, b) => acc + b.totalPaise, 0);
  const takeawayPaise = todaysBills
    .filter((b) => (b.tableNumber === 'Takeaway' || (b as any).orderType === 'takeaway') && b.paymentStatus === 'paid')
    .reduce((acc, b) => acc + b.totalPaise, 0);

  // Today's Expenses
  const todayExpenses = db.expenses.filter((e) => e.date === todayStr);
  const totalExpensesPaise = todayExpenses.reduce((acc, e) => acc + e.amountPaise, 0);
  const procurementExpensePaise = todayExpenses
    .filter((e) => e.category === 'Procurement')
    .reduce((acc, e) => acc + e.amountPaise, 0);
  const wageAndFuelPaise = totalExpensesPaise - procurementExpensePaise;

  // Realized Net Profit
  const netProfitPaise = totalSalesPaise - totalExpensesPaise;
  const operatingMarginPercent =
    totalSalesPaise > 0
      ? ((netProfitPaise / totalSalesPaise) * 100).toFixed(1)
      : '0.0';

  // Tables breakdown
  const totalTablesCount = db.tables.length;
  const occupiedTables = db.tables.filter((t) => t.status === 'occupied').length;
  const vacantTables = db.tables.filter((t) => t.status === 'vacant').length;
  const billPrintedTables = db.tables.filter((t) => t.status === 'bill_printed').length;
  const occupancyPercent =
    totalTablesCount > 0
      ? (((occupiedTables + billPrintedTables) / totalTablesCount) * 100).toFixed(0)
      : '0';

  const displayedTables = statusFilter === 'all'
    ? db.tables
    : db.tables.filter((t) => t.status === statusFilter);

  // Low stock items
  const lowStockItems = db.inventory.filter((i) => i.currentStock <= i.minimumReserve);

  // Staff Attendance stats
  const todayAttendance = db.attendance.filter((a) => a.date === todayStr);
  const presentCount = todayAttendance.filter((a) => a.status === 'present').length;
  const lateCount = todayAttendance.filter((a) => a.status === 'late').length;
  const checkedInCount = presentCount + lateCount;
  const totalStaffCount = db.staff.length;
  const awaitingPunchCount = Math.max(0, totalStaffCount - checkedInCount);
  const onDutyPercent =
    totalStaffCount > 0 ? Math.round((checkedInCount / totalStaffCount) * 100) : 0;
  const latestCheckIn = todayAttendance.length > 0 ? todayAttendance[todayAttendance.length - 1] : null;
  const latestStaffMember = latestCheckIn
    ? db.staff.find((s) => s.id === latestCheckIn.staffId)
    : null;

  // Top Dishes calculation from actual bills, or showcase bestselling menu items
  const dishSalesMap: Record<string, { portions: number; revenuePaise: number; name: string; veg: boolean; category: string }> = {};
  todaysBills.forEach((bill) => {
    bill.items?.forEach((item) => {
      if (!dishSalesMap[item.menuItemId]) {
        const menuItem = db.menuItems.find((m) => m.id === item.menuItemId);
        const cat = menuItem ? db.categories.find((c) => c.id === menuItem.categoryId)?.name : 'Main Course';
        dishSalesMap[item.menuItemId] = {
          portions: 0,
          revenuePaise: 0,
          name: item.name || menuItem?.name || 'Dish',
          veg: menuItem?.vegType === 'veg',
          category: cat || 'Main Course',
        };
      }
      dishSalesMap[item.menuItemId].portions += item.quantity;
      dishSalesMap[item.menuItemId].revenuePaise += item.pricePaise * item.quantity;
    });
  });

  const soldDishes = Object.values(dishSalesMap).sort((a, b) => b.portions - a.portions);

  const displayBestsellers =
    soldDishes.length > 0
      ? soldDishes.slice(0, 5).map((d, idx) => ({
          rank: idx + 1,
          name: d.name,
          portions: `${d.portions} portions ordered`,
          revenue: `₹${(d.revenuePaise / 100).toLocaleString('en-IN')}`,
          pct: totalSalesPaise > 0 ? `${((d.revenuePaise / totalSalesPaise) * 100).toFixed(1)}% of Sales` : 'Active Item',
          veg: d.veg,
          note: d.category,
        }))
      : (db.menuItems.filter((m) => m.isBestseller).length > 0
          ? db.menuItems.filter((m) => m.isBestseller)
          : db.menuItems.slice(0, 5)
        ).map((m, idx) => {
          const cat = db.categories.find((c) => c.id === m.categoryId)?.name || 'Signature';
          return {
            rank: idx + 1,
            name: m.name,
            portions: 'Signature Special',
            revenue: `₹${(m.pricePaise / 100).toLocaleString('en-IN')}`,
            pct: 'Featured Dish',
            veg: m.vegType === 'veg',
            note: cat,
          };
        });

  // Payment Breakdown (calculated from todays paid bills, or fallback to all paid bills if day just started)
  const paidBillsToday = todaysBills.filter((b) => b.paymentStatus === 'paid');
  const targetBills = paidBillsToday.length > 0 ? paidBillsToday : db.bills.filter((b) => b.paymentStatus === 'paid');
  const targetSalesPaise = targetBills.reduce((sum, b) => sum + (b.totalPaise || 0), 0);

  const upiSalesPaise = targetBills
    .filter((b) => (b.paymentMode || (b as any).paymentMethod || '').toLowerCase() === 'upi')
    .reduce((sum, b) => sum + (b.totalPaise || 0), 0);

  const cardSalesPaise = targetBills
    .filter((b) => (b.paymentMode || (b as any).paymentMethod || '').toLowerCase() === 'card')
    .reduce((sum, b) => sum + (b.totalPaise || 0), 0);

  const cashSalesPaise = targetBills
    .filter((b) => (b.paymentMode || (b as any).paymentMethod || '').toLowerCase() === 'cash')
    .reduce((sum, b) => sum + (b.totalPaise || 0), 0);

  const upiPct = targetSalesPaise > 0 ? Math.round((upiSalesPaise / targetSalesPaise) * 100) : 0;
  const cardPct = targetSalesPaise > 0 ? Math.round((cardSalesPaise / targetSalesPaise) * 100) : 0;
  const cashPct = targetSalesPaise > 0 ? Math.max(0, 100 - upiPct - cardPct) : 0;

  return (
    <div className="p-3.5 sm:p-6 lg:p-8 flex flex-col gap-5 sm:gap-6 max-w-7xl mx-auto">
      {/* 1. Header & Quick Actions */}
      <div className="ios27-glass-card p-6 rounded-[24px] border border-white/80 shadow-[0_8px_32px_0_rgba(0,0,0,0.04),inset_0_1px_1.5px_0_rgba(255,255,255,0.95)] flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/[0.08] text-emerald-800 border border-emerald-500/20 text-xs font-semibold tracking-tight">
              <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
              Live Dining Operations • POS Online
            </span>
          </div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight mt-1">
            Welcome back, {currentUser?.name?.split(' ')[0] || 'Team'}
          </h1>
          <p className="text-xs text-slate-500 font-medium">
            Real-time Dining Operations &amp; POS Overview • Multicuisine Dining, Banquets &amp; Patio
          </p>
        </div>

        {/* Quick Action Buttons (Standardized Height, Padding & Alignment) */}
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={() => onNavigateTab('reports')}
            className="h-9 px-4 rounded-full btn-royal-secondary text-xs gap-2 shrink-0"
          >
            <span className="material-symbols-outlined text-[18px] text-slate-500 leading-none shrink-0">description</span>
            <span className="leading-none whitespace-nowrap">Day Report</span>
          </button>
          <button
            onClick={() => onNavigateTab('attendance')}
            className="h-9 px-4 rounded-full btn-royal-secondary text-xs gap-2 shrink-0"
          >
            <span className="material-symbols-outlined text-[18px] text-emerald-600 leading-none shrink-0">center_focus_strong</span>
            <span className="leading-none whitespace-nowrap">Face Scan Terminal</span>
          </button>
          <button
            onClick={() => onNavigateTab('billing')}
            className="h-9 px-4 rounded-full btn-royal-primary text-xs gap-2 shrink-0"
          >
            <span className="material-symbols-outlined text-[18px] leading-none shrink-0">point_of_sale</span>
            <span className="font-bold tracking-tight leading-none whitespace-nowrap">+ New Order / Table POS</span>
          </button>
        </div>
      </div>

      {/* 2. KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 sm:gap-5 items-stretch">
        {/* Card 1: Today's Gross Sales */}
        <div className="ios27-glass-card p-6 rounded-[24px] border border-white/80 shadow-[0_8px_32px_rgba(0,0,0,0.04),inset_0_1px_1.5px_rgba(255,255,255,0.95)] hover:shadow-[0_12px_36px_rgba(0,0,0,0.07)] flex flex-col justify-between transition-all duration-200 h-full">
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] uppercase tracking-wider font-semibold text-slate-500">Today's Gross Sales</span>
              <div className="w-9 h-9 rounded-full bg-emerald-500/[0.08] text-emerald-700 flex items-center justify-center border border-emerald-500/15 shadow-xs">
                <span className="material-symbols-outlined text-lg">currency_rupee</span>
              </div>
            </div>
            <div className="flex items-baseline justify-between gap-2 mt-2">
              <span className="text-3xl font-bold text-slate-900 tracking-tight tabular-nums">
                ₹{(totalSalesPaise / 100).toLocaleString('en-IN')}
              </span>
              <span className="text-xs font-semibold text-emerald-800 bg-emerald-500/[0.08] border border-emerald-500/20 px-2.5 py-0.5 rounded-full flex items-center gap-1">
                <span className="material-symbols-outlined text-xs">
                  {billCount > 0 ? 'trending_up' : 'storefront'}
                </span>
                {billCount > 0 ? `${billCount} Paid` : 'Ready'}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs text-slate-500 mt-3 pt-2.5 border-t border-slate-100/90">
              <span>Dine-in: <strong className="text-slate-800 tabular-nums font-semibold">₹{(dineInPaise / 100).toLocaleString('en-IN')}</strong></span>
              <span>Takeaway: <strong className="text-slate-800 tabular-nums font-semibold">₹{(takeawayPaise / 100).toLocaleString('en-IN')}</strong></span>
            </div>
          </div>
          <div className="pt-3 mt-3 flex items-center justify-between text-xs border-t border-slate-100/90 gap-2">
            <span className="text-slate-400 tabular-nums truncate">{billCount} bills closed today</span>
            <button
              onClick={() => onNavigateTab('billing')}
              className="text-forest-900 hover:text-forest-950 font-semibold flex items-center gap-1 active:scale-[0.98] transition-transform shrink-0 whitespace-nowrap"
            >
              View POS <span className="material-symbols-outlined text-xs">arrow_forward</span>
            </button>
          </div>
        </div>

        {/* Card 2: Orders & Avg Ticket */}
        <div className="ios27-glass-card p-6 rounded-[24px] border border-white/80 shadow-[0_8px_32px_rgba(0,0,0,0.04),inset_0_1px_1.5px_rgba(255,255,255,0.95)] hover:shadow-[0_12px_36px_rgba(0,0,0,0.07)] flex flex-col justify-between transition-all duration-200 h-full">
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] uppercase tracking-wider font-semibold text-slate-500">Orders &amp; Avg Ticket</span>
              <div className="w-9 h-9 rounded-full bg-blue-500/[0.08] text-blue-700 flex items-center justify-center border border-blue-500/15 shadow-xs">
                <span className="material-symbols-outlined text-lg">receipt_long</span>
              </div>
            </div>
            <div className="flex items-baseline justify-between gap-2 mt-2">
              <span className="text-3xl font-bold text-slate-900 tracking-tight tabular-nums">{billCount}</span>
              <span className="text-xs font-semibold text-blue-800 bg-blue-500/[0.08] border border-blue-500/20 px-2.5 py-0.5 rounded-full flex items-center gap-1">
                <span className="material-symbols-outlined text-xs">point_of_sale</span>
                {billCount > 0 ? `${billCount} Billed` : 'Active'}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs text-slate-500 mt-3 pt-2.5 border-t border-slate-100/90">
              <span>Avg Ticket: <strong className="text-slate-800 tabular-nums font-semibold">₹{Math.round(avgTicketPaise / 100)}</strong></span>
              <span>Floor: <strong className="text-slate-800 tabular-nums font-semibold">{occupiedTables} Active</strong></span>
            </div>
          </div>
          <div className="pt-3 mt-3 flex items-center justify-between text-xs border-t border-slate-100/90 gap-2">
            <span className="text-slate-400 tabular-nums truncate">{occupiedTables} live floor orders</span>
            <button
              onClick={() => onNavigateTab('orders')}
              className="text-forest-900 hover:text-forest-950 font-semibold flex items-center gap-1 active:scale-[0.98] transition-transform shrink-0 whitespace-nowrap"
            >
              KOT Ledger <span className="material-symbols-outlined text-xs">arrow_forward</span>
            </button>
          </div>
        </div>

        {/* Card 3: Today's Expenses */}
        <div className="ios27-glass-card p-6 rounded-[24px] border border-white/80 shadow-[0_8px_32px_rgba(0,0,0,0.04),inset_0_1px_1.5px_rgba(255,255,255,0.95)] hover:shadow-[0_12px_36px_rgba(0,0,0,0.07)] flex flex-col justify-between transition-all duration-200 h-full">
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] uppercase tracking-wider font-semibold text-slate-500">Today's Expenses</span>
              <div className="w-9 h-9 rounded-full bg-rose-500/[0.08] text-rose-700 flex items-center justify-center border border-rose-500/15 shadow-xs">
                <span className="material-symbols-outlined text-lg">account_balance_wallet</span>
              </div>
            </div>
            <div className="flex items-baseline justify-between gap-2 mt-2">
              <span className="text-3xl font-bold text-slate-900 tracking-tight tabular-nums">
                ₹{(totalExpensesPaise / 100).toLocaleString('en-IN')}
              </span>
              <span className="text-xs font-semibold text-rose-800 bg-rose-500/[0.08] border border-rose-500/20 px-2.5 py-0.5 rounded-full flex items-center gap-1">
                <span className="material-symbols-outlined text-xs">trending_down</span>
                Outflow
              </span>
            </div>
            <div className="flex items-center justify-between text-xs text-slate-500 mt-3 pt-2.5 border-t border-slate-100/90">
              <span>Procure: <strong className="text-slate-800 tabular-nums font-semibold">₹{(procurementExpensePaise / 100).toLocaleString('en-IN')}</strong></span>
              <span>Wages/Gas: <strong className="text-slate-800 tabular-nums font-semibold">₹{(wageAndFuelPaise / 100).toLocaleString('en-IN')}</strong></span>
            </div>
          </div>
          <div className="pt-3 mt-3 flex items-center justify-between text-xs border-t border-slate-100/90 gap-2">
            <span className="text-slate-400 tabular-nums truncate">{todayExpenses.length} entries recorded</span>
            <button
              onClick={() => onNavigateTab('finance')}
              className="text-forest-900 hover:text-forest-950 font-semibold flex items-center gap-1 active:scale-[0.98] transition-transform shrink-0 whitespace-nowrap"
            >
              View Finance <span className="material-symbols-outlined text-xs">arrow_forward</span>
            </button>
          </div>
        </div>

        {/* Card 4: Operating Net Margin */}
        <div className="ios27-glass-card p-6 rounded-[24px] border border-white/80 shadow-[0_8px_32px_rgba(0,0,0,0.04),inset_0_1px_1.5px_rgba(255,255,255,0.95)] hover:shadow-[0_12px_36px_rgba(0,0,0,0.07)] flex flex-col justify-between transition-all duration-200 h-full">
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] uppercase tracking-wider font-semibold text-slate-500">Operating Net Margin</span>
              <div className="w-9 h-9 rounded-full bg-gold-400/15 text-gold-600 flex items-center justify-center border border-gold-400/30 shadow-xs">
                <span className="material-symbols-outlined text-lg">monitoring</span>
              </div>
            </div>
            <div className="flex items-baseline justify-between gap-2 mt-2">
              <span className={`text-3xl font-bold tracking-tight tabular-nums ${netProfitPaise >= 0 ? 'text-slate-900' : 'text-rose-700'}`}>
                ₹{(netProfitPaise / 100).toLocaleString('en-IN')}
              </span>
              <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full flex items-center gap-1 border ${
                netProfitPaise >= 0
                  ? 'bg-gold-400/15 text-gold-900 border-gold-400/40 font-bold'
                  : 'bg-rose-500/[0.08] text-rose-800 border-rose-500/20'
              }`}>
                <span className="material-symbols-outlined text-xs">
                  {netProfitPaise >= 0 ? 'check_circle' : 'warning'}
                </span>
                {operatingMarginPercent}% Margin
              </span>
            </div>
            <div className="flex items-center justify-between text-xs text-slate-500 mt-3 pt-2.5 border-t border-slate-100/90">
              <span>Gross Margin: <strong className="text-gold-700 font-bold tabular-nums">{operatingMarginPercent}%</strong></span>
              <span>Status: <strong className={`font-semibold ${netProfitPaise >= 0 ? 'text-emerald-700' : 'text-rose-600'}`}>{netProfitPaise >= 0 ? 'Healthy' : 'Deficit'}</strong></span>
            </div>
          </div>
          <div className="pt-3 mt-3 flex items-center justify-between text-xs border-t border-slate-100/90 gap-2">
            <span className="text-slate-400 tabular-nums truncate">Automated Daily Tally</span>
            <button
              onClick={() => onNavigateTab('reports')}
              className="text-forest-900 hover:text-forest-950 font-semibold flex items-center gap-1 active:scale-[0.98] transition-transform shrink-0 whitespace-nowrap"
            >
              P&amp;L Report <span className="material-symbols-outlined text-xs">arrow_forward</span>
            </button>
          </div>
        </div>
      </div>

      {/* 3. Floor Status & Live Table Map */}
      <div className="ios27-glass-card p-6 rounded-[24px] border border-white/80 shadow-[0_8px_32px_rgba(0,0,0,0.04),inset_0_1px_1.5px_rgba(255,255,255,0.95)] flex flex-col gap-4">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 pb-2 border-b border-slate-100/80">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-forest-950/[0.05] flex items-center justify-center text-forest-950 border border-forest-950/[0.08] shadow-xs">
              <span className="material-symbols-outlined text-xl">table_restaurant</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-900 tracking-tight">Floor Status &amp; Real-time Table POS</h2>
                <span className="px-2.5 py-0.5 rounded-full text-xs bg-emerald-500/[0.08] text-emerald-800 border border-emerald-500/20 font-semibold tabular-nums">
                  Occupancy: {occupancyPercent}%
                </span>
              </div>
              <p className="text-xs text-slate-500 font-medium mt-0.5">
                {totalTablesCount} Total Dining Tables • AC Grand Hall (10) • Royal Family Suite (6) • Garden Patio (4)
              </p>
            </div>
          </div>

          {/* Floor Status Legend & Interactive POS CTA (Standardized iOS 27 Heights & Padding) */}
          <div className="flex items-center flex-wrap sm:flex-nowrap gap-2 text-xs font-semibold shrink-0">
            <button
              type="button"
              onClick={() => setStatusFilter((prev) => (prev === 'occupied' ? 'all' : 'occupied'))}
              className={`h-8 px-3.5 rounded-full inline-flex items-center justify-center gap-1.5 transition-all text-xs font-semibold whitespace-nowrap active:scale-[0.98] ${
                statusFilter === 'occupied'
                  ? 'bg-gold-500/25 text-gold-950 border border-gold-500/60 ring-2 ring-gold-400/40 shadow-xs'
                  : 'bg-gold-500/10 hover:bg-gold-500/18 text-gold-900 border border-gold-500/30'
              }`}
              title="Filter by Occupied tables"
            >
              <span className="w-2 h-2 rounded-full bg-gold-500 shadow-[0_0_8px_rgba(212,155,20,0.65)] shrink-0"></span>
              <span className="tabular-nums font-bold leading-none">{occupiedTables} Occupied</span>
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter((prev) => (prev === 'vacant' ? 'all' : 'vacant'))}
              className={`h-8 px-3.5 rounded-full inline-flex items-center justify-center gap-1.5 transition-all text-xs font-semibold whitespace-nowrap active:scale-[0.98] ${
                statusFilter === 'vacant'
                  ? 'bg-emerald-500/20 text-emerald-950 border border-emerald-500/50 ring-2 ring-emerald-500/30 shadow-xs'
                  : 'bg-emerald-500/10 hover:bg-emerald-500/18 text-emerald-900 border border-emerald-500/25'
              }`}
              title="Filter by Vacant tables"
            >
              <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0"></span>
              <span className="tabular-nums font-semibold leading-none">{vacantTables} Vacant</span>
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter((prev) => (prev === 'bill_printed' ? 'all' : 'bill_printed'))}
              className={`h-8 px-3.5 rounded-full inline-flex items-center justify-center gap-1.5 transition-all text-xs font-semibold whitespace-nowrap active:scale-[0.98] ${
                statusFilter === 'bill_printed'
                  ? 'bg-blue-500/20 text-blue-950 border border-blue-500/50 ring-2 ring-blue-500/30 shadow-xs'
                  : 'bg-blue-500/10 hover:bg-blue-500/18 text-blue-900 border border-blue-500/25'
              }`}
              title="Filter by Bill Printed tables"
            >
              <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0"></span>
              <span className="tabular-nums font-semibold leading-none">{billPrintedTables} Bill Printed</span>
            </button>
            <button
              type="button"
              onClick={() => {
                onNavigateTab('billing');
                window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
              }}
              className="h-8 px-3.5 rounded-full btn-royal-primary text-xs gap-1.5 shrink-0 whitespace-nowrap"
            >
              <span className="leading-none whitespace-nowrap font-bold">Open POS</span>
              <span className="material-symbols-outlined text-[15px] leading-none shrink-0">open_in_new</span>
            </button>
          </div>
        </div>

        {/* Tables Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-10 gap-3 pt-1">
          {displayedTables.map((table) => {
            const isOccupied = table.status === 'occupied';
            const isBillPrinted = table.status === 'bill_printed';

            return (
              <div
                key={table.id}
                onClick={() => {
                  onSelectTableForOrder(table);
                  onNavigateTab('billing');
                  window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
                }}
                className={`p-3.5 rounded-[18px] text-left cursor-pointer transition-all flex flex-col justify-between min-h-[114px] active:scale-[0.96] ${
                  isBillPrinted
                    ? 'bg-blue-50/90 border border-blue-300/80 hover:bg-blue-100/90 shadow-[0_2px_8px_rgba(59,130,246,0.1),inset_0_1px_1px_rgba(255,255,255,0.8)]'
                    : isOccupied
                    ? 'bg-gold-50/95 border border-gold-400/80 hover:bg-gold-100/90 shadow-[0_2px_14px_rgba(212,155,20,0.22),inset_0_1px_1.5px_rgba(255,243,196,0.9)] ring-1 ring-gold-400/50'
                    : 'bg-white/80 border border-white/80 hover:bg-white hover:border-gold-400/50 shadow-[0_2px_8px_rgba(0,0,0,0.03),inset_0_1px_1px_rgba(255,255,255,0.9)]'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-sm text-slate-900 tracking-tight">{table.tableNumber}</span>
                  <span
                    className={`w-2.5 h-2.5 rounded-full ${
                      isBillPrinted ? 'bg-blue-500' : isOccupied ? 'bg-gold-500 shadow-[0_0_8px_rgba(212,155,20,0.65)]' : 'bg-emerald-500'
                    }`}
                  ></span>
                </div>

                <div className="flex flex-col">
                  <span className="text-[10px] text-slate-500 font-medium">
                    {table.capacity <= 4 ? `${table.capacity}-Seater` : table.capacity === 6 ? '6-Seater' : `${table.capacity}-Seater`}
                  </span>
                  <span className="text-xs font-bold truncate tabular-nums mt-0.5">
                    {isBillPrinted ? (
                      <span className="text-blue-700">₹{((table.totalPaise || 0) / 100).toLocaleString('en-IN')}</span>
                    ) : isOccupied ? (
                      <span className="text-gold-900 font-bold">₹{((table.totalPaise || 0) / 100).toLocaleString('en-IN')}</span>
                    ) : (
                      <span className="text-emerald-700 font-medium">Available</span>
                    )}
                  </span>
                </div>

                <span className="text-[10px] text-slate-400 font-medium truncate">
                  {isBillPrinted ? 'Bill Settling' : isOccupied ? (table.assignedSteward || 'Steward') : 'Ready'}
                </span>
              </div>
            );
          })}
          {displayedTables.length === 0 && (
            <div className="col-span-full py-8 text-center text-xs text-slate-500 font-medium">
              No tables currently in this status. Click the status button again to show all tables.
            </div>
          )}
        </div>
      </div>

      {/* 4. Split Section: Staff Attendance & Inventory Alerts */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left: Staff Attendance Roster (5 Cols) */}
        <div className="lg:col-span-5 ios27-glass-card p-6 rounded-[24px] border border-white/80 shadow-[0_8px_32px_rgba(0,0,0,0.04),inset_0_1px_1.5px_rgba(255,255,255,0.95)] flex flex-col justify-between gap-4">
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-full bg-emerald-500/[0.08] text-emerald-700 flex items-center justify-center border border-emerald-500/15 shadow-xs">
                  <span className="material-symbols-outlined text-lg">badge</span>
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 tracking-tight">Staff &amp; Roster Today</h3>
                  <span className="text-xs text-slate-500">{totalStaffCount} Enrolled Staff</span>
                </div>
              </div>
              <span className="px-2.5 py-0.5 rounded-full text-xs bg-emerald-500/[0.08] text-emerald-800 border border-emerald-500/20 font-semibold tabular-nums">
                {onDutyPercent}% Checked In
              </span>
            </div>

            {/* Attendance Metric Pills */}
            <div className="grid grid-cols-3 gap-2 text-center bg-black/[0.02] p-2 rounded-2xl border border-black/[0.04]">
              <div className="bg-white p-2.5 rounded-xl border border-black/[0.05] shadow-2xs">
                <span className="text-xl font-bold text-emerald-700 block tabular-nums">{checkedInCount}</span>
                <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">Present (FRS)</span>
              </div>
              <div className="bg-white p-2.5 rounded-xl border border-black/[0.05] shadow-2xs">
                <span className="text-xl font-bold text-amber-700 block tabular-nums">{awaitingPunchCount}</span>
                <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">Awaiting Punch</span>
              </div>
              <div className="bg-white p-2.5 rounded-xl border border-black/[0.05] shadow-2xs">
                <span className="text-xl font-bold text-rose-700 block tabular-nums">{lateCount}</span>
                <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">Late Clock-in</span>
              </div>
            </div>

            {/* Live Face Scan Card */}
            {latestCheckIn && latestStaffMember ? (
              <div className="flex items-center gap-3 p-3 bg-black/[0.02] rounded-2xl border border-black/[0.05]">
                <div className="w-11 h-11 rounded-full overflow-hidden relative border border-slate-200 flex-shrink-0">
                  <img
                    src={latestStaffMember.photoUrl || 'https://images.unsplash.com/photo-1583394838336-acd977736f90?auto=format&fit=crop&w=150&q=80'}
                    alt={latestStaffMember.fullName}
                    className="w-full h-full object-cover"
                  />
                  <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-emerald-500 rounded-full border-2 border-white"></span>
                </div>
                <div className="flex flex-col min-w-0 flex-1 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-900 truncate">{latestStaffMember.fullName}</span>
                    <span className="text-[10px] text-slate-400 tabular-nums">{latestCheckIn.checkInTime}</span>
                  </div>
                  <span className="text-slate-500 truncate">{latestStaffMember.role} • {latestStaffMember.employeeCode}</span>
                  <span className="text-emerald-700 font-semibold text-[10px]">
                    Face Recognition Verified ({latestCheckIn.faceConfidence ? `${latestCheckIn.faceConfidence}%` : 'Present'})
                  </span>
                </div>
              </div>
            ) : (
              <div className="p-3.5 bg-black/[0.02] rounded-2xl border border-black/[0.05] flex items-center gap-3.5 text-xs text-slate-500 shadow-2xs">
                <div className="w-10 h-10 rounded-full bg-forest-950/[0.04] flex items-center justify-center text-forest-900 border border-forest-950/[0.06] shrink-0">
                  <span className="material-symbols-outlined text-xl">face</span>
                </div>
                <div className="min-w-0">
                  <span className="font-bold text-slate-900 block tracking-tight">Biometric Scan Terminal Ready</span>
                  <span className="text-[11px] text-slate-500">Staff can punch attendance at the Face Recognition scan portal.</span>
                </div>
              </div>
            )}
          </div>

          <div className="pt-3 border-t border-slate-100/80 flex items-center justify-between text-xs gap-2">
            <span className="text-slate-400 truncate">FRS Biometrics Active</span>
            <button
              onClick={() => onNavigateTab('attendance')}
              className="text-forest-900 hover:text-forest-950 font-semibold flex items-center gap-1 active:scale-[0.98] transition-transform shrink-0 whitespace-nowrap"
            >
              Open Face Scan Terminal <span className="material-symbols-outlined text-xs">arrow_forward</span>
            </button>
          </div>
        </div>

        {/* Right: Low Stock Alerts (7 Cols) */}
        <div className="lg:col-span-7 ios27-glass-card p-6 rounded-[24px] border border-white/80 shadow-[0_8px_32px_rgba(0,0,0,0.04),inset_0_1px_1.5px_rgba(255,255,255,0.95)] flex flex-col justify-between gap-4">
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className={`w-9 h-9 rounded-full flex items-center justify-center border shadow-xs ${
                  lowStockItems.length > 0 ? 'bg-amber-500/[0.08] text-amber-700 border-amber-500/20' : 'bg-emerald-500/[0.08] text-emerald-700 border-emerald-500/20'
                }`}>
                  <span className="material-symbols-outlined text-lg">
                    {lowStockItems.length > 0 ? 'inventory_2' : 'inventory'}
                  </span>
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 tracking-tight">Stock &amp; Grocery Monitoring</h3>
                  <span className="text-xs text-slate-500">
                    {lowStockItems.length > 0
                      ? `${lowStockItems.length} items below mandatory safety buffer`
                      : 'All items within safe operating reserve'}
                  </span>
                </div>
              </div>
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                lowStockItems.length > 0 ? 'bg-amber-500/[0.08] text-amber-800 border border-amber-500/20' : 'bg-emerald-500/[0.08] text-emerald-800 border border-emerald-500/20'
              }`}>
                {lowStockItems.length > 0 ? 'Reorder Needed' : 'Healthy Inventory'}
              </span>
            </div>

            {/* List */}
            <div className="flex flex-col gap-2">
              {lowStockItems.length > 0 ? (
                lowStockItems.slice(0, 4).map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between p-3 bg-black/[0.02] hover:bg-black/[0.04] rounded-2xl border border-black/[0.05] transition-colors text-xs"
                  >
                    <div className="flex items-center gap-3">
                      <span className="material-symbols-outlined text-amber-600 text-lg">warning</span>
                      <div className="flex flex-col">
                        <span className="font-semibold text-slate-900">{item.name}</span>
                        <span className="text-slate-500 text-[11px]">
                          Current: <strong className="text-amber-700 font-semibold tabular-nums">{item.currentStock} {item.unit}</strong> | Par Buffer: <span className="tabular-nums">{item.minimumReserve} {item.unit}</span>
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={() => onQuickReorder(item.id)}
                      className="h-8 inline-flex items-center justify-center px-3.5 rounded-full bg-gold-500/[0.12] hover:bg-gold-500/[0.22] text-gold-950 font-bold text-xs border border-gold-500/30 active:scale-[0.96] transition-all shadow-2xs"
                    >
                      PO Reorder
                    </button>
                  </div>
                ))
              ) : (
                <div className="p-4 bg-black/[0.02] rounded-2xl border border-black/[0.05] text-xs text-center text-slate-500 py-6">
                  <span className="material-symbols-outlined text-2xl text-emerald-600 block mb-1">check_circle</span>
                  All ingredients and supplies are currently above par stock levels.
                </div>
              )}
            </div>
          </div>

          <div className="pt-3 border-t border-slate-100/80 flex items-center justify-between text-xs gap-2">
            <span className="text-slate-400 truncate">Store Room Status: Normal</span>
            <button
              onClick={() => onNavigateTab('inventory')}
              className="text-forest-900 hover:text-forest-950 font-semibold flex items-center gap-1 active:scale-[0.98] transition-transform shrink-0 whitespace-nowrap"
            >
              View Full Stock Catalog <span className="material-symbols-outlined text-xs">arrow_forward</span>
            </button>
          </div>
        </div>
      </div>

      {/* 5. Bottom Section: Bestsellers & Payment Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Top Selling Dishes (7 Cols) */}
        <div className="lg:col-span-7 ios27-glass-card p-6 rounded-[24px] border border-white/80 shadow-[0_8px_32px_rgba(0,0,0,0.04),inset_0_1px_1.5px_rgba(255,255,255,0.95)] flex flex-col justify-between gap-4">
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-full bg-amber-500/[0.08] text-amber-800 flex items-center justify-center border border-amber-500/20 shadow-xs">
                  <span className="material-symbols-outlined text-lg">restaurant_menu</span>
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 tracking-tight">Multicuisine Kitchen Leaderboard</h3>
                  <span className="text-xs text-slate-500">Kitchen Output Volume &amp; Revenue Leaderboard</span>
                </div>
              </div>
              <span className="px-2.5 py-0.5 rounded-full text-xs bg-slate-100 text-slate-600 font-semibold border border-slate-200/80">
                Today's Kitchen Volume
              </span>
            </div>

            {/* List */}
            <div className="divide-y divide-slate-100/80 text-xs">
              {displayBestsellers.map((dish) => (
                <div key={dish.rank} className="py-2.5 px-2.5 -mx-2.5 rounded-xl flex items-center justify-between hover:bg-black/[0.02] transition-colors">
                  <div className="flex items-center gap-3">
                    <span className="w-6 h-6 rounded-full bg-forest-950/[0.06] text-forest-950 font-bold flex items-center justify-center text-xs tabular-nums border border-forest-950/[0.08]">
                      {dish.rank}
                    </span>
                    <div className="flex flex-col">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`w-2.5 h-2.5 rounded-full border border-white shadow-2xs ${dish.veg ? 'bg-emerald-500' : 'bg-rose-500'}`}
                          title={dish.veg ? 'Vegetarian' : 'Non-Vegetarian'}
                        ></span>
                        <span className="font-semibold text-slate-900">{dish.name}</span>
                      </div>
                      <span className="text-[11px] text-slate-500">
                        {dish.portions} • {dish.note}
                      </span>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="font-bold text-slate-900 block tabular-nums">{dish.revenue}</span>
                    <span className="text-[10px] text-emerald-700 font-semibold">{dish.pct}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="pt-3 border-t border-slate-100/80 flex items-center justify-between text-xs gap-2">
            <span className="text-slate-400 truncate">KDS Dispatch Active</span>
            <button
              onClick={() => onNavigateTab('reports')}
              className="text-forest-900 hover:text-forest-950 font-semibold flex items-center gap-1 active:scale-[0.98] transition-transform shrink-0 whitespace-nowrap"
            >
              View Menu Matrix <span className="material-symbols-outlined text-xs">arrow_forward</span>
            </button>
          </div>
        </div>

        {/* Right: Payment Split & Upcoming Liabilities (5 Cols) */}
        <div className="lg:col-span-5 flex flex-col gap-5">
          {/* Payment Split Card */}
          <div className="ios27-glass-card p-6 rounded-[24px] border border-white/80 shadow-[0_8px_32px_rgba(0,0,0,0.04),inset_0_1px_1.5px_rgba(255,255,255,0.95)] flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-full bg-black/[0.04] text-forest-950 flex items-center justify-center border border-black/[0.05] shadow-xs">
                  <span className="material-symbols-outlined text-lg">payments</span>
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 tracking-tight">Payment Breakdown</h3>
                  <span className="text-xs text-slate-500">
                    {paidBillsToday.length > 0 ? "Today's Verified Inflow Split" : 'Digital vs Physical Cash Inflow'}
                  </span>
                </div>
              </div>
              <span className="text-sm font-bold text-slate-900 tabular-nums">
                ₹{(targetSalesPaise / 100).toLocaleString('en-IN')}
              </span>
            </div>

            {/* Bars */}
            <div className="flex flex-col gap-3 text-xs">
              <div className="flex flex-col gap-1.5">
                <div className="flex justify-between font-medium">
                  <span className="flex items-center gap-1.5 text-slate-700">
                    <span className="material-symbols-outlined text-sm text-emerald-600">qr_code_scanner</span>
                    UPI / QR (PhonePe, GPay, Paytm)
                  </span>
                  <span className="font-semibold text-slate-900 tabular-nums">
                    {upiPct}% (₹{(upiSalesPaise / 100).toLocaleString('en-IN')})
                  </span>
                </div>
                <div className="w-full bg-black/[0.04] rounded-full h-2 overflow-hidden">
                  <div className="bg-emerald-600 h-2 rounded-full transition-all duration-500" style={{ width: `${upiPct}%` }}></div>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <div className="flex justify-between font-medium">
                  <span className="flex items-center gap-1.5 text-slate-700">
                    <span className="material-symbols-outlined text-sm text-blue-600">credit_card</span>
                    POS Machine (Cards)
                  </span>
                  <span className="font-semibold text-slate-900 tabular-nums">
                    {cardPct}% (₹{(cardSalesPaise / 100).toLocaleString('en-IN')})
                  </span>
                </div>
                <div className="w-full bg-black/[0.04] rounded-full h-2 overflow-hidden">
                  <div className="bg-blue-600 h-2 rounded-full transition-all duration-500" style={{ width: `${cardPct}%` }}></div>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <div className="flex justify-between font-medium">
                  <span className="flex items-center gap-1.5 text-slate-700">
                    <span className="material-symbols-outlined text-sm text-slate-500">payments</span>
                    Physical Cash Tally
                  </span>
                  <span className="font-semibold text-slate-900 tabular-nums">
                    {cashPct}% (₹{(cashSalesPaise / 100).toLocaleString('en-IN')})
                  </span>
                </div>
                <div className="w-full bg-black/[0.04] rounded-full h-2 overflow-hidden">
                  <div className="bg-slate-400 h-2 rounded-full transition-all duration-500" style={{ width: `${cashPct}%` }}></div>
                </div>
              </div>
            </div>
          </div>

          {/* Upcoming Liabilities */}
          <div className="ios27-glass-card p-6 rounded-[24px] border border-white/80 shadow-[0_8px_32px_rgba(0,0,0,0.04),inset_0_1px_1.5px_rgba(255,255,255,0.95)] flex flex-col justify-between gap-3 flex-1">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-full bg-slate-500/[0.08] text-slate-600 flex items-center justify-center border border-slate-500/15 shadow-xs">
                  <span className="material-symbols-outlined text-lg">event_upcoming</span>
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 tracking-tight">Upcoming Obligations</h3>
                  <span className="text-xs text-slate-500">Accounts Payable &amp; Liabilities</span>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-2 text-xs">
              {db.liabilities.length > 0 ? (
                db.liabilities.slice(0, 2).map((liab) => (
                  <div key={liab.id} className="p-3 bg-black/[0.02] rounded-2xl flex items-center justify-between border border-black/[0.04]">
                    <div className="flex flex-col">
                      <span className="font-semibold text-slate-900">{liab.title}</span>
                      <span className={`text-[11px] font-medium ${liab.urgency === 'due_today' ? 'text-rose-600' : 'text-amber-700'}`}>
                        Due: {liab.dueDate}
                      </span>
                    </div>
                    <span className="font-bold text-slate-900 text-sm tabular-nums">
                      ₹{(liab.amountPaise / 100).toLocaleString('en-IN')}
                    </span>
                  </div>
                ))
              ) : (
                <div className="p-3 bg-black/[0.02] rounded-2xl border border-black/[0.04] text-xs text-slate-500 text-center py-4">
                  <span className="material-symbols-outlined text-emerald-600 text-base block mb-0.5">verified</span>
                  No pending vendor obligations. All accounts payable are settled.
                </div>
              )}
            </div>

            <div className="pt-2 border-t border-slate-100/80 flex items-center justify-between text-xs gap-2">
              <span className="text-slate-400 truncate">Automated Cash Flow Sync</span>
              <button
                onClick={() => onNavigateTab('finance')}
                className="text-forest-900 hover:text-forest-950 font-semibold flex items-center gap-1 active:scale-[0.98] transition-transform shrink-0 whitespace-nowrap"
              >
                Manage Cash Flow <span className="material-symbols-outlined text-xs">arrow_forward</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
