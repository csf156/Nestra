import assert from 'node:assert';
import { test } from 'node:test';
import { calcularSafeToSpend } from '../js/safe-to-spend.js';

// Junio 2026 tiene 30 días. HOY = día 24 → díasRestantes = 30-24+1 = 7.
const HOY = new Date(2026, 5, 24);

function ing(monto, fechaISO) { return { tipo: 'ingreso', ambito: 'personal', hogar_id: null, monto, fecha: fechaISO }; }
function gas(monto, fechaISO, categoria_id = 'c1') { return { tipo: 'gasto', ambito: 'personal', hogar_id: null, monto, fecha: fechaISO, categoria_id }; }

test('sin ingreso estimado → null', () => {
  assert.strictEqual(calcularSafeToSpend([], [], { hoy: HOY }), null);
});

test('ingreso del mes, sin gastos ni fijos ni metas → reparte entre días restantes', () => {
  const out = calcularSafeToSpend([ing(2100, '2026-06-05')], [], { hoy: HOY });
  assert.strictEqual(out.estado, 'ok');
  assert.strictEqual(out.diario, 300);
  assert.strictEqual(out.restanteMes, 2100);
  assert.strictEqual(out.diasRestantes, 7);
});

test('gasto acumulado reduce el disponible', () => {
  const out = calcularSafeToSpend([ing(2100, '2026-06-05'), gas(700, '2026-06-10')], [], { hoy: HOY });
  assert.strictEqual(out.diario, 200);
});

test('numerador negativo → estado excedido, sin número negativo', () => {
  const out = calcularSafeToSpend([ing(500, '2026-06-05'), gas(900, '2026-06-10')], [], { hoy: HOY });
  assert.strictEqual(out.estado, 'excedido');
  assert.strictEqual(out.exceso, 400);
});

test('solo cuenta ámbito personal', () => {
  const txs = [ing(2100, '2026-06-05'), { tipo: 'gasto', ambito: 'hogar', hogar_id: 'H', monto: 9999, fecha: '2026-06-10', categoria_id: 'c1' }];
  const out = calcularSafeToSpend(txs, [], { hoy: HOY });
  assert.strictEqual(out.diario, 300);
});

test('baseline cubre el bug día-1: sueldo aún no cae este mes', () => {
  const txs = [ing(3000, '2026-04-10'), ing(3000, '2026-05-10')];
  const out = calcularSafeToSpend(txs, [], { hoy: HOY });
  assert.strictEqual(out.estado, 'ok');
  assert.strictEqual(out.diario, 429); // round(3000/7)
});

test('usa el mayor entre ingreso del mes y baseline', () => {
  const txs = [ing(3000, '2026-04-10'), ing(4000, '2026-06-03')];
  const out = calcularSafeToSpend(txs, [], { hoy: HOY });
  assert.strictEqual(out.diario, 571); // round(4000/7)
});

test('categoría fija reserva su remanente no pagado', () => {
  const txs = [
    ing(2400, '2026-06-03'),
    gas(1000, '2026-04-02', 'alquiler'), gas(1000, '2026-05-02', 'alquiler'),
  ];
  const out = calcularSafeToSpend(txs, [], { hoy: HOY });
  assert.strictEqual(out.diario, 200); // (2400-1000)/7
});

test('fija ya pagada este mes no se vuelve a reservar', () => {
  const txs = [
    ing(2400, '2026-06-03'),
    gas(1000, '2026-04-02', 'alquiler'), gas(1000, '2026-05-02', 'alquiler'),
    gas(1000, '2026-06-02', 'alquiler'),
  ];
  const out = calcularSafeToSpend(txs, [], { hoy: HOY });
  assert.strictEqual(out.diario, 200); // (2400-1000-0)/7
});

test('categoría con un solo mes cerrado no es fija', () => {
  const txs = [ing(2100, '2026-06-03'), gas(800, '2026-05-02', 'viaje')];
  const out = calcularSafeToSpend(txs, [], { hoy: HOY });
  assert.strictEqual(out.diario, 300); // 2100/7, sin reserva
});

function meta(over) {
  return Object.assign({
    id: 'm1', nombre: 'Meta', ambito: 'personal', hogar_id: null, estado: 'en_curso', es_fondo_emergencia: false,
    monto_objetivo: 1200, monto_actual: 0, fecha_limite: '2026-12-31',
  }, over);
}

test('aporte de meta prorratea la cuota mensual por días restantes', () => {
  const out = calcularSafeToSpend([ing(2100, '2026-06-03')], [meta()], { hoy: HOY });
  assert.strictEqual(out.estado, 'ok');
  assert.strictEqual(out.diario, 294);
});

