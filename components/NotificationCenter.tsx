'use client';

import React, { useState, useEffect, useRef } from 'react';
import { DatabaseSchema, User } from '../lib/types';

export interface WaiterNotification {
  id: string;
  type: 'accepted' | 'ready';
  tableId: string;
  tableNumber: string;
  orderNumber: string;
  stewardName: string;
  title: string;
  message: string;
  timestamp: Date;
  read: boolean;
}

interface NotificationCenterProps {
  notifications: WaiterNotification[];
  onDismissNotification: (id: string) => void;
  onClearAllNotifications: () => void;
  onMarkAllAsRead?: () => void;
  onNavigateToTable: (tableId: string) => void;
  currentUser: User;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  hideFloatingTrigger?: boolean;
}

// ============================================================================
// AUDIO & VIBRATION ALERT ENGINE
// ============================================================================
class WaiterAlertEngine {
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

  // 2-tone gentle chime when kitchen accepts order (50%)
  static playAcceptChime() {
    if (!this.soundEnabled) return;
    const ctx = this.getCtx();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      [
        { freq: 440, time: 0, dur: 0.18 }, // A4
        { freq: 554.37, time: 0.12, dur: 0.28 }, // C#5
      ].forEach(({ freq, time, dur }) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now + time);
        gain.gain.setValueAtTime(0.2, now + time);
        gain.gain.exponentialRampToValueAtTime(0.001, now + time + dur);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + time);
        osc.stop(now + time + dur);
      });
    } catch {}

    // Haptic buzz on mobile
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate([100, 50, 100]);
      } catch {}
    }
  }

  // 4-tone high-priority dinner bell when food is ready (100%)
  static playReadyFanfare() {
    if (!this.soundEnabled) return;
    const ctx = this.getCtx();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      [
        { freq: 523.25, time: 0, dur: 0.15 }, // C5
        { freq: 659.25, time: 0.12, dur: 0.18 }, // E5
        { freq: 783.99, time: 0.24, dur: 0.28 }, // G5
        { freq: 1046.50, time: 0.38, dur: 0.55 }, // C6
      ].forEach(({ freq, time, dur }) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + time);
        gain.gain.setValueAtTime(0.35, now + time);
        gain.gain.exponentialRampToValueAtTime(0.001, now + time + dur);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + time);
        osc.stop(now + time + dur);
      });
    } catch {}

    // Urgent haptic vibration pattern for mobile waitstaff
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate([200, 100, 200, 100, 300]);
      } catch {}
    }
  }
}

export { WaiterAlertEngine };

