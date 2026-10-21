import { NextResponse } from 'next/server';
import { getDatabase, saveDatabase, logAudit } from '../../../lib/db';
import { AttendanceLog, ShiftConfig } from '../../../lib/types';
import { getLocalDateStr } from '../../../lib/dateUtils';
import {
  DEFAULT_SHIFTS,
  getShiftForStaff,
  calculatePunctuality,
  calculateDeparture,
  parseTimeToMinutes,
} from '../../../lib/shiftConfig';
import { calculateDistanceInMeters, formatDistance } from '../../../lib/geoUtils';

function calculateShiftHours(inTimeStr?: string, outTimeStr?: string): number {
  if (!inTimeStr || !outTimeStr) return 4.0;
  try {
    const inMins = parseTimeToMinutes(inTimeStr);
    const outMins = parseTimeToMinutes(outTimeStr);
    let diff = outMins - inMins;
    if (diff < 0) diff += 24 * 60; // Overnight shift support
    const hours = Math.round((diff / 60) * 10) / 10;
    return Math.max(0.1, hours);
  } catch {
    return 4.0;
  }
}

export async function GET() {
  try {
    const db = getDatabase();
    const todayStr = getLocalDateStr(new Date());
    return NextResponse.json({
      success: true,
      today: todayStr,
      staff: db.staff.filter((s) => s.isActive),
      shifts: db.shifts || DEFAULT_SHIFTS,
      todayAttendance: db.attendance.filter((a) => a.date === todayStr),
      restaurantName: db.settings?.restaurantName || 'United Food Palace',
      attendanceLocation: db.settings?.attendanceLocation || null,
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { action, userName, userRole } = body;
    const db = getDatabase();
    const todayStr = getLocalDateStr(new Date());

    // Ensure shifts exist in DB
    if (!db.shifts || db.shifts.length === 0) {
      db.shifts = DEFAULT_SHIFTS;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 1. BIOMETRIC ATTENDANCE VERIFICATION (PUNCH IN / PUNCH OUT)
    // ──────────────────────────────────────────────────────────────────────────
    if (action === 'VERIFY_FACE_ATTENDANCE') {
      const { staffId, confidence = 99.4, livenessPassed = true, latitude, longitude } = body;
      const staffMember = db.staff.find((s) => s.id === staffId);
      if (!staffMember) {
        return NextResponse.json({ success: false, message: 'Staff member not found' }, { status: 404 });
      }

      if (!livenessPassed) {
        return NextResponse.json({
          success: false,
          message: 'Biometric liveness check failed (blink/head-turn verification rejected)',
        }, { status: 400 });
      }

      // Check Geofence Enforcement
      const locationConfig = db.settings?.attendanceLocation;
      let verifiedDistance: number | undefined;
      if (locationConfig && locationConfig.enabled) {
        if (latitude === undefined || longitude === undefined || isNaN(Number(latitude)) || isNaN(Number(longitude))) {
          return NextResponse.json({
            success: false,
            geofenceRestricted: true,
            message: `📍 Geofence restriction: GPS location is required to verify attendance at ${locationConfig.locationName || 'the restaurant'}. Please enable location permissions on your device.`,
          }, { status: 403 });
        }

        verifiedDistance = calculateDistanceInMeters(
          Number(latitude),
          Number(longitude),
          locationConfig.latitude,
          locationConfig.longitude
        );

        if (verifiedDistance > locationConfig.radiusMeters) {
          return NextResponse.json({
            success: false,
            geofenceRestricted: true,
            distance: verifiedDistance,
            allowedRadius: locationConfig.radiusMeters,
            message: `📍 Attendance Rejected: Outside restaurant premises (${formatDistance(verifiedDistance)} away). Maximum allowed radius is ${locationConfig.radiusMeters}m from ${locationConfig.locationName || 'the premises'}.`,
          }, { status: 403 });
        }
      }

      const assignedShift = getShiftForStaff(staffMember, db.shifts);
      const existingLog = db.attendance.find((a) => a.staffId === staffId && a.date === todayStr);
      const currentTimeStr = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });

      if (existingLog) {
        // Case A: Staff already punched in, now punching OUT (2nd scan automatically logs off)
        if (!existingLog.checkOutTime || existingLog.checkOutTime === '--:--' || existingLog.checkOutTime.trim() === '') {
          const hours = calculateShiftHours(existingLog.checkInTime, currentTimeStr);
          const departure = calculateDeparture(currentTimeStr, assignedShift);

          existingLog.checkOutTime = currentTimeStr;
          existingLog.hoursWorked = hours;
          existingLog.leftEarly = departure.leftEarly;
          existingLog.leftEarlyMinutes = departure.leftEarlyMinutes;
          existingLog.isOvertime = departure.isOvertime;
          existingLog.overtimeMinutes = departure.overtimeMinutes;
          if (latitude !== undefined && longitude !== undefined) {
            existingLog.verifiedLatitude = Number(latitude);
            existingLog.verifiedLongitude = Number(longitude);
            existingLog.distanceMeters = verifiedDistance;
            existingLog.isLocationVerified = true;
          }

          const auditDesc = departure.leftEarly
            ? `Punched OUT at ${currentTimeStr} (${hours} hrs, left early by ${departure.leftEarlyMinutes}m, shift: ${assignedShift.name})`
            : departure.isOvertime
            ? `Punched OUT at ${currentTimeStr} (${hours} hrs, overtime +${departure.overtimeMinutes}m, shift: ${assignedShift.name})`
            : `Punched OUT at ${currentTimeStr} (${hours} hrs shift completed, shift: ${assignedShift.name})`;

          logAudit(db, staffMember.fullName, 'staff', 'UPDATE', 'ATTENDANCE', staffMember.employeeCode, {
            newValue: auditDesc,
            reason: `Live Biometric Face Recognition (FRS) - Punch Out (${departure.message})`,
          });

          saveDatabase(db);
          return NextResponse.json({
            success: true,
            punchType: 'punch_out',
            checkInTime: existingLog.checkInTime,
            checkOutTime: currentTimeStr,
            hoursWorked: hours,
            shift: assignedShift,
            leftEarly: departure.leftEarly,
            leftEarlyMinutes: departure.leftEarlyMinutes,
            departureMessage: departure.message,
            staff: staffMember,
            message: `🔴 Punch Out recorded for ${staffMember.fullName} at ${currentTimeStr}. Total Shift: ${hours} hrs • ${departure.message}.`,
            data: db,
          });
        } else {
          // Case B: Already punched out for today
          return NextResponse.json({
            success: true,
            alreadyMarked: true,
            punchType: 'already_completed',
            checkInTime: existingLog.checkInTime,
            checkOutTime: existingLog.checkOutTime,
            hoursWorked: existingLog.hoursWorked,
            shift: assignedShift,
            staff: staffMember,
            message: `${staffMember.fullName} has already completed shift today (Punched In: ${existingLog.checkInTime}, Punched Out: ${existingLog.checkOutTime}).`,
            data: db,
          });
        }
      } else {
        // Case C: First scan of the day - PUNCH IN
        const punctuality = calculatePunctuality(currentTimeStr, assignedShift);

        const newLog: AttendanceLog = {
          id: `att-${todayStr}-${staffMember.id}`,
          staffId: staffMember.id,
          staffName: staffMember.fullName,
          staffRole: staffMember.role,
          staffPhotoUrl: staffMember.photoUrl,
          date: todayStr,
          checkInTime: currentTimeStr,
          hoursWorked: 0,
          status: punctuality.status,
          verificationMethod: 'face_qr',
          faceConfidence: confidence,
          shiftId: assignedShift.id,
          shiftName: assignedShift.name,
          shiftTiming: `${assignedShift.startTime} - ${assignedShift.endTime}`,
          isLate: punctuality.isLate,
          lateMinutes: punctuality.lateMinutes,
          demoFlag: false,
          verifiedLatitude: latitude !== undefined ? Number(latitude) : undefined,
          verifiedLongitude: longitude !== undefined ? Number(longitude) : undefined,
          distanceMeters: verifiedDistance,
          isLocationVerified: verifiedDistance !== undefined,
        };
        db.attendance.unshift(newLog);

        const auditDesc = punctuality.isLate
          ? `Punched IN at ${currentTimeStr} (LATE by ${punctuality.lateMinutes}m, shift: ${assignedShift.name} ${assignedShift.startTime})`
          : `Punched IN at ${currentTimeStr} (ON TIME for shift: ${assignedShift.name})`;

        logAudit(db, staffMember.fullName, 'staff', 'CREATE', 'ATTENDANCE', staffMember.employeeCode, {
          newValue: auditDesc,
          reason: `Live Biometric Face Recognition (FRS) - Punch In (${punctuality.message})`,
        });

        saveDatabase(db);
        return NextResponse.json({
          success: true,
          punchType: 'punch_in',
          checkInTime: currentTimeStr,
          shift: assignedShift,
          isLate: punctuality.isLate,
          lateMinutes: punctuality.lateMinutes,
          punctualityMessage: punctuality.message,
          staff: staffMember,
          message: punctuality.isLate
            ? `🟠 Punch In recorded for ${staffMember.fullName} at ${currentTimeStr}. ⚠️ Late by ${punctuality.lateMinutes} mins for ${assignedShift.name}.`
            : `🟢 Punch In recorded for ${staffMember.fullName} at ${currentTimeStr}. Status: Present • On Time (${assignedShift.name}).`,
          data: db,
        });
      }
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 2. MANUAL ATTENDANCE OVERRIDE & CELL ROSTER UPDATE
    // ──────────────────────────────────────────────────────────────────────────
    if (action === 'MANAGER_OVERRIDE') {
      const { staffId, date: overrideDate, checkInTime, checkOutTime, reason, status: overrideStatus, shiftId: customShiftId } = body;
      const targetDate = overrideDate || todayStr;
      const effectiveReason = reason || `Admin Sheet Update (${overrideStatus || 'present'})`;

      let staffMember = db.staff.find((s) => s.id === staffId);
      if (!staffMember && userName) {
        staffMember = db.staff.find((s) => s.fullName.toLowerCase() === userName.toLowerCase());
      }
      if (!staffMember) return NextResponse.json({ success: false, message: 'Staff member not found' }, { status: 404 });

      // Determine shift
      let assignedShift = customShiftId ? db.shifts.find((s) => s.id === customShiftId) : null;
      if (!assignedShift) {
        assignedShift = getShiftForStaff(staffMember, db.shifts);
      }

      const effectiveStatus = overrideStatus || (checkInTime ? 'present' : 'override');
      const isAbsent = effectiveStatus === 'absent';
      const effectiveCheckIn = isAbsent ? undefined : (checkInTime || (assignedShift ? assignedShift.startTime : '10:00'));
      const effectiveCheckOut = isAbsent ? undefined : (checkOutTime || (assignedShift ? assignedShift.endTime : '19:00'));
      const punctuality = effectiveCheckIn ? calculatePunctuality(effectiveCheckIn, assignedShift) : { isLate: false, lateMinutes: 0, status: 'present' as const, message: 'On Time' };
      const hoursWorked = isAbsent ? 0 : (effectiveCheckIn && effectiveCheckOut ? calculateShiftHours(effectiveCheckIn, effectiveCheckOut) : 8.0);

      const existingIdx = db.attendance.findIndex((a) => (a.staffId === staffMember!.id || a.staffName.toLowerCase() === staffMember!.fullName.toLowerCase()) && a.date === targetDate);
      if (existingIdx >= 0) {
        db.attendance[existingIdx] = {
          ...db.attendance[existingIdx],
          checkInTime: effectiveCheckIn,
          checkOutTime: effectiveCheckOut,
          hoursWorked,
          status: effectiveStatus,
          verificationMethod: 'manager_override',
          overrideReason: effectiveReason,
          overrideBy: userName || 'Manager',
          shiftId: assignedShift.id,
          shiftName: assignedShift.name,
          shiftTiming: `${assignedShift.startTime} - ${assignedShift.endTime}`,
          isLate: punctuality.isLate,
          lateMinutes: punctuality.lateMinutes,
        };
      } else {
        const newLog: AttendanceLog = {
          id: `att-${targetDate}-${staffMember.id}-override`,
          staffId: staffMember.id,
          staffName: staffMember.fullName,
          staffRole: staffMember.role,
          staffPhotoUrl: staffMember.photoUrl,
          date: targetDate,
          checkInTime: effectiveCheckIn,
          checkOutTime: effectiveCheckOut,
          hoursWorked,
          status: effectiveStatus,
          verificationMethod: 'manager_override',
          overrideReason: effectiveReason,
          overrideBy: userName || 'Manager',
          shiftId: assignedShift.id,
          shiftName: assignedShift.name,
          shiftTiming: `${assignedShift.startTime} - ${assignedShift.endTime}`,
          isLate: punctuality.isLate,
          lateMinutes: punctuality.lateMinutes,
          demoFlag: false,
        };
        db.attendance.unshift(newLog);
      }

      logAudit(db, userName || 'Manager', userRole || 'manager', 'ATTENDANCE_OVERRIDE', 'ATTENDANCE', staffMember.employeeCode, {
        newValue: `Record updated for ${targetDate}: ${effectiveStatus.toUpperCase()} (${assignedShift.name})`,
        reason: effectiveReason,
      });

      saveDatabase(db);
      return NextResponse.json({ success: true, message: `Updated attendance for ${staffMember.fullName} on ${targetDate}`, data: db });
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 3. SHIFT CONFIGURATION: SAVE & UPDATE SHIFTS
    // ──────────────────────────────────────────────────────────────────────────
    if (action === 'SAVE_SHIFTS') {
      const { shifts } = body;
      if (!Array.isArray(shifts) || shifts.length === 0) {
        return NextResponse.json({ success: false, message: 'Invalid shift configurations array.' }, { status: 400 });
      }

      db.shifts = shifts;
      logAudit(db, userName || 'Admin', userRole || 'admin', 'UPDATE', 'SHIFT_SETTINGS', 'SHIFTS', {
        newValue: `Configured ${shifts.length} shift schedules: ${shifts.map((s: ShiftConfig) => s.name).join(', ')}`,
      });

      saveDatabase(db);
      return NextResponse.json({
        success: true,
        message: 'Shift configurations saved successfully.',
        shifts: db.shifts,
        data: db,
      });
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 4. SHIFT ASSIGNMENT: ASSIGN SHIFTS TO STAFF MEMBERS
    // ──────────────────────────────────────────────────────────────────────────
    if (action === 'ASSIGN_STAFF_SHIFTS') {
      const { assignments } = body; // Array of { staffId: string, shiftId: string }
      if (!Array.isArray(assignments)) {
        return NextResponse.json({ success: false, message: 'Invalid assignments array.' }, { status: 400 });
      }

      let updatedCount = 0;
      assignments.forEach(({ staffId, shiftId }: { staffId: string; shiftId: string }) => {
        const staff = db.staff.find((s) => s.id === staffId);
        if (staff) {
          staff.assignedShiftId = shiftId;
          updatedCount++;
        }
      });

      logAudit(db, userName || 'Admin', userRole || 'admin', 'UPDATE', 'STAFF_SHIFTS', 'ROSTER', {
        newValue: `Assigned shifts to ${updatedCount} staff members`,
      });

      saveDatabase(db);
      return NextResponse.json({
        success: true,
        message: `Updated shift assignments for ${updatedCount} staff members.`,
        data: db,
      });
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 5. APPROVE LEAVE
    // ──────────────────────────────────────────────────────────────────────────
    if (action === 'APPROVE_LEAVE') {
      const { leaveId } = body;
      const leave = db.leaveRequests.find((l) => l.id === leaveId);
      if (leave) {
        leave.status = 'approved';
        leave.approvedBy = userName || 'Manager';
        logAudit(db, userName || 'Manager', userRole || 'manager', 'UPDATE', 'LEAVE', leave.staffName, {
          newValue: `Approved ${leave.leaveType} leave (${leave.startDate} to ${leave.endDate})`,
        });
        saveDatabase(db);
        return NextResponse.json({ success: true, data: db });
      }
      return NextResponse.json({ success: false, message: 'Leave request not found' }, { status: 404 });
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 6. DEV / DEMO RESET TODAY'S ATTENDANCE
    // ──────────────────────────────────────────────────────────────────────────
    if (action === 'DEV_RESET_TODAY') {
      db.attendance = db.attendance.filter((a) => a.date !== todayStr);
      saveDatabase(db);
      return NextResponse.json({ success: true, message: `All attendance records for ${todayStr} have been reset.`, data: db });
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 7. RECORD PUNCH (STAFF LOGIN PUNCH IN / LOGOUT PUNCH OUT & CARD ACTIONS)
    // ──────────────────────────────────────────────────────────────────────────
    if (action === 'STAFF_PUNCH') {
      const { staffId, type = 'auto', time, latitude, longitude } = body; // type: 'auto' | 'in' | 'out'
      let staffMember = db.staff.find((s) => s.id === staffId);
      if (!staffMember && userName) {
        staffMember = db.staff.find((s) => s.fullName.toLowerCase() === userName.toLowerCase());
      }
      if (!staffMember) {
        staffMember = {
          id: staffId || `stf-${Date.now()}`,
          employeeCode: 'UFP-EMP-01',
          fullName: userName || 'Staff Member',
          role: userRole || 'staff',
          department: 'Service',
          phone: '+91 98450 12345',
          email: `${userName || 'staff'}@unitedfoodpalace.com`,
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
          photoUrl: '',
          hasFaceEnrolled: false,
          isActive: true,
        };
        db.staff.push(staffMember);
      }

      // Check Geofence if location is configured
      const locationConfig = db.settings?.attendanceLocation;
      let punchDistance: number | undefined;
      if (locationConfig && locationConfig.enabled) {
        if (latitude !== undefined && longitude !== undefined && !isNaN(Number(latitude)) && !isNaN(Number(longitude))) {
          punchDistance = calculateDistanceInMeters(
            Number(latitude),
            Number(longitude),
            locationConfig.latitude,
            locationConfig.longitude
          );

          if (punchDistance > locationConfig.radiusMeters) {
            return NextResponse.json({
              success: false,
              geofenceRestricted: true,
              distance: punchDistance,
              allowedRadius: locationConfig.radiusMeters,
              message: `📍 Attendance Rejected: Outside geofence (${formatDistance(punchDistance)} away). Maximum allowed radius is ${locationConfig.radiusMeters}m from ${locationConfig.locationName || 'the premises'}.`,
            }, { status: 403 });
          }
        }
      }

      const assignedShift = getShiftForStaff(staffMember, db.shifts);
      const currentTimeStr = time || new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
      const existingLog = db.attendance.find(
        (a) => (a.staffId === staffMember!.id || a.staffName.toLowerCase() === staffMember!.fullName.toLowerCase()) && a.date === todayStr
      );

      if (type === 'out' || (type === 'auto' && existingLog && !existingLog.checkOutTime)) {
        // Record Punch Out
        if (existingLog) {
          const hours = calculateShiftHours(existingLog.checkInTime, currentTimeStr);
          const departure = calculateDeparture(currentTimeStr, assignedShift);

          existingLog.checkOutTime = currentTimeStr;
          existingLog.hoursWorked = hours;
          existingLog.leftEarly = departure.leftEarly;
          existingLog.leftEarlyMinutes = departure.leftEarlyMinutes;
          existingLog.isOvertime = departure.isOvertime;
          existingLog.overtimeMinutes = departure.overtimeMinutes;
          if (latitude !== undefined && longitude !== undefined) {
            existingLog.verifiedLatitude = Number(latitude);
            existingLog.verifiedLongitude = Number(longitude);
            existingLog.distanceMeters = punchDistance;
            existingLog.isLocationVerified = true;
          }

          logAudit(db, staffMember.fullName, 'staff', 'UPDATE', 'ATTENDANCE', staffMember.employeeCode, {
            newValue: `Punched OUT at ${currentTimeStr} (${hours} hrs worked)`,
            reason: `Staff Logout / Punch Out (${departure.message})`,
          });
          saveDatabase(db);
          return NextResponse.json({
            success: true,
            punchType: 'punch_out',
            checkInTime: existingLog.checkInTime,
            checkOutTime: currentTimeStr,
            hoursWorked: hours,
            message: `Punch Out recorded at ${currentTimeStr} (${hours} hrs worked)`,
            data: db,
          });
        }
      } else if (type === 'in' || (type === 'auto' && !existingLog)) {
        // Record Punch In
        if (!existingLog) {
          const punctuality = calculatePunctuality(currentTimeStr, assignedShift);
          const newLog: AttendanceLog = {
            id: `att-${todayStr}-${staffMember.id}`,
            staffId: staffMember.id,
            staffName: staffMember.fullName,
            staffRole: staffMember.role,
            staffPhotoUrl: staffMember.photoUrl,
            date: todayStr,
            checkInTime: currentTimeStr,
            hoursWorked: 0,
            status: punctuality.status,
            verificationMethod: 'face_qr',
            shiftId: assignedShift.id,
            shiftName: assignedShift.name,
            shiftTiming: `${assignedShift.startTime} - ${assignedShift.endTime}`,
            isLate: punctuality.isLate,
            lateMinutes: punctuality.lateMinutes,
            verifiedLatitude: latitude !== undefined ? Number(latitude) : undefined,
            verifiedLongitude: longitude !== undefined ? Number(longitude) : undefined,
            distanceMeters: punchDistance,
            isLocationVerified: punchDistance !== undefined && punchDistance <= (locationConfig?.radiusMeters || 150),
            demoFlag: false,
          };
          db.attendance.unshift(newLog);
          logAudit(db, staffMember.fullName, 'staff', 'CREATE', 'ATTENDANCE', staffMember.employeeCode, {
            newValue: `Punched IN at ${currentTimeStr} (${punctuality.message})`,
            reason: `Staff Login / Punch In (${punctuality.message})`,
          });
          saveDatabase(db);
          return NextResponse.json({
            success: true,
            punchType: 'punch_in',
            checkInTime: currentTimeStr,
            message: `Punch In recorded at ${currentTimeStr}`,
            data: db,
          });
        }
      }

      return NextResponse.json({
        success: true,
        alreadyMarked: true,
        checkInTime: existingLog?.checkInTime,
        checkOutTime: existingLog?.checkOutTime,
        hoursWorked: existingLog?.hoursWorked,
        data: db,
      });
    }

    return NextResponse.json({ success: false, message: 'Unknown action' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 });
  }
}
