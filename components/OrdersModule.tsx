'use client';

import React, { useState, useEffect, useRef } from 'react';
import { DatabaseSchema, Order, User, KitchenStage, RestaurantTable, MenuItem } from '../lib/types';

interface OrdersModuleProps {
  db: DatabaseSchema;
  currentUser: User;
  onUpdateOrderStage: (orderId: string, stage: KitchenStage) => Promise<any>;
  onNavigateToTable?: (tableId: string) => void;
  onRefreshData?: () => void;
  onOpenOrderAlerts?: () => void;
  orderAlertsCount?: number;
  onUpdateMenuItem?: (itemId: string, updates: any) => Promise<any>;
}

// ============================================================================
// AUDIO SYSTEM FOR KITCHEN SOUND ALERTS (Web Audio API)
// ============================================================================
class KitchenAudioAlerts {
  private static ctx: AudioContext | null = null;
  public static soundEnabled: boolean = true;

  private static getCtx(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) this.ctx = new AudioCtx();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  // 2-tone bright ding when accepted (50%)
  static playAcceptChime() {
    if (!this.soundEnabled) return;
    const ctx = this.getCtx();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      [
        { freq: 523.25, time: 0, dur: 0.18 }, // C5
        { freq: 659.25, time: 0.12, dur: 0.28 }, // E5
      ].forEach(({ freq, time, dur }) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now + time);
        gain.gain.setValueAtTime(0.25, now + time);
        gain.gain.exponentialRampToValueAtTime(0.001, now + time + dur);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + time);
        osc.stop(now + time + dur);
      });
    } catch {}
  }

  // 4-tone celebration ready fanfare (100%)
  static playReadyChime() {
    if (!this.soundEnabled) return;
    const ctx = this.getCtx();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      [
        { freq: 523.25, time: 0, dur: 0.14 }, // C5
        { freq: 659.25, time: 0.11, dur: 0.16 }, // E5
        { freq: 783.99, time: 0.22, dur: 0.25 }, // G5
        { freq: 1046.50, time: 0.35, dur: 0.45 }, // C6
      ].forEach(({ freq, time, dur }) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + time);
        gain.gain.setValueAtTime(0.3, now + time);
        gain.gain.exponentialRampToValueAtTime(0.001, now + time + dur);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + time);
        osc.stop(now + time + dur);
      });
    } catch {}
  }

  // Double ding for incoming ticket
  static playNewOrderChime() {
    if (!this.soundEnabled) return;
    const ctx = this.getCtx();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      [
        { freq: 880, time: 0, dur: 0.15 },
        { freq: 880, time: 0.2, dur: 0.3 },
      ].forEach(({ freq, time, dur }) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + time);
        gain.gain.setValueAtTime(0.2, now + time);
        gain.gain.exponentialRampToValueAtTime(0.001, now + time + dur);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + time);
        osc.stop(now + time + dur);
      });
    } catch {}
  }
}