test('meta fondo de emergencia se ignora', () => {
  const out = calcularSafeToSpend([ing(2100, '2026-06-03')], [meta({ es_fondo_emergencia: true })], { hoy: HOY });
  assert.strictEqual(out.diario, 300);
});

test('meta de hogar se ignora (solo personal)', () => {
  const out = calcularSafeToSpend([ing(2100, '2026-06-03')], [meta({ hogar_id: 'H' })], { hoy: HOY });
  assert.strictEqual(out.diario, 300);
});

test('meta ya cubierta (actual ≥ objetivo) no reserva', () => {
  const out = calcularSafeToSpend([ing(2100, '2026-06-03')], [meta({ monto_actual: 1200 })], { hoy: HOY });
  assert.strictEqual(out.diario, 300);
});

test('meta sin fecha_limite se ignora', () => {
  const out = calcularSafeToSpend([ing(2100, '2026-06-03')], [meta({ fecha_limite: null })], { hoy: HOY });
  assert.strictEqual(out.diario, 300);
});

test('meta con fecha_limite inválida no rompe el cálculo (sin NaN)', () => {
  const txs = [ing(2100, '2026-06-03')];
  const out = calcularSafeToSpend(txs, [meta({ fecha_limite: 'not-a-date' })], { hoy: HOY });
  assert.strictEqual(out.estado, 'ok');
  assert.strictEqual(out.diario, 300); // meta ignorada → 2100/7
});

test('gastos sin categoría no se infieren como fijos', () => {
  // Dos meses cerrados con gasto sin categoría; no debe reservarse como fijo.
  const txs = [
    ing(2100, '2026-06-03'),
    { tipo: 'gasto', ambito: 'personal', hogar_id: null, monto: 1000, fecha: '2026-04-02', categoria_id: null },
    { tipo: 'gasto', ambito: 'personal', hogar_id: null, monto: 1000, fecha: '2026-05-02', categoria_id: null },
  ];
  const out = calcularSafeToSpend(txs, [], { hoy: HOY });
  assert.strictEqual(out.diario, 300); // sin reserva por fijos → 2100/7
});

// ── Desglose: los componentes que la card muestra al desplegar ──────────
// El número hero era opaco (¿de dónde sale "te pasaste por S/712"?), así que
// calcularSafeToSpend expone las piezas que ya calculaba internamente.

test('desglose: presente en estado ok y cuadra con restanteMes', () => {
  const out = calcularSafeToSpend([ing(2100, '2026-06-05'), gas(700, '2026-06-10')], [], { hoy: HOY });
  assert.strictEqual(out.estado, 'ok');
  assert.ok(out.desglose, 'falta desglose');
  assert.strictEqual(out.desglose.ingresoEstimado, 2100);
  assert.strictEqual(out.desglose.yaGastado, 700);
  assert.strictEqual(out.desglose.gastosFijos, 0);
  assert.strictEqual(out.desglose.ahorroMetas, 0);
  assert.strictEqual(out.desglose.disponible, 2100);
  // disponible − yaGastado === restanteMes
  assert.strictEqual(out.desglose.disponible - out.desglose.yaGastado, out.restanteMes);
});

test('desglose: presente en estado excedido y cuadra con exceso', () => {
  const out = calcularSafeToSpend([ing(500, '2026-06-05'), gas(900, '2026-06-10')], [], { hoy: HOY });
  assert.strictEqual(out.estado, 'excedido');
  assert.strictEqual(out.desglose.ingresoEstimado, 500);
  assert.strictEqual(out.desglose.yaGastado, 900);
  assert.strictEqual(out.desglose.disponible, 500);
  // yaGastado − disponible === exceso
  assert.strictEqual(out.desglose.yaGastado - out.desglose.disponible, out.exceso);
});

test('desglose: disponible descuenta fijos y metas', () => {
  // 'c1' gastado en abril y mayo (2 meses cerrados) → fijo estimado = mediana(400,400) = 400.
  const txs = [
    ing(3000, '2026-06-03'),
    gas(400, '2026-04-05', 'c1'),
    gas(400, '2026-05-05', 'c1'),
  ];
  const out = calcularSafeToSpend(txs, [], { hoy: HOY });
  assert.strictEqual(out.desglose.gastosFijos, 400);
  assert.strictEqual(out.desglose.ingresoEstimado, 3000);
  // disponible = ingreso − fijos − metas
  assert.strictEqual(
    out.desglose.disponible,
    out.desglose.ingresoEstimado - out.desglose.gastosFijos - out.desglose.ahorroMetas
  );
});

