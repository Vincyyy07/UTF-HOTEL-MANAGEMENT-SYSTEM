'use client';

import React, { useState } from 'react';
import { DatabaseSchema, ExpenseEntry, UpcomingLiability, User } from '../lib/types';

interface FinancePayrollModuleProps {
  db: DatabaseSchema;
  currentUser: User;
  onAddExpense: (expenseData: any) => Promise<void>;
  onPayLiability: (liabilityId: string) => Promise<void>;
}

export const FinancePayrollModule: React.FC<FinancePayrollModuleProps> = ({
  db,
  currentUser,
  onAddExpense,
  onPayLiability,
}) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'expenses' | 'liabilities' | 'payroll'>('overview');
  const [showExpenseModal, setShowExpenseModal] = useState(false);

  // New expense form
  const [expenseTitle, setExpenseTitle] = useState('');
  const [expenseCategory, setExpenseCategory] = useState<ExpenseEntry['category']>('Commercial Gas');
  const [expenseAmountRs, setExpenseAmountRs] = useState('');
  const [expenseMode, setExpenseMode] = useState<ExpenseEntry['paymentMode']>('bank_transfer');
  const [expensePayee, setExpensePayee] = useState('');
  const [expenseRef, setExpenseRef] = useState('');
  const [receiptFile, setReceiptFile] = useState<File | null>(null);

  // 1. Calculations in paise
  const totalIncomePaise = db.bills
    .filter((b) => b.paymentStatus === 'paid')
    .reduce((acc, b) => acc + b.totalPaise, 0);

  const totalExpensePaise = db.expenses.reduce((acc, e) => acc + e.amountPaise, 0);
  const netProfitPaise = totalIncomePaise - totalExpensePaise;
  const marginPct = totalIncomePaise > 0 ? ((netProfitPaise / totalIncomePaise) * 100).toFixed(1) : '0.0';

  // Revenue by mode (handles individual modes as well as split settlements)
  const paidBills = db.bills.filter((b) => b.paymentStatus === 'paid');
  const upiRevenuePaise = paidBills.reduce((acc, b) => {
    if (b.paymentMode === 'upi' || (!b.paymentMode && !b.paymentDetails)) return acc + b.totalPaise;
    if (b.paymentDetails?.upiPaise) return acc + b.paymentDetails.upiPaise;
    return acc;
  }, 0);
  const cardRevenuePaise = paidBills.reduce((acc, b) => {
    if (b.paymentMode === 'card') return acc + b.totalPaise;
    if (b.paymentDetails?.cardPaise) return acc + b.paymentDetails.cardPaise;
    return acc;
  }, 0);
  const cashRevenuePaise = paidBills.reduce((acc, b) => {
    if (b.paymentMode === 'cash') return acc + b.totalPaise;
    if (b.paymentDetails?.cashPaise) return acc + b.paymentDetails.cashPaise;
    return acc;
  }, 0);

  const totalPaymentPaise = upiRevenuePaise + cardRevenuePaise + cashRevenuePaise || 1;
  const upiPct = Math.round((upiRevenuePaise / totalPaymentPaise) * 100);
  const cardPct = Math.round((cardRevenuePaise / totalPaymentPaise) * 100);
  const cashPct = 100 - upiPct - cardPct;

  const handleCreateExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!expenseTitle || !expenseAmountRs) return;

    let receiptUrl: string | undefined = undefined;
    if (receiptFile) {
      try {
        const formData = new FormData();
        formData.append('file', receiptFile);
        formData.append('bucket', 'receipts');
        const res = await fetch('/api/upload', { method: 'POST', body: formData });
        const json = await res.json();
        if (json.success) receiptUrl = json.url;
      } catch (err) {
        console.warn('Receipt upload failed:', err);
      }
    }

    await onAddExpense({
      title: expenseTitle,
      category: expenseCategory,
      amountPaise: Number(expenseAmountRs) * 100,
      paymentMode: expenseMode,
      payee: expensePayee,
      referenceNumber: expenseRef,
      receiptUrl,
    });
    setShowExpenseModal(false);
    setExpenseTitle('');
    setExpenseAmountRs('');
    setExpensePayee('');
    setExpenseRef('');
    setReceiptFile(null);
  };

  return (
    <div className="p-3.5 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-4 sm:space-y-6">
      {/* 1. Top Header */}
      <div className="bg-white p-4 sm:p-5 rounded-2xl shadow-sm border border-slate-200/80 flex flex-col lg:flex-row lg:items-center justify-between gap-3.5 sm:gap-4">
        <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
          <div className="w-10 h-10 rounded-apple bg-emerald-50 border border-emerald-200/60 flex items-center justify-center text-emerald-600 shadow-apple-subtle shrink-0">
            <span className="material-symbols-outlined text-xl">payments</span>
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight whitespace-nowrap">
                Finance, P&amp;L &amp; Payroll
              </h2>
              <span className="px-2.5 py-0.5 rounded-full text-[11px] bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold whitespace-nowrap">
                Real-time Ledger
              </span>
            </div>
            <p className="text-xs text-slate-500 font-medium truncate max-w-sm xl:max-w-md hidden sm:block">
              Auto-synced from settled bills &amp; inventory purchases
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 sm:gap-3 shrink-0 flex-wrap sm:flex-nowrap">
          {/* Sub Navigation Pills - Apple Segmented Control */}
          <div className="flex bg-black/[0.04] p-1 rounded-apple text-xs font-semibold overflow-x-auto max-w-full">
            <button
              onClick={() => setActiveTab('overview')}
              className={`px-3 sm:px-3.5 py-1.5 rounded-apple-sm transition-all whitespace-nowrap active:scale-[0.97] ${
                activeTab === 'overview'
                  ? 'bg-[#05271f] text-gold-300 font-semibold shadow-apple-subtle'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              P&amp;L Summary
            </button>
            <button
              onClick={() => setActiveTab('expenses')}
              className={`px-3 sm:px-3.5 py-1.5 rounded-apple-sm transition-all whitespace-nowrap active:scale-[0.97] ${
                activeTab === 'expenses'
                  ? 'bg-[#05271f] text-gold-300 font-semibold shadow-apple-subtle'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Expenses ({db.expenses.length})
            </button>
            <button
              onClick={() => setActiveTab('liabilities')}
              className={`px-3 sm:px-3.5 py-1.5 rounded-apple-sm transition-all whitespace-nowrap active:scale-[0.97] ${
                activeTab === 'liabilities'
                  ? 'bg-[#05271f] text-gold-300 font-semibold shadow-apple-subtle'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Liabilities ({db.liabilities.length})
            </button>
            <button
              onClick={() => setActiveTab('payroll')}
              className={`px-3 sm:px-3.5 py-1.5 rounded-apple-sm transition-all whitespace-nowrap active:scale-[0.97] ${
                activeTab === 'payroll'
                  ? 'bg-[#05271f] text-gold-300 font-semibold shadow-apple-subtle'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Staff Payroll
            </button>
          </div>

          <button
            onClick={() => setShowExpenseModal(true)}
            className="ios27-btn-small px-3.5 py-1.5 rounded-apple bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-apple-subtle transition-all flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            <span className="material-symbols-outlined text-base">add_card</span>
            <span>+ Record Expense</span>
          </button>
        </div>
      </div>

      {/* 2. Top Financial Bento KPI Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-5 ios27-glass-card rounded-[22px] flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Gross Operating Income</span>
            <span className="material-symbols-outlined text-emerald-600 text-lg">trending_up</span>
          </div>
          <div className="my-2.5">
            <span className="text-2xl font-bold text-slate-900 tracking-tight tabular-nums">
              ₹{(totalIncomePaise / 100).toLocaleString('en-IN')}
            </span>
          </div>
          <span className="text-[11px] text-emerald-600 font-semibold flex items-center gap-1">
            <span className="material-symbols-outlined text-xs">receipt_long</span>
            From {db.bills.filter((b) => b.paymentStatus === 'paid').length} Settled Bills
          </span>
        </div>

        <div className="p-5 ios27-glass-card rounded-[22px] flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Realized Expenses</span>
            <span className="material-symbols-outlined text-rose-500 text-lg">trending_down</span>
          </div>
          <div className="my-2.5">
            <span className="text-2xl font-bold text-rose-600 tracking-tight tabular-nums">
              ₹{(totalExpensePaise / 100).toLocaleString('en-IN')}
            </span>
          </div>
          <span className="text-[11px] text-slate-500 font-medium">
            Procurement, Rent, Gas &amp; Wages
          </span>
        </div>

        <div className="p-5 ios27-glass-dark text-gold-300 border-gold-400/40 rounded-[22px] shadow-apple-card flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-gold-400">Realized Net Profit</span>
            <span className="material-symbols-outlined text-gold-400 text-lg">account_balance_wallet</span>
          </div>
          <div className="my-2.5">
            <span className="text-2xl font-bold tracking-tight text-gold-300 tabular-nums">
              ₹{(netProfitPaise / 100).toLocaleString('en-IN')}
            </span>
          </div>
          <span className="text-[11px] text-gold-400/80 font-medium">
            Net Operational Restaurant Surplus
          </span>
        </div>

        <div className="p-5 ios27-glass-card rounded-[22px] flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Operating Margin</span>
            <span className="material-symbols-outlined text-amber-500 text-lg">pie_chart</span>
          </div>
          <div className="my-2.5">
            <span className="text-2xl font-bold text-amber-600 tracking-tight tabular-nums">
              {marginPct}%
            </span>
          </div>
          <span className="text-[11px] text-slate-500 font-medium">
            Healthy Benchmark target &gt; 65%
          </span>
        </div>
      </div>

      {/* 3. Sub Tab Content */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column: Payment Settlement Split (6 cols) */}
          <div className="lg:col-span-6 bg-white p-5 rounded-2xl shadow-sm border border-slate-200/80 flex flex-col gap-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Inflow Payment Mode Distribution
                </h3>
                <p className="text-xs text-slate-500">Auto-aggregated from cashier checkout terminals</p>
              </div>
              <span className="text-sm font-extrabold text-slate-900">
                ₹{(totalIncomePaise / 100).toLocaleString('en-IN')}
              </span>
            </div>

            <div className="space-y-4 text-xs">
              <div>
                <div className="flex justify-between font-semibold pb-1.5">
                  <span className="flex items-center gap-1.5 text-slate-700">
                    <span className="material-symbols-outlined text-base text-emerald-600">qr_code_scanner</span>
                    UPI / Instant QR (PhonePe, GPay, Paytm)
                  </span>
                  <span className="font-bold text-slate-900">
                    {upiPct}% (₹{(upiRevenuePaise / 100).toLocaleString('en-IN')})
                  </span>
                </div>
                <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden">
                  <div className="bg-emerald-500 h-3 rounded-full transition-all duration-500" style={{ width: `${upiPct}%` }}></div>
                </div>
              </div>

              <div>
                <div className="flex justify-between font-semibold pb-1.5">
                  <span className="flex items-center gap-1.5 text-slate-700">
                    <span className="material-symbols-outlined text-base text-blue-600">credit_card</span>
                    POS Machine (Debit / Credit Cards)
                  </span>
                  <span className="font-bold text-slate-900">
                    {cardPct}% (₹{(cardRevenuePaise / 100).toLocaleString('en-IN')})
                  </span>
                </div>
                <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden">
                  <div className="bg-blue-500 h-3 rounded-full transition-all duration-500" style={{ width: `${cardPct}%` }}></div>
                </div>
              </div>

              <div>
                <div className="flex justify-between font-semibold pb-1.5">
                  <span className="flex items-center gap-1.5 text-slate-700">
                    <span className="material-symbols-outlined text-base text-amber-600">payments</span>
                    Physical Cash Register
                  </span>
                  <span className="font-bold text-slate-900">
                    {cashPct}% (₹{(cashRevenuePaise / 100).toLocaleString('en-IN')})
                  </span>
                </div>
                <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden">
                  <div className="bg-amber-500 h-3 rounded-full transition-all duration-500" style={{ width: `${cashPct}%` }}></div>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Upcoming Liabilities Quick View (6 cols) */}
          <div className="lg:col-span-6 bg-white p-5 rounded-2xl shadow-sm border border-slate-200/80 flex flex-col gap-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Upcoming Financial Liabilities
                </h3>
                <p className="text-xs text-slate-500">Scheduled outflows with mandatory due dates</p>
              </div>
              <button
                onClick={() => setActiveTab('liabilities')}
                className="text-xs text-emerald-600 font-bold hover:underline"
              >
                View All ({db.liabilities.length})
              </button>
            </div>

            <div className="space-y-3">
              {db.liabilities.map((liab) => {
                const isDueToday = liab.urgency === 'due_today';
                return (
                  <div
                    key={liab.id}
                    className="p-3.5 bg-slate-50 border border-slate-100 rounded-xl flex items-center justify-between hover:bg-slate-100/70 transition-colors"
                  >
                    <div className="flex flex-col">
                      <span className="font-bold text-xs text-slate-900">{liab.title}</span>
                      <span className="text-[11px] text-slate-500 mt-0.5">
                        Payee: <strong className="text-slate-700 font-medium">{liab.payee}</strong> • Due:{' '}
                        <span className={`font-semibold ${isDueToday ? 'text-rose-600 font-bold' : 'text-amber-600'}`}>
                          {liab.dueDate}
                        </span>
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-extrabold text-slate-900 font-mono">
                        ₹{(liab.amountPaise / 100).toLocaleString('en-IN')}
                      </span>
                      <button
                        onClick={() => onPayLiability(liab.id)}
                        className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-xs transition-all"
                      >
                        Settle
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Sub Tab: Expenses Ledger */}
      {activeTab === 'expenses' && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200/80 overflow-hidden">
          <div className="p-4 border-b border-slate-200/80 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Realized Expense Outflow Ledger
              </h3>
              <p className="text-xs text-slate-500">Every operational deduction recorded chronologically</p>
            </div>
            <span className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-600 text-xs font-semibold">
              {db.expenses.length} Expense Records
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 border-b border-slate-200/80 text-slate-500 font-bold uppercase tracking-wider text-[11px]">
                <tr>
                  <th className="py-3 px-4">Date</th>
                  <th className="py-3 px-4">Title / Description</th>
                  <th className="py-3 px-4">Category</th>
                  <th className="py-3 px-4">Payee</th>
                  <th className="py-3 px-4">Mode</th>
                  <th className="py-3 px-4">Amount</th>
                  <th className="py-3 px-4">Recorded By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {db.expenses.map((exp) => (
                  <tr key={exp.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-3 px-4 font-mono text-slate-500">{exp.date}</td>
                    <td className="py-3 px-4 font-bold text-slate-900">{exp.title}</td>
                    <td className="py-3 px-4">
                      <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 font-semibold text-[11px]">
                        {exp.category}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-slate-700 font-medium">{exp.payee}</td>
                    <td className="py-3 px-4 uppercase text-slate-500 text-[10px] font-bold">{exp.paymentMode}</td>
                    <td className="py-3 px-4 font-mono font-bold text-rose-600">₹{(exp.amountPaise / 100).toLocaleString('en-IN')}</td>
                    <td className="py-3 px-4 text-slate-500">{exp.recordedBy}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Sub Tab: Liabilities List */}
      {activeTab === 'liabilities' && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200/80 overflow-hidden">
          <div className="p-4 border-b border-slate-200/80 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Upcoming Obligations &amp; Payables
              </h3>
              <p className="text-xs text-slate-500">Rent, power utilities, commercial gas cylinder bookings</p>
            </div>
            <span className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-600 text-xs font-semibold">
              {db.liabilities.length} Obligations
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 border-b border-slate-200/80 text-slate-500 font-bold uppercase tracking-wider text-[11px]">
                <tr>
                  <th className="py-3 px-4">Obligation Title</th>
                  <th className="py-3 px-4">Payee</th>
                  <th className="py-3 px-4">Category</th>
                  <th className="py-3 px-4">Due Date</th>
                  <th className="py-3 px-4">Amount</th>
                  <th className="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {db.liabilities.map((liab) => {
                  const isDueToday = liab.urgency === 'due_today';
                  return (
                    <tr key={liab.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3 px-4 font-bold text-slate-900">{liab.title}</td>
                      <td className="py-3 px-4 text-slate-600">{liab.payee}</td>
                      <td className="py-3 px-4">
                        <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 font-medium">
                          {liab.category}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-mono font-bold">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] ${
                          isDueToday ? 'bg-rose-50 text-rose-700 border border-rose-200' : 'bg-amber-50 text-amber-700 border border-amber-200'
                        }`}>
                          {liab.dueDate} {isDueToday && '(Due Today)'}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-bold text-slate-900 font-mono">
                        ₹{(liab.amountPaise / 100).toLocaleString('en-IN')}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <button
                          onClick={() => onPayLiability(liab.id)}
                          className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-xs transition-all"
                        >
                          Settle &amp; Post Outflow
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Sub Tab: Staff Payroll Ledger */}
      {activeTab === 'payroll' && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200/80 overflow-hidden">
          <div className="p-4 border-b border-slate-200/80 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Staff Payroll &amp; Monthly Wages Ledger
              </h3>
              <p className="text-xs text-slate-500">Calculated from base employment contracts and biometric attendance</p>
            </div>
            <span className="px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-200 text-xs font-bold">
              Next Disbursement Cycle: 5th of Month
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 border-b border-slate-200/80 text-slate-500 font-bold uppercase tracking-wider text-[11px]">
                <tr>
                  <th className="py-3 px-4">Staff Code &amp; Name</th>
                  <th className="py-3 px-4">Role</th>
                  <th className="py-3 px-4">Pay Basis</th>
                  <th className="py-3 px-4">Base Rate</th>
                  <th className="py-3 px-4">Bank IFSC / Account</th>
                  <th className="py-3 px-4">Est. Payout</th>
                  <th className="py-3 px-4 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {db.staff.map((st) => {
                  const staffAttendance = db.attendance.filter(
                    (a) => a.staffId === st.id && (a.status === 'present' || a.status === 'late' || a.status === 'override' || a.status === 'half_day')
                  );
                  const daysAttended = staffAttendance.reduce((acc, a) => acc + (a.status === 'half_day' ? 0.5 : 1), 0);
                  const estPayoutPaise = st.salaryType === 'daily'
                    ? (daysAttended > 0 ? daysAttended * st.baseSalaryPaise : st.baseSalaryPaise)
                    : st.baseSalaryPaise;

                  // Check if already disbursed in expenses this month
                  const currentMonthPrefix = new Date().toISOString().slice(0, 7);
                  const alreadyDisbursed = db.expenses.some(
                    (e) => e.category === 'Salaries' && e.payee === st.fullName && e.date.startsWith(currentMonthPrefix)
                  );

                  return (
                    <tr key={st.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3 px-4 font-bold text-slate-900">
                        <span className="font-mono text-slate-400 font-semibold mr-1.5">{st.employeeCode}</span>
                        {st.fullName}
                      </td>
                      <td className="py-3 px-4">
                        <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 font-medium capitalize">
                          {st.role}
                        </span>
                      </td>
                      <td className="py-3 px-4 capitalize text-slate-600">
                        {st.salaryType} {st.salaryType === 'daily' ? `(${daysAttended}d)` : ''}
                      </td>
                      <td className="py-3 px-4 font-mono font-bold text-slate-900">
                        {currentUser.role === 'admin' ? `₹${(st.baseSalaryPaise / 100).toLocaleString('en-IN')}` : '••••••'}
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-500">
                        {currentUser.role === 'admin' ? `${st.bankName} (${st.bankAccountNumber})` : '•••••• [Protected]'}
                      </td>
                      <td className="py-3 px-4 font-bold text-emerald-700 font-mono">
                        {currentUser.role === 'admin' ? `₹${(estPayoutPaise / 100).toLocaleString('en-IN')}` : '••••••'}
                      </td>
                      <td className="py-3 px-4 text-right">
                        {alreadyDisbursed ? (
                          <span className="px-2.5 py-0.5 rounded-full text-[10px] bg-emerald-100 text-emerald-800 font-bold border border-emerald-200">
                            ✓ Disbursed
                          </span>
                        ) : currentUser.role === 'admin' ? (
                          <button
                            type="button"
                            onClick={async () => {
                              if (confirm(`Disburse ₹${(estPayoutPaise / 100).toLocaleString('en-IN')} to ${st.fullName}? This will record a Salaries expense.`)) {
                                await onAddExpense({
                                  category: 'Salaries',
                                  title: `Staff Salary: ${st.fullName} (${st.employeeCode})`,
                                  amountPaise: estPayoutPaise,
                                  paymentMode: 'bank_transfer',
                                  payee: st.fullName,
                                  referenceNumber: `SAL-${st.employeeCode}-${Date.now().toString().slice(-4)}`,
                                });
                              }
                            }}
                            className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[11px] shadow-xs transition-all active:scale-95"
                          >
                            Disburse
                          </button>
                        ) : (
                          <span className="px-2.5 py-0.5 rounded-full text-[10px] bg-slate-100 text-slate-700 font-bold border border-slate-200">
                            Scheduled
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add Manual Expense Modal */}
      {showExpenseModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white max-w-md w-full rounded-2xl shadow-2xl border border-slate-200 p-6 space-y-4 animate-in fade-in zoom-in duration-150">
            <div>
              <div className="flex items-center gap-2 text-emerald-600 mb-1">
                <span className="material-symbols-outlined text-xl">add_card</span>
                <h3 className="text-base font-bold text-slate-900">
                  Record Operational Expense Entry
                </h3>
              </div>
              <p className="text-xs text-slate-500">
                Logs manual outflows (Rent, Utilities, Gas, Maintenance) into the official P&amp;L ledger.
              </p>
            </div>

            <form onSubmit={handleCreateExpense} className="space-y-3.5 text-xs">
              <div className="space-y-1">
                <label className="font-bold text-slate-700">Expense Title *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. BESCOM Power Bill or 2x LPG Cylinder Refills"
                  value={expenseTitle}
                  onChange={(e) => setExpenseTitle(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Category</label>
                  <select
                    value={expenseCategory}
                    onChange={(e) => setExpenseCategory(e.target.value as any)}
                    className="w-full h-10 px-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 font-medium"
                  >
                    <option value="Commercial Gas">Commercial Gas</option>
                    <option value="Electricity & Water">Electricity &amp; Water</option>
                    <option value="Rent">Rent</option>
                    <option value="Repairs & Maintenance">Repairs &amp; Maintenance</option>
                    <option value="Salaries">Salaries / Daily Wages</option>
                    <option value="Marketing">Marketing</option>
                    <option value="Procurement">Procurement</option>
                    <option value="Miscellaneous">Miscellaneous</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Amount (₹) *</label>
                  <input
                    type="number"
                    required
                    placeholder="0"
                    value={expenseAmountRs}
                    onChange={(e) => setExpenseAmountRs(e.target.value)}
                    className="w-full h-10 px-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 font-mono font-bold"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Payment Mode</label>
                  <select
                    value={expenseMode}
                    onChange={(e) => setExpenseMode(e.target.value as any)}
                    className="w-full h-10 px-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 font-medium"
                  >
                    <option value="bank_transfer">Bank Transfer / NEFT</option>
                    <option value="upi">UPI / Instant QR</option>
                    <option value="cash">Cash Register</option>
                    <option value="cheque">Cheque</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Payee / Vendor Name</label>
                  <input
                    type="text"
                    placeholder="e.g. Total Gas LPG or Landlord"
                    value={expensePayee}
                    onChange={(e) => setExpensePayee(e.target.value)}
                    className="w-full h-10 px-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-700">Receipt / Reference No</label>
                <input
                  type="text"
                  placeholder="RCPT-XXXX"
                  value={expenseRef}
                  onChange={(e) => setExpenseRef(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 font-mono"
                />
              </div>

              <div className="space-y-1">
                <label className="font-bold text-slate-700 flex items-center justify-between">
                  <span>Attach Vendor Bill / Receipt Proof</span>
                </label>
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  onChange={(e) => setReceiptFile(e.target.files?.[0] || null)}
                  className="w-full text-xs text-slate-600 file:mr-2 file:py-1 file:px-2.5 file:rounded-xl file:border-0 file:text-[11px] file:font-bold file:bg-slate-200 file:text-slate-800"
                />
                {receiptFile && (
                  <span className="text-[10px] text-emerald-700 font-bold block">
                    ✓ Attached: {receiptFile.name}
                  </span>
                )}
              </div>

              <div className="flex justify-end gap-2.5 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowExpenseModal(false)}
                  className="px-4 py-2 rounded-xl text-slate-600 hover:bg-slate-100 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold shadow-sm transition-all"
                >
                  Save Expense Outflow
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
