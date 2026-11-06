
// Browser-safe values only. Never put service-role/secret keys here.
export const SUPABASE_URL = "https://uxxqdyyzcqumzodknewy.supabase.co";

export const SUPABASE_ANON_KEY = "sb_publishable_oJv6C3l3EGVOdCOSjsdVaw_fjnrf4Ng";

export const FUNCTIONS_BASE_URL = `${SUPABASE_URL}/functions/v1`;

export const isConfigured =
  SUPABASE_URL.length > 0 &&
  SUPABASE_ANON_KEY.length > 0;
