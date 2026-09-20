---
name: traspaso-semanal-excel
description: Calcula las sugerencias de traspaso semanal entre las tiendas de NUNU (Amigó, Madrid, Rambla, Valencia) a partir de un Excel de stock/ventas que te pase el usuario, aplicando exactamente el mismo algoritmo y los mismos criterios de negocio ya calibrados en la app Repo_semanal (computeMovimientosParaFila / CRITERIOS_REPO_SEMANAL.md), y añade el resultado como una hoja nueva ("Traspasos") en ese mismo Excel — la misma tabla que se ve en la pestaña "Revisar traspasos" de la app/artefacto. Usa esta skill siempre que el usuario adjunte o mencione un .xlsx/.xls con stock y ventas por tienda y pida calcular traspasos, reparto entre tiendas, reposición semanal, o "lo mismo que hace la app pero en Excel" — incluso si no dice explícitamente "repo semanal" o el nombre de la skill. No uses las reglas de traspaso de memoria ni las reinventes: usa siempre el script de esta skill, que es un port literal del algoritmo ya validado.
---

# Traspaso semanal desde Excel

## Por qué existe esta skill

El algoritmo de reparto de traspasos entre tiendas (`computeMovimientosParaFila`
en `app.js`) lleva muchas rondas de calibración con ejemplos reales del
negocio — está documentado en detalle en `CRITERIOS_REPO_SEMANAL.md`, en la
raíz de este repo. Reimplementarlo de memoria o "a ojo" cada vez que el
usuario pega datos en un Excel es exactamente el tipo de error que ese
documento existe para evitar: un criterio ya acordado (p. ej. qué suelo de
protección tiene Amigó, cómo se reparte el margen entre varias tiendas
top20, cuándo se activa la "escasez real") se rompería silenciosamente.

Por eso esta skill no le pide al modelo que razone el reparto — le da un
script (`scripts/calcular_traspasos.py`) que es un port 1:1 a Python del
algoritmo JS, validado por comparación directa contra la propia app (miles
de filas sintéticas, incluyendo casos de escasez, múltiples tiendas top20 y
accesorios, con 0 discrepancias). Usa siempre el script — no repliques la
lógica de reparto a mano ni la "mejores" sobre la marcha.

## Cuándo usarla

El usuario te da un Excel con columnas de stock y/o ventas por tienda
(Amigó/Madrid/Rambla/Valencia, en cualquier variante razonable de nombre:
"Stock AMI", "Ventas Madrid 1m", "Stock_RAMBLA"...) y quiere el mismo
cálculo de traspasos que hace la app. Puede pedirlo como "calcula los
traspasos de esta semana", "aplica el reparto entre tiendas a este
Excel", "haz lo mismo que la app pero con este archivo", etc.

Si el Excel no tiene pinta de ser un reporte de stock/ventas por tienda de
NUNU (columnas irreconocibles, no hay SKU/producto), dilo y pregunta antes
de forzar el cálculo.

## Cómo usarla

1. Localiza el archivo `.xlsx` que te ha pasado el usuario (ruta local, o
   guárdalo primero si te lo ha adjuntado).
2. Ejecuta el script:

   ```bash
   python3 .claude/skills/traspaso-semanal-excel/scripts/calcular_traspasos.py "<ruta al xlsx>"
   ```

   Por defecto escribe (o sobrescribe) una hoja llamada **"Traspasos"**
   dentro del propio archivo de entrada, dejando intactas las demás hojas.
   Si el usuario prefiere no tocar el original, usa `--output otro.xlsx`
   para escribir una copia con la hoja añadida.

3. El script auto-detecta las columnas de SKU, nombre, y stock/ventas por
   tienda (primero busca nombres canónicos exactos tipo "Stock_AMIGO", y si
   no los encuentra cae a una búsqueda difusa por palabras clave, igual que
   hace la propia app al importar un CSV). Lee la salida por consola: lista
   qué columna ha mapeado a cada campo, cuántas filas ha omitido (Wholesale,
   excluidas, accesorios) y si ha encontrado valores negativos — repásalo y
   coméntaselo al usuario, no lo ocultes.
