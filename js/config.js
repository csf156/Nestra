// Supabase Configuration — environment-aware
// Production (csf156.github.io, GitHub Pages, branch main) → v1 instance (rblxwqdphhmpglxxtgtv)
// Everything else (localhost, *.pages.dev Cloudflare, Netlify) → v2 instance (ombnhxueclqfeyjzhroz)
// v2 is deployed on Cloudflare Pages from branch `v2`; its hostname is NOT
// csf156.github.io, so it auto-routes to the v2 DB. NEVER serve v2 from
// csf156.github.io — that routes v2 code to the v1 schema and breaks writes.
// Same file on every branch — no per-branch credentials, no merge accidents.

const _isProd = window.location.hostname === 'csf156.github.io';

const SUPABASE_URL = _isProd
  ? 'https://rblxwqdphhmpglxxtgtv.supabase.co'
  : 'https://ombnhxueclqfeyjzhroz.supabase.co';

const SUPABASE_ANON_KEY = _isProd
  ? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJibHh3cWRwaGhtcGdseHh0Z3R2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA2MTIxNDgsImV4cCI6MjA5NjE4ODE0OH0.Wlk-l0idfwWmezRZ3ZFoKAnVkau7JY7ICk-LEvZc28A'
  : 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9tYm5oeHVlY2xxZmV5anpocm96Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyOTc5NDksImV4cCI6MjA5Njg3Mzk0OX0.Ep0jXU4r3010tSAY846sYXFWUD7NRSJrykCzPdHUBM0';

// VAPID public key (NO secreta) para suscripción Web Push (Fase 6). La privada vive
// como secret de la Edge Function `enviar-notificaciones`, nunca en el cliente ni en git.
const VAPID_PUBLIC_KEY = 'BEy0lcrgND9vnAirt9FyytTvFeAcVE3pcZVEQRMk2eRP84fhLgGaEYx3tnRT5xQrFzh-o8ocDfjsgGccg3uP4PA';
