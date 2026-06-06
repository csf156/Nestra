# Nestra — Guía de Arquitectura y Diseño

**País:** Perú | **Moneda:** Sol Peruano (S/) | **Versión:** 1.1 | **Actualizado:** Junio 2026

\---

## Tabla de contenidos

1. [Objetivo general](#1-objetivo-general)
2. [Stack tecnológico](#2-stack-tecnológico)
3. [Arquitectura de la solución](#3-arquitectura-de-la-solución)
4. [Modelo de privacidad y seguridad](#4-modelo-de-privacidad-y-seguridad)
5. [Estructura de la base de datos](#5-estructura-de-la-base-de-datos)
6. [Módulos principales](#6-módulos-principales)
7. [Módulos transversales](#7-módulos-transversales)
8. [Estructura financiera](#8-estructura-financiera)
9. [Sistema de alertas](#9-sistema-de-alertas)
10. [Datos iniciales](#10-datos-iniciales)
11. [Requisitos de diseño y experiencia](#11-requisitos-de-diseño-y-experiencia)
12. [Plan de construcción por fases](#12-plan-de-construcción-por-fases)
13. [Estructura de archivos del proyecto](#13-estructura-de-archivos-del-proyecto)
14. Vista de Decisiones

\---

## 1\. Objetivo general

Nestra es una aplicación web responsive para gestión financiera en pareja. Permite llevar finanzas compartidas del hogar y finanzas personales de cada miembro, vinculadas entre sí, con sincronización en tiempo real entre dispositivos.

**Principios fundacionales:**

* Costo de mantenimiento $0 — hosted en GitHub Pages o Netlify + Supabase Free Tier
* Sincronización real entre el dispositivo de cada miembro
* Privacidad individual: los registros personales son visibles únicamente para quien los creó
* Los datos del hogar son compartidos y visibles para ambos miembros
* Mobile-first, pensada para uso diario

\---

## 2\. Stack tecnológico

|Capa|Tecnología|Justificación|
|-|-|-|
|Frontend|HTML + CSS + JavaScript puro|Sin build step, carga rápida, sin dependencias pesadas|
|Gráficos|Chart.js o Recharts|Visualizaciones interactivas con buena documentación|
|Autenticación|Supabase Auth|JWT por sesión, email + contraseña, gratuito|
|Base de datos|PostgreSQL vía Supabase|Row Level Security nativo, 500 MB / 50k filas gratis|
|API|PostgREST (incluido en Supabase)|REST automático desde el esquema de base de datos|
|Hosting|GitHub Pages o Netlify|Hosting estático gratuito|
|Idioma|Español|Toda la interfaz en español peruano|
|Moneda|Sol Peruano (S/)|Sin conversión a otras monedas|

### Límites del free tier de Supabase

* 500 MB de base de datos
* 50.000 filas activas
* 2 GB de ancho de banda mensual
* Autenticación sin límite de usuarios

Estos límites son ampliamente suficientes para una app de dos personas.

\---

## 3\. Arquitectura de la solución

### Visión general

```
┌─────────────────────────────────────────────────────────┐
│                    CLIENTE (Navegador)                   │
│         HTML + CSS + JS  ·  Supabase JS SDK             │
└─────────────────────┬───────────────────────────────────┘
                      │ HTTPS + JWT
┌─────────────────────▼───────────────────────────────────┐
│                   SUPABASE                               │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ Supabase    │  │  PostgREST   │  │  PostgreSQL   │  │
│  │ Auth (JWT)  │─▶│  (API REST)  │─▶│  + RLS        │  │
│  └─────────────┘  └──────────────┘  └───────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### Flujo de uso típico

```
1. El usuario abre la app y se autentica con email + contraseña
        │
        ▼
2. Supabase Auth valida las credenciales y emite un JWT
        │
        ▼
3. La app carga el dashboard: solicita datos a PostgREST
        │
        ▼
4. PostgreSQL evalúa las políticas RLS con el JWT del usuario
        │
        ├─▶ Datos del hogar → retorna a ambos usuarios
        └─▶ Datos personales → retorna solo al dueño
        │
        ▼
5. El usuario registra una transacción desde el modal del dashboard
        │
        ▼
6. Los balances se actualizan inmediatamente en pantalla
        │
        ▼
7. El otro usuario, al abrir su app, verá los cambios del hogar
   reflejados — pero no los datos personales del primero
```

\---

## 4\. Modelo de privacidad y seguridad

### Tabla de visibilidad

|Dato|Christian ve|Darling ve|
|-|-|-|
|Transacciones del hogar|✅ Todas|✅ Todas|
|Sus propias transacciones personales|✅|✅|
|Transacciones personales del otro|❌|❌|
|Metas del hogar|✅|✅|
|Sus propias metas personales|✅|✅|
|Metas personales del otro|❌|❌|
|Dashboard hogar|✅ Completo|✅ Completo|
|Dashboard personal|Solo el suyo|Solo el suyo|
|Categorías|✅ Todas (son compartidas)|✅ Todas|
|Configuración de perfiles|✅ Ambos perfiles|✅ Ambos perfiles|

### Cómo funciona la seguridad

La protección **no depende del código del cliente** — depende de las políticas de Row Level Security en PostgreSQL, que se ejecutan en el servidor de Supabase.

**La `anon key` es segura para estar en el cliente** porque, por sí sola, no otorga acceso a ningún dato si RLS está correctamente configurado. El usuario necesita autenticarse y obtener un JWT válido para que las queries retornen datos.

**La `service\_role key` nunca debe salir del dashboard de Supabase.** Esta clave bypasea RLS completamente y no debe incluirse en ningún archivo del cliente.

### Credenciales en el código

Las credenciales se ubican en un bloque de configuración separado al inicio del archivo principal:

```javascript
// ─── CONFIGURACIÓN SUPABASE ─────────────────────────────
// Reemplaza estos valores con los de tu proyecto
const SUPABASE\_URL     = 'https://xxxx.supabase.co'
const SUPABASE\_ANON\_KEY = 'eyJh...'
// ────────────────────────────────────────────────────────
```

### Medidas de seguridad adicionales

* **RLS en todas las tablas** — ninguna tabla queda sin políticas
* **Allowed Origins restringido** — en Supabase → Settings → API, se configura solo el dominio de la app
* **Signup público deshabilitado** — solo existen dos cuentas, creadas manualmente en el dashboard de Supabase
* **No hay `service\_role key` en el cliente** — bajo ninguna circunstancia

### Autenticación

El acceso es mediante email y contraseña a través de Supabase Auth. Las dos cuentas fijas son:

* `christian@nestra.app`
* `darling@nestra.app`

El perfil activo se deriva automáticamente del usuario autenticado. No hay selector de perfil manual — para cambiar de cuenta hay que cerrar sesión e iniciar con las credenciales del otro miembro.

\---

## 5\. Estructura de la base de datos

### Tablas

#### `profiles`

Perfil de cada usuario. Uno por cuenta de Supabase Auth.

|Campo|Tipo|Descripción|
|-|-|-|
|`id`|uuid (PK)|Identificador único|
|`user\_id`|uuid (FK → auth.users)|Vincula con la cuenta de Supabase Auth|
|`nombre`|text|Nombre visible en la app (editable)|
|`aporte\_mensual\_esperado`|numeric(10,2)|Referencia para el gráfico de aporte real vs. esperado|

\---

#### `categorias`

Categorías de gasto e ingreso. Son **compartidas** — no pertenecen a un usuario específico.

|Campo|Tipo|Descripción|
|-|-|-|
|`id`|uuid (PK)|Identificador único|
|`nombre`|text|Nombre de la categoría|
|`tipo`|text|`'gasto'` o `'ingreso'`|
|`limite\_mensual`|numeric(10,2)|Límite mensual opcional. `null` = sin alerta|
|`color`|text|Color hex para gráficos (opcional)|
|`estado`|text|`'activa'` o `'archivada'`|

\---

#### `transacciones`

Registro central de todos los movimientos financieros.

|Campo|Tipo|Descripción|
|-|-|-|
|`id`|uuid (PK)|Identificador único|
|`fecha`|date|Fecha del movimiento|
|`tipo`|text|`'gasto'` o `'ingreso'`|
|`ambito`|text|`'personal'` o `'hogar'`|
|`user\_id`|uuid (FK → auth.users)|Quien registró la transacción|
|`categoria\_id`|uuid (FK → categorias)|Categoría seleccionada|
|`monto`|numeric(10,2)|Monto en S/, con 2 decimales|
|`nota`|text|Descripción libre opcional|
|`aporte\_id`|uuid|Vincula las dos mitades de un aporte al hogar|

**Política RLS:**

* `ambito = 'hogar'` → cualquier usuario autenticado puede leer y escribir
* `ambito = 'personal'` → solo el usuario cuyo `user\_id` coincide con `auth.uid()`

\---

#### `prestamos`

Extensión de transacciones para la categoría "Dinero que prestamos".

|Campo|Tipo|Descripción|
|-|-|-|
|`id`|uuid (PK)|Identificador único|
|`transaccion\_id`|uuid (FK → transacciones)|Transacción a la que pertenece|
|`deudor`|text|Nombre de quien recibió el préstamo|
|`estado`|text|`'pendiente'` o `'devuelto'`|

\---

#### `metas`

Objetivos financieros, personales o del hogar.

|Campo|Tipo|Descripción|
|-|-|-|
|`id`|uuid (PK)|Identificador único|
|`nombre`|text|Nombre descriptivo de la meta|
|`tipo`|text|`'ahorro'`, `'reduccion\_gasto'` o `'aporte\_hogar'`|
|`horizonte`|text|`'corto'`, `'mediano'` o `'largo'`|
|`ambito`|text|`'personal'` o `'hogar'`|
|`user\_id`|uuid|`null` si es del hogar; `user\_id` del dueño si es personal|
|`monto\_objetivo`|numeric(10,2)|Meta a alcanzar|
|`monto\_actual`|numeric(10,2)|Progreso actual|
|`fecha\_inicio`|date|Inicio de la meta|
|`fecha\_limite`|date|Fecha límite|
|`estado`|text|`'en\_curso'`, `'lograda'` o `'vencida'`|
|`nota`|text|Descripción libre opcional|

**Política RLS:**

* `ambito = 'hogar'` → visible para ambos usuarios
* `ambito = 'personal'` → solo el dueño (`user\\\_id = auth.uid()`)

\---

#### `Desafios`

Objetivos financieros, personales o del hogar.

|Campo|Tipo|Descripción|
|-|-|-|
|`id`|uuid (PK)|Identificador único|
|`titulo`|text|Nombre corto del desafío|
|`descripcion`|text|Detalle opcional|
|`ambito`|text|'personal' o 'hogar'|
|`user\_id`|uuid|null si es del hogar; user\_id del creador si es personal|
|`duracion\_dias`|integer|Duración del reto en días|
|`fecha\_inicio`|date|Fecha de inicio|
|`fecha\_fin`|date|Calculada: fecha\_inicio + duracion\_dias|
|`estado`|text|'activo', 'completado', 'abandonado'|
|`categoria\_id`|uuid (FK → categorias)|Categoría relacionada (opcional)|

**Política RLS:** misma lógica que metas — hogar visible para ambos, personal solo el dueño.

\---

### Política RLS principal (ejemplo)

```sql
-- Política para transacciones
CREATE POLICY "acceso\_transacciones"
ON transacciones
FOR ALL
USING (
  ambito = 'hogar'
  OR auth.uid() = user\_id
);
```

\---

## 6\. Módulos principales

La app tiene 9 vistas accesibles desde la navegación principal.

### Vista 1 — Dashboard

Pantalla de inicio. Ofrece una visión rápida y accionable del estado financiero actual.

**Contenido:**

* Balance del **hogar**: ingresos del mes − gastos del mes
* Balance **personal** del usuario autenticado: ingresos − gastos − aporte al hogar
* Últimas 5 transacciones (hogar + personal del usuario activo)
* Botón de acceso rápido para registrar una nueva transacción (modal sin salir del dashboard)
* Indicadores visuales de categorías próximas a su límite de gasto
* Progreso visual de las metas activas

\---

### Vista 2 — Registro de transacción

Accesible como modal desde el Dashboard y como vista independiente.

**Campos del formulario:**

|Campo|Descripción|
|-|-|
|Tipo|Gasto / Ingreso|
|Ámbito|Personal / Hogar|
|Categoría|Lista desplegable con opción de crear nueva al vuelo|
|Monto|En S/, con 2 decimales|
|Fecha|Por defecto: hoy|
|Nota|Descripción libre opcional|

**Campo especial para préstamos** (cuando la categoría es "Dinero que prestamos"):

* Nombre del deudor
* Estado: Pendiente / Devuelto

**Comportamiento:**

* Validación en tiempo real (monto > 0, categoría seleccionada)
* Al guardar, actualiza inmediatamente los balances del dashboard
* Alerta si el gasto supera o se acerca al límite configurado para esa categoría

\---

### Vista 3 — Historial de transacciones

Vista completa de todos los registros visibles para el usuario autenticado.

**Funcionalidades:**

* Filtros combinables: por ámbito, categoría, tipo, rango de fechas
* Búsqueda por nota o descripción
* Ordenamiento por fecha, monto o categoría
* Edición y eliminación de cualquier transacción
* Exportación a CSV

\---

### Vista 4 — Gráficos y análisis

Vista dedicada a visualizaciones del comportamiento financiero. Incluye 8 gráficos:

|#|Gráfico|Tipo|
|-|-|-|
|1|Evolución temporal|Línea o barras|
|2|Distribución por categoría|Pie / Donut con semáforo de límites|
|3|Aporte real vs. esperado|Barras comparativas por miembro|
|4|Tendencia de ahorro acumulado|Línea por mes|
|5|Mapa de calor de gastos por día|Calendario mensual|
|6|Flujo de caja mensual|Waterfall / Cascada|
|7|Comparativa mes a mes por categoría|Barras agrupadas|
|8|Proyección de metas|Línea con forecast punteado|

**Semáforo de categorías:**

* Verde — por debajo del 80% del límite
* Amarillo — entre el 80% y 100% del límite
* Rojo — supera el 100% del límite

\---

### Vista 5 — Metas financieras

Definición y seguimiento de objetivos.

**Tipos de meta:**

* Ahorro: alcanzar un monto objetivo
* Reducción de gasto: no superar X en una categoría durante un período
* Aporte al hogar: comprometerse a un monto mensual

**Horizontes:** corto (hasta 3 meses), mediano (3–12 meses), largo (más de 12 meses)

**Por cada meta:** nombre, tipo, horizonte, monto objetivo, monto actual, fecha límite, ámbito, barra de progreso, estado.

\---

### Vista 6 — Resumen mensual

Cierre y revisión de un mes específico.

**Contenido:**

* Selector de mes a revisar
* Resumen del hogar: ingresos, gastos, balance neto
* Resumen personal de cada miembro (el propio para quien revisa): ingresos, gastos, aporte realizado, balance neto
* Tabla de gastos por categoría con comparativa vs. mes anterior
* Categorías que superaron su límite
* Metas completadas o vencidas ese mes
* Exportación del resumen a PDF o CSV

\---

### Vista 7 — Seguimiento de préstamos

Vista dedicada a la categoría "Dinero que prestamos".

**Contenido:**

* Lista de préstamos activos (estado: pendiente)
* Historial de préstamos devueltos
* Por cada préstamo: deudor, monto, fecha, quién prestó, ámbito, nota
* Botón para marcar como "Devuelto" (registra automáticamente el ingreso correspondiente)
* Total pendiente de cobro (personal y del hogar por separado)

\---

### Vista 8 — Configuración

Ajustes generales de la app.

**Secciones:**

**Perfiles:**

* Editar nombre de cada miembro
* Definir el aporte mensual esperado (referencia para el gráfico de aporte real vs. esperado)

**Categorías:**

* Lista de categorías activas
* Crear, renombrar, archivar o eliminar categorías
* Si una categoría tiene transacciones, ofrecer reasignar antes de eliminar
* Configurar límite de gasto mensual por categoría

**Preferencias:**

* Modo claro / Modo oscuro
* Idioma (español por defecto)
* Moneda (S/ por defecto)

**Datos:**

* Exportar todos los datos en JSON (respaldo completo)
* Importar datos desde respaldo JSON
* Resetear todos los datos (con confirmación explícita)

\---

### Vista 9 — Decisiones

Tres componentes en una sola vista:

* El oráculo: botón que evalúa el gasto real del mes en una categoría seleccionada vs. su límite, y emite una recomendación fundamentada en los datos reales (no aleatoria).
* Desafíos: lista de desafíos activos (personales y del hogar), formulario para crear uno nuevo (título, descripción, ámbito, duración en días, categoría relacionada opcional), y botón para marcar como completado o abandonado.
* Crear desafío: botón flotante "+" que abre un formulario con campos: nombre, ámbito (personal/hogar), categoría asociada opcional, fecha de inicio y fecha fin.
* Mensaje motivacional contextual: generado según el estado financiero real del mes — celebración si van bien, aliento si van ajustados. Se actualiza cada vez que se abre la vista.

\---

## 7\. Módulos transversales

Estos módulos operan por debajo de todas las vistas.

### Autenticación

* Implementada con Supabase Auth (email + contraseña)
* JWT emitido por sesión — sin expiración agresiva para uso cómodo desde móvil
* Dos cuentas fijas creadas manualmente; signup público deshabilitado
* El perfil activo se deriva del JWT, sin selector manual de perfil

### Sistema de alertas

Evalúa condiciones en cada carga de vista y al registrar una transacción.

Ver detalle completo en la [sección 9](#9-sistema-de-alertas).

### Mecanismo de aporte al hogar

Cuando un miembro transfiere dinero al hogar, se generan **dos transacciones vinculadas** de forma atómica:

1. **Gasto personal** para quien aporta (sale de su balance personal)
2. **Ingreso del hogar** para el balance compartido

Ambas transacciones comparten el mismo `aporte\_id`. Si se elimina una, la otra también debe eliminarse. No es posible editar solo una de las dos mitades.

### Exportación

|Formato|Contenido|Desde|
|-|-|-|
|CSV|Historial de transacciones filtrado|Vista de historial|
|PDF|Resumen mensual formateado|Vista de resumen mensual|
|JSON|Todos los datos de la app|Configuración → Datos|

\---

## 8\. Estructura financiera

### Miembros

|ID|Nombre (editable)|
|-|-|
|A|Christian|
|B|Darling|

### Lógica de vinculación entre niveles

```
INGRESO PERSONAL (registrado por A o B)
    └──► Suma al balance personal del miembro que lo registra

INGRESO DEL HOGAR (registrado por A o B)
    └──► Suma al balance del hogar (ambos se benefician)

GASTO PERSONAL (registrado por A o B)
    └──► Resta del balance personal del miembro que lo registra

GASTO DEL HOGAR (registrado por A o B)
    └──► Resta del balance del hogar compartido

APORTE AL HOGAR (registrado por A o B)
    ├──► Gasto personal para quien aporta
    └──► Ingreso del hogar para el balance compartido
         (vinculados por aporte\_id)
```

### Categorías de gasto iniciales

|#|Categoría|Límite mensual|
|-|-|-|
|1|Entretenimiento|S/ 150|
|2|Comer fuera|S/ 400|
|3|Salidas en bicicleta|S/ 150|
|4|Ahorro|Sin límite|
|5|Gastos hormiga|S/ 100|
|6|Ganjah|S/ 100|
|7|Partes de bicicleta|S/ 150|
|8|Artículos del hogar|S/ 150|
|9|Mascotas|S/ 100|
|10|Vestimenta|S/ 150|
|11|Dinero que prestamos|Sin límite|
|12|Capital de trabajo|Sin límite|
|13|Salud y medicamentos|S/ 100|
|14|Transporte|S/ 150|
|15|Servicios del hogar|S/ 200|
|16|Mercado / Comida en casa|S/ 300|
|17|Educación|S/ 150|
|18|Belleza y cuidado personal|S/ 100|
|19|Regalos|S/ 100|
|20|Imprevistos|S/ 150|
|21|Suscripciones digitales|S/ 80|

### Categorías de ingreso iniciales

|#|Categoría|
|-|-|
|1|Trabajo|
|2|Freelance / Extra|
|3|Devolución de préstamo|
|4|Venta de artículos|
|5|Otros ingresos|

### Reglas de gestión de categorías

* Se pueden agregar nuevas categorías en cualquier momento
* Se pueden renombrar categorías existentes
* Se pueden archivar (ocultar sin borrar el historial) o eliminar categorías sin historial
* Si una categoría tiene transacciones, la app advierte antes de eliminar y ofrece reasignar

\---

## 9\. Sistema de alertas

|Trigger|Tipo|Dónde aparece|
|-|-|-|
|Gasto entre 80–99% del límite de categoría|⚠️ Suave|Dashboard + al registrar|
|Gasto supera el 100% del límite de categoría|🚨 Crítica|Dashboard + Gráficos + al registrar|
|Meta próxima a vencer (menos de 7 días)|⚠️ Suave|Dashboard + Vista de Metas|
|Meta vencida sin cumplir|🚨 Crítica|Dashboard + Vista de Metas|
|Préstamo pendiente por más de 30 días|⚠️ Suave|Dashboard + Seguimiento de Préstamos|
|Desafío activo con menos de 2 días|⚠️ Suave|Dashboard + Vista Decisiones|
|Desafío completado|✅ Positiva|Dashboard|

\---

## 10\. Datos iniciales

Al iniciar la app por primera vez se cargan los siguientes datos:

### Perfiles

```json
\[
  {
    "id": "A",
    "nombre": "Christian",
    "email": "christian@nestra.app",
    "aporte\_mensual\_esperado": 0
  },
  {
    "id": "B",
    "nombre": "Darling",
    "email": "darling@nestra.app",
    "aporte\_mensual\_esperado": 0
  }
]
```

### Metas iniciales

```json
\[
  {
    "nombre": "Fondo de emergencia",
    "tipo": "ahorro",
    "horizonte": "mediano",
    "ambito": "hogar",
    "monto\_objetivo": 2000.00,
    "fecha\_limite": "2026-12-31",
    "nota": "3 meses de gastos básicos cubiertos"
  },
  {
    "nombre": "Viaje o experiencia juntos",
    "tipo": "ahorro",
    "horizonte": "corto",
    "ambito": "hogar",
    "monto\_objetivo": 800.00,
    "fecha\_limite": "2026-09-30"
  }
]
```

### Transacciones de ejemplo (junio 2026)

|Fecha|Tipo|Ámbito|Miembro|Categoría|Monto|Nota|
|-|-|-|-|-|-|-|
|01/06|Ingreso|Personal|Christian|Trabajo|S/ 1,200.00|Sueldo de junio|
|01/06|Ingreso|Personal|Darling|Trabajo|S/ 1,000.00|Sueldo de junio|
|01/06|Gasto|Personal|Christian|Ahorro|S/ 200.00|Aporte al ahorro personal|
|02/06|Gasto|Hogar|Christian|Servicios del hogar|S/ 120.00|Internet y luz|
|02/06|Gasto|Hogar|Darling|Mercado / Comida en casa|S/ 85.00|Mercado semanal|
|03/06|Gasto|Hogar|Christian|Comer fuera|S/ 100.00|Almuerzo dominical|
|03/06|Gasto|Personal|Darling|Belleza y cuidado personal|S/ 60.00|Peluquería|
|03/06|Gasto|Hogar|Christian|Dinero que prestamos|S/ 150.00|Préstamo a Jorge (pendiente)|

\---

## 11\. Requisitos de diseño y experiencia

### Responsive y mobile-first

* Diseñado primero para móvil, adaptable a tablet y escritorio
* Navegación: barra inferior en móvil, barra lateral en escritorio
* Formularios optimizados para teclado táctil

### Tema

* Soporte para modo claro y modo oscuro
* La preferencia del sistema operativo se respeta por defecto
* El usuario puede cambiar el tema desde Configuración

### Rendimiento

* Sin dependencias de servidores externos más allá de Supabase
* Carga inicial rápida — sin framework pesado
* Las queries a Supabase solo traen los datos del mes actual en el dashboard; los históricos se cargan bajo demanda

### Accesibilidad

* Textos con contraste suficiente en ambos temas
* Formularios con etiquetas explícitas
* Navegación accesible por teclado

### Idioma y formato

* Interfaz completamente en español
* Fechas en formato DD/MM/AAAA
* Montos con símbolo S/ y dos decimales (ej. S/ 1,200.00)
* Separador de miles: coma (,) — separador decimal: punto (.)

\---

## 12\. Plan de construcción por fases

|Fase|Contenido|Entregable|
|-|-|-|
|**1 — Base**|Setup Supabase + esquema SQL + RLS + Auth + shell de la app con navegación|App funcional con login y navegación|
|**2 — Core**|Registro de transacciones + Dashboard con balances reales + mecanismo de aporte|Dashboard operativo con datos reales|
|**3 — Historial**|Vista de historial con filtros, edición y eliminación + exportación CSV|Historial completo y exportable|
|**4 — Análisis**|Los 8 gráficos de la vista de análisis|Visualizaciones funcionando|
|**5 — Metas**|Vista de metas + barra de progreso + proyección|Seguimiento de objetivos|
|**6 — Extras**|Préstamos, resumen mensual, exportación PDF/JSON, configuración completa|App completa|

### Archivos que se crean por fase

**Fase 1 — Base**
`supabase/schema.sql` → `js/config.js` → `js/supabase.js` → `js/auth.js` → `js/router.js` → `css/base.css` → `css/layout.css` → `index.html` → `views/login.html` → `views/dashboard.html` (esqueleto)

**Fase 2 — Core**
`js/db.js` → `js/format.js` → `js/alerts.js` → `css/components.css` → `views/transaccion.html` → `views/dashboard.html` (completo)

**Fase 3 — Historial**
`views/historial.html` → `js/export.js` (solo CSV)

**Fase 4 — Análisis**
`views/graficos.html`

**Fase 5 — Metas**
`views/metas.html`

**Fase 6 — Extras**
`views/prestamos.html` → `views/resumen.html` → `views/configuracion.html` → `js/export.js` (PDF + JSON) → `README.md`

### Criterio de "listo" por fase

Cada fase produce un artefacto funcional y desplegable. No se avanza a la siguiente fase hasta que la actual pasa una revisión de uso real en dispositivo móvil.

\---

## 13\. Estructura de archivos del proyecto

El proyecto tiene tres capas: base de datos (Supabase), frontend (archivos del cliente), y documentación. En total son **24 archivos**.

### Árbol completo

```
nestra/
│
├── index.html                        # Punto de entrada — login o redirect al dashboard
│
├── views/
│   ├── login.html                    # Pantalla de autenticación
│   ├── dashboard.html                # Vista 1 — balances y acceso rápido
│   ├── transaccion.html              # Vista 2 — formulario de registro (y modal)
│   ├── historial.html                # Vista 3 — lista con filtros y búsqueda
│   ├── graficos.html                 # Vista 4 — los 8 gráficos con Chart.js
│   ├── metas.html                    # Vista 5 — objetivos financieros con progreso
│   ├── resumen.html                  # Vista 6 — cierre mensual con comparativa
│   ├── prestamos.html                # Vista 7 — préstamos pendientes y devueltos

│   ├── configuracion.html            # Vista 8 — perfiles, categorías, preferencias
│   └── decisiones.html               # Vista 9 — oráculo, desafíos y mensaje motivacional
│   
│
│
├── css/
│   ├── base.css                      # Reset, variables CSS, tipografía, modo claro/oscuro
│   ├── layout.css                    # Nav inferior (móvil), nav lateral (escritorio)
│   └── components.css               # Botones, modales, formularios, tarjetas, alertas
│
├── js/
│   ├── config.js                     # SUPABASE\_URL + SUPABASE\_ANON\_KEY (único lugar)
│   ├── supabase.js                   # Inicialización del cliente Supabase
│   ├── router.js                     # Enrutador SPA — mapea URLs a vistas
│   ├── auth.js                       # Login, logout, guards de sesión
│   ├── db.js                         # Todas las queries a Supabase (CRUD por tabla)
│   ├── alerts.js                     # Motor de alertas — evalúa límites y vencimientos
│   ├── format.js                     # Formateo de montos, fechas y textos
│   └── export.js                     # CSV, PDF (resumen mensual), JSON (respaldo)
│
├── supabase/
│   └── schema.sql                    # Tablas + RLS + trigger de perfil + datos semilla
│
├── docs/
│   └── nestra-guia-arquitectura.md   # Este documento
│
└── README.md                         # Setup: cómo configurar Supabase y desplegar
```

### Descripción de cada archivo

#### Base de datos

**`supabase/schema.sql`**
El archivo más crítico del proyecto. Se ejecuta una sola vez en el editor SQL de Supabase. Contiene en orden: creación de las 5 tablas (`profiles`, `categorias`, `transacciones`, `prestamos`, `metas`), políticas RLS para cada tabla, trigger que crea un perfil automáticamente al registrar un usuario en Auth, insert de las 21 categorías de gasto y 5 de ingreso, e insert de las 2 metas iniciales del hogar.

\---

#### JavaScript

**`js/config.js`**
El único archivo donde viven las credenciales de Supabase. Dos constantes: `SUPABASE\_URL` y `SUPABASE\_ANON\_KEY`. Todos los demás módulos las importan desde aquí.

**`js/supabase.js`**
Inicializa el cliente Supabase con las credenciales de `config.js` y exporta la instancia `supabase` que usan todos los demás módulos.

**`js/router.js`**
Maneja la navegación SPA sin recargar la página. Escucha cambios de hash (`#dashboard`, `#historial`, etc.), carga la vista correspondiente en el contenedor principal, y protege rutas que requieren sesión activa.

**`js/auth.js`**
Login, logout, y verificación de sesión. Redirige al login si no hay JWT activo. Expone el `user` y `profile` actuales al resto de la app.

**`js/db.js`**
Centraliza todas las operaciones contra Supabase. Incluye funciones como `getTransacciones()`, `insertTransaccion()`, `deleteMeta()`, `getResumenMensual()`, e `insertAporteHogar()` (que crea las dos transacciones vinculadas de forma atómica). Ninguna vista hace queries directas — todo pasa por este módulo.

**`js/alerts.js`**
Se ejecuta en cada carga de vista y al guardar una transacción. Consulta los límites de categorías y el gasto del mes, evalúa las 5 condiciones de alerta definidas en la sección 9, y retorna los mensajes que el layout debe mostrar.

**`js/format.js`**
Funciones utilitarias puras sin dependencias externas: `formatMonto(1200)` → `"S/ 1,200.00"`, `formatFecha("2026-06-03")` → `"03/06/2026"`.

**`js/export.js`**
Tres funciones: `exportCSV(transacciones)` para el historial, `exportPDF(resumenMensual)` usando la API nativa del navegador (`window.print()` con estilos de impresión) para evitar dependencias externas, y `exportJSON()` para el dump completo de todas las tablas visibles.

\---

#### CSS

**`css/base.css`**
Variables CSS globales (colores, tipografía, espaciado), reset de estilos, soporte de modo claro y oscuro vía `prefers-color-scheme` y clase `.dark`.

**`css/layout.css`**
Estructura de la app: barra de navegación inferior en móvil, barra lateral en escritorio, contenedor principal de vistas. Define los breakpoints responsivos.

**`css/components.css`**
Estilos de todos los elementos reutilizables: botones, modales, formularios, tarjetas de balance, badges de alerta (⚠️ suave y 🚨 crítica), barras de progreso de metas, y tabla del historial.

\---

#### HTML — Vistas

**`index.html`**
Punto de entrada de la app. Carga los CSS, el SDK de Supabase, y los módulos JS. Contiene el contenedor principal donde el router inyecta las vistas. Redirige al login si no hay sesión o al dashboard si ya existe una.

**`views/login.html`**
Formulario de email y contraseña. Al autenticarse redirige al dashboard. Si ya hay sesión activa, no se muestra — el router redirige directamente.

**`views/dashboard.html`**
La vista más usada. Dos bloques: hogar (balance compartido del mes) y personal (balance del usuario activo). Últimas 5 transacciones combinadas. Botón flotante para abrir el modal de registro. Panel de alertas activas y progreso resumido de metas en curso.

**`views/transaccion.html`**
Formulario de registro de movimientos. Funciona como vista independiente y como contenido del modal del dashboard. Campos: tipo (gasto/ingreso), ámbito (personal/hogar), categoría con creación al vuelo, monto, fecha, nota. Muestra campos adicionales (deudor, estado) cuando la categoría seleccionada es "Dinero que prestamos".

**`views/historial.html`**
Tabla completa de transacciones visibles para el usuario activo. Filtros combinables por ámbito, categoría, tipo y rango de fechas. Búsqueda por texto libre. Ordenamiento por fecha, monto o categoría. Edición en línea y eliminación con confirmación. Botón de exportar CSV.

**`views/graficos.html`**
Carga Chart.js desde CDN. Renderiza los 8 gráficos en orden: evolución temporal, distribución por categoría con semáforo de límites, aporte real vs. esperado, ahorro acumulado, mapa de calor de gastos por día, flujo de caja mensual, comparativa mes a mes, y proyección de metas con forecast punteado.

**`views/metas.html`**
Lista de metas activas y completadas con barra de progreso, fecha límite y estado. Formulario para crear nueva meta (nombre, tipo, horizonte, monto objetivo, fecha límite, ámbito). Botones para marcar como lograda o archivar.

**`views/resumen.html`**
Selector de mes. Muestra el cierre del mes seleccionado: resumen del hogar (ingresos, gastos, balance neto), resumen personal del usuario activo, tabla de categorías con comparativa vs. mes anterior, y metas completadas o vencidas ese mes. Botón para exportar el resumen en PDF o CSV.

**`views/prestamos.html`**
Lista de préstamos pendientes con días transcurridos desde el registro. Historial de préstamos devueltos. Botón "Marcar como devuelto" que registra automáticamente el ingreso correspondiente y actualiza el estado en la tabla `prestamos`. Totales pendientes separados por ámbito (personal y hogar).

**`views/configuracion.html`**
Cuatro secciones: perfiles (editar nombre y aporte mensual esperado de cada miembro), categorías (crear, renombrar, archivar o eliminar con reasignación si tienen historial, configurar límite mensual), preferencias (modo claro/oscuro, idioma, moneda), y datos (exportar JSON completo, importar desde respaldo, resetear con confirmación explícita).

**`views/decisiones.html`**

Vista de apoyo a decisiones de gasto cotidianas. Contiene tres bloques: el oráculo financiero, que recibe una categoría o consulta libre y responde evaluando el gasto real del mes versus el límite configurado para esa categoría; los desafíos activos del usuario, mostrando tanto los personales como los del hogar con barra de progreso de días transcurridos y opciones para marcar como logrado o abandonar; y el mensaje motivacional contextual, que lee el balance del mes actual y genera un texto según el estado financiero real — no una frase genérica. El formulario para crear nuevos desafíos se abre desde un botón flotante "+" y permite definir nombre, ámbito (personal/hogar), categoría asociada opcional, y fechas de inicio y fin.

\---

#### Documentación

**`README.md`**
Instrucciones de setup del proyecto: cómo crear el proyecto en Supabase, ejecutar el `schema.sql`, configurar las credenciales en `config.js`, crear las dos cuentas de usuario manualmente, y desplegar en GitHub Pages o Netlify.

**`docs/nestra-guia-arquitectura.md`**
Este documento. Referencia completa de arquitectura, decisiones de diseño, modelo de datos, módulos, y plan de construcción.

\---

## Notas generales para el desarrollo

* La moneda siempre es S/ (Sol Peruano), sin conversión
* Los montos se manejan con 2 decimales en toda la app y en la base de datos
* Los datos se almacenan en Supabase (PostgreSQL) — la app no usa localStorage ni variables en memoria para datos persistentes
* El campo `aporte\_id` es generado automáticamente al registrar un aporte al hogar y vincula las dos transacciones resultantes
* Al eliminar un aporte, se eliminan ambas transacciones vinculadas de forma atómica
* Las categorías no tienen tipo fijo (personal/hogar); ese atributo se define en cada transacción individual

