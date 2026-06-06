# Nestra — Guía de Desarrollo Agéntico (Plan Pro)

**Para:** Desarrollador sin experiencia previa en programación | **SO:** Windows
**Actualizado:** Junio 2026 | **Versión:** 3.0

---

## Cómo usar esta guía

Esta guía está optimizada para el plan Pro de Claude con un enfoque de **desarrollo agéntico**: cada sesión de trabajo está dividida en cuatro fases con roles distintos, modelo recomendado y skill específico para cada tarea.

**Reglas para cada sesión:**

1. Abre una conversación nueva en Claude
2. Pega el **bloque de contexto** de esa sesión — solo una vez al inicio
3. Usa los prompts en el **orden indicado**, de uno en uno
4. Guarda cada archivo antes de pedir el siguiente
5. Completa las cuatro fases (Planificación → Ejecución → Testeo → Seguridad) antes de cerrar la sesión

**Por qué un archivo a la vez:**
Cuando Claude genera varios archivos en una sola respuesta, los últimos reciben menos atención que los primeros. Pidiéndolos en secuencia dentro de la misma sesión, Claude mantiene el contexto del proyecto pero dedica toda su atención a cada archivo.

**Lo que necesitas antes de empezar:**

- Un navegador moderno (Chrome o Edge)
- **Visual Studio Code** — [code.visualstudio.com](https://code.visualstudio.com) (gratuito)
- Una cuenta en **Supabase** — [supabase.com](https://supabase.com) (gratuita, sin tarjeta)
- Una cuenta en **GitHub** — [github.com](https://github.com) (gratuita) — solo en la última sesión

**Estructura de carpetas que crearás en tu computadora:**

```
nestra/
├── views/
├── css/
├── js/
├── supabase/
└── docs/
```

Crea estas carpetas vacías en tu escritorio antes de comenzar.

---

## Marco de Desarrollo Agéntico

Esta guía adopta un modelo donde cada sesión opera con cuatro fases complementarias. No son cuatro Claude distintos — es una sola conversación organizada en roles:

### 🧠 Fase 1 — Planificación
Antes de generar código, Claude revisa el contexto, identifica dependencias y confirma el alcance de lo que se va a construir. Esta fase produce un plan de trabajo corto, no código. Úsala para detectar problemas antes de que ocurran.

### ⚙️ Fase 2 — Ejecución
Claude escribe los archivos según los prompts de la sesión. Cada prompt indica el modelo recomendado y el skill a activar. Un archivo a la vez, en orden.

### 🧪 Fase 3 — Testeo
Una vez generados los archivos, Claude revisa lo que construyó: verifica que los archivos cargan sin error, que las funciones se llaman correctamente entre módulos y que el comportamiento en el navegador es el esperado. Esta fase expande el checklist al final de cada sesión.

### 🔒 Fase 4 — Seguridad
Al cierre de cada sesión, Claude evalúa los archivos recién creados en busca de vulnerabilidades: credenciales expuestas, RLS incompleto, inputs sin validar, rutas accesibles sin autenticación. Produce un reporte de 3 a 5 líneas máximo.

---

## Referencia de modelos

| Ícono | Modelo | Cuándo usarlo |
|---|---|---|
| 🟢 | `claude-haiku-4-5` | Archivos cortos, utilitarios puros, documentación. Sin lógica compleja ni dependencias cruzadas. |
| 🟡 | `claude-sonnet-4-6` | Vistas HTML, módulos JS con lógica de negocio, CSS. La mayoría de la app. |
| 🔴 | `claude-opus-4-6` | SQL con RLS y triggers, módulos de datos complejos, gráficos, dashboards con múltiples fuentes. Cuando el error sería costoso de depurar. |

---

## Referencia de skills

| Skill | Cuándo activarlo |
|---|---|
| **superpowers** | Tareas de alta complejidad estructural: SQL con múltiples tablas y políticas, módulos con muchas funciones interrelacionadas, archivos con más de 300 líneas estimadas. Actívalo antes del prompt. |
| **frontend design** | Cualquier archivo HTML o CSS. Garantiza que el output sea mobile-first, accesible y visualmente coherente. |
| **code review** | Al finalizar cada sesión, antes de la fase de seguridad. Pega el archivo generado y pide revisión. |
| **code simplifier** | En archivos utilitarios (format.js, export.js) o cuando un módulo generado tiene lógica redundante. |

---

## Resumen de sesiones

| Sesión | Prompts | Archivos | Modelo dominante | Qué se construye |
|---|---|---|---|---|
| **0 — Preparación** | — | — | — | Supabase: proyecto, credenciales, cuentas |
| **1 — Base de datos** | 1 | 1 | 🔴 Opus | schema.sql completo |
| **2 — Estructura** | 4 | 9 | 🟡 Sonnet / 🟢 Haiku | Config, auth, router, estilos, login, index |
| **3 — Core de datos** | 3 | 3 | 🔴 Opus / 🟢 Haiku | db.js, format.js, alerts.js |
| **4 — Transacciones** | 2 | 2 | 🔴 Opus / 🟡 Sonnet | transaccion.html, dashboard.html |
| **5 — Historial** | 2 | 2 | 🟡 Sonnet / 🟢 Haiku | historial.html, export.js (CSV) |
| **6 — Gráficos** | 1 | 1 | 🔴 Opus | graficos.html (8 gráficos) |
| **7 — Metas y Decisiones** | 2 | 2 | 🟡 Sonnet | metas.html, decisiones.html |
| **8 — Extras** | 3 | 3 | 🟡 Sonnet | prestamos.html, resumen.html, configuracion.html |
| **9 — Cierre** | 2 | 2 | 🟡 Sonnet / 🔴 Opus | components.css, export.js completo |
| **10 — Despliegue** | 1 | 1 | 🟢 Haiku | GitHub Pages + README.md |
| **Total** | **21 prompts** | **24 archivos** | | |

---

## Por qué esta agrupación

Las sesiones 1, 3 y 6 tienen un solo archivo complejo cada una (`schema.sql`, `db.js`, `graficos.html`) — son demasiado densos para compartir sesión sin perder calidad. El resto se agrupa por afinidad lógica: archivos que se llaman entre sí o que comparten el mismo dominio funcional.

---

## SESIÓN 0 — Preparación del entorno

> Sin código. Configuras Supabase antes de tocar cualquier archivo.

**Pasos:**

1. Ve a [supabase.com](https://supabase.com) y crea una cuenta gratuita
2. Crea un proyecto nuevo:
   - **Name:** `nestra`
   - **Database Password:** guárdala en un lugar seguro
   - **Region:** `South America (São Paulo)`
3. Espera 1-2 minutos hasta que el proyecto esté listo
4. Ve a **Settings → API** y copia en un archivo de texto:
   - **Project URL** — formato `https://xxxx.supabase.co`
   - **anon / public key** — empieza con `eyJh...`

> ⚠️ Nunca uses la `service_role key`. Bypasea toda la seguridad y no debe aparecer en ningún archivo de código.

5. Ve a **Authentication → Settings** y desactiva:
   - **Enable email confirmations**
   - **Enable Signup**
6. Ve a **Authentication → Users → Add user** y crea las dos cuentas:
   - `christian@nestra.app` — activa **Auto Confirm User**
   - `darling@nestra.app` — activa **Auto Confirm User**

**Checklist:**
- [ ] Project URL y anon key guardados
- [ ] Dos cuentas creadas y confirmadas
- [ ] Signup público desactivado

---

## SESIÓN 1 — Base de datos

> Un solo archivo, pero el más crítico. Todo lo demás depende de que la base de datos esté bien configurada.

---

### 🧠 Planificación — inicio de sesión

Pega esto **antes del primer prompt** para que Claude revise el alcance:

```
Voy a construir el esquema completo de base de datos para Nestra.
Antes de generar código, necesito que confirmes:
1. Qué tablas se crearán y en qué orden
2. Qué políticas RLS aplican a cada tabla
3. Qué triggers son necesarios
4. Qué datos semilla se insertarán
Solo responde con el plan. No generes SQL todavía.
```

> Espera la confirmación antes de pasar al Prompt 1.

---

**Contexto — pégalo inmediatamente después del plan:**

```
Soy el desarrollador de Nestra, app web de finanzas personales y en pareja
para Perú (moneda: Sol peruano S/). Backend: Supabase (PostgreSQL + RLS).
Sesión 1 — base de datos completa.
```

---

### ⚙️ Prompt 1 — `supabase/schema.sql`
> 🔴 **Modelo:** `claude-opus-4-6` | 🛠️ **Skill:** `superpowers`

```
Necesito el archivo supabase/schema.sql completo con:

1. Creación de 6 tablas en este orden:
   - profiles (id uuid PK, user_id uuid FK→auth.users, nombre text,
     aporte_mensual_esperado numeric(10,2))
   - categorias (id uuid PK, nombre text, tipo text ['gasto'|'ingreso'],
     limite_mensual numeric(10,2) nullable, color text nullable,
     estado text default 'activa')
   - transacciones (id uuid PK, fecha date, tipo text ['gasto'|'ingreso'],
     ambito text ['personal'|'hogar'], user_id uuid FK→auth.users,
     categoria_id uuid FK→categorias, monto numeric(10,2),
     nota text nullable, aporte_id uuid nullable,
     created_at timestamptz default now())
   - prestamos (id uuid PK, transaccion_id uuid FK→transacciones,
     deudor text, estado text default 'pendiente')
   - metas (id uuid PK, nombre text, tipo text ['ahorro'|'reduccion_gasto'|
     'aporte_hogar'], horizonte text ['corto'|'mediano'|'largo'],
     ambito text ['personal'|'hogar'], user_id uuid nullable,
     monto_objetivo numeric(10,2), monto_actual numeric(10,2) default 0,
     fecha_inicio date default current_date, fecha_limite date,
     estado text default 'en_curso', nota text nullable)
   - desafios (id uuid PK, nombre text, ambito text ['personal'|'hogar'],
     user_id uuid nullable, fecha_inicio date, fecha_fin date,
     estado text default 'activo' ['activo'|'logrado'|'abandonado'],
     categoria_id uuid nullable FK→categorias)

2. RLS activado en todas las tablas:
   - profiles: cada usuario solo lee y edita su propio perfil
   - categorias: cualquier autenticado lee y escribe
   - transacciones: ambito='hogar' → cualquier autenticado;
     ambito='personal' → solo el dueño (auth.uid() = user_id)
   - prestamos: hereda el acceso de su transacción vinculada
   - metas: ambito='hogar' → cualquier autenticado;
     ambito='personal' → solo el dueño
   - desafios: ambito='hogar' → cualquier autenticado;
     ambito='personal' → solo el dueño

3. Trigger que crea automáticamente un perfil en profiles
   al registrar un usuario en auth.users

4. Insert de 21 categorías de gasto (tipo='gasto'):
   Entretenimiento (150), Comer fuera (400), Salidas en bicicleta (150),
   Ahorro (sin límite), Gastos hormiga (100), Ganjah (100),
   Partes de bicicleta (150), Artículos del hogar (150), Mascotas (100),
   Vestimenta (150), Dinero que prestamos (sin límite),
   Capital de trabajo (sin límite), Salud y medicamentos (100),
   Transporte (150), Servicios del hogar (200),
   Mercado / Comida en casa (300), Educación (150),
   Belleza y cuidado personal (100), Regalos (100),
   Imprevistos (150), Suscripciones digitales (80)

5. Insert de 5 categorías de ingreso (tipo='ingreso'):
   Trabajo, Freelance / Extra, Devolución de préstamo,
   Venta de artículos, Otros ingresos

6. Insert de 2 metas iniciales del hogar:
   - "Fondo de emergencia": ahorro, mediano plazo,
     monto_objetivo 2000, fecha_limite 2026-12-31,
     nota "3 meses de gastos básicos cubiertos"
   - "Viaje o experiencia juntos": ahorro, corto plazo,
     monto_objetivo 800, fecha_limite 2026-09-30
```

**Cómo ejecutar:** Supabase → SQL Editor → pega el contenido → Run.
Deberías ver `Success. No rows returned`.

---

### 🧪 Testeo — verificación en Supabase

- [X] Las 6 tablas aparecen en Table Editor
- [X] La tabla `categorias` tiene 26 filas
- [X] La tabla `metas` tiene 2 filas
- [X] En Table Editor → `profiles` → RLS está habilitado (ícono de candado)
- [X] En Table Editor → `transacciones` → hay al menos 2 políticas RLS (hogar y personal)

---

### 🔒 Seguridad — cierre de sesión

Pega el SQL generado y usa `code review` con este prompt:

```
Revisa este schema.sql en busca de:
1. Políticas RLS que permitan acceso cruzado no intencional
2. Triggers que puedan ejecutarse con privilegios elevados
3. Columnas nullable que deberían tener restricciones
4. Ausencia de índices en claves foráneas frecuentes
Responde solo con hallazgos concretos, máximo 5 líneas.
```

---

## SESIÓN 2 — Estructura de la app

> Al finalizar esta sesión tendrás la app corriendo en tu navegador con login real.

---

### 🧠 Planificación — inicio de sesión

```
Voy a construir la estructura base de Nestra: configuración,
autenticación, router y estilos. Antes de generar código, confirma:
1. Qué archivo carga primero al abrir la app
2. Cómo se pasa de una vista a otra (mecanismo de routing)
3. Qué módulo valida si hay sesión activa antes de mostrar una vista
Solo el plan, sin código.
```

**Contexto:**

```
Soy el desarrollador de Nestra, app web de finanzas en pareja.
Stack: HTML + CSS + JS puro (sin frameworks). Backend: Supabase Auth.
Mobile-first. Español peruano. Módulos ES6. Sin estilos inline.
Sesión 2 — estructura base de la app.
```

---

### ⚙️ Prompt 1 — `js/config.js` + `js/supabase.js`
> 🟢 **Modelo:** `claude-haiku-4-5` | 🛠️ **Skill:** ninguno

> Estos dos van juntos porque son ~10 líneas en total y uno depende directamente del otro.

```
Necesito dos archivos:

1. js/config.js
   - Dos constantes exportadas: SUPABASE_URL y SUPABASE_ANON_KEY
   - Valores vacíos con comentario indicando que deben reemplazarse
   - Comentario que indique que este es el único lugar
     donde viven las credenciales

2. js/supabase.js
   - Importa las constantes de config.js
   - Inicializa el cliente Supabase usando CDN de @supabase/supabase-js
   - Exporta la instancia `supabase`
   - Exporta función `getSession()` → sesión activa o null
   - Exporta función `getUser()` → usuario autenticado o null
```

---

### ⚙️ Prompt 2 — `js/auth.js` + `js/router.js`
> 🟡 **Modelo:** `claude-sonnet-4-6` | 🛠️ **Skill:** ninguno

```
Necesito dos archivos:

1. js/auth.js
   - Funciones: login(email, password), logout(),
     getCurrentUser(), getCurrentProfile(), isAuthenticated()
   - Login exitoso → redirige a #dashboard
   - Logout → redirige a #login
   - Sesión expirada → redirige a #login automáticamente
   - Exporta usuario y perfil activos para uso en otros módulos

2. js/router.js
   - Escucha cambios de hash: #dashboard, #historial, #transaccion,
     #graficos, #metas, #decisiones, #resumen, #prestamos,
     #configuracion, #login
   - Carga la vista correspondiente en div con id="app"
   - Sin sesión activa → redirige a #login
   - Con sesión activa en #login → redirige a #dashboard
   - Las vistas se cargan desde la carpeta views/
```

---

### ⚙️ Prompt 3 — `css/base.css` + `css/layout.css`
> 🟡 **Modelo:** `claude-sonnet-4-6` | 🛠️ **Skill:** `frontend design`

```
Necesito dos archivos CSS:

1. css/base.css
   - Variables CSS para modo claro y oscuro
   - Paleta: tonos verdes y grises neutros (app financiera)
   - Reset básico, tipografía system-ui
   - Clases utilitarias: .text-muted, .text-success, .text-danger,
     .card, .badge-warning, .badge-danger
   - Modo oscuro automático via prefers-color-scheme
   - Clase manual .dark para toggle desde configuración

2. css/layout.css
   - Nav inferior fija en móvil (altura 60px)
   - Nav lateral en escritorio (ancho 220px)
   - Breakpoint: 768px
   - Contenedor principal con padding correcto en ambos casos
```

---

### ⚙️ Prompt 4 — `index.html` + `views/login.html` + `views/dashboard.html` (esqueleto)
> 🟡 **Modelo:** `claude-sonnet-4-6` | 🛠️ **Skill:** `frontend design`

```
Necesito tres archivos HTML:

1. index.html
   - Carga en head: base.css, layout.css, components.css
   - Carga SDK de Supabase desde CDN
   - Carga módulos JS: config.js, supabase.js, router.js, auth.js
   - Div con id="app" donde el router inyecta las vistas
   - Nav con íconos y etiquetas: Dashboard, Transacciones,
     Historial, Gráficos, Metas, Decisiones
   - La nav solo se muestra si hay sesión activa
   - En escritorio (≥768px) la nav es lateral izquierda

2. views/login.html
   - Formulario: email + contraseña + botón "Ingresar"
   - Mensaje de error si las credenciales son incorrectas
   - Título "Nestra", subtítulo "Finanzas en pareja"
   - Sin botón de registro. Mobile-first, centrado en pantalla

3. views/dashboard.html
   - Solo el esqueleto: título "Dashboard" y dos secciones
     vacías con títulos "Hogar" y "Tu balance"
   - Se completará en la Sesión 4
```

**Cómo probar:**
1. Abre `nestra/` en VS Code → instala extensión **Live Server**
2. Reemplaza los valores vacíos en `config.js` con tu URL y anon key
3. Clic derecho en `index.html` → **Open with Live Server**
4. Inicia sesión con `christian@nestra.app`

---

### 🧪 Testeo — verificación en el navegador

- [ ] La pantalla de login aparece al abrir la app
- [ ] Puedes iniciar sesión con las credenciales de Supabase
- [ ] Al iniciar sesión llegas al dashboard esqueleto
- [ ] La barra de navegación es visible
- [ ] El modo oscuro responde a la configuración del sistema
- [ ] La consola (F12) no muestra errores en rojo

---

### 🔒 Seguridad — cierre de sesión

```
Revisa auth.js y router.js con este criterio:
1. ¿Hay alguna vista accesible sin sesión activa?
2. ¿El token de sesión se almacena de forma segura?
3. ¿El logout elimina completamente la sesión en Supabase?
Máximo 5 líneas.
```

---

## SESIÓN 3 — Core de datos

> Los módulos que alimentan todas las vistas. Ninguna vista consulta Supabase directamente.

---

### 🧠 Planificación — inicio de sesión

```
Voy a construir la capa de datos de Nestra: db.js, format.js y alerts.js.
Antes de generar código, confirma:
1. Qué módulos importa db.js y qué exporta
2. Qué dependencias tiene alerts.js
3. En qué orden debo generar los tres archivos
Solo el plan.
```

**Contexto:**

```
Soy el desarrollador de Nestra, app web de finanzas en pareja.
Stack: HTML + CSS + JS puro, Supabase (PostgreSQL con RLS).
Moneda: S/. Fechas: DD/MM/AAAA. Módulos ES6.
Sesión 3 — capa central de datos.
```

---

### ⚙️ Prompt 1 — `js/db.js`
> 🔴 **Modelo:** `claude-opus-4-6` | 🛠️ **Skill:** `superpowers`

```
Necesito js/db.js que centralice TODAS las queries a Supabase.
Try/catch en todas las funciones. Módulos ES6.

TRANSACCIONES:
- getTransacciones(filtros) — filtros opcionales:
  ambito, categoria_id, tipo, fecha_desde, fecha_hasta
- getUltimasTransacciones(limite=5)
- insertTransaccion(datos)
- updateTransaccion(id, datos)
- deleteTransaccion(id) — si tiene aporte_id, elimina la vinculada
- insertAporteHogar(monto, categoria_id, nota, fecha) —
  crea atómicamente: gasto personal + ingreso hogar,
  ambos con el mismo aporte_id (crypto.randomUUID())

BALANCES:
- getBalanceHogar(mes, anio) → {ingresos, gastos, balance}
- getBalancePersonal(mes, anio) → {ingresos, gastos,
  aporte_realizado, balance}

CATEGORÍAS:
- getCategorias(tipo=null)
- insertCategoria(datos)
- updateCategoria(id, datos)
- deleteCategoria(id)
- archivarCategoria(id)

PERFILES:
- getProfiles()
- updateProfile(datos)

METAS:
- getMetas(ambito=null)
- insertMeta(datos)
- updateMeta(id, datos)
- deleteMeta(id)

PRÉSTAMOS:
- getPrestamos(estado=null)
- marcarDevuelto(prestamo_id, transaccion_id)

DESAFÍOS:
- getDesafios(estado=null) — retorna hogar + personales del usuario activo
- insertDesafio(datos)
- updateDesafio(id, datos)

RESUMEN:
- getResumenMensual(mes, anio)
```

---

### ⚙️ Prompt 2 — `js/format.js`
> 🟢 **Modelo:** `claude-haiku-4-5` | 🛠️ **Skill:** `code simplifier`

```
Necesito js/format.js con funciones utilitarias puras, sin dependencias:
- formatMonto(numero) → "S/ 1,200.00"
- formatFecha(isoString) → "03/06/2026"
- formatFechaCorta(isoString) → "03/06"
- mesActual() → {mes: number, anio: number}
- nombreMes(mes, anio) → "Junio 2026"
```

---

### ⚙️ Prompt 3 — `js/alerts.js`
> 🟡 **Modelo:** `claude-sonnet-4-6` | 🛠️ **Skill:** ninguno

```
Necesito js/alerts.js que evalúe estas condiciones
y retorne un array de alertas. Usa db.js y format.js.

Condiciones:
- Gasto 80–99% del límite de categoría → tipo: 'warning'
- Gasto ≥ 100% del límite → tipo: 'danger'
- Meta con fecha_limite en menos de 7 días → tipo: 'warning'
- Meta vencida sin completar → tipo: 'danger'
- Préstamo pendiente con más de 30 días → tipo: 'warning'
- Desafío activo con menos de 2 días restantes → tipo: 'warning'

Exporta:
- evaluarAlertas() → array de {tipo, mensaje, vista}
- evaluarAlertaCategoria(categoria_id, monto_nuevo) →
  evalúa si un nuevo gasto dispara alerta antes de guardar
```

---

### 🧪 Testeo — verificación en consola

- [ ] Los tres archivos cargan sin errores en la consola del navegador (F12)
- [ ] `db.getCategorias()` desde la consola devuelve las 26 categorías
- [ ] `format.formatMonto(1200)` devuelve exactamente `"S/ 1,200.00"`
- [ ] `db.getBalanceHogar()` devuelve un objeto con claves `ingresos`, `gastos`, `balance`

---

### 🔒 Seguridad — cierre de sesión

```
Revisa db.js con este criterio:
1. ¿Alguna función omite el filtro por user_id donde debería aplicarlo?
2. ¿Las operaciones atómicas (insertAporteHogar) manejan correctamente
   el rollback si una de las dos inserciones falla?
3. ¿Hay try/catch en todas las funciones públicas?
Máximo 5 líneas.
```

---

## SESIÓN 4 — Transacciones y dashboard

> Al finalizar esta sesión la app es funcional para uso diario.

---

### 🧠 Planificación — inicio de sesión

```
Voy a construir el formulario de transacciones y el dashboard completo.
Antes de generar código, confirma:
1. Cómo el formulario de transacción opera tanto como vista (#transaccion)
   como dentro de un modal en el dashboard
2. Qué datos carga el dashboard en paralelo al iniciar
3. Cómo el modal del dashboard comunica el guardado exitoso
   para refrescar los datos
Solo el plan.
```

**Contexto:**

```
Soy el desarrollador de Nestra, app web de finanzas en pareja.
Stack: HTML + CSS + JS puro, Supabase. Moneda: S/. Mobile-first.
Los módulos db.js, format.js y alerts.js ya están construidos.
Sesión 4 — formulario de transacciones y dashboard completo.
```

---

### ⚙️ Prompt 1 — `views/transaccion.html`
> 🟡 **Modelo:** `claude-sonnet-4-6` | 🛠️ **Skill:** `frontend design`

```
Necesito views/transaccion.html:

Campos:
- Tipo: Gasto / Ingreso (cambia las categorías del desplegable)
- Ámbito: Personal / Hogar
- Categoría: lista desde db.getCategorias() con opción
  "+ Nueva categoría" que muestra un input inline
- Monto: número con 2 decimales en S/
- Fecha: date picker, por defecto hoy
- Nota: textarea opcional

Comportamiento especial:
- Si categoría = "Dinero que prestamos": mostrar campos
  adicionales "Nombre del deudor" y "Estado" (Pendiente / Devuelto)
- Si ámbito = Hogar y flujo = Aporte: usar db.insertAporteHogar()
- Al guardar: llamar a alerts.evaluarAlertaCategoria() y mostrar
  advertencia si aplica (permite guardar igual)
- Validación: monto > 0, categoría seleccionada
- Funciona como vista independiente (#transaccion) y como
  contenido de modal desde el dashboard
- Botones: "Guardar" y "Cancelar"
- Mensaje de éxito al guardar

Todo en español. Mobile-first.
```

---

### ⚙️ Prompt 2 — `views/dashboard.html` (completo)
> 🔴 **Modelo:** `claude-opus-4-6` | 🛠️ **Skill:** `frontend design`

```
Necesito views/dashboard.html completo.
Reemplaza el esqueleto creado en la Sesión 2.

SECCIÓN 1 — Saludo
- "Hola, [nombre del usuario activo]" desde el perfil

SECCIÓN 2 — Balance del hogar
- Título: "🏠 Hogar — [Mes Año]"
- Ingresos, gastos, balance neto desde db.getBalanceHogar()
- Balance positivo en verde, negativo en rojo

SECCIÓN 3 — Balance personal
- Título: "👤 Tu balance — [Mes Año]"
- Ingresos, gastos, aporte al hogar, balance neto
- Desde db.getBalancePersonal()

SECCIÓN 4 — Alertas activas
- Llama a alerts.evaluarAlertas() al cargar
- Lista con íconos ⚠️ o 🚨 si hay alertas; nada si no hay

SECCIÓN 5 — Últimas transacciones
- Últimas 5 de db.getUltimasTransacciones(5)
- Fecha, categoría, monto, badge Hogar/Personal
- Gastos en rojo, ingresos en verde

SECCIÓN 6 — Metas activas
- Máximo 3 metas con barra de progreso simple
- Enlace "Ver todas" → #metas

BOTÓN FLOTANTE "+"
- Fijo en esquina inferior derecha
- Abre modal con el contenido de transaccion.html
- Al guardar: cierra modal y refresca el dashboard

Comportamiento:
- Consultas en paralelo al cargar
- Estado de carga mientras espera
- Mensaje de error si falla la conexión

Todo en español.
```

---

### 🧪 Testeo — verificación en el navegador

- [ ] Los balances muestran datos reales desde Supabase
- [ ] Puedes registrar una transacción con "+" y se refleja de inmediato
- [ ] Las categorías del formulario vienen de Supabase, no son texto fijo
- [ ] Con la otra cuenta ves el mismo bloque hogar pero balance personal diferente
- [ ] El skeleton loader aparece mientras cargan los datos

---

### 🔒 Seguridad — cierre de sesión

```
Revisa transaccion.html con este criterio:
1. ¿El campo "monto" puede recibir valores negativos o texto?
2. ¿La opción "+ Nueva categoría" valida la entrada antes de insertar?
3. ¿El ámbito "Hogar" podría ser manipulado desde el frontend
   para evadir las políticas RLS?
Máximo 5 líneas.
```

---

## SESIÓN 5 — Historial y exportación CSV

---

### 🧠 Planificación — inicio de sesión

```
Voy a construir el historial de transacciones y la exportación CSV.
Antes de generar código, confirma:
1. Cómo los filtros actualizan la tabla (re-query o filtro local)
2. Cómo funciona la eliminación de transacciones vinculadas
   (las que tienen aporte_id)
3. Qué datos recibe exportCSV() y de dónde los obtiene
Solo el plan.
```

**Contexto:**

```
Soy el desarrollador de Nestra, app web de finanzas en pareja.
Stack: HTML + CSS + JS puro, Supabase. Moneda: S/. Mobile-first.
Sesión 5 — historial de transacciones y exportación CSV.
```

---

### ⚙️ Prompt 1 — `views/historial.html`
> 🟡 **Modelo:** `claude-sonnet-4-6` | 🛠️ **Skill:** `frontend design`

```
Necesito views/historial.html con:

FILTROS (colapsables en móvil):
- Ámbito: Todos / Personal / Hogar
- Tipo: Todos / Gasto / Ingreso
- Categoría: desplegable con todas las categorías
- Rango de fechas: desde / hasta
- Botón "Aplicar" y botón "Limpiar"

BUSCADOR:
- Filtra por nota/descripción en tiempo real (sin botón)

TABLA:
- Columnas: Fecha, Categoría, Nota, Ámbito, Monto
- Monto en rojo (gasto) o verde (ingreso)
- Badge Hogar / Personal
- Ordenamiento clickeable por fecha, monto, categoría
- En móvil: al tocar una fila se expande con opciones

ACCIONES POR FILA:
- Editar: abre el formulario de transacción pre-cargado
- Eliminar: pide confirmación. Si tiene aporte_id, advertir
  que se eliminarán ambas transacciones vinculadas

TOTALES AL PIE:
- Total ingresos, total gastos, balance neto del período filtrado

EXPORTAR:
- Botón "Exportar CSV" → llama a export.exportCSV()

Por defecto muestra el mes actual. Todo en español.
```

---

### ⚙️ Prompt 2 — `js/export.js` (versión inicial, solo CSV)
> 🟢 **Modelo:** `claude-haiku-4-5` | 🛠️ **Skill:** `code simplifier`

```
Necesito la versión inicial de js/export.js con:

exportCSV(transacciones):
- CSV con columnas: Fecha, Tipo, Ámbito, Categoría, Monto, Nota
- Monto sin símbolo S/ para compatibilidad con Excel
- Separador: coma. Encoding: UTF-8 con BOM (﻿)
- Nombre del archivo: nestra-historial-[mes]-[año].csv
- Descarga automática sin abrir nueva pestaña

Exporta también exportPDF() y exportJSON() como funciones vacías
con comentario indicando que se completarán en la Sesión 9.
```

---

### 🧪 Testeo — verificación en el navegador

- [ ] El historial muestra transacciones reales
- [ ] Filtros y búsqueda en tiempo real funcionan
- [ ] La advertencia de doble eliminación aparece en aportes
- [ ] El CSV descargado muestra tildes y ñ correctamente en Excel
- [ ] Los totales al pie cambian al aplicar filtros

---

### 🔒 Seguridad — cierre de sesión

```
Revisa historial.html con este criterio:
1. ¿La búsqueda en tiempo real escapa caracteres especiales?
2. ¿El botón "Eliminar" requiere confirmación explícita del usuario?
3. ¿El CSV puede contener datos de otro usuario por un filtro mal aplicado?
Máximo 5 líneas.
```

---

## SESIÓN 6 — Gráficos

> Sesión de un solo archivo por su complejidad. Los 8 gráficos requieren toda la atención de Claude.

---

### 🧠 Planificación — inicio de sesión

```
Voy a construir los 8 gráficos financieros de Nestra en un solo archivo.
Antes de generar código, confirma:
1. Qué datos necesita cada gráfico y desde qué función de db.js los obtiene
2. Cuáles gráficos pueden compartir una sola consulta a Supabase
3. Cuál es el más complejo de implementar y por qué
4. Cómo el selector de mes/año actualiza todos los gráficos a la vez
Solo el plan.
```

**Contexto:**

```
Soy el desarrollador de Nestra, app web de finanzas en pareja.
Stack: HTML + CSS + JS puro, Supabase, Chart.js desde CDN.
Mobile-first. Los módulos db.js y format.js ya están construidos.
Sesión 6 — los 8 gráficos financieros.
```

---

### ⚙️ Prompt 1 — `views/graficos.html`
> 🔴 **Modelo:** `claude-opus-4-6` | 🛠️ **Skill:** `superpowers`

```
Necesito views/graficos.html con los 8 gráficos financieros.
Carga Chart.js desde: https://cdn.jsdelivr.net/npm/chart.js
Selector de mes/año al inicio que filtra todos los gráficos.

GRÁFICO 1 — Evolución temporal (línea)
- Eje X: días del mes. Eje Y: monto acumulado
- Dos líneas: gastos e ingresos del hogar agrupados por día

GRÁFICO 2 — Distribución por categoría (donut)
- Porcentaje de gasto por categoría en el mes (solo hogar)
- Colores según % del límite:
  verde <80%, amarillo 80–100%, rojo >100%
- Leyenda con monto y porcentaje

GRÁFICO 3 — Aporte real vs. esperado (barras)
- Una barra por miembro (Christian, Darling)
- Aporte esperado (profiles.aporte_mensual_esperado) vs. real

GRÁFICO 4 — Tendencia de ahorro acumulado (línea)
- Eje X: últimos 6 meses. Eje Y: balance neto acumulado del hogar

GRÁFICO 5 — Mapa de calor de gastos por día (calendario)
- Mes en formato de calendario con grilla CSS (no librería externa)
- Color por día: sin gasto (gris), gasto bajo (verde), alto (rojo)

GRÁFICO 6 — Flujo de caja mensual (barras cascada)
- Barra inicial = ingresos totales
- Cada barra siguiente = resta de una categoría de gasto
- Barra final = balance resultante

GRÁFICO 7 — Comparativa mes a mes (barras agrupadas)
- Las 5 categorías con más gasto
- Mes actual vs. mes anterior

GRÁFICO 8 — Proyección de metas (línea con forecast)
- Por cada meta activa: línea sólida del progreso real
  + línea punteada proyectando si se llegará al objetivo

Cada gráfico en su propia tarjeta con título y descripción breve.
Adaptados a modo oscuro/claro. Todo en español.
```

---

### 🧪 Testeo — verificación en el navegador

- [ ] Los 8 gráficos se renderizan sin errores en consola
- [ ] El selector de mes filtra los datos
- [ ] El mapa de calor muestra el calendario (no una imagen)
- [ ] Las líneas punteadas del gráfico 8 son visibles
- [ ] Los colores funcionan en modo oscuro

---

### 🔒 Seguridad — cierre de sesión

```
Revisa graficos.html con este criterio:
1. ¿Las consultas a Supabase heredan correctamente el filtro de usuario
   para los datos personales vs. hogar?
2. ¿Algún gráfico podría mostrar datos de otro usuario?
3. ¿Chart.js se carga desde un CDN con integridad verificada (SRI)?
Máximo 5 líneas.
```

---

## SESIÓN 7 — Metas y Decisiones

---

### 🧠 Planificación — inicio de sesión

```
Voy a construir las vistas de metas y decisiones.
Antes de generar código, confirma:
1. Cómo el oráculo financiero obtiene los datos para responder
2. Qué diferencia hay entre una meta personal y una del hogar
   en términos de visibilidad y edición
3. Cómo el mensaje motivacional elige entre los 3 textos posibles
Solo el plan.
```

**Contexto:**

```
Soy el desarrollador de Nestra, app web de finanzas en pareja.
Stack: HTML + CSS + JS puro, Supabase. Moneda: S/. Mobile-first.
La tabla desafios ya existe en Supabase con su RLS configurado.
Los módulos db.js, format.js y alerts.js ya están construidos.
Sesión 7 — vista de metas y vista de decisiones.
```

---

### ⚙️ Prompt 1 — `views/metas.html`
> 🟡 **Modelo:** `claude-sonnet-4-6` | 🛠️ **Skill:** `frontend design`

```
Necesito views/metas.html con:

SECCIÓN 1 — Metas activas
- Tarjeta por cada meta en estado 'en_curso':
  nombre, tipo (badge), horizonte (badge), ámbito (badge),
  barra de progreso (monto_actual / monto_objetivo en %),
  monto actual vs. objetivo en S/, fecha límite y días restantes
- Menos de 7 días: resaltar en amarillo
- Vencida sin completar: resaltar en rojo
- Botones: "Actualizar progreso", "Marcar como lograda", "Eliminar"

SECCIÓN 2 — Metas completadas (colapsada por defecto)
- Lista compacta: nombre, fecha límite, monto logrado

FORMULARIO — Botón flotante "+" abre modal:
- Campos: nombre, tipo, horizonte, ámbito, monto objetivo,
  fecha inicio, fecha límite, nota (opcional)
- Validación: fecha límite posterior a inicio, monto > 0
- Metas personales: solo las ve el usuario activo
- Metas del hogar: las ven ambos

ACCIÓN — Actualizar progreso:
- Abre campo inline para ingresar nuevo monto actual
- Actualiza con db.updateMeta()

Todo en español.
```

---

### ⚙️ Prompt 2 — `views/decisiones.html`
> 🟡 **Modelo:** `claude-sonnet-4-6` | 🛠️ **Skill:** `frontend design`

```
Necesito views/decisiones.html con tres secciones:

SECCIÓN 1 — El oráculo financiero
- Selector de categoría de gasto desde db.getCategorias('gasto')
- Botón "Consultar"
- Respuesta según gasto real del mes vs. límite de la categoría:
  · Verde (< 70% del límite): respuesta permisiva
  · Amarillo (70–99%): respuesta con precaución
  · Rojo (≥ 100%): respuesta disuasiva
- Sin categoría: responde según balance general del hogar del mes

SECCIÓN 2 — Desafíos activos
- Lista de desafíos con estado='activo' (hogar + personales)
- Por cada desafío: nombre, badge ámbito (Hogar/Personal),
  categoría asociada si existe, barra de progreso de días
  transcurridos vs. totales, días restantes
- Botón "Logrado" → estado = 'logrado'
- Botón "Abandonar" → estado = 'abandonado'
- Botón flotante "+" abre modal:
  nombre, ámbito, categoría opcional,
  fecha inicio (hoy por defecto), fecha fin (obligatoria)

SECCIÓN 3 — Mensaje motivacional
- Lee db.getBalanceHogar(mes, anio) al cargar la vista
- Ratio gastos / ingresos → elige al azar entre 3 mensajes por estado:
  · Holgado (< 70%): tono celebratorio
  · Normal (70–90%): tono motivador
  · Ajustado (> 90%): tono de ánimo sin alarma
- Menciona el mes por nombre ("Este junio...")
- Sin caché — se actualiza cada vez que se abre la vista

Todo en español.
```

---

### 🧪 Testeo — verificación en el navegador

- [ ] Las 2 metas iniciales del hogar aparecen en la lista
- [ ] Una meta personal solo la ve quien la creó
- [ ] El oráculo responde con datos reales, no texto fijo
- [ ] El color de la respuesta cambia según el % del límite
- [ ] Un desafío del hogar lo ven ambas cuentas
- [ ] Un desafío personal solo lo ve quien lo creó
- [ ] El mensaje motivacional menciona el mes actual

---

### 🔒 Seguridad — cierre de sesión

```
Revisa metas.html con este criterio:
1. ¿Un usuario podría actualizar el progreso de una meta personal ajena?
2. ¿El formulario de nueva meta valida que user_id sea el del usuario activo?
3. ¿La eliminación de una meta requiere confirmación?
Máximo 5 líneas.
```

---

## SESIÓN 8 — Extras

---

### 🧠 Planificación — inicio de sesión

```
Voy a construir préstamos, resumen mensual y configuración.
Antes de generar código, confirma:
1. Qué hace exactamente db.marcarDevuelto() y qué tablas toca
2. Cómo resumen.html obtiene los datos del mes anterior para la comparativa
3. En configuracion.html, ¿eliminar una categoría con historial
   debería borrar las transacciones o reasignarlas?
Solo el plan.
```

**Contexto:**

```
Soy el desarrollador de Nestra, app web de finanzas en pareja.
Stack: HTML + CSS + JS puro, Supabase. Moneda: S/. Mobile-first.
Los módulos db.js, format.js, alerts.js y export.js ya existen.
Sesión 8 — préstamos, resumen mensual y configuración.
```

---

### ⚙️ Prompt 1 — `views/prestamos.html`
> 🟡 **Modelo:** `claude-sonnet-4-6` | 🛠️ **Skill:** `frontend design`

```
Necesito views/prestamos.html con:

SECCIÓN 1 — Préstamos pendientes
- Lista con estado='pendiente': deudor, monto en S/, fecha,
  quién prestó, ámbito (Personal/Hogar), nota,
  días transcurridos desde el préstamo
- Más de 30 días: resaltar con ⚠️
- Botón "Marcar como devuelto":
  llama a db.marcarDevuelto(), registra ingreso automáticamente
  en categoría "Devolución de préstamo", actualiza estado

SECCIÓN 2 — Total pendiente
- Suma de préstamos pendientes desglosada: hogar y personal

SECCIÓN 3 — Historial de devueltos (colapsado por defecto)
- Deudor, monto, fecha del préstamo, fecha de devolución

Todo en español.
```

---

### ⚙️ Prompt 2 — `views/resumen.html`
> 🟡 **Modelo:** `claude-sonnet-4-6` | 🛠️ **Skill:** `frontend design`

```
Necesito views/resumen.html con:

SELECTOR DE MES
- Selector de mes y año (por defecto: mes actual)
- Al cambiar recarga todos los datos del mes seleccionado

SECCIÓN 1 — Resumen del hogar
- Ingresos, gastos, balance neto
- Comparativa vs. mes anterior (% de variación)

SECCIÓN 2 — Tu resumen personal
- Ingresos, gastos, aporte realizado, balance neto
- Comparativa vs. mes anterior

SECCIÓN 3 — Tabla por categorías
- Columnas: Categoría, Gasto del mes, Límite, % del límite,
  vs. mes anterior
- Semáforo: verde/amarillo/rojo según % del límite

SECCIÓN 4 — Metas del mes
- Metas completadas ese mes
- Metas vencidas sin completarse

EXPORTACIÓN
- Botón "Exportar PDF" → export.exportPDF()
- Botón "Exportar CSV" → export.exportCSV()

Todo en español.
```

---

### ⚙️ Prompt 3 — `views/configuracion.html`
> 🟡 **Modelo:** `claude-sonnet-4-6` | 🛠️ **Skill:** `frontend design`

```
Necesito views/configuracion.html con 4 secciones:

SECCIÓN 1 — Perfiles
- El usuario activo edita su nombre y aporte_mensual_esperado en S/
- El otro perfil se muestra en modo lectura

SECCIÓN 2 — Categorías
- Lista agrupada por tipo (Gastos / Ingresos)
- Por cada una: nombre, límite mensual editable inline,
  botones Editar, Archivar, Eliminar
- Eliminar con historial: diálogo para reasignar antes de borrar
- Botón "Nueva categoría": nombre, tipo, límite opcional

SECCIÓN 3 — Preferencias
- Toggle modo claro / oscuro (guarda en localStorage)
- Moneda S/ e idioma Español (informativos, no editables)

SECCIÓN 4 — Datos
- Botón "Exportar respaldo JSON" → export.exportJSON()
- Botón "Importar desde respaldo" → carga y restaura un JSON
- Botón "Cerrar sesión"
- Botón "Resetear todos los datos" (rojo, requiere escribir CONFIRMAR)

Todo en español.
```

---

### 🧪 Testeo — verificación en el navegador

- [ ] Los préstamos con más de 30 días tienen la advertencia ⚠️
- [ ] Al marcar devuelto se registra el ingreso automáticamente
- [ ] El resumen mensual muestra datos reales
- [ ] La tabla de categorías tiene el semáforo de colores
- [ ] El toggle de modo oscuro persiste al recargar
- [ ] El botón de resetear requiere escribir CONFIRMAR

---

### 🔒 Seguridad — cierre de sesión

```
Revisa configuracion.html con este criterio:
1. ¿El botón "Resetear todos los datos" verifica que el texto
   escrito sea exactamente "CONFIRMAR" antes de ejecutar?
2. ¿La importación de JSON valida la estructura antes de insertar?
3. ¿Un usuario puede modificar el perfil del otro usuario
   desde esta vista?
Máximo 5 líneas.
```

---

## SESIÓN 9 — Cierre visual y exportación completa

---

### 🧠 Planificación — inicio de sesión

```
Voy a cerrar los estilos de componentes y completar el módulo de exportación.
Antes de generar código, confirma:
1. Qué componentes reutilizables aparecen en más de 2 vistas distintas
2. Qué necesita exportPDF() para generar un PDF limpio con window.print()
3. Qué tablas de Supabase debe incluir exportJSON() para que sea
   un respaldo completo y restaurable
Solo el plan.
```

**Contexto:**

```
Soy el desarrollador de Nestra, app web de finanzas en pareja.
Stack: HTML + CSS + JS puro. Mobile-first.
Las variables CSS están definidas en css/base.css.
Sesión 9 — estilos de componentes y exportación completa.
```

---

### ⚙️ Prompt 1 — `css/components.css`
> 🟡 **Modelo:** `claude-sonnet-4-6` | 🛠️ **Skill:** `frontend design`

```
Necesito css/components.css con estilos para todos los
elementos reutilizables. Debe respetar las variables de
base.css y funcionar en modo claro y oscuro.

- Tarjetas (.card): sombra sutil, border-radius, padding
- Botones: .btn-primary, .btn-secondary, .btn-danger, .btn-ghost
  con estados hover y active
- Modales: overlay, contenedor, animación de entrada
- Formularios: inputs, selects, textareas — estilo consistente
- Badges: .badge-hogar, .badge-personal, .badge-warning,
  .badge-danger, .badge-success
- Barras de progreso: .progress-bar con color dinámico según %
- Estados de carga: skeleton loader animado
- Alertas: .alert-warning, .alert-danger
- Tabla del historial: filas alternadas, hover, responsive
- Botón flotante: .fab (floating action button)
```

---

### ⚙️ Prompt 2 — `js/export.js` (versión completa)
> 🔴 **Modelo:** `claude-opus-4-6` | 🛠️ **Skill:** `code simplifier`

```
Necesito js/export.js completo. Reemplaza la versión inicial.

exportCSV(transacciones): mantener exactamente la versión
ya construida en la Sesión 5, sin cambios.

exportPDF(resumenMensual):
- Usa window.print() con estilos @media print
- Encabezado: "Nestra — Resumen [Mes Año]"
- Incluye secciones del resumen mensual y tabla de categorías
- Oculta navegación y botones al imprimir
- Resultado limpio y profesional

exportJSON():
- Exporta tablas visibles: transacciones personales y del hogar,
  metas, préstamos, desafíos, categorías, perfil del usuario
- Objeto JSON con una clave por tabla
- Nombre: nestra-respaldo-[fecha].json
- Incluye metadata: fecha de exportación, versión "1.0"
```

---

### 🧪 Testeo — verificación en el navegador

- [ ] Los estilos son consistentes en todas las vistas
- [ ] Nada se rompe en modo oscuro
- [ ] El PDF generado se ve limpio al imprimir
- [ ] El JSON exportado se puede importar desde configuración
- [ ] El skeleton loader se ve bien en mobile

---

### 🔒 Seguridad — cierre de sesión (revisión global)

Esta es la última sesión antes del despliegue. Usa `code review` con:

```
Revisa la aplicación completa con este criterio:
1. ¿Hay algún archivo que importe o exponga las credenciales
   de Supabase fuera de config.js?
2. ¿Alguna vista HTML tiene inputs sin validar que podrían
   usarse para inyección?
3. ¿El export.js incluye datos a los que el usuario no debería
   tener acceso según las políticas RLS?
4. ¿Hay funciones en db.js que aceptan parámetros del usuario
   sin sanitizar antes de pasarlos a Supabase?
Máximo 8 líneas — esta es la revisión final.
```

---

## SESIÓN 10 — Despliegue

> La app está completa. Esta sesión la pone en internet.

---

### Parte A — Crear cuenta y repositorio en GitHub

1. Ve a [github.com](https://github.com) y crea una cuenta gratuita
2. Clic en **New** → configura el repositorio:
   - **Repository name:** `nestra`
   - **Visibility:** Public
   - Activa **Add a README file**
   - Clic en **Create repository**
3. Descarga **GitHub Desktop** desde [desktop.github.com](https://desktop.github.com) e instálalo
4. Conéctalo con tu cuenta de GitHub
5. **File → Clone repository** → selecciona `nestra` → elige dónde guardarlo
6. Copia todos los archivos de tu carpeta `nestra/` local dentro de la carpeta clonada
7. En GitHub Desktop: escribe "Versión inicial" en **Summary** → **Commit to main** → **Push origin**

### Parte B — Activar GitHub Pages

1. En tu repositorio → **Settings → Pages**
2. **Source:** Deploy from a branch → **Branch:** main, `/ (root)` → **Save**
3. Espera 2-3 minutos. Tu URL será:
   `https://[tu-usuario].github.io/nestra`

### Parte C — Restringir Supabase a tu dominio

1. Supabase → **Settings → API → Allowed origins**
2. Escribe: `https://[tu-usuario].github.io`
3. **Save**

---

### ⚙️ Prompt 1 — `README.md`
> 🟢 **Modelo:** `claude-haiku-4-5` | 🛠️ **Skill:** ninguno

```
Soy el desarrollador de Nestra, app de finanzas en pareja
publicada en GitHub Pages. Necesito el archivo README.md con:
- Descripción breve del proyecto
- Stack tecnológico
- Instrucciones de setup:
  1. Crear proyecto en Supabase
  2. Ejecutar schema.sql
  3. Crear los dos usuarios
  4. Configurar config.js con las credenciales
  5. Publicar en GitHub Pages
- Nota sobre el allowed origins de Supabase
En español.
```

### Parte D — Prueba final

1. Abre la URL de GitHub Pages en tu navegador
2. Prueba login con ambas cuentas
3. Registra una transacción desde cada cuenta y verifica:
   - Los datos del hogar se ven en ambas cuentas
   - Los datos personales solo los ve quien los registró
4. Desde el celular: abre la URL → **Agregar a pantalla de inicio**

---

### 🧪 Testeo — checklist final

- [ ] La app está accesible en la URL de GitHub Pages
- [ ] El login funciona desde el navegador móvil
- [ ] Los datos del hogar se sincronizan entre ambas cuentas
- [ ] Los datos personales son privados entre cuentas
- [ ] La app se puede agregar a la pantalla de inicio del celular
- [ ] Sin errores en la consola del navegador (F12)
- [ ] README.md está en el repositorio

---

### 🔒 Seguridad — cierre de despliegue

```
La app está en producción. Verifica en Supabase:
1. Settings → API → Allowed origins: solo tiene el dominio de GitHub Pages
2. Authentication → Settings → Enable Signup: desactivado
3. Los dos usuarios tienen estado "Confirmed"
4. config.js en el repositorio público NO tiene las credenciales reales
   (deben estar como strings vacíos o placeholders)
```

> ✅ **Nestra está en producción.**

---

## Referencia rápida — Contexto universal

Pega este bloque **una vez al inicio de cada sesión**, antes del primer prompt.
Reemplaza `[N]` con el número de sesión.

```
Estoy construyendo Nestra, una app web de finanzas personales y en pareja.

CONTEXTO TÉCNICO:
- Stack: HTML + CSS + JavaScript puro (sin frameworks, sin bundlers)
- Backend: Supabase (PostgreSQL + PostgREST + Auth)
- Módulos JS: ES6 (import/export)
- Mobile-first, responsive
- Idioma: español peruano
- Moneda: Sol Peruano (S/)
- Formato de fechas: DD/MM/AAAA
- Formato de montos: S/ 1,200.00

USUARIOS:
- christian@nestra.app (perfil A)
- darling@nestra.app (perfil B)
- Signup público deshabilitado

PRIVACIDAD (RLS en Supabase):
- ambito='hogar' → visible para ambos usuarios autenticados
- ambito='personal' → solo el dueño (user_id = auth.uid())
- Aplica a: transacciones, metas y desafios

ESTRUCTURA DE ARCHIVOS:
nestra/index.html,
views/(login|dashboard|transaccion|historial|graficos|metas|
decisiones|resumen|prestamos|configuracion).html,
css/(base|layout|components).css,
js/(config|supabase|router|auth|db|alerts|format|export).js,
supabase/schema.sql

Sesión [N].
```

---

## Solución de problemas frecuentes

**La app muestra pantalla en blanco:**
Abre la consola (F12 → Console). Lo más común: rutas incorrectas o credenciales de Supabase mal copiadas.

**Error "Failed to fetch" al conectar con Supabase:**
Verifica que `SUPABASE_URL` y `SUPABASE_ANON_KEY` en `config.js` no tienen espacios extra.

**El login falla con credenciales correctas:**
Supabase → Authentication → Users → verifica que el usuario tiene estado "Confirmed".

**Los datos no aparecen aunque se guardaron:**
RLS puede estar bloqueando la lectura. Supabase → Table Editor → selecciona la tabla → revisa las políticas.

**Al subir a GitHub Pages la app no carga:**
Verifica que `index.html` está en la raíz del repositorio, no dentro de una subcarpeta.

**Los acentos aparecen mal en el CSV:**
La función `exportCSV` debe incluir el BOM de UTF-8 (`﻿`) al inicio. Verifica que está presente.

**La fase de seguridad reporta un hallazgo real:**
No lo ignores. Pega el hallazgo en Claude con el prompt: "Necesito corregir este problema de seguridad en [archivo]: [hallazgo]. Dame solo el fragmento de código corregido."
