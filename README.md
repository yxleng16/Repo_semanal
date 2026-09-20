# Repo Semanal — NUNU

App de una sola página (sin backend) para gestionar traspasos entre tiendas: catálogo, stock/ventas por tienda, pedidos Wholesale con su dashboard de retirada, facturación, y el **cálculo de la repo semanal** entre tiendas (Amigó, Madrid, Rambla, Valencia).

Todo se guarda en el propio navegador (`localStorage`) — no hay servidor ni base de datos.

## Repo semanal

1. En la pestaña **Repo semanal**, carga el CSV del report con el stock y las ventas del último mes de cada tienda. Las referencias Wholesale (SKU con prefijo `WH-` o nombre que empieza por `(WH)`) y las excluidas del import (por defecto, prefijo `GIFT` del envoltorio de regalo — configurable en "Reglas / Config") se omiten automáticamente. Si el report trae varias columnas de venta por tienda (p. ej. de 1 y de 3 meses), solo se autoselecciona la de 1 mes. Si el report trae también una columna de ventas online del último mes, mapéala aparte: se suma a las ventas de Amigó (ya que ese pedido sale físicamente de su almacén), así que la columna "Ventas AMI" que verás luego en la tabla es el resultado de esa suma.
2. Pulsa **Calcular sugerencias de traspaso**: por cada SKU se calcula cuánto necesita cada tienda (sus ventas del último mes más un margen mínimo — configurable en "Reglas / Config": Madrid +2uds, Rambla/Valencia +1ud) y se cubre esa necesidad encadenando orígenes con Amigó por delante, respetando el margen que cada tienda debe conservar como origen. Si la referencia es Top20 de la tienda que la necesita, se trata como una necesidad extrema (su producto más vendido) y se relaja la reserva mínima de Amigó para poder vaciarlo más. También se recalculan las columnas **Top20** por tienda (las 20 referencias más vendidas del último mes, excluyendo gift cards, envoltorios/regalo y accesorios — prefijos/palabras configurables en "Reglas / Config").
3. En la pestaña **Revisar traspasos**, comprueba y edita a mano la cantidad de cualquiera de las 12 columnas de traspaso (origen→destino). Para filtrar: pulsa "▾ filtrar" en la cabecera de una columna concreta, usa los chips AMI/MAD/RAM/VLC para ver solo los traspasos de o hacia una tienda, o marca "Mostrar solo filas con algún traspaso". Pulsa el nombre de cualquier cabecera para ordenar la tabla por esa columna (alterna ascendente/descendente). Producto y SKU quedan fijos al desplazar la tabla en horizontal — y si filtras por una tienda con los chips AMI/MAD/RAM/VLC, también se fijan sus columnas de venta y stock, justo detrás de SKU. Pulsa cualquier celda para resaltar su fila y su columna. Las columnas Top20 se pueden ocultar con un checkbox, y la cantidad se resalta en naranja cuando una misma referencia tiene más de un traspaso a la vez, o en rojo si supera el stock disponible en la tienda de origen. La caja de la tabla tiene alto acotado a la ventana, así su barra de scroll (horizontal y vertical) queda siempre a la vista cerca de la cabecera, sin tener que bajar toda la página para llegar a ella.
4. Descarga los CSV (`SKU`, `QUANTITY`) por cada movimiento origen→destino. La descarga siempre incluye todas las filas (ignora los filtros de pantalla), ya que representa el traspaso final aprobado.

Las pestañas numeradas (Catálogo, Stock & Ventas, Pedido Wholesale, Dashboard traspasos, Abastecidas) y "Pedidos guardados" llevan el prefijo **(WH)** porque pertenecen al flujo de pedidos Wholesale, distinto de la repo semanal entre tiendas físicas.

La app recuerda la última pestaña abierta y la restaura al recargar la página.

## Uso local

Sin instalación: clona el repo y abre `index.html` en el navegador.

## Despliegue

Se publica automáticamente en GitHub Pages en cada push a `main` (ver `.github/workflows/pages.yml`). Para activarlo la primera vez: **Settings → Pages → Source: GitHub Actions**.
