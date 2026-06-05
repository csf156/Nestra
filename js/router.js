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
        <div class="error-card" style="padding: 2rem; margin: 2rem; border: 1px solid #ef4444; border-radius: 0.5rem; background: #fee2e2; color: #7f1d1d;">
          <h2 style="margin-top: 0;">Error Loading View</h2>
          <p>${err.message}</p>
          <p>Please check the console for more details.</p>
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
async function handleRouteChange() {
  try {
    // Get current hash, strip # and lowercase
    let hash = window.location.hash.slice(1).toLowerCase() || 'dashboard';

    console.log(`Route changed to: ${hash}`);

    // Public routes that don't require authentication
    const publicRoutes = ['login', 'register', 'forgot-password'];

    // Protected routes
    const protectedRoutes = ['dashboard', 'profile', 'settings', 'transaccion', 'historial', 'metas', 'config'];

    // Check if route is protected
    if (protectedRoutes.includes(hash) && !isAuthenticated()) {
      console.warn(`Redirect: ${hash} requires authentication`);
      window.location.hash = '#login';
      return;
    }

    // Prevent authenticated users from accessing login/register
    if (publicRoutes.includes(hash) && isAuthenticated()) {
      console.log('User already authenticated, redirecting to dashboard');
      window.location.hash = '#dashboard';
      return;
    }

    // Load the appropriate view
    switch (hash) {
      case 'login':
        await loadView('login');
        break;
      case 'register':
        await loadView('register');
        break;
      case 'forgot-password':
        await loadView('forgot-password');
        break;
      case 'dashboard':
        await loadView('dashboard');
        break;
      case 'transaccion':
        await loadView('transaccion');
        break;
      case 'historial':
        await loadView('historial');
        break;
      case 'metas':
        await loadView('metas');
        break;
      case 'config':
        await loadView('config');
        break;
      default:
        console.warn(`Unknown route: ${hash}, defaulting to dashboard`);
        await loadView('dashboard');
        break;
    }
  } catch (err) {
    console.error('Error handling route change:', err.message);

    // Fallback: try to load login view
    try {
      await loadView('login');
    } catch (fallbackErr) {
      console.error('Failed to load fallback login view:', fallbackErr.message);
    }
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
