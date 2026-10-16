'use client';

import React, { useState, useMemo } from 'react';
import { DatabaseSchema, RestaurantTable, User, TableSection, TableStatus } from '../lib/types';

interface TableManagementSectionProps {
  db: DatabaseSchema;
  currentUser: User;
  onAddTable?: (data: any) => Promise<any>;
  onUpdateTable?: (tableId: string, updates: any) => Promise<any>;
  onDeleteTable?: (tableId: string, force?: boolean) => Promise<any>;
}

export const TableManagementSection: React.FC<TableManagementSectionProps> = ({
  db,
  currentUser,
  onAddTable,
  onUpdateTable,
  onDeleteTable,
}) => {
  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSection, setSelectedSection] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'number' | 'capacity' | 'status'>('number');

  // Modal states
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingTable, setEditingTable] = useState<RestaurantTable | null>(null);
  const [deletingTable, setDeletingTable] = useState<RestaurantTable | null>(null);
  const [forceDelete, setForceDelete] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // Form states for Add / Edit
  const [formTableNumber, setFormTableNumber] = useState('');
  const [formSection, setFormSection] = useState<string>('AC Grand Hall');
  const [isCustomSection, setIsCustomSection] = useState(false);
  const [customSectionName, setCustomSectionName] = useState('');
  const [formCapacity, setFormCapacity] = useState<number>(4);
  const [formStatus, setFormStatus] = useState<TableStatus>('vacant');

  // Dynamic unique sections extracted from database tables
  const existingSections = useMemo(() => {
    const defaultSections = ['AC Grand Hall', 'Royal Family Suite', 'Garden Patio'];
    const dbSections = db.tables.map((t) => t.section).filter(Boolean);
    return Array.from(new Set([...defaultSections, ...dbSections]));
  }, [db.tables]);

  // Summary Metrics
  const totalTables = db.tables.length;
  const totalSeats = db.tables.reduce((acc, t) => acc + (t.capacity || 0), 0);
  const occupiedTables = db.tables.filter((t) => t.status === 'occupied' || t.status === 'bill_printed');
  const vacantTables = db.tables.filter((t) => t.status === 'vacant');
  const reservedTables = db.tables.filter((t) => t.status === 'reserved');
  const occupancyRate = totalTables > 0 ? Math.round((occupiedTables.length / totalTables) * 100) : 0;

  // Filtered & Sorted Tables
  const filteredTables = useMemo(() => {
    let result = [...db.tables];

    // Filter by Section
    if (selectedSection !== 'all') {
      result = result.filter((t) => t.section === selectedSection);
    }

    // Filter by Status
    if (selectedStatus !== 'all') {
      result = result.filter((t) => t.status === selectedStatus);
    }

    // Filter by Search Query (Table number, section, steward)
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(
        (t) =>
          t.tableNumber.toLowerCase().includes(q) ||
          t.section.toLowerCase().includes(q) ||
          (t.assignedSteward && t.assignedSteward.toLowerCase().includes(q))
      );
    }

    // Sorting
    result.sort((a, b) => {
      if (sortBy === 'number') {
        return a.tableNumber.localeCompare(b.tableNumber, undefined, { numeric: true, sensitivity: 'base' });
      }
      if (sortBy === 'capacity') {
        return b.capacity - a.capacity;
      }
      if (sortBy === 'status') {
        return a.status.localeCompare(b.status);
      }
      return 0;
    });

    return result;
  }, [db.tables, selectedSection, selectedStatus, searchQuery, sortBy]);

  // Open Add Modal
  const handleOpenAddModal = () => {
    setErrorMessage('');
    setFormTableNumber('');
    setFormSection(existingSections[0] || 'AC Grand Hall');
    setIsCustomSection(false);
    setCustomSectionName('');
    setFormCapacity(4);
    setFormStatus('vacant');
    setShowAddModal(true);
  };

  // Open Edit Modal
  const handleOpenEditModal = (tbl: RestaurantTable) => {
    setErrorMessage('');
    setEditingTable(tbl);
    setFormTableNumber(tbl.tableNumber);
    if (existingSections.includes(tbl.section)) {
      setFormSection(tbl.section);
      setIsCustomSection(false);
      setCustomSectionName('');
    } else {
      setFormSection('__custom__');
      setIsCustomSection(true);
      setCustomSectionName(tbl.section);
    }
    setFormCapacity(tbl.capacity);
    setFormStatus(tbl.status);
  };

  // Submit Add Table
  const handleSubmitAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formTableNumber.trim()) {
      setErrorMessage('Please enter a table number.');
      return;
    }

    const finalSection = isCustomSection ? customSectionName.trim() : formSection;
    if (!finalSection) {
      setErrorMessage('Please specify a dining section.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage('');
    try {
      if (onAddTable) {
        const res = await onAddTable({
          tableNumber: formTableNumber.trim(),
          section: finalSection,
          capacity: formCapacity,
          status: formStatus,
        });
        if (res && !res.success) {
          setErrorMessage(res.message || 'Failed to add table.');
          setIsSubmitting(false);
          return;
        }
      }
      setShowAddModal(false);
    } catch (err: any) {
      setErrorMessage(err.message || 'Error creating table.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Submit Edit Table
  const handleSubmitEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTable) return;
    if (!formTableNumber.trim()) {
      setErrorMessage('Please enter a table number.');
      return;
    }

    const finalSection = isCustomSection ? customSectionName.trim() : formSection;
    if (!finalSection) {
      setErrorMessage('Please specify a dining section.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage('');
    try {
      if (onUpdateTable) {
        const res = await onUpdateTable(editingTable.id, {
          tableNumber: formTableNumber.trim(),
          section: finalSection,
          capacity: formCapacity,
          status: formStatus,
        });
        if (res && !res.success) {
          setErrorMessage(res.message || 'Failed to update table.');
          setIsSubmitting(false);
          return;
        }
      }
      setEditingTable(null);
    } catch (err: any) {
      setErrorMessage(err.message || 'Error updating table.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Quick Status Toggle (Vacant <-> Reserved)
  const handleQuickStatusToggle = async (tbl: RestaurantTable) => {
    if (tbl.status === 'occupied' || tbl.status === 'bill_printed') {
      alert(`Table ${tbl.tableNumber} is currently occupied with active guests.`);
      return;
    }
    const nextStatus: TableStatus = tbl.status === 'reserved' ? 'vacant' : 'reserved';
    if (onUpdateTable) {
      await onUpdateTable(tbl.id, { status: nextStatus });
    }
  };

  // Execute Delete Table
  const handleConfirmDelete = async () => {
    if (!deletingTable) return;
    setIsSubmitting(true);
    setErrorMessage('');
    try {
      if (onDeleteTable) {
        const res = await onDeleteTable(deletingTable.id, forceDelete);
        if (res && !res.success) {
          setErrorMessage(res.message || 'Failed to delete table.');
          setIsSubmitting(false);
          return;
        }
      }
      setDeletingTable(null);
      setForceDelete(false);
    } catch (err: any) {
      setErrorMessage(err.message || 'Error deleting table.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-4 sm:space-y-5 pb-28 md:pb-8">
      {/* 1. Floor & Capacity Overview Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 sm:gap-3.5">
        {/* Total Tables */}
        <div className="ios27-glass-card p-3 sm:p-4 rounded-[18px] sm:rounded-[22px] shadow-apple-card flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-slate-600">Total Tables</span>
            <span className="material-symbols-outlined text-base sm:text-lg text-slate-700">table_restaurant</span>
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight tabular-nums">{totalTables}</span>
            <span className="text-[10px] sm:text-[11px] text-slate-500 font-medium">Configured</span>
          </div>
        </div>

        {/* Total Seating Capacity */}
        <div className="ios27-glass-card p-3 sm:p-4 rounded-[18px] sm:rounded-[22px] shadow-apple-card flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-slate-600">Seating Capacity</span>
            <span className="material-symbols-outlined text-base sm:text-lg text-blue-600">chair</span>
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight tabular-nums">{totalSeats}</span>
            <span className="text-[10px] sm:text-[11px] text-slate-500 font-medium">Seats</span>
          </div>
        </div>

        {/* Live Occupancy */}
        <div className="ios27-glass-card p-3 sm:p-4 rounded-[18px] sm:rounded-[22px] shadow-apple-card flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-rose-600">Occupied</span>
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-ping" />
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl sm:text-3xl font-black text-rose-600 tracking-tight tabular-nums">{occupiedTables.length}</span>
            <span className="text-[10px] sm:text-[11px] font-bold text-rose-700 bg-rose-50 px-1.5 sm:px-2 py-0.5 rounded-full border border-rose-200">
              {occupancyRate}%
            </span>
          </div>
        </div>

        {/* Vacant & Ready */}
        <div className="ios27-glass-card p-3 sm:p-4 rounded-[18px] sm:rounded-[22px] shadow-apple-card flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-emerald-600">Vacant &amp; Ready</span>
            <span className="material-symbols-outlined text-base sm:text-lg text-emerald-600">check_circle</span>
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl sm:text-3xl font-black text-emerald-600 tracking-tight tabular-nums">{vacantTables.length}</span>
            <span className="text-[10px] sm:text-[11px] text-slate-500 font-medium">Available</span>
          </div>
        </div>

        {/* Reserved */}
        <div className="ios27-glass-card p-3 sm:p-4 rounded-[18px] sm:rounded-[22px] shadow-apple-card flex flex-col justify-between col-span-2 sm:col-span-1">
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-amber-600">Reserved</span>
            <span className="material-symbols-outlined text-base sm:text-lg text-amber-600">bookmark</span>
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl sm:text-3xl font-black text-amber-600 tracking-tight tabular-nums">{reservedTables.length}</span>
            <span className="text-[10px] sm:text-[11px] text-slate-500 font-medium">Booked</span>
          </div>
        </div>
      </div>

      {/* 2. Interactive Floor Toolbar */}
      <div className="ios27-glass-card p-3.5 sm:p-4 rounded-[20px] sm:rounded-[24px] shadow-apple-card space-y-3 max-w-full min-w-0">
        <div className="flex flex-col xl:flex-row items-stretch xl:items-center justify-between gap-2.5 sm:gap-3 min-w-0">
          {/* Search Box */}
          <div className="relative flex-1 min-w-0">
            <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-lg">
              search
            </span>
            <input
              type="text"
              placeholder="Search table (e.g. T-01), section or steward..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full h-10 pl-10 pr-8 rounded-xl border border-slate-200 bg-white/90 text-xs font-semibold text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-gold-400/50 shadow-2xs"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs p-1"
              >
                ✕
              </button>
            )}
          </div>

          {/* Action Row on Mobile/Tablet: Dropdowns & + Add Button */}
          <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 min-w-0">
            {/* Status Filter Dropdown */}
            <div className="flex-1 sm:flex-initial min-w-[130px]">
              <select
                value={selectedStatus}
                onChange={(e) => setSelectedStatus(e.target.value)}
                className="w-full h-10 px-3 rounded-xl border border-slate-200 bg-white/90 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-gold-400/50 shadow-2xs"
              >
                <option value="all">All Status ({totalTables})</option>
                <option value="vacant">Vacant ({vacantTables.length})</option>
                <option value="occupied">Occupied ({occupiedTables.length})</option>
                <option value="reserved">Reserved ({reservedTables.length})</option>
              </select>
            </div>

            {/* Sort Dropdown */}
            <div className="flex-1 sm:flex-initial min-w-[140px]">
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="w-full h-10 px-3 rounded-xl border border-slate-200 bg-white/90 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-gold-400/50 shadow-2xs"
              >
                <option value="number">Sort: Number</option>
                <option value="capacity">Sort: Capacity</option>
                <option value="status">Sort: Status</option>
              </select>
            </div>

            {/* + Add Table Action Button */}
            <button
              type="button"
              onClick={handleOpenAddModal}
              className="w-full sm:w-auto h-10 px-4 rounded-xl bg-gradient-to-r from-forest-950 via-forest-900 to-forest-950 text-gold-300 hover:text-white border border-gold-500/40 font-bold text-xs flex items-center justify-center gap-2 shadow-apple-subtle transition-all active:scale-[0.97] shrink-0"
            >
              <span className="material-symbols-outlined text-base text-gold-400">add_circle</span>
              <span>+ Add New Table</span>
            </button>
          </div>
        </div>

        {/* Section Filter Pills - Touch Scrollable Edge-to-Edge */}
        <div className="w-full max-w-full min-w-0 flex items-center gap-1.5 overflow-x-auto no-scrollbar scrollbar-none pb-1 border-t border-slate-100 pt-2.5 touch-pan-x">
          <span className="text-[10px] sm:text-[11px] font-bold text-slate-400 uppercase tracking-wider shrink-0 mr-1">
            Section:
          </span>
          <button
            type="button"
            onClick={() => setSelectedSection('all')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 active:scale-[0.97] whitespace-nowrap ${
              selectedSection === 'all'
                ? 'bg-[#05271f] text-gold-300 shadow-sm'
                : 'bg-black/[0.04] text-slate-600 hover:bg-black/[0.08]'
            }`}
          >
            All Sections ({totalTables})
          </button>
          {existingSections.map((sec) => {
            const count = db.tables.filter((t) => t.section === sec).length;
            return (
              <button
                key={sec}
                type="button"
                onClick={() => setSelectedSection(sec)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 active:scale-[0.97] whitespace-nowrap ${
                  selectedSection === sec
                    ? 'bg-[#05271f] text-gold-300 shadow-sm'
                    : 'bg-black/[0.04] text-slate-600 hover:bg-black/[0.08]'
                }`}
              >
                {sec} ({count})
              </button>
            );
          })}
        </div>
      </div>

      {/* 3. Tables Floor Grid */}
      {filteredTables.length === 0 ? (
        <div className="ios27-glass-card rounded-[24px] p-8 sm:p-12 text-center flex flex-col items-center justify-center gap-3">
          <span className="material-symbols-outlined text-5xl text-slate-300">table_restaurant</span>
          <h3 className="font-extrabold text-base text-slate-800">No Dining Tables Found</h3>
          <p className="text-xs text-slate-500 max-w-sm">
            {searchQuery || selectedSection !== 'all' || selectedStatus !== 'all'
              ? 'No tables match the current filter or search criteria.'
              : 'You have not added any dining tables yet. Click "+ Add New Table" to start.'}
          </p>
          <button
            type="button"
            onClick={handleOpenAddModal}
            className="mt-2 px-4 py-2 rounded-xl bg-forest-900 text-gold-300 font-bold text-xs"
          >
            + Create First Table
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
          {filteredTables.map((tbl) => {
            const isOccupied = tbl.status === 'occupied' || tbl.status === 'bill_printed';
            const isReserved = tbl.status === 'reserved';
            const isVacant = tbl.status === 'vacant';

            return (
              <div
                key={tbl.id}
                className={`ios27-glass-card rounded-[20px] sm:rounded-[22px] shadow-apple-card border overflow-hidden flex flex-col justify-between transition-all hover:scale-[1.01] ${
                  isOccupied
                    ? 'border-rose-300 ring-1 ring-rose-400/20'
                    : isReserved
                    ? 'border-amber-300 ring-1 ring-amber-400/20'
                    : 'border-slate-200/80 hover:border-slate-300'
                }`}
              >
                {/* Card Top Banner */}
                <div
                  className={`p-3.5 sm:p-4 border-b flex items-start justify-between gap-2.5 ${
                    isOccupied
                      ? 'bg-rose-50/60 border-rose-100'
                      : isReserved
                      ? 'bg-amber-50/60 border-amber-100'
                      : 'bg-emerald-50/50 border-emerald-100'
                  }`}
                >
                  <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
                    <div
                      className={`w-11 h-11 sm:w-12 sm:h-12 rounded-2xl flex items-center justify-center font-black shadow-apple-subtle text-white shrink-0 ${
                        isOccupied
                          ? 'bg-gradient-to-br from-rose-500 to-rose-700'
                          : isReserved
                          ? 'bg-gradient-to-br from-amber-400 to-amber-600 text-slate-950'
                          : 'bg-gradient-to-br from-emerald-500 to-emerald-700'
                      }`}
                    >
                      <span className="text-sm sm:text-base font-black tracking-tight leading-none">
                        {tbl.tableNumber}
                      </span>
                    </div>

                    <div className="flex flex-col min-w-0">
                      <span className="text-xs font-bold text-slate-900 tracking-tight truncate">
                        {tbl.section}
                      </span>
                      <div className="flex items-center gap-1 mt-0.5 text-[11px] text-slate-500 font-semibold">
                        <span className="material-symbols-outlined text-[13px] text-slate-400">chair</span>
                        <span>{tbl.capacity} Seater</span>
                      </div>
                    </div>
                  </div>

                  {/* Status Badge */}
                  <span
                    className={`text-[9.5px] sm:text-[10px] font-black uppercase tracking-wider px-2 sm:px-2.5 py-1 rounded-full flex items-center gap-1 shadow-2xs shrink-0 ${
                      isOccupied
                        ? 'bg-rose-600 text-white'
                        : isReserved
                        ? 'bg-amber-400 text-slate-950'
                        : 'bg-emerald-600 text-white'
                    }`}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                    <span>{tbl.status.replace('_', ' ')}</span>
                  </span>
                </div>

                {/* Card Body - Occupancy Info */}
                <div className="p-3.5 sm:p-4 flex-1 space-y-2 text-xs">
                  {isOccupied ? (
                    <div className="p-2.5 rounded-xl bg-black/[0.02] border border-black/[0.05] space-y-1">
                      <div className="flex items-center justify-between font-semibold text-slate-700">
                        <span>Order: <strong>{tbl.currentOrderId || 'Live'}</strong></span>
                        <span className="text-rose-600 font-black tabular-nums">
                          ₹{((tbl.totalPaise || 0) / 100).toFixed(0)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-slate-500">
                        <span>Guests: {tbl.guestCount || 2} persons</span>
                        <span className="truncate max-w-[120px]">Steward: {tbl.assignedSteward || 'Unassigned'}</span>
                      </div>
                    </div>
                  ) : isReserved ? (
                    <div className="p-2.5 rounded-xl bg-amber-50/60 border border-amber-200/60 flex items-center gap-2 text-amber-900 font-medium">
                      <span className="material-symbols-outlined text-amber-600 text-base shrink-0">bookmark</span>
                      <span className="truncate">Reserved for dining party</span>
                    </div>
                  ) : (
                    <div className="p-2.5 rounded-xl bg-emerald-50/50 border border-emerald-200/60 flex items-center gap-2 text-emerald-800 font-medium">
                      <span className="material-symbols-outlined text-emerald-600 text-base shrink-0">verified</span>
                      <span className="truncate">Cleaned, set &amp; ready for guests</span>
                    </div>
                  )}

                  {/* Capacity Visualizer */}
                  <div className="flex items-center justify-between pt-1 text-[11px] text-slate-400 font-semibold">
                    <span>Layout: {tbl.capacity} place settings</span>
                    <div className="flex items-center gap-0.5">
                      {Array.from({ length: Math.min(tbl.capacity, 8) }).map((_, i) => (
                        <span
                          key={i}
                          className={`w-2 h-2 rounded-full ${
                            isOccupied ? 'bg-rose-400' : isReserved ? 'bg-amber-400' : 'bg-emerald-400'
                          }`}
                        />
                      ))}
                      {tbl.capacity > 8 && <span className="text-[10px]">+{tbl.capacity - 8}</span>}
                    </div>
                  </div>
                </div>

                {/* Card Action Controls Footer */}
                <div className="p-2.5 sm:p-3 bg-slate-50/80 border-t border-slate-100 flex items-center justify-between gap-2">
                  {/* Quick Toggle Status */}
                  <button
                    type="button"
                    onClick={() => handleQuickStatusToggle(tbl)}
                    disabled={isOccupied}
                    className={`h-9 px-3 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all active:scale-[0.96] ${
                      isOccupied
                        ? 'opacity-40 cursor-not-allowed text-slate-400'
                        : isReserved
                        ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                        : 'bg-amber-100 text-amber-800 hover:bg-amber-200'
                    }`}
                    title={isOccupied ? 'Table has active guests' : isReserved ? 'Mark Vacant' : 'Mark Reserved'}
                  >
                    <span className="material-symbols-outlined text-sm">
                      {isReserved ? 'cancel' : 'bookmark_add'}
                    </span>
                    <span>{isReserved ? 'Unreserve' : 'Reserve'}</span>
                  </button>

                  <div className="flex items-center gap-1.5">
                    {/* Edit Table Button */}
                    <button
                      type="button"
                      onClick={() => handleOpenEditModal(tbl)}
                      className="w-9 h-9 sm:w-8 sm:h-8 rounded-xl bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 flex items-center justify-center transition-all active:scale-[0.95]"
                      title="Edit table configuration"
                    >
                      <span className="material-symbols-outlined text-base">edit</span>
                    </button>

                    {/* Delete Table Button */}
                    <button
                      type="button"
                      onClick={() => {
                        setDeletingTable(tbl);
                        setForceDelete(false);
                        setErrorMessage('');
                      }}
                      className="w-9 h-9 sm:w-8 sm:h-8 rounded-xl bg-white hover:bg-rose-50 border border-slate-200 hover:border-rose-300 text-slate-400 hover:text-rose-600 flex items-center justify-center transition-all active:scale-[0.95]"
                      title="Delete table"
                    >
                      <span className="material-symbols-outlined text-base">delete</span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ==================================================================== */}
      {/* 4. ADD / EDIT TABLE MODAL DIALOG (Mobile Bottom-Sheet & Tablet/Desktop Dialog) */}
      {/* ==================================================================== */}
      {(showAddModal || editingTable) && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget && !isSubmitting) {
              setShowAddModal(false);
              setEditingTable(null);
            }
          }}
          className="fixed inset-0 z-[10000] bg-slate-950/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200"
        >
          <div className="w-full max-w-lg bg-white rounded-t-[24px] sm:rounded-[24px] shadow-2xl border border-slate-200 flex flex-col max-h-[92vh] sm:max-h-[90vh] overflow-hidden animate-in slide-in-from-bottom-6 sm:zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="shrink-0 p-4 sm:p-5 bg-gradient-to-r from-forest-950 via-forest-900 to-forest-950 text-white flex items-center justify-between border-b border-gold-500/30">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-gold-500 to-gold-600 text-forest-950 flex items-center justify-center font-black shadow-apple-subtle shrink-0">
                  <span className="material-symbols-outlined text-xl">table_restaurant</span>
                </div>
                <div className="min-w-0">
                  <h3 className="font-extrabold text-sm sm:text-base text-white truncate">
                    {editingTable ? `Edit Table ${editingTable.tableNumber}` : 'Add New Dining Table'}
                  </h3>
                  <p className="text-[11px] sm:text-xs text-gold-300/80 font-medium truncate">
                    Configure dining floor layout, capacity &amp; section
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  setShowAddModal(false);
                  setEditingTable(null);
                }}
                disabled={isSubmitting}
                className="w-8 h-8 rounded-xl bg-forest-800 hover:bg-forest-700 text-slate-300 flex items-center justify-center transition-colors shrink-0"
              >
                <span className="material-symbols-outlined text-base">close</span>
              </button>
            </div>

            {/* Modal Body Form - Fluid Scroll on Mobile */}
            <form
              id="table-management-modal-form"
              onSubmit={editingTable ? handleSubmitEdit : handleSubmitAdd}
              className="flex-1 overflow-y-auto overscroll-contain p-4 sm:p-5 space-y-4"
            >
              {errorMessage && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold flex items-center gap-2">
                  <span className="material-symbols-outlined text-base shrink-0">error</span>
                  <span>{errorMessage}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 sm:gap-4 text-xs">
                {/* Table Number */}
                <div className="space-y-1">
                  <label className="font-bold text-slate-700 flex items-center gap-1">
                    <span>Table Identifier *</span>
                    <span className="text-slate-400 font-normal">(e.g. T-21, VIP-1)</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="T-21"
                    value={formTableNumber}
                    onChange={(e) => setFormTableNumber(e.target.value)}
                    className="w-full h-11 sm:h-10 px-3.5 rounded-xl border border-slate-200 bg-slate-50 font-bold uppercase text-slate-900 focus:outline-none focus:ring-2 focus:ring-gold-400 shadow-2xs"
                  />
                </div>

                {/* Seating Capacity Stepper */}
                <div className="space-y-1">
                  <label className="font-bold text-slate-700 flex items-center justify-between">
                    <span>Guest Capacity *</span>
                    <span className="text-emerald-700 font-extrabold">{formCapacity} Seats</span>
                  </label>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setFormCapacity((prev) => Math.max(1, prev - 1))}
                      className="w-11 h-11 sm:w-10 sm:h-10 rounded-xl border border-slate-200 bg-slate-100 hover:bg-slate-200 font-black text-slate-800 text-lg transition-transform active:scale-95 shrink-0"
                    >
                      -
                    </button>
                    <input
                      type="number"
                      min={1}
                      max={40}
                      value={formCapacity}
                      onChange={(e) => setFormCapacity(Math.max(1, Number(e.target.value) || 1))}
                      className="flex-1 h-11 sm:h-10 px-2 text-center rounded-xl border border-slate-200 bg-slate-50 font-black text-slate-900 focus:outline-none focus:ring-2 focus:ring-gold-400 shadow-2xs"
                    />
                    <button
                      type="button"
                      onClick={() => setFormCapacity((prev) => prev + 1)}
                      className="w-11 h-11 sm:w-10 sm:h-10 rounded-xl border border-slate-200 bg-slate-100 hover:bg-slate-200 font-black text-slate-800 text-lg transition-transform active:scale-95 shrink-0"
                    >
                      +
                    </button>
                  </div>
                </div>
              </div>

              {/* Quick Capacity Preset Chips */}
              <div className="space-y-1.5">
                <span className="text-[10px] sm:text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                  Quick Capacity Presets:
                </span>
                <div className="grid grid-cols-3 xs:grid-cols-6 sm:flex items-center gap-1.5 flex-wrap">
                  {[2, 4, 6, 8, 10, 12].map((cap) => (
                    <button
                      key={cap}
                      type="button"
                      onClick={() => setFormCapacity(cap)}
                      className={`h-9 sm:h-8 px-2.5 rounded-xl text-xs font-bold transition-all text-center flex items-center justify-center active:scale-95 ${
                        formCapacity === cap
                          ? 'bg-[#05271f] text-gold-300 ring-2 ring-gold-400/40 shadow-xs'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {cap} Seats
                    </button>
                  ))}
                </div>
              </div>

              {/* Dining Section Selector */}
              <div className="space-y-1 text-xs">
                <label className="font-bold text-slate-700">Dining Section *</label>
                <select
                  value={isCustomSection ? '__custom__' : formSection}
                  onChange={(e) => {
                    if (e.target.value === '__custom__') {
                      setIsCustomSection(true);
                    } else {
                      setIsCustomSection(false);
                      setFormSection(e.target.value);
                    }
                  }}
                  className="w-full h-11 sm:h-10 px-3 rounded-xl border border-slate-200 bg-slate-50 font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-gold-400 shadow-2xs"
                >
                  {existingSections.map((sec) => (
                    <option key={sec} value={sec}>
                      {sec}
                    </option>
                  ))}
                  <option value="__custom__">+ Add New Dining Section...</option>
                </select>

                {isCustomSection && (
                  <div className="pt-2 animate-in fade-in duration-150">
                    <input
                      type="text"
                      required
                      placeholder="Enter section name (e.g. Rooftop Terrace)"
                      value={customSectionName}
                      onChange={(e) => setCustomSectionName(e.target.value)}
                      className="w-full h-11 sm:h-10 px-3.5 rounded-xl border border-gold-400 bg-gold-50/30 font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-gold-400 shadow-2xs"
                    />
                  </div>
                )}
              </div>

              {/* Initial Status */}
              <div className="space-y-1.5 text-xs">
                <label className="font-bold text-slate-700">Table Status *</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['vacant', 'reserved', 'occupied'] as TableStatus[]).map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => setFormStatus(st)}
                      className={`h-10 sm:h-9 rounded-xl font-bold uppercase tracking-wider text-[11px] border transition-all active:scale-95 ${
                        formStatus === st
                          ? st === 'vacant'
                            ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                            : st === 'reserved'
                            ? 'bg-amber-500 text-slate-950 border-amber-500 shadow-sm'
                            : 'bg-rose-600 text-white border-rose-600 shadow-sm'
                          : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      {st}
                    </button>
                  ))}
                </div>
              </div>

              {/* Bottom padding for form scroll */}
              <div className="h-2 sm:hidden" />
            </form>

            {/* Sticky Form Action Buttons Footer */}
            <div className="shrink-0 bg-slate-50 border-t border-slate-200 p-3.5 sm:p-4 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => {
                  setShowAddModal(false);
                  setEditingTable(null);
                }}
                disabled={isSubmitting}
                className="flex-1 sm:flex-initial h-11 sm:h-10 px-4 rounded-xl text-slate-600 hover:bg-slate-200 font-bold text-xs transition-colors flex items-center justify-center active:scale-95"
              >
                Cancel
              </button>
              <button
                type="submit"
                form="table-management-modal-form"
                disabled={isSubmitting}
                className="flex-1 sm:flex-initial h-11 sm:h-10 px-5 rounded-xl bg-gradient-to-r from-forest-950 via-forest-900 to-forest-950 text-gold-300 hover:text-white font-bold text-xs border border-gold-500/40 shadow-apple-subtle transition-all active:scale-[0.97] flex items-center justify-center gap-1.5 cursor-pointer"
              >
                {isSubmitting && <span className="material-symbols-outlined text-sm animate-spin">progress_activity</span>}
                <span>{editingTable ? 'Save Changes' : 'Create Table'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* 5. DELETE TABLE CONFIRMATION MODAL                                   */}
      {/* ==================================================================== */}
      {deletingTable && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget && !isSubmitting) setDeletingTable(null);
          }}
          className="fixed inset-0 z-[10000] bg-slate-950/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200"
        >
          <div className="w-full max-w-md bg-white rounded-t-[24px] sm:rounded-[24px] shadow-2xl border border-slate-200 flex flex-col max-h-[90vh] overflow-hidden animate-in slide-in-from-bottom-6 sm:zoom-in-95 duration-200">
            <div className="shrink-0 p-4 sm:p-5 bg-rose-600 text-white flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-white/20 text-white flex items-center justify-center font-black shrink-0">
                  <span className="material-symbols-outlined text-xl">delete_forever</span>
                </div>
                <div className="min-w-0">
                  <h3 className="font-extrabold text-sm sm:text-base text-white truncate">Delete Table {deletingTable.tableNumber}</h3>
                  <p className="text-[11px] sm:text-xs text-rose-100 font-medium truncate">Permanently remove table from floor layout</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDeletingTable(null)}
                disabled={isSubmitting}
                className="w-8 h-8 rounded-xl bg-rose-700 hover:bg-rose-800 text-white flex items-center justify-center shrink-0"
              >
                <span className="material-symbols-outlined text-base">close</span>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto overscroll-contain p-4 sm:p-5 space-y-4 text-xs">
              {errorMessage && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 font-semibold flex items-center gap-2">
                  <span className="material-symbols-outlined text-base shrink-0">error</span>
                  <span>{errorMessage}</span>
                </div>
              )}

              <p className="text-slate-700 leading-relaxed">
                Are you sure you want to remove <strong>Table {deletingTable.tableNumber}</strong> in{' '}
                <strong>{deletingTable.section}</strong> ({deletingTable.capacity} Seater)?
              </p>

              {(deletingTable.status === 'occupied' || deletingTable.status === 'bill_printed') && (
                <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 space-y-2">
                  <div className="flex items-center gap-1.5 text-amber-800 font-bold">
                    <span className="material-symbols-outlined text-base text-amber-600">warning</span>
                    <span>Active Occupancy Warning</span>
                  </div>
                  <p className="text-amber-900 leading-normal">
                    This table is currently marked <strong>{deletingTable.status}</strong> with an active order (KOT-
                    {deletingTable.currentOrderId || 'Live'}).
                  </p>
                  <label className="flex items-center gap-2 pt-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={forceDelete}
                      onChange={(e) => setForceDelete(e.target.checked)}
                      className="rounded text-rose-600 focus:ring-rose-500"
                    />
                    <span className="font-bold text-rose-700">Force delete this table and archive current order</span>
                  </label>
                </div>
              )}
            </div>

            {/* Sticky Action Footer */}
            <div className="shrink-0 bg-slate-50 border-t border-slate-200 p-3.5 sm:p-4 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setDeletingTable(null)}
                disabled={isSubmitting}
                className="flex-1 sm:flex-initial h-11 sm:h-10 px-4 rounded-xl text-slate-600 hover:bg-slate-200 font-semibold flex items-center justify-center active:scale-95"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={isSubmitting}
                className="flex-1 sm:flex-initial h-11 sm:h-10 px-5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold flex items-center justify-center gap-1.5 shadow-sm active:scale-95 transition-all"
              >
                {isSubmitting && <span className="material-symbols-outlined text-sm animate-spin">progress_activity</span>}
                <span>Delete Table</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
