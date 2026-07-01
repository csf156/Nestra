// Router Module — Hash-Based SPA Navigation & View Injection
// Global state for current route and context
// Handles navigation, view loading, route protection, error handling
// (isAuthenticated, initAuth loaded from auth.js)

// Global State
window.routerContext = {};

// navigateTo(route) — Change hash and trigger route change
// Args: route (string) — e.g. 'dashboard', 'login', 'profile'
// Returns: undefined
// Side effects: sets window.location.hash, triggers hashchange event
function navigateTo(route) {
  window.location.hash = `#${route}`;
}

// mostrarOnboardingSiHaceFalta() — monta el overlay de onboarding si el perfil
// del usuario aún no lo completó. Devuelve true si tomó la pantalla.
// Lee window.currentProfile (cargado al login, incluye onboarding_completado y
// moneda). No bloquea la app si el perfil no carga. Side effect: sincroniza la
// cache de moneda desde el perfil.
async function mostrarOnboardingSiHaceFalta() {
  if (document.getElementById('onboarding')) return false;
  try { if (localStorage.getItem('nestra-onboarding-done') === '1') return false; } catch (e) {}
  let perfil = window.currentProfile || null;
  if (!perfil) {
    try {
      const u = (typeof getCurrentUser === 'function') ? getCurrentUser() : null;
      if (u && u.id && typeof loadProfile === 'function') perfil = await loadProfile(u.id);
    } catch (e) { return false; }
  }
  if (!perfil) return false;
  if (typeof cacheMonedaDesdePerfil === 'function') cacheMonedaDesdePerfil(perfil);
  if (perfil.onboarding_completado) {
    try { localStorage.setItem('nestra-onboarding-done', '1'); } catch (e) {}
    return false;
  }
  try {
    const html = await fetch('views/onboarding.html').then((r) => r.text());
    const wrap = document.createElement('div');
    wrap.innerHTML = html;
    document.body.appendChild(wrap);
    executeScripts(wrap); // re-ejecuta el <script> inline del overlay
    return true;
  } catch (e) {
    console.error('onboarding mount failed:', e && e.message);
    return false;
  }
}

// executeScripts(container) — Re-create <script> tags so they run
// Browsers do NOT execute <script> inserted via innerHTML. This finds each
// script in the injected view and replaces it with a fresh node, which the
// browser then executes (inline form handlers, dashboard init, etc).
function executeScripts(container) {
  const scripts = container.querySelectorAll('script');
  scripts.forEach((oldScript) => {
    const newScript = document.createElement('script');
    Array.from(oldScript.attributes).forEach((attr) =>
      newScript.setAttribute(attr.name, attr.value)
    );
    newScript.textContent = oldScript.textContent;
    oldScript.parentNode.replaceChild(newScript, oldScript);
  });
}

