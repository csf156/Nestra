import assert from 'node:assert';
import { test } from 'node:test';
import { generarInsights } from '../js/insights.js';

const HOY = new Date(2026, 5, 15); // lunes 2026-06-15

function gasto(monto, fecha, catId = 'cat1', ambito = 'personal', nombre = 'Cat') {
  return { tipo: 'gasto', ambito, categoria_id: catId, monto, fecha, categorias: { nombre } };
}

function metaTarde(id) {
  // ritmo aporte muy lento → proyección muy posterior a fecha_limite
  return {
    id, nombre: `Meta ${id}`, ambito: 'personal',
    monto_objetivo: 1000, monto_actual: 100,
    fecha_inicio: '2026-01-01', // 165d atrás a HOY
    fecha_limite: '2026-07-01', // 16d adelante → no alcanza → warn
    estado: 'en_curso', es_fondo_emergencia: false,
  };
}

// Fixture base: dispara detectCrecimiento(warn) + detectRitmoMensual(warn) + detectBuenMes(good)
// HOY = Jun 15. actualDesde = May 16. baseDesde = Mar 17.
//
// cat1/personal:
//   base (Apr 1-30): 4 tx × 60 = 240 → baseMensual=120 ≥ 50, count=4 ≥ 3 ✓
//   actual (May 20, Jun 5): 2 tx × 100 = 200, count=2 ✓ → pct=+67% → warn
//
// cat2/personal (ritmo/buen-mes):
//   Jun 5+10: 200+200 = 400 gasto junio
//   May 10: 100 gasto mayo
//
// cat3/personal (buen-mes padding):
//   Apr 15: 500, Mar 15: 500
//
// Ritmo: gastoMes(Jun)=500, gastoPrev(May)=200 → proy=1000 → +400% → warn
// BuenMes: May=200 vs promedio(Apr=740,Mar=500)=620 → -68% → good
const TXS_BASE = [
  gasto(60,  '2026-04-01'), gasto(60, '2026-04-10'),
  gasto(60,  '2026-04-20'), gasto(60, '2026-04-30'),
  gasto(100, '2026-05-20'), gasto(100, '2026-06-05'),

  gasto(200, '2026-06-05', 'cat2', 'personal', 'Transporte'),
  gasto(200, '2026-06-10', 'cat2', 'personal', 'Transporte'),
  gasto(100, '2026-05-10', 'cat2', 'personal', 'Transporte'),

  gasto(500, '2026-04-15', 'cat3', 'personal', 'Otro'),
  gasto(500, '2026-03-15', 'cat3', 'personal', 'Otro'),
];

// ── Test 1: múltiples detectores, orden por score ─────────────────

test('dispara múltiples detectores y los ordena por score descendente', () => {
  const result = generarInsights({ transacciones: TXS_BASE, metas: [], hoy: HOY });

  // Los 3 detectores deben haber disparado:
  // ritmo-mes (warn, score≈4.0) > crecimiento:cat1:personal (warn, score≈3.34) > buen-mes (good, score≈2.52)
  assert.strictEqual(result.length, 3);
  assert.strictEqual(result[0].id, 'ritmo-mes');
  assert.strictEqual(result[1].id, 'crecimiento:cat1:personal');
  assert.strictEqual(result[2].id, 'buen-mes');

  // orden descendente por score
  for (let k = 1; k < result.length; k++) {
    assert.ok(result[k - 1].score >= result[k].score,
      `Orden roto: ${result[k-1].id}(${result[k-1].score}) vs ${result[k].id}(${result[k].score})`);
  }

  // warns antes que good
  const tipos = result.map(i => i.tipo);
  const primerGood = tipos.indexOf('good');
  const ultimoWarn = tipos.lastIndexOf('warn');
  assert.ok(ultimoWarn < primerGood, 'todos los warn deben preceder al good');
});

// ── Test 2: score presente en todos los insights ──────────────────

test('todos los insights devueltos tienen campo score numérico positivo', () => {
  const result = generarInsights({ transacciones: TXS_BASE, metas: [], hoy: HOY });
  assert.ok(result.length > 0);
  for (const i of result) {
    assert.ok(typeof i.score === 'number' && !isNaN(i.score), `${i.id}: score no es número`);
    assert.ok(i.score > 0, `${i.id}: score no positivo`);
  }
});

// ── Test 3: crash en detector no tumba los demás ──────────────────

test('si un detector crashea los demás siguen funcionando', () => {
  // [null] en metas → detectProyeccionMeta lanza TypeError (null.es_fondo_emergencia)
  // generarInsights atrapa el error por detector; crecimiento debe seguir disparando
  let result;
  assert.doesNotThrow(() => {
    result = generarInsights({ transacciones: TXS_BASE, metas: [null], hoy: HOY });
  });
  assert.ok(
    result.some(i => i.id.startsWith('crecimiento:')),
    'crecimiento debe disparar aunque proyeccion-meta crashee'
  );
});

// ── Test 4: datos vacíos → [] ─────────────────────────────────────

test('datos vacíos devuelven array vacío', () => {
  assert.deepStrictEqual(
    generarInsights({ transacciones: [], metas: [], hoy: HOY }),
    []
  );
});

// ── Test 5: cap a 6 ───────────────────────────────────────────────

test('cap a 6 cards aunque haya más insights posibles', () => {
  const txs = [];

  // 2 cats de crecimiento (cat1 + cat2, personal) → 2 warns
  for (const [cat, nom] of [['cat1', 'Comida'], ['cat2', 'Transporte']]) {
    for (const d of ['2026-04-05', '2026-04-10', '2026-04-15', '2026-04-20']) {
      txs.push(gasto(60, d, cat, 'personal', nom));  // baseline 4 tx × 60
    }
    txs.push(gasto(200, '2026-05-20', cat, 'personal', nom)); // actual ×2
    txs.push(gasto(200, '2026-06-05', cat, 'personal', nom));
  }

  // ritmoMensual: Jun alto → warn
  txs.push(gasto(400, '2026-06-10', 'cat3', 'personal', 'Otro'));
  txs.push(gasto(50,  '2026-05-15', 'cat3', 'personal', 'Otro'));

  // buenMes: Apr+Mar grandes → May pequeño → good
  txs.push(gasto(800, '2026-04-15', 'cat4', 'personal', 'Entretenimiento'));
  txs.push(gasto(800, '2026-03-15', 'cat4', 'personal', 'Entretenimiento'));

  // 3 metas tardías → 3 warns
  const metas = [metaTarde('m1'), metaTarde('m2'), metaTarde('m3')];

  // Total antes de cap: 2 crecimiento + 1 ritmo + 1 buen-mes + 3 metas = 7 → cap a 6
  const result = generarInsights({ transacciones: txs, metas, hoy: HOY });

  assert.strictEqual(result.length, 6,
    `Esperaba 6 (cap), recibió ${result.length}: [${result.map(i => i.id).join(', ')}]`);

  // sigue ordenado
  for (let k = 1; k < result.length; k++) {
    assert.ok(result[k - 1].score >= result[k].score, 'orden roto tras cap');
  }

  // buen-mes (score más bajo) debe haber quedado fuera
  assert.ok(
    !result.some(i => i.id === 'buen-mes'),
    'buen-mes debería ser el excluido por tener el score más bajo'
  );
});