test('desglose: los importes son números redondeados (listos para mostrar)', () => {
  const out = calcularSafeToSpend([ing(2100, '2026-06-05')], [meta({})], { hoy: HOY });
  // metasFueraDeRitmo es la única pieza no-numérica del desglose a propósito:
  // lista de {nombre, planMensual}, no un importe.
  for (const [k, v] of Object.entries(out.desglose)) {
    if (k === 'metasFueraDeRitmo') { assert.ok(Array.isArray(v), k + ' debería ser array'); continue; }
    assert.strictEqual(typeof v, 'number', k + ' no es número');
    assert.ok(Number.isFinite(v), k + ' no es finito');
    assert.strictEqual(v, Math.round(v), k + ' no está redondeado');
  }
});

// ── Reserva de metas topada al ingreso ───────────────────────────────────
// Bug real: una meta con poco margen (fecha cercana, poco ahorrado) podía
// exigir MÁS de lo que entra en el mes. calcularAporteMetas no recibía el
// ingreso, así que no tenía con qué acotrar — el disponible podía salir
// negativo y la card mostraba un "te pasaste por" fabricado por la reserva,
// no por gasto real. La reserva total de metas ahora nunca supera el 50%
// de (ingreso estimado − gastos fijos).

test('reserva de metas se topa al 50% del disponible; el disponible nunca es negativo', () => {
  // Meta gigante (objetivo 10000, 0 ahorrado, vence en 16 días → mesesRestantes=1
  // → planMensual=10000) frente a un ingreso de apenas 1000: sin tope, la reserva
  // cruda sería 10000*(7/30)≈2333, mucho mayor que el ingreso entero.
  const out = calcularSafeToSpend(
    [ing(1000, '2026-06-03')],
    [meta({ nombre: 'Meta gigante', monto_objetivo: 10000, fecha_limite: '2026-07-10' })],
    { hoy: HOY }
  );
  const techo = 1000 * 0.5; // 50% de (ingreso − fijos), fijos=0 aquí
  assert.ok(out.desglose.ahorroMetas <= techo + 0.5, 'la reserva no se topó: ' + out.desglose.ahorroMetas);
  assert.ok(out.desglose.disponible >= 0, 'disponible negativo: ' + out.desglose.disponible);
});

test('regresión: caso real — S/501.76 ingreso, meta "Laptop nueva" S/2,000 al 17-ago no debe pasar de 251 de reserva', () => {
  const hoyJulio = new Date(2026, 6, 18); // 31 días en julio; díasRestantes = 14.
  const txs = [
    ing(501.76, '2026-07-05'),
    { tipo: 'gasto', ambito: 'personal', hogar_id: null, monto: 268.44, fecha: '2026-07-10', categoria_id: 'c1' },
  ];
  const metas = [meta({ nombre: 'Laptop nueva', monto_objetivo: 2000, monto_actual: 0, fecha_limite: '2026-08-17' })];
  const out = calcularSafeToSpend(txs, metas, { hoy: hoyJulio });

  assert.strictEqual(out.desglose.ingresoEstimado, 502);
  assert.strictEqual(out.desglose.gastosFijos, 0);
  assert.strictEqual(out.desglose.ahorroMetas, 251); // topado: sin tope habría sido 903
  assert.strictEqual(out.desglose.disponible, 251);
  assert.ok(out.desglose.disponible >= 0);
  assert.strictEqual(out.desglose.yaGastado, 268);
  assert.strictEqual(out.estado, 'excedido');
  assert.strictEqual(out.exceso, 17); // antes del fix: 669 (fabricado por la reserva de 903)
});

test('meta holgada (dentro del tope) no se recorta — sin cambio de comportamiento', () => {
  // Mismo caso que el test original 'aporte de meta prorratea...': con ingreso
  // 2100 el tope es 1050, muy por encima de lo que esa meta exige (~40).
  const out = calcularSafeToSpend([ing(2100, '2026-06-03')], [meta()], { hoy: HOY });
  assert.strictEqual(out.estado, 'ok');
  assert.strictEqual(out.diario, 294);
  assert.strictEqual(out.desglose.metasFueraDeRitmo.length, 0);
});

