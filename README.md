# Repo Semanal — NUNU

App de una sola página (sin backend) para gestionar traspasos entre tiendas: catálogo, stock/ventas por tienda, pedidos Wholesale con su dashboard de retirada, facturación, y el **cálculo de la repo semanal** entre tiendas (Amigó, Madrid, Rambla, Valencia).

Todo se guarda en el propio navegador (`localStorage`) — no hay servidor ni base de datos.

## Repo semanal

1. En la pestaña **Repo semanal**, carga el CSV del report con el stock y las ventas de 1 mes de cada tienda.
2. Pulsa **Calcular sugerencias de traspaso**: por cada SKU se reparte el stock total entre tiendas según su peso de ventas, y se sugieren traspasos de la tienda con más sobrante a la que más lo necesita.
3. Revisa y ajusta a mano cualquier traspaso (cantidad, quitar, o añadir uno nuevo).
4. Descarga los CSV (`SKU`, `QUANTITY`) por cada movimiento origen→destino.

## Uso local

Sin instalación: clona el repo y abre `index.html` en el navegador.

## Despliegue

Se publica automáticamente en GitHub Pages en cada push a `main` (ver `.github/workflows/pages.yml`). Para activarlo la primera vez: **Settings → Pages → Source: GitHub Actions**.
