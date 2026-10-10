#!/usr/bin/env python3
"""
AerIA · extractores de fuentes.

Cada fuente de Aéreo entra a AerIA por un adaptador que la deja como JSON
normalizado en datos/. El motor (tools/construir.py) solo lee datos/.

    python3 tools/extraer.py finanzas  <informe.html | finanzas.json> [url del artifact]
    python3 tools/extraer.py plan      <lectura-claude-docs.json | plan.xml> [url del doc]
    python3 tools/extraer.py cursos    <carpeta del repo aereo-web>
    python3 tools/extraer.py licitaciones <licitaciones.json del radar>
    python3 tools/extraer.py comercial  <carpeta del respaldo de la colección «cotizaciones»>

Los cuatro focos:
    PASADO   finanzas      informe de cartolas, SII y Mercado Pago (artifact)
    PRESENTE cursos        fechas y cupos publicados en aereo.cl (repo aereo-web)
    COMERCIAL comercial    cotizaciones de la pestaña Comercial (se editan en la página;
                           el dashboard local se importa ahí con el extractor)
             licitaciones  radar de Mercado Público (repo licitaciones-aereo)
    FUTURO   plan          AÉREO 2027 · Plan de rentabilidad (Claude Docs)
    MARCA    la identidad visual sale de aereo-web/assets/aereo-ui.css
"""
import json
import re
import subprocess
import sys
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
# Enlace opcional a la fuente original. NUNCA escribirlo en este archivo: el repo
# es público y esos enlaces abren los informes privados de Aéreo.
URL = sys.argv[3] if len(sys.argv) > 3 else None
PUBLICO = RAIZ / "datos" / "publico"
PRIVADO = RAIZ / "datos" / "privado"


