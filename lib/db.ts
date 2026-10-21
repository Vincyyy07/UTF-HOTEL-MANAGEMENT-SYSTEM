import fs from 'fs';
import path from 'path';
import { DatabaseSchema, Bill, Order, Staff, AttendanceLog, StockMovement, ExpenseEntry, RestaurantTable, AuditLog, BusinessSettings } from './types';
import { generateSeedData } from './seed-data';
import { getSupabaseConfig } from './supabase';
import { pushAllDataToSupabase } from './supabaseDb';
import { DEFAULT_SHIFTS, getShiftForStaff } from './shiftConfig';
import { generateDeterministicFaceDescriptor } from './faceBiometrics';

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'hms_db.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function getDatabase(): DatabaseSchema {
  ensureDataDir();
  if (!fs.existsSync(DB_FILE)) {
    const initialData = generateSeedData();
    initialData.shifts = DEFAULT_SHIFTS;
    initialData.staff.forEach((s) => {
      if (!s.assignedShiftId) {
        s.assignedShiftId = getShiftForStaff(s, DEFAULT_SHIFTS).id;
      }
      if (!s.faceDescriptor || !Array.isArray(s.faceDescriptor) || s.faceDescriptor.length === 0) {
        s.faceDescriptor = generateDeterministicFaceDescriptor(s.employeeCode || s.id);
        s.hasFaceEnrolled = true;
      }
    });
    saveDatabase(initialData);
    return initialData;
  }
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as DatabaseSchema;
    let modified = false;
    if (!parsed.attendance) {
      parsed.attendance = [];
      modified = true;
    }
    if (!parsed.shifts || parsed.shifts.length === 0) {
      parsed.shifts = DEFAULT_SHIFTS;
      modified = true;
    }
    if (parsed.staff && parsed.staff.length > 0) {
      parsed.staff.forEach((s) => {
        if (!s.assignedShiftId) {
          const shift = getShiftForStaff(s, parsed.shifts);
          s.assignedShiftId = shift.id;
          modified = true;
        }
        if (!s.faceDescriptor || !Array.isArray(s.faceDescriptor) || s.faceDescriptor.length === 0) {
          s.faceDescriptor = generateDeterministicFaceDescriptor(s.employeeCode || s.id);
          s.hasFaceEnrolled = true;
          modified = true;
        }
      });
    }
    if (modified) {
      saveDatabase(parsed);
    }
    return parsed;
  } catch (err) {
    console.error('Error reading HMS DB, backing up before recovery:', err);
    try {
      if (fs.existsSync(DB_FILE)) {
        const corruptBackupPath = path.join(DATA_DIR, `corrupted_db_${Date.now()}.json.bak`);
        fs.copyFileSync(DB_FILE, corruptBackupPath);
        console.warn(`Corrupted database backed up to ${corruptBackupPath}`);
      }
    } catch (bakErr) {
      console.error('Failed to backup corrupted database file:', bakErr);
    }
    const fallback = generateSeedData();
    fallback.shifts = DEFAULT_SHIFTS;
    saveDatabase(fallback);
    return fallback;
  }
}

export function saveDatabase(data: DatabaseSchema): void {
  ensureDataDir();
  const tempFile = path.join(DATA_DIR, `hms_db_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.tmp`);
  try {
    fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tempFile, DB_FILE);
  } catch (writeErr) {
    console.error('Error in atomic saveDatabase write:', writeErr);
    // Fallback direct write if atomic rename fails on cross-device
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
    try {
      if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
    } catch {}
  }

  // Automatic background synchronization to Supabase if configured
  try {
    const config = getSupabaseConfig();
    if (config.isConfigured) {
      pushAllDataToSupabase(data).catch((err) => {
        console.warn('Background Supabase cloud replication note:', err?.message || err);
      });
    }
  } catch (err) {
    // Non-blocking
  }
}

