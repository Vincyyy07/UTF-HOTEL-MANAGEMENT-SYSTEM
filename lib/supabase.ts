import { createClient, SupabaseClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

export interface SupabaseConfig {
  url: string;
  anonKey: string;
  serviceRoleKey?: string;
  isConfigured: boolean;
}

// Function to get active Supabase credentials
// Checks process.env first, then falls back to settings in hms_db.json
export function getSupabaseConfig(): SupabaseConfig {
  const envUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
  const envAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
  const envServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

  if (envUrl && envAnonKey) {
    return {
      url: envUrl.trim(),
      anonKey: envAnonKey.trim(),
      serviceRoleKey: envServiceKey.trim() || undefined,
      isConfigured: true,
    };
  }

  // Check saved settings in data/hms_db.json
  try {
    const dbPath = path.join(process.cwd(), 'data', 'hms_db.json');
    if (fs.existsSync(dbPath)) {
      const raw = fs.readFileSync(dbPath, 'utf-8');
      const data = JSON.parse(raw);
      if (data?.settings?.supabaseUrl && data?.settings?.supabaseAnonKey) {
        return {
          url: data.settings.supabaseUrl.trim(),
          anonKey: data.settings.supabaseAnonKey.trim(),
          serviceRoleKey: data.settings.supabaseServiceRoleKey?.trim() || undefined,
          isConfigured: true,
        };
      }
    }
  } catch (err) {
    // ignore
  }

  return {
    url: '',
    anonKey: '',
    isConfigured: false,
  };
}

let cachedClient: SupabaseClient | null = null;
let cachedClientUrl = '';
let cachedClientKey = '';

export function getSupabaseClient(): SupabaseClient | null {
  const config = getSupabaseConfig();
  if (!config.isConfigured || !config.url || !config.anonKey) {
    return null;
  }

  if (cachedClient && cachedClientUrl === config.url && cachedClientKey === config.anonKey) {
    return cachedClient;
  }

  try {
    cachedClient = createClient(config.url, config.anonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
    cachedClientUrl = config.url;
    cachedClientKey = config.anonKey;
    return cachedClient;
  } catch (err) {
    console.error('Failed to initialize Supabase client:', err);
    return null;
  }
}

export function getSupabaseAdminClient(): SupabaseClient | null {
  const config = getSupabaseConfig();
  if (!config.isConfigured || !config.url) {
    return null;
  }

  const key = config.serviceRoleKey || config.anonKey;
  if (!key) return null;

  try {
    return createClient(config.url, key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  } catch (err) {
    console.error('Failed to initialize Supabase admin client:', err);
    return null;
  }
}

// Test connection
export async function testSupabaseConnection(): Promise<{ success: boolean; message: string; details?: any }> {
  const client = getSupabaseClient();
  if (!client) {
    return {
      success: false,
      message: 'Supabase credentials are not configured. Please supply your Supabase URL and Anon Key.',
    };
  }

  try {
    // Attempt a light probe query
    const { data, error } = await client.from('business_settings').select('*').limit(1);
    if (error && error.code !== 'PGRST116') {
      // If table doesn't exist yet, probe storage buckets or auth health
      const { data: buckets, error: storageErr } = await client.storage.listBuckets();
      if (storageErr) {
        return {
          success: false,
          message: `Connected to Supabase endpoint, but database query failed: ${error.message}. You may need to run the SQL schema first.`,
          details: { dbError: error.message, storageError: storageErr.message },
        };
      }
      return {
        success: true,
        message: 'Connected to Supabase successfully! (Database tables need schema initialization).',
        details: { buckets },
      };
    }
    return {
      success: true,
      message: 'Supabase connected and database tables are accessible!',
      details: { data },
    };
  } catch (err: any) {
    return {
      success: false,
      message: `Failed to connect to Supabase: ${err.message || 'Unknown network error'}`,
    };
  }
}
