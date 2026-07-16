import assert from 'node:assert';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

// Contraste WCAG 2.x del hero "Puedes gastar hoy". Los tokens --s2s-* son
// fijos (mismos valores en ambos temas) a propósito: la paleta de Nestra se
// invierte entre temas y el hero no puede depender de eso. Este test lee el
// CSS real, no una copia, para que cambiar el token rompa el test.

const css = readFileSync(new URL('../css/base.css', import.meta.url), 'utf8');

function token(nombre) {
  const m = css.match(new RegExp('--' + nombre + ':\\s*(#[0-9a-fA-F]{6})'));
  assert.ok(m, 'token --' + nombre + ' no encontrado en css/base.css');
  return m[1];
}

const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
function luminancia(hex) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function contraste(a, b) {
  const l1 = Math.max(luminancia(a), luminancia(b)), l2 = Math.min(luminancia(a), luminancia(b));
  return (l1 + 0.05) / (l2 + 0.05);
}

const BLANCO = '#ffffff';
const AA_NORMAL = 4.5; // WCAG AA texto normal

test('contraste: sanity del calculador (negro sobre blanco = 21:1)', () => {
  assert.ok(Math.abs(contraste('#000000', '#ffffff') - 21) < 0.01);
});

test('card normal: blanco sobre ambos extremos del gradiente cumple AA', () => {
  for (const t of ['s2s-from', 's2s-to']) {
    const bg = token(t);
    const r = contraste(BLANCO, bg);
    assert.ok(r >= AA_NORMAL, `--${t} (${bg}) da ${r.toFixed(2)}:1, se necesita >= ${AA_NORMAL}:1`);
  }
});

test('card excedido: blanco sobre ambos extremos del gradiente cumple AA', () => {
  for (const t of ['s2s-exc-from', 's2s-exc-to']) {
    const bg = token(t);
    const r = contraste(BLANCO, bg);
    assert.ok(r >= AA_NORMAL, `--${t} (${bg}) da ${r.toFixed(2)}:1, se necesita >= ${AA_NORMAL}:1`);
  }
});

test('los tokens del hero NO se redefinen en el tema claro (deben ser fijos)', () => {
  // Si alguien los mete en html.light, el hero vuelve a depender del tema y
  // este test lo caza. Buscamos el bloque html.light y verificamos que no
  // contenga ningún --s2s-.
  const m = css.match(/html\.light\s*\{([\s\S]*?)\}/);
  assert.ok(m, 'bloque html.light no encontrado');
  assert.ok(!/--s2s-/.test(m[1]), 'los tokens --s2s-* no deben redefinirse en html.light');
});