// ============================================================================
// HIGH-PERFORMANCE TACTILE SWIPE COMPONENT
// ============================================================================
// HIGH-PERFORMANCE TACTILE FULL-SWIPE COMPONENT
// ============================================================================
// Stage 1 (Pending): Full Swipe (0% -> 100%) = Accept Order & Start Cooking
// Stage 2 (Accepted): Full Swipe (0% -> 100%) = Mark Food Ready for Waiter Pickup
// ============================================================================
const KitchenSwipeBar: React.FC<{
  order: Order;
  onUpdateStage: (orderId: string, stage: KitchenStage) => Promise<any>;
}> = ({ order, onUpdateStage }) => {
  const stage = order.kitchenStage || (order.status === 'preparing' ? 'accepted' : order.status === 'ready_for_pickup' ? 'ready' : 'pending');

  const getStageBasePercent = () => {
    if (stage === 'ready' || stage === 'served') return 100;
    return 0;
  };

  const [currentPercent, setCurrentPercent] = useState<number>(getStageBasePercent);
  const [isDragging, setIsDragging] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);

  // Sync when stage updates from external source or advances
  useEffect(() => {
    if (!isDragging) {
      setCurrentPercent(getStageBasePercent());
    }
  }, [stage, isDragging]);

  const handleStageChange = async (targetStage: KitchenStage) => {
    setIsUpdating(true);
    try {
      if (targetStage === 'accepted') KitchenAudioAlerts.playAcceptChime();
      if (targetStage === 'ready') KitchenAudioAlerts.playReadyChime();
      await onUpdateStage(order.id, targetStage);
    } catch (err: any) {
      alert(`Could not update order stage: ${err.message}`);
      setCurrentPercent(getStageBasePercent());
    } finally {
      setIsUpdating(false);
    }
  };

  // --------------------------------------------------------------------------
  // POINTER DRAG ENGINE (Full Swipe across 0% to 100%)
  // --------------------------------------------------------------------------
  const calculatePercentFromPointer = (clientX: number): number => {
    if (!trackRef.current) return currentPercent;
    const rect = trackRef.current.getBoundingClientRect();
    const rawX = clientX - rect.left;
    const clampedX = Math.max(0, Math.min(rect.width, rawX));
    return Math.round((clampedX / rect.width) * 100);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (stage === 'ready' || stage === 'served' || isUpdating) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}
    setIsDragging(true);
    const pct = calculatePercentFromPointer(e.clientX);
    setCurrentPercent(pct);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    const pct = calculatePercentFromPointer(e.clientX);
    setCurrentPercent(pct);
  };

  const SWIPE_THRESHOLD = 75; // 75% swipe required to complete action

  const handlePointerUp = async (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    setIsDragging(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}

    const pct = calculatePercentFromPointer(e.clientX);

    if (stage === 'pending') {
      if (pct >= SWIPE_THRESHOLD) {
        setCurrentPercent(100);
        await handleStageChange('accepted');
      } else {
        setCurrentPercent(0);
      }
    } else if (stage === 'accepted') {
      if (pct >= SWIPE_THRESHOLD) {
        setCurrentPercent(100);
        await handleStageChange('ready');
      } else {
        setCurrentPercent(0);
      }
    }
  };

  // Helper flags for visual threshold feedback
  const isThresholdReached = currentPercent >= SWIPE_THRESHOLD;

  return (
    <div className="flex flex-col gap-2 pt-2 border-t border-slate-100">
      {/* Visual Draggable Track */}
      <div
        ref={trackRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        style={{ touchAction: 'none' }}
        className={`relative h-14 rounded-2xl select-none overflow-hidden cursor-grab active:cursor-grabbing border shadow-inner transition-colors duration-200 ${
          stage === 'served'
            ? 'bg-slate-800 border-slate-700 text-slate-200'
            : stage === 'ready'
            ? 'bg-emerald-600 border-emerald-500 text-white'
            : 'bg-slate-900 border-slate-800 text-white'
        }`}
      >
        {/* Dynamic Full Progress Fill */}
        {stage !== 'ready' && stage !== 'served' && (
          <div
            className={`absolute top-0 bottom-0 left-0 pointer-events-none transition-all duration-75 ${
              stage === 'accepted'
                ? isThresholdReached
                  ? 'bg-gradient-to-r from-emerald-600 via-emerald-500 to-teal-400'
                  : 'bg-gradient-to-r from-slate-700 to-emerald-600/80'
                : isThresholdReached
                ? 'bg-gradient-to-r from-amber-600 via-amber-500 to-gold-400'
                : 'bg-gradient-to-r from-slate-700 to-amber-600/80'
            }`}
            style={{ width: `${currentPercent}%` }}
          />
        )}

        {/* Target Goalpost Marker (During Swiping Only) */}
        {stage !== 'ready' && stage !== 'served' && (
          <div className="absolute right-2 top-0 bottom-0 flex items-center pointer-events-none z-10">
            <span
              className={`text-[9px] font-black uppercase tracking-wider px-2.5 py-1 rounded-full shadow-md ${
                isThresholdReached
                  ? stage === 'accepted'
                    ? 'bg-emerald-400 text-slate-950 animate-pulse font-black'
                    : 'bg-amber-400 text-slate-950 animate-pulse font-black'
                  : 'bg-slate-800 text-slate-300'
              }`}
            >
              {stage === 'accepted' ? 'Ready' : 'Accept'}
            </span>
          </div>
        )}

        {/* Center Track Prompt Text */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-0 px-4">
          {stage === 'pending' && (
            <div className="flex items-center gap-1.5 text-xs font-black tracking-wide text-white drop-shadow">
              {isThresholdReached ? (
                <span className="text-amber-300 flex items-center gap-1 animate-bounce">
                  <span className="material-symbols-outlined text-sm">check_circle</span>
                  RELEASE TO ACCEPT &amp; COOK!
                </span>
              ) : (
                <span className="flex items-center gap-1.5 opacity-90">
                  <span className="material-symbols-outlined text-sm animate-pulse text-amber-400">
                    swipe_right
                  </span>
                  SWIPE FULL TO ACCEPT ORDER ➔
                </span>
              )}
            </div>
          )}

          {stage === 'accepted' && (
            <div className="flex items-center gap-1.5 text-xs font-black tracking-wide text-white drop-shadow">
              {isThresholdReached ? (
                <span className="text-emerald-300 flex items-center gap-1 animate-bounce">
                  <span className="material-symbols-outlined text-sm">notifications_active</span>
                  RELEASE: FOOD READY FOR PICKUP!
                </span>
              ) : (
                <span className="flex items-center gap-1.5 opacity-90">
                  <span className="material-symbols-outlined text-sm animate-pulse text-emerald-400">
                    double_arrow
                  </span>
                  SWIPE FULL WHEN FOOD IS READY ➔
                </span>
              )}
            </div>
          )}

          {(stage === 'ready' || stage === 'served') && (
            <div className="flex items-center justify-center gap-1.5 text-xs sm:text-sm font-black text-white px-2 tracking-wide whitespace-nowrap">
              <span className="material-symbols-outlined text-lg text-emerald-200">
                {stage === 'served' ? 'done_all' : 'check_circle'}
              </span>
              <span>
                {stage === 'served'
                  ? 'COLLECTED BY WAITER • SERVED'
                  : '100% FOOD READY • NOTIFIED WAITER'}
              </span>
            </div>
          )}
        </div>

        {/* Draggable Thumb Knob */}
        {stage !== 'ready' && stage !== 'served' && (
          <div
            className={`absolute top-1 bottom-1 w-13 rounded-xl shadow-2xl flex items-center justify-center pointer-events-none transition-transform duration-75 z-20 ${
              stage === 'accepted'
                ? isThresholdReached
                  ? 'bg-emerald-400 text-slate-950 ring-4 ring-emerald-400/50 scale-105'
                  : 'bg-gradient-to-br from-emerald-400 to-emerald-500 text-slate-950 ring-2 ring-white/50'
                : isThresholdReached
                ? 'bg-amber-400 text-slate-950 ring-4 ring-amber-400/50 scale-105'
                : 'bg-white text-slate-900 shadow-xl ring-2 ring-slate-400/30'
            }`}
            style={{
              left: `calc(${currentPercent}% - ${(currentPercent / 100) * 52}px)`,
            }}
          >
            <span className="material-symbols-outlined text-xl font-bold">
              {isThresholdReached ? 'check' : 'arrow_forward'}
            </span>
          </div>
        )}
      </div>

      {/* Stage Status & Secondary Controls */}
      {stage === 'accepted' && (
        <div className="flex items-center justify-between text-xs pt-0.5">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping" />
            <span className="text-xs font-bold text-amber-700">Cooking in progress...</span>
            <button
              type="button"
              onClick={() => handleStageChange('pending')}
              disabled={isUpdating}
              className="text-[10px] text-slate-400 hover:text-slate-600 font-semibold underline ml-1"
              title="Revert back to Incoming"
            >
              Undo
            </button>
          </div>
          <span className="text-[11px] text-slate-400 font-medium">Full swipe to complete</span>
        </div>
      )}

      {(stage === 'ready' || stage === 'served') && (
        <div className="w-full flex items-center justify-between gap-2 pt-0.5">
          <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-700 min-w-0">
            <span className="material-symbols-outlined text-sm animate-pulse shrink-0">check_circle</span>
            <span className="truncate">{stage === 'served' ? 'Food served to table' : 'Food plated'}</span>
            <button
              type="button"
              onClick={() => handleStageChange('accepted')}
              disabled={isUpdating}
              className="text-[10px] text-slate-400 hover:text-slate-600 font-semibold underline shrink-0 ml-1"
              title="Revert back to Cooking"
            >
              Undo
            </button>
          </div>
          {stage === 'ready' ? (
            <button
              type="button"
              onClick={() => handleStageChange('served')}
              disabled={isUpdating}
              className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black transition-all shrink-0 shadow-apple-subtle active:scale-95"
            >
              ✓ Collected by waiter
            </button>
          ) : (
            <div className="px-2.5 py-1 rounded-xl bg-slate-100 text-slate-600 text-xs font-bold flex items-center gap-1 shrink-0">
              <span className="material-symbols-outlined text-sm text-emerald-600">done_all</span>
              <span>Collected by waiter</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ============================================================================
// MAIN ORDERS & KITCHEN DISPLAY SYSTEM (KDS) MODULE
// ============================================================================
export const OrdersModule: React.FC<OrdersModuleProps> = ({
  db,
  currentUser,
  onUpdateOrderStage,
  onNavigateToTable,
  onRefreshData,
  onOpenOrderAlerts,
  orderAlertsCount = 0,
  onUpdateMenuItem,
}) => {
  const [filterStage, setFilterStage] = useState<'all' | 'pending' | 'accepted' | 'ready' | 'history'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sectionFilter, setSectionFilter] = useState('all');
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [currentTime, setCurrentTime] = useState<string>('');
  const [isKioskMode, setIsKioskMode] = useState<boolean>(false);
  
  // Kitchen Menu Availability & 86 Drawer State
  const [showAvailabilityDrawer, setShowAvailabilityDrawer] = useState<boolean>(false);
  const [availSearchQuery, setAvailSearchQuery] = useState<string>('');
  const [availCategoryFilter, setAvailCategoryFilter] = useState<string>('all');
  const [availStatusFilter, setAvailStatusFilter] = useState<'all' | 'unavailable' | 'available'>('all');
  const [togglingItemId, setTogglingItemId] = useState<string | null>(null);
  const [toastNotification, setToastNotification] = useState<string | null>(null);

  // Local state for checking off individual items on the ticket
  const [checkedItemMap, setCheckedItemMap] = useState<Record<string, boolean>>({});

  // Clock ticker & background polling
  useEffect(() => {
    const updateTime = () => {
      setCurrentTime(
        new Date().toLocaleTimeString('en-IN', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: true,
        })
      );
    };
    updateTime();
    const timer = setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  }, []);

  // Background auto-refresh polling every 3.5 seconds
  useEffect(() => {
    if (!onRefreshData) return;
    const pollInterval = setInterval(() => {
      onRefreshData();
    }, 3500);
    return () => clearInterval(pollInterval);
  }, [onRefreshData]);

  const toggleItemChecked = (itemId: string) => {
    setCheckedItemMap((prev) => ({ ...prev, [itemId]: !prev[itemId] }));
  };

  const handleToggleSound = () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    KitchenAudioAlerts.soundEnabled = next;
    if (next) KitchenAudioAlerts.playAcceptChime();
  };

  // Compute live active orders
  const activeOrders = db.orders.filter(
    (o) =>
      o.status !== 'settled' &&
      o.status !== 'cancelled' &&
      o.status !== 'served' &&
      o.status !== 'billed'
  );

  // Stats counters
  const pendingOrders = activeOrders.filter((o) => (o.kitchenStage || 'pending') === 'pending');
  const acceptedOrders = activeOrders.filter((o) => o.kitchenStage === 'accepted');
  const readyOrders = activeOrders.filter((o) => o.kitchenStage === 'ready');
  const servedOrders = activeOrders.filter((o) => o.kitchenStage === 'served');

  // Sound chime when a new incoming order appears
  const prevPendingCountRef = useRef(pendingOrders.length);
  useEffect(() => {
    if (pendingOrders.length > prevPendingCountRef.current) {
      KitchenAudioAlerts.playNewOrderChime();
    }
    prevPendingCountRef.current = pendingOrders.length;
  }, [pendingOrders.length]);

  // Filtered orders list
  const filteredOrders = activeOrders.filter((order) => {
    const currentStage = order.kitchenStage || 'pending';

    if (filterStage === 'pending' && currentStage !== 'pending') return false;
    if (filterStage === 'accepted' && currentStage !== 'accepted') return false;
    if (filterStage === 'ready' && currentStage !== 'ready') return false;
    if (filterStage === 'history' && currentStage !== 'served') return false;
    if (filterStage === 'all' && currentStage === 'served') return false; // Hide archived served in all live

    if (sectionFilter !== 'all') {
      const tbl = db.tables.find((t) => t.id === order.tableId);
      if (tbl && tbl.section !== sectionFilter) return false;
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchTable = order.tableNumber.toLowerCase().includes(q);
      const matchOrder = order.orderNumber.toLowerCase().includes(q);
      const matchSteward = order.stewardName.toLowerCase().includes(q);
      const matchDish = order.items.some((it) => it.name.toLowerCase().includes(q));
      if (!matchTable && !matchOrder && !matchSteward && !matchDish) return false;
    }

    return true;
  });

  // Calculate elapsed time from createdAt
  const getElapsedMinutes = (dateStr: string) => {
    try {
      const diffMs = Date.now() - new Date(dateStr).getTime();
      const mins = Math.floor(diffMs / (1000 * 60));
      return mins < 0 ? 0 : mins;
    } catch {
      return 1;
    }
  };

  // Kitchen Menu Availability & Out of Stock Item Counts
  const unavailableCount = db.menuItems.filter((m) => m.isAvailable === false).length;
  const availableCount = db.menuItems.length - unavailableCount;

  // Toggle single item Out of Stock status
  const handleToggleItemAvailability = async (item: MenuItem) => {
    if (!onUpdateMenuItem) return;
    const nextAvailable = item.isAvailable === false ? true : false;
    setTogglingItemId(item.id);
    try {
      await onUpdateMenuItem(item.id, { isAvailable: nextAvailable });
      if (soundEnabled) {
        if (!nextAvailable) KitchenAudioAlerts.playAcceptChime();
        else KitchenAudioAlerts.playReadyChime();
      }
      setToastNotification(
        nextAvailable
          ? `✓ "${item.name}" restored to In Stock`
          : `⚠️ "${item.name}" marked as Out of Stock`
      );
      setTimeout(() => setToastNotification(null), 3000);
    } catch (err: any) {
      alert(`Failed to update item availability: ${err.message}`);
    } finally {
      setTogglingItemId(null);
    }
  };

  // Bulk restore all Out of Stock items back to In Stock
  const handleRestoreAllItems = async () => {
    if (!onUpdateMenuItem) return;
    const unavailableItems = db.menuItems.filter((m) => m.isAvailable === false);
    if (unavailableItems.length === 0) return;
    if (!confirm(`Restore all ${unavailableItems.length} Out of Stock dishes back to "In Stock"?`)) return;
    for (const it of unavailableItems) {
      await onUpdateMenuItem(it.id, { isAvailable: true });
    }
    setToastNotification(`✓ Restored all ${unavailableItems.length} dishes to In Stock`);
    setTimeout(() => setToastNotification(null), 3500);
  };

  // Filtered menu items for the availability drawer
  const filteredMenuItems = db.menuItems.filter((item) => {
    if (availCategoryFilter !== 'all' && item.categoryId !== availCategoryFilter) return false;
    if (availStatusFilter === 'unavailable' && item.isAvailable !== false) return false;
    if (availStatusFilter === 'available' && item.isAvailable === false) return false;
    if (availSearchQuery.trim()) {
      const q = availSearchQuery.toLowerCase();
      const matchName = item.name.toLowerCase().includes(q);
      const matchDesc = item.description?.toLowerCase().includes(q);
      if (!matchName && !matchDesc) return false;
    }
    return true;
  });

  return (
    <div className={isKioskMode ? "fixed inset-0 z-50 bg-[#021812] p-4 sm:p-6 overflow-y-auto space-y-4" : "p-3.5 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-5 sm:space-y-6"}>
      {/* 1. High-Visibility Kitchen Radar Header Banner */}
      <div className="bg-gradient-to-r from-forest-950 via-forest-900 to-forest-950 text-white p-5 sm:p-6 rounded-apple-xl shadow-apple-card border border-gold-500/30 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-apple bg-gradient-to-br from-gold-500 to-gold-600 flex items-center justify-center text-forest-950 font-black shadow-apple-subtle">
            <span className="material-symbols-outlined text-2xl">soup_kitchen</span>
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-xl font-bold tracking-tight text-white">
                Kitchen Display System (KDS)
              </h1>
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-gold-500/20 text-gold-300 border border-gold-500/40 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                Live Radar
              </span>
              {isKioskMode && (
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase bg-forest-800 text-gold-300 border border-gold-400/50">
                  Tablet Kiosk Mode
                </span>
              )}
            </div>
            <p className="text-xs text-slate-300 mt-1 font-medium">
              Logged in: <strong className="text-gold-400">{currentUser.name}</strong> ({currentUser.role.toUpperCase()}) • Full Swipe to Accept, Full Swipe when Ready.
            </p>
          </div>
        </div>

        {/* Realtime Clock, Kiosk Mode & Sound Toggle Controls */}
        <div className="flex items-center gap-2">
          <div className="hidden sm:flex items-center gap-2 h-9 px-3.5 rounded-apple bg-forest-900/80 border border-gold-500/30 font-mono text-xs font-semibold text-gold-300 tabular-nums">
            <span className="material-symbols-outlined text-sm text-gold-400">schedule</span>
            {currentTime || '00:00:00'}
          </div>

          {/* Fullscreen Kiosk Mode for Wall/Stand Mounted Tablets */}
          <button
            type="button"
            onClick={() => setIsKioskMode(!isKioskMode)}
            className={`h-9 px-3.5 rounded-apple font-semibold text-xs flex items-center gap-1.5 border transition-all active:scale-[0.97] ${
              isKioskMode
                ? 'bg-gold-500 text-forest-950 border-gold-400 font-bold shadow-apple-subtle'
                : 'bg-forest-900/80 border-gold-500/30 text-gold-300 hover:bg-forest-800'
            }`}
            title="Toggle Fullscreen Kiosk Mode for Wall-Mounted Tablets"
          >
            <span className="material-symbols-outlined text-base">
              {isKioskMode ? 'fullscreen_exit' : 'fullscreen'}
            </span>
            <span>{isKioskMode ? 'Exit Kiosk' : 'Tablet Kiosk'}</span>
          </button>

          {/* Kitchen Stock / Menu Availability Board */}
          <button
            type="button"
            onClick={() => setShowAvailabilityDrawer(true)}
            className={`h-9 px-3.5 rounded-apple font-semibold text-xs flex items-center gap-1.5 border transition-all active:scale-[0.97] ${
              unavailableCount > 0
                ? 'bg-rose-500/25 border-rose-500/60 text-rose-200 hover:bg-rose-500/35 font-bold shadow-apple-subtle'
                : 'bg-forest-900/80 border-gold-500/30 text-gold-300 hover:bg-forest-800'
            }`}
            title="Manage Menu Item Out of Stock / In Stock Availability"
          >
            <span className="material-symbols-outlined text-base">
              {unavailableCount > 0 ? 'do_not_disturb_on' : 'inventory_2'}
            </span>
            <span>Menu Stock</span>
            {unavailableCount > 0 ? (
              <span className="px-1.5 py-0.2 rounded-full bg-rose-600 text-white font-black text-[10px] tabular-nums animate-pulse">
                {unavailableCount} Out of Stock
              </span>
            ) : (
              <span className="text-[10px] text-emerald-400 font-bold">
                ✓ All In Stock
              </span>
            )}
          </button>

          <button
            onClick={handleToggleSound}
            className={`h-9 px-3.5 rounded-apple font-semibold text-xs flex items-center gap-1.5 border transition-all active:scale-[0.97] ${
              soundEnabled
                ? 'bg-gold-500/20 border-gold-500/40 text-gold-300 hover:bg-gold-500/30'
                : 'bg-forest-900/80 border-forest-800 text-slate-400 hover:text-white'
            }`}
            title="Toggle Kitchen Sound Chimes"
          >
            <span className="material-symbols-outlined text-base">
              {soundEnabled ? 'volume_up' : 'volume_off'}
            </span>
            <span>{soundEnabled ? 'Sound ON' : 'Muted'}</span>
          </button>

          {onOpenOrderAlerts && (
            <button
              onClick={onOpenOrderAlerts}
              className={`h-9 px-3.5 rounded-apple font-semibold text-xs flex items-center gap-1.5 border transition-all active:scale-[0.97] ${
                orderAlertsCount > 0
                  ? 'bg-rose-500/20 border-rose-500/50 text-rose-300 hover:bg-rose-500/30 animate-pulse'
                  : 'bg-forest-900/80 border-gold-500/30 text-slate-300 hover:text-white'
              }`}
              title="Open Waiter Order Alerts & Kitchen Notifications"
            >
              <span className="material-symbols-outlined text-base">
                {orderAlertsCount > 0 ? 'notifications_active' : 'notifications'}
              </span>
              <span>Order Alerts</span>
              {orderAlertsCount > 0 && (
                <span className="px-1.5 py-0.2 rounded-full bg-rose-500 text-white font-bold text-[10px] tabular-nums">
                  {orderAlertsCount}
                </span>
              )}
            </button>
          )}

          {onRefreshData && (
            <button
              onClick={onRefreshData}
              className="w-9 h-9 flex items-center justify-center rounded-apple bg-forest-900/80 hover:bg-forest-800 text-gold-300 hover:text-white border border-gold-500/30 transition-all active:scale-[0.97]"
              title="Refresh Orders Now"
            >
              <span className="material-symbols-outlined text-base">refresh</span>
            </button>
          )}
        </div>
      </div>

      {/* 2. Live Queue Metric Counters */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
        <div
          onClick={() => setFilterStage('pending')}
          className={`cursor-pointer p-4 rounded-[22px] transition-all active:scale-[0.98] ${
            filterStage === 'pending'
              ? 'ios27-glass-card border-rose-400/60 ring-2 ring-rose-500/30 shadow-apple-card'
              : 'ios27-glass-card hover:border-rose-300/60'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase text-rose-600 tracking-wider">
              1. Incoming
            </span>
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-ping" />
          </div>
          <div className="mt-2.5 flex items-baseline justify-between">
            <span className="text-3xl font-bold tracking-tight text-slate-900 tabular-nums">{pendingOrders.length}</span>
            <span className="text-[11px] text-slate-500 font-medium">Swipe to Accept</span>
          </div>
        </div>

        <div
          onClick={() => setFilterStage('accepted')}
          className={`cursor-pointer p-4 rounded-[22px] transition-all active:scale-[0.98] ${
            filterStage === 'accepted'
              ? 'ios27-glass-card border-amber-400/60 ring-2 ring-amber-500/30 shadow-apple-card'
              : 'ios27-glass-card hover:border-amber-300/60'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase text-amber-600 tracking-wider">
              2. In Prep (Cooking)
            </span>
            <span className="material-symbols-outlined text-amber-600 text-lg">skillet</span>
          </div>
          <div className="mt-2.5 flex items-baseline justify-between">
            <span className="text-3xl font-bold tracking-tight text-slate-900 tabular-nums">{acceptedOrders.length}</span>
            <span className="text-[11px] text-slate-500 font-medium">Swipe when Ready</span>
          </div>
        </div>

        <div
          onClick={() => setFilterStage('ready')}
          className={`cursor-pointer p-4 rounded-[22px] transition-all active:scale-[0.98] ${
            filterStage === 'ready'
              ? 'ios27-glass-card border-emerald-400/60 ring-2 ring-emerald-500/30 shadow-apple-card'
              : 'ios27-glass-card hover:border-emerald-300/60'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase text-emerald-600 tracking-wider">
              3. Food Ready
            </span>
            <span className="material-symbols-outlined text-emerald-600 text-lg animate-pulse">
              notifications_active
            </span>
          </div>
          <div className="mt-2.5 flex items-baseline justify-between">
            <span className="text-3xl font-bold tracking-tight text-slate-900 tabular-nums">{readyOrders.length}</span>
            <span className="text-[11px] text-slate-500 font-medium">Waiter Alerted</span>
          </div>
        </div>

        <div
          onClick={() => setFilterStage('all')}
          className={`cursor-pointer p-4 rounded-[22px] transition-all active:scale-[0.98] ${
            filterStage === 'all'
              ? 'ios27-glass-dark text-gold-300 border-gold-400/40 shadow-apple-card ring-2 ring-gold-400/20'
              : 'ios27-glass-card hover:border-gold-300/60'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className={`text-[11px] font-bold uppercase tracking-wider ${filterStage === 'all' ? 'text-gold-300' : 'text-slate-600'}`}>
              Total Active
            </span>
            <span className="material-symbols-outlined text-lg">receipt_long</span>
          </div>
          <div className="mt-2.5 flex items-baseline justify-between">
            <span className={`text-3xl font-bold tracking-tight tabular-nums ${filterStage === 'all' ? 'text-gold-300' : 'text-slate-900'}`}>
              {activeOrders.filter((o) => o.kitchenStage !== 'served').length}
            </span>
            <span className={`text-[11px] font-medium ${filterStage === 'all' ? 'text-gold-400/80' : 'text-slate-500'}`}>
              Active Tickets
            </span>
          </div>
        </div>
      </div>

      {/* 3. Stage Filters & Search Bar */}
      <div className="ios27-glass-card p-3.5 sm:p-4 rounded-[22px] flex flex-wrap items-center justify-between gap-3 text-xs">
        {/* Stage Filter Buttons - Apple Segmented Control */}
        <div className="flex items-center gap-1 bg-black/[0.05] p-1 rounded-apple overflow-x-auto max-w-full">
          <button
            onClick={() => setFilterStage('all')}
            className={`px-3 py-1.5 rounded-apple-sm font-semibold whitespace-nowrap transition-all active:scale-[0.97] ${
              filterStage === 'all'
                ? 'bg-[#05271f] text-gold-300 shadow-apple-subtle'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            All Live ({activeOrders.filter((o) => o.kitchenStage !== 'served').length})
          </button>

          <button
            onClick={() => setFilterStage('pending')}
            className={`px-3 py-1.5 rounded-apple-sm font-semibold whitespace-nowrap transition-all flex items-center gap-1.5 active:scale-[0.97] ${
              filterStage === 'pending'
                ? 'bg-rose-600 text-white shadow-apple-subtle'
                : 'text-rose-700 hover:bg-rose-50'
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
            Incoming ({pendingOrders.length})
          </button>

          <button
            onClick={() => setFilterStage('accepted')}
            className={`px-3 py-1.5 rounded-apple-sm font-semibold whitespace-nowrap transition-all flex items-center gap-1.5 active:scale-[0.97] ${
              filterStage === 'accepted'
                ? 'bg-amber-500 text-slate-950 font-bold shadow-apple-subtle'
                : 'text-amber-700 hover:bg-amber-50'
            }`}
          >
            <span className="material-symbols-outlined text-xs">skillet</span>
            Cooking ({acceptedOrders.length})
          </button>

          <button
            onClick={() => setFilterStage('ready')}
            className={`px-3 py-1.5 rounded-apple-sm font-semibold whitespace-nowrap transition-all flex items-center gap-1.5 active:scale-[0.97] ${
              filterStage === 'ready'
                ? 'bg-emerald-600 text-white shadow-apple-subtle'
                : 'text-emerald-700 hover:bg-emerald-50'
            }`}
          >
            <span className="material-symbols-outlined text-xs">notifications_active</span>
            Food Ready ({readyOrders.length})
          </button>

          <button
            onClick={() => setFilterStage('history')}
            className={`px-3 py-1.5 rounded-apple-sm font-semibold whitespace-nowrap transition-all flex items-center gap-1.5 active:scale-[0.97] ${
              filterStage === 'history'
                ? 'bg-slate-800 text-white shadow-apple-subtle'
                : 'text-slate-600 hover:bg-black/[0.04]'
            }`}
          >
            <span className="material-symbols-outlined text-xs">history</span>
            History ({servedOrders.length})
          </button>
        </div>

        {/* Search & Section Filter */}
        <div className="flex items-center gap-2">
          <div className="relative">
            <span className="material-symbols-outlined absolute left-3 top-2.5 text-slate-400 text-sm">
              search
            </span>
            <input
              type="text"
              placeholder="Search table, dish, KOT..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-9 pl-8 pr-3 text-xs rounded-apple bg-black/[0.04] border border-black/[0.06] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#05271f]/10 w-48 sm:w-60 font-medium transition-all"
            />
          </div>

          <select
            value={sectionFilter}
            onChange={(e) => setSectionFilter(e.target.value)}
            className="h-9 px-3 rounded-apple bg-black/[0.04] border border-black/[0.06] text-xs font-semibold text-slate-700 focus:outline-none focus:bg-white"
          >
            <option value="all">All Sections</option>
            <option value="AC Grand Hall">AC Grand Hall</option>
            <option value="Royal Family Suite">Royal Family Suite</option>
            <option value="Garden Patio">Garden Patio</option>
          </select>
        </div>
      </div>

      {/* 4. Kitchen Order Ticket Grid */}
      {filteredOrders.length === 0 ? (
        <div className="ios27-glass-card p-16 rounded-[24px] text-center flex flex-col items-center justify-center gap-3">
          <div className="w-16 h-16 rounded-apple bg-black/[0.04] flex items-center justify-center text-slate-400 border border-black/[0.05]">
            <span className="material-symbols-outlined text-3xl">soup_kitchen</span>
          </div>
          <h3 className="text-base font-bold text-slate-900 tracking-tight">No Orders in this Kitchen Queue</h3>
          <p className="text-xs text-slate-500 max-w-sm">
            {activeOrders.filter((o) => o.kitchenStage !== 'served').length === 0
              ? 'When a steward clicks "Send Order to Kitchen" in Billing & POS, tickets appear here instantly.'
              : 'Try selecting "All Live" above to view active kitchen orders.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredOrders.map((order) => {
            const currentStage = order.kitchenStage || 'pending';
            const table = db.tables.find((t) => t.id === order.tableId);
            const elapsed = getElapsedMinutes(order.createdAt);
            const isUrgent = elapsed > 20 && currentStage !== 'ready' && currentStage !== 'served';

            return (
              <div
                key={order.id}
                className={`ios27-glass-card rounded-[22px] shadow-apple-card flex flex-col justify-between overflow-hidden transition-all hover:scale-[1.01] ${
                  currentStage === 'ready'
                    ? 'border-emerald-400 ring-2 ring-emerald-500/20'
                    : currentStage === 'accepted'
                    ? 'border-amber-400 ring-1 ring-amber-400/20'
                    : currentStage === 'served'
                    ? 'border-black/[0.08] opacity-75'
                    : 'border-rose-300 ring-1 ring-rose-400/20'
                }`}
              >
                {/* Order Ticket Header - Redesigned for High Clarity */}
                <div
                  className={`p-3.5 sm:p-4 border-b flex items-center justify-between gap-2.5 transition-colors ${
                    currentStage === 'ready'
                      ? 'bg-emerald-50/80 border-emerald-100'
                      : currentStage === 'accepted'
                      ? 'bg-amber-50/80 border-amber-100'
                      : currentStage === 'served'
                      ? 'bg-slate-50 border-black/[0.06]'
                      : 'bg-rose-50/80 border-rose-100'
                  }`}
                >
                  {/* Left: Table Emblem & KOT / Section Metadata */}
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    {/* High-visibility Table Indicator */}
                    <div
                      onClick={() => onNavigateToTable?.(order.tableId)}
                      role={onNavigateToTable ? 'button' : undefined}
                      tabIndex={onNavigateToTable ? 0 : undefined}
                      title={onNavigateToTable ? `View billing for Table ${order.tableNumber}` : undefined}
                      className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 shadow-apple-subtle text-white transition-all ${
                        onNavigateToTable ? 'cursor-pointer hover:scale-105 active:scale-95' : ''
                      } ${
                        currentStage === 'ready'
                          ? 'bg-gradient-to-br from-emerald-500 to-emerald-700 ring-2 ring-emerald-400/50'
                          : currentStage === 'accepted'
                          ? 'bg-gradient-to-br from-amber-400 to-amber-600 text-slate-950 font-black ring-2 ring-amber-400/50'
                          : currentStage === 'served'
                          ? 'bg-slate-700'
                          : 'bg-gradient-to-br from-rose-500 to-rose-700 ring-2 ring-rose-400/50'
                      }`}
                    >
                      <span className="text-base font-black tracking-tight leading-none">
                        {order.tableNumber}
                      </span>
                    </div>

                    {/* Ticket Identity & Dining Details */}
                    <div className="flex flex-col min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {/* Section & Capacity Tag */}
                        <span className="text-[11px] font-semibold text-slate-700 bg-white/90 border border-slate-200/90 px-2 py-0.5 rounded-lg flex items-center gap-1 shadow-2xs truncate">
                          <span className="material-symbols-outlined text-[13px] text-slate-500 shrink-0">table_restaurant</span>
                          <span className="truncate">{table?.section || 'Floor'}</span>
                          <span className="text-slate-400 font-normal">({table?.capacity || 4}p)</span>
                        </span>
                      </div>

                      {/* Steward Attribution */}
                      <div className="flex items-center gap-1.5 mt-1 text-xs text-slate-600 font-medium truncate">
                        <span className="material-symbols-outlined text-[14px] text-emerald-600 shrink-0">person</span>
                        <span className="truncate">Steward: <strong className="text-slate-900 font-bold">{order.stewardName}</strong></span>
                      </div>
                    </div>
                  </div>

                  {/* Right: Stage Badge & Elapsed Timer */}
                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    {/* Prominent Stage Status Pill */}
                    <span
                      className={`px-2.5 py-1 rounded-xl text-[11px] font-black uppercase tracking-wider flex items-center gap-1.5 shadow-sm ${
                        currentStage === 'ready'
                          ? 'bg-emerald-600 text-white animate-pulse ring-2 ring-emerald-500/30'
                          : currentStage === 'accepted'
                          ? 'bg-amber-400 text-slate-950 ring-2 ring-amber-400/40'
                          : currentStage === 'served'
                          ? 'bg-slate-700 text-white'
                          : 'bg-rose-500 text-white ring-2 ring-rose-400/30'
                      }`}
                    >
                      <span className="material-symbols-outlined text-[14px]">
                        {currentStage === 'ready'
                          ? 'notifications_active'
                          : currentStage === 'accepted'
                          ? 'skillet'
                          : currentStage === 'served'
                          ? 'check_circle'
                          : 'bolt'}
                      </span>
                      <span>
                        {currentStage === 'ready'
                          ? 'FOOD READY'
                          : currentStage === 'accepted'
                          ? 'COOKING'
                          : currentStage === 'served'
                          ? 'SERVED'
                          : 'NEW ORDER'}
                      </span>
                    </span>

                    {/* Elapsed Time Pill */}
                    <span
                      className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-lg flex items-center gap-1 shadow-2xs ${
                        isUrgent
                          ? 'bg-rose-600 text-white animate-pulse font-black'
                          : elapsed > 10
                          ? 'bg-amber-100 text-amber-900 border border-amber-300 font-bold'
                          : 'bg-white/80 text-slate-700 border border-slate-200 font-semibold'
                      }`}
                    >
                      <span className="material-symbols-outlined text-[12px] opacity-75">timer</span>
                      <span>{elapsed}m ago</span>
                    </span>
                  </div>
                </div>

                {/* Items List with Interactive Plating Checklist */}
                <div className="p-4 flex-1 space-y-2 text-xs max-h-72 overflow-y-auto">
                  <div className="flex items-center justify-between text-[10px] font-bold text-slate-400 pb-1 border-b border-slate-100">
                    <span>DISH &amp; QUANTITY (Tap to check off)</span>
                    <span>TIME</span>
                  </div>

                  {order.items.map((item, idx) => {
                    const isChecked = !!checkedItemMap[item.id || `${order.id}-${idx}`];

                    return (
                      <div
                        key={item.id || idx}
                        onClick={() => toggleItemChecked(item.id || `${order.id}-${idx}`)}
                        className={`flex items-start justify-between p-2.5 rounded-apple cursor-pointer transition-all border active:scale-[0.98] ${
                          isChecked
                            ? 'bg-emerald-50/50 border-emerald-200 line-through opacity-60 text-slate-400'
                            : 'bg-black/[0.02] border-black/[0.05] hover:bg-black/[0.04]'
                        }`}
                        title="Click to check off dish when plated"
                      >
                        <div className="flex items-start gap-2.5 min-w-0 flex-1">
                          <span
                            className={`w-6 h-6 rounded-apple-sm font-bold text-xs flex items-center justify-center shrink-0 transition-all tabular-nums ${
                              isChecked
                                ? 'bg-emerald-600 text-white'
                                : 'bg-[#05271f] text-gold-300'
                            }`}
                          >
                            {isChecked ? '✓' : item.quantity}
                          </span>
                          <div className="flex flex-col min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-semibold text-slate-900 text-xs truncate tracking-tight">
                                {item.name}
                              </span>
                              {onUpdateMenuItem && (() => {
                                const match = db.menuItems.find(
                                  (m) => (item.menuItemId && m.id === item.menuItemId) || m.name.toLowerCase() === item.name.toLowerCase() || m.id === item.id
                                );
                                const isSoldOut = match?.isAvailable === false;
                                return (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (match) {
                                        handleToggleItemAvailability(match);
                                      } else {
                                        alert(`Item "${item.name}" not found in catalogue.`);
                                      }
                                    }}
                                    className={`shrink-0 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase transition-all flex items-center gap-0.5 active:scale-95 ${
                                      isSoldOut
                                        ? 'bg-rose-600 text-white shadow-2xs animate-pulse'
                                        : 'bg-slate-100 hover:bg-rose-100 text-slate-500 hover:text-rose-700'
                                    }`}
                                    title={isSoldOut ? "Currently Out of Stock (Tap to restore)" : "Mark dish as Out of Stock"}
                                  >
                                    <span className="material-symbols-outlined text-[11px]">
                                      {isSoldOut ? 'do_not_disturb_on' : 'block'}
                                    </span>
                                    <span>{isSoldOut ? 'Out of Stock' : 'Mark Out'}</span>
                                  </button>
                                );
                              })()}
                            </div>
                            {item.notes && (
                              <span className="text-[10px] text-amber-800 font-semibold italic">
                                Note: {item.notes}
                              </span>
                            )}
                          </div>
                        </div>

                        <span className="text-[10px] font-mono font-bold text-slate-400 shrink-0 ml-2">
                          {item.kotTime || 'Now'}
                        </span>
                      </div>
                    );
                  })}
                </div>

                {/* Interactive Tactile Swipe Slider & Controls */}
                <div className="p-4 bg-slate-50/80 border-t border-slate-100">
                  <KitchenSwipeBar
                    order={order}
                    onUpdateStage={onUpdateOrderStage}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 4. Kitchen Stock / Menu Availability Drawer */}
      {showAvailabilityDrawer && (
        <div
          className="fixed inset-0 z-[10000] flex justify-end bg-black/60 backdrop-blur-xs transition-opacity animate-in fade-in duration-200"
          onClick={() => setShowAvailabilityDrawer(false)}
        >
          <div
            className="w-full max-w-xl h-full bg-[#031d16] text-white shadow-2xl flex flex-col border-l border-gold-500/20 overflow-hidden animate-in slide-in-from-right duration-250"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Drawer Header */}
            <div className="p-5 sm:p-6 bg-gradient-to-b from-[#021812] to-[#031d16] border-b border-gold-500/20 shrink-0">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-apple bg-gradient-to-br from-gold-500 to-gold-600 flex items-center justify-center text-forest-950 font-black shadow-apple-subtle shrink-0">
                    <span className="material-symbols-outlined text-2xl">
                      {unavailableCount > 0 ? 'do_not_disturb_on' : 'inventory_2'}
                    </span>
                  </div>
                  <div>
                    <h2 className="text-lg font-bold tracking-tight text-white flex items-center gap-2">
                      <span>Kitchen Stock &amp; Availability</span>
                    </h2>
                    <p className="text-xs text-slate-300 mt-0.5 font-medium">
                      Control dish availability in real time across Waiter POS &amp; guest menus.
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setShowAvailabilityDrawer(false)}
                  className="w-9 h-9 rounded-apple bg-forest-900 hover:bg-forest-800 text-slate-300 hover:text-white border border-gold-500/30 flex items-center justify-center transition-all active:scale-95 shrink-0"
                  title="Close Drawer"
                >
                  <span className="material-symbols-outlined text-xl">close</span>
                </button>
              </div>

              {/* Status Metric Pills & Restore Action */}
              <div className="mt-4 flex flex-wrap items-center justify-between gap-2.5 pt-3 border-t border-gold-500/20">
                <div className="flex items-center gap-2 text-xs">
                  <span className="px-2.5 py-1 rounded-full bg-forest-900 border border-gold-500/30 text-gold-300 font-bold tabular-nums">
                    {db.menuItems.length} Total
                  </span>
                  <span className="px-2.5 py-1 rounded-full bg-emerald-950/80 border border-emerald-500/40 text-emerald-300 font-bold tabular-nums">
                    {availableCount} In Stock
                  </span>
                  <span
                    className={`px-2.5 py-1 rounded-full font-bold tabular-nums flex items-center gap-1 ${
                      unavailableCount > 0
                        ? 'bg-rose-950/90 border border-rose-500/60 text-rose-300 animate-pulse'
                        : 'bg-forest-900 border border-forest-800 text-slate-400'
                    }`}
                  >
                    <span className="material-symbols-outlined text-xs">
                      {unavailableCount > 0 ? 'block' : 'check'}
                    </span>
                    {unavailableCount} Out of Stock
                  </span>
                </div>

                {unavailableCount > 0 && onUpdateMenuItem && (
                  <button
                    type="button"
                    onClick={handleRestoreAllItems}
                    className="h-8 px-3 rounded-apple text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white transition-all shadow-apple-subtle active:scale-95 flex items-center gap-1.5 shrink-0"
                    title="Mark all dishes as In Stock"
                  >
                    <span className="material-symbols-outlined text-sm">restart_alt</span>
                    <span>Restore All to Stock</span>
                  </button>
                )}
              </div>
            </div>

            {/* Search & Status Filters */}
            <div className="p-4 bg-forest-950/60 border-b border-gold-500/15 space-y-3 shrink-0">
              {/* Search Bar */}
              <div className="relative">
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-lg pointer-events-none">
                  search
                </span>
                <input
                  type="text"
                  value={availSearchQuery}
                  onChange={(e) => setAvailSearchQuery(e.target.value)}
                  placeholder="Search dishes by name or description..."
                  className="w-full h-10 pl-9 pr-9 rounded-apple bg-forest-900/90 border border-gold-500/30 text-white placeholder-slate-400 text-xs focus:outline-none focus:ring-2 focus:ring-gold-400/50"
                />
                {availSearchQuery && (
                  <button
                    type="button"
                    onClick={() => setAvailSearchQuery('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                  >
                    <span className="material-symbols-outlined text-base">close</span>
                  </button>
                )}
              </div>

              {/* Status Segmented Tabs */}
              <div className="flex items-center gap-1.5 p-1 bg-forest-900/80 rounded-apple border border-gold-500/20 text-xs">
                <button
                  type="button"
                  onClick={() => setAvailStatusFilter('all')}
                  className={`flex-1 py-1.5 rounded-lg font-semibold transition-all text-center ${
                    availStatusFilter === 'all'
                      ? 'bg-gold-500 text-forest-950 font-bold shadow-xs'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  All Dishes ({db.menuItems.length})
                </button>
                <button
                  type="button"
                  onClick={() => setAvailStatusFilter('unavailable')}
                  className={`flex-1 py-1.5 rounded-lg font-semibold transition-all text-center flex items-center justify-center gap-1 ${
                    availStatusFilter === 'unavailable'
                      ? 'bg-rose-600 text-white font-bold shadow-xs'
                      : 'text-rose-300 hover:text-rose-200'
                  }`}
                >
                  <span className="material-symbols-outlined text-xs">block</span>
                  Out of Stock ({unavailableCount})
                </button>
                <button
                  type="button"
                  onClick={() => setAvailStatusFilter('available')}
                  className={`flex-1 py-1.5 rounded-lg font-semibold transition-all text-center flex items-center justify-center gap-1 ${
                    availStatusFilter === 'available'
                      ? 'bg-emerald-600 text-white font-bold shadow-xs'
                      : 'text-emerald-300 hover:text-emerald-200'
                  }`}
                >
                  <span className="material-symbols-outlined text-xs">check_circle</span>
                  In Stock ({availableCount})
                </button>
              </div>

              {/* Category Pills Filter */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs no-scrollbar">
                <button
                  type="button"
                  onClick={() => setAvailCategoryFilter('all')}
                  className={`px-3 py-1 rounded-full whitespace-nowrap transition-all font-medium text-[11px] ${
                    availCategoryFilter === 'all'
                      ? 'bg-gold-500/20 border border-gold-400 text-gold-300 font-bold'
                      : 'bg-forest-900 border border-forest-800 text-slate-400 hover:text-white'
                  }`}
                >
                  All Categories
                </button>
                {db.categories.map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setAvailCategoryFilter(cat.id)}
                    className={`px-3 py-1 rounded-full whitespace-nowrap transition-all font-medium text-[11px] flex items-center gap-1 ${
                      availCategoryFilter === cat.id
                        ? 'bg-gold-500/20 border border-gold-400 text-gold-300 font-bold'
                        : 'bg-forest-900 border border-forest-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    <span className="material-symbols-outlined text-xs">{cat.icon || 'restaurant'}</span>
                    <span>{cat.name}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Menu Items List */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-2.5">
              {filteredMenuItems.length === 0 ? (
                <div className="py-16 text-center text-slate-400 space-y-3">
                  <span className="material-symbols-outlined text-4xl text-slate-500">search_off</span>
                  <p className="text-sm font-semibold">No dishes matched your search or filters.</p>
                  {(availSearchQuery || availCategoryFilter !== 'all' || availStatusFilter !== 'all') && (
                    <button
                      type="button"
                      onClick={() => {
                        setAvailSearchQuery('');
                        setAvailCategoryFilter('all');
                        setAvailStatusFilter('all');
                      }}
                      className="px-3 py-1 rounded-apple bg-forest-900 text-gold-300 border border-gold-500/30 text-xs font-semibold"
                    >
                      Reset Filters
                    </button>
                  )}
                </div>
              ) : (
                filteredMenuItems.map((item) => {
                  const isUnavailable = item.isAvailable === false;
                  const isBusy = togglingItemId === item.id;
                  const cat = db.categories.find((c) => c.id === item.categoryId);

                  return (
                    <div
                      key={item.id}
                      className={`p-3.5 rounded-2xl border transition-all flex items-center justify-between gap-3 ${
                        isUnavailable
                          ? 'bg-rose-950/30 border-rose-500/40'
                          : 'bg-forest-900/50 border-gold-500/15 hover:border-gold-500/30'
                      }`}
                    >
                      <div className="flex items-start gap-3 min-w-0 flex-1">
                        {/* Veg / Non-Veg Indicator */}
                        <div
                          className={`w-4 h-4 rounded-sm border flex items-center justify-center shrink-0 mt-0.5 ${
                            item.vegType === 'veg'
                              ? 'border-emerald-500'
                              : 'border-rose-500'
                          }`}
                          title={item.vegType}
                        >
                          <div
                            className={`w-2 h-2 rounded-full ${
                              item.vegType === 'veg' ? 'bg-emerald-500' : 'bg-rose-500'
                            }`}
                          />
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h4
                              className={`font-bold text-sm tracking-tight truncate ${
                                isUnavailable ? 'text-rose-200 line-through opacity-80' : 'text-white'
                              }`}
                            >
                              {item.name}
                            </h4>
                            {isUnavailable && (
                              <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase bg-rose-600 text-white shadow-xs">
                                Out of Stock
                              </span>
                            )}
                            {item.isBestseller && (
                              <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-gold-500/20 text-gold-300 border border-gold-500/40">
                                Bestseller
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-2 text-[11px] text-slate-400 mt-1">
                            <span className="text-gold-300 font-bold tabular-nums">
                              ₹{(item.pricePaise / 100).toFixed(0)}
                            </span>
                            <span>•</span>
                            <span>{cat?.name || 'Dish'}</span>
                            <span>•</span>
                            <span className="tabular-nums">{item.preparationTimeMins}m prep</span>
                          </div>

                          {item.description && (
                            <p className="text-[11px] text-slate-400 line-clamp-1 mt-0.5">
                              {item.description}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Tactile Toggle Button */}
                      <button
                        type="button"
                        disabled={isBusy || !onUpdateMenuItem}
                        onClick={() => handleToggleItemAvailability(item)}
                        className={`shrink-0 h-10 px-3.5 rounded-xl text-xs font-black transition-all flex items-center gap-1.5 active:scale-95 shadow-md ${
                          isBusy
                            ? 'opacity-60 cursor-wait bg-slate-800 text-slate-400'
                            : isUnavailable
                            ? 'bg-rose-600 hover:bg-rose-500 text-white border border-rose-400 shadow-rose-900/40'
                            : 'bg-emerald-600/90 hover:bg-rose-600 text-white border border-emerald-500/50 group'
                        }`}
                        title={
                          isUnavailable
                            ? "Click to restore dish to 'In Stock'"
                            : "Click to mark dish Out of Stock"
                        }
                      >
                        {isBusy ? (
                          <>
                            <span className="material-symbols-outlined text-sm animate-spin">
                              progress_activity
                            </span>
                            <span>Updating...</span>
                          </>
                        ) : isUnavailable ? (
                          <>
                            <span className="material-symbols-outlined text-sm">restart_alt</span>
                            <span>Restore Stock</span>
                          </>
                        ) : (
                          <>
                            <span className="material-symbols-outlined text-sm group-hover:hidden">
                              check_circle
                            </span>
                            <span className="material-symbols-outlined text-sm hidden group-hover:inline">
                              block
                            </span>
                            <span className="group-hover:hidden">In Stock</span>
                            <span className="hidden group-hover:inline">Mark Out of Stock</span>
                          </>
                        )}
                      </button>
                    </div>
                  );
                })
              )}
            </div>

            {/* Drawer Footer */}
            <div className="p-4 bg-forest-950 border-t border-gold-500/20 text-xs text-slate-400 flex items-center justify-between shrink-0">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                Live Cloud Sync Enabled
              </span>
              <button
                type="button"
                onClick={() => setShowAvailabilityDrawer(false)}
                className="px-4 py-2 rounded-apple bg-gold-500 hover:bg-gold-400 text-forest-950 font-bold transition-all shadow-apple-subtle"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating Toast Notification */}
      {toastNotification && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[10001] bg-forest-950/95 text-gold-300 border border-gold-400/50 px-5 py-3 rounded-full shadow-2xl font-bold text-xs flex items-center gap-2 backdrop-blur-md animate-in slide-in-from-bottom duration-200">
          <span className="material-symbols-outlined text-base text-gold-400">info</span>
          <span>{toastNotification}</span>
        </div>
      )}
    </div>
  );
};
