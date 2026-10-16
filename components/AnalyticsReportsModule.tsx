'use client';

import React, { useState, useMemo } from 'react';
import { DatabaseSchema, Bill, StockMovement, ExpenseEntry } from '../lib/types';
import { getLocalDateStr, getYesterdayLocalDateStr, formatLocalDateTime } from '../lib/dateUtils';

interface AnalyticsReportsModuleProps {
  db: DatabaseSchema;
  onRefreshLive?: () => void;
}

export const AnalyticsReportsModule: React.FC<AnalyticsReportsModuleProps> = ({
  db,
  onRefreshLive,
}) => {
  const [dateRange, setDateRange] = useState<'today' | 'yesterday' | '7days' | '30days' | 'all' | 'custom'>('today');
  const [activeReportTab, setActiveReportTab] = useState<'sales' | 'gst' | 'items' | 'wastage' | 'pl'>('sales');
  const [paymentStatusFilter, setPaymentStatusFilter] = useState<'paid' | 'all' | 'unpaid'>('paid');
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Local calendar dates (IST / Local Time)
  const todayDateStr = useMemo(() => getLocalDateStr(), []);
  const yesterdayDateStr = useMemo(() => getYesterdayLocalDateStr(), []);

  const [customStartDate, setCustomStartDate] = useState(todayDateStr);
  const [customEndDate, setCustomEndDate] = useState(todayDateStr);

  const handleManualSync = async () => {
    if (onRefreshLive) {
      setIsRefreshing(true);
      await onRefreshLive();
      setTimeout(() => setIsRefreshing(false), 600);
    }
  };

  // Helper to extract local calendar date YYYY-MM-DD from bill createdAt
  const getBillDateStr = (createdAt: string) => {
    if (!createdAt) return '';
    return getLocalDateStr(createdAt);
  };

  // Filter bills based on dateRange and paymentStatusFilter
  const filteredBills = useMemo(() => {
    if (!db || !db.bills) return [];

    const now = Date.now();
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

    return db.bills.filter((b) => {
      // 1. Payment status check
      if (paymentStatusFilter === 'paid' && b.paymentStatus !== 'paid') return false;
      if (paymentStatusFilter === 'unpaid' && b.paymentStatus !== 'unpaid') return false;

      // 2. Date filtering
      const billDateStr = getBillDateStr(b.createdAt);
      const billTime = new Date(b.createdAt).getTime();

      if (dateRange === 'today') {
        return billDateStr === todayDateStr;
      }
      if (dateRange === 'yesterday') {
        return billDateStr === yesterdayDateStr;
      }
      if (dateRange === '7days') {
        return !isNaN(billTime) && billTime >= sevenDaysAgo;
      }
      if (dateRange === '30days') {
        return !isNaN(billTime) && billTime >= thirtyDaysAgo;
      }
      if (dateRange === 'custom') {
        return billDateStr >= customStartDate && billDateStr <= customEndDate;
      }
      // 'all'
      return true;
    });
  }, [db, dateRange, paymentStatusFilter, todayDateStr, yesterdayDateStr, customStartDate, customEndDate]);

  // Financial aggregates
  const totalGrossSalesPaise = useMemo(
    () => filteredBills.reduce((acc, b) => acc + (b.totalPaise || 0), 0),
    [filteredBills]
  );
  const totalTaxablePaise = useMemo(
    () => filteredBills.reduce((acc, b) => acc + Math.max(0, (b.subtotalPaise || 0) - (b.discountPaise || 0)), 0),
    [filteredBills]
  );
  const totalCgstPaise = useMemo(
    () => filteredBills.reduce((acc, b) => acc + (b.cgstPaise || 0), 0),
    [filteredBills]
  );
  const totalSgstPaise = useMemo(
    () => filteredBills.reduce((acc, b) => acc + (b.sgstPaise || 0), 0),
    [filteredBills]
  );
  const totalGstPaise = totalCgstPaise + totalSgstPaise;
  const totalDiscountPaise = useMemo(
    () => filteredBills.reduce((acc, b) => acc + (b.discountPaise || 0), 0),
    [filteredBills]
  );
  const billCount = filteredBills.length;
  const avgTicketPaise = billCount > 0 ? Math.round(totalGrossSalesPaise / billCount) : 0;

  // Payment mode distribution
  const paymentBreakdown = useMemo(() => {
    const modes: Record<string, { count: number; totalPaise: number }> = {
      upi: { count: 0, totalPaise: 0 },
      cash: { count: 0, totalPaise: 0 },
      card: { count: 0, totalPaise: 0 },
      split: { count: 0, totalPaise: 0 },
    };
    filteredBills.forEach((b) => {
      const mode = (b.paymentMode || 'upi').toLowerCase();
      if (!modes[mode]) modes[mode] = { count: 0, totalPaise: 0 };
      modes[mode].count += 1;
      modes[mode].totalPaise += b.totalPaise || 0;
    });
    return modes;
  }, [filteredBills]);

  // Item sales aggregation from bills
  const sortedItems = useMemo(() => {
    const itemMap: Record<string, { name: string; quantity: number; revenuePaise: number; category?: string }> = {};
    filteredBills.forEach((b) => {
      (b.items || []).forEach((item) => {
        if (!itemMap[item.name]) {
          itemMap[item.name] = { name: item.name, quantity: 0, revenuePaise: 0 };
        }
        itemMap[item.name].quantity += item.quantity || 1;
        itemMap[item.name].revenuePaise += item.totalPaise || 0;
      });
    });
    return Object.values(itemMap).sort((a, b) => b.revenuePaise - a.revenuePaise);
  }, [filteredBills]);

  // Date filter helper
  const matchesDateRange = (dateString?: string) => {
    if (!dateString) return true;
    const now = Date.now();
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
    const dateStr = getBillDateStr(dateString);
    const time = new Date(dateString).getTime();

    if (dateRange === 'today') return dateStr === todayDateStr;
    if (dateRange === 'yesterday') return dateStr === yesterdayDateStr;
    if (dateRange === '7days') return !isNaN(time) && time >= sevenDaysAgo;
    if (dateRange === '30days') return !isNaN(time) && time >= thirtyDaysAgo;
    if (dateRange === 'custom') return dateStr >= customStartDate && dateStr <= customEndDate;
    return true;
  };

  // Expenses & Wastage Filtered for P&L
  const filteredExpenses = useMemo(() => {
    if (!db || !db.expenses) return [];
    return db.expenses.filter((e) => matchesDateRange(e.date));
  }, [db, dateRange, todayDateStr, yesterdayDateStr, customStartDate, customEndDate]);

  const totalExpensesPaise = useMemo(() => {
    return (filteredExpenses || []).reduce((acc, exp) => acc + (exp.amountPaise || 0), 0);
  }, [filteredExpenses]);

  const totalWastageCostPaise = useMemo(() => {
    if (!db || !db.stockMovements) return 0;
    return db.stockMovements
      .filter((sm) => sm.type === 'out_wastage_spoilage' && matchesDateRange(sm.date))
      .reduce((acc, sm) => acc + (sm.totalCostPaise || 0), 0);
  }, [db, dateRange, todayDateStr, yesterdayDateStr, customStartDate, customEndDate]);

  const netOperationalSurplusPaise = totalTaxablePaise - totalExpensesPaise - totalWastageCostPaise;

  // CSV Export utility
  const handleExportCSV = () => {
    let csvContent = 'data:text/csv;charset=utf-8,';

    if (activeReportTab === 'gst' || activeReportTab === 'sales') {
      csvContent += 'Bill Number,Table,Date,Time,Taxable Value (INR),CGST 2.5% (INR),SGST 2.5% (INR),Discount (INR),Net Invoice Total (INR),Payment Mode,Status\n';
      filteredBills.forEach((b) => {
        const dateStr = b.createdAt ? b.createdAt.substring(0, 10) : '';
        const timeStr = b.createdAt ? b.createdAt.substring(11, 19) : '';
        const taxable = ((b.subtotalPaise - b.discountPaise) / 100).toFixed(2);
        const cgst = ((b.cgstPaise || 0) / 100).toFixed(2);
        const sgst = ((b.sgstPaise || 0) / 100).toFixed(2);
        const disc = ((b.discountPaise || 0) / 100).toFixed(2);
        const total = ((b.totalPaise || 0) / 100).toFixed(2);
        csvContent += `"${b.billNumber}","${b.tableNumber}","${dateStr}","${timeStr}",${taxable},${cgst},${sgst},${disc},${total},"${b.paymentMode || 'UPI'}","${b.paymentStatus}"\n`;
      });
    } else if (activeReportTab === 'items') {
      csvContent += 'Rank,Dish / Menu Item,Volume Sold,Gross Revenue (INR),Revenue Share (%)\n';
      sortedItems.forEach((item, idx) => {
        const share = totalGrossSalesPaise > 0 ? ((item.revenuePaise / totalGrossSalesPaise) * 100).toFixed(2) : '0';
        csvContent += `${idx + 1},"${item.name}",${item.quantity},${(item.revenuePaise / 100).toFixed(2)},${share}%\n`;
      });
    } else if (activeReportTab === 'wastage') {
      csvContent += 'Date,Item,Deduction Type,Quantity,Unit,Cost Loss (INR),Notes\n';
      (db.stockMovements || []).forEach((sm) => {
        csvContent += `"${sm.date}","${sm.itemName}","${sm.type}",${sm.quantity},"${sm.unit}",${(sm.totalCostPaise / 100).toFixed(2)},"${sm.notes || ''}"\n`;
      });
    } else {
      // P&L
      csvContent += 'Metric,Amount (INR)\n';
      csvContent += `Taxable Sales Turnover,${(totalTaxablePaise / 100).toFixed(2)}\n`;
      csvContent += `Total GST Collected (5%),${(totalGstPaise / 100).toFixed(2)}\n`;
      csvContent += `Gross Invoiced Revenue,${(totalGrossSalesPaise / 100).toFixed(2)}\n`;
      csvContent += `Operating Expenses,${(totalExpensesPaise / 100).toFixed(2)}\n`;
      csvContent += `Inventory Wastage Loss,${(totalWastageCostPaise / 100).toFixed(2)}\n`;
      csvContent += `Net Operational Surplus,${(netOperationalSurplusPaise / 100).toFixed(2)}\n`;
    }

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `UFP_${activeReportTab}_report_${dateRange}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handlePrintReport = () => {
    window.print();
  };

  return (
    <div className="p-3.5 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-4 sm:space-y-6">
      {/* 1. Header & Live Sync Controls */}
      <div className="ios27-glass-card p-5 rounded-[24px] flex flex-wrap items-center justify-between gap-4 no-print">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-apple bg-gradient-to-br from-emerald-500 to-teal-700 flex items-center justify-center text-white shadow-apple-subtle">
              <span className="material-symbols-outlined text-2xl">insights</span>
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg font-bold text-slate-900 tracking-tight">
                  Statutory Reports &amp; Real-Time Business Analytics
                </h2>
                <span className="px-2.5 py-0.5 rounded-full text-[11px] bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                  Live Synced with POS &amp; KDS
                </span>
              </div>
              <p className="text-xs text-slate-500 font-medium">
                Official GSTIN statements, item velocity ranking, payment mode reconciliations, and P&amp;L ledger
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          {/* Instant Live Sync Button */}
          {onRefreshLive && (
            <button
              onClick={handleManualSync}
              disabled={isRefreshing}
              className="ios27-btn-small px-3.5 rounded-apple bg-black/[0.04] hover:bg-black/[0.07] text-xs font-semibold text-slate-700 transition-all flex items-center gap-1.5 border border-black/[0.06] active:scale-95"
              title="Force sync data from POS, KDS and billing immediately"
            >
              <span className={`material-symbols-outlined text-base text-emerald-600 ${isRefreshing ? 'animate-spin' : ''}`}>
                sync
              </span>
              {isRefreshing ? 'Syncing...' : 'Sync Live Data'}
            </button>
          )}

          {/* Export Actions */}
          <button
            onClick={handleExportCSV}
            className="ios27-btn-small px-3.5 rounded-apple bg-black/[0.04] hover:bg-black/[0.07] text-xs font-semibold text-slate-700 transition-all flex items-center gap-1.5 border border-black/[0.06]"
          >
            <span className="material-symbols-outlined text-base text-slate-500">table_view</span>
            Export Excel / CSV
          </button>
          <button
            onClick={handlePrintReport}
            className="ios27-btn-small px-4 rounded-apple bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-apple-subtle transition-all flex items-center gap-1.5 active:scale-95"
          >
            <span className="material-symbols-outlined text-base">print</span>
            Print Report / PDF
          </button>
        </div>
      </div>

      {/* 2. Filter Bar: Date Range + Payment Status Selector */}
      <div className="ios27-glass-card p-3.5 rounded-[20px] flex flex-wrap items-center justify-between gap-4 no-print">
        {/* Date Presets */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider mr-1">Period:</span>
          <div className="flex bg-black/[0.04] p-1 rounded-apple text-xs font-semibold flex-wrap gap-1">
            {(
              [
                { id: 'today', label: 'Today' },
                { id: 'yesterday', label: 'Yesterday' },
                { id: '7days', label: 'Last 7 Days' },
                { id: '30days', label: 'Last 30 Days' },
                { id: 'all', label: 'All Time' },
                { id: 'custom', label: 'Custom' },
              ] as const
            ).map((dr) => (
              <button
                key={dr.id}
                onClick={() => setDateRange(dr.id)}
                className={`px-3 py-1.5 rounded-apple-sm transition-all active:scale-[0.97] ${
                  dateRange === dr.id
                    ? 'bg-[#05271f] text-gold-300 font-semibold shadow-apple-subtle'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {dr.label}
              </button>
            ))}
          </div>

          {/* Custom Date Pickers */}
          {dateRange === 'custom' && (
            <div className="flex items-center gap-2 bg-black/[0.03] border border-black/[0.06] px-3 py-1 rounded-apple text-xs">
              <span className="text-slate-500 font-medium">From:</span>
              <input
                type="date"
                value={customStartDate}
                onChange={(e) => setCustomStartDate(e.target.value)}
                className="bg-white border border-slate-300 rounded px-2 py-0.5 text-slate-800 text-xs font-mono"
              />
              <span className="text-slate-500 font-medium">To:</span>
              <input
                type="date"
                value={customEndDate}
                onChange={(e) => setCustomEndDate(e.target.value)}
                className="bg-white border border-slate-300 rounded px-2 py-0.5 text-slate-800 text-xs font-mono"
              />
            </div>
          )}
        </div>

        {/* Payment Status Filter */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Status:</span>
          <div className="flex bg-black/[0.04] p-1 rounded-apple text-xs font-semibold">
            {(
              [
                { id: 'paid', label: 'Paid Bills' },
                { id: 'all', label: 'All Invoices' },
                { id: 'unpaid', label: 'Pending Settlement' },
              ] as const
            ).map((st) => (
              <button
                key={st.id}
                onClick={() => setPaymentStatusFilter(st.id)}
                className={`px-3 py-1.5 rounded-apple-sm transition-all active:scale-[0.97] ${
                  paymentStatusFilter === st.id
                    ? 'bg-[#05271f] text-gold-300 font-semibold shadow-apple-subtle'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {st.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 3. KPI Summary Banner */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Gross Turnover */}
        <div className="p-5 ios27-glass-card rounded-[22px] flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Gross Turnover</span>
            <div className="w-8 h-8 rounded-apple bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <span className="material-symbols-outlined text-lg">monetization_on</span>
            </div>
          </div>
          <div className="my-2.5">
            <span className="text-2xl font-bold text-slate-900 tracking-tight tabular-nums">
              ₹{(totalGrossSalesPaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </span>
          </div>
          <div className="flex items-center justify-between text-[11px] text-slate-500 font-medium">
            <span>{billCount} Invoices Evaluated</span>
            <span className="font-semibold text-emerald-700 capitalize">{dateRange}</span>
          </div>
        </div>

        {/* Taxable Turnover */}
        <div className="p-5 ios27-glass-card rounded-[22px] flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Taxable Base</span>
            <div className="w-8 h-8 rounded-apple bg-blue-50 text-blue-600 flex items-center justify-center">
              <span className="material-symbols-outlined text-lg">account_balance</span>
            </div>
          </div>
          <div className="my-2.5">
            <span className="text-2xl font-bold text-slate-900 tracking-tight tabular-nums">
              ₹{(totalTaxablePaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </span>
          </div>
          <div className="flex items-center justify-between text-[11px] text-slate-500 font-medium">
            <span>Pre-Tax (Less Discounts)</span>
            {totalDiscountPaise > 0 && (
              <span className="text-amber-600 font-semibold">Disc: ₹{(totalDiscountPaise / 100).toFixed(0)}</span>
            )}
          </div>
        </div>

        {/* Statutory GST Collected */}
        <div className="p-5 ios27-glass-dark text-gold-300 border-gold-400/40 rounded-[22px] shadow-apple-card flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-gold-400">GST Collected (5%)</span>
            <div className="w-8 h-8 rounded-apple bg-gold-500/20 text-gold-300 flex items-center justify-center">
              <span className="material-symbols-outlined text-lg">receipt_long</span>
            </div>
          </div>
          <div className="my-2.5">
            <span className="text-2xl font-bold tracking-tight text-gold-300 tabular-nums">
              ₹{(totalGstPaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </span>
          </div>
          <span className="text-[11px] text-gold-400/80 font-medium">
            CGST: ₹{(totalCgstPaise / 100).toFixed(2)} • SGST: ₹{(totalSgstPaise / 100).toFixed(2)}
          </span>
        </div>

        {/* Avg Order Value (AOV) & Split Breakdown */}
        <div className="p-5 ios27-glass-card rounded-[22px] flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Average Ticket (AOV)</span>
            <div className="w-8 h-8 rounded-apple bg-amber-50 text-amber-600 flex items-center justify-center">
              <span className="material-symbols-outlined text-lg">calculate</span>
            </div>
          </div>
          <div className="my-2.5">
            <span className="text-2xl font-bold text-amber-600 tracking-tight tabular-nums">
              ₹{(avgTicketPaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </span>
          </div>
          <div className="text-[11px] text-slate-500 font-medium flex items-center gap-2">
            <span>UPI: {paymentBreakdown.upi.count}</span> •
            <span>Cash: {paymentBreakdown.cash.count}</span> •
            <span>Card: {paymentBreakdown.card.count}</span>
          </div>
        </div>
      </div>

      {/* 4. Report Sub Tabs Navigation */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200/80 overflow-hidden">
        <div className="p-4 border-b border-slate-200/80 flex flex-wrap items-center justify-between gap-3 no-print">
          <div className="flex bg-slate-100 p-1 rounded-xl text-xs font-semibold flex-wrap gap-1">
            <button
              onClick={() => setActiveReportTab('sales')}
              className={`px-3.5 py-1.5 rounded-lg transition-all ${
                activeReportTab === 'sales'
                  ? 'bg-white text-slate-900 shadow-sm font-bold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Sales Ledger ({billCount})
            </button>
            <button
              onClick={() => setActiveReportTab('gst')}
              className={`px-3.5 py-1.5 rounded-lg transition-all ${
                activeReportTab === 'gst'
                  ? 'bg-white text-slate-900 shadow-sm font-bold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Statutory GST Statement
            </button>
            <button
              onClick={() => setActiveReportTab('items')}
              className={`px-3.5 py-1.5 rounded-lg transition-all ${
                activeReportTab === 'items'
                  ? 'bg-white text-slate-900 shadow-sm font-bold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Item Sales Ranking ({sortedItems.length})
            </button>
            <button
              onClick={() => setActiveReportTab('wastage')}
              className={`px-3.5 py-1.5 rounded-lg transition-all ${
                activeReportTab === 'wastage'
                  ? 'bg-white text-slate-900 shadow-sm font-bold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Inventory &amp; Wastage
            </button>
            <button
              onClick={() => setActiveReportTab('pl')}
              className={`px-3.5 py-1.5 rounded-lg transition-all ${
                activeReportTab === 'pl'
                  ? 'bg-white text-slate-900 shadow-sm font-bold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Profit &amp; Loss Overview
            </button>
          </div>

          <span className="text-xs text-slate-500 font-medium">
            Showing verified ledger records • Real-time database sync
          </span>
        </div>

        {/* TAB 1: Statutory GST Statement */}
        {activeReportTab === 'gst' && (
          <div className="p-4 sm:p-6 space-y-5">
            {/* GST Legal Banner */}
            <div className="p-4 bg-gradient-to-r from-slate-50 to-emerald-50/40 border border-slate-200/80 rounded-2xl flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="space-y-1">
                <span className="font-extrabold text-slate-900 text-sm block">
                  {db.settings.restaurantName}
                </span>
                <span className="text-slate-600">
                  Official GSTIN: <strong className="font-mono text-emerald-800 font-bold px-1.5 py-0.5 bg-emerald-100 rounded">{db.settings.gstin}</strong> •
                  FSSAI: <span className="font-mono text-slate-700">{db.settings.fssai || '—'}</span>
                </span>
              </div>
              <div className="text-right">
                <span className="px-3 py-1 rounded-full text-xs font-bold bg-emerald-600 text-white shadow-xs inline-block">
                  Standard Food &amp; Beverage GST: 5.0%
                </span>
                <p className="text-[11px] text-slate-500 mt-1">Split: CGST 2.5% + SGST 2.5% (Without ITC on dining)</p>
              </div>
            </div>

            {/* GSTR-1 & GSTR-3B Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 space-y-1">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wider block">GSTR-1 Outward Supplies</span>
                <span className="text-xl font-black text-slate-900">
                  ₹{(totalTaxablePaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </span>
                <p className="text-[11px] text-slate-500">Table 7: B2C Small Supplies (Dining Invoices)</p>
              </div>

              <div className="p-4 rounded-xl border border-emerald-200 bg-emerald-50/40 space-y-1">
                <span className="text-xs font-bold text-emerald-700 uppercase tracking-wider block">Total Tax Output Liability</span>
                <span className="text-xl font-black text-emerald-800">
                  ₹{(totalGstPaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </span>
                <p className="text-[11px] text-emerald-700">CGST ₹{(totalCgstPaise / 100).toFixed(2)} + SGST ₹{(totalSgstPaise / 100).toFixed(2)}</p>
              </div>

              <div className="p-4 rounded-xl border border-blue-200 bg-blue-50/40 space-y-1">
                <span className="text-xs font-bold text-blue-700 uppercase tracking-wider block">Gross Invoiced Value</span>
                <span className="text-xl font-black text-blue-800">
                  ₹{(totalGrossSalesPaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </span>
                <p className="text-[11px] text-blue-700">Total customer collections inclusive of taxes</p>
              </div>
            </div>

            {/* Invoices GST Table */}
            {filteredBills.length === 0 ? (
              <div className="p-10 text-center text-slate-400 bg-slate-50 rounded-2xl">
                <span className="material-symbols-outlined text-4xl mb-2 text-slate-300">receipt_long</span>
                <p className="text-sm font-semibold">No bills match the selected date range ({dateRange})</p>
                <p className="text-xs mt-1 text-slate-400">Switch to &quot;All Time&quot; or create bills in Billing &amp; POS module</p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase tracking-wider text-[11px]">
                    <tr>
                      <th className="py-3 px-4">Invoice / Bill #</th>
                      <th className="py-3 px-4">Date &amp; Time</th>
                      <th className="py-3 px-4">Table</th>
                      <th className="py-3 px-4 text-right">Taxable Value</th>
                      <th className="py-3 px-4 text-right">CGST (2.5%)</th>
                      <th className="py-3 px-4 text-right">SGST (2.5%)</th>
                      <th className="py-3 px-4 text-right">Total GST (5%)</th>
                      <th className="py-3 px-4 text-right">Net Invoice Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-mono">
                    {filteredBills.map((b) => (
                      <tr key={b.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-3 px-4 font-bold text-emerald-700">{b.billNumber}</td>
                        <td className="py-3 px-4 text-slate-600 font-sans">
                          {formatLocalDateTime(b.createdAt)}
                        </td>
                        <td className="py-3 px-4 font-bold text-slate-800 font-sans">{b.tableNumber}</td>
                        <td className="py-3 px-4 text-right text-slate-800">
                          ₹{(((b.subtotalPaise || 0) - (b.discountPaise || 0)) / 100).toFixed(2)}
                        </td>
                        <td className="py-3 px-4 text-right text-slate-600">₹{((b.cgstPaise || 0) / 100).toFixed(2)}</td>
                        <td className="py-3 px-4 text-right text-slate-600">₹{((b.sgstPaise || 0) / 100).toFixed(2)}</td>
                        <td className="py-3 px-4 text-right font-bold text-slate-900">
                          ₹{(((b.cgstPaise || 0) + (b.sgstPaise || 0)) / 100).toFixed(2)}
                        </td>
                        <td className="py-3 px-4 text-right font-bold text-emerald-800 font-sans">
                          ₹{((b.totalPaise || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-slate-50 border-t-2 border-slate-300 font-bold text-slate-900 font-mono">
                    <tr>
                      <td colSpan={3} className="py-3 px-4 font-sans uppercase text-right">Totals:</td>
                      <td className="py-3 px-4 text-right">₹{(totalTaxablePaise / 100).toFixed(2)}</td>
                      <td className="py-3 px-4 text-right text-slate-700">₹{(totalCgstPaise / 100).toFixed(2)}</td>
                      <td className="py-3 px-4 text-right text-slate-700">₹{(totalSgstPaise / 100).toFixed(2)}</td>
                      <td className="py-3 px-4 text-right">₹{(totalGstPaise / 100).toFixed(2)}</td>
                      <td className="py-3 px-4 text-right text-emerald-800 font-sans">
                        ₹{(totalGrossSalesPaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: Sales Ledger */}
        {activeReportTab === 'sales' && (
          <div className="overflow-x-auto">
            {filteredBills.length === 0 ? (
              <div className="p-10 text-center text-slate-400">
                <span className="material-symbols-outlined text-4xl mb-2 text-slate-300">point_of_sale</span>
                <p className="text-sm font-semibold">No sales records in selected period ({dateRange})</p>
                <p className="text-xs mt-1 text-slate-400">Bills created in Billing &amp; POS appear here in real time</p>
              </div>
            ) : (
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 border-b border-slate-200/80 text-slate-500 font-bold uppercase tracking-wider text-[11px]">
                  <tr>
                    <th className="py-3 px-4">Bill Number</th>
                    <th className="py-3 px-4">Date &amp; Time</th>
                    <th className="py-3 px-4">Table</th>
                    <th className="py-3 px-4">Steward</th>
                    <th className="py-3 px-4">Guest Count</th>
                    <th className="py-3 px-4">Payment Mode</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-right">Subtotal</th>
                    <th className="py-3 px-4 text-right">Net Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredBills.map((b) => (
                    <tr key={b.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3 px-4 font-mono font-bold text-emerald-700">{b.billNumber}</td>
                      <td className="py-3 px-4 text-slate-500">
                        {formatLocalDateTime(b.createdAt)}
                      </td>
                      <td className="py-3 px-4 font-bold text-slate-800">{b.tableNumber}</td>
                      <td className="py-3 px-4 text-slate-600">{b.stewardName}</td>
                      <td className="py-3 px-4 text-slate-500">{b.guestCount} guests</td>
                      <td className="py-3 px-4">
                        <span className="px-2.5 py-0.5 rounded-md bg-slate-100 text-slate-800 uppercase font-bold text-[10px] border border-slate-200">
                          {b.paymentMode || 'UPI'}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            b.paymentStatus === 'paid'
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : 'bg-amber-50 text-amber-700 border border-amber-200'
                          }`}
                        >
                          {b.paymentStatus.toUpperCase()}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-600 text-right">
                        ₹{((b.subtotalPaise || 0) / 100).toFixed(2)}
                      </td>
                      <td className="py-3 px-4 font-bold font-mono text-slate-900 text-right">
                        ₹{((b.totalPaise || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* TAB 3: Item Sales Ranking */}
        {activeReportTab === 'items' && (
          <div className="overflow-x-auto">
            {sortedItems.length === 0 ? (
              <div className="p-10 text-center text-slate-400">
                <span className="material-symbols-outlined text-4xl mb-2 text-slate-300">restaurant</span>
                <p className="text-sm font-semibold">No item volume sold in this period</p>
              </div>
            ) : (
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 border-b border-slate-200/80 text-slate-500 font-bold uppercase tracking-wider text-[11px]">
                  <tr>
                    <th className="py-3 px-4">Rank</th>
                    <th className="py-3 px-4">Dish / Menu Item</th>
                    <th className="py-3 px-4">Volume Sold</th>
                    <th className="py-3 px-4 text-right">Gross Revenue</th>
                    <th className="py-3 px-4">Revenue Share</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sortedItems.map((item, idx) => (
                    <tr key={item.name} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3 px-4">
                        <span
                          className={`w-6 h-6 rounded-full inline-flex items-center justify-center font-bold text-xs ${
                            idx === 0
                              ? 'bg-amber-100 text-amber-800'
                              : idx === 1
                              ? 'bg-slate-200 text-slate-700'
                              : idx === 2
                              ? 'bg-amber-50 text-amber-700'
                              : 'text-slate-500'
                          }`}
                        >
                          {idx + 1}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-bold text-slate-900">{item.name}</td>
                      <td className="py-3 px-4 font-mono font-bold text-slate-700">{item.quantity} orders</td>
                      <td className="py-3 px-4 font-bold font-mono text-emerald-700 text-right">
                        ₹{(item.revenuePaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <div className="w-20 bg-slate-100 rounded-full h-2 overflow-hidden">
                            <div
                              className="bg-emerald-500 h-2 rounded-full"
                              style={{
                                width: `${
                                  totalGrossSalesPaise > 0
                                    ? ((item.revenuePaise / totalGrossSalesPaise) * 100).toFixed(1)
                                    : 0
                                }%`,
                              }}
                            ></div>
                          </div>
                          <span className="text-slate-600 font-semibold font-mono text-[11px]">
                            {totalGrossSalesPaise > 0
                              ? ((item.revenuePaise / totalGrossSalesPaise) * 100).toFixed(1)
                              : 0}
                            %
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* TAB 4: Inventory & Wastage Log */}
        {activeReportTab === 'wastage' && (
          <div className="overflow-x-auto">
            {(!db.stockMovements || db.stockMovements.length === 0) ? (
              <div className="p-10 text-center text-slate-400">
                <span className="material-symbols-outlined text-4xl mb-2 text-slate-300">inventory_2</span>
                <p className="text-sm font-semibold">No stock movement or wastage logged yet</p>
                <p className="text-xs mt-1 text-slate-400">Transactions from the Inventory &amp; Stock module will record here</p>
              </div>
            ) : (
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 border-b border-slate-200/80 text-slate-500 font-bold uppercase tracking-wider text-[11px]">
                  <tr>
                    <th className="py-3 px-4">Date</th>
                    <th className="py-3 px-4">Item Name</th>
                    <th className="py-3 px-4">Deduction Type</th>
                    <th className="py-3 px-4">Quantity</th>
                    <th className="py-3 px-4 text-right">Cost / Loss Value</th>
                    <th className="py-3 px-4">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {db.stockMovements
                    .filter((sm) => matchesDateRange(sm.date))
                    .map((sm) => (
                    <tr key={sm.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3 px-4 font-mono text-slate-500">{sm.date}</td>
                      <td className="py-3 px-4 font-bold text-slate-900">{sm.itemName}</td>
                      <td className="py-3 px-4 capitalize">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            sm.type === 'out_wastage_spoilage'
                              ? 'bg-rose-50 text-rose-700 border border-rose-200'
                              : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {sm.type.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-mono font-bold text-slate-800">
                        {sm.quantity} {sm.unit}
                      </td>
                      <td className="py-3 px-4 font-bold text-rose-600 font-mono text-right">
                        ₹{(sm.totalCostPaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-3 px-4 text-slate-500">{sm.notes || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* TAB 5: Profit & Loss Overview */}
        {activeReportTab === 'pl' && (
          <div className="p-4 sm:p-6 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-5 rounded-2xl bg-emerald-50/60 border border-emerald-200">
                <span className="text-xs font-bold text-emerald-700 uppercase tracking-wider block">Net Taxable Revenue</span>
                <span className="text-2xl font-black text-emerald-900 mt-1 block">
                  ₹{(totalTaxablePaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </span>
                <p className="text-[11px] text-emerald-700 mt-1">Total base sales net of food discounts</p>
              </div>

              <div className="p-5 rounded-2xl bg-rose-50/60 border border-rose-200">
                <span className="text-xs font-bold text-rose-700 uppercase tracking-wider block">Total Operational Outflow</span>
                <span className="text-2xl font-black text-rose-900 mt-1 block">
                  ₹{((totalExpensesPaise + totalWastageCostPaise) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </span>
                <p className="text-[11px] text-rose-700 mt-1">
                  Expenses: ₹{(totalExpensesPaise / 100).toFixed(0)} • Spoilage: ₹{(totalWastageCostPaise / 100).toFixed(0)}
                </p>
              </div>

              <div
                className={`p-5 rounded-2xl border ${
                  netOperationalSurplusPaise >= 0
                    ? 'bg-blue-50/60 border-blue-200 text-blue-900'
                    : 'bg-amber-50/60 border-amber-200 text-amber-900'
                }`}
              >
                <span className="text-xs font-bold uppercase tracking-wider block">Operational Surplus / Net Margin</span>
                <span className="text-2xl font-black mt-1 block">
                  ₹{(netOperationalSurplusPaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </span>
                <p className="text-[11px] mt-1 opacity-80">
                  {totalTaxablePaise > 0
                    ? `Margin: ${((netOperationalSurplusPaise / totalTaxablePaise) * 100).toFixed(1)}%`
                    : 'Awaiting sales data'}
                </p>
              </div>
            </div>

            {/* Reconciliation Breakdown */}
            <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 text-xs space-y-2 font-mono">
              <div className="flex justify-between py-1 border-b border-slate-200">
                <span className="font-sans font-bold text-slate-700">Gross Invoiced Dining Collections:</span>
                <span className="font-bold text-slate-900">₹{(totalGrossSalesPaise / 100).toFixed(2)}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-200">
                <span className="font-sans text-slate-600">(-) Output GST Collected (5%):</span>
                <span className="text-slate-700">-₹{(totalGstPaise / 100).toFixed(2)}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-200">
                <span className="font-sans font-bold text-emerald-800">(=) Taxable Base Sales:</span>
                <span className="font-bold text-emerald-800">₹{(totalTaxablePaise / 100).toFixed(2)}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-200">
                <span className="font-sans text-rose-700">(-) Recorded Operating Expenses (Finance Module):</span>
                <span className="text-rose-700">-₹{(totalExpensesPaise / 100).toFixed(2)}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-200">
                <span className="font-sans text-rose-700">(-) Kitchen Spoilage / Wastage (Inventory Module):</span>
                <span className="text-rose-700">-₹{(totalWastageCostPaise / 100).toFixed(2)}</span>
              </div>
              <div className="flex justify-between py-2 text-sm font-bold bg-white px-3 rounded-lg border border-slate-200">
                <span className="font-sans text-slate-900">Estimated Operational Surplus:</span>
                <span className={netOperationalSurplusPaise >= 0 ? 'text-emerald-700' : 'text-rose-700'}>
                  ₹{(netOperationalSurplusPaise / 100).toFixed(2)}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
