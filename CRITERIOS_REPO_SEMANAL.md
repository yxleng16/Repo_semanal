# Criterios de reparto — Repo semanal

Este documento recoge, en un solo sitio, el criterio de negocio detrás del
cálculo de traspasos entre tiendas (`computeMovimientosParaFila` en
`app.js`). Sirve como referencia para cualquier cambio futuro sobre el
algoritmo: antes de tocarlo, lee esto para no romper un criterio ya
calibrado con ejemplos reales.

## Tiendas

`AMIGO`, `MADRID`, `RAMBLA`, `VALENCIA`. Amigó actúa como **almacén
central**: recibe toda la reposición externa y reparte desde ahí. En el
extremo ideal, Amigó debería ser la única tienda origen — por eso el
algoritmo, cuando puede elegir, prefiere menos orígenes y prefiere que sea
Amigó quien ceda antes que hacer que una tienda le devuelva stock a otra.

Las ventas online se sirven desde el almacén de Amigó, así que se suman a
sus ventas de tienda física al calcular (no son un canal aparte).

## Principio general

El reparto sigue un orden de prioridad decreciente. Cada fase usa lo que
le sobra a la anterior; nunca se compromete una fase de más prioridad para
alimentar una de menos prioridad.

1. **Top20 (casos extremos)** — la tienda para la que este SKU está entre
   sus 20 más vendidas tiene prioridad absoluta.
2. **Venta base (breakeven)** — que cada tienda normal llegue a tener
   stock ≥ su venta del último mes, repartido de forma equilibrada entre
   todas las que lo necesiten (no agotar el cupo en la primera y dejar a
   las demás sin nada).
3. **Presencia mínima** — ninguna tienda debe quedarse a stock 0 si se
   puede evitar sin bajar del suelo de Amigó, aunque esa tienda no tenga
   ninguna venta este mes.
4. **Margen extra** — colchón por encima de la venta (Madrid +2, resto
   +1), solo si de verdad ha vendido esta tienda y solo si Amigó tiene
   sobrante tras cubrir 1-3 en el resto de tiendas.
5. **Aprovechar sobrante** — ver más abajo, la fase más "opcional" de
   todas.
6. **Rescate de emergencia** — red de seguridad final, ver más abajo.

## Amigó como origen: suelos de protección

Amigó nunca debe quedarse a 0 unidades cediendo stock. Su suelo depende
del contexto:

- **Caso normal** (ayudando a una tienda normal): se protege
  `venta_Amigó + 1` unidad de margen (config `repoAmigoProtectedMargin`).
- **Ayudando a un top20 que Amigó no vende** (Amigó no tiene ese SKU en su
  propio top20): usa el suelo que sea **más permisivo** entre su reserva
  mínima top20 (`repoAmigoTop20MinStock`, por defecto 3) y su suelo normal
  — no tiene sentido retenerle stock de más solo por proteger un SKU que
  ni siquiera vende.
- **Amigó también es top20 de ese SKU**: deja de ser un mero proveedor.
  Compite por su propio stock igual que las demás tiendas top20 (ver
  siguiente sección) — no basta con proteger su reserva mínima fija.
- **Escasez real** (ver más abajo): el suelo se relaja hasta
  `venta_Amigó - 1`, nunca por debajo de 1 unidad.

Ninguna tienda origen (Amigó incluida) puede ceder stock que **acabe de
recibir** en el mismo cálculo — solo puede ceder de su stock original
(evita cadenas "A da a B, B da a C" que en realidad esconden A→C).

## Top20 (casos extremos)

- Se procesan antes que las tiendas normales.
- Si **ninguna** de las tiendas implicadas top20 es Amigó: Amigó cede
  hacia cada destino top20 (por orden de mayor carencia) hasta su suelo
  correspondiente (ver arriba). Sin origen secundario — solo Amigó
  participa aquí; si Amigó se queda sin cupo, la tienda top20 restante cae
  al rescate de emergencia (fase 6). **Confirmado como correcto así.**
