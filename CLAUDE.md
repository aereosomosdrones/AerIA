# AerIA · instrucciones para Claude

AerIA es el centro de mando de Aéreo SpA (escuela de pilotos de drones, aereo.cl).
Lee cuatro focos (marca, pasado, presente, futuro), los cruza en `app/motor.js` y
los muestra en una página publicada como artifact privado:

**URL de la página: https://claude.ai/artifact/YAdA6FWFfLL7Q4F4FKe6m9**
Capacidades: `sample` (chat con Claude), `db` (estado compartido), `downloads`
(exportar CSV) y `mcp` con el servidor `host:claude_browser` (herramientas
`preview_start`, `navigate` y `get_page_text`: el navegador integrado de la app de
escritorio, para leer el dashboard comercial local). Al republicar desde otra conversación, pasar esta
URL como `url`; nunca crear otra página.

## Reglas

- **El repo es público.** Nada de `datos/privado/`, `fuentes/` ni `dist/` se sube.
  No escribir cifras privadas (saldos, RUT, montos de clientes, sueldos), nombres de
  clientes ni hallazgos concretos en código, commits ni README: el código se escribe
  genérico y el texto específico sale de los datos. Las constantes del modelo 2027
  viven en `datos/privado/modelo2027.json`.
- **Nunca escribir en el repo los enlaces a los informes de origen** (finanzas y plan
  2027): están compartidos «con cualquiera que tenga el enlace». Están en la db de la
  página, documento `config/fuentes` (`ArtifactData get`, colección `config`, id `fuentes`).
- Todo en español de Chile. Montos: `$1.234.567` o `$6,1M`.
- AerIA no inventa cifras: cada número sale de una fuente o de un cálculo sobre ella,
  y cada alerta dice su `fuente`.
- Identidad visual de aereo.cl: amarillo `#ECE31D` con borde negro y sombra dura,
  Big Shoulders Display en mayúsculas para títulos, Roboto para texto, Roboto Mono
  para etiquetas. Claro y oscuro con tokens en `app/aeria.css`.
- El análisis va en `app/motor.js` y `app/comercial.js` (funciones puras, sin DOM). La
  interfaz en `app/ui.js` y `app/ui-comercial.js`. Orden de carga en la página:
  comercial.js → motor.js → ui-comercial.js → ui.js.
- **AerIA habla simple.** El dueño no es financiero: frases cortas, tuteo, sin jerga
  (nada de B2B, pipeline, ponderado, flujo, factoring o equilibrio sin explicar; se dice
  «ventas a empresas», «lo probable», «lo que dejó la operación», «lo mínimo para no perder
  plata»). El detalle nunca se borra: se esconde detrás de pasos que se abren. Los textos en
  simple salen de `explicar()` en `motor.js` (`I.simple`: titular, resumen, temas, tareas y el
  «En simple» de cada pestaña); cada tema es una pregunta con semáforo (bien, ojo, urgente)
  que se abre en «¿Por qué?» → «¿Qué hago?» → «Ver los números». Las pestañas se llaman Hoy,
  La plata, Cursos y cobros, Ventas, 2027 y Pregúntale a AerIA (sus ids siguen siendo
  `mando`, `pasado`, `presente`, `comercial`, `futuro`, `hablar`).
- Las pruebas usan datos ficticios: el repo es público.

## Recuperar los datos privados (sesión nueva)

`datos/privado/` no está en el repo. Para reconstruirlo:

1. Leer la página publicada con la herramienta Artifact (`action: "read"`, la URL de
   arriba). El resultado indica dónde guardó el HTML completo.
2. `python3 tools/recuperar.py <ese archivo>` → escribe `datos/privado/*` y `datos/publico/*`.

## Actualizar cada fuente

| Fuente | Cómo |
|---|---|
| Pasado (finanzas) | Artifact `read` del enlace `finanzas` de `config/fuentes` → `python3 tools/extraer.py finanzas <html guardado> <enlace>` |
| Futuro (plan 2027) | Claude Docs `read` del documento indicado en `config/fuentes` (`plan_doc_id` y `plan_nodo`) → guardar la salida JSON → `python3 tools/extraer.py plan <json> <enlace>`. Si cambian cifras del modelo (costos fijos, márgenes, palancas, precios 2027), actualizar a mano `datos/privado/modelo2027.json` y comprobar con `node tools/probar_motor.js` que reproduce el resultado del plan |
| Presente (cursos) | Clonar `aereosomosdrones/aereo-web` → `python3 tools/extraer.py cursos <carpeta>` |
| Presente (licitaciones) | Clonar `aereosomosdrones/licitaciones-aereo` (público) → `python3 tools/extraer.py licitaciones <carpeta>/docs/data/licitaciones.json` |
| Comercial (cotizaciones) | Viven en la db de la página (colección `cotizaciones`). El dashboard local (`localhost:8765`, en el Mac del usuario) se sincroniza solo cuando AerIA se abre en la app de escritorio de Claude desde una conversación de Cowork: la página lo abre con el navegador integrado, lee su texto y lo importa (como mucho cada 20 minutos, o con «Sincronizar ahora»). La sincronización no pisa lo editado en AerIA ni reabre una cerrada (quedan como conflictos), y con anomalías o más de 150 cambios no escribe: deja el plan en el importador. Tras un rechazo o cancelación no reintenta sola; «Sincronizar ahora» pide antes el permiso de la página para el navegador. Si la app no deja abrir pestañas, lee la pestaña activa del navegador de Claude, pero solo si trae una tabla de cotizaciones. Fuera de la app, con el marcador «AerIA · Extraer» y el importador. Para respaldarlas en el paquete: `ArtifactData list` de la colección `cotizaciones` con `out_dir` → `python3 tools/extraer.py comercial <out_dir>` |
| Agregado del dashboard | `datos/privado/cotizaciones.json` (monto abierto y tasa de cierre al último corte conocido). Se usa solo mientras el dashboard no esté conectado |

