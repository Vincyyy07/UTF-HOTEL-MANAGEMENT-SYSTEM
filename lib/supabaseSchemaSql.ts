import fs from 'fs';
import path from 'path';

export function getSupabaseSchemaSql(): string {
  try {
    const p = path.join(process.cwd(), 'supabase', 'schema.sql');
    if (fs.existsSync(p)) {
      return fs.readFileSync(p, 'utf-8');
    }
  } catch (err) {
    // fallback
  }
  return `-- United Food Palace Supabase Schema
-- Please check supabase/schema.sql in the project root.`;
}
