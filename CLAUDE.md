# AerIA · instrucciones para Claude

AerIA es el centro de mando de Aéreo SpA (escuela de pilotos de drones, aereo.cl).
Lee cuatro focos (marca, pasado, presente, futuro), los cruza en `app/motor.js` y
los muestra en una página publicada como artifact privado:

**URL de la página: https://claude.ai/artifact/YAdA6FWFfLL7Q4F4FKe6m9**
Capacidades: `sample` (chat con Claude) y `db` (estado compartido). Al republicar
desde otra conversación, pasar esta URL como `url`; nunca crear otra página.

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
- El análisis va en `app/motor.js` (funciones puras, sin DOM). La interfaz en `app/ui.js`.

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
| Presente (cotizaciones) | El usuario las importa en la página (quedan en la db, documento `presente/cotizaciones`). Para fijarlas en el paquete: `ArtifactData get` de ese documento o `python3 tools/extraer.py cotizaciones <export.csv>` |

Luego `python3 tools/construir.py --revisar` y publicar `dist/aeria.html` en la URL de arriba
(omitir `capabilities` e `icon` al republicar para conservarlos).

## Base de datos de la página (db)

| Documento | Contenido |
|---|---|
| `estado/alertas` | `{mapa: {<id alerta>: {estado: "resuelta", fecha}}}` |
| `estado/agenda` | `{mapa: {<id acción>: {hecho: true, fecha}}}` |
| `memoria/notas` | `{items: [{id, texto, fecha}]}` — la memoria de AerIA; entra al contexto del chat |
| `presente/cotizaciones` | `{fuente, corte, items: [{cliente, monto, estado, fecha, linea, folio}]}` o `{borrado: true}` |
| `config/fuentes` | Enlaces e ids de las fuentes privadas (escrito por Claude, no por la página) |

Los ids de alertas y acciones son estables (`fin-<hallazgo>`, `lic-<código>`,
`feriado-<nivel>-<fecha>`, `vender-<nivel>-<fecha>`, `caja`, `cobrar`…): no cambiarlos
sin migrar `estado/*`.

## Probar

```bash
node tools/probar_motor.js 2026-10-10            # briefing, alertas, agenda, tablero, escenarios
node tools/probar_motor.js 2026-10-10 --resumen  # el contexto que recibe el chat (debe quedar bajo ~40 KB)
python3 tools/construir.py                       # arma dist/aeria.html
```
