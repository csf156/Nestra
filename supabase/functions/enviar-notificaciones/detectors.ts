// Detectores puros de la Fase 6. Sin red ni DB: reciben datos + `hoy`.
// Runtime-agnostic (lo importa la Edge Function Deno; los tests corren en node).

export interface Aviso {
  tipo: 'presupuesto' | 'meta' | 'prestamo';
  ref_id: string;
  clave_dedupe: string;
  title: string;
  body: string;
  url: string;
}

function periodoMes(hoy: Date): string {
  const y = hoy.getUTCFullYear();
  const m = String(hoy.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export interface PresupuestoRow {
  id: string; categoria_id: string; monto_limite: number; categoria_nombre: string;
}
export function detectarPresupuestos(
  presupuestos: PresupuestoRow[], gastoPorCat: Map<string, number>, hoy: Date,
): Aviso[] {
  const mes = periodoMes(hoy);
  const out: Aviso[] = [];
  for (const p of presupuestos) {
    const gasto = gastoPorCat.get(p.categoria_id) || 0;
    if (gasto >= p.monto_limite) {
      out.push({
        tipo: 'presupuesto', ref_id: p.id, clave_dedupe: `presupuesto:${p.id}:${mes}`,
        title: 'Presupuesto superado',
        body: `Te pasaste del límite en ${p.categoria_nombre}.`,
        url: '/#/configuracion',
      });
    }
  }
  return out;
}

export interface MetaRow {
  id: string; nombre: string; estado: string; monto_actual: number; monto_objetivo: number;
}
export function detectarMetas(
  metas: MetaRow[], metasConAporteEsteMes: Set<string>, hoy: Date,
): Aviso[] {
  const mes = periodoMes(hoy);
  const out: Aviso[] = [];
  for (const m of metas) {
    if (m.estado !== 'en_curso') continue;
    if (m.monto_actual >= m.monto_objetivo) continue;
    if (metasConAporteEsteMes.has(m.id)) continue;
    out.push({
      tipo: 'meta', ref_id: m.id, clave_dedupe: `meta:${m.id}:${mes}`,
      title: 'Recordatorio de meta',
      body: `Aún no has aportado a "${m.nombre}" este mes.`,
      url: '/#/metas',
    });
  }
  return out;
}

export interface PrestamoRow {
  // tipo de la transacción asociada: 'gasto' = yo presté (cobro), 'ingreso' = me prestaron (pago).
  id: string; deudor: string; estado: string; fecha: string | null; monto: number | null; tipo: string | null;
}
function diasEntre(desdeISO: string, hoy: Date): number {
  const d = new Date(desdeISO + 'T00:00:00Z').getTime();
  return Math.floor((hoy.getTime() - d) / (1000 * 60 * 60 * 24));
}
export function detectarPrestamos(prestamos: PrestamoRow[], hoy: Date): Aviso[] {
  const mes = periodoMes(hoy);
  const out: Aviso[] = [];
  for (const p of prestamos) {
    if (p.estado !== 'pendiente' || !p.fecha) continue;
    const dias = diasEntre(p.fecha, hoy);
    if (dias > 30) {
      // Por defecto 'gasto' (presté) si tipo viene nulo, igual que prestamos.html.
      const recibido = p.tipo === 'ingreso';
      out.push({
        tipo: 'prestamo', ref_id: p.id, clave_dedupe: `prestamo:${p.id}:${mes}`,
        title: recibido ? 'Préstamo por pagar' : 'Préstamo por cobrar',
        body: recibido
          ? `Le debes a ${p.deudor} desde hace ${dias} días.`
          : `${p.deudor} no te ha devuelto el préstamo en ${dias} días.`,
        url: '/#/prestamos',
      });
    }
  }
  return out;
}
