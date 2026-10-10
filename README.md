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
| | Dashboard de cotizaciones (local, `localhost:8765/_Dashboard`) | Cotizaciones abiertas y tasa de cierre; se importan desde la página |
| | Radar de licitaciones (`licitaciones-aereo`) | Procesos de Mercado Público y Compra Ágil sobre drones, clasificados por encaje |
| **Futuro** | «AÉREO 2027 · Plan de rentabilidad» (doc privado en Claude Docs) | Decisiones, márgenes, calendario, palancas, riesgos y tablero 2027 |

## Qué hace la página

- **Mando**: el briefing del día en la voz de AerIA, el estado de pasado, presente y
  futuro, las alertas (crítica, alta, oportunidad, media, baja) con qué hacer y de
  dónde sale cada una, la lista «Te ordeno» y lo que viene en 90 días.
- **Pasado**: caja diaria, adónde se fue la caja, venta por línea, egresos por
  categoría, mes a mes y los hallazgos contables.
- **Presente**: cupos vendidos por fecha, por cobrar (banco + SII), cotizaciones
  (con importador desde el dashboard) y licitaciones abiertas.
- **Futuro**: simulador 2027 con el modelo del plan, tablero mensual, el hito del
  31 de marzo y el plan completo.
- **Hablar con AerIA**: conversación con Claude. AerIA consulta los datos con
  herramientas (movimientos, facturas, plan, licitaciones, simulaciones,
  cotizaciones) y guarda en su **memoria** las decisiones que le pidas recordar.

Las alertas resueltas, la agenda marcada, la memoria y las cotizaciones importadas
se guardan en la base de la página y se ven igual en cualquier dispositivo.

## Cómo está hecho

```
app/            la página: aeria.html (armazón), aeria.css, ui.js (interfaz), motor.js (análisis)
app/marca/      logos de Aéreo como máscaras (se tiñen según el tema)
tools/          extraer.py (fuentes → datos/), construir.py (datos + app → dist/),
                probar_motor.js (corre el motor en node), recuperar.py (datos desde la página publicada)
datos/publico/  cursos y licitaciones (información pública)
datos/privado/  finanzas, plan 2027, modelo y cotizaciones — NO se suben (ver abajo)
dist/           la página armada — NO se sube
```

El **motor** (`app/motor.js`) son funciones puras: recibe los datos y la fecha, y
devuelve KPIs, alertas, agenda, eventos y el briefing. Corre en la página (así las
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