- Si Amigó **también** es top20 de ese SKU: Amigó y el resto de tiendas
  top20 de ese SKU forman un grupo que se reparte el margen
  (`stock - venta`) de forma **equitativa**: de 1 en 1, desde quien mejor
  margen tenga hacia quien peor lo tenga, hasta igualarse (o hasta que
  ceder más dejara al origen a 0). Es el mismo principio de "repartir el
  déficit" que la escasez real, aplicado al grupo top20.
  - Ejemplo confirmado: Amigó top20 (venta 8, stock 10) compite con Rambla
    top20 (venta 6, stock 0) → Amigó cede 4, quedando ambas a -2 frente a
    su venta (6 y 4 respectivamente).
- Ya **no** hay un "traspaso token" automático de 1 unidad hacia una
  tienda top20 secundaria sin necesidad real — se probó y en 2 de 3
  ejemplos reales la rechazaste.

## Tiendas normales — venta base y margen

- **Venta base**: se reparte de 1 en 1 hacia quien peor margen
  (`stock - venta`) tenga en cada momento, para no dejar a una sin nada
  mientras otra ya cubierta sigue recibiendo. Origen preferente: Amigó
  (hasta su suelo normal); si Amigó no puede, cualquier otra tienda normal
  con sobrante (hasta su propio suelo, `venta - 0` como mínimo). Amigó
  **no** reaparece como origen secundario con un suelo más laxo una vez
  agotado su cupo preferente — ya tuvo su oportunidad.
- **Presencia mínima**: si una tienda normal sigue a stock 0 tras cubrir
  la venta base de las demás (aunque ella misma no tenga venta este mes),
  recibe 1 unidad de Amigó si hay sobrante por encima de su suelo. No
  tiene sentido dejarla completamente vacía pudiendo evitarlo.
- **Margen extra**: solo para tiendas con venta > 0 este mes (nunca a una
  con venta 0, aunque su colchón teórico sea positivo). Madrid es la única
  con colchón propio "de casa" (+2 en vez de +1): lo persigue Amigó
  primero; el resto de tiendas como origen secundario solo se esfuerzan
  hasta el mínimo base (+1), nunca por el +2 completo de Madrid.

## Escasez real

Si el conjunto de tiendas "normales" (sin contar las top20 del SKU, que ya
tienen su propio tratamiento) no tiene stock total suficiente para cubrir
sus ventas totales, es una escasez real: todos los suelos de origen se
relajan 1 unidad por debajo de la venta (nunca menos de 1 unidad de
stock), para que el déficit del sistema se reparta entre todas las tiendas
en vez de que unas se queden "cómodas" mientras otras siguen muy por
debajo. En escasez real **no** se persigue ningún margen extra ni
"sobrante" — solo llegar lo más cerca posible de la venta base para todas.

## Aprovechar sobrante (roturas reales)

Cuando a Amigó le sobra stock muy por encima de lo que ya cubre el
objetivo normal, y una tienda normal **ha empezado la semana con stock 0**
(rotura real, con la venta del último mes posiblemente artificial por esa
misma rotura), se reparte ese sobrante de 1 en 1 hasta igualar niveles de
stock entre Amigó y esa tienda. No es una necesidad urgente — es "ya que
sobra, lo reparto un poco", a revisar la semana siguiente según evolucione
la venta real. Nunca baja a Amigó de su suelo normal.

**No se aplica**:
- A una tienda que ya arrancaba la semana con stock propio (aunque sea
  poco) — ahí no hay rotura real ni duda sobre el dato de venta.
- A **accesorios** (ver siguiente sección).
- A gift cards / envoltornos de regalo (mismo criterio que los excluye del
  Top20).

Ejemplo confirmado: Amigó (venta 0, stock 10) y Rambla (venta 1, stock 0,
sin accesorio) → se reparte hasta 5 (iguala el stock de las 4 tiendas).
Cualquier cifra entre el objetivo normal (2) y la igualación total (5) es
válida — no hace falta que sea exacta.

## Accesorios: sin traspaso, en absoluto

