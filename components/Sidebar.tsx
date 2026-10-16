'use client';

import React, { useState } from 'react';
import { User, UserRole } from '../lib/types';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  currentUser: User;
  onLogout?: () => void;
  restaurantName?: string;
  activeOrdersCount?: number;
  mobileOpen?: boolean;
  onCloseMobile?: () => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  setActiveTab,
  currentUser,
  onLogout,
  restaurantName = 'UNITED FOOD PALACE',
  activeOrdersCount = 0,
  mobileOpen = false,
  onCloseMobile,
  isCollapsed = false,
  onToggleCollapse,
}) => {

  const dashboardItem = {
    id: 'dashboard',
    label: 'Dashboard',
    icon: 'dashboard',
    roles: ['admin', 'manager'],
  };

  const navSections = [
    {
      title: 'Operations & Service',
      items: [
        { id: 'billing', label: 'Billing & POS', icon: 'point_of_sale', roles: ['admin', 'manager', 'cashier', 'waiter'] },
        { id: 'orders', label: 'Live Orders & KDS', icon: 'soup_kitchen', roles: ['admin', 'manager', 'kitchen', 'waiter', 'cashier'] },
      ],
    },
    {
      title: 'Team & Roster',
      items: [
        { id: 'staff', label: 'Staff Directory', icon: 'badge', roles: ['admin', 'manager'] },
        { id: 'attendance', label: 'Attendance', icon: 'center_focus_strong', roles: ['admin', 'manager', 'staff', 'waiter', 'kitchen', 'cashier'] },
      ],
    },
    {
      title: 'Inventory & Accounts',
      items: [
        { id: 'inventory', label: 'Inventory & Stock', icon: 'inventory_2', roles: ['admin', 'manager', 'kitchen'] },
        { id: 'finance', label: 'Finance & P&L', icon: 'payments', roles: ['admin', 'manager'] },
        { id: 'reports', label: 'Reports & GST', icon: 'analytics', roles: ['admin', 'manager'] },
      ],
    },
    {
      title: 'System',
      items: [
        { id: 'settings', label: 'Settings & Access', icon: 'settings', roles: ['admin'] },
      ],
    },
  ];

  // Collapsed state only applies on desktop (when mobile drawer is closed)
  const isDesktopCollapsed = isCollapsed && !mobileOpen;

  const renderNavItem = (
    item: { id: string; label: string; icon: string; roles: string[] },
    categoryTitle?: string
  ) => {
    const isActive = activeTab === item.id;
    const isAccessible = item.roles.includes(currentUser.role);

    if (isDesktopCollapsed) {
      return (
        <div key={item.id} className="relative group flex justify-center">
          <button
            type="button"
            onClick={() => {
              if (isAccessible) {
                setActiveTab(item.id);
                onCloseMobile?.();
              }
            }}
            disabled={!isAccessible}
            className={`w-11 h-11 rounded-apple flex items-center justify-center transition-all duration-150 relative active:scale-[0.96] ${
              isActive
                ? 'gold-metallic-surface shadow-[0_0_20px_rgba(229,184,76,0.55)] ring-2 ring-gold-300/90 font-bold'
                : isAccessible
                ? 'text-slate-300 hover:bg-forest-900/80 hover:text-gold-200'
                : 'opacity-30 cursor-not-allowed text-slate-500'
            }`}
            title={item.label}
          >
            <span className={`material-symbols-outlined text-[20px] ${isActive ? 'text-forest-950 font-bold' : 'text-slate-300'}`}>
              {item.icon}
            </span>

            {item.id === 'orders' && activeOrdersCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full text-[9px] font-black bg-rose-500 text-white flex items-center justify-center ring-2 ring-forest-950 animate-pulse">
                {activeOrdersCount}
              </span>
            )}

            {!isAccessible && (
              <span className="material-symbols-outlined text-[10px] text-slate-500 absolute bottom-1 right-1">
                lock
              </span>
            )}
          </button>

          {/* Floating Tooltip with Category badge */}
          <div className="absolute left-full ml-3 top-1/2 -translate-y-1/2 px-3 py-2 rounded-apple bg-forest-950 text-gold-200 text-sm font-semibold whitespace-nowrap shadow-apple-card border border-gold-400/30 z-50 opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity flex flex-col gap-0.5">
            {categoryTitle && (
              <span className="text-[11px] font-bold text-gold-300 uppercase tracking-wider">
                {categoryTitle}
              </span>
            )}
            <div className="flex items-center gap-2">
              <span>{item.label}</span>
              {item.id === 'orders' && activeOrdersCount > 0 && (
                <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-rose-500 text-white font-black">
                  {activeOrdersCount}
                </span>
              )}
            </div>
          </div>
        </div>
      );
    }

    // Expanded full-width item
    return (
      <button
        key={item.id}
        type="button"
        onClick={() => {
          if (isAccessible) {
            setActiveTab(item.id);
            onCloseMobile?.();
          }
        }}
        disabled={!isAccessible}
        className={`w-full flex items-center gap-3 px-3.5 py-3 rounded-apple transition-all duration-150 text-left text-sm sm:text-[15px] font-semibold active:scale-[0.98] ${
          isActive
            ? 'bg-gradient-to-r from-gold-500/25 via-gold-400/15 to-transparent text-white font-bold border-l-[3px] border-gold-300 shadow-[inset_0_1px_1px_rgba(255,255,255,0.1),0_0_16px_-2px_rgba(229,184,76,0.3)] backdrop-blur-md'
            : isAccessible
            ? 'text-slate-200 hover:bg-white/[0.06] hover:text-gold-200'
            : 'opacity-30 cursor-not-allowed text-slate-500'
        }`}
      >
        <span className={`material-symbols-outlined text-[22px] transition-all ${isActive ? 'text-gold-300 drop-shadow-[0_0_8px_rgba(229,184,76,0.7)]' : 'text-slate-400'}`}>
          {item.icon}
        </span>
        <span className={`truncate flex-1 ${isActive ? 'font-bold tracking-tight text-white' : ''}`}>{item.label}</span>
        {item.id === 'orders' && activeOrdersCount > 0 && (
          <span
            className={`px-2 py-0.5 rounded-full text-[11px] font-black ${
              isActive ? 'gold-metallic-surface shadow-xs' : 'bg-rose-500 text-white animate-pulse'
            }`}
          >
            {activeOrdersCount}
          </span>
        )}
        {!isAccessible && (
          <span className="material-symbols-outlined text-sm text-slate-500">lock</span>
        )}
      </button>
    );
  };

  return (
    <>
      {/* Mobile Drawer Backdrop */}
      {mobileOpen && (
        <div
          onClick={onCloseMobile}
          className="fixed inset-0 bg-slate-950/70 backdrop-blur-xs z-40 md:hidden animate-in fade-in duration-200"
        />
      )}

      <aside
        className={`fixed left-0 top-0 h-full bg-forest-950 text-slate-100 z-50 flex flex-col justify-between shadow-2xl no-print border-r border-gold-500/20 transition-all duration-300 ease-in-out ${
          mobileOpen
            ? 'translate-x-0 w-72 sm:w-80'
            : '-translate-x-full md:translate-x-0'
        } ${isDesktopCollapsed ? 'md:w-20' : 'md:w-64'}`}
      >
        {/* Edge Floating Toggle Tab on Sidebar Border (Only appears when left navigation menu is opened) */}
        {!isDesktopCollapsed && onToggleCollapse && (
          <button
            type="button"
            onClick={onToggleCollapse}
            className="hidden md:flex absolute -right-3.5 top-7 w-7 h-7 rounded-full bg-[#031e17] text-gold-300 hover:text-white hover:bg-gold-500 hover:text-forest-950 border-2 border-gold-400 shadow-[0_2px_8px_rgba(0,0,0,0.5)] items-center justify-center transition-all hover:scale-110 active:scale-95 z-50 cursor-pointer"
            title="Collapse Left Menu (Ctrl+B)"
            aria-label="Collapse Left Menu"
          >
            <span className="material-symbols-outlined text-sm font-bold">
              chevron_left
            </span>
          </button>
        )}

        <div className="flex-1 min-h-0 flex flex-col overflow-y-auto">
          {/* Header Bar */}
          {isDesktopCollapsed ? (
            /* Collapsed Header (Icon only - click to expand) */
            <div
              onClick={onToggleCollapse}
              className="h-20 shrink-0 flex flex-col items-center justify-center bg-[#031e17] border-b border-gold-500/30 px-2 relative cursor-pointer group"
              title="Open Left Menu (Ctrl+B)"
            >
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleCollapse?.();
                }}
                className="w-12 h-12 rounded-full overflow-hidden hover:opacity-95 transition-all group-hover:scale-105 active:scale-95 p-0.5 bg-black flex items-center justify-center border-2 border-gold-400/90 shadow-[0_0_18px_rgba(229,184,76,0.55),inset_0_1px_2px_rgba(255,248,220,0.85)] cursor-pointer"
                title="Open Left Menu (Ctrl+B)"
              >
                <img src="/logo.png" alt="UFP Logo" className="w-full h-full object-contain" />
              </button>
              <span className="text-[11px] font-black gold-text-shine mt-1 uppercase tracking-widest font-mono">
                UFP
              </span>
            </div>
          ) : (
            /* Expanded Header (Full Branding) */
            <div className="h-20 shrink-0 px-4 sm:px-5 flex items-center justify-between bg-[#031e17] border-b border-gold-500/30">
              <div className="flex items-center gap-3 min-w-0 pr-2">
                <div className="w-12 h-12 rounded-full overflow-hidden p-0.5 bg-black border-2 border-gold-400/90 shadow-[0_0_18px_rgba(229,184,76,0.55),inset_0_1px_2px_rgba(255,248,220,0.85)] shrink-0 flex items-center justify-center">
                  <img
                    src="/logo.png"
                    alt="UFP Logo"
                    className="w-full h-full object-contain"
                  />
                </div>
                <div className="flex flex-col justify-center min-w-0">
                  <h1 className="font-extrabold text-[13px] tracking-tight text-white uppercase leading-tight whitespace-nowrap">
                    {restaurantName}
                  </h1>
                  <span className="text-[11px] font-bold uppercase tracking-wider mt-0.5 gold-text-shine">
                    FAMILY RESTAURANT
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                {/* Mobile Drawer Close Button */}
                <button
                  type="button"
                  onClick={onCloseMobile}
                  className="md:hidden w-8 h-8 rounded-lg bg-forest-900 hover:bg-forest-800 text-gold-300 border border-gold-500/30 flex items-center justify-center shrink-0"
                  title="Close Navigation"
                >
                  <span className="material-symbols-outlined text-base">close</span>
                </button>
              </div>
            </div>
          )}

          {/* Navigation Items */}
          <nav className={`flex flex-col gap-1.5 py-3.5 ${isDesktopCollapsed ? 'px-2 items-center' : 'px-3'}`}>
            {/* 1. Standalone Top Dashboard Item */}
            {renderNavItem(dashboardItem)}

            {/* 2. Categorized Sections */}
            {navSections.map((section, sIdx) => {
              const visibleItems = section.items.filter((it) => it.roles.includes(currentUser.role));
              if (visibleItems.length === 0) return null;

              if (isDesktopCollapsed) {
                return (
                  <div key={section.title} className="w-full flex flex-col items-center">
                    <div className="w-8 h-[1px] bg-white/[0.1] my-2" />
                    <div className="flex flex-col gap-1.5">
                      {section.items.map((item) => renderNavItem(item, section.title))}
                    </div>
                  </div>
                );
              }

              return (
                <div key={section.title} className="mt-3.5 flex flex-col gap-1">
                  {/* Category Section Header with Radiant Gold Typography */}
                  <div className="px-3.5 pt-2 pb-1 select-none flex items-center justify-between">
                    <span className="text-xs font-extrabold tracking-widest uppercase text-transparent bg-clip-text bg-gradient-to-r from-gold-300 via-gold-100 to-gold-400 drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]">
                      {section.title}
                    </span>
                  </div>
                  {/* Category Items */}
                  <div className="flex flex-col gap-1">
                    {section.items.map((item) => renderNavItem(item))}
                  </div>
                </div>
              );
            })}
          </nav>

          {/* User Profile & Logout Footer */}
          <div className={`mt-auto p-3 border-t border-white/[0.08] ${isDesktopCollapsed ? 'flex flex-col items-center gap-2' : ''}`}>
            {isDesktopCollapsed ? (
              <button
                type="button"
                onClick={onLogout}
                className="w-10 h-10 rounded-xl bg-forest-900/80 hover:bg-rose-950/80 text-rose-300 border border-white/10 hover:border-rose-500/30 flex items-center justify-center transition-all shadow-sm group relative"
                title={`Logout (${currentUser.name})`}
              >
                <span className="material-symbols-outlined text-lg">logout</span>
                <span className="absolute left-full ml-2 px-2.5 py-1 rounded-lg bg-forest-950 text-rose-300 text-xs font-semibold whitespace-nowrap shadow-md border border-white/10 opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50">
                  Logout
                </span>
              </button>
            ) : (
              <div className="flex items-center justify-between gap-2 p-2 rounded-xl bg-forest-900/60 border border-white/10">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-300 font-bold flex items-center justify-center text-xs shrink-0 border border-emerald-500/30">
                    {currentUser.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-white truncate leading-tight">
                      {currentUser.name}
                    </p>
                    <span className="text-[10px] font-semibold text-gold-300/80 capitalize">
                      {currentUser.role}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onLogout}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-rose-300 hover:bg-rose-950/60 transition-colors shrink-0"
                  title="Logout"
                >
                  <span className="material-symbols-outlined text-lg">logout</span>
                </button>
              </div>
            )}
          </div>
        </div>

      </aside>
    </>
  );
};
