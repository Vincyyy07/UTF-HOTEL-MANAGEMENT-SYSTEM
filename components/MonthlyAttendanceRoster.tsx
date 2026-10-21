'use client';

import React, { useState, useMemo } from 'react';
import { DatabaseSchema, Staff, User, ShiftConfig } from '../lib/types';
import { getLocalDateStr } from '../lib/dateUtils';
import { DEFAULT_SHIFTS, getShiftForStaff } from '../lib/shiftConfig';

interface MonthlyAttendanceRosterProps {
  db: DatabaseSchema;
  currentUser: User;
  onUpdateDb?: (updatedDb: DatabaseSchema) => void;
}

type ViewMode = 'attendance' | 'roster' | 'combined';

interface CellEditState {
  staff: Staff;
  dateStr: string; // YYYY-MM-DD
  dateDisplay: string; // DD-MM-YYYY
  currentStatus: 'present' | 'absent' | 'on_leave' | 'half_day' | 'off';
  currentShiftId: string;
  checkInTime: string;
  checkOutTime: string;
  reason: string;
}

export const MonthlyAttendanceRoster: React.FC<MonthlyAttendanceRosterProps> = ({
  db,
  currentUser,
  onUpdateDb,
}) => {
  // Navigation Month / Year (Real-time dynamic Date)
  const [currentYear, setCurrentYear] = useState<number>(new Date().getFullYear());
  const [currentMonthIndex, setCurrentMonthIndex] = useState<number>(new Date().getMonth());

  // View Mode: 'attendance' (PRE/ABSEN) | 'roster' (Shifts) | 'combined'
  const [viewMode, setViewMode] = useState<ViewMode>('attendance');

  // Filters & Search
  const [selectedDept, setSelectedDept] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Cell Edit Modal
  const [editingCell, setEditingCell] = useState<CellEditState | null>(null);
  const [isSavingCell, setIsSavingCell] = useState<boolean>(false);
  const [actionSuccessMsg, setActionSuccessMsg] = useState<string>('');

  // Local shifts list
  const activeShifts: ShiftConfig[] = useMemo(() => {
    return db.shifts && db.shifts.length > 0 ? db.shifts : DEFAULT_SHIFTS;
  }, [db.shifts]);

  // Today string in YYYY-MM-DD
  const todayDateStr = useMemo(() => getLocalDateStr(new Date()), []);

  // Month names
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  const weekdaysShort = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  // Generate all days for the selected month
  const monthDays = useMemo(() => {
    const daysInMonth = new Date(currentYear, currentMonthIndex + 1, 0).getDate();
    const days = [];
    for (let day = 1; day <= daysInMonth; day++) {
      const dateObj = new Date(currentYear, currentMonthIndex, day);
      const yyyy = dateObj.getFullYear();
      const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
      const dd = String(day).padStart(2, '0');
      const dateStr = `${yyyy}-${mm}-${dd}`;
      const dateDisplay = `${dd}-${mm}-${yyyy}`; // E.g. 21-10-2026
      const dayOfWeek = weekdaysShort[dateObj.getDay()];
      const isSunday = dateObj.getDay() === 0;
      const isToday = dateStr === todayDateStr;
      const isFuture = dateStr > todayDateStr;

      days.push({
        dayNum: day,
        dateStr,
        dateDisplay,
        dayOfWeek,
        isSunday,
        isToday,
        isFuture,
      });
    }
    return days;
  }, [currentYear, currentMonthIndex, todayDateStr]);

  // Filtered staff list
  const filteredStaff = useMemo(() => {
    return (db.staff || [])
      .filter((s) => s.isActive)
      .filter((s) => (selectedDept === 'All' ? true : s.department === selectedDept))
      .filter((s) => {
        if (!searchQuery.trim()) return true;
        const q = searchQuery.toLowerCase();
        return (
          s.fullName.toLowerCase().includes(q) ||
          s.employeeCode.toLowerCase().includes(q) ||
          s.role.toLowerCase().includes(q)
        );
      });
  }, [db.staff, selectedDept, searchQuery]);

  // Unique departments for filter dropdown
  const departments = useMemo(() => {
    const depts = new Set<string>();
    (db.staff || []).forEach((s) => {
      if (s.department) depts.add(s.department);
    });
    return ['All', ...Array.from(depts)];
  }, [db.staff]);

  // Helper to get attendance record for staff on a specific date
  const getStaffDayRecord = (staff: Staff, dateStr: string) => {
    const log = (db.attendance || []).find(
      (a) =>
        (a.staffId === staff.id || a.staffName.toLowerCase() === staff.fullName.toLowerCase()) &&
        a.date === dateStr
    );
    return log;
  };

  // Helper to determine status and shift for a cell
  const getCellData = (staff: Staff, day: (typeof monthDays)[0]) => {
    const log = getStaffDayRecord(staff, day.dateStr);
    const assignedShift = staff.assignedShiftId
      ? activeShifts.find((s) => s.id === staff.assignedShiftId) || getShiftForStaff(staff, activeShifts)
      : getShiftForStaff(staff, activeShifts);

    const shiftCode = assignedShift.name.split(' ')[0].toUpperCase(); // e.g. MOR, GEN, EVE, NIT

    if (log) {
      const isAbsent = log.status === 'absent';
      const isLeave = log.status === 'on_leave';
      const isHalfDay = log.status === 'half_day';
      const isPresent = log.status === 'present' || Boolean(log.checkInTime);

      const statusBadge = isAbsent
        ? 'ABSEN'
        : isLeave
        ? 'LEAVE'
        : isHalfDay
        ? 'HD'
        : isPresent
        ? 'PRE'
        : 'ABSEN';

      return {
        hasRecord: true,
        status: log.status,
        statusBadge,
        checkIn: log.checkInTime || '--:--',
        checkOut: log.checkOutTime || '--:--',
        hoursWorked: log.hoursWorked || 0,
        shift: assignedShift,
        shiftCode: log.shiftName ? log.shiftName.split(' ')[0].toUpperCase() : shiftCode,
        isLate: Boolean(log.isLate),
        isOverride: log.verificationMethod === 'manager_override',
      };
    }

    if (day.isFuture) {
      return {
        hasRecord: false,
        status: 'future',
        statusBadge: '--',
        checkIn: '--:--',
        checkOut: '--:--',
        hoursWorked: 0,
        shift: assignedShift,
        shiftCode,
        isLate: false,
        isOverride: false,
      };
    }

    if (day.isToday) {
      return {
        hasRecord: false,
        status: 'not_punched',
        statusBadge: '--',
        checkIn: '--:--',
        checkOut: '--:--',
        hoursWorked: 0,
        shift: assignedShift,
        shiftCode,
        isLate: false,
        isOverride: false,
      };
    }

    // Past unpunched day: strictly ABSEN with no default check-in/out times
    return {
      hasRecord: false,
      status: 'absent',
      statusBadge: 'ABSEN',
      checkIn: '--:--',
      checkOut: '--:--',
      hoursWorked: 0,
      shift: assignedShift,
      shiftCode,
      isLate: false,
      isOverride: false,
    };
  };

  // Staff summary stats across the month
  const getStaffMonthStats = (staff: Staff) => {
    let presentDays = 0;
    let absentDays = 0;
    let totalHours = 0;

    monthDays.forEach((d) => {
      if (d.isFuture) return;
      const data = getCellData(staff, d);
      if (data.statusBadge === 'PRE') {
        presentDays++;
        totalHours += data.hoursWorked || 0;
      } else if (data.statusBadge === 'ABSEN') {
        absentDays++;
      }
    });

    return {
      presentDays,
      absentDays,
      totalHours: Math.round(totalHours * 10) / 10,
    };
  };

  // Handle Cell Click -> Open Edit Popover
  const handleCellClick = (staff: Staff, day: (typeof monthDays)[0]) => {
    const data = getCellData(staff, day);
    const initialStatus =
      data.statusBadge === 'ABSEN'
        ? 'absent'
        : data.statusBadge === 'LEAVE'
        ? 'on_leave'
        : data.statusBadge === 'HD'
        ? 'half_day'
        : 'present';

    setEditingCell({
      staff,
      dateStr: day.dateStr,
      dateDisplay: day.dateDisplay,
      currentStatus: initialStatus,
      currentShiftId: data.shift.id,
      checkInTime: data.checkIn !== '--:--' ? data.checkIn : data.shift.startTime,
      checkOutTime: data.checkOut !== '--:--' ? data.checkOut : data.shift.endTime,
      reason: `Manager updated cell for ${day.dateDisplay}`,
    });
  };

  // Save Cell Edit to API
  const handleSaveCell = async () => {
    if (!editingCell) return;
    setIsSavingCell(true);
    try {
      const res = await fetch('/api/attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'MANAGER_OVERRIDE',
          staffId: editingCell.staff.id,
          userName: currentUser.name,
          userRole: currentUser.role,
          date: editingCell.dateStr,
          status: editingCell.currentStatus,
          shiftId: editingCell.currentShiftId,
          checkInTime: editingCell.currentStatus === 'absent' ? '' : editingCell.checkInTime,
          checkOutTime: editingCell.currentStatus === 'absent' ? '' : editingCell.checkOutTime,
          reason: editingCell.reason || 'Admin master muster sheet update',
        }),
      });

      const json = await res.json();
      if (json.success) {
        if (json.data && onUpdateDb) {
          onUpdateDb(json.data);
        }
        setActionSuccessMsg(`Updated ${editingCell.staff.fullName} for ${editingCell.dateDisplay}`);
        setTimeout(() => setActionSuccessMsg(''), 3000);
        setEditingCell(null);
      } else {
        alert(json.message || 'Failed to save attendance cell update');
      }
    } catch (err) {
      console.error(err);
      alert('Error updating attendance cell');
    } finally {
      setIsSavingCell(false);
    }
  };

  // Export to Excel / CSV
  const handleExportCSV = () => {
    const headers = [
      'NAME',
      'EMPLOYEE_CODE',
      'DEPARTMENT',
      ...monthDays.map((d) => d.dateDisplay),
      'TOTAL_PRESENT',
      'TOTAL_ABSENT',
      'TOTAL_HOURS',
    ];

    const rows = filteredStaff.map((staff) => {
      const stats = getStaffMonthStats(staff);
      const dayValues = monthDays.map((d) => {
        const cell = getCellData(staff, d);
        if (viewMode === 'roster') {
          return cell.shiftCode;
        } else if (viewMode === 'combined') {
          return `${cell.statusBadge} (${cell.shiftCode})`;
        }
        return cell.statusBadge;
      });

      return [
        staff.fullName.toUpperCase(),
        staff.employeeCode,
        staff.department,
        ...dayValues,
        stats.presentDays,
        stats.absentDays,
        stats.totalHours,
      ];
    });

    const csvContent =
      '\uFEFF' + // UTF-8 BOM so Excel opens proper formatting
      [headers.join(','), ...rows.map((r) => r.map((c) => `"${c}"`).join(','))].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `Staff_Attendance_Roster_${monthNames[currentMonthIndex]}_${currentYear}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col gap-4 font-sans max-w-full">
      {/* ── TOP CONTROL & ACTION TOOLBAR ─────────────────────────────────── */}
      <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/90 shadow-sm flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Header Title & Month Picker */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-forest-900 text-gold-400 flex items-center justify-center font-black shadow-sm">
              <span className="material-symbols-outlined text-xl">table_chart</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-black text-slate-900 tracking-tight">
                  Staff Attendance Register &amp; Monthly Roster
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-50 text-emerald-800 border border-emerald-200">
                  Excel View
                </span>
              </div>
              <p className="text-xs text-slate-500 font-medium mt-0.5">
                First column (Name) is frozen • Horizontally scrollable dates • Live click-to-edit
              </p>
            </div>
          </div>

          {/* Month Navigation & Action Buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Month Navigator */}
            <div className="flex items-center bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs font-bold">
              <button
                type="button"
                onClick={() => {
                  if (currentMonthIndex === 0) {
                    setCurrentMonthIndex(11);
                    setCurrentYear((y) => y - 1);
                  } else {
                    setCurrentMonthIndex((m) => m - 1);
                  }
                }}
                className="w-7 h-7 rounded-lg hover:bg-white text-slate-700 flex items-center justify-center transition-all"
                title="Previous Month"
              >
                <span className="material-symbols-outlined text-base">chevron_left</span>
              </button>
              <span className="px-3 text-slate-800 font-extrabold whitespace-nowrap">
                {monthNames[currentMonthIndex]} {currentYear}
              </span>
              <button
                type="button"
                onClick={() => {
                  if (currentMonthIndex === 11) {
                    setCurrentMonthIndex(0);
                    setCurrentYear((y) => y + 1);
                  } else {
                    setCurrentMonthIndex((m) => m + 1);
                  }
                }}
                className="w-7 h-7 rounded-lg hover:bg-white text-slate-700 flex items-center justify-center transition-all"
                title="Next Month"
              >
                <span className="material-symbols-outlined text-base">chevron_right</span>
              </button>
            </div>

            {/* Jump to Today */}
            <button
              type="button"
              onClick={() => {
                const now = new Date();
                setCurrentMonthIndex(now.getMonth());
                setCurrentYear(now.getFullYear());
                const todayEl = document.getElementById(`col-date-${todayDateStr}`);
                if (todayEl) {
                  todayEl.scrollIntoView({ behavior: 'smooth', inline: 'center' });
                }
              }}
              className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold border border-slate-200 transition-all"
            >
              Today
            </button>

            {/* Export CSV / Excel Button */}
            <button
              type="button"
              onClick={handleExportCSV}
              className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-sm transition-all flex items-center gap-1.5 active:scale-95"
              title="Export exact spreadsheet as CSV / Excel"
            >
              <span className="material-symbols-outlined text-base">download</span>
              <span>Export Excel (CSV)</span>
            </button>
          </div>
        </div>

        {/* View Mode Switcher, Department Filter & Search */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-100 text-xs">
          {/* Segmented Mode Control */}
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200">
            <button
              type="button"
              onClick={() => setViewMode('attendance')}
              className={`px-3 py-1.5 rounded-lg font-bold transition-all flex items-center gap-1.5 ${
                viewMode === 'attendance'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <span className="material-symbols-outlined text-sm text-emerald-600">checklist</span>
              <span>Attendance (PRE / ABSEN)</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('roster')}
              className={`px-3 py-1.5 rounded-lg font-bold transition-all flex items-center gap-1.5 ${
                viewMode === 'roster'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <span className="material-symbols-outlined text-sm text-blue-600">calendar_month</span>
              <span>Monthly Shift Roster</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('combined')}
              className={`px-3 py-1.5 rounded-lg font-bold transition-all flex items-center gap-1.5 ${
                viewMode === 'combined'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <span className="material-symbols-outlined text-sm text-purple-600">layers</span>
              <span>Combined View</span>
            </button>
          </div>

          {/* Department Filter & Search */}
          <div className="flex items-center gap-2.5 flex-wrap">
            <div className="flex items-center gap-1.5">
              <span className="text-slate-500 font-bold text-[11px]">Dept:</span>
              <select
                value={selectedDept}
                onChange={(e) => setSelectedDept(e.target.value)}
                className="h-8 px-2.5 rounded-lg border border-slate-300 bg-slate-50 text-slate-800 font-bold focus:outline-none focus:ring-1 focus:ring-emerald-500"
              >
                {departments.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>

            <div className="relative">
              <span className="material-symbols-outlined absolute left-2.5 top-1.5 text-slate-400 text-sm">
                search
              </span>
              <input
                type="text"
                placeholder="Search staff name..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-8 pl-8 pr-3 rounded-lg border border-slate-300 bg-slate-50 text-slate-800 text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500 w-44"
              />
            </div>
          </div>
        </div>

        {/* Legend Bar */}
        <div className="flex items-center gap-4 flex-wrap text-[11px] text-slate-600 pt-1">
          <span className="font-bold text-slate-400 uppercase text-[9px] tracking-wider">Legend:</span>
          <span className="flex items-center gap-1">
            <span className="px-1.5 py-0.5 rounded text-[10px] font-black bg-emerald-100 text-emerald-800 border border-emerald-300">
              PRE
            </span>
            Present
          </span>
          <span className="flex items-center gap-1">
            <span className="px-1.5 py-0.5 rounded text-[10px] font-black bg-rose-100 text-rose-800 border border-rose-300">
              ABSEN
            </span>
            Absent
          </span>
          <span className="flex items-center gap-1">
            <span className="px-1.5 py-0.5 rounded text-[10px] font-black bg-amber-100 text-amber-800 border border-amber-300">
              LEAVE
            </span>
            Leave
          </span>
          <span className="flex items-center gap-1">
            <span className="px-1.5 py-0.5 rounded text-[10px] font-black bg-slate-100 text-slate-700 border border-slate-300">
              WO
            </span>
            Week Off
          </span>
          <span className="text-slate-300">|</span>
          <span className="text-slate-500">
            Shifts: <strong className="text-emerald-700">MOR (07:00-15:30)</strong> •{' '}
            <strong className="text-blue-700">GEN (10:00-19:00)</strong> •{' '}
            <strong className="text-amber-700">EVE (15:00-23:30)</strong> •{' '}
            <strong className="text-purple-700">NIT (18:00-02:00)</strong>
          </span>
        </div>

        {/* Action feedback notice */}
        {actionSuccessMsg && (
          <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 font-bold text-xs flex items-center gap-2 animate-in fade-in">
            <span className="material-symbols-outlined text-sm text-emerald-600">check_circle</span>
            {actionSuccessMsg}
          </div>
        )}
      </div>

      {/* ── THE FROZEN EXCEL TABLE MATRIX ─────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-slate-300/80 shadow-sm overflow-hidden relative">
        <div className="overflow-x-auto scrollbar-thin">
          <table className="border-collapse text-xs w-full text-left table-fixed">
            {/* Header row: Excel-styled Header */}
            <thead>
              <tr className="bg-[#05271f] text-white border-b-2 border-gold-500/40 divide-x divide-slate-700">
                {/* Column A: NAME (FREEZED STICKY LEFT COLUMN) */}
                <th
                  scope="col"
                  className="sticky left-0 z-30 bg-[#031d16] text-gold-300 font-black uppercase tracking-wider px-3.5 py-3 w-[220px] min-w-[220px] shadow-[4px_0_12px_rgba(0,0,0,0.25)] border-r-2 border-gold-500/40"
                >
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5">
                      <span className="px-1.5 py-0.5 rounded bg-black/40 text-[9px] font-mono text-gold-400">
                        A
                      </span>
                      <span>NAME</span>
                    </span>
                    <span className="text-[10px] text-slate-400 font-normal lowercase">
                      ({filteredStaff.length} staff)
                    </span>
                  </div>
                </th>

                {/* Date Columns: Scrollable Horizontally (DD-MM-YYYY) */}
                {monthDays.map((day, idx) => {
                  const excelColLetter = String.fromCharCode(66 + (idx % 25)); // B, C, D, E...
                  return (
                    <th
                      key={day.dateStr}
                      id={`col-date-${day.dateStr}`}
                      className={`px-2 py-2.5 text-center w-[98px] min-w-[98px] transition-colors ${
                        day.isToday
                          ? 'bg-emerald-950/90 text-gold-300 ring-2 ring-inset ring-gold-400/80 font-black'
                          : day.isSunday
                          ? 'bg-[#083329] text-emerald-200'
                          : 'bg-[#05271f] text-slate-200'
                      }`}
                    >
                      <div className="flex flex-col items-center gap-0.5">
                        <div className="flex items-center gap-1 text-[9px] font-mono text-gold-400/80">
                          <span>{excelColLetter}</span>
                          <span>•</span>
                          <span className="uppercase font-bold">{day.dayOfWeek}</span>
                        </div>
                        {/* Exact DD-MM-YYYY format matching screenshot */}
                        <span className="font-extrabold text-[11px] tabular-nums tracking-tight">
                          {day.dateDisplay}
                        </span>
                        {day.isToday && (
                          <span className="px-1.5 py-0.2 rounded-full text-[8px] font-black uppercase tracking-wider bg-gold-400 text-black leading-tight mt-0.5">
                            Today
                          </span>
                        )}
                      </div>
                    </th>
                  );
                })}

                {/* Summary Columns Frozen at Right */}
                <th className="px-3 py-3 text-center w-[65px] min-w-[65px] bg-[#031d16] text-emerald-400 font-black uppercase text-[10px]">
                  PRE
                </th>
                <th className="px-3 py-3 text-center w-[65px] min-w-[65px] bg-[#031d16] text-rose-400 font-black uppercase text-[10px]">
                  ABS
                </th>
                <th className="px-3 py-3 text-center w-[75px] min-w-[75px] bg-[#031d16] text-gold-300 font-black uppercase text-[10px]">
                  Hours
                </th>
              </tr>
            </thead>

            {/* Table Body: Staff Rows */}
            <tbody className="divide-y divide-slate-200 font-medium">
              {filteredStaff.length === 0 ? (
                <tr>
                  <td colSpan={monthDays.length + 4} className="text-center py-12 text-slate-400">
                    No active staff matching the selected department or query.
                  </td>
                </tr>
              ) : (
                filteredStaff.map((staff, rowIdx) => {
                  const stats = getStaffMonthStats(staff);
                  const isEvenRow = rowIdx % 2 === 0;
                  const rowBg = isEvenRow ? 'bg-white' : 'bg-slate-50/70';

                  return (
                    <tr
                      key={staff.id}
                      className={`${rowBg} hover:bg-amber-50/50 transition-colors divide-x divide-slate-200`}
                    >
                      {/* ── COLUMN A: NAME (FREEZED STICKY COLUMN) ──────────── */}
                      <td
                        className={`sticky left-0 z-20 ${rowBg} px-3.5 py-2.5 w-[220px] min-w-[220px] shadow-[4px_0_12px_rgba(0,0,0,0.08)] border-r-2 border-slate-300`}
                      >
                        <div className="flex items-center gap-2.5">
                          {/* Row Number */}
                          <span className="text-[10px] font-mono text-slate-400 w-4 shrink-0 text-right">
                            {rowIdx + 2}
                          </span>

                          <div className="w-7 h-7 rounded-full bg-slate-200 overflow-hidden shrink-0 border border-slate-300">
                            {staff.photoUrl ? (
                              <img
                                src={staff.photoUrl}
                                alt={staff.fullName}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center font-black text-xs text-slate-600">
                                {staff.fullName.charAt(0).toUpperCase()}
                              </div>
                            )}
                          </div>

                          <div className="flex flex-col min-w-0">
                            {/* UPPERCASE NAME EXACTLY MATCHING USER'S SCREENSHOT */}
                            <span className="font-black text-xs text-slate-900 tracking-tight truncate uppercase">
                              {staff.fullName}
                            </span>
                            <span className="text-[10px] text-slate-500 truncate font-mono">
                              {staff.employeeCode} • {staff.department}
                            </span>
                          </div>
                        </div>
                      </td>

                      {/* ── DATE COLUMNS (SCROLLABLE CELLS) ─────────────────── */}
                      {monthDays.map((day) => {
                        const cell = getCellData(staff, day);

                        return (
                          <td
                            key={day.dateStr}
                            onClick={() => handleCellClick(staff, day)}
                            title={`Click to edit: ${staff.fullName} on ${day.dateDisplay}`}
                            className={`px-1 py-1 text-center w-[98px] min-w-[98px] cursor-pointer hover:ring-2 hover:ring-emerald-500/70 hover:bg-emerald-50/40 transition-all ${
                              day.isToday ? 'bg-emerald-50/30' : ''
                            }`}
                          >
                            <div className="flex flex-col items-center justify-center gap-0.5 py-1">
                              {/* MODE 1: ATTENDANCE (PRE / ABSEN) */}
                              {viewMode === 'attendance' && (
                                <>
                                  {cell.statusBadge === 'PRE' && (
                                    <span className="px-2.5 py-1 rounded-md text-[11px] font-black bg-emerald-100 text-emerald-900 border border-emerald-300 shadow-sm w-full block text-center">
                                      PRE
                                    </span>
                                  )}
                                  {cell.statusBadge === 'ABSEN' && (
                                    <span className="px-2.5 py-1 rounded-md text-[11px] font-black bg-rose-100 text-rose-900 border border-rose-300 shadow-sm w-full block text-center">
                                      ABSEN
                                    </span>
                                  )}
                                  {cell.statusBadge === 'LEAVE' && (
                                    <span className="px-2 py-1 rounded-md text-[10px] font-black bg-amber-100 text-amber-900 border border-amber-300 shadow-sm w-full block text-center">
                                      LEAVE
                                    </span>
                                  )}
                                  {cell.statusBadge === 'HD' && (
                                    <span className="px-2 py-1 rounded-md text-[10px] font-black bg-indigo-100 text-indigo-900 border border-indigo-300 shadow-sm w-full block text-center">
                                      HD
                                    </span>
                                  )}
                                  {cell.statusBadge === '--' && (
                                    <span className="text-[11px] text-slate-300 font-mono">
                                      --
                                    </span>
                                  )}
                                </>
                              )}

                              {/* MODE 2: MONTHLY ROSTER (SHIFTS) */}
                              {viewMode === 'roster' && (
                                <span
                                  className={`px-2 py-1 rounded-md text-[10px] font-black w-full block text-center border shadow-sm ${
                                    cell.shiftCode === 'MOR'
                                      ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                                      : cell.shiftCode === 'GEN'
                                      ? 'bg-blue-50 text-blue-800 border-blue-300'
                                      : cell.shiftCode === 'EVE'
                                      ? 'bg-amber-50 text-amber-800 border-amber-300'
                                      : cell.shiftCode === 'NIT'
                                      ? 'bg-purple-50 text-purple-800 border-purple-300'
                                      : 'bg-slate-100 text-slate-700 border-slate-300'
                                  }`}
                                >
                                  {cell.shiftCode}
                                </span>
                              )}

                              {/* MODE 3: COMBINED VIEW */}
                              {viewMode === 'combined' && (
                                <div className="flex items-center justify-center gap-1 w-full">
                                  <span
                                    className={`px-1.5 py-0.5 rounded text-[10px] font-black ${
                                      cell.statusBadge === 'PRE'
                                        ? 'bg-emerald-100 text-emerald-900'
                                        : cell.statusBadge === 'ABSEN'
                                        ? 'bg-rose-100 text-rose-900'
                                        : 'bg-slate-100 text-slate-700'
                                    }`}
                                  >
                                    {cell.statusBadge}
                                  </span>
                                  <span className="px-1 py-0.5 rounded text-[9px] font-bold bg-slate-100 text-slate-700 border border-slate-200">
                                    {cell.shiftCode}
                                  </span>
                                </div>
                              )}
                            </div>
                          </td>
                        );
                      })}

                      {/* ── SUMMARY COLUMNS (END OF ROW) ────────────────────── */}
                      <td className="px-2 py-2 text-center w-[65px] min-w-[65px] font-extrabold text-emerald-700 bg-emerald-50/30 tabular-nums">
                        {stats.presentDays}
                      </td>
                      <td className="px-2 py-2 text-center w-[65px] min-w-[65px] font-extrabold text-rose-600 bg-rose-50/30 tabular-nums">
                        {stats.absentDays}
                      </td>
                      <td className="px-2 py-2 text-center w-[75px] min-w-[75px] font-black text-slate-900 bg-slate-50 tabular-nums">
                        {stats.totalHours}h
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── CELL EDIT / OVERRIDE MODAL ─────────────────────────────────────── */}
      {editingCell && (
        <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white rounded-3xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden flex flex-col animate-in zoom-in-95">
            {/* Modal Header */}
            <div className="p-4 sm:p-5 bg-gradient-to-r from-forest-950 via-forest-900 to-forest-950 text-white flex items-center justify-between border-b border-gold-500/20">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-forest-900 border border-gold-500/40 text-gold-400 flex items-center justify-center font-bold shrink-0">
                  <span className="material-symbols-outlined text-xl">edit_calendar</span>
                </div>
                <div>
                  <h3 className="font-bold text-sm sm:text-base text-white">
                    Edit Attendance &amp; Shift
                  </h3>
                  <p className="text-[11px] text-slate-300 mt-0.5">
                    {editingCell.staff.fullName} ({editingCell.staff.employeeCode}) •{' '}
                    <strong className="text-gold-300">{editingCell.dateDisplay}</strong>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditingCell(null)}
                className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-slate-300 flex items-center justify-center transition-all"
              >
                ✕
              </button>
            </div>

            {/* Modal Form */}
            <div className="p-5 flex flex-col gap-4 text-xs">
              {/* Status Selector */}
              <div>
                <label className="block text-slate-500 font-bold uppercase text-[10px] mb-1.5">
                  Attendance Status
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { id: 'present', label: 'PRE (Present)', color: 'emerald' },
                    { id: 'absent', label: 'ABSEN (Absent)', color: 'rose' },
                    { id: 'on_leave', label: 'LEAVE (Leave)', color: 'amber' },
                    { id: 'half_day', label: 'HD (Half Day)', color: 'indigo' },
                  ].map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() =>
                        setEditingCell({
                          ...editingCell,
                          currentStatus: s.id as any,
                        })
                      }
                      className={`p-2 rounded-xl text-center font-extrabold border transition-all ${
                        editingCell.currentStatus === s.id
                          ? s.color === 'emerald'
                            ? 'bg-emerald-600 text-white border-emerald-600 shadow-md'
                            : s.color === 'rose'
                            ? 'bg-rose-600 text-white border-rose-600 shadow-md'
                            : s.color === 'amber'
                            ? 'bg-amber-600 text-white border-amber-600 shadow-md'
                            : 'bg-indigo-600 text-white border-indigo-600 shadow-md'
                          : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Shift Assignment */}
              <div>
                <label className="block text-slate-500 font-bold uppercase text-[10px] mb-1.5">
                  Assigned Shift for this date
                </label>
                <select
                  value={editingCell.currentShiftId}
                  onChange={(e) => {
                    const matchedShift = activeShifts.find((s) => s.id === e.target.value);
                    setEditingCell({
                      ...editingCell,
                      currentShiftId: e.target.value,
                      checkInTime: matchedShift?.startTime || editingCell.checkInTime,
                      checkOutTime: matchedShift?.endTime || editingCell.checkOutTime,
                    });
                  }}
                  className="w-full h-9 px-3 rounded-xl border border-slate-300 font-bold text-slate-800 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  {activeShifts.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.startTime} - {s.endTime})
                    </option>
                  ))}
                </select>
              </div>

              {/* In / Out Timings (if present) */}
              {editingCell.currentStatus !== 'absent' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-slate-500 font-bold uppercase text-[10px] mb-1">
                      Check-In Time
                    </label>
                    <input
                      type="text"
                      placeholder="09:30 AM"
                      value={editingCell.checkInTime}
                      onChange={(e) =>
                        setEditingCell({
                          ...editingCell,
                          checkInTime: e.target.value,
                        })
                      }
                      className="w-full h-9 px-3 rounded-xl border border-slate-300 font-bold text-slate-800 bg-slate-50"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-500 font-bold uppercase text-[10px] mb-1">
                      Check-Out Time
                    </label>
                    <input
                      type="text"
                      placeholder="07:30 PM"
                      value={editingCell.checkOutTime}
                      onChange={(e) =>
                        setEditingCell({
                          ...editingCell,
                          checkOutTime: e.target.value,
                        })
                      }
                      className="w-full h-9 px-3 rounded-xl border border-slate-300 font-bold text-slate-800 bg-slate-50"
                    />
                  </div>
                </div>
              )}

              {/* Reason / Note */}
              <div>
                <label className="block text-slate-500 font-bold uppercase text-[10px] mb-1">
                  Reason / Audit Note
                </label>
                <input
                  type="text"
                  placeholder="e.g. Approved leave / Shift swap with peer"
                  value={editingCell.reason}
                  onChange={(e) =>
                    setEditingCell({
                      ...editingCell,
                      reason: e.target.value,
                    })
                  }
                  className="w-full h-9 px-3 rounded-xl border border-slate-300 text-slate-800 bg-slate-50"
                />
              </div>
            </div>

            {/* Modal Actions */}
            <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setEditingCell(null)}
                className="px-4 py-2 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-xs transition-all"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveCell}
                disabled={isSavingCell}
                className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-md transition-all active:scale-95 disabled:opacity-50 flex items-center gap-1.5"
              >
                {isSavingCell ? (
                  <>
                    <span className="material-symbols-outlined text-sm animate-spin">
                      refresh
                    </span>
                    Saving...
                  </>
                ) : (
                  <>
                    <span className="material-symbols-outlined text-sm">save</span>
                    Save Changes
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