def ahora():
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def guardar(destino: Path, datos: dict):
    destino.parent.mkdir(parents=True, exist_ok=True)
    destino.write_text(json.dumps(datos, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"  → {destino.relative_to(RAIZ)}  ({destino.stat().st_size // 1024} KB)")


# --------------------------------------------------------------------------
# PASADO · finanzas
# --------------------------------------------------------------------------
def extraer_finanzas(origen: Path):
    texto = origen.read_text(encoding="utf-8")
    if origen.suffix == ".json":
        d = json.loads(texto)
    else:
        m = re.search(r'<script id="data" type="application/json">(.*?)</script>', texto, re.S)
        if not m:
            sys.exit("No encontré el bloque <script id=\"data\"> en el informe financiero.")
        d = json.loads(m.group(1))

    cats = {k: {"label": v["label"], "grupo": v["grupo"]} for k, v in d["cats"].items()}
    movs = [
        {
            "id": m["id"], "cta": m["cta"], "fecha": m["fecha"], "mes": m["mes"],
            "monto": m["monto"], "desc": m["desc"], "contra": m.get("contra") or "",
            "cat": m["cat"], "conc": m.get("conc") or "", "nota": m.get("nota") or "",
        }
        for m in d["movs"]
    ]
    compras = [
        {
            "prov": c["prov"], "folio": c["folio"], "fecha": c["fecha"], "mes": c["mes"],
            "monto": c["monto"], "pago": c["pago"], "medio": c.get("medio") or "",
            "det": c.get("det") or "",
        }
        for c in d["compras"]
    ]
    sii = [
        {
            "folio": s["folio"], "fecha": s["fecha"], "mes": s["mes"], "tipo": s["tipo"],
            "cliente": s.get("cliente") or s.get("razon") or "", "monto": s["monto"],
            "estado": s["estado"], "det": s.get("det") or "",
        }
        for s in d["sii"]
    ]
    st = d["stats"]
    salida = {
        "fuente": "Informe «Finanzas Aéreo ago–sep 2026» (artifact en claude.ai)",
        "url": URL,
        "generado_fuente": d["generado"],
        "extraido": ahora(),
        "periodo": {"desde": "2026-08-01", "hasta": "2026-09-30"},
        "cats": cats,
        "serie": d["serie"],
        "cuadratura": [
            {k: c[k] for k in ("cta", "cuenta", "desde", "hasta", "saldo_inicial", "abonos", "cargos", "saldo_cartola")}
            for c in d["cuadratura"]
        ],
        "hallazgos": d["hallazgos"],
        "ventas_prod": d["ventas_prod"],
        "precios": d["precios"],
        "cobros": st["cob"],
        "mp": st["mp"],
        "facturacion": st["sii"],
        "compras_resumen": st["compras"],
        "cofundador": st["vidal"],
        "iva_julio": st["iva_jul"],
        "caja_minima": st["min_san"],
        "dias_bajos": st["dias_bajos"],
        "conf_cat": st["conf_cat"],
        "sii": sii,
        "compras": compras,
        "movs": movs,
    }
    guardar(PRIVADO / "finanzas.json", salida)


# --------------------------------------------------------------------------
# FUTURO · plan 2027 (documento de Claude Docs)
# --------------------------------------------------------------------------
def _texto(nodo):
    return re.sub(r"\s+", " ", "".join(nodo.itertext())).strip()


def extraer_plan(origen: Path):
    crudo = origen.read_text(encoding="utf-8")
    if crudo.lstrip().startswith("{"):
        j = json.loads(crudo)
        xml = (j.get("data") or j.get("value") or {}).get("xml") or j.get("xml")
    else:
        xml = crudo
    raiz = ET.fromstring(xml)
    titulo, secciones, actual = "", [], None
    for n in raiz:
        if n.tag == "paragraph" and n.get("heading"):
            if n.get("heading") == "1":
                titulo = _texto(n)
                continue
            actual = {"titulo": _texto(n), "parrafos": [], "listas": [], "tablas": []}
            secciones.append(actual)
            continue
        if actual is None:
            continue
        if n.tag == "paragraph":
            t = _texto(n)
            if t:
                actual["parrafos"].append(t)
        elif n.tag == "list":
            actual["listas"].append([_texto(i) for i in n.iter("listItem") if _texto(i)])
        elif n.tag == "table":
            filas = [[_texto(c) for c in r.findall("cell")] for r in n.findall("row")]
            actual["tablas"].append(filas)
    salida = {
        "fuente": "AÉREO 2027 · Plan de rentabilidad (Claude Docs)",
        "url": URL,
        "extraido": ahora(),
        "titulo": titulo,
        "secciones": secciones,
    }
    guardar(PRIVADO / "plan2027.json", salida)


# --------------------------------------------------------------------------
# PRESENTE · cursos publicados en aereo.cl
# --------------------------------------------------------------------------
LEER_JS = r"""
const fs = require('fs'), vm = require('vm');
const ctx = { window: {} };
vm.createContext(ctx);
for (const f of process.argv.slice(1)) vm.runInContext(fs.readFileSync(f, 'utf8'), ctx);
process.stdout.write(JSON.stringify(ctx.window));
"""


def extraer_cursos(web: Path):
    archivos = [web / "datos" / "cursos-fechas.js", web / "datos" / "n23-fechas.js"]
    for a in archivos:
        if not a.exists():
            sys.exit(f"No encontré {a}. ¿Es la carpeta del repo aereo-web?")
    w = json.loads(subprocess.check_output(["node", "-e", LEER_JS, *map(str, archivos)]))
    max_n1, max_n23 = w.get("AEREO_CUPOS_MAX", 6), w.get("AEREO_N23_MAX", 6)
    n1 = [
        {"inicio": c["s"], "fin": c["e"], "libres": c["cupos"], "max": max_n1,
         "vendidos": max_n1 - c["cupos"], "extra": bool(c.get("extra"))}
        for c in w["AEREO_CURSOS"]
    ]
    n23 = [
        {"inicio": c["l"], "fin": c["m"], "libres": c["cupos"], "max": max_n23,
         "vendidos": max_n23 - c["cupos"]}
        for c in w["AEREO_N23"]
    ]
    commit = subprocess.run(["git", "-C", str(web), "log", "-1", "--format=%h %cI"],
                            capture_output=True, text=True).stdout.strip()
    salida = {
        "fuente": "aereo.cl · datos/cursos-fechas.js y datos/n23-fechas.js (repo aereo-web)",
        "commit": commit,
        "extraido": ahora(),
        "precios_web": {"nivel1": 149000, "nivel23": 189000, "pack": 299000},
        "meses_agotados_2026": w.get("AEREO_AGOTADOS_HISTORICOS", []),
        "nivel1": n1,
        "niveles23": n23,
    }
    guardar(PUBLICO / "cursos.json", salida)


# --------------------------------------------------------------------------
# PRESENTE · radar de licitaciones
# --------------------------------------------------------------------------
ENCAJES = [
    ("capacitacion", "Curso o capacitación",
     r"capacitaci|curso|formaci[oó]n|entrenamiento|instrucci[oó]n|credencial"),
    ("asesoria", "Asesoría AOC / DGAC", r"\baoc\b|asesor[ií]a|consultor[ií]a|regulariz"),
    ("equipo", "Compra de equipos o insumos",
     r"^adq|adquisici|compra|suministro|insumo|repuesto|accesorio|bater[ií]a|p[oó]liza|seguro|"
     r"arriendo|software|equipamiento|equipos|mantenci|reparaci"),
    ("servicio", "Servicio aéreo",
     r"servicio|fotogrametr|levantamiento|topogr|termogr|inspecci|ortofoto|ortomosaico|lidar|"
     r"fotograf|filmaci|audiovisual|cobertura|mapeo|monitoreo|plan regulador"),
]


def _encaje(item):
    """Clasifica por el NOMBRE del proceso; la descripción solo desempata si el nombre no dice nada."""
    for texto in (item.get("nombre", ""), item.get("descripcion", "")):
        texto = (texto or "").lower().strip()
        for clave, etiqueta, patron in ENCAJES:
            if re.search(patron, texto):
                return clave, etiqueta
    return "otro", "Otro"


def extraer_licitaciones(origen: Path):
    d = json.loads(origen.read_text(encoding="utf-8"))
    abiertas = []
    for i in d["items"]:
        if i.get("estado") != "abierta":
            continue
        clave, etiqueta = _encaje(i)
        abiertas.append({
            "codigo": i["codigo"], "fuente": i["fuente"], "nombre": i["nombre"],
            "organismo": i.get("organismo") or "", "region": (i.get("region") or "").strip(),
            "monto": i.get("monto") or 0, "publicada": i.get("fecha_publicacion"),
            "cierre": i.get("fecha_cierre"), "ofertas": i.get("ofertas"), "url": i.get("url"),
            "encaje": clave, "encaje_label": etiqueta,
        })
    abiertas.sort(key=lambda x: x["cierre"] or "")
    salida = {
        "fuente": "Radar de licitaciones Aéreo (repo licitaciones-aereo · docs/data/licitaciones.json)",
        "generado_fuente": d.get("generado"),
        "extraido": ahora(),
        "total_seguidas": len(d["items"]),
        "abiertas": abiertas,
    }
    guardar(PUBLICO / "licitaciones.json", salida)


# --------------------------------------------------------------------------
# COMERCIAL · respaldo de las cotizaciones que viven en la base de la página
# --------------------------------------------------------------------------
def extraer_comercial(origen: Path):
    """Arma datos/privado/comercial.json desde un respaldo de la base de la página.

    El respaldo se saca con la herramienta ArtifactData (action «list», colección
    «cotizaciones», out_dir=<carpeta>): deja un JSON por cotización en
    <carpeta>/cotizaciones/<id>.json. Las cotizaciones se editan en la página
    (pestaña Comercial); este archivo solo es el respaldo que va dentro del
    paquete y que la página muestra mientras la base no responde.
    """
    carpeta = origen / "cotizaciones" if (origen / "cotizaciones").is_dir() else origen
    if not carpeta.is_dir():
        sys.exit(f"{origen} no es una carpeta con los JSON de la colección «cotizaciones».")
    cotizaciones = []
    for f in sorted(carpeta.glob("*.json")):
        d = json.loads(f.read_text(encoding="utf-8"))
        d = d.get("data", d)  # algunos respaldos envuelven el documento
        d.setdefault("id", f.stem)
        cotizaciones.append(d)
    destino = PRIVADO / "comercial.json"
    previo = json.loads(destino.read_text(encoding="utf-8")) if destino.exists() else {}
    previo.update({"fuente": "Base de la página AerIA (colección cotizaciones)", "extraido": ahora(), "cotizaciones": cotizaciones})
    previo.setdefault("clientes", [])
    guardar(destino, previo)


ADAPTADORES = {
    "finanzas": extraer_finanzas,
    "plan": extraer_plan,
    "cursos": extraer_cursos,
    "licitaciones": extraer_licitaciones,
    "comercial": extraer_comercial,
}

if __name__ == "__main__":
    if len(sys.argv) not in (3, 4) or sys.argv[1] not in ADAPTADORES:
        print(__doc__)
        sys.exit(1)
    print(f"AerIA · extrayendo {sys.argv[1]}")
    ADAPTADORES[sys.argv[1]](Path(sys.argv[2]).expanduser().resolve())
