'use client';

import React, { useState, useMemo } from 'react';
import { DatabaseSchema, Staff, User, AttendanceLog } from '../lib/types';
import { getLocalDateStr } from '../lib/dateUtils';

interface StaffAttendanceInfoProps {
  db: DatabaseSchema;
  currentUser: User;
  onOpenQrModal?: () => void;
  onUpdateDb?: (updatedDb: DatabaseSchema) => void;
  selectedStaffId?: string;
  onBackToTerminal?: () => void;
  isAdminViewing?: boolean;
}

export interface DayRecord {
  date: string; // YYYY-MM-DD
  dayNum: number;
  monthLabel: string;
  dayOfWeek: string; // Sun, Mon, Tue, etc.
  dayOfWeekChar: 'S' | 'M' | 'T' | 'W' | 'T' | 'F' | 'S';
  status: 'P' | 'A' | 'H' | 'WO'; // P = Present, A = Absent, H = Holiday, WO = Week Off
  statusLabel: string;
  shiftCode: string; // 'GEN2'
  shiftName: string; // 'General Shift'
  firstIn?: string; // '09:46'
  lastOut?: string; // '23:00'
  actualWorkHrs?: string; // '13:01'
  workMinutes?: number;
  isLate?: boolean;
  lateMinutes?: number;
  isEarlyOut?: boolean;
  earlyMinutes?: number;
  hasExceptionMark?: boolean; // blue bottom-right corner triangle
  isToday?: boolean;
  isFuture?: boolean;
}

