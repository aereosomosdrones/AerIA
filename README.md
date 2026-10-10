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

- **Mando**: el briefing del día en la voz de AerIA, el estado de pasado, presente y
  futuro, las alertas (crítica, alta, oportunidad, media, baja) con qué hacer y de
  dónde sale cada una, la lista «Te ordeno» y lo que viene en 90 días.
- **Pasado**: caja diaria, adónde se fue la caja, venta por línea, egresos por
  categoría, mes a mes y los hallazgos contables.
- **Presente**: cupos vendidos por fecha, por cobrar (banco + SII), resumen comercial
  y licitaciones abiertas.
- **Comercial**: el dashboard comercial dentro de AerIA. Cotizaciones editables con
  historial y deshacer, embudo, lo ganado por mes y línea, tasa de cierre, ciclo de
  venta, pronóstico de venta B2B por mes contra el equilibrio y la meta del plan,
  «Hay que mover» (seguimientos, cierres y facturas pendientes), importador y
  exportación a CSV. Lo ganado y lo esperable de lo abierto alimentan el Futuro.
- **Futuro**: simulador 2027 con el modelo del plan, tablero mensual, el hito del
  31 de marzo y el plan completo.
- **Hablar con AerIA**: conversación con Claude. AerIA consulta los datos con
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
                probar_motor.js y probar_comercial.js (pruebas en node),
                recuperar.py (datos desde la página publicada)
datos/publico/  cursos y licitaciones (información pública)
datos/privado/  finanzas, plan 2027, modelo, agregado del dashboard y respaldo comercial — NO se suben
dist/           la página armada — NO se sube
```

El **motor** (`app/motor.js`) son funciones puras: recibe los datos y la fecha, y
devuelve KPIs, alertas, agenda, eventos y el briefing. El **módulo comercial**
(`app/comercial.js`) también es puro y se prueba con `node tools/probar_comercial.js`
(datos ficticios).

Las cotizaciones viven en la base de la página (un documento por cotización), así
que se ven y se editan igual desde cualquier dispositivo. Los montos se cuentan sin
IVA. Mientras el dashboard no esté conectado, AerIA usa su última tasa de cierre
conocida y no lanza alertas de pronóstico, para no alarmar con un pipeline incompleto. Corre en la página (así las
cuentas regresivas se recalculan cada día) y en node para probarlo.

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
python3 tools/extraer.py plan fuentes/plan2027.json          # lectura del doc en Claude Docs
python3 tools/construir.py --revisar                         # arma dist/aeria.html y muestra el análisis
```

Después se publica `dist/aeria.html` en la misma URL. El paso a paso para Claude
está en [`CLAUDE.md`](CLAUDE.md).