test('metasFueraDeRitmo: se nombra la meta cuando el tope realmente recorta', () => {
  const hoyJulio = new Date(2026, 6, 18);
  const txs = [ing(501.76, '2026-07-05')];
  const metas = [meta({ nombre: 'Laptop nueva', monto_objetivo: 2000, monto_actual: 0, fecha_limite: '2026-08-17' })];
  const out = calcularSafeToSpend(txs, metas, { hoy: hoyJulio });
  assert.strictEqual(out.desglose.metasFueraDeRitmo.length, 1);
  assert.strictEqual(out.desglose.metasFueraDeRitmo[0].nombre, 'Laptop nueva');
  assert.strictEqual(out.desglose.metasFueraDeRitmo[0].planMensual, 2000);
});

test('metasFueraDeRitmo: vacío cuando ninguna meta individual supera el tope, aunque la suma sí', () => {
  // Dos metas modestas por separado (cada una bajo el tope) que en conjunto
  // superan el 50% del ingreso: se topa la suma, pero no se señala a ninguna
  // por nombre — evita culpar a una meta razonable de un problema de conjunto.
  const hoyJulio = new Date(2026, 6, 18);
  const txs = [ing(1000, '2026-07-05')];
  const metas = [
    meta({ id: 'm1', nombre: 'Meta A', monto_objetivo: 600, monto_actual: 0, fecha_limite: '2026-08-10' }),
    meta({ id: 'm2', nombre: 'Meta B', monto_objetivo: 600, monto_actual: 0, fecha_limite: '2026-08-10' }),
  ];
  const out = calcularSafeToSpend(txs, metas, { hoy: hoyJulio });
  assert.strictEqual(out.desglose.metasFueraDeRitmo.length, 0);
  assert.ok(out.desglose.ahorroMetas <= 500 + 0.5); // tope: 50% de 1000
});

// ── Techo de reserva configurable (pctAhorro) ────────────────────────────
// Antes estaba hardcodeado en 50%. Ahora entra como insumo explícito, igual
// que el ingreso: la función sigue siendo pura y el % vive en el perfil.

test('pctAhorro explícito cambia el techo de la reserva', () => {
  // Meta que exige mucho más de lo que cabe, para que el techo mande siempre.
  const metas = [meta({ monto_objetivo: 100000, fecha_limite: '2026-07-10' })];
  const txs = [ing(1000, '2026-06-03')];

  const con20 = calcularSafeToSpend(txs, metas, { hoy: HOY, pctAhorro: 20 });
  const con50 = calcularSafeToSpend(txs, metas, { hoy: HOY, pctAhorro: 50 });

  assert.strictEqual(con20.desglose.ahorroMetas, 200); // 20% de 1000
  assert.strictEqual(con50.desglose.ahorroMetas, 500); // 50% de 1000
});

test('pctAhorro = 0 → no se reserva nada para metas (caso límite válido)', () => {
  const metas = [meta({ monto_objetivo: 100000, fecha_limite: '2026-07-10' })];
  const out = calcularSafeToSpend([ing(1000, '2026-06-03')], metas, { hoy: HOY, pctAhorro: 0 });
  assert.strictEqual(out.desglose.ahorroMetas, 0);
  assert.strictEqual(out.desglose.disponible, 1000); // ingreso − fijos(0) − metas(0)
});

test('pctAhorro ausente o inválido cae a 50 (comportamiento previo)', () => {
  const metas = [meta({ monto_objetivo: 100000, fecha_limite: '2026-07-10' })];
  const txs = [ing(1000, '2026-06-03')];
  const esperado = 500; // 50% de 1000

  for (const opts of [
    { hoy: HOY },                      // ausente
    { hoy: HOY, pctAhorro: null },
    { hoy: HOY, pctAhorro: 'treinta' },
    { hoy: HOY, pctAhorro: -10 },      // fuera de rango
    { hoy: HOY, pctAhorro: 150 },      // fuera de rango
  ]) {
    const out = calcularSafeToSpend(txs, metas, opts);
    assert.strictEqual(out.desglose.ahorroMetas, esperado,
      'falló con opts=' + JSON.stringify(opts));
  }
});

test('pctAhorro no altera una meta holgada que ya cabía bajo el techo', () => {
  // La meta por defecto exige poco; con 2100 de ingreso cabe con cualquier pct
  // razonable, así que bajar el techo al 20% no debe recortarla.
  const out = calcularSafeToSpend([ing(2100, '2026-06-03')], [meta()], { hoy: HOY, pctAhorro: 20 });
  assert.strictEqual(out.estado, 'ok');
  assert.strictEqual(out.diario, 294);          // idéntico al test original
  assert.strictEqual(out.desglose.metasFueraDeRitmo.length, 0);
});