export const StaffAttendanceInfo: React.FC<StaffAttendanceInfoProps> = ({
  db,
  currentUser,
  onOpenQrModal,
  onUpdateDb,
  selectedStaffId,
  onBackToTerminal,
  isAdminViewing = false,
}) => {
  // Find current staff record or generate graceful fallback
  const currentStaff: Staff = useMemo(() => {
    const found = db.staff.find(
      (s) =>
        s.id === (selectedStaffId || currentUser.id) ||
        s.fullName.toLowerCase() === currentUser.name.toLowerCase() ||
        s.phone === currentUser.username ||
        s.email === currentUser.username
    );
    if (found) return found;

    if (db.staff.length > 0) return db.staff[0];

    return {
      id: currentUser.id || 'stf-current',
      employeeCode: 'UFP-EMP-01',
      fullName: currentUser.name || 'Staff Member',
      role: currentUser.role || 'Staff',
      department: 'Service',
      phone: '+91 98450 12345',
      email: `${currentUser.username || 'staff'}@unitedfoodpalace.com`,
      aadhaarNumber: 'XXXX-XXXX-1234',
      familyDetails: '',
      currentAddress: 'Vijayawada, AP',
      permanentAddress: 'Vijayawada, AP',
      dateOfJoining: '2025-01-15',
      salaryType: 'monthly',
      baseSalaryPaise: 2500000,
      bankAccountNumber: 'XXXX1234',
      bankIfsc: 'HDFC0001234',
      bankName: 'HDFC Bank',
      emergencyContactName: 'Family',
      emergencyContactPhone: '+91 98450 00000',
      photoUrl: currentUser.avatarUrl || '/staff_photos/stf-1.jpg',
      hasFaceEnrolled: true,
      isActive: true,
    };
  }, [db.staff, selectedStaffId, currentUser]);

  // Primary Tab: 'overview' | 'day_wise'
  const [activeTab, setActiveTab] = useState<'overview' | 'day_wise'>('day_wise');

  // Day Wise View: 'grid' (Calendar) | 'list' (Detailed Cards)
  const [dayWiseMode, setDayWiseMode] = useState<'grid' | 'list'>('grid');

  // Month navigation (Default Oct'26)
  const [currentMonthIndex, setCurrentMonthIndex] = useState<number>(9); // 0=Jan, 9=Oct
  const [currentYear, setCurrentYear] = useState<number>(2026);

  // Accordion states in Overview
  const [openAccordion, setOpenAccordion] = useState<string | null>(null);

  // Legend dialog state
  const [showLegendModal, setShowLegendModal] = useState<boolean>(false);

  // Selected Day Popover Modal
  const [selectedDayDetail, setSelectedDayDetail] = useState<DayRecord | null>(null);

  // Regularize Dialog Modal
  const [showRegularizeModal, setShowRegularizeModal] = useState<boolean>(false);
  const [regularizeDate, setRegularizeDate] = useState<string>('2026-10-13');
  const [regularizeInTime, setRegularizeInTime] = useState<string>('09:46');
  const [regularizeOutTime, setRegularizeOutTime] = useState<string>('19:30');
  const [regularizeReason, setRegularizeReason] = useState<string>('Forgot to punch out due to dinner rush');
  const [regularizeSubmitted, setRegularizeSubmitted] = useState<boolean>(false);

  // Today dynamic date
  const todayDateStr = useMemo(() => getLocalDateStr(new Date()), []);

  // Check real today log from db.attendance
  const todayDbLog = useMemo(() => {
    return (db.attendance || []).find(
      (a) =>
        (a.staffId === currentStaff.id || a.staffName.toLowerCase() === currentStaff.fullName.toLowerCase()) &&
        a.date === todayDateStr
    );
  }, [db.attendance, currentStaff, todayDateStr]);

  // Month label formatted as "Oct'26"
  const monthNamesShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthDisplayLabel = `${monthNamesShort[currentMonthIndex]}'${String(currentYear).slice(-2)}`;

  const handlePrevMonth = () => {
    if (currentMonthIndex === 0) {
      setCurrentMonthIndex(11);
      setCurrentYear((y) => y - 1);
    } else {
      setCurrentMonthIndex((m) => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (currentMonthIndex === 11) {
      setCurrentMonthIndex(0);
      setCurrentYear((y) => y + 1);
    } else {
      setCurrentMonthIndex((m) => m + 1);
    }
  };

  const handleJumpToToday = () => {
    setCurrentMonthIndex(9); // Oct
    setCurrentYear(2026);
    const today = cycleDays.find((d) => d.isToday);
    if (today) setSelectedDayDetail(today);
  };

  // Generate cycle days (Sunday is ALSO a working day in restaurants!)
  const cycleDays: DayRecord[] = useMemo(() => {
    const list: DayRecord[] = [];
    const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const weekdayChars: ('S' | 'M' | 'T' | 'W' | 'T' | 'F' | 'S')[] = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

    const startDate = new Date(currentYear, currentMonthIndex - 1, 21);
    const endDate = new Date(currentYear, currentMonthIndex, 20);

    // Filter real logs in db for this staff
    const staffLogs = (db.attendance || []).filter(
      (a) =>
        (a.staffId === currentStaff.id || a.staffName.toLowerCase() === currentStaff.fullName.toLowerCase())
    );

    const curr = new Date(startDate);
    while (curr <= endDate) {
      const year = curr.getFullYear();
      const month = String(curr.getMonth() + 1).padStart(2, '0');
      const day = String(curr.getDate()).padStart(2, '0');
      const dateStr = `${year}-${month}-${day}`;
      const dayNum = curr.getDate();
      const monthIdx = curr.getMonth();
      const monthLabel = monthNamesShort[monthIdx];
      const dayOfWeekIdx = curr.getDay();
      const dayOfWeek = weekdays[dayOfWeekIdx];
      const dayOfWeekChar = weekdayChars[dayOfWeekIdx];

      const isGandhiJayanti = monthIdx === 9 && dayNum === 2; // 2 Oct
      const isToday = dateStr === todayDateStr || dateStr === '2026-10-16';
      const isFuture = curr > new Date(2026, 9, 16);

      // Check if real log exists in DB
      const dbLog = staffLogs.find((l) => l.date === dateStr);

      if (dbLog) {
        // REAL DB LOG TAKES FULL PRECEDENCE
        const hrsNum = dbLog.hoursWorked || 0;
        const hrsStr = hrsNum > 0
          ? `${Math.floor(hrsNum)}:${String(Math.round((hrsNum % 1) * 60)).padStart(2, '0')}`
          : dbLog.checkOutTime
          ? '00:00'
          : 'In Progress';

        list.push({
          date: dateStr,
          dayNum,
          monthLabel,
          dayOfWeek,
          dayOfWeekChar,
          status: dbLog.status === 'absent' ? 'A' : 'P',
          statusLabel: dbLog.status === 'absent' ? 'Absent' : 'Present',
          shiftCode: dbLog.shiftName ? dbLog.shiftName.slice(0, 4).toUpperCase() : 'GEN2',
          shiftName: dbLog.shiftName || 'General Shift',
          firstIn: dbLog.checkInTime || '--:--',
          lastOut: dbLog.checkOutTime || '--:--',
          actualWorkHrs: hrsStr,
          workMinutes: hrsNum ? Math.round(hrsNum * 60) : 480,
          isLate: dbLog.isLate,
          lateMinutes: dbLog.lateMinutes,
          isEarlyOut: dbLog.leftEarly,
          earlyMinutes: dbLog.leftEarlyMinutes,
          hasExceptionMark: dbLog.isLate || dbLog.leftEarly,
          isToday,
          isFuture: false,
        });
      } else {
        // SUNDAYS ARE REGULAR WORKING DAYS!
        if (isGandhiJayanti) {
          list.push({
            date: dateStr,
            dayNum,
            monthLabel,
            dayOfWeek,
            dayOfWeekChar,
            status: 'H',
            statusLabel: 'Holiday (Gandhi Jayanti)',
            shiftCode: 'GEN2',
            shiftName: 'National Holiday',
            isToday,
            isFuture,
          });
        } else if (dateStr === '2026-10-12') {
          list.push({
            date: dateStr,
            dayNum,
            monthLabel,
            dayOfWeek,
            dayOfWeekChar,
            status: 'P',
            statusLabel: 'Present (Late-in)',
            shiftCode: 'GEN2',
            shiftName: 'Ack & Grw',
            firstIn: '10:18',
            lastOut: '22:45',
            actualWorkHrs: '12:27',
            workMinutes: 747,
            isLate: true,
            lateMinutes: 48,
            hasExceptionMark: false,
            isToday,
            isFuture,
          });
        } else if (dateStr === '2026-10-13') {
          list.push({
            date: dateStr,
            dayNum,
            monthLabel,
            dayOfWeek,
            dayOfWeekChar,
            status: 'P',
            statusLabel: 'Present (Single Punch)',
            shiftCode: 'GEN2',
            shiftName: 'Ack & Grw',
            firstIn: '09:46',
            lastOut: '09:46',
            actualWorkHrs: '00:00',
            workMinutes: 0,
            isLate: true,
            lateMinutes: 16,
            hasExceptionMark: true,
            isToday,
            isFuture,
          });
        } else if (dateStr === '2026-10-14') {
          list.push({
            date: dateStr,
            dayNum,
            monthLabel,
            dayOfWeek,
            dayOfWeekChar,
            status: 'P',
            statusLabel: 'Present',
            shiftCode: 'GEN2',
            shiftName: 'Ack & Grw',
            firstIn: '09:59',
            lastOut: '23:00',
            actualWorkHrs: '13:01',
            workMinutes: 781,
            isLate: false,
            hasExceptionMark: false,
            isToday,
            isFuture,
          });
        } else if (dateStr === '2026-10-15') {
          list.push({
            date: dateStr,
            dayNum,
            monthLabel,
            dayOfWeek,
            dayOfWeekChar,
            status: 'P',
            statusLabel: 'Present',
            shiftCode: 'GEN2',
            shiftName: 'Ack & Grw',
            firstIn: '10:44',
            lastOut: '23:02',
            actualWorkHrs: '12:18',
            workMinutes: 738,
            isLate: true,
            lateMinutes: 74,
            hasExceptionMark: true,
            isToday,
            isFuture,
          });
        } else if (isToday) {
          // Live Today record: check if dbLog has punches or defaults to active shift
          const hasDbCheckIn = todayDbLog?.checkInTime;
          const hasDbCheckOut = todayDbLog?.checkOutTime;

          list.push({
            date: dateStr,
            dayNum,
            monthLabel,
            dayOfWeek,
            dayOfWeekChar,
            status: 'P',
            statusLabel: hasDbCheckOut ? 'Shift Completed' : hasDbCheckIn ? 'Present (Active)' : 'Shift Active',
            shiftCode: 'GEN2',
            shiftName: 'General Shift',
            firstIn: hasDbCheckIn || '09:46',
            lastOut: hasDbCheckOut || '--:--',
            actualWorkHrs: todayDbLog?.hoursWorked ? `${todayDbLog.hoursWorked} hrs` : hasDbCheckOut ? '08:15' : 'In Progress',
            workMinutes: 495,
            isLate: todayDbLog?.isLate || false,
            hasExceptionMark: false,
            isToday: true,
            isFuture: false,
          });
        } else if (isFuture) {
          list.push({
            date: dateStr,
            dayNum,
            monthLabel,
            dayOfWeek,
            dayOfWeekChar,
            status: 'P',
            statusLabel: 'Scheduled',
            shiftCode: 'GEN2',
            shiftName: 'General Shift',
            isToday: false,
            isFuture: true,
          });
        } else {
          // Regular past working days (including Sundays)
          const lateDays = ['2026-09-24', '2026-09-29', '2026-10-05'];
          const earlyDays = ['2026-09-28', '2026-10-10'];
          const isLate = lateDays.includes(dateStr);
          const isEarlyOut = earlyDays.includes(dateStr);

          list.push({
            date: dateStr,
            dayNum,
            monthLabel,
            dayOfWeek,
            dayOfWeekChar,
            status: 'P',
            statusLabel: 'Present',
            shiftCode: 'GEN2',
            shiftName: 'General Shift',
            firstIn: isLate ? '10:15' : '09:30',
            lastOut: isEarlyOut ? '18:20' : '21:30',
            actualWorkHrs: '12:00',
            workMinutes: 720,
            isLate,
            lateMinutes: isLate ? 45 : 0,
            isEarlyOut,
            earlyMinutes: isEarlyOut ? 40 : 0,
            hasExceptionMark: false,
            isToday: false,
            isFuture: false,
          });
        }
      }

      curr.setDate(curr.getDate() + 1);
    }

    return list;
  }, [currentYear, currentMonthIndex, db.attendance, currentStaff, todayDateStr, todayDbLog]);

  // Aggregate stats (Sundays are full working days!)
  const stats = useMemo(() => {
    let presentCount = 0;
    let holidayCount = 0;
    let restDayCount = 0;
    let absentCount = 0;
    let lateInCount = 0;
    let earlyOutCount = 0;
    let exceptionCount = 0;
    let totalWorkMinutes = 0;

    cycleDays.forEach((d) => {
      if (d.isFuture) return;
      if (d.status === 'P') {
        presentCount++;
        if (d.workMinutes) totalWorkMinutes += d.workMinutes;
      } else if (d.status === 'H') {
        holidayCount++;
      } else if (d.status === 'WO') {
        restDayCount++;
      } else if (d.status === 'A') {
        absentCount++;
      }

      if (d.isLate) lateInCount++;
      if (d.isEarlyOut) earlyOutCount++;
      if (d.hasExceptionMark) exceptionCount++;
    });

    const avgMinutes = presentCount > 0 ? Math.round(totalWorkMinutes / presentCount) : 690;
    const avgHours = Math.floor(avgMinutes / 60);
    const avgRemMins = avgMinutes % 60;
    const avgWorkHoursFormatted = `${String(avgHours).padStart(2, '0')}:${String(avgRemMins).padStart(2, '0')}`;

    return {
      present: presentCount || 24,
      holiday: holidayCount || 1,
      restDay: restDayCount || 0,
      absent: absentCount || 0,
      workingDays: presentCount || 24,
      lateInDays: lateInCount || 6,
      earlyOutDays: earlyOutCount || 2,
      exceptionDays: exceptionCount || 2,
      deductionDays: 3,
      avgWorkHours: avgWorkHoursFormatted,
    };
  }, [cycleDays]);

  // SVG Pie/Donut Chart calculation
  const donutData = useMemo(() => {
    const total = stats.present + stats.holiday + stats.restDay + (stats.absent || 0);
    if (total === 0) return { presentPct: 96, holidayPct: 4, restPct: 0, absentPct: 0 };

    const presentPct = (stats.present / total) * 100;
    const holidayPct = (stats.holiday / total) * 100;
    const restPct = (stats.restDay / total) * 100;
    const absentPct = ((stats.absent || 0) / total) * 100;

    return { presentPct, holidayPct, restPct, absentPct };
  }, [stats]);

  // Live Today values
  const todayRecord = useMemo(() => {
    const fromCycle = cycleDays.find((d) => d.isToday);
    const checkIn = todayDbLog?.checkInTime || (fromCycle?.firstIn && fromCycle.firstIn !== '--:--' ? fromCycle.firstIn : null) || '--:--';
    const checkOut = todayDbLog?.checkOutTime || (fromCycle?.lastOut && fromCycle.lastOut !== '--:--' ? fromCycle.lastOut : null) || '--:--';
    const isCompleted = Boolean(todayDbLog?.checkOutTime && todayDbLog.checkOutTime !== '--:--');
    const isPunchedIn = Boolean((todayDbLog?.checkInTime && todayDbLog.checkInTime !== '--:--') || (checkIn && checkIn !== '--:--'));

    let actualWorkHrs = '--:--';
    if (todayDbLog?.hoursWorked) {
      actualWorkHrs = `${todayDbLog.hoursWorked} hrs`;
    } else if (isPunchedIn && !isCompleted) {
      actualWorkHrs = 'On Duty (Active)';
    } else if (isCompleted) {
      actualWorkHrs = 'Shift Completed';
    } else if (fromCycle?.actualWorkHrs) {
      actualWorkHrs = fromCycle.actualWorkHrs;
    }

    return {
      firstIn: checkIn,
      lastOut: checkOut,
      actualWorkHrs,
      shiftName: todayDbLog?.shiftName || fromCycle?.shiftName || 'General Shift (09:30 - 19:30)',
      isLate: todayDbLog?.isLate || fromCycle?.isLate || false,
      isPunchedIn,
      isCompleted,
    };
  }, [cycleDays, todayDbLog]);

  // Calendar Grid Cells with Day of Week Alignment
  const calendarGrid = useMemo(() => {
    if (cycleDays.length === 0) return [];
    const firstDay = cycleDays[0];
    const firstDateObj = new Date(firstDay.date);
    const leadingBlanks = firstDateObj.getDay();

    const cells: (DayRecord | null)[] = [];
    for (let i = 0; i < leadingBlanks; i++) {
      cells.push(null);
    }
    cycleDays.forEach((d) => cells.push(d));
    return cells;
  }, [cycleDays]);

  const handleRegularizeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setRegularizeSubmitted(true);
    setTimeout(() => {
      setShowRegularizeModal(false);
      setRegularizeSubmitted(false);
      alert(`Attendance Regularization request submitted for ${regularizeDate} (${regularizeInTime} to ${regularizeOutTime}) successfully!`);
    }, 1200);
  };

  return (
    <div className="flex flex-col gap-5 max-w-2xl mx-auto w-full pb-16 font-sans">
      {/* ── TOP NAV HEADER ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-3">
          {onBackToTerminal && (
            <button
              onClick={onBackToTerminal}
              className="w-9 h-9 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center justify-center transition-all"
              title="Back"
            >
              <span className="material-symbols-outlined text-xl">arrow_back</span>
            </button>
          )}
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
            Attendance Info
          </h1>
        </div>

        <div className="flex items-center gap-2">
          {onOpenQrModal && (
            <button
              onClick={onOpenQrModal}
              className="px-3 py-1.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/80 hover:bg-emerald-100 transition-all flex items-center gap-1.5 shadow-sm"
              title="View Attendance Standee QR"
            >
              <span className="material-symbols-outlined text-sm">qr_code_scanner</span>
              <span className="hidden sm:inline">QR Standee</span>
            </button>
          )}
          <span className="px-3 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
            {currentStaff.role}
          </span>
        </div>
      </div>

      {/* ── TODAY CHECK IN & TODAY CHECK OUT CARDS (AUTOMATED ON LOGIN / SCAN) ─ */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
        {/* Check In Card */}
        <div className="bg-white rounded-2xl p-4 sm:p-5 shadow-sm border border-slate-200/90 relative overflow-hidden transition-all hover:shadow-md">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-emerald-500 to-teal-400" />
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-2xl">login</span>
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Today Check-In
                </p>
                <h3 className="text-2xl sm:text-3xl font-black text-slate-900 mt-0.5 tracking-tight">
                  {todayRecord.firstIn}
                </h3>
              </div>
            </div>

            {todayRecord.isPunchedIn ? (
              <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200 shrink-0">
                {todayRecord.isLate ? 'Late Arrival' : 'On Time'}
              </span>
            ) : (
              <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-slate-100 text-slate-600 border border-slate-200 shrink-0">
                Pending Login
              </span>
            )}
          </div>
          <div className="mt-3.5 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <span className="flex items-center gap-1">
              <span className="material-symbols-outlined text-sm text-emerald-600">verified</span>
              {todayRecord.isPunchedIn ? 'Logged on Login / Scan' : 'Pending Check-In'}
            </span>
            <span className="font-medium text-slate-700">{todayDateStr}</span>
          </div>
        </div>

        {/* Check Out Card */}
        <div className="bg-white rounded-2xl p-4 sm:p-5 shadow-sm border border-slate-200/90 relative overflow-hidden transition-all hover:shadow-md">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-500 to-indigo-500" />
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-2xl">logout</span>
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Today Check-Out
                </p>
                <h3 className="text-2xl sm:text-3xl font-black text-slate-900 mt-0.5 tracking-tight">
                  {todayRecord.lastOut}
                </h3>
              </div>
            </div>

            {todayRecord.isCompleted ? (
              <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-slate-100 text-slate-700 border border-slate-200 shrink-0">
                Completed
              </span>
            ) : todayRecord.isPunchedIn ? (
              <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-blue-50 text-blue-700 border border-blue-200 shrink-0 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-600 animate-pulse" />
                On Duty
              </span>
            ) : (
              <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-slate-100 text-slate-500 border border-slate-200 shrink-0">
                Shift Inactive
              </span>
            )}
          </div>
          <div className="mt-3.5 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <span className="flex items-center gap-1">
              <span className="material-symbols-outlined text-sm text-blue-600">schedule</span>
              {todayRecord.actualWorkHrs}
            </span>
            <span className="font-medium text-slate-700">{todayRecord.shiftName}</span>
          </div>
        </div>
      </div>

      {/* ── HERO BANNER WITH ILLUSTRATION & MONTH SELECTOR ───────────────────── */}
      <div className="bg-gradient-to-br from-[#FFF5EC] via-[#FFF0E6] to-[#FFEBE0] rounded-3xl p-5 sm:p-6 border border-orange-100/80 shadow-sm relative overflow-hidden">
        <div className="flex items-center justify-between gap-4 relative z-10">
          <div className="w-24 h-24 sm:w-28 sm:h-28 shrink-0 flex items-center justify-center">
            <svg viewBox="0 0 120 120" className="w-full h-full drop-shadow-sm" fill="none">
              {/* Wall Calendar */}
              <rect x="52" y="14" width="34" height="30" rx="3" fill="#ffffff" stroke="#2D3748" strokeWidth="2" />
              <rect x="52" y="14" width="34" height="8" rx="2" fill="#E2E8F0" />
              <line x1="60" y1="28" x2="80" y2="28" stroke="#CBD5E0" strokeWidth="2" strokeDasharray="2 3" />
              <line x1="60" y1="34" x2="80" y2="34" stroke="#CBD5E0" strokeWidth="2" strokeDasharray="2 3" />
              <circle cx="58" cy="18" r="1.5" fill="#E53E3E" />
              <circle cx="80" cy="18" r="1.5" fill="#E53E3E" />
              {/* Desk & Person */}
              <rect x="30" y="76" width="76" height="5" rx="2" fill="#2D3748" />
              <polygon points="56,76 78,76 74,62 58,62" fill="#EDF2F7" stroke="#2D3748" strokeWidth="2" />
              <rect x="50" y="75" width="34" height="3" rx="1.5" fill="#A0AEC0" />
              <ellipse cx="40" cy="36" rx="9" ry="10" fill="#1A202C" />
              <circle cx="43" cy="38" r="7" fill="#FEEBC8" />
              <path d="M32 48 C30 54, 28 66, 30 76 L52 76 C52 70, 52 56, 48 48 Z" fill="#7C3AED" />
              <path d="M46 54 C54 58, 58 64, 62 72 L58 74 C54 68, 50 62, 44 58 Z" fill="#7C3AED" />
              <circle cx="63" cy="73" r="3" fill="#FEEBC8" />
            </svg>
          </div>

          <div className="flex-1 text-right sm:text-left">
            <h2 className="text-sm sm:text-base font-bold text-slate-800 leading-snug">
              View your monthly attendance
            </h2>
            <p className="text-xs sm:text-sm text-slate-600 mt-0.5">
              information & shift logs
            </p>
          </div>
        </div>

        {/* Month Selector Pill */}
        <div className="mt-4 bg-white/95 backdrop-blur-sm rounded-2xl py-2 px-5 flex items-center justify-between shadow-sm border border-orange-200/60">
          <button
            type="button"
            onClick={handlePrevMonth}
            className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-700 transition-all active:scale-95"
            title="Previous Month"
          >
            <span className="material-symbols-outlined text-xl">chevron_left</span>
          </button>

          <span className="text-base sm:text-lg font-extrabold text-slate-800 tracking-tight">
            {monthDisplayLabel}
          </span>

          <button
            type="button"
            onClick={handleNextMonth}
            className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-700 transition-all active:scale-95"
            title="Next Month"
          >
            <span className="material-symbols-outlined text-xl">chevron_right</span>
          </button>
        </div>
      </div>

      {/* ── TWO TABS: OVERVIEW | DAY WISE ──────────────────────────────────── */}
      <div className="flex border-b border-slate-200 bg-white rounded-t-2xl px-2">
        <button
          type="button"
          onClick={() => setActiveTab('overview')}
          className={`flex-1 py-3 text-center text-sm font-bold transition-all relative ${
            activeTab === 'overview'
              ? 'text-indigo-600'
              : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          <span>Overview</span>
          {activeTab === 'overview' && (
            <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-indigo-600 rounded-t-full" />
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('day_wise')}
          className={`flex-1 py-3 text-center text-sm font-bold transition-all relative ${
            activeTab === 'day_wise'
              ? 'text-indigo-600'
              : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          <span>Day Wise</span>
          {activeTab === 'day_wise' && (
            <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-indigo-600 rounded-t-full" />
          )}
        </button>
      </div>

      {/* ── TAB 1: OVERVIEW ─────────────────────────────────────────────────── */}
      {activeTab === 'overview' && (
        <div className="flex flex-col gap-4 animate-in fade-in duration-200">
          {/* Exception Alert Banner */}
          <div className="bg-[#FFF3F3] border border-red-200/80 rounded-2xl p-3.5 sm:p-4 flex items-center justify-between shadow-sm">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-full bg-red-100 text-red-600 flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-base">error</span>
              </div>
              <span className="text-xs sm:text-sm font-bold text-slate-800">
                02 Exception days
              </span>
            </div>

            <button
              type="button"
              onClick={() => setShowRegularizeModal(true)}
              className="text-xs sm:text-sm font-bold text-indigo-600 hover:text-indigo-800 hover:underline transition-all active:scale-95"
            >
              Regularize
            </button>
          </div>

          {/* Monthly Pie/Donut Chart & Summary Card */}
          <div className="bg-white rounded-3xl p-5 sm:p-6 shadow-sm border border-slate-200 flex flex-col gap-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                  Summary
                </p>
                <h3 className="text-sm sm:text-base font-extrabold text-slate-900 mt-0.5">
                  21 Sep - 20 Oct
                </h3>
              </div>
              <span className="text-xs sm:text-sm font-extrabold text-slate-800">
                {stats.workingDays} Working days
              </span>
            </div>

            {/* Donut Chart */}
            <div className="flex flex-col items-center justify-center py-2">
              <div className="relative w-44 h-44 flex items-center justify-center">
                <svg viewBox="0 0 160 160" className="w-full h-full -rotate-90">
                  <circle
                    cx="80"
                    cy="80"
                    r="58"
                    stroke="#F1F5F9"
                    strokeWidth="18"
                    fill="transparent"
                  />

                  {/* Present Arc (Emerald) - Includes working Sundays! */}
                  <circle
                    cx="80"
                    cy="80"
                    r="58"
                    stroke="#48BB78"
                    strokeWidth="18"
                    strokeDasharray={`${(donutData.presentPct / 100) * 364.42} 364.42`}
                    strokeDashoffset="0"
                    strokeLinecap="round"
                    fill="transparent"
                    className="transition-all duration-700 ease-out"
                  />

                  {/* Holiday Arc (Cyan) */}
                  <circle
                    cx="80"
                    cy="80"
                    r="58"
                    stroke="#38BDF8"
                    strokeWidth="18"
                    strokeDasharray={`${(donutData.holidayPct / 100) * 364.42} 364.42`}
                    strokeDashoffset={`-${(donutData.presentPct / 100) * 364.42}`}
                    strokeLinecap="round"
                    fill="transparent"
                    className="transition-all duration-700 ease-out"
                  />
                </svg>

                <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                  <span className="text-3xl font-black text-slate-900 tracking-tight">
                    {stats.present}
                  </span>
                  <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                    Days In
                  </span>
                </div>
              </div>

              {/* Legend Row */}
              <div className="grid grid-cols-2 gap-4 w-full max-w-xs mt-5 pt-2">
                <div className="flex flex-col items-center text-center">
                  <div className="w-7 h-1.5 rounded-full bg-[#48BB78] mb-1.5" />
                  <span className="text-[11px] text-slate-500 font-semibold">Working Days / Present</span>
                  <span className="text-base font-black text-slate-900 mt-0.5">
                    {String(stats.present).padStart(2, '0')}
                  </span>
                </div>

                <div className="flex flex-col items-center text-center">
                  <div className="w-7 h-1.5 rounded-full bg-[#38BDF8] mb-1.5" />
                  <span className="text-[11px] text-slate-500 font-semibold">Holiday</span>
                  <span className="text-base font-black text-slate-900 mt-0.5">
                    {String(stats.holiday).padStart(2, '0')}
                  </span>
                </div>
              </div>
            </div>

            {/* Average Work Hours Section */}
            <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-500 font-medium">Average Work Hours</p>
                <h4 className="text-xl sm:text-2xl font-black text-slate-900 mt-0.5">
                  {stats.avgWorkHours}
                </h4>
              </div>
              <span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-md border border-emerald-100">
                Shift Fully Active
              </span>
            </div>
          </div>

          {/* ── INSIGHTS ACCORDIONS ─────────────────────────────────────────── */}
          <div className="flex flex-col gap-3 mt-1">
            <div>
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                Insights
              </p>
              <h4 className="text-sm font-extrabold text-slate-900 mt-0.5">
                21 Sep - 20 Oct
              </h4>
            </div>

            {/* Accordion 1: Deduction Overview */}
            <div className="bg-[#F6F8FD] rounded-2xl border border-slate-200/70 overflow-hidden transition-all">
              <button
                type="button"
                onClick={() => setOpenAccordion(openAccordion === 'deduction' ? null : 'deduction')}
                className="w-full p-4 flex items-center justify-between text-left"
              >
                <span className="text-sm font-bold text-slate-900">
                  Deduction Overview
                </span>
                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-white text-slate-700 border border-slate-200">
                    {stats.deductionDays} Days
                  </span>
                  <span
                    className={`material-symbols-outlined text-slate-500 text-lg transition-transform ${
                      openAccordion === 'deduction' ? 'rotate-180' : ''
                    }`}
                  >
                    expand_more
                  </span>
                </div>
              </button>

              {openAccordion === 'deduction' && (
                <div className="p-4 pt-0 text-xs text-slate-600 border-t border-slate-100/80 bg-white space-y-2">
                  <div className="flex justify-between py-1 border-b border-slate-100">
                    <span>Unpaid Absence Deductions</span>
                    <strong className="text-slate-800">2 Days</strong>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-100">
                    <span>Cumulative Half-day Penalties</span>
                    <strong className="text-slate-800">1 Day</strong>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1 italic">
                    Deductions are computed automatically from missed shift punches or unapproved leaves.
                  </p>
                </div>
              )}
            </div>

            {/* Accordion 2: Late-in */}
            <div className="bg-[#F6F8FD] rounded-2xl border border-slate-200/70 overflow-hidden transition-all">
              <button
                type="button"
                onClick={() => setOpenAccordion(openAccordion === 'late' ? null : 'late')}
                className="w-full p-4 flex items-center justify-between text-left"
              >
                <span className="text-sm font-bold text-slate-900">Late-in</span>
                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-white text-slate-700 border border-slate-200">
                    {stats.lateInDays} Days
                  </span>
                  <span
                    className={`material-symbols-outlined text-slate-500 text-lg transition-transform ${
                      openAccordion === 'late' ? 'rotate-180' : ''
                    }`}
                  >
                    expand_more
                  </span>
                </div>
              </button>

              {openAccordion === 'late' && (
                <div className="p-4 pt-0 text-xs text-slate-600 border-t border-slate-100/80 bg-white space-y-2">
                  <div className="space-y-1.5">
                    <div className="flex justify-between py-1 border-b border-slate-100">
                      <span>15 Oct (Thu) • In: 10:44</span>
                      <strong className="text-amber-700 font-bold">Late by 74 mins</strong>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-100">
                      <span>13 Oct (Tue) • In: 09:46</span>
                      <strong className="text-amber-700 font-bold">Late by 16 mins</strong>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-100">
                      <span>12 Oct (Mon) • In: 10:18</span>
                      <strong className="text-amber-700 font-bold">Late by 48 mins</strong>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-100">
                      <span>05 Oct (Mon) • In: 09:55</span>
                      <strong className="text-amber-700 font-bold">Late by 25 mins</strong>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-100">
                      <span>29 Sep (Tue) • In: 10:05</span>
                      <strong className="text-amber-700 font-bold">Late by 35 mins</strong>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-100">
                      <span>24 Sep (Thu) • In: 10:15</span>
                      <strong className="text-amber-700 font-bold">Late by 45 mins</strong>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Accordion 3: Early-out */}
            <div className="bg-[#F6F8FD] rounded-2xl border border-slate-200/70 overflow-hidden transition-all">
              <button
                type="button"
                onClick={() => setOpenAccordion(openAccordion === 'early' ? null : 'early')}
                className="w-full p-4 flex items-center justify-between text-left"
              >
                <span className="text-sm font-bold text-slate-900">Early-out</span>
                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-white text-slate-700 border border-slate-200">
                    {stats.earlyOutDays} Days
                  </span>
                  <span
                    className={`material-symbols-outlined text-slate-500 text-lg transition-transform ${
                      openAccordion === 'early' ? 'rotate-180' : ''
                    }`}
                  >
                    expand_more
                  </span>
                </div>
              </button>

              {openAccordion === 'early' && (
                <div className="p-4 pt-0 text-xs text-slate-600 border-t border-slate-100/80 bg-white space-y-2">
                  <div className="space-y-1.5">
                    <div className="flex justify-between py-1 border-b border-slate-100">
                      <span>10 Oct (Sat) • Out: 18:30 (Scheduled 19:30)</span>
                      <strong className="text-amber-700 font-bold">Left early by 60 mins</strong>
                    </div>
                    <div className="flex justify-between py-1 border-b border-slate-100">
                      <span>28 Sep (Mon) • Out: 18:20 (Scheduled 19:30)</span>
                      <strong className="text-amber-700 font-bold">Left early by 70 mins</strong>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Accordion 4: Exception */}
            <div className="bg-[#F6F8FD] rounded-2xl border border-slate-200/70 overflow-hidden transition-all">
              <button
                type="button"
                onClick={() => setOpenAccordion(openAccordion === 'exception' ? null : 'exception')}
                className="w-full p-4 flex items-center justify-between text-left"
              >
                <span className="text-sm font-bold text-slate-900">Exception</span>
                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-white text-slate-700 border border-slate-200">
                    {stats.exceptionDays > 0 ? `${stats.exceptionDays} Days` : 'None'}
                  </span>
                  <span
                    className={`material-symbols-outlined text-slate-500 text-lg transition-transform ${
                      openAccordion === 'exception' ? 'rotate-180' : ''
                    }`}
                  >
                    expand_more
                  </span>
                </div>
              </button>

              {openAccordion === 'exception' && (
                <div className="p-4 pt-0 text-xs text-slate-600 border-t border-slate-100/80 bg-white space-y-2">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between py-1.5 border-b border-slate-100">
                      <div>
                        <strong className="text-slate-900 block">13 Oct (Tue) • Single Punch</strong>
                        <span className="text-[11px] text-slate-500">In: 09:46 | Out: 09:46 (00:00 worked)</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setRegularizeDate('2026-10-13');
                          setShowRegularizeModal(true);
                        }}
                        className="px-2.5 py-1 rounded bg-indigo-50 text-indigo-700 font-bold text-xs hover:bg-indigo-100"
                      >
                        Fix
                      </button>
                    </div>

                    <div className="flex items-center justify-between py-1.5">
                      <div>
                        <strong className="text-slate-900 block">15 Oct (Thu) • Extended Punch</strong>
                        <span className="text-[11px] text-slate-500">In: 10:44 | Out: 23:02 (12:18 worked)</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setRegularizeDate('2026-10-15');
                          setShowRegularizeModal(true);
                        }}
                        className="px-2.5 py-1 rounded bg-indigo-50 text-indigo-700 font-bold text-xs hover:bg-indigo-100"
                      >
                        Fix
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── TAB 2: DAY WISE (GRID & LIST VIEW) ──────────────────────────────── */}
      {activeTab === 'day_wise' && (
        <div className="flex flex-col gap-4 animate-in fade-in duration-200">
          {/* Day Wise Subheader */}
          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleJumpToToday}
                className="px-4 py-1.5 rounded-full text-xs font-bold text-indigo-600 border border-indigo-200/80 bg-white hover:bg-indigo-50 shadow-sm transition-all active:scale-95"
              >
                Today
              </button>

              <button
                type="button"
                onClick={() => setShowLegendModal(true)}
                className="w-8 h-8 rounded-full text-indigo-600 hover:bg-indigo-50 flex items-center justify-center transition-all"
                title="Attendance Legend"
              >
                <span className="material-symbols-outlined text-xl">help</span>
              </button>
            </div>

            {/* Toggle: [Grid View] [List View] */}
            <div className="flex items-center bg-white p-1 rounded-full border border-slate-200 shadow-sm">
              <button
                type="button"
                onClick={() => setDayWiseMode('grid')}
                className={`w-9 h-8 rounded-full flex items-center justify-center transition-all ${
                  dayWiseMode === 'grid'
                    ? 'bg-[#3B5998] text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-700'
                }`}
                title="Calendar Grid View"
              >
                <span className="material-symbols-outlined text-lg">grid_view</span>
              </button>

              <button
                type="button"
                onClick={() => setDayWiseMode('list')}
                className={`w-9 h-8 rounded-full flex items-center justify-center transition-all ${
                  dayWiseMode === 'list'
                    ? 'bg-[#3B5998] text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-700'
                }`}
                title="Detailed List View"
              >
                <span className="material-symbols-outlined text-lg">format_list_bulleted</span>
              </button>
            </div>
          </div>

          {/* ── 1. CALENDAR GRID VIEW (SUNDAYS ARE WORKING DAYS!) ────────────── */}
          {dayWiseMode === 'grid' && (
            <div className="bg-white rounded-3xl p-3 sm:p-5 shadow-sm border border-slate-200">
              {/* Day of Week Header - All 7 days are active working days */}
              <div className="grid grid-cols-7 text-center mb-2">
                {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((ch, idx) => (
                  <div
                    key={idx}
                    className="py-2 text-xs font-black uppercase text-slate-700"
                  >
                    {ch}
                  </div>
                ))}
              </div>

              {/* Calendar Grid Cells */}
              <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
                {calendarGrid.map((day, idx) => {
                  if (!day) {
                    return <div key={`blank-${idx}`} className="h-16 sm:h-20" />;
                  }

                  const isHoliday = day.status === 'H';
                  const isLateOrPeach = day.date === '2026-10-12' || day.date === '2026-10-13';
                  const isToday = day.isToday;

                  let cellBg = 'bg-[#F2F9F4] border-emerald-100/80'; // soft green working day
                  let letterColor = 'text-emerald-800';

                  if (isHoliday) {
                    cellBg = 'bg-[#EBF8FA] border-cyan-200/80';
                    letterColor = 'text-cyan-800';
                  } else if (isLateOrPeach) {
                    cellBg = 'bg-[#FFEED9] border-orange-200/80';
                    letterColor = 'text-amber-900';
                  } else if (day.isFuture) {
                    cellBg = 'bg-slate-50/60 border-slate-100';
                    letterColor = 'text-slate-300';
                  }

                  return (
                    <div
                      key={day.date}
                      onClick={() => setSelectedDayDetail(day)}
                      className={`h-16 sm:h-20 rounded-xl p-1 sm:p-1.5 flex flex-col justify-between border cursor-pointer transition-all hover:scale-[1.02] hover:shadow-md relative overflow-hidden ${cellBg}`}
                    >
                      {/* Top Row: Date Number or Blue Today Circle */}
                      <div className="flex items-start justify-between">
                        {isToday ? (
                          <div className="w-6 h-6 rounded-full bg-[#3B5998] text-white flex items-center justify-center text-xs font-black shadow-sm">
                            {day.dayNum}
                          </div>
                        ) : (
                          <span className="text-xs font-bold leading-none text-slate-800">
                            {day.dayNum}
                          </span>
                        )}
                      </div>

                      {/* Middle: Status Letter (P / H / A) */}
                      <div className="text-center">
                        {!day.isFuture && (
                          <span className={`text-xs sm:text-sm font-extrabold ${letterColor}`}>
                            {day.status}
                          </span>
                        )}
                      </div>

                      {/* Bottom Row: Shift Label (e.g. GEN2) */}
                      <div className="text-center">
                        <span className="text-[9px] font-semibold text-slate-400 tracking-tighter uppercase block truncate">
                          {day.shiftCode}
                        </span>
                      </div>

                      {/* Bottom-Right Corner Triangle */}
                      {day.hasExceptionMark && (
                        <div
                          className="absolute bottom-0 right-0 w-0 h-0 border-solid border-t-0 border-l-[10px] border-l-transparent border-b-[10px] border-b-[#3B5998]"
                          title="Attendance mark / Exception"
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── 2. DETAILED LIST VIEW ────────────────────────────────────────── */}
          {dayWiseMode === 'list' && (
            <div className="flex flex-col gap-3">
              {cycleDays
                .filter((d) => !d.isFuture)
                .slice()
                .reverse()
                .map((day) => {
                  const isHoliday = day.status === 'H';
                  const isLateOrPeach = day.date === '2026-10-12' || day.date === '2026-10-13';

                  let cardBg = 'bg-[#F2F9F4] border-emerald-200/90';
                  let headerBadge = 'text-emerald-800';

                  if (isHoliday) {
                    cardBg = 'bg-[#EBF8FA] border-cyan-200';
                    headerBadge = 'text-cyan-800';
                  } else if (isLateOrPeach) {
                    cardBg = 'bg-[#FFEED9] border-orange-200';
                    headerBadge = 'text-amber-800';
                  }

                  return (
                    <div
                      key={day.date}
                      onClick={() => setSelectedDayDetail(day)}
                      className={`rounded-2xl p-4 border transition-all cursor-pointer hover:shadow-md relative overflow-hidden ${cardBg}`}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="text-sm sm:text-base font-extrabold text-slate-900">
                            {day.dayNum} {day.monthLabel}
                          </h4>
                          <p className="text-xs text-slate-500 font-medium mt-0.5">
                            {day.dayOfWeek} &nbsp;|&nbsp; {day.shiftName}
                          </p>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <span className={`text-base font-black ${headerBadge}`}>
                            {day.status}
                          </span>
                          {day.hasExceptionMark && (
                            <span className="w-0 h-0 border-solid border-t-0 border-l-[8px] border-l-transparent border-b-[8px] border-b-[#3B5998]" />
                          )}
                          <span className="material-symbols-outlined text-slate-400 text-base">
                            chevron_right
                          </span>
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-black/[0.04]">
                        <div>
                          <span className="text-[10px] text-slate-500 font-semibold block uppercase">
                            First In
                          </span>
                          <span className="text-xs sm:text-sm font-black text-slate-800 mt-0.5 block">
                            {day.firstIn || '--:--'}
                          </span>
                        </div>

                        <div>
                          <span className="text-[10px] text-slate-500 font-semibold block uppercase">
                            Last Out
                          </span>
                          <span className="text-xs sm:text-sm font-black text-slate-800 mt-0.5 block">
                            {day.lastOut || '--:--'}
                          </span>
                        </div>

                        <div>
                          <span className="text-[10px] text-slate-500 font-semibold block uppercase">
                            Actual Work Hrs
                          </span>
                          <span className="text-xs sm:text-sm font-black text-slate-800 mt-0.5 block">
                            {day.actualWorkHrs || '--:--'}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      )}

      {/* ── MODAL 1: DAY INSPECTION MODAL ─────────────────────────────────────── */}
      {selectedDayDetail && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl max-w-sm w-full p-5 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <div>
                <h3 className="text-base font-extrabold text-slate-900">
                  {selectedDayDetail.dayNum} {selectedDayDetail.monthLabel} 2026
                </h3>
                <p className="text-xs text-slate-500 font-medium">
                  {selectedDayDetail.dayOfWeek} • {selectedDayDetail.shiftName}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedDayDetail(null)}
                className="w-8 h-8 rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 flex items-center justify-center"
              >
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>

            <div className="space-y-2.5 text-xs text-slate-700">
              <div className="flex justify-between py-1 border-b border-slate-50">
                <span className="text-slate-500">Status</span>
                <strong className="font-extrabold text-slate-900">
                  {selectedDayDetail.statusLabel}
                </strong>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-50">
                <span className="text-slate-500">First In Punch</span>
                <strong className="font-bold text-slate-900">
                  {selectedDayDetail.firstIn || '--:--'}
                </strong>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-50">
                <span className="text-slate-500">Last Out Punch</span>
                <strong className="font-bold text-slate-900">
                  {selectedDayDetail.lastOut || '--:--'}
                </strong>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-50">
                <span className="text-slate-500">Total Work Hours</span>
                <strong className="font-bold text-emerald-700">
                  {selectedDayDetail.actualWorkHrs || '--:--'}
                </strong>
              </div>
              {selectedDayDetail.isLate && (
                <div className="flex justify-between py-1 border-b border-slate-50 text-amber-700">
                  <span>Late Arrival</span>
                  <strong>{selectedDayDetail.lateMinutes || 15} mins late</strong>
                </div>
              )}
              {selectedDayDetail.isEarlyOut && (
                <div className="flex justify-between py-1 border-b border-slate-50 text-amber-700">
                  <span>Early Departure</span>
                  <strong>{selectedDayDetail.earlyMinutes || 30} mins early</strong>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => {
                setRegularizeDate(selectedDayDetail.date);
                setSelectedDayDetail(null);
                setShowRegularizeModal(true);
              }}
              className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs shadow-sm transition-all"
            >
              Request Regularization
            </button>
          </div>
        </div>
      )}

      {/* ── MODAL 2: REGULARIZE REQUEST DIALOG ───────────────────────────────── */}
      {showRegularizeModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl max-w-md w-full p-5 sm:p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center">
                  <span className="material-symbols-outlined text-lg">edit_calendar</span>
                </div>
                <div>
                  <h3 className="text-sm sm:text-base font-extrabold text-slate-900">
                    Attendance Regularization
                  </h3>
                  <p className="text-xs text-slate-500">Submit punch correction to Manager</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowRegularizeModal(false)}
                className="w-8 h-8 rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 flex items-center justify-center"
              >
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>

            <form onSubmit={handleRegularizeSubmit} className="space-y-3.5">
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">
                  Exception Date
                </label>
                <input
                  type="date"
                  value={regularizeDate}
                  onChange={(e) => setRegularizeDate(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">
                    Correct In Time
                  </label>
                  <input
                    type="time"
                    value={regularizeInTime}
                    onChange={(e) => setRegularizeInTime(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    required
                  />
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">
                    Correct Out Time
                  </label>
                  <input
                    type="time"
                    value={regularizeOutTime}
                    onChange={(e) => setRegularizeOutTime(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">
                  Reason for Exception
                </label>
                <textarea
                  rows={2}
                  value={regularizeReason}
                  onChange={(e) => setRegularizeReason(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="Explain why punch was missed or irregular..."
                  required
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowRegularizeModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={regularizeSubmitted}
                  className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs shadow-sm transition-all"
                >
                  {regularizeSubmitted ? 'Submitting...' : 'Submit Request'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── MODAL 3: CALENDAR LEGEND POPUP ──────────────────────────────────── */}
      {showLegendModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl max-w-sm w-full p-5 shadow-2xl border border-slate-200 space-y-3.5">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <h3 className="text-sm font-extrabold text-slate-900">Calendar Legend</h3>
              <button
                type="button"
                onClick={() => setShowLegendModal(false)}
                className="w-8 h-8 rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 flex items-center justify-center"
              >
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex items-center gap-3">
                <span className="w-6 h-6 rounded-md bg-[#F2F9F4] text-emerald-800 font-extrabold flex items-center justify-center text-xs border border-emerald-200">
                  P
                </span>
                <span className="text-slate-700">
                  <strong>Present</strong> - Shift attended on time (Mon - Sun working days)
                </span>
              </div>

              <div className="flex items-center gap-3">
                <span className="w-6 h-6 rounded-md bg-[#FFEED9] text-amber-800 font-extrabold flex items-center justify-center text-xs border border-orange-200">
                  P
                </span>
                <span className="text-slate-700">
                  <strong>Late-In / Early-Out</strong> - Shift punctuality deviation
                </span>
              </div>

              <div className="flex items-center gap-3">
                <span className="w-6 h-6 rounded-md bg-[#EBF8FA] text-cyan-800 font-extrabold flex items-center justify-center text-xs border border-cyan-200">
                  H
                </span>
                <span className="text-slate-700">
                  <strong>Holiday</strong> - Declared festive or public holiday
                </span>
              </div>

              <div className="flex items-center gap-3">
                <span className="w-6 h-6 rounded-full bg-[#3B5998] text-white font-extrabold flex items-center justify-center text-xs shadow-sm">
                  16
                </span>
                <span className="text-slate-700">
                  <strong>Current Date</strong> - Today's live active date
                </span>
              </div>

              <div className="flex items-center gap-3">
                <div className="w-6 h-6 flex items-center justify-center relative">
                  <div className="w-0 h-0 border-solid border-t-0 border-l-[10px] border-l-transparent border-b-[10px] border-b-[#3B5998]" />
                </div>
                <span className="text-slate-700">
                  <strong>Blue Triangle</strong> - Single punch or exception mark
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
