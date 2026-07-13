// supabase/functions/enviar-notificaciones/index.ts
// Edge Function (Deno). Invocada por pg_cron a diario. Evalúa los 3 disparadores,
// deduplica vía notificaciones_log y envía con web-push. Usa service-role.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';
import {
  detectarPresupuestos, detectarMetas, detectarPrestamos, detectarRecurrentesProximos, type Aviso,
} from './detectors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const VAPID_PUBLIC = Deno.env.get('VAPID_PUBLIC_KEY')!;
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY')!;
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT')!;

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

function mesActual(hoy: Date): { desde: string; hasta: string } {
  const y = hoy.getUTCFullYear(), m = hoy.getUTCMonth();
  const p = (n: number) => String(n).padStart(2, '0');
  const desde = `${y}-${p(m + 1)}-01`;
  const finMes = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const hasta = `${y}-${p(m + 1)}-${p(finMes)}`;
  return { desde, hasta };
}

Deno.serve(async () => {
  const db = createClient(SUPABASE_URL, SERVICE_ROLE);
  const hoy = new Date();
  const { desde, hasta } = mesActual(hoy);

  // Usuarios con al menos una suscripción activa.
  const { data: subs } = await db.from('push_subscriptions').select('*');
  const userIds = [...new Set((subs || []).map((s) => s.user_id))];
  const subsPorUser = new Map<string, typeof subs>();
  for (const s of (subs || [])) {
    const arr = subsPorUser.get(s.user_id) || [];
    arr.push(s); subsPorUser.set(s.user_id, arr);
  }

  let enviadas = 0;
  for (const userId of userIds) {
    try {
      const avisos = await evaluarUsuario(db, userId, hoy, desde, hasta);
      for (const aviso of avisos) {
        // Candado idempotente: el unique (user_id, clave_dedupe) evita reenvíos.
        const { error: lockErr } = await db.from('notificaciones_log').insert({
          user_id: userId, tipo: aviso.tipo, ref_id: aviso.ref_id, clave_dedupe: aviso.clave_dedupe,
        });
        if (lockErr) {
          // 23505 = unique_violation => ya enviado este periodo, saltar en silencio.
          // Cualquier otro error NO debe suprimir permanentemente: loguear y continuar.
          if ((lockErr as { code?: string }).code !== '23505') {
            console.error(`lock notificaciones_log (${aviso.clave_dedupe}):`, lockErr.message);
          }
          continue;
        }
        await enviarAUsuario(db, subsPorUser.get(userId) || [], aviso);
        enviadas++;
      }
    } catch (e) {
      console.error(`usuario ${userId} falló:`, e instanceof Error ? e.message : e);
    }
  }
  return new Response(JSON.stringify({ ok: true, enviadas }), {
    headers: { 'Content-Type': 'application/json' },
  });
});

async function evaluarUsuario(
  db: ReturnType<typeof createClient>, userId: string, hoy: Date, desde: string, hasta: string,
): Promise<Aviso[]> {
  // Presupuesto = categorias.limite_mensual (fuente única; misma que alertas in-app).
  // Categorías son globales (user_id null) o propias del usuario. Replicamos la RLS
  // `user_id IS NULL OR auth.uid() = user_id` aquí porque service-role la bypasea.
  const { data: cats } = await db
    .from('categorias')
    .select('id, nombre, limite_mensual')
    .or(`user_id.is.null,user_id.eq.${userId}`)
    .eq('tipo', 'gasto').eq('estado', 'activa');
  const { data: gastos } = await db
    .from('transacciones')
    .select('categoria_id, monto')
    .eq('user_id', userId).eq('tipo', 'gasto').gte('fecha', desde).lte('fecha', hasta);
  const gastoPorCat = new Map<string, number>();
  for (const g of (gastos || [])) {
    gastoPorCat.set(g.categoria_id, (gastoPorCat.get(g.categoria_id) || 0) + Number(g.monto));
  }
  const categoriasPresup = (cats || []).map((c) => ({
    id: c.id as string,
    nombre: (c.nombre as string) || 'una categoría',
    limite_mensual: c.limite_mensual == null ? null : Number(c.limite_mensual),
  }));

  // Metas + qué metas tienen aporte este mes.
  const { data: metas } = await db
    .from('metas').select('id, nombre, estado, monto_actual, monto_objetivo').eq('user_id', userId);
  const { data: aportes } = await db
    .from('aportes_meta').select('meta_id').eq('user_id', userId).gte('created_at', desde + 'T00:00:00Z');
  const conAporte = new Set<string>((aportes || []).map((a) => a.meta_id));
  const metasRows = (metas || []).map((m) => ({
    id: m.id, nombre: m.nombre, estado: m.estado,
    monto_actual: Number(m.monto_actual), monto_objetivo: Number(m.monto_objetivo),
  }));

  // Préstamos pendientes + datos de la transacción (tipo = dirección: gasto presté / ingreso me prestaron).
  const { data: prest } = await db
    .from('prestamos').select('id, deudor, estado, transacciones(fecha, monto, tipo)').eq('user_id', userId);
  const prestamosRows = (prest || []).map((p) => ({
    id: p.id, deudor: p.deudor, estado: p.estado,
    fecha: (p.transacciones as { fecha: string } | null)?.fecha ?? null,
    monto: (p.transacciones as { monto: number } | null)?.monto ?? null,
    tipo: (p.transacciones as { tipo: string } | null)?.tipo ?? null,
  }));

  // Recurrentes activos del usuario (Fase 4) con proximo_cargo próximo.
  const { data: recs } = await db
    .from('recurrentes')
    .select('id, descripcion, monto, tipo, activo, proximo_cargo')
    .eq('user_id', userId).eq('activo', true);
  const recurrentesRows = (recs || []).map((r) => ({
    id: r.id, descripcion: r.descripcion, monto: Number(r.monto),
    tipo: r.tipo, activo: r.activo, proximo_cargo: r.proximo_cargo,
  }));

  return [
    ...detectarPresupuestos(categoriasPresup, gastoPorCat, hoy),
    ...detectarMetas(metasRows, conAporte, hoy),
    ...detectarPrestamos(prestamosRows, hoy),
    ...detectarRecurrentesProximos(recurrentesRows, hoy),
  ];
}

async function enviarAUsuario(
  db: ReturnType<typeof createClient>,
  subs: Array<{ endpoint: string; p256dh: string; auth: string }>,
  aviso: Aviso,
) {
  const payload = JSON.stringify({ title: aviso.title, body: aviso.body, url: aviso.url });
  for (const s of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload,
      );
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 410 || status === 404) {
        await db.from('push_subscriptions').delete().eq('endpoint', s.endpoint);
      } else {
        console.error('sendNotification falló:', status, e instanceof Error ? e.message : e);
      }
    }
  }
}