// loadView(viewName, context) — Fetch & inject view into DOM
// Args: viewName (string) — view file name, e.g. 'dashboard'
//       context (object) — data to attach to window.routerContext
// Returns: undefined
// Side effects: fetches views/${viewName}.html, updates routerContext,
//               injects HTML into #app container, scrolls to top, logs load
async function loadView(viewName, context = {}) {
  try {
    const response = await fetch(`views/${viewName}.html`);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: Failed to load view`);
    }

    const html = await response.text();

    // Update router context
    window.routerContext = {
      ...window.routerContext,
      ...context,
      currentView: viewName,
    };

    // Inject into #app container
    const appContainer = document.getElementById('app');
    if (appContainer) {
      appContainer.innerHTML = html;
      // <script> tags from innerHTML don't run — re-create them so inline
      // view scripts (login form handler, dashboard init) actually execute.
      executeScripts(appContainer);
    } else {
      console.error('App container (#app) not found in DOM');
      throw new Error('App container not found');
    }

    // Scroll to top
    window.scrollTo(0, 0);

    console.log(`View loaded: ${viewName}`);
  } catch (err) {
    console.error(`Error loading view '${viewName}':`, err.message);

    // Show error card
    const appContainer = document.getElementById('app');
    if (appContainer) {
      appContainer.innerHTML = `
        <div class="alert error" style="margin: var(--space-xl);">
          <div class="alert-content">
            <p class="alert-title">No se pudo cargar la vista</p>
            <p>${err.message}</p>
            <p>Revisa la consola para más detalles.</p>
          </div>
        </div>
      `;
    }

    throw err;
  }
}

// handleRouteChange() — Parse hash, check auth, load view
// Returns: undefined
// Side effects: reads window.location.hash, checks isAuthenticated(),
//               redirects to #login if needed, calls loadView()
function setChromeVisible(visible) {
  // Show/hide the persistent navbar. The nav lives in index.html (static),
  // so it must be hidden on public views (login/register) and shown once
  // inside the app. Toggling a body class keeps the CSS in one place.
  document.body.classList.toggle('no-chrome', !visible);
}

// Route table — single source of truth for hash → view + access level.
// `public: true` means no session required (login/register/recovery).
// Everything else is protected and bounces to #login without a session.
const ROUTES = {
  login: { view: 'login', public: true },
  register: { view: 'register', public: true },
  'forgot-password': { view: 'forgot-password', public: true },
  'reset-password': { view: 'reset-password', public: true },
  dashboard: { view: 'dashboard' },
  historial: { view: 'historial' },
  transaccion: { view: 'transaccion' },
  graficos: { view: 'graficos' },
  metas: { view: 'metas' },
  brujula: { view: 'brujula' },
  decisiones: { view: 'brujula' },
  resumen: { view: 'resumen' },
  prestamos: { view: 'prestamos' },
  hogar: { view: 'hogar' },
  configuracion: { view: 'configuracion' },
};

const DEFAULT_ROUTE = 'dashboard';

// setActiveNav(hash) — Mark the matching nav link as active
// Args: hash (string) — current route hash, e.g. 'dashboard', 'metas'
// Called after each successful route load for protected (chrome-visible) routes.
function setActiveNav(hash) {
  var links = document.querySelectorAll('.nav-link');
  links.forEach(function (link) {
    var active = link.getAttribute('href') === '#' + hash;
    link.classList.toggle('active', active);
    if (active) {
      link.setAttribute('aria-current', 'page');
    } else {
      link.removeAttribute('aria-current');
    }
  });
}

async function handleRouteChange() {
  try {
    // Get current hash, strip # and lowercase
    let hash = window.location.hash.slice(1).toLowerCase() || DEFAULT_ROUTE;

    console.log(`Route changed to: ${hash}`);

    // Unknown route → redirect to default (re-enters via hashchange)
    let route = ROUTES[hash];
    if (!route) {
      console.warn(`Unknown route: ${hash}, redirecting to #${DEFAULT_ROUTE}`);
      window.location.hash = `#${DEFAULT_ROUTE}`;
      return;
    }

    const isPublic = route.public === true;

    // Protected route without a session → login
    if (!isPublic && !isAuthenticated()) {
      console.warn(`Redirect: ${hash} requires authentication`);
      if (typeof hideFab === 'function') hideFab();
      window.location.hash = '#login';
      return;
    }

    // Authenticated user on a public auth view → dashboard
    if (isPublic && isAuthenticated()) {
      console.log('User already authenticated, redirecting to dashboard');
      window.location.hash = `#${DEFAULT_ROUTE}`;
      return;
    }

    // Onboarding (primer login): si el perfil no lo completó, tomar la pantalla
    // antes de cargar cualquier vista protegida. Al terminar navega a #dashboard.
    if (!isPublic) {
      const ob = await mostrarOnboardingSiHaceFalta();
      if (ob) return;
    }

    // Hide navbar on public views, show it inside the app
    setChromeVisible(!isPublic);

    // Actualizar FAB global según ruta
    if (isPublic) {
      if (typeof hideFab === 'function') hideFab();
    } else {
      if (typeof updateFabForRoute === 'function') updateFabForRoute(hash);
    }

    // Load the matching view from views/
    await loadView(route.view);

    // Mark matching nav link as active (only when nav is visible)
    if (!isPublic) {
      setActiveNav(hash);
    }

    // Actualizar chip de usuario en vistas protegidas (sesión activa)
    if (!isPublic && typeof updateUserChip === 'function') {
      updateUserChip();
    }
  } catch (err) {
    // loadView already rendered an inline error card; don't overwrite it with
    // the login view (that made every not-yet-built route look like login).
    console.error('Error handling route change:', err.message);
  }
}

// initRouter() — Initialize router after auth is ready
// Returns: undefined
// Side effects: waits 100ms for auth init, then calls handleRouteChange()
// Called automatically on DOMContentLoaded
async function initRouter() {
  try {
    // Wait for auth module to initialize (100ms buffer)
    await new Promise((resolve) => setTimeout(resolve, 100));

    console.log('Router initialized');

    // Trigger initial route
    await handleRouteChange();
  } catch (err) {
    console.error('Error initializing router:', err.message);
  }
}

// Event Listeners

// Listen for hash changes and re-render view
window.addEventListener('hashchange', handleRouteChange);

// Initialize router when DOM is ready
document.addEventListener('DOMContentLoaded', initRouter);