Los accesorios (prefijo de SKU `ACC` o palabra "accesorio" en el nombre —
configurable en Reglas/Config) **se reponen por un proceso totalmente
distinto**, fuera de esta app. No reciben ningún traspaso sugerido: ni
venta base, ni margen, ni sobrante. Siguen apareciendo en la tabla de
revisión con su stock/venta normales — solo su columna de traspasos queda
siempre a 0.

## Rescate de emergencia (red de seguridad final)

Cualquier tienda con venta > 0 que siga con 1 unidad de stock o menos, y
que además siga genuinamente por debajo de su propia venta (no dispara si
ya está justo en su punto de equilibrio, p. ej. 1 stock frente a 1 venta),
recibe 1 unidad desde la tienda con mejor margen — aunque eso la baje de
su propio suelo, pero nunca a 0. Se procesa por urgencia (más venta y
menos stock primero), no por el orden fijo de tiendas, para que si solo
hay origen disponible para una, no se lo quede la menos necesitada. Se
aplica siempre al final, haya habido ya otros movimientos en la fila o no.

## Explícitamente rechazado (no reintroducir sin nuevos ejemplos)

- Devolver a Amigó el stock que una tienda no necesite por baja venta —
  aumentaría los movimientos sin necesidad.
- Un "bonus" automático a la tienda con más venta absoluta cuando varias
  tiendas necesitan reparto a la vez — sobre-actúa con diferencias de
  venta pequeñas; superado por el criterio de escasez real / reparto
  equitativo entre top20.
- Traspaso "token" automático de 1 unidad a una tienda top20 secundaria
  sin necesidad real de cubrir su venta.
- Recordatorios o alertas automáticas del proceso semanal — se probó y se
  descartó explícitamente.
- Auto-descargar los CSV al calcular, sin pasar por la revisión manual —
  se prefiere mantener el paso de revisión siempre.

## Dónde vive cada número (Reglas / Config)

| Concepto | Campo config | Valor por defecto |
|---|---|---|
| Colchón de Madrid sobre su venta | `repoBufferMadrid` | 2 |
| Colchón de Rambla/Valencia sobre su venta | `repoBufferRamblaValencia` | 1 |
| Margen protegido de Amigó (caso normal) | `repoAmigoProtectedMargin` | 1 |
| Reserva mínima de Amigó (caso top20 que no vende) | `repoAmigoTop20MinStock` | 3 |
| Prefijos de SKU excluidos del import (no participan) | `repoImportExcludeSkuPrefixes` | `GIFT` |
| Prefijos de SKU de accesorios (sin traspaso) | `repoAccessorySkuPrefixes` | `ACC` |
| Palabras de nombre de accesorios (sin traspaso) | `repoAccessoryKeywords` | `accesorio` |
| Prefijos excluidos del cálculo de Top20 | `top20ExcludePrefixes` | `ACC, GC` |
| Palabras excluidas del cálculo de Top20 | `top20ExcludeKeywords` | gift card, tarjeta regalo, envoltorio, papel de regalo, bolsa de regalo, accesorio, gift wrap |

## Casos de ejemplo ya confirmados (para regresión)

Estos son los escenarios reales/sintéticos ya validados contigo, usados
como batería de pruebas antes de tocar el algoritmo (ver historial de PRs
para los scripts de test en detalle):

- 4 ejemplos de negocio originales (Ej1-4).
- 8 ejemplos SKU101-108 de la ronda de calibración por tabla.
- 2 casos reales del CSV de producción: **COL211** (Amigó ayuda a Valencia
  top20 sin bloquear por su reserva) y **BRA202-A.ROJ / "Brazalete Twin"**
  (reparto equilibrado sin que Madrid con venta 0 acapare el cupo).
- 3 casos sintéticos de esta última ronda: dos top20 compitiendo sin que
  Amigó sea top20 (**Caso B**, confirmado correcto tal cual), Amigó top20
  compitiendo con otra tienda top20 (**Caso C**, ver ejemplo arriba), y el
  umbral de "aprovechar sobrante" (**Caso A**, ver ejemplo arriba).

Cualquier cambio futuro en `computeMovimientosParaFila` debería, como
mínimo, seguir dando estos mismos resultados (o justificar explícitamente
por qué cambian).
