import { NextResponse } from 'next/server';
import { getDatabase, saveDatabase, logAudit } from '../../../lib/db';
import { ExpenseEntry } from '../../../lib/types';
import { getLocalDateStr } from '../../../lib/dateUtils';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { action, userName, userRole } = body;
    const db = getDatabase();
    const todayStr = getLocalDateStr(new Date());

    if (action === 'ADD_EXPENSE') {
      const { category, title, amountPaise, paymentMode = 'bank_transfer', payee, referenceNumber, receiptUrl } = body;
      if (!title || !amountPaise) {
        return NextResponse.json({ success: false, message: 'Title and amount are required' }, { status: 400 });
      }

      const newExpense: ExpenseEntry = {
        id: `exp-${Date.now()}`,
        category,
        title,
        amountPaise: Number(amountPaise),
        paymentMode,
        payee: payee || 'Vendor',
        referenceNumber,
        receiptUrl,
        date: todayStr,
        recordedBy: userName || 'Accounts',
        demoFlag: false,
      };

      db.expenses.unshift(newExpense);

      logAudit(db, userName || 'Accounts', userRole || 'admin', 'CREATE', 'EXPENSE', title, {
        newValue: `Recorded ₹${(amountPaise / 100).toLocaleString('en-IN')} (${category})`,
      });

      saveDatabase(db);
      return NextResponse.json({ success: true, expense: newExpense, data: db });
    }

    if (action === 'PAY_LIABILITY') {
      const { liabilityId } = body;
      const index = db.liabilities.findIndex((l) => l.id === liabilityId);
      if (index === -1) return NextResponse.json({ success: false, message: 'Liability not found' }, { status: 404 });

      const liability = db.liabilities[index];
      // Convert to realized expense
      const newExpense: ExpenseEntry = {
        id: `exp-${Date.now()}`,
        category: (liability.category as any) || 'Miscellaneous',
        title: `Settled Liability: ${liability.title}`,
        amountPaise: liability.amountPaise,
        paymentMode: 'bank_transfer',
        payee: liability.payee,
        referenceNumber: `SETTLE-${Date.now().toString().slice(-4)}`,
        date: todayStr,
        recordedBy: userName || 'Accounts',
        demoFlag: false,
      };
      db.expenses.unshift(newExpense);
      db.liabilities.splice(index, 1);

      logAudit(db, userName || 'Accounts', userRole || 'admin', 'UPDATE', 'LIABILITY', liability.title, {
        newValue: `Settled and converted to expense ₹${(liability.amountPaise / 100).toLocaleString('en-IN')}`,
      });

      saveDatabase(db);
      return NextResponse.json({ success: true, message: 'Liability paid successfully', data: db });
    }

    return NextResponse.json({ success: false, message: 'Unknown action' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 });
  }
}
