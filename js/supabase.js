// Supabase Client & Session Helpers
// NOTE: Supabase SDK loaded from CDN in index.html
// This initializes the client using credentials from config.js

// Create Supabase client
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// getSession() — Retrieve current session
// Returns: session object or null
// Errors are caught and logged; function returns null on error
async function getSession() {
  try {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) {
      console.error('Error fetching session:', error.message);
      return null;
    }
    return session;
  } catch (err) {
    console.error('Unexpected error in getSession():', err);
    return null;
  }
}

// getUser() — Retrieve authenticated user
// Returns: user object or null
// Errors are caught and logged; function returns null on error
async function getUser() {
  try {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error) {
      console.error('Error fetching user:', error.message);
      return null;
    }
    return user;
  } catch (err) {
    console.error('Unexpected error in getUser():', err);
    return null;
  }
}