export function logAudit(
  db: DatabaseSchema,
  userName: string,
  userRole: string,
  action: AuditLog['action'],
  entityType: string,
  entityId: string,
  options?: { oldValue?: string; newValue?: string; reason?: string }
) {
  const newLog: AuditLog = {
    id: `log-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
    timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19),
    userName,
    userRole,
    action,
    entityType,
    entityId,
    oldValue: options?.oldValue,
    newValue: options?.newValue,
    reason: options?.reason,
  };
  db.auditLogs.unshift(newLog);
  // Keep last 500 audit logs
  if (db.auditLogs.length > 500) {
    db.auditLogs = db.auditLogs.slice(0, 500);
  }
}

export function clearDemoData(confirmationText: string, adminPass: string, adminUser: string): { success: boolean; message: string; backupPath?: string } {
  if (confirmationText !== 'CLEAR-DEMO') {
    return { success: false, message: 'Invalid confirmation text. Please type "CLEAR-DEMO" in capital letters.' };
  }
  if (adminPass !== 'admin123' && adminPass !== 'admin') {
    return { success: false, message: 'Incorrect admin password.' };
  }

  const db = getDatabase();

  // Create automatic timestamped backup snapshot before clearing
  const backupFileName = `backup_before_clear_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  const backupFilePath = path.join(DATA_DIR, backupFileName);
  fs.writeFileSync(backupFilePath, JSON.stringify(db, null, 2), 'utf-8');

  // Purge demo records
  db.menuItems = db.menuItems.filter((i) => !i.demoFlag);
  db.orders = db.orders.filter((o) => !o.demoFlag);
  db.bills = db.bills.filter((b) => !b.demoFlag);
  db.staff = db.staff.filter((s) => !s.demoFlag);
  db.attendance = db.attendance.filter((a) => !a.demoFlag);
  db.leaveRequests = db.leaveRequests.filter((l) => !l.demoFlag);
  db.suppliers = db.suppliers.filter((s) => !s.demoFlag);
  db.inventory = db.inventory.filter((i) => !i.demoFlag);
  db.stockMovements = db.stockMovements.filter((m) => !m.demoFlag);
  db.expenses = db.expenses.filter((e) => !e.demoFlag);
  db.liabilities = db.liabilities.filter((l) => !l.demoFlag);

  // Reset tables to vacant
  db.tables = db.tables.map((tbl) => ({
    ...tbl,
    status: 'vacant',
    assignedSteward: undefined,
    currentOrderId: undefined,
    guestCount: undefined,
    totalPaise: 0,
    lastUpdated: 'Just now',
  }));

  // Reset sequential bill counter safely based on existing records
  const maxBillSeq = db.bills.reduce((max, b) => {
    const num = parseInt((b.billNumber || '').replace(/\D/g, ''), 10);
    return isNaN(num) ? max : Math.max(max, num);
  }, 0);
  db.nextBillSequence = maxBillSeq + 1;
  const maxOrderSeq = db.orders.reduce((max, o) => {
    const num = parseInt((o.orderNumber || '').replace(/\D/g, ''), 10);
    return isNaN(num) ? max : Math.max(max, num);
  }, 0);
  db.nextOrderSequence = maxOrderSeq + 1;

  // Mark demo data inactive
  db.settings.isDemoDataActive = false;

  logAudit(db, adminUser, 'admin', 'CLEAR_DEMO_DATA', 'SYSTEM', 'ALL', {
    oldValue: 'Demo data active',
    newValue: 'Clean live state (demo purged)',
    reason: `Automated backup taken to ${backupFileName}`,
  });

  saveDatabase(db);
  return { success: true, message: 'Demo data cleared successfully. System is now ready for live operations.', backupPath: backupFileName };
}

export function restoreDemoData(adminUser: string): { success: boolean; message: string } {
  const freshSeed = generateSeedData();
  freshSeed.settings.isDemoDataActive = true;
  logAudit(freshSeed, adminUser, 'admin', 'RESTORE_DEMO_DATA', 'SYSTEM', 'ALL', {
    newValue: 'Demo data re-seeded for testing',
  });
  saveDatabase(freshSeed);
  return { success: true, message: 'Demo data restored successfully.' };
}
