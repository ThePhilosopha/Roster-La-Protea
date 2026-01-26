import { createClient } from '@supabase/supabase-js';

// Supabase configuration - uses env vars in production (Vercel), fallback for local dev
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://zefwnfetupjqxblqoxaj.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InplZnduZmV0dXBqcXhibHFveGFqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg4MTQ4ODYsImV4cCI6MjA4NDM5MDg4Nn0.pqhO23t9k-l1alIj7xay-INjUpy3Z_vP5SGwI4vEziI';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
