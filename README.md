# Repo Semanal — NUNU

App de una sola página (sin backend) para gestionar traspasos entre tiendas: catálogo, stock/ventas por tienda, pedidos Wholesale con su dashboard de retirada, facturación, y el **cálculo de la repo semanal** entre tiendas (Amigó, Madrid, Rambla, Valencia).

Todo se guarda en el propio navegador (`localStorage`) — no hay servidor ni base de datos.

## Repo semanal

1. En la pestaña **Repo semanal**, carga el CSV del report con el stock y las ventas de los últimos 3 meses de cada tienda. Las referencias Wholesale (SKU con prefijo `WH-` o nombre que empieza por `(WH)`) se omiten automáticamente. Si el report trae también una columna de ventas online, mapéala aparte: se suma a las ventas de Amigó, ya que ese pedido sale físicamente de su almacén.
2. Pulsa **Calcular sugerencias de traspaso**: por cada SKU se reparte el stock total entre tiendas según su peso de ventas, y se sugieren traspasos de la tienda con más sobrante a la que más lo necesita. También se recalculan las columnas **Top20** por tienda (las 20 referencias más vendidas de los últimos 3 meses, excluyendo gift cards, envoltorios/regalo y accesorios — prefijos/palabras configurables en "Reglas / Config").
3. En la pestaña **Revisar traspasos**, comprueba y edita a mano la cantidad de cualquiera de las 12 columnas de traspaso (origen→destino); pulsa el embudo ▾ de la cabecera de una columna para filtrar y ver solo las filas con movimiento en ella.
4. Descarga los CSV (`SKU`, `QUANTITY`) por cada movimiento origen→destino.

Las pestañas numeradas (Catálogo, Stock & Ventas, Pedido Wholesale, Dashboard traspasos, Abastecidas) y "Pedidos guardados" llevan el prefijo **(WH)** porque pertenecen al flujo de pedidos Wholesale, distinto de la repo semanal entre tiendas físicas.

## Uso local

Sin instalación: clona el repo y abre `index.html` en el navegador.

## Despliegue

Se publica automáticamente en GitHub Pages en cada push a `main` (ver `.github/workflows/pages.yml`). Para activarlo la primera vez: **Settings → Pages → Source: GitHub Actions**.
