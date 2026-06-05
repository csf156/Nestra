// ─────────────────────────────────────────────────────────
// Authentication Module — Login, Logout, Session, Realtime
// ─────────────────────────────────────────────────────────
// Global state for current user and profile
// Handles login/logout, session validation, realtime syncing

import { supabase, getSession, getUser } from './supabase.js';

// ─────────────────────────────────────────────────────────
// Global State
// ─────────────────────────────────────────────────────────

window.currentUser = null;
window.currentProfile = null;
let realtimeChannel = null;

// ─────────────────────────────────────────────────────────
// getCurrentUser() — Return current authenticated user
// ─────────────────────────────────────────────────────────
// Returns: user object or null

function getCurrentUser() {
  return window.currentUser;
}

// ─────────────────────────────────────────────────────────
// getCurrentProfile() — Return current user's profile
// ─────────────────────────────────────────────────────────
// Returns: profile object or null

function getCurrentProfile() {
  return window.currentProfile;
}

// ─────────────────────────────────────────────────────────
// isAuthenticated() — Check if user is logged in
// ─────────────────────────────────────────────────────────
// Returns: boolean

function isAuthenticated() {
  return window.currentUser !== null;
}

// ─────────────────────────────────────────────────────────
// login(email, password) — Sign in with email & password
// ─────────────────────────────────────────────────────────
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
    await setupRealtimeProfiles(user.id);

    return user;
  } catch (err) {
    console.error('Unexpected error in login():', err);
    throw err;
  }
}

// ─────────────────────────────────────────────────────────
// logout() — Sign out and clear state
// ─────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────
// loadProfile(userId) — Load user profile from DB
// ─────────────────────────────────────────────────────────
// Args: userId (string)
// Returns: profile object
// Side effects: rehydrates window.currentProfile

async function loadProfile(userId) {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
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

// ─────────────────────────────────────────────────────────
// setupRealtimeProfiles(userId) — Subscribe to profile changes
// ─────────────────────────────────────────────────────────
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
          filter: `id=eq.${userId}`,
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

// ─────────────────────────────────────────────────────────
// initAuth() — Initialize authentication on page load
// ─────────────────────────────────────────────────────────
// Returns: undefined
// Side effects: checks localStorage, validates with Supabase, rehydrates, sets up realtime
// Called automatically at end of module

async function initAuth() {
  try {
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
  } catch (err) {
    console.error('Unexpected error in initAuth():', err);
    window.currentUser = null;
    window.currentProfile = null;
  }
}

// ─────────────────────────────────────────────────────────
// Export all functions
// ─────────────────────────────────────────────────────────

export {
  getCurrentUser,
  getCurrentProfile,
  isAuthenticated,
  login,
  logout,
  loadProfile,
  setupRealtimeProfiles,
  initAuth,
};

// ─────────────────────────────────────────────────────────
// Initialize auth on module load
// ─────────────────────────────────────────────────────────

initAuth();
