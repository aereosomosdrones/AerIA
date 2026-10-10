#!/usr/bin/env python3
"""
AerIA · armado de la página.

Junta en un solo HTML (dist/aeria.html) la interfaz (app/), el motor de
análisis, los logos de Aéreo y todos los datos de datos/. Esa página es la que
se publica como artifact privado en claude.ai.

    python3 tools/construir.py            # arma dist/aeria.html
    python3 tools/construir.py --revisar  # además corre el motor en node y muestra el resumen

Requiere que datos/ esté completo (ver CLAUDE.md para regenerarlo).
"""
import base64
import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
APP = RAIZ / "app"
DATOS = RAIZ / "datos"
DIST = RAIZ / "dist"

FUENTES = {
    "finanzas": "privado/finanzas.json",
    "plan": "privado/plan2027.json",
    "modelo": "privado/modelo2027.json",
    "cotizaciones": "privado/cotizaciones.json",
    "cursos": "publico/cursos.json",
    "licitaciones": "publico/licitaciones.json",
}


def data_uri(ruta: Path) -> str:
    return "data:image/png;base64," + base64.b64encode(ruta.read_bytes()).decode()


def cargar_datos() -> dict:
    faltan = [r for r in FUENTES.values() if not (DATOS / r).exists()]
    if faltan:
        sys.exit("Faltan datos: " + ", ".join(faltan) + "\nVer CLAUDE.md → «Recuperar los datos privados».")
    paquete = {k: json.loads((DATOS / r).read_text(encoding="utf-8")) for k, r in FUENTES.items()}
    paquete["construido"] = datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")
    return paquete


def construir() -> Path:
    plantilla = (APP / "aeria.html").read_text(encoding="utf-8")
    paquete = cargar_datos()
    # «</» dentro de un <script> lo cerraría antes de tiempo
    datos_json = json.dumps(paquete, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    reemplazos = {
        "/*__CSS__*/": (APP / "aeria.css").read_text(encoding="utf-8"),
        "/*__MOTOR__*/": (APP / "motor.js").read_text(encoding="utf-8"),
        "/*__UI__*/": (APP / "ui.js").read_text(encoding="utf-8"),
        "__ISO__": data_uri(APP / "marca" / "aereo-iso-mascara.png"),
        "__WORDMARK__": data_uri(APP / "marca" / "aereo-wordmark-mascara.png"),
        "__DATOS__": datos_json,
    }
    html = plantilla
    for marca, valor in reemplazos.items():
        if marca not in html:
            sys.exit(f"La plantilla no tiene la marca {marca}")
        html = html.replace(marca, valor)
    restos = re.findall(r"__[A-Z]+__", html.split('<script id="aeria-datos"')[0])
    if restos:
        sys.exit(f"Quedaron marcas sin reemplazar: {restos}")
    DIST.mkdir(exist_ok=True)
    destino = DIST / "aeria.html"
    destino.write_text(html, encoding="utf-8")
    print(f"AerIA armada → {destino.relative_to(RAIZ)}  ({destino.stat().st_size // 1024} KB)")
    for k, r in FUENTES.items():
        d = paquete[k]
        fecha = d.get("generado_fuente") or d.get("corte") or d.get("extraido") or ""
        print(f"  {k:13s} {r:28s} {str(fecha)[:19]}")
    return destino


if __name__ == "__main__":
    construir()
    if "--revisar" in sys.argv:
        subprocess.run(["node", str(RAIZ / "tools" / "probar_motor.js")], check=True)