// ============================================================================
// NOTIFICATION CENTER COMPONENT (TOASTS + BROWSER PUSH + DRAWER)
// ============================================================================
export const NotificationCenter: React.FC<NotificationCenterProps> = ({
  notifications,
  onDismissNotification,
  onClearAllNotifications,
  onMarkAllAsRead,
  onNavigateToTable,
  currentUser,
  isOpen,
  onOpenChange,
  hideFloatingTrigger = false,
}) => {
  const [browserPermission, setBrowserPermission] = useState<NotificationPermission>('default');
  const [internalDrawer, setInternalDrawer] = useState(false);
  const showDrawer = isOpen !== undefined ? isOpen : internalDrawer;
  const setShowDrawer = (val: boolean) => {
    setInternalDrawer(val);
    if (onOpenChange) onOpenChange(val);
  };
  const [soundMuted, setSoundMuted] = useState(false);

  // Check browser notification permission
  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      setBrowserPermission(Notification.permission);
    }
  }, []);

  const requestBrowserPermission = async () => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      try {
        const perm = await Notification.requestPermission();
        setBrowserPermission(perm);
        if (perm === 'granted') {
          new Notification('United Food Palace HMS', {
            body: 'Push notifications activated! You will receive instant alerts when orders are accepted or ready.',
            icon: 'https://images.unsplash.com/photo-1583394838336-acd977736f90?auto=format&fit=crop&w=150&q=80',
          });
        }
      } catch (err) {
        console.warn('Could not request notification permission:', err);
      }
    }
  };

  const toggleSound = () => {
    const next = !soundMuted;
    setSoundMuted(next);
    WaiterAlertEngine.soundEnabled = !next;
  };

  // Filter unread notifications
  const unreadCount = notifications.filter((n) => !n.read).length;
  // Recent 5 active floating toasts
  const activeToasts = notifications.slice(0, 4);

  return (
    <>
      {/* 1. FLOATING TOAST STACK (Top-Right Corner / Centered on Mobile) */}
      <div className="fixed top-4 right-3 left-3 sm:left-auto sm:right-5 sm:max-w-sm z-[9999] flex flex-col gap-2.5 pointer-events-none">
        {/* Permission Request Prompt Pill (if not yet granted) */}
        {browserPermission === 'default' && (
          <div className="pointer-events-auto bg-slate-900/95 backdrop-blur-md text-white p-3.5 rounded-2xl shadow-xl border border-slate-700/80 flex items-center justify-between gap-3 animate-in slide-in-from-top-2 duration-300">
            <div className="flex items-center gap-2.5">
              <span className="material-symbols-outlined text-amber-400 text-xl">notifications_active</span>
              <div className="flex flex-col">
                <span className="text-xs font-black">Enable Waiter Push Alerts</span>
                <span className="text-[10px] text-slate-300">Get OS desktop &amp; phone alerts</span>
              </div>
            </div>
            <button
              onClick={requestBrowserPermission}
              className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-500 hover:to-amber-600 text-slate-950 font-black text-xs shadow-md transition-all active:scale-95"
            >
              Allow
            </button>
          </div>
        )}

        {/* Live Order Stage Toast Cards */}
        {activeToasts.map((toast) => {
          const isReady = toast.type === 'ready';
          const isMyTable = (toast.stewardName || '').toLowerCase().includes((currentUser?.name || '').toLowerCase());

          return (
            <div
              key={toast.id}
              className={`pointer-events-auto rounded-2xl shadow-2xl border p-4 backdrop-blur-md transition-all duration-300 animate-in slide-in-from-top-4 fade-in ${
                isReady
                  ? 'bg-emerald-950/95 border-emerald-400 text-white ring-2 ring-emerald-500/40 shadow-emerald-950/50'
                  : 'bg-slate-950/95 border-amber-400 text-white ring-2 ring-amber-500/30 shadow-slate-950/50'
              }`}
            >
              <div className="flex items-start justify-between gap-2.5">
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  <div
                    className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 font-black text-sm shadow-md ${
                      isReady
                        ? 'bg-emerald-500 text-slate-950 animate-bounce'
                        : 'bg-amber-400 text-slate-950'
                    }`}
                  >
                    <span className="material-symbols-outlined text-xl">
                      {isReady ? 'notifications_active' : 'skillet'}
                    </span>
                  </div>

                  <div className="flex flex-col min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={`text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full ${
                          isReady
                            ? 'bg-emerald-400 text-slate-950'
                            : 'bg-amber-400 text-slate-950'
                        }`}
                      >
                        {isReady ? '100% FOOD READY!' : '50% COOKING STARTED'}
                      </span>
                      {isMyTable && (
                        <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-blue-500/30 text-blue-300 border border-blue-400/30">
                          ⭐ Your Table
                        </span>
                      )}
                    </div>

                    <h4 className="text-sm font-black text-white mt-1 truncate">
                      Table {toast.tableNumber} • {toast.orderNumber}
                    </h4>

                    <p className="text-xs text-slate-200 mt-0.5 line-clamp-2">
                      {toast.message}
                    </p>

                    <span className="text-[10px] text-slate-400 mt-1 font-medium">
                      Steward: {toast.stewardName} • Just now
                    </span>
                  </div>
                </div>

                {/* Dismiss Button */}
                <button
                  type="button"
                  onClick={() => onDismissNotification(toast.id)}
                  className="w-6 h-6 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 flex items-center justify-center transition-colors shrink-0"
                  title="Dismiss notification"
                >
                  <span className="material-symbols-outlined text-sm">close</span>
                </button>
              </div>

              {/* Action Buttons Footer */}
              <div className="mt-3 pt-2.5 border-t border-white/10 flex items-center justify-between gap-2">
                <span className="text-[10px] text-slate-400 font-medium">
                  {isReady ? 'Food at kitchen counter' : 'Chef preparing dishes'}
                </span>

                <button
                  type="button"
                  onClick={() => {
                    onNavigateToTable(toast.tableId);
                    onDismissNotification(toast.id);
                  }}
                  className={`px-3 py-1.5 rounded-xl font-black text-xs flex items-center gap-1 shadow-md transition-all active:scale-95 ${
                    isReady
                      ? 'bg-emerald-400 hover:bg-emerald-300 text-slate-950'
                      : 'bg-amber-400 hover:bg-amber-300 text-slate-950'
                  }`}
                >
                  <span>Open Table {toast.tableNumber}</span>
                  <span className="material-symbols-outlined text-xs">arrow_forward</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* 2. FLOATING WAITER NOTIFICATION BELL BADGE (Rendered only if not hidden) */}
      {!hideFloatingTrigger && (
        <div className="fixed bottom-20 right-4 sm:bottom-6 sm:right-6 z-40 flex items-center gap-2">
          <button
            onClick={() => setShowDrawer(true)}
            className={`h-12 px-4 rounded-2xl shadow-xl flex items-center gap-2.5 font-black text-xs border transition-all duration-200 active:scale-95 ${
              unreadCount > 0
                ? 'bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-400 ring-4 ring-emerald-500/20 animate-pulse'
                : 'bg-slate-900/90 hover:bg-slate-900 text-white border-slate-700'
            }`}
            title="Open Waiter Notifications History"
          >
            <span className="material-symbols-outlined text-xl">
              {unreadCount > 0 ? 'notifications_active' : 'notifications'}
            </span>
            <span>Order Alerts</span>
            {unreadCount > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-white text-emerald-900 font-black text-[11px] shadow-xs">
                {unreadCount}
              </span>
            )}
          </button>
        </div>
      )}

      {/* 3. NOTIFICATION DRAWER / SLIDE-OVER */}
      {showDrawer && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowDrawer(false);
          }}
          className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs z-[10000] flex justify-end animate-in fade-in duration-200"
        >
          <div className="w-full max-w-md bg-white h-full shadow-2xl flex flex-col justify-between animate-in slide-in-from-right duration-200 border-l border-slate-200">
            {/* Drawer Header */}
            <div className="p-5 border-b border-slate-100 bg-slate-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-500 text-slate-950 flex items-center justify-center font-black">
                  <span className="material-symbols-outlined text-xl">notifications</span>
                </div>
                <div>
                  <h3 className="font-extrabold text-base">Waiter Order Alerts</h3>
                  <p className="text-xs text-slate-400">
                    Live updates when Kitchen accepts or finishes food
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={toggleSound}
                  className={`p-2 rounded-xl text-xs border transition-colors ${
                    soundMuted
                      ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                      : 'bg-slate-800 text-slate-300 border-slate-700'
                  }`}
                  title={soundMuted ? 'Unmute alert sound' : 'Mute alert sound'}
                >
                  <span className="material-symbols-outlined text-sm">
                    {soundMuted ? 'volume_off' : 'volume_up'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowDrawer(false)}
                  className="w-8 h-8 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center transition-colors"
                  title="Close"
                >
                  <span className="material-symbols-outlined text-base">close</span>
                </button>
              </div>
            </div>

            {/* Notifications List */}
            <div className="p-4 flex-1 overflow-y-auto space-y-3">
              {browserPermission !== 'granted' && (
                <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-2xl flex items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-amber-600 text-lg">campaign</span>
                    <span className="text-amber-900 font-bold">Native Desktop Alerts</span>
                  </div>
                  <button
                    onClick={requestBrowserPermission}
                    className="px-3 py-1 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-xs shadow-xs"
                  >
                    Enable
                  </button>
                </div>
              )}

              {notifications.length === 0 ? (
                <div className="p-12 text-center flex flex-col items-center justify-center gap-3 text-slate-400">
                  <span className="material-symbols-outlined text-4xl">notifications_paused</span>
                  <span className="font-extrabold text-sm text-slate-700">No Notifications Yet</span>
                  <p className="text-xs text-slate-500 max-w-xs">
                    When Chef Manoj swipes 50% (Accept) or 100% (Ready), tickets and push alerts appear here instantly.
                  </p>
                </div>
              ) : (
                notifications.map((notif) => {
                  const isReady = notif.type === 'ready';

                  return (
                    <div
                      key={notif.id}
                      className={`p-3.5 rounded-2xl border transition-all ${
                        isReady
                          ? 'bg-emerald-50/70 border-emerald-200 hover:border-emerald-300'
                          : 'bg-amber-50/70 border-amber-200 hover:border-amber-300'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-2.5 flex-1 min-w-0">
                          <span
                            className={`w-7 h-7 rounded-lg font-black text-xs flex items-center justify-center shrink-0 ${
                              isReady
                                ? 'bg-emerald-600 text-white'
                                : 'bg-amber-500 text-white'
                            }`}
                          >
                            <span className="material-symbols-outlined text-sm">
                              {isReady ? 'notifications_active' : 'skillet'}
                            </span>
                          </span>

                          <div className="flex flex-col min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-extrabold text-slate-900 text-xs">
                                Table {notif.tableNumber}
                              </span>
                              <span className="font-mono text-[10px] font-bold text-slate-500">
                                {notif.orderNumber}
                              </span>
                            </div>
                            <p className="text-xs text-slate-700 mt-0.5">{notif.message}</p>
                            <span className="text-[10px] text-slate-400 mt-1 font-semibold">
                              Steward: {notif.stewardName} • {notif.timestamp.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => onDismissNotification(notif.id)}
                          className="text-slate-400 hover:text-slate-600 text-xs"
                          title="Remove"
                        >
                          ✕
                        </button>
                      </div>

                      <div className="mt-2.5 pt-2 border-t border-slate-200/60 flex justify-end">
                        <button
                          type="button"
                          onClick={() => {
                            onNavigateToTable(notif.tableId);
                            setShowDrawer(false);
                          }}
                          className={`px-3 py-1 rounded-xl text-xs font-black flex items-center gap-1 ${
                            isReady
                              ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                              : 'bg-amber-500 hover:bg-amber-600 text-white'
                          }`}
                        >
                          <span>Open Table</span>
                          <span className="material-symbols-outlined text-xs">arrow_forward</span>
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Drawer Footer */}
            {notifications.length > 0 && (
              <div className="p-4 border-t border-slate-100 bg-slate-50 flex items-center justify-between">
                <span className="text-xs text-slate-500 font-bold">
                  {notifications.length} alerts logged {unreadCount > 0 && `(${unreadCount} unread)`}
                </span>
                <div className="flex items-center gap-2">
                  {onMarkAllAsRead && unreadCount > 0 && (
                    <button
                      type="button"
                      onClick={onMarkAllAsRead}
                      className="px-3 py-1.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-800 font-bold text-xs border border-emerald-200 transition-colors"
                    >
                      Mark All Read
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={onClearAllNotifications}
                    className="px-3 py-1.5 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-xs transition-colors"
                  >
                    Clear All
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
};
