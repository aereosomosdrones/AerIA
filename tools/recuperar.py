#!/usr/bin/env python3
"""
AerIA · recuperar los datos privados desde la página publicada.

Los datos privados (finanzas, plan 2027, modelo, cotizaciones) no viven en este
repositorio porque es público. Viajan dentro de la página AerIA publicada en
claude.ai, en el bloque <script id="aeria-datos">. Este script los devuelve a
datos/ para poder volver a armar la página.

    python3 tools/recuperar.py <aeria.html leída del artifact>
"""
import json
import re
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
DESTINOS = {
    "finanzas": "privado/finanzas.json",
    "plan": "privado/plan2027.json",
    "modelo": "privado/modelo2027.json",
    "cotizaciones": "privado/cotizaciones.json",
    "cursos": "publico/cursos.json",
    "licitaciones": "publico/licitaciones.json",
}

if len(sys.argv) != 2:
    print(__doc__)
    sys.exit(1)

html = Path(sys.argv[1]).read_text(encoding="utf-8")
m = re.search(r'<script id="aeria-datos" type="application/json">(.*?)</script>', html, re.S)
if not m:
    sys.exit('No encontré <script id="aeria-datos"> en ese archivo.')
paquete = json.loads(m.group(1).replace("<\\/", "</"))
for clave, ruta in DESTINOS.items():
    if clave not in paquete:
        print(f"  (sin {clave})")
        continue
    destino = RAIZ / "datos" / ruta
    destino.parent.mkdir(parents=True, exist_ok=True)
    destino.write_text(json.dumps(paquete[clave], ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"  → datos/{ruta}")
print(f"Recuperado el paquete armado el {paquete.get('construido', '?')}")
