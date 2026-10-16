'use client';

import React, { useState } from 'react';
import { DatabaseSchema, BusinessSettings, User, MenuItem, UserRole } from '../lib/types';
import { TableManagementSection } from './TableManagementSection';
import { LocationSettingsSection } from './LocationSettingsSection';

interface SettingsModuleProps {
  db: DatabaseSchema;
  currentUser: User;
  onUpdateSettings: (settings: Partial<BusinessSettings>) => Promise<void>;
  onAddMenuItem?: (data: any) => Promise<any>;
  onUpdateMenuItem?: (itemId: string, updates: any) => Promise<any>;
  onDeleteMenuItem?: (itemId: string) => Promise<any>;
  onUpdateRolePermissions?: (permissions: any) => Promise<any>;
  onAddUser?: (userData: any) => Promise<any>;
  onUpdateUser?: (userId: string, updates: any) => Promise<any>;
  onDeleteUser?: (userId: string) => Promise<any>;
  onAddTable?: (data: any) => Promise<any>;
  onUpdateTable?: (tableId: string, updates: any) => Promise<any>;
  onDeleteTable?: (tableId: string, force?: boolean) => Promise<any>;
}

export const SettingsModule: React.FC<SettingsModuleProps> = ({
  db,
  currentUser,
  onUpdateSettings,
  onAddMenuItem,
  onUpdateMenuItem,
  onDeleteMenuItem,
  onUpdateRolePermissions,
  onAddUser,
  onUpdateUser,
  onDeleteUser,
  onAddTable,
  onUpdateTable,
  onDeleteTable,
}) => {
  const [activeTab, setActiveTab] = useState<'tables' | 'location' | 'access' | 'menu' | 'users' | 'business' | 'audit'>('tables');

  // Business settings state
  const [settingsForm, setSettingsForm] = useState<BusinessSettings>({ ...db.settings });
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Logo upload state
  const [logoUploading, setLogoUploading] = useState(false);

  // Menu item image upload state
  const [newMenuImageFile, setNewMenuImageFile] = useState<File | null>(null);
  const [newMenuImageUrl, setNewMenuImageUrl] = useState('');
  const [menuImageUploading, setMenuImageUploading] = useState(false);

  // Menu management state in Settings
  const [menuSearch, setMenuSearch] = useState('');
  const [menuFilterCat, setMenuFilterCat] = useState('all');
  const [showAddMenuModal, setShowAddMenuModal] = useState(false);
  const [newMenuName, setNewMenuName] = useState('');
  const [newMenuCat, setNewMenuCat] = useState(db.categories[0]?.id || 'cat-1');
  const [newMenuPrice, setNewMenuPrice] = useState('');
  const [newMenuVeg, setNewMenuVeg] = useState<'veg' | 'non-veg' | 'egg'>('veg');
  const [newMenuDesc, setNewMenuDesc] = useState('');

  // User management state
  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [newUserName, setNewUserName] = useState('');
  const [newUserUsername, setNewUserUsername] = useState('');
  const [newUserRole, setNewUserRole] = useState<UserRole>('cashier');
  const [newUserPin, setNewUserPin] = useState('1234');

  // Interactive Role Permissions state
  const defaultPermissions: Record<string, Record<string, boolean>> = {
    dashboard: { manager: true, cashier: false, waiter: false, kitchen: false, staff: false },
    billing_create: { manager: true, cashier: true, waiter: true, kitchen: false, staff: false },
    billing_settle: { manager: true, cashier: true, waiter: false, kitchen: false, staff: false },
    billing_discount: { manager: true, cashier: false, waiter: false, kitchen: false, staff: false },
    menu_manage: { manager: true, cashier: false, waiter: false, kitchen: false, staff: false },
    staff_sensitive: { manager: false, cashier: false, waiter: false, kitchen: false, staff: false },
    attendance_manage: { manager: true, cashier: false, waiter: false, kitchen: false, staff: false },
    inventory_manage: { manager: true, cashier: false, waiter: false, kitchen: true, staff: false },
    finance_view: { manager: true, cashier: false, waiter: false, kitchen: false, staff: false },
    reports_export: { manager: true, cashier: false, waiter: false, kitchen: false, staff: false },
    settings_manage: { manager: false, cashier: false, waiter: false, kitchen: false, staff: false },
  };

  const [rolePermissions, setRolePermissions] = useState<Record<string, Record<string, boolean>>>(
    db.settings.rolePermissions || defaultPermissions
  );
  const [permSaved, setPermSaved] = useState(false);

  const capabilities = [
    { key: 'dashboard', label: 'Dashboard & Executive KPIs', desc: 'View live revenue, active tables & sales' },
    { key: 'billing_create', label: 'Create Orders & Print KOT', desc: 'Select tables, add dishes and place kitchen orders' },
    { key: 'billing_settle', label: 'Settle Bills & Collect Cash/UPI', desc: 'Take payments, finalize receipts, mark bills paid' },
    { key: 'billing_discount', label: 'Apply Discounts & Cancel Bills', desc: 'Authorize ticket discounts (PIN required for Manager)' },
    { key: 'menu_manage', label: 'Add & Edit Menu Dishes', desc: 'Add new recipes, modify prices, toggle availability' },
    { key: 'staff_sensitive', label: 'View Sensitive Staff Data', desc: 'Access employee Aadhaar, bank account & salaries' },
    { key: 'attendance_manage', label: 'Biometric Overrides & Leave', desc: 'Override clock-ins and approve leave requests' },
    { key: 'inventory_manage', label: 'Kitchen Stock In & Deductions', desc: 'Record grocery purchases, cooking usage and wastage' },
    { key: 'finance_view', label: 'Finance, P&L & Expenses', desc: 'Review real-time profit & loss, settle liabilities' },
    { key: 'reports_export', label: 'Export Tax, GST & Sales Reports', desc: 'Download statutory CSV statements and print PDFs' },
    { key: 'settings_manage', label: 'Configure Website & Handover', desc: 'Edit restaurant legal info, GSTIN, FSSAI and roles' },
  ];

  const handleTogglePermission = (capKey: string, role: string) => {
    setRolePermissions((prev) => ({
      ...prev,
      [capKey]: {
        ...(prev[capKey] || {}),
        [role]: !prev[capKey]?.[role],
      },
    }));
  };

  const handleSavePermissions = async () => {
    if (onUpdateRolePermissions) {
      await onUpdateRolePermissions(rolePermissions);
    }
    setPermSaved(true);
    setTimeout(() => setPermSaved(false), 3000);
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    await onUpdateSettings(settingsForm);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 3000);
  };

  const handleExportBackup = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(db, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `united_food_palace_backup_${new Date().toISOString().split('T')[0]}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLogoUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('bucket', 'branding');
      const res = await fetch('/api/upload', { method: 'POST', body: formData });
      const json = await res.json();
      if (json.success) {
        setSettingsForm((prev) => ({ ...prev, logoUrl: json.url }));
        await onUpdateSettings({ logoUrl: json.url });
      } else {
        alert(`Logo upload failed: ${json.message}`);
      }
    } catch (err: any) {
      alert(`Logo upload error: ${err.message}`);
    } finally {
      setLogoUploading(false);
    }
  };

  const handleCreateMenuItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMenuName.trim() || !newMenuPrice) return;

    let finalImageUrl = newMenuImageUrl;
    if (newMenuImageFile && !finalImageUrl) {
      setMenuImageUploading(true);
      try {
        const formData = new FormData();
        formData.append('file', newMenuImageFile);
        formData.append('bucket', 'menu-dishes');
        const upRes = await fetch('/api/upload', { method: 'POST', body: formData });
        const upJson = await upRes.json();
        if (upJson.success) {
          finalImageUrl = upJson.url;
        }
      } catch (err) {
        console.error('Menu image upload failed:', err);
      } finally {
        setMenuImageUploading(false);
      }
    }

    if (onAddMenuItem) {
      await onAddMenuItem({
        name: newMenuName.trim(),
        categoryId: newMenuCat,
        priceRs: Number(newMenuPrice),
        vegType: newMenuVeg,
        description: newMenuDesc.trim(),
        imageUrl: finalImageUrl || undefined,
      });
    }
    setShowAddMenuModal(false);
    setNewMenuName('');
    setNewMenuPrice('');
    setNewMenuDesc('');
    setNewMenuImageFile(null);
    setNewMenuImageUrl('');
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUserName.trim() || !newUserUsername.trim()) return;
    if (onAddUser) {
      await onAddUser({
        name: newUserName.trim(),
        username: newUserUsername.trim(),
        role: newUserRole,
        pin: newUserPin,
      });
    }
    setShowAddUserModal(false);
    setNewUserName('');
    setNewUserUsername('');
    setNewUserPin('1234');
  };

  const filteredMenuItems = db.menuItems.filter((i) => {
    if (menuFilterCat !== 'all' && i.categoryId !== menuFilterCat) return false;
    if (menuSearch.trim() && !i.name.toLowerCase().includes(menuSearch.toLowerCase())) return false;
    return true;
  });


  return (
    <div className="p-3 sm:p-5 lg:p-8 max-w-7xl mx-auto space-y-3.5 sm:space-y-6 pb-24 md:pb-8">
      {/* 1. Navigation Tabs - Apple Segmented Control (Smooth horizontal swipe on mobile & tablet) */}
      <div className="ios27-glass-card p-2 sm:p-2.5 rounded-[18px] sm:rounded-[22px] flex items-center max-w-full min-w-0">
        <div className="w-full max-w-full min-w-0 overflow-x-auto no-scrollbar scrollbar-none flex items-center gap-1 sm:gap-1.5 bg-black/[0.04] p-1 rounded-apple text-xs font-semibold touch-pan-x">
          <button
            onClick={() => setActiveTab('tables')}
            className={`px-3 sm:px-3.5 py-1.5 rounded-apple-sm transition-all active:scale-[0.97] flex items-center gap-1.5 shrink-0 whitespace-nowrap ${
              activeTab === 'tables'
                ? 'bg-[#05271f] text-gold-300 font-semibold shadow-apple-subtle'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <span className="material-symbols-outlined text-[15px]">table_restaurant</span>
            <span>Floor &amp; Tables ({db.tables.length})</span>
          </button>
          <button
            onClick={() => setActiveTab('location')}
            className={`px-3 sm:px-3.5 py-1.5 rounded-apple-sm transition-all active:scale-[0.97] flex items-center gap-1.5 shrink-0 whitespace-nowrap ${
              activeTab === 'location'
                ? 'bg-[#05271f] text-gold-300 font-semibold shadow-apple-subtle'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <span className="material-symbols-outlined text-[15px]">location_on</span>
            <span>Location &amp; Geofence</span>
          </button>
          <button
            onClick={() => setActiveTab('menu')}
            className={`px-3 sm:px-3.5 py-1.5 rounded-apple-sm transition-all active:scale-[0.97] shrink-0 whitespace-nowrap ${
              activeTab === 'menu'
                ? 'bg-[#05271f] text-gold-300 font-semibold shadow-apple-subtle'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Menu Catalog ({db.menuItems.length})
          </button>
          <button
            onClick={() => setActiveTab('access')}
            className={`px-3 sm:px-3.5 py-1.5 rounded-apple-sm transition-all active:scale-[0.97] shrink-0 whitespace-nowrap ${
              activeTab === 'access'
                ? 'bg-[#05271f] text-gold-300 font-semibold shadow-apple-subtle'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Access Setup &amp; Roles
          </button>
          <button
            onClick={() => setActiveTab('users')}
            className={`px-3 sm:px-3.5 py-1.5 rounded-apple-sm transition-all active:scale-[0.97] shrink-0 whitespace-nowrap ${
              activeTab === 'users'
                ? 'bg-[#05271f] text-gold-300 font-semibold shadow-apple-subtle'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Users &amp; Logins ({db.users.length})
          </button>
          <button
            onClick={() => setActiveTab('business')}
            className={`px-3 sm:px-3.5 py-1.5 rounded-apple-sm transition-all active:scale-[0.97] shrink-0 whitespace-nowrap ${
              activeTab === 'business'
                ? 'bg-[#05271f] text-gold-300 font-semibold shadow-apple-subtle'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Business &amp; GST
          </button>
          <button
            onClick={() => setActiveTab('audit')}
            className={`px-3 sm:px-3.5 py-1.5 rounded-apple-sm transition-all active:scale-[0.97] shrink-0 whitespace-nowrap ${
              activeTab === 'audit'
                ? 'bg-[#05271f] text-gold-300 font-semibold shadow-apple-subtle'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Audit Trail ({db.auditLogs.length})
          </button>
        </div>
      </div>

      {/* 2. Sub Tab: Floor & Tables Configuration */}
      {activeTab === 'tables' && (
        <TableManagementSection
          db={db}
          currentUser={currentUser}
          onAddTable={onAddTable}
          onUpdateTable={onUpdateTable}
          onDeleteTable={onDeleteTable}
        />
      )}

      {/* 2b. Sub Tab: Location & Attendance Geofence */}
      {activeTab === 'location' && (
        <LocationSettingsSection
          settings={db.settings}
          currentUser={currentUser}
          onUpdateSettings={onUpdateSettings}
        />
      )}

      {/* 3. Sub Tab: Access Setup & Role Permissions Matrix */}
      {activeTab === 'access' && (
        <div className="ios27-glass-card rounded-[24px] overflow-hidden space-y-4 p-6">
          <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-100">
            <div>
              <h3 className="text-base font-bold text-slate-900 tracking-tight">
                Website-Wide Role Permissions Setup
              </h3>
              <p className="text-xs text-slate-500 mt-0.5 font-medium">
                Admin controls capabilities for all roles across the entire website. Changes take effect immediately.
              </p>
            </div>
            <div className="flex items-center gap-3">
              {permSaved && (
                <span className="px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-semibold flex items-center gap-1.5 animate-in fade-in">
                  <span className="material-symbols-outlined text-sm">check_circle</span> Permissions saved!
                </span>
              )}
              <button
                onClick={handleSavePermissions}
                className="ios27-btn-small px-4 rounded-apple bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-apple-subtle transition-all flex items-center gap-1.5"
              >
                <span className="material-symbols-outlined text-base">save</span>
                Save Access Permissions
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 border-b border-slate-200/80 text-slate-500 font-bold uppercase tracking-wider text-[11px]">
                <tr>
                  <th className="py-3 px-4">System Capability</th>
                  <th className="py-3 px-4 text-emerald-700 font-black">Admin (Owner)</th>
                  <th className="py-3 px-4 text-slate-700">Manager</th>
                  <th className="py-3 px-4 text-slate-700">Cashier</th>
                  <th className="py-3 px-4 text-slate-700">Waiter</th>
                  <th className="py-3 px-4 text-slate-700">Kitchen</th>
                  <th className="py-3 px-4 text-slate-700">Staff</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {capabilities.map((cap) => (
                  <tr key={cap.key} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-3 px-4">
                      <div className="flex flex-col">
                        <span className="font-bold text-slate-900 text-xs">{cap.label}</span>
                        <span className="text-[11px] text-slate-500">{cap.desc}</span>
                      </div>
                    </td>
                    {/* Admin always has full access */}
                    <td className="py-3 px-4">
                      <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-black text-[11px] border border-emerald-200">
                        Full Access
                      </span>
                    </td>
                    {/* Manager, Cashier, Waiter, Kitchen, Staff interactive toggles */}
                    {(['manager', 'cashier', 'waiter', 'kitchen', 'staff'] as const).map((r) => {
                      const isChecked = !!rolePermissions[cap.key]?.[r];
                      return (
                        <td key={r} className="py-3 px-4">
                          <label className="inline-flex items-center cursor-pointer">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => handleTogglePermission(cap.key, r)}
                              className="sr-only peer"
                            />
                            <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-600 relative"></div>
                          </label>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 3. Sub Tab: Menu Management & Catalog */}
      {activeTab === 'menu' && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200/80 overflow-hidden space-y-4 p-6">
          <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-100">
            <div>
              <h3 className="text-base font-bold text-slate-900">
                Central Menu &amp; Recipe Management
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Add, edit pricing, or toggle availability for dishes. All additions instantly sync to POS counters.
              </p>
            </div>
            <button
              onClick={() => setShowAddMenuModal(true)}
              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-sm transition-all flex items-center gap-1.5"
            >
              <span className="material-symbols-outlined text-base">add_circle</span>
              + Add New Dish to Menu
            </button>
          </div>

          {/* Filter Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-1.5 overflow-x-auto py-1">
              <button
                onClick={() => setMenuFilterCat('all')}
                className={`px-3 py-1.5 rounded-xl font-bold whitespace-nowrap transition-all ${
                  menuFilterCat === 'all'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                All ({db.menuItems.length})
              </button>
              {db.categories.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setMenuFilterCat(c.id)}
                  className={`px-3 py-1.5 rounded-xl font-bold whitespace-nowrap transition-all ${
                    menuFilterCat === c.id
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {c.name}
                </button>
              ))}
            </div>

            <div className="relative w-64">
              <span className="material-symbols-outlined absolute left-3 top-2.5 text-base text-slate-400">search</span>
              <input
                type="text"
                placeholder="Search dish or recipe..."
                value={menuSearch}
                onChange={(e) => setMenuSearch(e.target.value)}
                className="w-full h-9 pl-9 pr-3 text-xs rounded-xl bg-slate-50 border border-slate-200 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
              />
            </div>
          </div>

          {/* Menu Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 border-b border-slate-200/80 text-slate-500 font-bold uppercase tracking-wider text-[11px]">
                <tr>
                  <th className="py-3 px-4">Dish Name</th>
                  <th className="py-3 px-4">Dietary Type</th>
                  <th className="py-3 px-4">Category</th>
                  <th className="py-3 px-4">Selling Price</th>
                  <th className="py-3 px-4">GST Rate</th>
                  <th className="py-3 px-4">Kitchen Availability</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredMenuItems.slice(0, 20).map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-3 px-4">
                      <div className="flex flex-col">
                        <span className="font-bold text-slate-900 text-xs">{item.name}</span>
                        <span className="text-[10px] text-slate-400 truncate max-w-xs">{item.description || 'Standard portion'}</span>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                        item.vegType === 'veg' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-rose-50 text-rose-700 border border-rose-200'
                      }`}>
                        {item.vegType}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-slate-600">
                      {db.categories.find((c) => c.id === item.categoryId)?.name || 'General'}
                    </td>
                    <td className="py-3 px-4 font-mono font-bold text-slate-900">
                      ₹{(item.pricePaise / 100).toFixed(0)}
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-500">{item.gstPercent}%</td>
                    <td className="py-3 px-4">
                      <button
                        onClick={async () => {
                          if (onUpdateMenuItem) {
                            await onUpdateMenuItem(item.id, { isAvailable: !item.isAvailable });
                          }
                        }}
                        className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border transition-all ${
                          item.isAvailable
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                            : 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100'
                        }`}
                      >
                        {item.isAvailable ? 'In Stock (Active)' : 'Out of Stock'}
                      </button>
                    </td>
                    <td className="py-3 px-4 text-right space-x-1">
                      {onDeleteMenuItem && (
                        <button
                          onClick={async () => {
                            if (confirm(`Remove "${item.name}" from active menu?`)) {
                              await onDeleteMenuItem(item.id);
                            }
                          }}
                          className="px-2.5 py-1 rounded-lg text-rose-600 hover:bg-rose-50 font-bold transition-colors"
                        >
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 4. Sub Tab: Users & Logins Management */}
      {activeTab === 'users' && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200/80 overflow-hidden space-y-4 p-6">
          <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-100">
            <div>
              <h3 className="text-base font-bold text-slate-900">
                Authorized Operators &amp; User Accounts
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Configure login credentials, role assignments, and authorization PINs for staff members.
              </p>
            </div>
            <button
              onClick={() => setShowAddUserModal(true)}
              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-sm transition-all flex items-center gap-1.5"
            >
              <span className="material-symbols-outlined text-base">person_add</span>
              + Add New Operator
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 border-b border-slate-200/80 text-slate-500 font-bold uppercase tracking-wider text-[11px]">
                <tr>
                  <th className="py-3 px-4">Operator Name</th>
                  <th className="py-3 px-4">Username</th>
                  <th className="py-3 px-4">Assigned Role</th>
                  <th className="py-3 px-4">Authorization PIN</th>
                  <th className="py-3 px-4">Account Status</th>
                  <th className="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {db.users.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-3 px-4 font-bold text-slate-900">{u.name}</td>
                    <td className="py-3 px-4 font-mono text-slate-500">{u.username}</td>
                    <td className="py-3 px-4">
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-800 border border-slate-200">
                        {u.role}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-mono font-bold text-slate-700">
                      {currentUser.role === 'admin' ? (u.pin || '1234') : '••••'}
                    </td>
                    <td className="py-3 px-4">
                      <span className="px-2 py-0.5 rounded-full text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold">
                        Active
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      {currentUser.role === 'admin' && onDeleteUser ? (
                        <button
                          type="button"
                          onClick={async () => {
                            if (u.id === currentUser.id) {
                              alert('You cannot delete your own active administrator account.');
                              return;
                            }
                            if (confirm(`Are you sure you want to delete login account "${u.name}" (@${u.username} / ${u.role})? They will immediately lose access.`)) {
                              await onDeleteUser(u.id);
                            }
                          }}
                          className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                            u.id === currentUser.id
                              ? 'text-slate-300 cursor-not-allowed'
                              : 'text-rose-600 hover:bg-rose-50 hover:text-rose-700'
                          }`}
                          disabled={u.id === currentUser.id}
                          title={u.id === currentUser.id ? 'Cannot delete current account' : `Delete login for ${u.name}`}
                        >
                          <span className="flex items-center gap-1">
                            <span className="material-symbols-outlined text-sm">delete</span>
                            <span>Delete</span>
                          </span>
                        </button>
                      ) : (
                        <span className="text-[11px] text-slate-400 font-medium">Verified</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 5. Sub Tab: Business & Tax Profile */}
      {activeTab === 'business' && (
        <form onSubmit={handleSaveSettings} className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200/80 space-y-5 text-xs">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Business &amp; Statutory Configuration</h3>
              <p className="text-slate-500">These parameters are rendered onto printed 80mm thermal bills and official tax reports.</p>
            </div>
            {saveSuccess && (
              <span className="px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold flex items-center gap-1.5 animate-in fade-in">
                <span className="material-symbols-outlined text-sm">check_circle</span> Changes saved successfully!
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="font-bold text-slate-700">Restaurant Legal / Trade Name *</label>
              <input
                type="text"
                value={settingsForm.restaurantName}
                onChange={(e) => setSettingsForm({ ...settingsForm, restaurantName: e.target.value })}
                className="w-full h-10 px-3.5 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 font-medium"
              />
            </div>
            <div className="space-y-1">
              <label className="font-bold text-slate-700">Brand Tagline</label>
              <input
                type="text"
                value={settingsForm.tagline}
                onChange={(e) => setSettingsForm({ ...settingsForm, tagline: e.target.value })}
                className="w-full h-10 px-3.5 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="font-bold text-slate-700">Official Phone Number</label>
              <input
                type="text"
                value={settingsForm.phone || ''}
                onChange={(e) => setSettingsForm({ ...settingsForm, phone: e.target.value })}
                placeholder="+91 80 2345 6789"
                className="w-full h-10 px-3.5 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 font-mono"
              />
            </div>
            <div className="space-y-1">
              <label className="font-bold text-slate-700">Official Email Address</label>
              <input
                type="email"
                value={settingsForm.email || ''}
                onChange={(e) => setSettingsForm({ ...settingsForm, email: e.target.value })}
                placeholder="contact@unitedfoodpalace.com"
                className="w-full h-10 px-3.5 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="font-bold text-slate-700">GSTIN Number (15 Characters) *</label>
              <input
                type="text"
                value={settingsForm.gstin}
                onChange={(e) => setSettingsForm({ ...settingsForm, gstin: e.target.value })}
                className="w-full h-10 px-3.5 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 font-mono font-bold"
              />
            </div>
            <div className="space-y-1">
              <label className="font-bold text-slate-700">FSSAI License Number (14 Digits) *</label>
              <input
                type="text"
                value={settingsForm.fssai}
                onChange={(e) => setSettingsForm({ ...settingsForm, fssai: e.target.value })}
                className="w-full h-10 px-3.5 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 font-mono font-bold"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1">
              <label className="font-bold text-slate-700">CGST Rate (%)</label>
              <input
                type="number"
                step="0.1"
                value={settingsForm.cgstPercent}
                onChange={(e) => setSettingsForm({ ...settingsForm, cgstPercent: Number(e.target.value) })}
                className="w-full h-10 px-3.5 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 font-mono font-bold"
              />
            </div>
            <div className="space-y-1">
              <label className="font-bold text-slate-700">SGST Rate (%)</label>
              <input
                type="number"
                step="0.1"
                value={settingsForm.sgstPercent}
                onChange={(e) => setSettingsForm({ ...settingsForm, sgstPercent: Number(e.target.value) })}
                className="w-full h-10 px-3.5 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 font-mono font-bold"
              />
            </div>
            <div className="space-y-1">
              <label className="font-bold text-slate-700">Service Charge (%)</label>
              <input
                type="number"
                value={settingsForm.serviceChargePercent}
                onChange={(e) => setSettingsForm({ ...settingsForm, serviceChargePercent: Number(e.target.value) })}
                className="w-full h-10 px-3.5 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 font-mono font-bold"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-3.5 rounded-xl bg-slate-50 border border-slate-200">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={settingsForm.serviceChargeEnabled ?? false}
                onChange={(e) => setSettingsForm({ ...settingsForm, serviceChargeEnabled: e.target.checked })}
                className="w-4 h-4 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500"
              />
              <div>
                <span className="font-bold text-slate-800 text-xs">Enable Service Charge</span>
                <p className="text-[11px] text-slate-500">Automatically calculate and levy service charge on guest billing</p>
              </div>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={settingsForm.roundOff ?? true}
                onChange={(e) => setSettingsForm({ ...settingsForm, roundOff: e.target.checked })}
                className="w-4 h-4 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500"
              />
              <div>
                <span className="font-bold text-slate-800 text-xs">Enable Auto Round-off</span>
                <p className="text-[11px] text-slate-500">Round off final bill totals to the nearest integer rupee</p>
              </div>
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="font-bold text-slate-700">Official Postal Address</label>
              <textarea
                rows={3}
                value={settingsForm.address}
                onChange={(e) => setSettingsForm({ ...settingsForm, address: e.target.value })}
                className="w-full p-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
              />
            </div>
            <div className="space-y-1">
              <label className="font-bold text-slate-700">80mm Bill Footer Message</label>
              <textarea
                rows={3}
                value={settingsForm.billFooter}
                onChange={(e) => setSettingsForm({ ...settingsForm, billFooter: e.target.value })}
                className="w-full p-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
              />
            </div>
          </div>

          {/* Restaurant Brand Logo */}
          <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 flex flex-wrap items-center justify-between gap-4">
            <div>
              <span className="font-bold text-slate-800 text-xs flex items-center gap-1.5">
                <span className="material-symbols-outlined text-emerald-600 text-base">cloud_upload</span>
                Restaurant Brand Logo
              </span>
              <p className="text-[11px] text-slate-500">
                Displayed on receipts &amp; reports. Max size: 2MB.
              </p>
            </div>
            <div className="flex items-center gap-3">
              {settingsForm.logoUrl && (
                <img
                  src={settingsForm.logoUrl}
                  alt="Brand Logo"
                  className="h-10 w-auto max-w-[120px] object-contain rounded-lg border border-slate-200 bg-white p-1"
                />
              )}
              <input
                type="file"
                accept="image/*"
                onChange={handleLogoUpload}
                disabled={logoUploading}
                className="text-xs text-slate-600 file:mr-2 file:py-1.5 file:px-3 file:rounded-xl file:border-0 file:text-xs file:font-bold file:bg-emerald-600 file:text-white hover:file:bg-emerald-700"
              />
              {logoUploading && (
                <span className="text-xs font-semibold text-emerald-700 animate-pulse">Uploading...</span>
              )}
            </div>
          </div>

          <div className="flex justify-end pt-3 border-t border-slate-100">
            <button
              type="submit"
              className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold shadow-sm transition-all flex items-center gap-1.5 text-xs"
            >
              <span className="material-symbols-outlined text-base">save</span>
              Save Business Profile Changes
            </button>
          </div>
        </form>
      )}

      {/* 6. Sub Tab: Audit Trail */}
      {activeTab === 'audit' && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200/80 overflow-hidden">
          <div className="p-4 border-b border-slate-200/80 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-slate-900">System Audit Trail</h3>
              <p className="text-xs text-slate-500">
                Immutable ledger of bill modifications, discount overrides, manual PIN actions, and setting updates.
              </p>
            </div>
            <span className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-600 text-xs font-semibold">
              {db.auditLogs.length} Total Logs
            </span>
          </div>

          <div className="overflow-x-auto max-h-[500px]">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 border-b border-slate-200/80 text-slate-500 font-bold uppercase tracking-wider text-[11px] sticky top-0">
                <tr>
                  <th className="py-3 px-4">Timestamp</th>
                  <th className="py-3 px-4">User</th>
                  <th className="py-3 px-4">Role</th>
                  <th className="py-3 px-4">Action</th>
                  <th className="py-3 px-4">Entity</th>
                  <th className="py-3 px-4">Change / Detail</th>
                  <th className="py-3 px-4">Reason / Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {db.auditLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-3 px-4 font-mono text-slate-500 text-[11px]">{log.timestamp}</td>
                    <td className="py-3 px-4 font-bold text-slate-900">{log.userName}</td>
                    <td className="py-3 px-4 uppercase text-slate-500 text-[10px] font-bold">{log.userRole}</td>
                    <td className="py-3 px-4">
                      <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 font-mono font-bold text-[10px]">
                        {log.action}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-medium text-slate-800">{log.entityType} ({log.entityId})</td>
                    <td className="py-3 px-4 font-mono text-slate-600">{log.newValue || log.oldValue || '—'}</td>
                    <td className="py-3 px-4 text-slate-500">{log.reason || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* End of Settings sub tabs */}

      {/* Add Menu Item Modal (In Settings) */}
      {showAddMenuModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white max-w-md w-full rounded-2xl shadow-2xl border border-slate-200 p-6 space-y-4 animate-in fade-in zoom-in duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900">Add Dish to Catalog</h3>
              <button
                onClick={() => setShowAddMenuModal(false)}
                className="w-8 h-8 rounded-lg text-slate-400 hover:text-slate-600 flex items-center justify-center"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <form onSubmit={handleCreateMenuItem} className="space-y-3 text-xs">
              <div className="space-y-1">
                <label className="font-bold text-slate-700">Dish Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Kadai Paneer"
                  value={newMenuName}
                  onChange={(e) => setNewMenuName(e.target.value)}
                  className="w-full h-10 px-3.5 rounded-xl border border-slate-200 bg-slate-50 text-slate-900 focus:bg-white"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Category</label>
                  <select
                    value={newMenuCat}
                    onChange={(e) => setNewMenuCat(e.target.value)}
                    className="w-full h-10 px-3 rounded-xl border border-slate-200 bg-slate-50"
                  >
                    {db.categories.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Selling Price (₹) *</label>
                  <input
                    type="number"
                    required
                    placeholder="250"
                    value={newMenuPrice}
                    onChange={(e) => setNewMenuPrice(e.target.value)}
                    className="w-full h-10 px-3 rounded-xl border border-slate-200 bg-slate-50 font-mono font-bold"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <label className="font-bold text-slate-700">Type</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['veg', 'non-veg', 'egg'] as const).map((vt) => (
                    <button
                      key={vt}
                      type="button"
                      onClick={() => setNewMenuVeg(vt)}
                      className={`py-2 px-3 rounded-xl border font-bold capitalize ${
                        newMenuVeg === vt ? 'bg-emerald-50 text-emerald-800 border-emerald-500' : 'bg-slate-50 text-slate-600'
                      }`}
                    >
                      {vt}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1">
                <label className="font-bold text-slate-700">Description</label>
                <textarea
                  rows={2}
                  value={newMenuDesc}
                  onChange={(e) => setNewMenuDesc(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-slate-200 bg-slate-50"
                />
              </div>
              <div className="space-y-1">
                <label className="font-bold text-slate-700 flex items-center justify-between">
                  <span>Dish Photo</span>

                </label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => setNewMenuImageFile(e.target.files?.[0] || null)}
                  className="w-full text-xs text-slate-600 file:mr-2 file:py-1 file:px-2.5 file:rounded-xl file:border-0 file:text-[11px] file:font-bold file:bg-slate-200 file:text-slate-800"
                />
                {newMenuImageFile && (
                  <span className="text-[10px] text-emerald-700 font-bold block">
                    ✓ {newMenuImageFile.name} ({Math.round(newMenuImageFile.size / 1024)} KB)
                  </span>
                )}
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t">
                <button
                  type="button"
                  onClick={() => setShowAddMenuModal(false)}
                  className="px-4 py-2 rounded-xl text-slate-600 hover:bg-slate-100 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-emerald-600 text-white font-bold"
                >
                  Save Dish
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add User Modal */}
      {showAddUserModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white max-w-md w-full rounded-2xl shadow-2xl border border-slate-200 p-6 space-y-4 animate-in fade-in zoom-in duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900">Add Operator Account</h3>
              <button
                onClick={() => setShowAddUserModal(false)}
                className="w-8 h-8 rounded-lg text-slate-400 hover:text-slate-600 flex items-center justify-center"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <form onSubmit={handleCreateUser} className="space-y-3 text-xs">
              <div className="space-y-1">
                <label className="font-bold text-slate-700">Full Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Ramesh Gowda"
                  value={newUserName}
                  onChange={(e) => setNewUserName(e.target.value)}
                  className="w-full h-10 px-3.5 rounded-xl border border-slate-200 bg-slate-50"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Username *</label>
                  <input
                    type="text"
                    required
                    placeholder="ramesh"
                    value={newUserUsername}
                    onChange={(e) => setNewUserUsername(e.target.value)}
                    className="w-full h-10 px-3.5 rounded-xl border border-slate-200 bg-slate-50 font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-bold text-slate-700">Assigned System Role *</label>
                  <select
                    value={newUserRole}
                    onChange={(e) => setNewUserRole(e.target.value as any)}
                    className="w-full h-10 px-3 rounded-xl border border-slate-200 bg-slate-50 font-medium text-slate-900"
                  >
                    <option value="admin">Admin (Executive Owner)</option>
                    <option value="manager">Manager (General Manager)</option>
                    <option value="cashier">Cashier (Billing &amp; Cashier)</option>
                    <option value="waiter">Waiter (Floor Steward / Waiter)</option>
                    <option value="kitchen">Kitchen (Kitchen Station KDS)</option>
                    <option value="staff">Staff (Staff Member / Biometrics)</option>
                  </select>
                </div>
              </div>
              <div className="space-y-1">
                <label className="font-bold text-slate-700">Manager Override PIN</label>
                <input
                  type="text"
                  placeholder="1234"
                  value={newUserPin}
                  onChange={(e) => setNewUserPin(e.target.value)}
                  className="w-full h-10 px-3.5 rounded-xl border border-slate-200 bg-slate-50 font-mono font-bold"
                />
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t">
                <button
                  type="button"
                  onClick={() => setShowAddUserModal(false)}
                  className="px-4 py-2 rounded-xl text-slate-600 hover:bg-slate-100 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-emerald-600 text-white font-bold"
                >
                  Create Account
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
