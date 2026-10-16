import { NextResponse } from 'next/server';
import { getDatabase, saveDatabase, logAudit } from '../../../lib/db';
import { Staff } from '../../../lib/types';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { action, userName, userRole } = body;
    const db = getDatabase();

    if (action === 'ADD_STAFF') {
      const {
        fullName,
        role,
        department,
        phone,
        email,
        aadhaarNumber,
        familyDetails,
        currentAddress,
        permanentAddress,
        dateOfJoining,
        salaryType,
        baseSalaryPaise,
        bankAccountNumber,
        bankIfsc,
        bankName,
        emergencyContactName,
        emergencyContactPhone,
        photoUrl,
      } = body;

      const maxCodeNum = db.staff.reduce((max, s) => {
        const num = parseInt(s.employeeCode.replace(/\D/g, ''), 10);
        return isNaN(num) ? max : Math.max(max, num);
      }, 0);
      const codeNum = maxCodeNum + 1;
      const employeeCode = `UFP-${String(codeNum).padStart(3, '0')}`;

      const newStaff: Staff = {
        id: `stf-${Date.now()}`,
        employeeCode,
        fullName,
        role: role || 'Steward',
        department: department || 'Service',
        assignedShiftId: body.assignedShiftId || (db.shifts?.[0]?.id) || 'shift-morning',
        phone,
        email: email || `${fullName.toLowerCase().replace(/\s+/g, '.')}@unitedfoodpalace.com`,
        aadhaarNumber: aadhaarNumber || 'XXXX-XXXX-9999',
        familyDetails: familyDetails || 'N/A',
        currentAddress: currentAddress || 'Staff Quarters, Palace Road',
        permanentAddress: permanentAddress || currentAddress || 'Bengaluru',
        dateOfJoining: dateOfJoining || new Date().toISOString().split('T')[0],
        salaryType: salaryType || 'monthly',
        baseSalaryPaise: Number(baseSalaryPaise) || 2500000,
        bankAccountNumber: bankAccountNumber || 'XXXX-XXXX-0000',
        bankIfsc: bankIfsc || 'HDFC0001824',
        bankName: bankName || 'HDFC Bank',
        emergencyContactName: emergencyContactName || 'Family Contact',
        emergencyContactPhone: emergencyContactPhone || phone,
        photoUrl: photoUrl || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80',
        hasFaceEnrolled: Boolean(body.faceDescriptor || body.hasFaceEnrolled),
        faceEmbeddingId: `EMB-${employeeCode}`,
        faceDescriptor: body.faceDescriptor || undefined,
        isActive: true,
        demoFlag: false,
      };

      db.staff.push(newStaff);

      logAudit(db, userName || 'Admin', userRole || 'admin', 'CREATE', 'STAFF', employeeCode, {
        newValue: `Added employee ${fullName} (${role})`,
        reason: 'Staff Onboarding',
      });

      saveDatabase(db);
      return NextResponse.json({ success: true, staff: newStaff, data: db });
    }

    if (action === 'UPDATE_STAFF') {
      const { staffId, updates } = body;
      const index = db.staff.findIndex((s) => s.id === staffId);
      if (index === -1) return NextResponse.json({ success: false, message: 'Staff not found' }, { status: 404 });

      db.staff[index] = { ...db.staff[index], ...updates };

      logAudit(db, userName || 'Admin', userRole || 'admin', 'UPDATE', 'STAFF', db.staff[index].employeeCode, {
        newValue: `Updated staff profile ${db.staff[index].fullName}`,
      });

      saveDatabase(db);
      return NextResponse.json({ success: true, staff: db.staff[index], data: db });
    }

    if (action === 'DELETE_STAFF') {
      const { staffId } = body;
      if (userRole !== 'admin') {
        return NextResponse.json({ success: false, message: 'Only administrators have authority to delete staff profiles.' }, { status: 403 });
      }

      const index = db.staff.findIndex((s) => s.id === staffId);
      if (index === -1) {
        return NextResponse.json({ success: false, message: 'Staff member not found.' }, { status: 404 });
      }

      const deletedEmployee = db.staff[index];
      db.staff.splice(index, 1);

      // Clean up linked operator user account in db.users if one was provisioned
      if (db.users) {
        db.users = db.users.filter((u) => u.name !== deletedEmployee.fullName && u.id !== deletedEmployee.id);
      }

      logAudit(db, userName || 'Admin', userRole || 'admin', 'DELETE', 'STAFF', deletedEmployee.employeeCode, {
        oldValue: `${deletedEmployee.fullName} (${deletedEmployee.role})`,
        reason: 'Staff record permanently deleted by Admin',
      });

      saveDatabase(db);
      return NextResponse.json({ success: true, message: `Staff member ${deletedEmployee.fullName} deleted successfully.`, data: db });
    }

    return NextResponse.json({ success: false, message: 'Unknown action' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 });
  }
}
