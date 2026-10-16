import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseConfig, testSupabaseConnection } from '../../../lib/supabase';
import { pushAllDataToSupabase, pullDatabaseFromSupabase } from '../../../lib/supabaseDb';
import { setupSupabaseBuckets } from '../../../lib/supabaseStorage';
import { getDatabase, saveDatabase, logAudit } from '../../../lib/db';

export async function GET() {
  try {
    const config = getSupabaseConfig();
    return NextResponse.json({
      success: true,
      config: {
        isConfigured: config.isConfigured,
        url: config.url || '',
        anonKeyMasked: config.anonKey ? `${config.anonKey.substring(0, 10)}...${config.anonKey.substring(config.anonKey.length - 4)}` : '',
        hasServiceRoleKey: !!config.serviceRoleKey,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action } = body;
    const db = getDatabase();

    if (action === 'TEST_CONNECTION') {
      const testResult = await testSupabaseConnection();
      return NextResponse.json(testResult);
    }

    if (action === 'SAVE_CONFIG') {
      const { supabaseUrl, supabaseAnonKey, supabaseServiceRoleKey, userName, userRole } = body;
      
      const updatedSettings = {
        ...db.settings,
        supabaseUrl: supabaseUrl?.trim() || '',
        supabaseAnonKey: supabaseAnonKey?.trim() || '',
        supabaseServiceRoleKey: supabaseServiceRoleKey?.trim() || '',
      };
      db.settings = updatedSettings as any;

      logAudit(db, userName || 'Admin', userRole || 'admin', 'UPDATE', 'SETTINGS', 'SUPABASE_CONFIG', {
        newValue: `Supabase URL: ${supabaseUrl}`,
        reason: 'Supabase cloud backend credentials updated',
      });

      saveDatabase(db);

      // Probe test connection with new credentials
      const testResult = await testSupabaseConnection();

      return NextResponse.json({
        success: true,
        message: 'Supabase configuration saved successfully.',
        connectionTest: testResult,
        data: db,
      });
    }

    if (action === 'SYNC_ALL') {
      const syncResult = await pushAllDataToSupabase(db);
      return NextResponse.json(syncResult);
    }

    if (action === 'SETUP_BUCKETS') {
      const bucketsResult = await setupSupabaseBuckets();
      return NextResponse.json(bucketsResult);
    }

    if (action === 'PULL_DATA') {
      const pullResult = await pullDatabaseFromSupabase();
      if (pullResult.success && pullResult.data) {
        // Merge into local db
        const mergedDb = {
          ...db,
          ...pullResult.data,
        };
        saveDatabase(mergedDb as any);
        return NextResponse.json({ success: true, message: 'Cloud data pulled and synchronized locally.', data: mergedDb });
      }
      return NextResponse.json({ success: false, message: pullResult.error || 'Failed to pull cloud data' }, { status: 400 });
    }

    return NextResponse.json({ success: false, message: 'Invalid action' }, { status: 400 });
  } catch (err: any) {
    console.error('Supabase management API error:', err);
    return NextResponse.json({ success: false, message: err.message || 'Server error' }, { status: 500 });
  }
}