4. Si el script no puede identificar la columna de SKU o de nombre, parará
   con un error explicando qué encabezados ha visto. En ese caso, o si el
   mapeo automático de alguna columna de tienda parece incorrecto, crea un
   JSON de mapeo explícito y pásalo con `--mapping`:

   ```json
   {"sku": "Código", "nombre": "Descripción", "stock_AMIGO": "Stock Amigo", "sales_MADRID": "Ventas Madrid (mes)"}
   ```

   (solo hace falta incluir los campos que quieras forzar; el resto se
   sigue auto-detectando). Claves válidas: `sku`, `nombre`, y para cada
   tienda (`AMIGO`, `MADRID`, `RAMBLA`, `VALENCIA`) `stock_<TIENDA>` /
   `sales_<TIENDA>`, más `sales_ONLINE` (las ventas online se suman
   siempre a Amigó, igual que en la app).
5. Si el usuario ha cambiado algún valor de "Reglas/Config" en la app
   (colchones, prefijos de accesorios...) respecto a los valores por
   defecto, pásaselo con `--config config.json` (mismas claves que
   `state.config` en `app.js` — ver `DEFAULT_CONFIG` al principio del
   script para los nombres exactos).
6. Confirma al usuario qué hoja y qué archivo se han escrito, y resume lo
   más relevante del report por consola (filas omitidas, avisos, cuántos
   SKUs con traspaso sugerido). No hace falta que abras el Excel tú mismo
   para "revisarlo" salvo que el usuario lo pida — la revisión manual de
   los traspasos sugeridos es un paso deliberado del proceso (igual que en
   la app), no algo que esta skill deba saltarse.

## Qué contiene la hoja de salida

Una fila por SKU (accesorios incluidos, pero sin traspaso — ver más abajo),
ordenadas por nombre de producto, con estas columnas:

`Producto | SKU | Top20 Amigó..Valencia (SI/NO) | Stock/Ventas por tienda (Amigó, Madrid, Rambla, Valencia) | 12 columnas de traspaso (AMI→MAD, AMI→RAM, AMI→VLC, MAD→AMI, ...)`

Mismo contenido que la tabla "Revisar traspasos" de la app, sin las
columnas que solo tienen sentido en la revisión interactiva (Revisado,
Restaurar).

## Qué SKUs no reciben ningún traspaso (y por qué)

- **Accesorios** (prefijo de SKU `ACC` o "accesorio" en el nombre, por
  defecto): se reponen por un proceso totalmente distinto fuera de esta
  app — aparecen en la hoja con su stock/venta pero las 12 columnas de
  traspaso quedan a 0. No es un fallo del script.
- **Wholesale** (prefijo `WH-` o nombre que empieza por "(WH)") y
  referencias con prefijos excluidos del import (`GIFT` por defecto): se
  omiten directamente, ni siquiera aparecen en la hoja de salida — igual
  que al importar en la app.

Si el usuario pregunta por qué un SKU concreto no tiene traspaso sugerido,
revisa primero si es accesorio/Wholesale/excluido antes de asumir que es un
bug.

## Validación

El algoritmo Python de `scripts/calcular_traspasos.py` se validó frente al
original JS ejecutando la app real en un navegador headless con miles de
filas sintéticas generadas al azar (rangos normales y adversariales: stock
y ventas de 0 a 40, alta densidad de combinaciones top20 incluyendo Amigó
compitiendo con otras tiendas, escasez real, accesorios y prefijos
excluidos) — 0 discrepancias en los traspasos calculados ni en el cálculo
de Top20. Si en el futuro se cambia `computeMovimientosParaFila` en
`app.js`, este script debe actualizarse a la vez (y lo ideal es repetir esa
misma comparación aleatoria antes de dar el cambio por bueno) — nunca al
revés.

## Dependencias

El script solo necesita `openpyxl` (se instala solo con `pip install
openpyxl` si no está disponible en el entorno). No usa pandas ni ninguna
otra librería pesada.
