import assert from 'node:assert';
import { test } from 'node:test';
import { detectProyeccionMeta } from '../js/insights.js';

const HOY = new Date(2026, 5, 21); // 2026-06-21

test('meta en camino → good, proyecta el mes de llegada', () => {
  // Inició hace 100 días, lleva 1000 → ritmo 10/día. Faltan 500 → 50 días → ~10 ago.
  const metas = [{
    id: 'm1', nombre: 'Vacaciones', ambito: 'personal', estado: 'en_curso',
    es_fondo_emergencia: false, monto_objetivo: 1500, monto_actual: 1000,
    fecha_inicio: '2026-03-13', fecha_limite: '2026-12-31',
  }];
  const out = detectProyeccionMeta(metas, { hoy: HOY });
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].tipo, 'good');
  assert.strictEqual(out[0].icono, 'target-arrow');
  assert.match(out[0].titulo, /alcanzas Vacaciones en agosto/);
  assert.strictEqual(out[0].meta.meta_id, 'm1');
});

test('meta atrasada → warn', () => {
  // Inició hace 100 días, lleva 200 → ritmo 2/día. Faltan 800 → 400 días → pasa el límite.
  const metas = [{
    id: 'm2', nombre: 'Auto', ambito: 'personal', estado: 'en_curso',
    es_fondo_emergencia: false, monto_objetivo: 1000, monto_actual: 200,
    fecha_inicio: '2026-03-13', fecha_limite: '2026-08-31',
  }];
  const out = detectProyeccionMeta(metas, { hoy: HOY });
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].tipo, 'warn');
  assert.match(out[0].titulo, /Auto va atrasada/);
});

test('ignora fondo de emergencia', () => {
  const metas = [{
    id: 'f1', nombre: 'Fondo', ambito: 'personal', estado: 'en_curso',
    es_fondo_emergencia: true, monto_objetivo: 1000, monto_actual: 500,
    fecha_inicio: '2026-03-13', fecha_limite: '2026-12-31',
  }];
  assert.deepStrictEqual(detectProyeccionMeta(metas, { hoy: HOY }), []);
});

test('ignora metas sin aporte (monto_actual 0) o sin fechas', () => {
  const metas = [
    { id: 'a', nombre: 'A', estado: 'en_curso', es_fondo_emergencia: false, monto_objetivo: 1000, monto_actual: 0, fecha_inicio: '2026-03-13', fecha_limite: '2026-12-31' },
    { id: 'b', nombre: 'B', estado: 'en_curso', es_fondo_emergencia: false, monto_objetivo: 1000, monto_actual: 500, fecha_inicio: null, fecha_limite: '2026-12-31' },
  ];
  assert.deepStrictEqual(detectProyeccionMeta(metas, { hoy: HOY }), []);
});

test('ignora meta ya alcanzada (restante ≤ 0)', () => {
  const metas = [{
    id: 'c', nombre: 'C', estado: 'en_curso', es_fondo_emergencia: false,
    monto_objetivo: 1000, monto_actual: 1200, fecha_inicio: '2026-03-13', fecha_limite: '2026-12-31',
  }];
  assert.deepStrictEqual(detectProyeccionMeta(metas, { hoy: HOY }), []);
});

test('array vacío → []', () => {
  assert.deepStrictEqual(detectProyeccionMeta([], { hoy: HOY }), []);
});
