'use client';

import React, { useState, useEffect } from 'react';
import { User, UserRole, RestaurantTable } from '../lib/types';

interface HeaderProps {
  currentUser: User;
  onLogout?: () => void;
  tables: RestaurantTable[];
  activeTab: string;
  onOpenNewOrder?: () => void;
  onRefreshData?: () => void;
  isSidebarCollapsed?: boolean;
  onToggleSidebarCollapse?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentUser,
  onLogout,
  tables,
  activeTab,
  onOpenNewOrder,
  onRefreshData,
  isSidebarCollapsed = false,
  onToggleSidebarCollapse,
}) => {
  const [timeStr, setTimeStr] = useState('08:42 PM IST');
  const [dateStr, setDateStr] = useState('Fri, Oct 24, 2025');
  const [showRoleDropdown, setShowRoleDropdown] = useState(false);
  const [showNotifDropdown, setShowNotifDropdown] = useState(false);

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTimeStr(
        now.toLocaleTimeString('en-IN', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: true,
        }) + ' IST'
      );
      setDateStr(
        now.toLocaleDateString('en-IN', {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        })
      );
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  const totalTables = tables.length;
  const occupiedTables = tables.filter((t) => t.status === 'occupied' || t.status === 'bill_printed').length;
  const occupancyPercent = totalTables > 0 ? Math.round((occupiedTables / totalTables) * 100) : 0;

  const tabLabels: Record<string, string> = {
    dashboard: 'Executive Dashboard',
    billing: 'Table POS & Billing',
    staff: 'Staff Directory',
    attendance: 'Biometric Attendance',
    inventory: 'Inventory & Stock Control',
    finance: 'Finance, P&L & Cash Flow',
    reports: 'Statutory Reports & GST',
    settings: 'Settings & Admin Handover',
  };

  return (
    <header className={`fixed top-0 left-0 ${isSidebarCollapsed ? 'md:left-20' : 'md:left-64'} right-0 h-20 bg-white/80 backdrop-blur-2xl backdrop-saturate-180 border-b border-black/[0.06] z-30 shadow-apple-subtle no-print hidden md:block transition-all duration-300 ease-in-out`}>
      <div className="h-full px-4 sm:px-6 flex items-center justify-between gap-3">
        {/* Left Section: Breadcrumb & Key Status Badges */}
        <div className="flex items-center gap-2.5 sm:gap-3 flex-1 min-w-0">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-500 min-w-0">
            <span className="text-forest-900 font-semibold truncate bg-forest-950/[0.05] px-3 py-1 rounded-full border border-forest-950/[0.08]">
              {tabLabels[activeTab] || 'Dashboard'}
            </span>
          </div>

          {/* Occupancy Indicator */}
          <div className="hidden 2xl:flex items-center gap-2 bg-emerald-500/[0.08] px-3 py-1 rounded-full border border-emerald-500/20 text-xs">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span className="text-forest-950 font-medium">
              Occupancy: <strong className="text-forest-950 font-semibold tabular-nums">{occupiedTables}/{totalTables} Tables ({occupancyPercent}%)</strong>
            </span>
          </div>
        </div>

        {/* Right Section: Time, Sync, Notifications & Role Profile */}
        <div className="flex items-center gap-2.5 sm:gap-3 shrink-0">
          {/* Time & Date (Visible on large screens) */}
          <div className="hidden lg:flex flex-col text-right">
            <span className="text-xs font-semibold text-slate-900 tracking-tight">{dateStr}</span>
            <span className="text-[11px] font-medium text-gold-700 tracking-tight tabular-nums">{timeStr}</span>
          </div>

          <div className="h-6 w-px bg-slate-200/60 mx-0.5 hidden lg:block"></div>

          {/* Sync Button */}
          <button
            onClick={onRefreshData}
            title="Sync Database"
            className="w-9 h-9 flex items-center justify-center rounded-apple bg-black/[0.04] hover:bg-black/[0.07] active:scale-[0.97] text-forest-950 transition-all border border-black/[0.05]"
          >
            <span className="material-symbols-outlined text-lg">sync</span>
          </button>

          {/* Outside Click Dismiss Overlay for Dropdowns */}
          {(showNotifDropdown || showRoleDropdown) && (
            <div
              className="fixed inset-0 z-40 bg-transparent"
              onClick={() => {
                setShowNotifDropdown(false);
                setShowRoleDropdown(false);
              }}
            />
          )}

          {/* Notifications Button */}
          <div className="relative z-50">
            <button
              onClick={() => {
                setShowRoleDropdown(false);
                setShowNotifDropdown(!showNotifDropdown);
              }}
              title="Notifications"
              className="w-9 h-9 flex items-center justify-center rounded-apple bg-black/[0.04] hover:bg-black/[0.07] active:scale-[0.97] text-forest-950 transition-all border border-black/[0.05] relative cursor-pointer"
            >
              <span className="material-symbols-outlined text-lg">notifications</span>
              {occupiedTables > 0 && (
                <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-emerald-500 ring-2 ring-white animate-pulse"></span>
              )}
            </button>

            {showNotifDropdown && (
              <div className="absolute right-0 top-11 w-80 bg-white/95 backdrop-blur-2xl backdrop-saturate-180 border border-black/[0.08] shadow-apple-card rounded-apple-lg p-3.5 z-50 flex flex-col gap-2.5">
                <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                  <span className="text-xs font-bold text-slate-900">Live Operational Status</span>
                  <span className="text-[10px] bg-emerald-50 text-emerald-800 px-2.5 py-0.5 rounded-full font-semibold border border-emerald-200/60">Active</span>
                </div>
                <div className="text-xs flex flex-col gap-2">
                  <div className="p-3 bg-slate-50/80 border border-slate-200/60 rounded-apple text-slate-800">
                    <strong className="block text-slate-900 font-semibold mb-0.5">Floor Status</strong>
                    <span className="tabular-nums">{occupiedTables} occupied of {totalTables} total dining tables ({occupancyPercent}% occupancy).</span>
                  </div>
                  <div className="p-3 bg-forest-50/80 border border-forest-900/10 rounded-apple text-forest-900">
                    <strong className="block text-forest-950 font-semibold mb-0.5">POS & KDS Online</strong>
                    <span>High-speed KOT routing and kitchen pass active.</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* User Profile & Role Switcher */}
          <div className="relative">
            <button
              onClick={() => setShowRoleDropdown(!showRoleDropdown)}
              className="flex items-center gap-2 p-1.5 pr-3 rounded-apple hover:bg-black/[0.04] active:scale-[0.98] transition-all border border-transparent hover:border-black/[0.04]"
            >
              <img
                alt={currentUser.name}
                className="w-8 h-8 rounded-full object-cover ring-2 ring-gold-400/50 shadow-xs"
                src={currentUser.avatarUrl || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=150&q=80'}
              />
              <div className="hidden xl:flex flex-col text-left">
                <span className="text-xs font-semibold text-slate-900 leading-tight">
                  {currentUser.name}
                </span>
                <span className="text-[10px] text-gold-700 font-semibold capitalize leading-tight">
                  {currentUser.role === 'admin' ? 'Owner / Admin' : currentUser.role}
                </span>
              </div>
              <span className="material-symbols-outlined text-slate-400 text-sm hidden xl:block">
                expand_more
              </span>
            </button>

            {/* Session Card Dropdown */}
            {showRoleDropdown && (
              <div className="absolute right-0 top-12 w-68 bg-white/90 backdrop-blur-2xl backdrop-saturate-180 border border-black/[0.08] shadow-apple-card rounded-apple-lg p-3.5 z-50 flex flex-col gap-3">
                <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                  <div>
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 block">
                      Active User Session
                    </span>
                    <span className="text-xs font-bold text-slate-900">{currentUser.name}</span>
                  </div>
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-semibold uppercase bg-emerald-50 text-emerald-800 border border-emerald-200/60">
                    {currentUser.role}
                  </span>
                </div>
                
                <div className="p-3 rounded-apple bg-slate-50/80 border border-slate-200/60 text-[11px] text-slate-600">
                  <div className="flex items-center gap-1.5 text-slate-800 font-semibold mb-1">
                    <span className="material-symbols-outlined text-sm text-emerald-600">verified_user</span>
                    <span>Role Access Locked</span>
                  </div>
                  <span>Permissions are bound to this account. To change roles, please log out to the portal.</span>
                </div>

                {onLogout && (
                  <div className="pt-1 border-t border-slate-100">
                    <button
                      onClick={() => {
                        setShowRoleDropdown(false);
                        onLogout();
                      }}
                      className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-apple text-center text-xs text-rose-600 hover:bg-rose-50/80 font-semibold active:scale-[0.98] transition-all border border-rose-200/60"
                    >
                      <span className="material-symbols-outlined text-base">logout</span>
                      <span>Lock / Log Out to Portal</span>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
