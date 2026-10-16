import { NextRequest, NextResponse } from 'next/server';
import { uploadFileToStorage, StorageBucket, STORAGE_BUCKETS } from '../../../lib/supabaseStorage';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const bucketRaw = formData.get('bucket') as string | null;

    if (!file) {
      return NextResponse.json({ success: false, message: 'No file uploaded.' }, { status: 400 });
    }

    const bucket: StorageBucket = (bucketRaw && STORAGE_BUCKETS.includes(bucketRaw as StorageBucket))
      ? (bucketRaw as StorageBucket)
      : 'menu-dishes';

    // File name sanitization
    const ext = file.name.split('.').pop() || 'png';
    const cleanBase = file.name
      .replace(/\.[^/.]+$/, '')
      .replace(/[^a-zA-Z0-9-_]/g, '_')
      .toLowerCase()
      .substring(0, 30);
    const uniqueFileName = `${cleanBase}-${Date.now()}.${ext}`;

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const result = await uploadFileToStorage(bucket, uniqueFileName, buffer, file.type || 'image/png');

    if (!result.success) {
      return NextResponse.json({ success: false, message: result.error || 'Upload failed' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      url: result.url,
      storageType: result.storageType,
      fileName: uniqueFileName,
      bucket,
    });
  } catch (err: any) {
    console.error('File upload error:', err);
    return NextResponse.json({ success: false, message: err.message || 'Server upload error' }, { status: 500 });
  }
}
