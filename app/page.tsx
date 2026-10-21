'use client';

import React, { useState, useEffect, useRef } from 'react';
import { DatabaseSchema, User, RestaurantTable, Bill, BusinessSettings, KitchenStage } from '../lib/types';
import { Sidebar } from '../components/Sidebar';
import { Header } from '../components/Header';
import { DashboardModule } from '../components/DashboardModule';
import { BillingPOSModule } from '../components/BillingPOSModule';
import { OrdersModule } from '../components/OrdersModule';
import { StaffDirectoryModule } from '../components/StaffDirectoryModule';
import { AttendanceModule } from '../components/AttendanceModule';
import { InventoryModule } from '../components/InventoryModule';
import { FinancePayrollModule } from '../components/FinancePayrollModule';
import { AnalyticsReportsModule } from '../components/AnalyticsReportsModule';
import { SettingsModule } from '../components/SettingsModule';
import { NotificationCenter, WaiterNotification, WaiterAlertEngine } from '../components/NotificationCenter';
import { AuthScreen } from '../components/AuthScreen';
import { getLocalDateStr } from '../lib/dateUtils';
import { getCurrentBrowserPosition } from '../lib/geoUtils';

export default function HMSApp() {
  const [db, setDb] = useState<DatabaseSchema | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const currentUserRef = useRef<User | null>(currentUser);
  useEffect(() => {
    currentUserRef.current = currentUser;
  }, [currentUser]);
  const [selectedTableForOrder, setSelectedTableForOrder] = useState<RestaurantTable | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Load user sidebar preference from localStorage or auto-collapse for tablet
  useEffect(() => {
    try {
      const saved = localStorage.getItem('hms_sidebar_collapsed');
      if (saved !== null) {
        setSidebarCollapsed(saved === 'true');
      } else if (typeof window !== 'undefined' && window.innerWidth >= 768 && window.innerWidth < 1024) {
        // Default tablet view to slim rail to maximize table POS and KDS space
        setSidebarCollapsed(true);
      }
    } catch {}
  }, []);

  const toggleSidebarCollapse = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('hms_sidebar_collapsed', String(next));
      } catch {}
      return next;
    });
  };

  // Keyboard shortcut Ctrl+B / Cmd+B to toggle sidebar collapse
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        toggleSidebarCollapse();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Scroll to top whenever tab changes (ensures modules like Billing & POS open from the top)
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [activeTab]);

  // Push Notifications state & stage tracker
  const [notifications, setNotifications] = useState<WaiterNotification[]>([]);
  const [orderAlertsDrawerOpen, setOrderAlertsDrawerOpen] = useState(false);
  const prevOrderStagesRef = useRef<Record<string, string>>({});

  const triggerPushNotification = (
    type: 'accepted' | 'ready',
    tableId: string,
    tableNumber: string,
    orderNumber: string,
    stewardName: string,
    itemCount: number
  ) => {
    const isReady = type === 'ready';
    const title = isReady
      ? `🔔 FOOD READY FOR PICKUP: Table ${tableNumber}!`
      : `🍳 Kitchen Accepted: Table ${tableNumber}`;
    const message = isReady
      ? `${orderNumber} is prepared and ready at the kitchen pass! Please collect.`
      : `Chef accepted ${orderNumber} (${itemCount} items) — Cooking in progress (50%).`;

    const newNotif: WaiterNotification = {
      id: `notif-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      type,
      tableId,
      tableNumber,
      orderNumber,
      stewardName,
      title,
      message,
      timestamp: new Date(),
      read: false,
    };

    setNotifications((prev) => [newNotif, ...prev.slice(0, 19)]);

    if (isReady) {
      WaiterAlertEngine.playReadyFanfare();
    } else {
      WaiterAlertEngine.playAcceptChime();
    }

    // Native Browser OS Push Notification
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
      try {
        const nativeNotif = new Notification(title, {
          body: message,
          icon: 'https://images.unsplash.com/photo-1583394838336-acd977736f90?auto=format&fit=crop&w=150&q=80',
          tag: `kot-${orderNumber}-${type}`,
        });
        nativeNotif.onclick = () => {
          window.focus();
          const target = db?.tables.find((t) => t.id === tableId);
          if (target) {
            setSelectedTableForOrder(target);
            setActiveTab('billing');
          }
        };
      } catch (e) {
        console.warn('Native notification failed:', e);
      }
    }
  };

  // Fetch full state on load
  const refreshData = async () => {
    try {
      const res = await fetch('/api/data');
      const json = await res.json();
      if (json.success && json.data) {
        setDb(json.data);
        if (!currentUser && json.data.users.length > 0) {
          const savedUserId = typeof window !== 'undefined' ? localStorage.getItem('hms_auth_user_id') : null;
          const isExplicitLoggedOut = typeof window !== 'undefined' && localStorage.getItem('hms_logged_out') === 'true';
          if (!isExplicitLoggedOut && savedUserId) {
            const found = json.data.users.find((u: User) => u.id === savedUserId);
            if (found) {
              const todayStr = getLocalDateStr(new Date());
              const userAtt = json.data.attendance?.find(
                (a: any) => (a.staffId === found.id || a.staffName?.toLowerCase() === found.name?.toLowerCase()) && a.date === todayStr
              );
              // If staff member already completed shift / punched out today, don't auto-restore session
              if (found.role !== 'admin' && userAtt && userAtt.checkOutTime && userAtt.checkOutTime !== '--:--') {
                try {
                  localStorage.removeItem('hms_auth_user_id');
                  localStorage.setItem('hms_logged_out', 'true');
                } catch {}
              } else {
                setCurrentUser(found);
              }
            }
          }
        }
        // Initialize stage map so existing orders do not trigger initial false notifications
        if (json.data.orders) {
          const initMap: Record<string, string> = {};
          json.data.orders.forEach((o: any) => {
            initMap[o.id] = o.kitchenStage || (o.status === 'preparing' ? 'accepted' : o.status === 'ready_for_pickup' ? 'ready' : 'pending');
          });
          prevOrderStagesRef.current = initMap;
        }
      }
    } catch (err) {
      console.error('Failed to load database:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = (user: User, initialTab?: string) => {
    setCurrentUser(user);
    try {
      localStorage.setItem('hms_auth_user_id', user.id);
      localStorage.removeItem('hms_logged_out');
    } catch {}
    if (initialTab) {
      setActiveTab(initialTab);
    }
  };

  const handleLogout = () => {
    setCurrentUser(null);
    try {
      localStorage.removeItem('hms_auth_user_id');
      localStorage.setItem('hms_logged_out', 'true');
    } catch {}
  };

  useEffect(() => {
    refreshData();

    // Background live polling every 3.5s so KDS, table radar, and push notifications stay synced
    const pollInterval = setInterval(async () => {
      try {
        const res = await fetch('/api/data');
        const json = await res.json();
        if (json.success && json.data) {
          // Detect Kitchen Order Stage Transitions for Push Notifications
          if (json.data.orders) {
            const nextMap: Record<string, string> = {};
            json.data.orders.forEach((ord: any) => {
              const stage = ord.kitchenStage || (ord.status === 'preparing' ? 'accepted' : ord.status === 'ready_for_pickup' ? 'ready' : 'pending');
              nextMap[ord.id] = stage;

              const prevStage = prevOrderStagesRef.current[ord.id];
              if (prevStage && prevStage !== stage) {
                if (prevStage === 'pending' && stage === 'accepted') {
                  triggerPushNotification('accepted', ord.tableId, ord.tableNumber, ord.orderNumber, ord.stewardName, ord.items?.length || 1);
                } else if ((prevStage === 'accepted' || prevStage === 'pending') && stage === 'ready') {
                  triggerPushNotification('ready', ord.tableId, ord.tableNumber, ord.orderNumber, ord.stewardName, ord.items?.length || 1);
                } else if (stage === 'served') {
                  // Order collected by waiter: dismiss / clear notification immediately for this order
                  setNotifications((prev) =>
                    prev.filter((n) => n.orderNumber !== ord.orderNumber)
                  );
                }
              }
            });
            prevOrderStagesRef.current = nextMap;

            // Automatically purge any stale notifications for orders that are already served or settled
            setNotifications((prev) =>
              prev.filter((n) => {
                const matched = json.data.orders.find((o: any) => o.orderNumber === n.orderNumber);
                if (matched && (matched.kitchenStage === 'served' || matched.status === 'served' || matched.status === 'settled' || matched.status === 'cancelled')) {
                  return false;
                }
                return true;
              })
            );
          }

          // Automatically log off staff member if they scanned 2nd time (punch-out completed)
          const activeUser = currentUserRef.current;
          if (activeUser && activeUser.role !== 'admin') {
            const todayStr = getLocalDateStr(new Date());
            const userAtt = json.data.attendance?.find(
              (a: any) => (a.staffId === activeUser.id || a.staffName?.toLowerCase() === activeUser.name?.toLowerCase()) && a.date === todayStr
            );
            if (userAtt && userAtt.checkOutTime && userAtt.checkOutTime !== '--:--' && userAtt.checkOutTime.trim() !== '') {
              handleLogout();
              return;
            }
          }

          setDb(json.data);
        }
      } catch {
        // silent background polling
      }
    }, 3500);

    return () => clearInterval(pollInterval);
  }, []);

  if (loading || !db) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4 text-primary">
        <span className="material-symbols-outlined text-5xl animate-spin">progress_activity</span>
        <div className="flex flex-col items-center">
          <span className="font-headline-sm text-lg font-bold">UNITED FOOD PALACE</span>
          <span className="text-xs text-secondary font-semibold uppercase tracking-wider">
            Loading Enterprise Management Suite...
          </span>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <AuthScreen
        users={db.users}
        onLogin={handleLogin}
        restaurantName={db.settings.restaurantName}
      />
    );
  }

  // --- API HANDLERS ---
  const handleUpdateSettings = async (settings: Partial<BusinessSettings>) => {
    const res = await fetch('/api/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'UPDATE_SETTINGS',
        settings,
        userName: currentUser.name,
        userRole: currentUser.role,
      }),
    });
    const json = await res.json();
    if (json.success && json.data) {
      setDb(json.data);
    }
  };

  const handleSettleBill = async (billData: any): Promise<Bill | null> => {
    const res = await fetch('/api/billing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'SETTLE_BILL',
        ...billData,
        userName: currentUser.name,
        userRole: currentUser.role,
      }),
    });
    const json = await res.json();
    if (json.success && json.data) {
      setDb(json.data);
      return json.bill;
    }
    return null;
  };

  const handleUpdateTableStatus = async (tableId: string, status: any, details?: any) => {
    const res = await fetch('/api/billing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'UPDATE_TABLE_STATUS',
        tableId,
        status,
        ...details,
        userName: currentUser.name,
        userRole: currentUser.role,
      }),
    });
    const json = await res.json();
    if (json.success && json.data) {
      setDb(json.data);
    }
  };

  const handleMoveTable = async (sourceTableId: string, targetTableId: string) => {
    const res = await fetch('/api/billing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'MOVE_TABLE',
        sourceTableId,
        targetTableId,
        userName: currentUser.name,
        userRole: currentUser.role,
      }),
    });
    const json = await res.json();
    if (json.success && json.data) {
      setDb(json.data);
    }
  };

  const handleCancelBill = async (billId: string, reason: string) => {
    const res = await fetch('/api/billing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'CANCEL_BILL',
        billId,
        reason,
        userName: currentUser.name,
        userRole: currentUser.role,
      }),
    });
    const json = await res.json();
    if (json.success && json.data) {
      setDb(json.data);
    }
  };

  const handleSendToKitchen = async (tableId: string, items: any[], guestCount?: number, stewardName?: string, notes?: string) => {
    const res = await fetch('/api/billing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'SEND_TO_KITCHEN',
        tableId,
        items,
        stewardName: stewardName || currentUser?.name,
        guestCount,
        notes,
        userName: currentUser?.name,
        userRole: currentUser?.role,
      }),
    });
    const json = await res.json();
    if (json.success && json.data) {
      setDb(json.data);
    }
    return json;
  };

  const handleUpdateOrderStage = async (orderId: string, stage: KitchenStage) => {
    // Immediate push notification for responsive UX
    const order = db?.orders.find((o) => o.id === orderId);
    if (order && (stage === 'accepted' || stage === 'ready')) {
      triggerPushNotification(
        stage,
        order.tableId,
        order.tableNumber,
        order.orderNumber,
        order.stewardName,
        order.items?.length || 1
      );
      prevOrderStagesRef.current[orderId] = stage;
    } else if (order && stage === 'served') {
      // Order collected by waiter: dismiss / clear notifications immediately for this order
      setNotifications((prev) =>
        prev.filter((n) => n.orderNumber !== order.orderNumber)
      );
      prevOrderStagesRef.current[orderId] = stage;
    }

    const res = await fetch('/api/billing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'UPDATE_KITCHEN_ORDER_STAGE',
        orderId,
        stage,
        userName: currentUser?.name,
        userRole: currentUser?.role,
      }),
    });
    const json = await res.json();
    if (json.success && json.data) {
      setDb(json.data);
      if (stage === 'served') {
        setNotifications((prev) =>
          prev.filter((n) => {
            const ord = json.data.orders?.find((o: any) => o.id === orderId);
            if (!ord) return true;
            return n.orderNumber !== ord.orderNumber;
          })
        );
      }
    }
    return json;
  };

  const handleAddStaff = async (staffData: any) => {
    const res = await fetch('/api/staff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'ADD_STAFF',
        ...staffData,
        userName: currentUser.name,
        userRole: currentUser.role,
      }),
    });
    const json = await res.json();
    if (json.success && json.data) {
      setDb(json.data);
    }
  };

  const handleUpdateStaff = async (staffId: string, updates: any) => {
    const res = await fetch('/api/staff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'UPDATE_STAFF',
        staffId,
        updates,
        userName: currentUser.name,
        userRole: currentUser.role,
      }),
    });
    const json = await res.json();
    if (json.success && json.data) {
      setDb(json.data);
    }
  };

  const handleDeleteStaff = async (staffId: string) => {
    const res = await fetch('/api/staff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'DELETE_STAFF',
        staffId,
        userName: currentUser.name,
        userRole: currentUser.role,
      }),
    });
    const json = await res.json();
    if (json.success && json.data) {
      setDb(json.data);
    } else if (json.message) {
      alert(json.message);
    }
    return json;
  };

  const handleVerifyAttendance = async (staffId: string, confidence: number, livenessPassed: boolean) => {
    let coords: any = null;
    try {
      coords = await getCurrentBrowserPosition(2500);
    } catch {}

    const res = await fetch('/api/attendance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'VERIFY_FACE_ATTENDANCE',
        staffId,
        confidence,
        livenessPassed,
        userName: currentUser?.name || 'Staff',
        userRole: currentUser?.role || 'staff',
        latitude: coords?.latitude,
        longitude: coords?.longitude,
      }),
    });
    const json = await res.json();
    if (json.success && json.data) {
      setDb(json.data);
      if (json.punchType === 'punch_out' && currentUser && currentUser.id === staffId) {
        handleLogout();
      }
    } else if (json.geofenceRestricted || !json.success) {
      alert(`📍 Attendance Blocked: ${json.message || 'Outside designated restaurant premises.'}`);
    }
    return json;
  };

  const handleManagerOverrideAttendance = async (staffId: string, checkInTime: string, reason: string, checkOutTime?: string) => {
    const res = await fetch('/api/attendance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'MANAGER_OVERRIDE',
        staffId,
        checkInTime,
        checkOutTime,
        reason,
        userName: currentUser.name,
        userRole: currentUser.role,
      }),
    });
    const json = await res.json();
    if (json.success && json.data) {
      setDb(json.data);
    }
  };

  const handleApproveLeave = async (leaveId: string) => {
    const res = await fetch('/api/attendance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'APPROVE_LEAVE',
        leaveId,
        userName: currentUser.name,
        userRole: currentUser.role,
      }),
    });
    const json = await res.json();
    if (json.success && json.data) {
      setDb(json.data);
    }
  };

  const handleStockIn = async (data: any) => {
    const res = await fetch('/api/inventory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'STOCK_IN',
        ...data,
        userName: currentUser.name,
        userRole: currentUser.role,
      }),
    });
    const json = await res.json();
    if (json.success && json.data) {
      setDb(json.data);
    }
  };

  const handleStockOut = async (data: any) => {
    const res = await fetch('/api/inventory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'STOCK_OUT',
        ...data,
        userName: currentUser.name,
        userRole: currentUser.role,
      }),
    });
    const json = await res.json();
    if (json.success && json.data) {
      setDb(json.data);
    }
  };

  const handleQuickReorder = async (itemId: string, quantity?: number) => {
    const res = await fetch('/api/inventory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'QUICK_REORDER',
        itemId,
        quantity,
        userName: currentUser.name,
        userRole: currentUser.role,
      }),
    });
    const json = await res.json();
    if (json.success && json.data) {
      setDb(json.data);
      alert('PO Reorder obligation placed and added to Upcoming Liabilities!');
    }
  };

  const handleInventoryAction = async (action: string, payload: any) => {
    const res = await fetch('/api/inventory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action,
        ...payload,
        userName: currentUser.name,
        userRole: currentUser.role,
      }),
    });
    const json = await res.json();
    if (json.success && json.data) {
      setDb(json.data);
    }
    return json;
  };

  const handleAddExpense = async (expenseData: any) => {
    const res = await fetch('/api/finance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'ADD_EXPENSE',
        ...expenseData,
        userName: currentUser.name,
        userRole: currentUser.role,
      }),
    });
    const json = await res.json();
    if (json.success && json.data) {
      setDb(json.data);
    }
  };

  const handlePayLiability = async (liabilityId: string) => {
    const res = await fetch('/api/finance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'PAY_LIABILITY',
        liabilityId,
        userName: currentUser.name,
        userRole: currentUser.role,
      }),
    });
    const json = await res.json();
    if (json.success && json.data) {
      setDb(json.data);
    }
  };

  // --- MENU & ACCESS HANDLERS ---
  const handleAddMenuItem = async (menuData: any) => {
    const res = await fetch('/api/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'ADD_MENU_ITEM',
        ...menuData,
        userName: currentUser.name,
        userRole: currentUser.role,
      }),
    });
    const json = await res.json();
    if (json.success && json.data) {
      setDb(json.data);
    }
    return json;
  };

  const handleUpdateMenuItem = async (itemId: string, updates: any) => {
    const res = await fetch('/api/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'UPDATE_MENU_ITEM',
        itemId,
        updates,
        userName: currentUser.name,
        userRole: currentUser.role,
      }),
    });
    const json = await res.json();
    if (json.success && json.data) {
      setDb(json.data);
    }
    return json;
  };

  const handleDeleteMenuItem = async (itemId: string) => {
    const res = await fetch('/api/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'DELETE_MENU_ITEM',
        itemId,
        userName: currentUser.name,
        userRole: currentUser.role,
      }),
    });
    const json = await res.json();
    if (json.success && json.data) {
      setDb(json.data);
    }
    return json;
  };

  const handleUpdateRolePermissions = async (rolePermissions: any) => {
    const res = await fetch('/api/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'UPDATE_ROLE_PERMISSIONS',
        rolePermissions,
        userName: currentUser.name,
        userRole: currentUser.role,
      }),
    });
    const json = await res.json();
    if (json.success && json.data) {
      setDb(json.data);
    }
    return json;
  };

  const handleAddUser = async (userData: any) => {
    const res = await fetch('/api/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'ADD_USER',
        ...userData,
        userName: currentUser.name,
        userRole: currentUser.role,
      }),
    });
    const json = await res.json();
    if (json.success && json.data) {
      setDb(json.data);
    }
    return json;
  };

  const handleUpdateUser = async (userId: string, updates: any) => {
    const res = await fetch('/api/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'UPDATE_USER',
        userId,
        updates,
        userName: currentUser.name,
        userRole: currentUser.role,
      }),
    });
    const json = await res.json();
    if (json.success && json.data) {
      setDb(json.data);
    }
    return json;
  };

  const handleDeleteUser = async (userId: string) => {
    const res = await fetch('/api/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'DELETE_USER',
        userId,
        userName: currentUser.name,
        userRole: currentUser.role,
      }),
    });
    const json = await res.json();
    if (json.success && json.data) {
      setDb(json.data);
    } else if (json.message) {
      alert(json.message);
    }
    return json;
  };

  // --- ADMIN TABLE & FLOOR HANDLERS ---
  const handleAddTable = async (tableData: any) => {
    const res = await fetch('/api/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'ADD_TABLE',
        ...tableData,
        userName: currentUser.name,
        userRole: currentUser.role,
      }),
    });
    const json = await res.json();
    if (json.success && json.data) {
      setDb(json.data);
    }
    return json;
  };

  const handleUpdateTable = async (tableId: string, updates: any) => {
    const res = await fetch('/api/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'UPDATE_TABLE',
        tableId,
        updates,
        userName: currentUser.name,
        userRole: currentUser.role,
      }),
    });
    const json = await res.json();
    if (json.success && json.data) {
      setDb(json.data);
    }
    return json;
  };

  const handleDeleteTable = async (tableId: string, force?: boolean) => {
    const res = await fetch('/api/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'DELETE_TABLE',
        tableId,
        force,
        userName: currentUser.name,
        userRole: currentUser.role,
      }),
    });
    const json = await res.json();
    if (json.success && json.data) {
      setDb(json.data);
    }
    return json;
  };

  const activeOrdersCount = db.orders.filter(
    (o) =>
      o.status !== 'settled' &&
      o.status !== 'cancelled' &&
      o.status !== 'served' &&
      o.status !== 'billed' &&
      (o.kitchenStage || 'pending') !== 'served'
  ).length;

  const orderAlertsCount = notifications.filter((n) => {
    if (n.read) return false;
    const ord = db.orders.find((o) => o.orderNumber === n.orderNumber);
    if (ord && (ord.kitchenStage === 'served' || ord.status === 'served' || ord.status === 'settled' || ord.status === 'cancelled')) {
      return false;
    }
    return true;
  }).length;

  return (
    <div className="min-h-screen bg-background">
      {/* Real-Time Push Notification Engine for Waiters & Staff */}
      <NotificationCenter
        notifications={notifications}
        onDismissNotification={(id) => setNotifications((prev) => prev.filter((n) => n.id !== id))}
        onClearAllNotifications={() => setNotifications([])}
        onMarkAllAsRead={() => setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))}
        onNavigateToTable={(tableId) => {
          const target = db.tables.find((t) => t.id === tableId);
          if (target) {
            setSelectedTableForOrder(target);
            setActiveTab('billing');
          }
        }}
        currentUser={currentUser}
        isOpen={orderAlertsDrawerOpen}
        onOpenChange={setOrderAlertsDrawerOpen}
        hideFloatingTrigger={true}
      />

      {/* 1. Left Sidebar Navigation */}
      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        currentUser={currentUser}
        onLogout={handleLogout}
        restaurantName={db.settings.restaurantName}
        activeOrdersCount={activeOrdersCount}
        mobileOpen={mobileNavOpen}
        onCloseMobile={() => setMobileNavOpen(false)}
        isCollapsed={sidebarCollapsed}
        onToggleCollapse={toggleSidebarCollapse}
      />

      {/* Mobile Top Navigation Header Bar (Visible on mobile/tablet below md) */}
      <div className="md:hidden fixed top-0 left-0 right-0 h-16 bg-[#031d16]/85 backdrop-blur-2xl backdrop-saturate-180 text-white z-40 px-3.5 flex items-center justify-between shadow-apple-subtle border-b border-white/[0.08] no-print">
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            type="button"
            onClick={() => setMobileNavOpen(true)}
            className="w-10 h-10 rounded-apple bg-white/[0.08] hover:bg-white/[0.12] text-gold-300 border border-white/[0.08] flex items-center justify-center transition-all active:scale-[0.96] shrink-0"
            title="Open Menu Drawer"
          >
            <span className="material-symbols-outlined text-2xl">menu</span>
          </button>
          <div className="w-9 h-9 rounded-full overflow-hidden p-0.5 bg-black border border-gold-400/80 shadow-xs shrink-0 flex items-center justify-center">
            <img src="/logo.png" alt="Logo" className="w-full h-full object-contain" />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="font-bold text-xs tracking-tight text-white uppercase truncate max-w-[140px]">
              {db.settings.restaurantName}
            </span>
            <span className="text-[10px] text-gold-400 font-semibold uppercase tracking-wider capitalize truncate">
              {activeTab === 'billing' ? 'Billing & POS' : activeTab === 'orders' ? 'Live Orders KDS' : activeTab}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {activeOrdersCount > 0 && (
            <button
              onClick={() => setActiveTab('orders')}
              className="px-2.5 py-1 rounded-full bg-rose-600 text-white font-bold text-[10px] flex items-center gap-1 active:scale-[0.96] shadow-apple-subtle"
              title="Active Kitchen Orders"
            >
              <span className="material-symbols-outlined text-xs">soup_kitchen</span>
              <span className="tabular-nums">{activeOrdersCount}</span>
            </button>
          )}

          <div className="px-2.5 py-1 rounded-full bg-white/[0.06] border border-white/[0.08] text-[10px] font-semibold text-gold-300 capitalize flex items-center gap-1.5 shadow-xs">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span>{currentUser.role}</span>
          </div>
        </div>
      </div>

      {/* 2. Top Header - Rendered on dashboard */}
      {activeTab === 'dashboard' && (
        <Header
          currentUser={currentUser}
          onLogout={handleLogout}
          tables={db.tables}
          activeTab={activeTab}
          onRefreshData={refreshData}
          isSidebarCollapsed={sidebarCollapsed}
          onToggleSidebarCollapse={toggleSidebarCollapse}
        />
      )}

      {/* 3. Main Body Container (Responsive: pl-0 on mobile, md:pl-20 when collapsed, md:pl-64 when expanded) */}
      <div className={`pl-0 ${sidebarCollapsed ? 'md:pl-20' : 'md:pl-64'} ${activeTab === 'dashboard' ? 'pt-16 md:pt-20' : 'pt-16 md:pt-0'} pb-20 md:pb-6 bg-slate-50/50 min-h-screen transition-all duration-300 ease-in-out min-w-0 max-w-full overflow-x-hidden`}>
        {/* Modules Render */}
        <main className="min-h-[calc(100vh-80px)] min-w-0 max-w-full">
          {activeTab === 'dashboard' && (
            <DashboardModule
              db={db}
              currentUser={currentUser}
              onNavigateTab={setActiveTab}
              onSelectTableForOrder={(tbl) => {
                setSelectedTableForOrder(tbl);
                setActiveTab('billing');
                window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
              }}
              onQuickReorder={handleQuickReorder}
            />
          )}

          {activeTab === 'billing' && (
            <BillingPOSModule
              db={db}
              currentUser={currentUser}
              selectedTable={selectedTableForOrder}
              onSelectTable={setSelectedTableForOrder}
              onSettleBill={handleSettleBill}
              onUpdateTableStatus={handleUpdateTableStatus}
              onMoveTable={handleMoveTable}
              onCancelBill={handleCancelBill}
              onAddMenuItem={handleAddMenuItem}
              onSendToKitchen={handleSendToKitchen}
              onOpenOrderAlerts={() => setOrderAlertsDrawerOpen(true)}
              orderAlertsCount={orderAlertsCount}
            />
          )}

          {activeTab === 'orders' && (
            <OrdersModule
              db={db}
              currentUser={currentUser}
              onUpdateOrderStage={handleUpdateOrderStage}
              onNavigateToTable={(tblId) => {
                const target = db.tables.find((t) => t.id === tblId);
                if (target) {
                  setSelectedTableForOrder(target);
                  setActiveTab('billing');
                }
              }}
              onRefreshData={refreshData}
              onOpenOrderAlerts={() => setOrderAlertsDrawerOpen(true)}
              orderAlertsCount={orderAlertsCount}
              onUpdateMenuItem={handleUpdateMenuItem}
            />
          )}

          {activeTab === 'staff' && (
            <StaffDirectoryModule
              db={db}
              currentUser={currentUser}
              onAddStaff={handleAddStaff}
              onUpdateStaff={handleUpdateStaff}
              onDeleteStaff={handleDeleteStaff}
              onAddUser={handleAddUser}
            />
          )}

          {activeTab === 'attendance' && (
            <AttendanceModule
              db={db}
              currentUser={currentUser}
              onVerifyAttendance={handleVerifyAttendance}
              onManagerOverride={handleManagerOverrideAttendance}
              onApproveLeave={handleApproveLeave}
              onUpdateDb={(newDb) => setDb(newDb)}
            />
          )}

          {activeTab === 'inventory' && (
            <InventoryModule
              db={db}
              currentUser={currentUser}
              onStockIn={handleStockIn}
              onStockOut={handleStockOut}
              onQuickReorder={handleQuickReorder}
              onInventoryAction={handleInventoryAction}
            />
          )}

          {activeTab === 'finance' && (
            <FinancePayrollModule
              db={db}
              currentUser={currentUser}
              onAddExpense={handleAddExpense}
              onPayLiability={handlePayLiability}
            />
          )}

          {activeTab === 'reports' && (
            <AnalyticsReportsModule db={db} onRefreshLive={refreshData} />
          )}

          {activeTab === 'settings' && (
            <SettingsModule
              db={db}
              currentUser={currentUser}
              onUpdateSettings={handleUpdateSettings}
              onAddMenuItem={handleAddMenuItem}
              onUpdateMenuItem={handleUpdateMenuItem}
              onDeleteMenuItem={handleDeleteMenuItem}
              onUpdateRolePermissions={handleUpdateRolePermissions}
              onAddUser={handleAddUser}
              onUpdateUser={handleUpdateUser}
              onDeleteUser={handleDeleteUser}
              onAddTable={handleAddTable}
              onUpdateTable={handleUpdateTable}
              onDeleteTable={handleDeleteTable}
            />
          )}
        </main>
      </div>

      {/* 4. Native Mobile Bottom Navigation Bar (Visible on mobile screens below md) */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 h-16 bg-[#031d16]/85 backdrop-blur-2xl backdrop-saturate-180 border-t border-white/[0.08] z-40 px-3 flex items-center justify-around no-print shadow-apple-card">
        <button
          type="button"
          onClick={() => setActiveTab('dashboard')}
          className={`flex flex-col items-center justify-center py-1.5 px-3 rounded-apple transition-all active:scale-[0.94] ${
            activeTab === 'dashboard'
              ? 'text-gold-300 font-semibold'
              : 'text-slate-400 hover:text-slate-200 font-normal'
          }`}
        >
          <span className={`material-symbols-outlined text-[22px] transition-transform ${activeTab === 'dashboard' ? 'text-gold-400 scale-105' : ''}`}>
            dashboard
          </span>
          <span className="text-[10px] tracking-tight mt-0.5">Overview</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('billing')}
          className={`flex flex-col items-center justify-center py-1.5 px-3 rounded-apple transition-all active:scale-[0.94] ${
            activeTab === 'billing'
              ? 'text-gold-300 font-semibold'
              : 'text-slate-400 hover:text-slate-200 font-normal'
          }`}
        >
          <span className={`material-symbols-outlined text-[22px] transition-transform ${activeTab === 'billing' ? 'text-gold-400 scale-105' : ''}`}>
            point_of_sale
          </span>
          <span className="text-[10px] tracking-tight mt-0.5">POS Tables</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('orders')}
          className={`flex flex-col items-center justify-center py-1.5 px-3 rounded-apple transition-all relative active:scale-[0.94] ${
            activeTab === 'orders'
              ? 'text-gold-300 font-semibold'
              : 'text-slate-400 hover:text-slate-200 font-normal'
          }`}
        >
          <span className={`material-symbols-outlined text-[22px] transition-transform ${activeTab === 'orders' ? 'text-gold-400 scale-105' : ''}`}>
            soup_kitchen
          </span>
          {activeOrdersCount > 0 && (
            <span className="absolute top-1 right-2 min-w-[16px] h-[16px] px-1 rounded-full text-[9px] font-bold bg-rose-500 text-white flex items-center justify-center ring-2 ring-[#031d16] animate-pulse tabular-nums">
              {activeOrdersCount}
            </span>
          )}
          <span className="text-[10px] tracking-tight mt-0.5">Kitchen KDS</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('attendance')}
          className={`flex flex-col items-center justify-center py-1.5 px-3 rounded-apple transition-all active:scale-[0.94] ${
            activeTab === 'attendance'
              ? 'text-gold-300 font-semibold'
              : 'text-slate-400 hover:text-slate-200 font-normal'
          }`}
        >
          <span className={`material-symbols-outlined text-[22px] transition-transform ${activeTab === 'attendance' ? 'text-gold-400 scale-105' : ''}`}>
            center_focus_strong
          </span>
          <span className="text-[10px] tracking-tight mt-0.5">Attendance</span>
        </button>

        <button
          type="button"
          onClick={() => setMobileNavOpen(true)}
          className="flex flex-col items-center justify-center py-1.5 px-3 rounded-apple text-slate-400 hover:text-gold-300 transition-all active:scale-[0.94]"
          title="More Modules"
        >
          <span className="material-symbols-outlined text-[22px]">
            menu
          </span>
          <span className="text-[10px] tracking-tight mt-0.5">More</span>
        </button>
      </nav>
    </div>
  );
}
