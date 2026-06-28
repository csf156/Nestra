// js/searchable-select.js — combobox con buscador que envuelve un <select> nativo.
// El <select> sigue siendo la fuente de verdad (value + evento change). Sin libs.
// filterOptions es pura y testeable. Carga: <script> clásico (window.*) y ESM en Node.
import { normalizeDesc } from './autocat.js';

// filterOptions(opciones, query) → subconjunto cuyo text contiene query (sin tildes).
function filterOptions(opciones, query) {
  const list = Array.isArray(opciones) ? opciones : [];
  const q = normalizeDesc(query || '');
  if (!q) return list.slice();
  return list.filter((o) => normalizeDesc(o.text).includes(q));
}

// searchableSelect(nativeSelect, opts) → reemplaza visualmente el select por
// input + lista filtrable. opts.specialItems: [{value,text}] pinneados al final.
// Idempotente.
function searchableSelect(nativeSelect, opts) {
  if (!nativeSelect || nativeSelect.dataset.ssEnhanced === '1') {
    if (nativeSelect && nativeSelect._ssSync) nativeSelect._ssSync();
    return;
  }
  opts = opts || {};
  const special = opts.specialItems || [];
  nativeSelect.dataset.ssEnhanced = '1';
  nativeSelect.style.display = 'none';

  const wrap = document.createElement('div');
  wrap.className = 'ss-wrap';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'ss-input';
  input.setAttribute('role', 'combobox');
  input.setAttribute('autocomplete', 'off');
  input.placeholder = opts.placeholder || 'Buscar…';
  const list = document.createElement('ul');
  list.className = 'ss-list';
  list.setAttribute('role', 'listbox');
  list.hidden = true;
  wrap.appendChild(input);
  wrap.appendChild(list);
  nativeSelect.parentNode.insertBefore(wrap, nativeSelect.nextSibling);

  let activeIdx = -1, current = [];

  function realOptions() {
    return Array.from(nativeSelect.options)
      .filter((o) => o.value !== '' && o.value !== '__nueva__')
      .map((o) => ({ value: o.value, text: o.text }));
  }
  function selectedText() {
    const o = nativeSelect.selectedOptions[0];
    return (o && o.value && o.value !== '__nueva__') ? o.text : '';
  }
  function sync() { input.value = selectedText(); }
  nativeSelect._ssSync = sync;

  function render(items) {
    current = items;
    activeIdx = -1;
    list.innerHTML = items.map((it, i) =>
      `<li class="ss-item" role="option" data-value="${it.value}" data-i="${i}">${it.text}</li>`
    ).join('');
    list.hidden = items.length === 0;
  }
  function open() {
    const items = filterOptions(realOptions(), input.value).concat(special);
    render(items);
    list.hidden = items.length === 0;
  }
  function choose(value, text) {
    nativeSelect.value = value;
    input.value = (value === '__nueva__') ? '' : text;
    list.hidden = true;
    nativeSelect.dispatchEvent(new Event('change'));
  }

  input.addEventListener('focus', open);
  input.addEventListener('input', () => {
    const items = filterOptions(realOptions(), input.value).concat(special);
    render(items);
  });
  input.addEventListener('keydown', (e) => {
    if (list.hidden && e.key === 'ArrowDown') { open(); return; }
    if (e.key === 'ArrowDown') { activeIdx = Math.min(activeIdx + 1, current.length - 1); _hl(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { activeIdx = Math.max(activeIdx - 1, 0); _hl(); e.preventDefault(); }
    else if (e.key === 'Enter') { if (activeIdx >= 0 && current[activeIdx]) { const it = current[activeIdx]; choose(it.value, it.text); e.preventDefault(); } }
    else if (e.key === 'Escape') { list.hidden = true; }
  });
  function _hl() {
    Array.from(list.children).forEach((li, i) => li.classList.toggle('ss-active', i === activeIdx));
  }
  list.addEventListener('mousedown', (e) => {
    const li = e.target.closest('.ss-item');
    if (!li) return;
    e.preventDefault();
    const it = current[Number(li.dataset.i)];
    if (it) choose(it.value, it.text);
  });
  document.addEventListener('click', (e) => { if (!wrap.contains(e.target)) list.hidden = true; });

  sync();
}

if (typeof window !== 'undefined') {
  window.filterOptions = filterOptions;
  window.searchableSelect = searchableSelect;
}
export { filterOptions, searchableSelect };
