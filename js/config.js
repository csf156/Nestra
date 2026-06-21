// Supabase Configuration — environment-aware
// Production (csf156.github.io) → v1 instance (rblxwqdphhmpglxxtgtv)
// Everything else (localhost, Netlify preview) → v2 instance (ombnhxueclqfeyjzhroz)
// Same file on every branch — no per-branch credentials, no merge accidents.

const _isProd = window.location.hostname === 'csf156.github.io';

const SUPABASE_URL = _isProd
  ? 'https://rblxwqdphhmpglxxtgtv.supabase.co'
  : 'https://ombnhxueclqfeyjzhroz.supabase.co';

const SUPABASE_ANON_KEY = _isProd
  ? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJibHh3cWRwaGhtcGdseHh0Z3R2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA2MTIxNDgsImV4cCI6MjA5NjE4ODE0OH0.Wlk-l0idfwWmezRZ3ZFoKAnVkau7JY7ICk-LEvZc28A'
  : 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9tYm5oeHVlY2xxZmV5anpocm96Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyOTc5NDksImV4cCI6MjA5Njg3Mzk0OX0.Ep0jXU4r3010tSAY846sYXFWUD7NRSJrykCzPdHUBM0';
