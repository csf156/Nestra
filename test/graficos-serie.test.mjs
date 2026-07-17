import assert from 'node:assert';
import { test } from 'node:test';
import { agruparSerie } from '../js/graficos-serie.js';

const g = (f, m) => ({ tipo: 'gasto', fecha: f, monto: m });
const i = (f, m) => ({ tipo: 'ingreso', fecha: f, monto: m });

// El bug original: el gráfico acumulaba dentro del mes y aplanaba los picos.
test('dias: NO acumula (el bug original)', () => {
  const r = agruparSerie([g('2026-07-01', 10), g('2026-07-02', 10)], 'dias', { mes: 7, anio: 2026 });
  assert.strictEqual(r[0].gasto, 10);
  assert.strictEqual(r[1].gasto, 10, 'el dia 2 debe ser 10, no 20 (acumulado)');
});

test('dias: respeta el largo del mes', () => {
  assert.strictEqual(agruparSerie([], 'dias', { mes: 2, anio: 2026 }).length, 28);
  assert.strictEqual(agruparSerie([], 'dias', { mes: 2, anio: 2024 }).length, 29, 'bisiesto');
  assert.strictEqual(agruparSerie([], 'dias', { mes: 4, anio: 2026 }).length, 30);
  assert.strictEqual(agruparSerie([], 'dias', { mes: 7, anio: 2026 }).length, 31);
});

test('dias: ignora las filas de otro mes', () => {
  const r = agruparSerie([g('2026-06-30', 999), g('2026-07-05', 5)], 'dias', { mes: 7, anio: 2026 });
  assert.strictEqual(r.reduce((a, x) => a + x.gasto, 0), 5);
});

test('meses: 12 periodos cruzando el año hacia atras', () => {
  const r = agruparSerie([], 'meses', { mes: 1, anio: 2026 }, 12);
  assert.strictEqual(r.length, 12);
  assert.strictEqual(r[0].label, 'feb', '12 meses hasta ene-2026 empiezan en feb-2025');
  assert.strictEqual(r[11].label, 'ene');
});

test('meses: agrupa en el bucket correcto', () => {
  const r = agruparSerie(
    [g('2025-02-10', 7), g('2025-02-28', 3), g('2026-01-01', 100)], 'meses', { mes: 1, anio: 2026 }, 12);
  assert.strictEqual(r[0].gasto, 10);
  assert.strictEqual(r[11].gasto, 100);
});

test('trimestres: limites T1=ene-mar .. T4=oct-dic', () => {
  const r = agruparSerie(
    [g('2026-01-01', 1), g('2026-03-31', 2), g('2026-04-01', 4)], 'trimestres', { mes: 6, anio: 2026 }, 8);
  assert.strictEqual(r.find((x) => x.label === 'T1 26').gasto, 3, 'ene y mar caen en T1');
  assert.strictEqual(r.find((x) => x.label === 'T2 26').gasto, 4, 'abr cae en T2');
});

test('trimestres: 8 periodos = 2 años', () => {
  const r = agruparSerie([], 'trimestres', { mes: 12, anio: 2026 }, 8);
  assert.strictEqual(r.length, 8);
  assert.strictEqual(r[0].label, 'T1 25');
  assert.strictEqual(r[7].label, 'T4 26');
});

test('periodos sin datos salen en 0, no se saltan', () => {
  const r = agruparSerie([g('2026-01-05', 50)], 'meses', { mes: 1, anio: 2026 }, 12);
  assert.strictEqual(r.length, 12);
  assert.ok(r.slice(0, 11).every((x) => x.gasto === 0));
});

test('separa gasto e ingreso; ignora ahorro', () => {
  const r = agruparSerie(
    [g('2026-07-01', 10), i('2026-07-01', 30), { tipo: 'ahorro', fecha: '2026-07-01', monto: 999 }],
    'dias', { mes: 7, anio: 2026 });
  assert.strictEqual(r[0].gasto, 10);
  assert.strictEqual(r[0].ingreso, 30);
});

test('lista vacia o null no rompe', () => {
  assert.strictEqual(agruparSerie([], 'meses', { mes: 7, anio: 2026 }, 12).length, 12);
  assert.strictEqual(agruparSerie(null, 'dias', { mes: 7, anio: 2026 }).length, 31);
});
