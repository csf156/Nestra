// Authentication Module — Login, Logout, Session, Realtime
// Global state for current user and profile
// Handles login/logout, session validation, realtime syncing
// (supabase, getSession, getUser loaded from supabase.js)

// Global State
window.currentUser = null;
window.currentProfile = null;
let realtimeChannel = null;

// getCurrentUser() — Return current authenticated user
// Returns: user object or null
function getCurrentUser() {
  return window.currentUser;
}

// getCurrentProfile() — Return current user's profile
// Returns: profile object or null
function getCurrentProfile() {
  return window.currentProfile;
}

// isAuthenticated() — Check if user is logged in
// Returns: boolean
function isAuthenticated() {
  return window.currentUser !== null;
}

// login(email, password) — Sign in with email & password
// Args: email (string), password (string)
// Returns: user object on success, throws error on failure
// Side effects: saves JWT to localStorage, rehydrates user/profile, sets up realtime
async function login(email, password) {
  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      console.error('Login error:', error.message);
      throw new Error(error.message);
    }

    const { user, session } = data;

    if (session && session.access_token) {
      localStorage.setItem('sb-token', session.access_token);
    }

    window.currentUser = user;
    console.log('User logged in:', user.email);

    await loadProfile(user.id);
    // await setupRealtimeProfiles(user.id); // TODO: fix realtime

    // Successful login → go to dashboard
    window.location.hash = '#dashboard';

    return user;
  } catch (err) {
    console.error('Unexpected error in login():', err);
    throw err;
  }
}

// signInWithGoogle() — Start Google OAuth redirect flow
// Returns: undefined (browser redirects away; session handled on return)
// Side effects: redirects to Google; on return, onAuthStateChange fires SIGNED_IN
async function signInWithGoogle() {
  try {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + window.location.pathname },
    });
    if (error) {
      console.error('Google OAuth error:', error.message);
      throw new Error(error.message);
    }
  } catch (err) {
    console.error('Unexpected error in signInWithGoogle():', err);
    throw err;
  }
}

// logout() — Sign out and clear state
// Returns: undefined
// Side effects: clears localStorage, resets memory, closes realtime, redirects to #login
async function logout() {
  try {
    const { error } = await supabase.auth.signOut();

    if (error) {
      console.error('Logout error:', error.message);
      throw new Error(error.message);
    }

    localStorage.removeItem('sb-token');
    window.currentUser = null;
    window.currentProfile = null;

    if (realtimeChannel) {
      await supabase.removeChannel(realtimeChannel);
      realtimeChannel = null;
    }

    console.log('User logged out');
    window.location.hash = '#login';
  } catch (err) {
    console.error('Unexpected error in logout():', err);
    throw err;
  }
}

// loadProfile(userId) — Load user profile from DB
// Args: userId (string)
// Returns: profile object
// Side effects: rehydrates window.currentProfile
async function loadProfile(userId) {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error) {
      console.error('Profile load error:', error.message);
      throw new Error(error.message);
    }

    window.currentProfile = data;
    console.log('Profile loaded:', data.id);
    return data;
  } catch (err) {
    console.error('Unexpected error in loadProfile():', err);
    throw err;
  }
}

// setupRealtimeProfiles(userId) — Subscribe to profile changes
// Args: userId (string)
// Returns: undefined
// Side effects: creates channel listener, updates currentProfile on change
async function setupRealtimeProfiles(userId) {
  try {
    if (realtimeChannel) {
      await supabase.removeChannel(realtimeChannel);
    }

    realtimeChannel = supabase
      .channel(`profiles:${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'profiles',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          if (payload.eventType === 'UPDATE') {
            window.currentProfile = payload.new;
            console.log('Profile updated in realtime:', payload.new);
          } else if (payload.eventType === 'DELETE') {
            window.currentProfile = null;
            console.log('Profile deleted');
          }
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('Realtime profiles channel subscribed');
        } else if (status === 'CHANNEL_ERROR') {
          console.error('Realtime profiles channel error');
        } else if (status === 'TIMED_OUT') {
          console.warn('Realtime profiles channel timed out');
        }
      });
  } catch (err) {
    console.error('Unexpected error in setupRealtimeProfiles():', err);
    throw err;
  }
}

// handleSessionExpired() — Clear state and bounce to login
// Returns: undefined
// Side effects: clears localStorage + memory, closes realtime, redirects to #login
// Used when the session expires/revokes mid-session (token refresh fails).
function handleSessionExpired() {
  localStorage.removeItem('sb-token');
  window.currentUser = null;
  window.currentProfile = null;

  if (realtimeChannel) {
    supabase.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }

  // Only redirect if not already on a public auth view
  if (window.location.hash !== '#login') {
    console.warn('Session expired — redirecting to #login');
    window.location.hash = '#login';
  }
}

// setupAuthStateListener() — React to Supabase auth events
// Returns: undefined
// Side effects: subscribes to onAuthStateChange; on SIGNED_IN (incl. OAuth redirect return)
//               rehydrates user/profile; on SIGNED_OUT / lost session (e.g. expired token,
//               failed refresh) it auto-redirects to #login.
function setupAuthStateListener() {
  if (!supabase || !supabase.auth || typeof supabase.auth.onAuthStateChange !== 'function') {
    return;
  }

  supabase.auth.onAuthStateChange(async (event, session) => {
    console.log('Auth state change:', event);
    // Fresh sign-in (incl. OAuth redirect return) — rehydrate + go to app
    if (event === 'SIGNED_IN' && session && session.user) {
      window.currentUser = session.user;
      localStorage.setItem('sb-token', session.access_token);
      try { await loadProfile(session.user.id); } catch (e) { /* profile created by trigger */ }
      if (typeof updateUserChip === 'function') updateUserChip();
      if (window.location.hash === '#login' || window.location.hash === '') {
        window.location.hash = '#dashboard';
      }
    }
    // Token expired and refresh failed, user signed out, or account removed
    if (event === 'SIGNED_OUT' || ((event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') && !session)) {
      handleSessionExpired();
    }
    // Password recovery link clicked — redirect to reset form
    if (event === 'PASSWORD_RECOVERY') {
      window.location.hash = '#reset-password';
    }
  });
}

// initAuth() — Initialize authentication on page load
// Returns: undefined
// Side effects: checks localStorage, validates with Supabase, rehydrates, sets up realtime
// Called automatically at end of module
async function initAuth() {
  try {
    // Listen for auth events (expiry/sign-out) from this point on
    setupAuthStateListener();

    const token = localStorage.getItem('sb-token');

    if (!token) {
      console.log('No session token found');
      window.currentUser = null;
      window.currentProfile = null;
      return;
    }

    const user = await getUser();

    if (!user) {
      console.log('Session invalid or expired');
      localStorage.removeItem('sb-token');
      window.currentUser = null;
      window.currentProfile = null;
      return;
    }

    window.currentUser = user;
    console.log('Session restored:', user.email);

    await loadProfile(user.id);
    await setupRealtimeProfiles(user.id);

    // Actualizar chip de usuario en sidebar (sesión restaurada al recargar)
    if (typeof updateUserChip === 'function') {
      updateUserChip();
    }
  } catch (err) {
    console.error('Unexpected error in initAuth():', err);
    window.currentUser = null;
    window.currentProfile = null;
  }
}

// Initialize auth on module load
initAuth();
