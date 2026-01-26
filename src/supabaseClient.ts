import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
    console.error('Missing Supabase environment variables');
}

export const supabase = (() => {
    if (!supabaseUrl || !supabaseAnonKey) {
        console.error('Missing Supabase environment variables');
        return undefined;
    }
    try {
        return createClient(supabaseUrl, supabaseAnonKey);
    } catch (error) {
        console.error('Error initializing Supabase client:', error);
        return undefined;
    }
})();
