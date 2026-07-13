// Supabase Configuration — Nestra v2 (producción única)
// v1 fue retirada el 2026-07-01; todos los datos viven en la base v2 (ombnhxueclqfeyjzhroz).
// Todos los hosts (csf156.github.io, *.pages.dev, localhost) usan la base v2.

const SUPABASE_URL = 'https://ombnhxueclqfeyjzhroz.supabase.co';

const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9tYm5oeHVlY2xxZmV5anpocm96Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyOTc5NDksImV4cCI6MjA5Njg3Mzk0OX0.Ep0jXU4r3010tSAY846sYXFWUD7NRSJrykCzPdHUBM0';

// VAPID public key (NO secreta) para suscripción Web Push. La privada vive como secret
// de la Edge Function `enviar-notificaciones`, nunca en el cliente ni en git.
const VAPID_PUBLIC_KEY = 'BEy0lcrgND9vnAirt9FyytTvFeAcVE3pcZVEQRMk2eRP84fhLgGaEYx3tnRT5xQrFzh-o8ocDfjsgGccg3uP4PA';
