import fs from 'fs';
import path from 'path';
import { getSupabaseClient, getSupabaseAdminClient } from './supabase';

export type StorageBucket = 'menu-dishes' | 'branding' | 'staff-docs' | 'receipts';

export const STORAGE_BUCKETS: StorageBucket[] = [
  'menu-dishes',
  'branding',
  'staff-docs',
  'receipts',
];

const LOCAL_UPLOADS_DIR = path.join(process.cwd(), 'public', 'uploads');

function ensureLocalUploadsDir(bucket: string) {
  const dir = path.join(LOCAL_UPLOADS_DIR, bucket);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Upload a file (buffer) to Supabase Storage or fallback to local public directory
 */
export async function uploadFileToStorage(
  bucket: StorageBucket,
  fileName: string,
  buffer: Buffer,
  contentType: string
): Promise<{ success: boolean; url: string; storageType: 'supabase' | 'local'; error?: string }> {
  const client = getSupabaseAdminClient() || getSupabaseClient();

  if (client) {
    try {
      // 1. Upload to Supabase Storage
      const { data, error } = await client.storage
        .from(bucket)
        .upload(fileName, buffer, {
          contentType,
          upsert: true,
        });

      if (!error && data) {
        // Retrieve public URL
        const { data: publicUrlData } = client.storage.from(bucket).getPublicUrl(fileName);
        return {
          success: true,
          url: publicUrlData.publicUrl,
          storageType: 'supabase',
        };
      } else {
        console.warn(`Supabase Storage upload error for ${bucket}/${fileName}:`, error?.message);
        // Fallback to local if bucket doesn't exist or permissions issue
      }
    } catch (err: any) {
      console.warn(`Supabase Storage failed, falling back to local:`, err.message);
    }
  }

  // 2. Local fallback storage
  try {
    const dir = ensureLocalUploadsDir(bucket);
    const localFilePath = path.join(dir, fileName);
    fs.writeFileSync(localFilePath, buffer);
    const publicLocalUrl = `/uploads/${bucket}/${fileName}`;
    return {
      success: true,
      url: publicLocalUrl,
      storageType: 'local',
    };
  } catch (localErr: any) {
    return {
      success: false,
      url: '',
      storageType: 'local',
      error: `Failed to save file: ${localErr.message}`,
    };
  }
}

/**
 * Delete a file from Supabase storage or local fallback
 */
export async function deleteFileFromStorage(
  bucket: StorageBucket,
  fileName: string
): Promise<{ success: boolean; error?: string }> {
  const client = getSupabaseAdminClient() || getSupabaseClient();
  if (client) {
    try {
      await client.storage.from(bucket).remove([fileName]);
    } catch (err) {
      // ignore
    }
  }

  try {
    const localPath = path.join(LOCAL_UPLOADS_DIR, bucket, fileName);
    if (fs.existsSync(localPath)) {
      fs.unlinkSync(localPath);
    }
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * Check or auto-create Supabase storage buckets
 */
export async function setupSupabaseBuckets(): Promise<{
  success: boolean;
  created: string[];
  existing: string[];
  error?: string;
}> {
  const client = getSupabaseAdminClient();
  if (!client) {
    return {
      success: false,
      created: [],
      existing: [],
      error: 'Supabase admin client not available (check SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY)',
    };
  }

  try {
    const { data: existingBuckets, error: listError } = await client.storage.listBuckets();
    if (listError) {
      return { success: false, created: [], existing: [], error: listError.message };
    }

    const existingNames = new Set((existingBuckets || []).map((b) => b.name));
    const created: string[] = [];
    const existing: string[] = [];

    for (const b of STORAGE_BUCKETS) {
      if (existingNames.has(b)) {
        existing.push(b);
      } else {
        const { error: createErr } = await client.storage.createBucket(b, {
          public: true,
          fileSizeLimit: 10485760, // 10MB limit
        });
        if (!createErr) {
          created.push(b);
        }
      }
    }

    return {
      success: true,
      created,
      existing,
    };
  } catch (err: any) {
    return {
      success: false,
      created: [],
      existing: [],
      error: err.message,
    };
  }
}
