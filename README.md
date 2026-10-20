# AerIA

**El centro de mando de Aéreo.** AerIA lee la empresa completa —lo que ya hicimos,
lo que estamos haciendo y lo que viene—, la cruza, avisa lo que importa, ordena
las prioridades y responde preguntas con cifras y su fuente.

Página: <https://claude.ai/artifact/YAdA6FWFfLL7Q4F4FKe6m9> (privada; se abre con la
cuenta de claude.ai del dueño o de quien él comparta).

## Los cuatro focos

| Foco | Fuente | Qué aporta |
|---|---|---|
| **Marca** | `aereo-web/assets/aereo-ui.css` | Colores, tipografías (Big Shoulders, Roboto, Roboto Mono) y logos de aereo.cl |
| **Pasado** | Informe «Finanzas Aéreo ago–sep 2026» (artifact privado) | Cartolas bancarias, SII, Mercado Pago, rendiciones y los hallazgos de la revisión |
| **Presente** | `aereo-web/datos/cursos-fechas.js` y `n23-fechas.js` | Fechas y cupos vendidos de los cursos publicados |
| **Comercial** | Pestaña Comercial de AerIA + dashboard local (`localhost:8765/_Dashboard`) | Cada cotización: lo abierto, lo ganado y lo perdido; se crean y editan en AerIA y se importan desde el dashboard |
| | Radar de licitaciones (`licitaciones-aereo`) | Procesos de Mercado Público y Compra Ágil sobre drones, clasificados por encaje |
| **Futuro** | «AÉREO 2027 · Plan de rentabilidad» (doc privado en Claude Docs) | Decisiones, márgenes, calendario, palancas, riesgos y tablero 2027 |

## Qué hace la página

AerIA habla simple, como una persona que te cuenta la empresa, y el detalle se abre
paso a paso: cada tema es una pregunta («¿Cuánta plata tenemos?», «¿Quién nos debe
plata?») con un semáforo (bien, ojo, urgente) y una respuesta de una frase; debajo se
abren «¿Por qué?», «¿Qué hago?» y «Ver los números». Cada pestaña parte con un resumen
«En simple» y deja los gráficos y tablas detrás de secciones que se abren.

- **Hoy**: lo bueno y lo urgente en dos frases, lo que tienes que hacer (las llamadas y
  facturas pendientes agrupadas), seis preguntas sobre la plata, las ventas, los clientes
  por decidir, los cobros, los cursos y 2027, y más abajo todos los avisos, la lista
  completa de tareas y lo que viene en 90 días.
- **EBITDA**: un semáforo de lo que deja el negocio cada mes, antes de impuestos,
  intereses y compras de equipos (ventas cobradas − gastos de operar − el sueldo del socio
  del plan). Rojo bajo $0, amarillo hasta la meta del plan 2027 y verde sobre la meta; un
  semáforo por mes, el mes en curso sin dato hasta su cartola y 2027 al ritmo de hoy, con el
  porqué, qué hacer y los números paso a paso. Con el pre cierre del contador suma el año:
  los meses que él cubre en un bloque y después los del banco.
- **La plata**: el año según el contador (ventas, gastos, lo pagado sin documento, los
  socios y el balance), la plata día a día, adónde se fue, ventas y gastos por categoría,
  mes a mes y lo que encontró la revisión contable.
- **Cursos y cobros**: cupos vendidos por fecha, quién debe (banco + SII), resumen de
  ventas y los concursos del Estado (licitaciones) que calzan.
- **Ventas**: el dashboard comercial dentro de AerIA. Cotizaciones editables con
  historial y deshacer, «Hay que mover» (a quién llamar, qué facturar), importador y
  exportación a CSV; y detrás de «Los números de las ventas», lo que se espera vender
  cada mes contra lo mínimo para no perder plata y la meta, las etapas, lo ganado y cuánto
  se gana de lo cotizado. Lo ganado y lo probable de lo cotizado alimentan 2027.
- **2027**: cómo cerraría el año, un simulador para probar más o menos ventas, los
  números que se revisan cada mes, el día clave del 31 de marzo y el plan completo.
- **Pregúntale a AerIA**: conversación con Claude, que responde en simple. AerIA consulta los datos con
  herramientas (movimientos, facturas, plan, licitaciones, simulaciones,
  cotizaciones), **maneja el dashboard comercial** cuando se lo pides («marca la de X
  como ganada», «anota que llamé a Y») y guarda en su **memoria** las decisiones que
  le pidas recordar. Todo cambio que hace AerIA queda en el historial y se deshace
  con un clic.

## Conectar el dashboard comercial

El dashboard de cotizaciones corre en el Mac (`localhost:8765`), donde la nube no
llega. Para traerlo a AerIA:

1. En la pestaña Comercial, arrastra el botón **«AerIA · Extraer»** a la barra de
   marcadores (o copia su código).
2. Abre el dashboard y haz clic en el marcador: copia todas sus tablas y los datos
   guardados de la página.
3. Vuelve a AerIA y pega (Cmd+V). El importador reconoce las columnas, muestra qué
   se crea y qué se actualiza (no duplica) y guarda cada cambio en el historial.

También acepta CSV, TSV, JSON y tablas copiadas de Excel.

Las alertas resueltas, la agenda marcada, la memoria y las cotizaciones importadas
se guardan en la base de la página y se ven igual en cualquier dispositivo.

## Cómo está hecho

```
app/            la página: aeria.html (armazón), aeria.css, ui.js (interfaz), motor.js (análisis),
                comercial.js (lógica comercial) y ui-comercial.js (pestaña Comercial)
app/marca/      logos de Aéreo como máscaras (se tiñen según el tema)
tools/          extraer.py (fuentes → datos/), construir.py (datos + app → dist/),
                probar_motor.js y probar_comercial.js (pruebas en node), probar_contable.py,
                recuperar.py (datos desde la página publicada)
datos/publico/  cursos y licitaciones (información pública)
datos/privado/  finanzas, pre cierre del contador, plan 2027, modelo, agregado del dashboard y
                respaldo comercial — NO se suben
dist/           la página armada — NO se sube
```

El **motor** (`app/motor.js`) son funciones puras: recibe los datos y la fecha, y
devuelve KPIs, alertas, agenda, eventos y el briefing. El **módulo comercial**
(`app/comercial.js`) también es puro y se prueba con `node tools/probar_comercial.js`
(datos ficticios).

Las cotizaciones viven en la base de la página (un documento por cotización), así
que se ven y se editan igual desde cualquier dispositivo. Los montos se cuentan sin
IVA. Mientras el dashboard no esté conectado (al menos 3 cotizaciones importadas
como «dashboard»), AerIA usa su última tasa de cierre conocida y no lanza alertas de
pronóstico, para no alarmar con un pipeline incompleto. Las cotizaciones abiertas con
más de 90 días sin contacto, o viejas y sin cierre estimado, quedan «estancadas» y no
cuentan en el pronóstico. Importar no duplica: una fila se une a la cotización que ya
existe por id, folio, folio de factura o cliente parecido con el mismo monto, y solo
cambia los campos que la fila trae.

**Conexión automática con el dashboard.** El dashboard comercial corre en el Mac del
usuario (`localhost`), que la nube no alcanza. Cuando AerIA se abre en la app de
escritorio de Claude, la página usa el navegador integrado de la app (capacidad `mcp`,
servidor `host:claude_browser`) para abrir el dashboard, leer su texto y convertirlo en
filas (directo si viene como tabla, o con Claude si no). Lo importa con el mismo plan del
importador, marca cada cambio con la sincronización y se puede deshacer entera. Lo que
se editó en AerIA (a mano o con el chat) no se pisa y una cotización cerrada no vuelve
a abierta sola: quedan como conflictos a la vista. Si la lectura se ve rara (un cliente
que parece encabezado, un monto que salta más de la mitad, filas que Claude devolvió y
no están en la página) o hay más de 150 cambios, no escribe nada y deja todo para
revisar en el importador. En el navegador web, sin la app, sigue el marcador
«AerIA · Extraer». Corre en la página (así las cuentas regresivas se recalculan cada
día) y en node para probarlo.

## Privacidad

Este repositorio es **público**. Las cartolas, RUT, facturas, sueldos y el plan
2027 nunca se suben: `datos/privado/`, `fuentes/` y `dist/` están en `.gitignore`.
Tampoco los enlaces a los informes de origen, porque están compartidos por enlace:
viven en la base de la página (`config/fuentes`).
La copia de trabajo de esos datos viaja dentro de la página publicada (privada) y
se recupera con `tools/recuperar.py`. Si el repositorio pasa a privado, se pueden
versionar también.

## Actualizar

```bash
python3 tools/extraer.py cursos ../aereo-web
python3 tools/extraer.py licitaciones ../licitaciones-aereo/docs/data/licitaciones.json
python3 tools/extraer.py finanzas fuentes/finanzas.html     # informe leído del artifact
python3 tools/extraer.py contable fuentes/precierre.xlsx     # pre cierre del contador (Excel)
python3 tools/extraer.py plan fuentes/plan2027.json          # lectura del doc en Claude Docs
python3 tools/construir.py --revisar                         # arma dist/aeria.html y muestra el análisis
```

Después se publica `dist/aeria.html` en la misma URL. El paso a paso para Claude
está en [`CLAUDE.md`](CLAUDE.md).