Luego `python3 tools/construir.py --revisar` y publicar `dist/aeria.html` en la URL de arriba
(omitir `capabilities` e `icon` al republicar para conservarlos).

## Base de datos de la página (db)

| Documento | Contenido |
|---|---|
| `estado/alertas` | `{mapa: {<id alerta>: {estado: "resuelta", fecha}}}` |
| `estado/agenda` | `{mapa: {<id acción>: {hecho: true, fecha}}}` |
| `memoria/notas` | `{items: [{id, texto, fecha}]}` — la memoria de AerIA; entra al contexto del chat |
| `cotizaciones/<id>` | Una cotización: `{id, folio, cliente, rut, contacto, email, telefono, linea, descripcion, monto, monto_tipo, estado, probabilidad, fecha_cotizacion, fecha_cierre_estimada, fecha_cierre, fecha_ejecucion, proximo_seguimiento, ultimo_contacto, factura_folio, cobrada, motivo_perdida, notas, origen, evidencia, confianza, historial[], creada, actualizada}`. Escribirla siempre con `AeriaComercial.aplicar` (o el mismo formato) para que el historial y el «deshacer» funcionen |
| `estado/sync_dashboard` | La última sincronización automática con el dashboard: `{id, fecha, firma, via (tabla\|ia), url, filas, creadas, actualizadas, iguales, parecidas, ids[], fallas, conflictos[], deshecha, revisado, intento: {fecha, estado, manual, codigo, paso, mensaje, permiso, auth, soloLectura, activa}}` (`revisado`: la última lectura sin cambios; `intento`: el último intento, también los fallidos, con lo que respondió la app y en qué paso: leerlo con `ArtifactData get` para entender una falla sin ver la pantalla). Cada cambio que hizo lleva `resp: <id>` en su entrada del historial: «Deshacer la última» la revierte entera con `deshacerPor` |
| `config/fuentes` | Enlaces e ids de las fuentes privadas (escrito por Claude, no por la página). `cotizaciones_local` es la URL del dashboard que abre la sincronización |

Los ids de alertas y acciones son estables (`fin-<hallazgo>`, `lic-<código>`,
`feriado-<nivel>-<fecha>`, `vender-<nivel>-<fecha>`, `caja`, `cobrar`, `com-*`…): no
cambiarlos sin migrar `estado/*`. Los comerciales llevan lo que los dispara, para que
marcarlos no esconda el siguiente vencimiento: `com-seg-<cotización>-<próximo seguimiento
o c+último contacto>`, `com-cierre-<cotización>-<cierre estimado>`, `com-fac-<cotización>`,
`com-empujar-<cotización>`, `com-pronostico-<AAAA-MM>`, y las que agrupan varias
(`com-seguimientos-`, `com-frias-`, `com-cierres-`, `com-facturar-`, `com-cobrar-`) una
huella del grupo: si entra otra cotización al grupo, la alerta vuelve a aparecer.

Ids de cotizaciones: `f-<folio>` (importadas con folio), `q-<hash>` (sin folio),
`sii-<folio>` y `banco-*` (sembradas desde facturas y cobros), `plan-*`, `web-*` y
`n-<folio>` (sembradas desde el plan 2027, aereo.cl y el CRM de Notion). El dashboard
cuenta como «conectado» cuando al menos 3 cotizaciones vienen de él: `origen` que empieza
con «dashboard» (lo pone el importador con la casilla «Son las cotizaciones de mi
dashboard», marcada sola con el extractor) o una entrada del historial `por: "dashboard"`
(las sembradas que el dashboard actualizó). Al importar, una fila que no calza por id,
folio ni folio de factura se une a la existente con cliente parecido y el mismo monto
(±3 %, con o sin IVA): así lo sembrado no se duplica.

El historial es una pila: «deshacer» revierte la última entrada con cambios no deshecha
(la marca `deshecha: true`) y nunca la de creación. Los cambios que hace el chat llevan en
su entrada `resp` (la hora de inicio de esa respuesta); `AeriaComercial.deshacerPor(q, resp)`
revierte solo esas entradas y avisa conflicto si otra respuesta o una persona cambió la
cotización después.

Nombres parecidos (importación y cruce con el SII): si uno de los nombres dice un tipo de
institución (universidad, municipalidad, bomberos, gobierno regional, servicio de salud…),
el otro debe ser del mismo tipo.

Severidad de los hallazgos financieros: la del informe; los ids listados en
`hallazgos_criticos` de `datos/privado/modelo2027.json` suben a crítica (el código no
nombra hallazgos concretos).

## Probar

```bash
node tools/probar_motor.js 2026-10-10            # briefing, alertas, agenda, tablero, escenarios
node tools/probar_motor.js 2026-10-10 --resumen  # el contexto que recibe el chat (debe quedar bajo ~40 KB)
node tools/probar_motor.js 2026-10-10 --simple   # lo que AerIA dice en simple (Hoy y cada pestaña)
node tools/probar_comercial.js                   # pruebas del módulo comercial (datos ficticios)
python3 tools/construir.py                       # arma dist/aeria.html
```
