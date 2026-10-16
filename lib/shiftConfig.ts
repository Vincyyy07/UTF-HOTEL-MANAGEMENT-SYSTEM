import { ShiftConfig, Staff } from './types';

export const DEFAULT_SHIFTS: ShiftConfig[] = [
  {
    id: 'shift-morning',
    name: 'Morning Shift',
    startTime: '07:00',
    endTime: '15:30',
    gracePeriodMinutes: 15,
    halfDayHours: 4.0,
    color: 'emerald',
    description: 'Breakfast & lunch prep, cooking & dining service',
  },
  {
    id: 'shift-general',
    name: 'General Shift',
    startTime: '10:00',
    endTime: '19:00',
    gracePeriodMinutes: 15,
    halfDayHours: 4.5,
    color: 'blue',
    description: 'Management, accounts, cash register & core day operations',
  },
  {
    id: 'shift-evening',
    name: 'Evening Shift',
    startTime: '15:00',
    endTime: '23:30',
    gracePeriodMinutes: 15,
    halfDayHours: 4.0,
    color: 'amber',
    description: 'Dinner rush, banquet dining, kitchen closing & billing',
  },
  {
    id: 'shift-night',
    name: 'Night Shift',
    startTime: '18:00',
    endTime: '02:00',
    gracePeriodMinutes: 15,
    halfDayHours: 4.0,
    color: 'purple',
    description: 'Night bar service, deep kitchen sanitation & night security',
  },
];

/**
 * Parses any time string ("07:00", "07:00 AM", "03:30 PM", "15:30") to minutes from midnight (0..1439).
 */
export function parseTimeToMinutes(timeStr?: string): number {
  if (!timeStr) return 0;
  const isPm = /pm/i.test(timeStr);
  const isAm = /am/i.test(timeStr);
  const cleaned = timeStr.replace(/(am|pm)/i, '').trim();
  const parts = cleaned.split(':').map(Number);
  let h = parts[0] || 0;
  const m = parts[1] || 0;
  if (isPm && h < 12) h += 12;
  if (isAm && h === 12) h = 0;
  return h * 60 + m;
}

/**
 * Formats minutes from midnight to 12-hour AM/PM format (e.g. 930 -> "03:30 PM")
 */
export function formatMinutesTo12Hour(minutes: number): string {
  const normalized = ((minutes % 1440) + 1440) % 1440;
  let h = Math.floor(normalized / 60);
  const m = normalized % 60;
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} ${ampm}`;
}

/**
 * Formats 24h string ("07:00") into friendly 12h string ("07:00 AM")
 */
export function format24To12(time24: string): string {
  return formatMinutesTo12Hour(parseTimeToMinutes(time24));
}

/**
 * Resolves the assigned shift for a staff member, defaulting by department or general shift
 */
export function getShiftForStaff(staff: Staff, shifts: ShiftConfig[] = DEFAULT_SHIFTS): ShiftConfig {
  const allShifts = shifts.length > 0 ? shifts : DEFAULT_SHIFTS;
  if (staff.assignedShiftId) {
    const found = allShifts.find((s) => s.id === staff.assignedShiftId);
    if (found) return found;
  }

  // Fallback defaults based on department
  const dept = (staff.department || '').toLowerCase();
  const role = (staff.role || '').toLowerCase();

  if (dept.includes('kitchen') || role.includes('chef') || role.includes('cook')) {
    return allShifts.find((s) => s.id === 'shift-morning') || allShifts[0];
  }
  if (dept.includes('service') || role.includes('steward') || role.includes('waiter')) {
    return allShifts.find((s) => s.id === 'shift-evening') || allShifts[0];
  }
  if (dept.includes('bar') || role.includes('bartender')) {
    return allShifts.find((s) => s.id === 'shift-night') || allShifts[allShifts.length - 1];
  }
  return allShifts.find((s) => s.id === 'shift-general') || allShifts[0];
}

/**
 * Evaluates punctuality for Punch In against the assigned shift
 */
export function calculatePunctuality(
  checkInTimeStr: string,
  shift: ShiftConfig
): {
  isLate: boolean;
  lateMinutes: number;
  status: 'present' | 'late';
  diffMinutes: number;
  message: string;
} {
  const checkInMins = parseTimeToMinutes(checkInTimeStr);
  const shiftStartMins = parseTimeToMinutes(shift.startTime);

  let diff = checkInMins - shiftStartMins;
  // Handle cross-midnight wrap around (e.g. shift starts at 23:00, checked in at 00:10)
  if (diff < -720) diff += 1440;
  if (diff > 720) diff -= 1440;

  const grace = shift.gracePeriodMinutes || 15;

  if (diff > grace) {
    return {
      isLate: true,
      lateMinutes: diff,
      status: 'late',
      diffMinutes: diff,
      message: `Late by ${diff}m (${shift.name} started at ${format24To12(shift.startTime)}, grace ${grace}m)`,
    };
  }

  return {
    isLate: false,
    lateMinutes: 0,
    status: 'present',
    diffMinutes: diff,
    message: diff <= 0 ? `On Time (${Math.abs(diff)}m early)` : `On Time (within ${grace}m grace)`,
  };
}

/**
 * Evaluates departure for Punch Out against the assigned shift
 */
export function calculateDeparture(
  checkOutTimeStr: string,
  shift: ShiftConfig
): {
  leftEarly: boolean;
  leftEarlyMinutes: number;
  isOvertime: boolean;
  overtimeMinutes: number;
  message: string;
} {
  const checkOutMins = parseTimeToMinutes(checkOutTimeStr);
  let shiftEndMins = parseTimeToMinutes(shift.endTime);
  const shiftStartMins = parseTimeToMinutes(shift.startTime);

  // If overnight shift (endTime < startTime), shift crosses midnight
  let normalizedCheckOut = checkOutMins;
  if (shiftEndMins < shiftStartMins) {
    shiftEndMins += 1440;
    if (normalizedCheckOut < shiftStartMins) {
      normalizedCheckOut += 1440;
    }
  }

  const diff = normalizedCheckOut - shiftEndMins;

  if (diff < -10) {
    const early = Math.abs(diff);
    return {
      leftEarly: true,
      leftEarlyMinutes: early,
      isOvertime: false,
      overtimeMinutes: 0,
      message: `Left early by ${early}m (${shift.name} ends at ${format24To12(shift.endTime)})`,
    };
  }

  if (diff > 30) {
    return {
      leftEarly: false,
      leftEarlyMinutes: 0,
      isOvertime: true,
      overtimeMinutes: diff,
      message: `Overtime (+${diff}m past ${format24To12(shift.endTime)})`,
    };
  }

  return {
    leftEarly: false,
    leftEarlyMinutes: 0,
    isOvertime: false,
    overtimeMinutes: 0,
    message: `Completed full shift (${shift.name})`,
  };
}
