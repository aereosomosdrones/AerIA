/* =============================================================================
   AerIA · MÓDULO COMERCIAL

   Funciones puras sobre las cotizaciones: estados y probabilidades, embudo,
   lo ganado por mes y por línea, tasa de cierre, ciclo de venta, pronóstico
   de venta B2B por mes contra la meta del plan, alertas y acciones, cruce de
   lo ganado con las facturas del SII, y la importación desde el dashboard
   local (CSV, TSV, JSON, tablas HTML o el extractor de AerIA).

   Una cotización (documento cotizaciones/<id> en la base de la página):
   { id, folio, cliente, rut, contacto, email, telefono, linea, descripcion,
     monto, monto_tipo, estado, probabilidad, fecha_cotizacion,
     fecha_cierre_estimada, fecha_cierre, fecha_ejecucion, proximo_seguimiento,
     ultimo_contacto, factura_folio, cobrada, motivo_perdida, notas, origen,
     evidencia, confianza, historial: [{fecha, por, cambios, nota}], creada,
     actualizada }
   Se prueba en node con `node tools/probar_comercial.js`.
   ============================================================================= */
(function (raiz) {
  'use strict';

  const DIA = 86400000;

  const ESTADOS = [
    { id: 'borrador', label: 'Borrador', abierta: true, prob: 0.1 },
    { id: 'enviada', label: 'Enviada', abierta: true, prob: 0.3 },
    { id: 'negociacion', label: 'En negociación', abierta: true, prob: 0.6 },
    { id: 'ganada', label: 'Ganada', abierta: false, prob: 1 },
    { id: 'perdida', label: 'Perdida', abierta: false, prob: 0 },
    { id: 'vencida', label: 'Vencida', abierta: false, prob: 0 },
  ];
  /* b2b = cuenta para la meta B2B del plan 2027 (SENCE, empresas, instituciones,
     AOC y servicios). Los cupos de cursos abiertos van a la escuela; Flota y la
     venta de equipos son extra y no están en la meta. */
  const LINEAS = [
    { id: 'sence', label: 'SENCE', b2b: true },
    { id: 'curso_cerrado', label: 'Curso cerrado o in-company', b2b: true },
    { id: 'aoc', label: 'AOC: asesoría y certificación', b2b: true },
    { id: 'servicios', label: 'Servicios con drones', b2b: true },
    { id: 'otro', label: 'Otro B2B', b2b: true },
    { id: 'escuela', label: 'Cupos en cursos abiertos', b2b: false },
    { id: 'flota', label: 'Aéreo Flota', b2b: false },
    { id: 'venta_equipos', label: 'Venta de equipos', b2b: false },
  ];
  const CAMPOS = ['folio', 'cliente', 'rut', 'contacto', 'email', 'telefono', 'linea', 'descripcion', 'monto', 'monto_tipo',
    'estado', 'probabilidad', 'fecha_cotizacion', 'fecha_cierre_estimada', 'fecha_cierre', 'fecha_ejecucion',
    'proximo_seguimiento', 'ultimo_contacto', 'factura_folio', 'cobrada', 'motivo_perdida', 'notas', 'origen', 'evidencia', 'confianza'];
  const CAMPOS_FECHA = ['fecha_cotizacion', 'fecha_cierre_estimada', 'fecha_cierre', 'fecha_ejecucion', 'proximo_seguimiento', 'ultimo_contacto'];
  const ESTADO = Object.fromEntries(ESTADOS.map(e => [e.id, e]));
  const LINEA = Object.fromEntries(LINEAS.map(l => [l.id, l]));
  const MES3 = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

  /* ---------- utilidades ---------- */
  const plano = t => String(t == null ? '' : t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const esFecha = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
  function fecha(s) { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); }
  function iso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  const dias = (a, b) => Math.round((fecha(b) - fecha(a)) / DIA);
  function sumarDias(s, n) { const d = fecha(s); d.setDate(d.getDate() + n); return iso(d); }
  function sumarMeses(ym, n) { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
  const mesDe = s => esFecha(s) ? s.slice(0, 7) : '';
  const nombreMes = ym => MES3[Number(ym.slice(5, 7)) - 1] + ' ' + ym.slice(2, 4);
  function miles(n) { return String(Math.round(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
  const clp = n => (n < 0 ? '−' : '') + '$' + miles(n);
  const mm = n => Math.abs(n) < 1e6 ? clp(n) : (n < 0 ? '−' : '') + '$' + (Math.abs(n) / 1e6).toFixed(1).replace('.', ',') + 'M';
  const corto = (t, n) => { t = String(t || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t; };

  /* ---------- lectura de valores sueltos (importación y edición) ---------- */
  /* Toma el primer número del texto (o el que sigue al «$»), así «$1.200.000 + IVA»,
     «$1.200.000.-», «Total: $1.200.000» o «1 200 000» se leen bien. */
  const textoMonto = v => plano(v).replace(/clp|pesos/g, ' ').replace(/\b(\d{1,3})((?: \d{3})+)\b(?![.,]\d)/g, (m, a, b) => a + b.replace(/ /g, ''));
  function hallarMonto(p) {
    const re = /(\d[\d.,]*)\s*(mm|millones|millon|mill|m|k|mil)?\b/g, pesos = p.indexOf('$');
    let m, primero = null;
    while ((m = re.exec(p))) { if (!primero) primero = m; if (pesos < 0 || m.index > pesos) return m; }
    return primero;
  }
  function leerMonto(v) {
    if (typeof v === 'number') return isFinite(v) ? Math.round(v) : 0;
    const p = textoMonto(v);
    if (!p.trim()) return 0;
    const m = hallarMonto(p);
    if (!m) return 0;
    let s = m[1].replace(/[.,]+$/, '');
    const mult = !m[2] ? 1 : /^(k|mil)$/.test(m[2]) ? 1e3 : 1e6;
    // «1.234.567» (miles con punto), «1,5» (decimal con coma), «1234567.00» (decimal con punto)
    if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
    else s = s.replace(',', '.');
    const n = parseFloat(s) * (/^\s*[-−]\s*\$?\s*\d/.test(p) ? -1 : 1);
    return isFinite(n) ? Math.round(n * mult) : 0;
  }
  /* El tipo lo dice el texto pegado al número leído: «$1.200.000 neto ($1.428.000 con IVA)»
     es neto. Si no hay nada junto al número, lo que diga el texto completo (si es una sola cosa). */
  const TIPOS_MONTO = [['con_iva', /iva incl|con iva|iva inc|bruto|c\/iva|total con/], ['neto', /\+\s*iva|mas iva|neto|s\/iva|sin iva|afecto/], ['exento', /exent/]];
  function leerTipoMonto(v) {
    const p = textoMonto(v), m = hallarMonto(p);
    if (m) {
      // la señal más cercana al número, antes o después
      const despues = p.slice(m.index + m[0].length, m.index + m[0].length + 25).split(/\d/)[0];
      const antes = p.slice(Math.max(0, m.index - 15), m.index).split(/\d/).pop();
      let mejor = null;
      for (const [k, re] of TIPOS_MONTO) {
        const d = despues.search(re);
        if (d >= 0 && (!mejor || d < mejor.d)) mejor = { k, d };
        const g = new RegExp(re.source, 'g'); let x, fin = -1;
        while ((x = g.exec(antes))) fin = x.index + x[0].length;
        if (fin >= 0 && (!mejor || antes.length - fin < mejor.d)) mejor = { k, d: antes.length - fin };
      }
      if (mejor) return mejor.k;
    }
    const todos = TIPOS_MONTO.filter(([, re]) => re.test(p)).map(([k]) => k);
    return todos.length === 1 ? todos[0] : '';
  }
  const MESES = { ene: 1, jan: 1, feb: 2, mar: 3, abr: 4, apr: 4, may: 5, jun: 6, jul: 7, ago: 8, aug: 8, sep: 9, set: 9, oct: 10, nov: 11, dic: 12, dec: 12 };
  function fechaValida(y, m, d) {
    y = Number(String(y).length === 2 ? '20' + y : y); m = Number(m); d = Number(d);
    if (!(y >= 1990 && y <= 2100) || !(m >= 1 && m <= 12) || !(d >= 1 && d <= 31)) return '';
    const t = new Date(y, m - 1, d);
    return t.getMonth() === m - 1 ? iso(t) : '';
  }
  function leerFecha(v) {
    if (v == null || v === '') return '';
    if (v instanceof Date) return isNaN(v) ? '' : iso(v);
    if (typeof v === 'number') {
      if (!isFinite(v)) return '';
      if (v > 1e11) { const d = new Date(v); return isNaN(d) ? '' : iso(d); }  // milisegundos (JavaScript)
      if (v > 20000 && v < 80000) {                                         // número de serie de Excel
        const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * DIA);
        return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
      }
      return '';
    }
    const s = plano(v);
    let m;
    if ((m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s))) return fechaValida(m[1], m[2], m[3]);
    if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})(?!\d)/.exec(s))) {
      let d = m[1], mes = m[2];
      if (Number(mes) > 12 && Number(d) <= 12) [d, mes] = [mes, d];   // 9/28/2026 (orden de EE. UU.)
      return fechaValida(m[3], mes, d);
    }
    const mesDeTexto = t => MESES[t.slice(0, 3)] || 0;
    // «28 de septiembre de 2026», «28 sep 2026», «28-sep-26», «28 sept. 2026»
    if ((m = /^(\d{1,2})(?:\s+de\s+|[\s-]+)([a-z]{3,})\.?(?:\s+de\s+|[\s-]+|,\s*)(\d{4}|\d{2})(?!\d)/.exec(s)) && mesDeTexto(m[2])) return fechaValida(m[3], mesDeTexto(m[2]), m[1]);
    // «sep 28, 2026», «septiembre 28 2026»
    if ((m = /^([a-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})(?!\d)/.exec(s)) && mesDeTexto(m[1])) return fechaValida(m[3], mesDeTexto(m[1]), m[2]);
    if (/^\d{5}(\.\d+)?$/.test(s)) return leerFecha(Number(s));
    if (/^\d{12,13}$/.test(s)) return leerFecha(Number(s));
    return '';
  }
  function leerEstado(v) {
    const s = plano(v);
    if (!s) return '';
    if (ESTADO[s]) return s;
    // primero las negaciones y las esperas: «No aprobada», «Rechazada», «Sin OC», «Pendiente de OC»
    // «Aún no aprobada», «No confirmada aún», «Sin adjudicar»: todavía no se decide
    if (/\b(aun|todavia)\s+no\b|\bno\s+\w+\s+(aun|todavia)\b|\b(sin|por)\s+(adjudicar|aprobar|confirmar|decidir|resolver)\b|pendiente de (aprobacion|adjudicacion|confirmacion|respuesta)/.test(s)) return 'enviada';
    if (/\b(no|sin)\s+(fue\s+)?(aprobad|ganad|confirmad|aceptad|adjudic|vendid|exito)/.test(s)) return 'perdida';
    if (/rechaz|desist|cancelad|anulad|descartad|declin|desiert|no acept|^lost/.test(s)) return 'perdida';
    // «Ganada, pendiente de OC» es ganada; «Pendiente de OC» sola, negociación
    if (/adjudicad|ganad|aceptad|aprobad|vendid|confirmad/.test(s)) return 'ganada';
    if (/(espera|esperando|pendiente|aguardando|falta|sin|por recibir|solicitar?)\s+(de\s+)?(la\s+|una\s+)?(oc|o\.c\.?|orden de compra)\b/.test(s)) return 'negociacion';
    if (/orden de compra|\boc\b|ejecutad|pagad|cobrad|facturad|por facturar|a facturar|pendiente de pago|por cobrar|^won/.test(s)) return 'ganada';
    if (/perdid/.test(s)) return 'perdida';
    if (/vencid|expirad|caducad|sin respuesta|congelad/.test(s)) return 'vencida';
    if (/negoci|seguimiento|revisi|evaluaci|ajuste|contraoferta|reuni|calient/.test(s)) return 'negociacion';
    if (/borrador|preparaci|por enviar|no enviad|redactand/.test(s)) return 'borrador';
    if (/enviad|emitid|pendiente|abiert|presentad|cotizad|curso|nuev|contactad|espera/.test(s)) return 'enviada';
    return '';
  }
  /* Señales de que un curso es para una institución o empresa (curso cerrado, B2B)
     y no un cupo de persona en un curso abierto. */
  const INSTITUCIONAL = /funcionari|municipal|empresa|institucion|grupo|in.?company|cerrad|exclusiv|in situ|para \d+|\d+\s*(personas|participantes|alumnos|pilotos|funcionarios|trabajadores|colaboradores)|ministerio|gobierno|universidad|carabiner|ejercito|armada|bomber|minera|corporaci|fundaci|servicio (agricola|nacional|de salud)|\bspa\b|ltda|s\.a\./;
  const SERVICIO = /termogra|fotogram|levantamiento|inspecci|ortofoto|ortomosaico|filmaci|video|lidar|topogra|mapeo|servicio|vuelo|registro aereo/;
  const CURSO_FUERTE = /curso|capacitaci|nivel [123]|\bn[123]\b|credencial|in.?company/;
  const CURSO_DEBIL = /piloto|taller|formaci|entrenamiento|instrucci|pack|cupo/;   // solo si no hay señal de servicio
  function clasificarLinea(p, contexto) {
    if (/sence|otec|franquicia/.test(p)) return 'sence';
    if (/\baoc\b|asesor|certificacion de operador|dan[\s-]?151|explotador/.test(p)) return 'aoc';
    if (/flota|airdata/.test(p)) return 'flota';
    if (/venta de (dron|equipo)|compra de (dron|equipo)|suministro|bateria|repuesto/.test(p)) return 'venta_equipos';
    if (CURSO_FUERTE.test(p) || (CURSO_DEBIL.test(p) && !SERVICIO.test(p)))
      return /cupo|curso abierto|nivel 1|\bn1\b|pack/.test(contexto) && !INSTITUCIONAL.test(contexto) ? 'escuela' : 'curso_cerrado';
    if (SERVICIO.test(p)) return 'servicios';
    return '';
  }
  function leerLinea(v, texto) {
    const s = plano(v), t = plano(texto);
    if (LINEA[s]) return s;
    // la columna de línea manda; el detalle solo decide entre cupo abierto y curso cerrado
    return (s && clasificarLinea(s, s + ' ' + t)) || clasificarLinea(t, t) || (s ? 'otro' : '');
  }
  const leerCobro = v => {
    const s = plano(v); if (!s) return '';
    if (/parcial|abono/.test(s)) return 'parcial';
    if (/^(no|false|0)$|\b(no|sin)\s+(cobrad|pagad|cobro|pago)|impag|pendiente|por cobrar|por pagar/.test(s)) return 'no';
    if (/^(si|yes|true|1)$|cobrad|pagad/.test(s)) return 'si';
    return '';
  };
  /* Probabilidad en %: acepta 60, «60%», 0,6 y textos como «Alta» */
  function leerProb(v) {
    if (v === '' || v == null) return '';
    const s = plano(v);
    const txt = [[/muy alta/, 90], [/muy baja/, 10], [/alta|high/, 80], [/media|medium/, 50], [/baja|low/, 20]].find(([re]) => re.test(s));
    if (txt && !/\d/.test(s)) return txt[1];
    const n = typeof v === 'number' ? v : Number(s.replace('%', '').replace(',', '.').trim());
    if (!isFinite(n) || s === '') return '';
    const pct = n > 0 && n < 1 && !/%/.test(s) ? n * 100 : n;
    return Math.max(0, Math.min(100, Math.round(pct)));
  }
  const slug = t => plano(t).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  function hash(t) { let h = 2166136261; for (const c of String(t)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }
  const ID_AERIA = /^(f|q|sii|banco|plan|web|n)-/;
  function idPara(q) {
    if (q.id && /^[A-Za-z0-9_\-.~:@+]{1,200}$/.test(q.id)) return q.id;
    if (q.folio) return 'f-' + (slug(q.folio) || hash(q.folio));
    return 'q-' + hash([plano(q.cliente), q.monto || 0, q.fecha_cotizacion || '', plano(q.descripcion).slice(0, 40)].join('|'));
  }
  // misma normalización que idPara: dos filas con la misma clave son la misma cotización
  const claveDuplicado = q => q.folio ? 'f:' + (slug(q.folio) || hash(q.folio))
    : 'c:' + plano(q.cliente) + '|' + (q.monto || 0) + '|' + (q.fecha_cotizacion || '') + '|' + plano(q.descripcion).slice(0, 40);
  const folioN = f => { const s = String(f == null ? '' : f).trim(); return /^\d+$/.test(s) ? String(Number(s)) : plano(s); };

  /* Deja una cotización con todos sus campos y tipos en orden */
  function limpiar(q) {
    const o = {};
    for (const k of CAMPOS) o[k] = q[k] == null ? '' : q[k];
    if (!o.monto_tipo && typeof o.monto === 'string') o.monto_tipo = leerTipoMonto(o.monto);
    o.monto = leerMonto(o.monto);
    o.estado = leerEstado(o.estado) || 'enviada';
    o.linea = leerLinea(o.linea, (q.descripcion || '') + ' ' + (q.cliente || '')) || 'otro';
    o.cobrada = leerCobro(o.cobrada) || (o.cobrada === '' ? '' : 'desconocido');
    o.probabilidad = leerProb(o.probabilidad);
    for (const k of CAMPOS_FECHA) o[k] = leerFecha(o[k]);
    for (const k of ['folio', 'cliente', 'rut', 'contacto', 'email', 'telefono', 'descripcion', 'factura_folio', 'motivo_perdida', 'notas', 'origen', 'evidencia', 'confianza', 'monto_tipo']) {
      const t = String(o[k]).trim();
      // las notas crecen al final (seguimientos): si se pasan del largo, se conserva lo más nuevo
      o[k] = k === 'notas' ? t.slice(-4000) : t.slice(0, k === 'evidencia' || k === 'descripcion' ? 4000 : 300);
    }
    o.id = idPara(Object.assign({}, q, o));
    o.historial = Array.isArray(q.historial) ? q.historial.slice(-60) : [];
    o.creada = q.creada || '';
    o.actualizada = q.actualizada || '';
    return o;
  }

  /* Diferencias entre dos versiones (para el historial y el «deshacer») */
  function diferencias(antes, despues) {
    const c = {};
    for (const k of CAMPOS) {
      const a = antes ? antes[k] : '', b = despues[k];
      if (String(a == null ? '' : a) !== String(b == null ? '' : b)) c[k] = [a == null ? '' : a, b == null ? '' : b];
    }
    return c;
  }
  /* Aplica cambios y deja constancia en el historial */
  /* marca: datos extra para la entrada del historial (p. ej. {resp} = la respuesta del chat que hizo el cambio) */
  function aplicar(actual, cambios, por, nota, ahoraISO, marca) {
    const base = actual ? Object.assign({}, actual) : {};
    const nueva = limpiar(Object.assign(base, cambios, { id: actual ? actual.id : cambios.id }));
    // Fecha de cierre automática solo cuando una cotización existente PASA a ganada, perdida o vencida (y no al deshacer)
    if (actual && por !== 'deshacer' && cambios.estado && actual.estado !== nueva.estado && ['ganada', 'perdida', 'vencida'].includes(nueva.estado) && !nueva.fecha_cierre) nueva.fecha_cierre = ahoraISO.slice(0, 10);
    const dif = diferencias(actual, nueva);
    nueva.historial = (actual && actual.historial ? actual.historial : []).concat(
      Object.keys(dif).length || nota ? [Object.assign({ fecha: ahoraISO, por: por || 'usuario', cambios: dif, nota: nota || '' }, marca || {})] : []).slice(-60);
    nueva.creada = actual && actual.creada ? actual.creada : ahoraISO;
    nueva.actualizada = ahoraISO;
    return { cotizacion: nueva, cambios: dif };
  }
  /* ---------- deshacer ----------
     El historial funciona como una pila: «deshacer» revierte la última entrada con
     cambios que no esté deshecha ni sea otro «deshacer», y la marca deshecha (no la
     borra), así repetirlo sigue hacia atrás en vez de rehacer. La entrada de creación
     no se deshace: para eso está «Eliminar». */
  const esCreacion = e => !!(e && e.cambios && e.cambios.estado && e.cambios.estado[0] === '');
  const conCambios = e => !!(e && e.cambios && Object.keys(e.cambios).length);
  function ultimaDeshacible(q) {
    const h = (q && q.historial) || [];
    for (let i = h.length - 1; i >= 0; i--) {
      const e = h[i];
      if (e.deshecha || e.por === 'deshacer' || !conCambios(e)) continue;
      return esCreacion(e) ? -1 : i;
    }
    return -1;
  }
  const puedeDeshacer = q => ultimaDeshacible(q) >= 0;
  function revertir(actual, indices, nota, ahoraISO) {
    const h = (actual.historial || []).map((e, i) => indices.includes(i) ? Object.assign({}, e, { deshecha: true }) : e);
    const vuelta = {};
    // de la más nueva a la más antigua: el valor «antes» más antiguo es el que queda
    for (const i of indices.slice().sort((a, b) => b - a)) for (const [k, [a]] of Object.entries(actual.historial[i].cambios || {})) vuelta[k] = a;
    return aplicar(Object.assign({}, actual, { historial: h }), vuelta, 'deshacer', nota, ahoraISO).cotizacion;
  }
  function deshacer(actual, ahoraISO) {
    const i = ultimaDeshacible(actual);
    if (i < 0) return null;
    const e = actual.historial[i];
    return revertir(actual, [i], 'Deshace el cambio del ' + String(e.fecha || '').slice(0, 16).replace('T', ' ') + ' (' + (e.por || '?') + ')', ahoraISO);
  }
  /* Revierte de una vez lo que hizo una respuesta del chat: las entradas del historial con
     esa marca ({resp}). Devuelve {cotizacion}; {nada} si ya no queda nada suyo por revertir
     (p. ej. un reintento); {conflicto} si después hubo cambios de otra respuesta o de una
     persona; {creada} si la respuesta la creó (deshacer es borrarla). */
  function deshacerPor(actual, resp, ahoraISO) {
    const h = actual.historial || [];
    const idx = [];
    h.forEach((e, i) => { if (e.resp === resp && !e.deshecha && conCambios(e)) idx.push(i); });
    if (!idx.length) return { nada: true };
    // un «deshacer» solo revierte entradas que quedaron marcadas deshechas: el par se anula y no es conflicto
    if (h.slice(idx[0]).some(e => e.resp !== resp && !e.deshecha && e.por !== 'deshacer' && conCambios(e))) return { conflicto: true };
    if (idx.some(i => esCreacion(h[i]))) return { creada: true };
    return { cotizacion: revertir(actual, idx, 'Deshace ' + idx.length + (idx.length === 1 ? ' cambio' : ' cambios') + ' de ' + (h[idx[0]].por || 'AerIA'), ahoraISO) };
  }

  /* ---------- lectura enriquecida ---------- */
  function normalizar(q, hoy, ciclo) {
    const e = ESTADO[q.estado] || ESTADO.enviada;
    const l = LINEA[q.linea] || LINEA.otro;
    const prob = e.abierta ? (q.probabilidad !== '' && q.probabilidad != null ? Number(q.probabilidad) / 100 : e.prob) : e.prob;
    // La fecha de creación solo cuenta como cotización o contacto si la creó una persona en
    // AerIA; si vino de una siembra o de una importación, es la fecha de carga, no de contacto.
    const creador = ((q.historial || [])[0] || {}).por || '';
    const base = q.fecha_cotizacion || (/^(usuario|AerIA \(chat\))$/.test(creador) ? (q.creada || '').slice(0, 10) : '');
    const contacto = [q.ultimo_contacto, ...(q.historial || []).filter(h => /seguimiento|contacto|llam|correo|reuni/i.test(h.nota || '')).map(h => (h.fecha || '').slice(0, 10))]
      .filter(esFecha).sort().pop() || base;
    const edad = esFecha(base) ? dias(base, hoy) : null;
    const diasSinContacto = esFecha(contacto) ? dias(contacto, hoy) : null;
    let cierreEst = q.fecha_cierre_estimada;
    let cierreSupuesto = false;
    if (e.abierta && !esFecha(cierreEst)) {
      cierreEst = esFecha(base) ? sumarDias(base, Math.round(ciclo || 30)) : hoy;
      cierreSupuesto = true;
    }
    // un cierre estimado que ya pasó se cuenta este mes (y la alerta pide actualizarlo)
    if (e.abierta && cierreEst < hoy) cierreEst = hoy;
    // Estancada: sin contacto hace más de 90 días, o sin cierre estimado y más vieja que 3 ciclos
    // de venta (mínimo 90 días). No cuenta en el pronóstico ni en lo ponderado.
    const estancada = e.abierta && ((diasSinContacto != null && diasSinContacto > 90) ||
      (!esFecha(q.fecha_cierre_estimada) && edad != null && edad > Math.max(90, 3 * (ciclo || 30))));
    // valor = venta sin IVA (lo que cuenta para la meta B2B); monto queda tal como se escribió
    const valor = q.monto_tipo === 'con_iva' ? Math.round((q.monto || 0) / 1.19) : (q.monto || 0);
    return Object.assign({}, q, {
      estadoLabel: e.label, lineaLabel: l.label, b2b: l.b2b, abierta: e.abierta, prob, valor, estancada,
      ponderado: e.abierta && !estancada ? valor * prob : 0,
      edad, diasSinContacto, fechaContacto: esFecha(contacto) ? contacto : '',
      seguimientoVencido: e.abierta && esFecha(q.proximo_seguimiento) && q.proximo_seguimiento < hoy,
      cierreVencido: e.abierta && esFecha(q.fecha_cierre_estimada) && q.fecha_cierre_estimada < hoy,
      cierreEstimado: cierreEst, cierreSupuesto,
      mesCierre: e.abierta ? mesDe(cierreEst) : mesDe(q.fecha_cierre),
      sinFactura: q.estado === 'ganada' && !q.factura_folio,
      porCobrar: q.estado === 'ganada' && !!q.factura_folio && q.cobrada !== 'si',
    });
  }

  /* ---------- resumen ---------- */
  function analizar(lista, hoy, ctx) {
    ctx = ctx || {};
    const crudas = (lista || []).map(limpiar);
    // ciclo de venta histórico (días de cotización a ganada), para estimar cierres sin fecha
    const ciclos = crudas.filter(q => q.estado === 'ganada' && esFecha(q.fecha_cotizacion) && esFecha(q.fecha_cierre))
      .map(q => dias(q.fecha_cotizacion, q.fecha_cierre)).filter(d => d >= 0 && d < 400);
    const ciclo = ciclos.length ? ciclos.reduce((a, b) => a + b, 0) / ciclos.length : null;
    const qs = crudas.map(q => normalizar(q, hoy, ciclo || 30));
    const suma = (l, k) => l.reduce((a, q) => a + (q[k] || 0), 0);
    const abiertas = qs.filter(q => q.abierta), ganadas = qs.filter(q => q.estado === 'ganada');
    const perdidas = qs.filter(q => q.estado === 'perdida' || q.estado === 'vencida');
    const hace365 = sumarDias(hoy, -365);
    const cerradas12 = qs.filter(q => !q.abierta && (!esFecha(q.fecha_cierre) || q.fecha_cierre >= hace365));
    const g12 = cerradas12.filter(q => q.estado === 'ganada');
    const mesActual = hoy.slice(0, 7), anio = hoy.slice(0, 4);
    const porMes = {};
    for (const q of ganadas) { const m = mesDe(q.fecha_cierre) || 'sin fecha'; (porMes[m] = porMes[m] || { mes: m, n: 0, monto: 0, b2b: 0 }); porMes[m].n++; porMes[m].monto += q.valor; if (q.b2b) porMes[m].b2b += q.valor; }
    const porLinea = LINEAS.map(l => {
      const d = qs.filter(q => q.linea === l.id);
      const cerr = d.filter(q => !q.abierta), gan = d.filter(q => q.estado === 'ganada');
      return { id: l.id, label: l.label, b2b: l.b2b, n: d.length, abierto: suma(d.filter(q => q.abierta), 'valor'),
        ponderado: suma(d, 'ponderado'), ganado: suma(gan, 'valor'), nGanadas: gan.length,
        tasa: suma(cerr, 'valor') ? suma(gan, 'valor') / suma(cerr, 'valor') : null };
    }).filter(l => l.n);
    const clientes = {};
    for (const q of ganadas) { const k = q.cliente || '—'; clientes[k] = (clientes[k] || 0) + q.valor; }
    const conc = {};
    for (const q of abiertas) { const k = q.cliente || '—'; conc[k] = (conc[k] || 0) + q.ponderado; }
    const totalAbierto = suma(abiertas, 'valor'), totalPonderado = suma(abiertas, 'ponderado');
    const mayorCliente = Object.entries(conc).sort((a, b) => b[1] - a[1])[0] || null;
    const R = {
      hoy, total: qs.length, cotizaciones: qs, ciclo, cicloMuestra: ciclos.length,
      abiertas: { n: abiertas.length, monto: totalAbierto, ponderado: suma(abiertas, 'ponderado'), b2bPonderado: suma(abiertas.filter(q => q.b2b), 'ponderado'),
        estancadas: abiertas.filter(q => q.estancada).length, montoEstancadas: suma(abiertas.filter(q => q.estancada), 'valor') },
      ganadas: {
        n: ganadas.length, monto: suma(ganadas, 'valor'),
        mes: suma(ganadas.filter(q => mesDe(q.fecha_cierre) === mesActual), 'valor'),
        anio: suma(ganadas.filter(q => (q.fecha_cierre || '').slice(0, 4) === anio), 'valor'),
        ultimos90: suma(ganadas.filter(q => esFecha(q.fecha_cierre) && q.fecha_cierre >= sumarDias(hoy, -90)), 'valor'),
        porMes: Object.values(porMes).sort((a, b) => a.mes.localeCompare(b.mes)),
        ticket: ganadas.filter(q => q.valor > 0).length ? suma(ganadas, 'valor') / ganadas.filter(q => q.valor > 0).length : null,
        sinFactura: ganadas.filter(q => q.sinFactura), porCobrar: ganadas.filter(q => q.porCobrar),
        porEjecutar: ganadas.filter(q => esFecha(q.fecha_ejecucion) && q.fecha_ejecucion >= hoy),
        topClientes: Object.entries(clientes).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([cliente, monto]) => ({ cliente, monto })),
      },
      perdidas: { n: perdidas.length, monto: suma(perdidas, 'valor') },
      tasa: {
        monto: suma(cerradas12, 'valor') ? suma(g12, 'valor') / suma(cerradas12, 'valor') : null,
        cantidad: cerradas12.length ? g12.length / cerradas12.length : null,
        muestra: cerradas12.length,
        referencia: ctx.tasaReferencia || null,
      },
      embudo: ESTADOS.map(e => { const d = qs.filter(q => q.estado === e.id); return { id: e.id, label: e.label, n: d.length, monto: suma(d, 'valor') }; }),
      porLinea,
      concentracion: mayorCliente && totalPonderado ? { cliente: mayorCliente[0], monto: mayorCliente[1], parte: mayorCliente[1] / totalPonderado } : null,
    };
    R.clientes = ctx.clientes || [];
    R.pronostico = pronostico(qs, hoy, ctx);
    R.sii = conciliarSII(ganadas, ctx.sii || [], ctx.siiCorte);
    // Cobro: lo que diga la cotización; si no lo dice, lo que diga el SII de ese folio
    for (const q of ganadas) {
      const s = R.sii.find(x => x.id === q.id);
      q.cobroSII = s && s.como === 'registrada' ? s.cobro : '';
      q.porCobrar = !!q.factura_folio && (q.cobrada === 'no' || q.cobrada === 'parcial' || ((q.cobrada === '' || q.cobrada === 'desconocido') && q.cobroSII !== 'si'));
    }
    R.ganadas.porCobrar = ganadas.filter(q => q.porCobrar);
    R.alertas = alertas(R, hoy, ctx);
    R.acciones = acciones(R, hoy);
    R.eventos = eventos(R, hoy);
    return R;
  }

  /* Venta B2B por mes: lo ganado (por fecha de cierre) más lo esperable de lo
     abierto (monto × probabilidad, por fecha estimada de cierre). */
  function pronostico(qs, hoy, ctx) {
    const meses = ctx.meses || 6, m0 = hoy.slice(0, 7);
    const filas = [];
    for (let i = 0; i < meses; i++) {
      const mes = sumarMeses(m0, i);
      const gan = qs.filter(q => q.b2b && q.estado === 'ganada' && mesDe(q.fecha_cierre) === mes);
      const esp = qs.filter(q => q.b2b && q.abierta && !q.estancada && q.mesCierre === mes);
      const ganado = gan.reduce((a, q) => a + q.valor, 0), esperado = esp.reduce((a, q) => a + q.ponderado, 0);
      filas.push({ mes, etiqueta: nombreMes(mes), ganado, esperado, total: ganado + esperado, nGanadas: gan.length, nAbiertas: esp.length,
        meta: ctx.meta || null, equilibrio: ctx.equilibrio || null, supuestas: esp.filter(q => q.cierreSupuesto).length });
    }
    const prox3 = filas.slice(0, 3);
    return {
      meses: filas,
      promedio3: prox3.reduce((a, f) => a + f.total, 0) / Math.max(1, prox3.length),
      sinFechaEstimada: qs.filter(q => q.b2b && q.abierta && !q.estancada && q.cierreSupuesto).length,
      estancadas: qs.filter(q => q.b2b && q.estancada).length,
      mas: qs.filter(q => q.b2b && q.abierta && q.mesCierre > sumarMeses(m0, meses - 1)).reduce((a, q) => a + q.ponderado, 0),
    };
  }

  /* ---------- nombres parecidos ----------
     Palabras distintivas en común sobre las del nombre MÁS LARGO: «Municipalidad de
     San Alfa» y «… de San Beta» no calzan; «Empresa Uno» y «Empresa Uno SpA» sí.
     Además, si alguno de los dos nombra un tipo de institución (universidad,
     municipalidad, bomberos…), los dos deben ser del mismo tipo: «Universidad de X» y
     «Municipalidad de X» son clientes distintos aunque compartan la ciudad. */
  const VACIAS = new Set(['municipalidad', 'ilustre', 'i', 'de', 'del', 'la', 'las', 'los', 'el', 'y', 'spa', 'ltda', 'limitada', 'sa', 's', 'a', 'eirl', 'universidad', 'cuerpo', 'servicio', 'servicios', 'empresa', 'empresas', 'sociedad', 'comercial', 'ingenieria', 'chile', 'consultores', 'compania', 'san', 'santa', 'santo']);
  const fichas = t => Array.from(new Set(plano(t).replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length >= 3 && !VACIAS.has(w))));
  const TIPOS_INST = [['universidad', /\buniversidad|\buniv\b/], ['municipalidad', /municipal|\bmuni\b|\bilustre\b|\bi\. ?m\./], ['gobierno', /gobierno regional|\bgore\b|delegaci/],
    ['bomberos', /bomber/], ['salud', /^servicio de salud|hospital|cesfam|\bsalud\b/], ['educacion', /\bliceo|colegio|escuela\b|\binstituto\b|\bcft\b|\bip\b/],
    ['policia', /carabiner|\bpdi\b|investigaciones/], ['ffaa', /ejercito|armada|fuerza aerea|\bfach\b/], ['ministerio', /ministerio|seremi|subsecretar/],
    ['servicio', /^servicio (nacional|agricola|de vivienda|electoral|medico|civil|de impuestos)/], ['direccion', /^direccion/], ['corporacion', /corporaci/]];
  const tiposDe = t => { const p = plano(t); return new Set(TIPOS_INST.filter(([, re]) => re.test(p)).map(([k]) => k)); };
  function mismoTipo(a, b) {
    const A = tiposDe(a), B = tiposDe(b);
    if (!A.size && !B.size) return true;
    return [...A].some(k => B.has(k));
  }
  function parecido(a, b) {
    const A = new Set(fichas(a)), B = fichas(b);
    if (!A.size || !B.length || !mismoTipo(a, b)) return 0;
    return B.filter(w => A.has(w)).length / Math.max(A.size, B.length);
  }
  // todas las palabras distintivas del nombre más corto están en el otro («Empresa Alfa» ⊂ «Alfa Ingeniería Ambiental SpA»)
  function contenido(a, b) {
    const A = fichas(a), B = fichas(b);
    if (!A.length || !B.length || !mismoTipo(a, b)) return false;
    const [corto2, largo] = A.length <= B.length ? [A, new Set(B)] : [B, new Set(A)];
    return corto2.every(w => largo.has(w)) && corto2.some(w => w.length >= 5);
  }
  const rutN = r => String(r || '').replace(/[^0-9kK]/g, '').toUpperCase();
  const mismoRut = (a, b) => rutN(a).length >= 7 && rutN(a) === rutN(b);
  // diferencia relativa de montos, admitiendo que uno incluya IVA y el otro no
  function difMonto(a, b) {
    if (!a || !b) return 1;
    return Math.min(Math.abs(a - b), Math.abs(a - b * 1.19), Math.abs(a * 1.19 - b)) / Math.max(a, b);
  }
  // cobro según el SII cruzado con el banco y el registro interno («Cobrada…», «Cobro del período, facturado tarde», o «se pagó el…» en el detalle)
  const cobroSII = s => {
    const e = (s && s.estado) || '', d = (s && s.det) || '';
    if (/^cobrada|^cobro del per|factoring/i.test(e) || /se pag[oó] el \d/i.test(d)) return 'si';
    return /por cobrar|pendiente/i.test(e) ? 'no' : '';
  };

  /* Cruce de lo ganado con las facturas del SII: por RUT si ambos lo tienen, si no por
     nombre (parecido ≥ 0,6) y monto (±3 %, con o sin IVA), con la factura posterior a la
     cotización. Las sugeridas siguen pendientes hasta que el folio se anote. */
  function conciliarSII(ganadas, sii, corte) {
    const facturas = (sii || []).filter(s => !/nota de cr|anulad/i.test((s.tipo || '') + ' ' + (s.estado || '')));
    const porFolio = new Map(facturas.map(s => [folioN(s.folio), s]));
    const usadas = new Set(ganadas.filter(q => q.factura_folio).map(q => folioN(q.factura_folio)));
    const res = [];
    for (const q of ganadas) {
      if (q.factura_folio) {
        const s = porFolio.get(folioN(q.factura_folio));
        res.push({ id: q.id, folio: q.factura_folio, como: 'registrada', estadoSII: s ? s.estado : '', cobro: s ? cobroSII(s) : '' });
        continue;
      }
      if (corte && esFecha(q.fecha_cierre) && q.fecha_cierre > corte) continue; // el SII cargado no llega a esa fecha
      const desde = esFecha(q.fecha_cotizacion) ? q.fecha_cotizacion : esFecha(q.fecha_cierre) ? sumarDias(q.fecha_cierre, -15) : '';
      const cand = facturas.filter(s => !usadas.has(folioN(s.folio)) && (!desde || !esFecha(s.fecha) || s.fecha >= desde) &&
          (q.rut && s.rut ? mismoRut(q.rut, s.rut) : parecido(q.cliente, s.cliente) >= 0.6))
        .map(s => ({ s, dif: difMonto(q.monto, s.monto) }))
        .sort((a, b) => a.dif - b.dif);
      if (cand.length && cand[0].dif <= 0.03) {
        const s = cand[0].s; usadas.add(folioN(s.folio));
        res.push({ id: q.id, folio: s.folio, como: 'sugerida', cobro: cobroSII(s), estadoSII: s.estado, fechaFactura: s.fecha });
      } else res.push({ id: q.id, folio: '', como: 'sin-factura' });
    }
    return res;
  }

  /* ---------- alertas (mismo formato que motor.js) ----------
     Las alertas que agrupan varias cotizaciones llevan en el id una huella del grupo:
     si se resolvió y después entra otra cotización al grupo, vuelve a aparecer. */
  const huella = l => hash(l.map(q => q.id).sort().join('|')).slice(0, 6);
  const montoTxt = q => q.monto ? mm(q.monto) : 'monto por completar';
  // lo que hay que facturar: ganado y ejecutado en los últimos 120 días (o sin fecha), con monto y con dato confiable
  const porFacturar = (R, hoy) => R.ganadas.sinFactura.filter(q => q.monto > 0 && plano(q.confianza) !== 'baja' &&
    (!esFecha(q.fecha_ejecucion) || q.fecha_ejecucion <= hoy) && (!esFecha(q.fecha_cierre) || dias(q.fecha_cierre, hoy) <= 120));
  function alertas(R, hoy, ctx) {
    const A = [];
    const ab = R.cotizaciones.filter(q => q.abierta);
    const top = (l, n) => l.slice().sort((a, b) => (b.monto || 0) - (a.monto || 0)).slice(0, n || 5);
    const nombre = q => (q.cliente || 'Sin cliente') + (q.descripcion ? ' · ' + corto(q.descripcion, 50) : '') + ' (' + montoTxt(q) + ')';
    const seg = ab.filter(q => q.seguimientoVencido);
    if (seg.length) {
      const m = seg.reduce((a, q) => a + q.valor, 0);
      A.push({ id: 'com-seguimientos-' + huella(seg), nivel: m >= 3e6 ? 'alta' : 'media', foco: 'comercial', monto: m,
        titulo: seg.length + (seg.length === 1 ? ' cotización con el seguimiento vencido' : ' cotizaciones con el seguimiento vencido'),
        detalle: 'Las más grandes: ' + top(seg, 4).map(q => nombre(q) + ', debía ser el ' + q.proximo_seguimiento.slice(8, 10) + '-' + MES3[Number(q.proximo_seguimiento.slice(5, 7)) - 1]).join('; ') + '.',
        accion: 'Llamar o escribir hoy y anotar el resultado y la próxima fecha en Comercial.', fuente: 'Comercial' });
    }
    const frias = ab.filter(q => !q.seguimientoVencido && !esFecha(q.proximo_seguimiento) && q.diasSinContacto != null && q.diasSinContacto > 14);
    if (frias.length) {
      const m = frias.reduce((a, q) => a + q.valor, 0);
      const muy = frias.filter(q => q.diasSinContacto > 45).length;
      A.push({ id: 'com-frias-' + huella(frias), nivel: m >= 5e6 ? 'alta' : 'media', foco: 'comercial', monto: m,
        titulo: frias.length + (frias.length === 1 ? ' cotización abierta' : ' cotizaciones abiertas') + ' sin contacto hace más de 2 semanas',
        detalle: 'Suman ' + mm(m) + (muy ? '; ' + muy + ' llevan más de 45 días y probablemente estén perdidas' : '') + '. Las mayores: ' + top(frias, 4).map(q => nombre(q) + ', ' + q.diasSinContacto + ' días').join('; ') + '.',
        accion: 'Contactar las más grandes, ponerles próxima fecha de seguimiento y cerrar como perdidas las que ya no van.', fuente: 'Comercial' });
    }
    const cierres = ab.filter(q => q.cierreVencido);
    if (cierres.length) {
      const est = cierres.filter(q => q.estancada).length;
      A.push({ id: 'com-cierres-' + huella(cierres), nivel: 'media', foco: 'comercial', monto: cierres.reduce((a, q) => a + q.valor, 0),
        titulo: cierres.length + (cierres.length === 1 ? ' cotización pasó su fecha estimada de cierre' : ' cotizaciones pasaron su fecha estimada de cierre'),
        detalle: top(cierres, 5).map(q => nombre(q) + ', estimada ' + q.fecha_cierre_estimada).join('; ') + '. El pronóstico las cuenta como si cerraran este mes' +
          (est ? ', salvo ' + (est === 1 ? 'una que lleva' : est + ' que llevan') + ' más de 90 días sin contacto' : '') + '.',
        accion: 'Actualizar el estado (ganada, perdida) o mover la fecha estimada de cierre.', fuente: 'Comercial' });
    }
    // Facturar: lo ganado y ejecutado sin folio. Las que calzan con una factura del SII siguen aquí hasta que se anote el folio.
    const sinFac = porFacturar(R, hoy);
    if (sinFac.length) {
      const sug = id => R.sii.find(s => s.id === id && s.como === 'sugerida');
      const nSug = sinFac.filter(q => sug(q.id)).length, nSin = sinFac.length - nSug;
      A.push({ id: 'com-facturar-' + huella(sinFac), nivel: nSin ? 'alta' : 'media', foco: 'comercial', monto: sinFac.reduce((a, q) => a + q.valor, 0),
        titulo: sinFac.length + (sinFac.length === 1 ? ' venta ganada sin factura registrada' : ' ventas ganadas sin factura registrada') +
          (nSug ? ' (' + nSug + (nSug === 1 ? ' calza' : ' calzan') + ' con una factura del SII)' : ''),
        detalle: top(sinFac, 6).map(q => { const s = sug(q.id); return nombre(q) + (s ? ': ¿es la factura ' + s.folio + (s.fechaFactura ? ' del ' + s.fechaFactura : '') + '?' : ''); }).join('; ') + '.',
        accion: (nSin ? 'Facturar el día en que termina cada curso o servicio y registrar el folio en Comercial.' : '') +
          (nSug ? (nSin ? ' ' : '') + 'Confirmar el folio de las que calzan con el SII (Comercial → editar).' : ''), fuente: 'Comercial × SII' });
    }
    // Lo facturado que viene del SII ya lo sigue el informe financiero (Presente → Por cobrar): aquí solo lo registrado en Comercial
    const cobrar = R.ganadas.porCobrar.filter(q => esFecha(q.fecha_cierre) && dias(q.fecha_cierre, hoy) > 30 && !/SII/.test(q.origen || ''));
    if (cobrar.length) {
      A.push({ id: 'com-cobrar-' + huella(cobrar), nivel: 'media', foco: 'comercial', monto: cobrar.reduce((a, q) => a + q.valor, 0),
        titulo: cobrar.length + (cobrar.length === 1 ? ' venta facturada sin cobro' : ' ventas facturadas sin cobro') + ' hace más de 30 días',
        detalle: top(cobrar, 5).map(q => nombre(q) + ', factura ' + q.factura_folio).join('; ') + '.',
        accion: 'Llamar a cobranza de cada cliente y anotar la fecha comprometida.', fuente: 'Comercial' });
    }
    // El pronóstico solo alerta cuando ve el pipeline completo (dashboard conectado)
    if (ctx.equilibrio && ctx.conectado !== false) {
      for (const f of R.pronostico.meses.slice(0, 2)) {
        if (f.total < ctx.equilibrio) {
          A.push({ id: 'com-pronostico-' + f.mes, nivel: f.total < (ctx.minimo || 0) ? 'alta' : 'media', foco: 'cruce', monto: f.total, fecha_limite: f.mes + '-28',
            titulo: 'Venta B2B esperada para ' + f.etiqueta + ': ' + mm(f.total) + ', bajo el equilibrio de ' + mm(ctx.equilibrio),
            detalle: 'Ganado ' + mm(f.ganado) + ' + esperable de lo abierto ' + mm(f.esperado) + ' (' + f.nAbiertas + (f.nAbiertas === 1 ? ' cotización, ponderada' : ' cotizaciones, ponderadas') + ' por probabilidad)' +
              (f.supuestas ? '; ' + f.supuestas + ' sin fecha estimada de cierre, calculada con el ciclo histórico' : '') + '. La meta del plan es ' + mm(ctx.meta || 0) + '.',
            accion: 'Cotizar más B2B con cierre en ' + f.etiqueta + ' (SENCE, cursos cerrados, AOC, servicios) y empujar las negociaciones más avanzadas.', fuente: 'Comercial × Plan 2027' });
        }
      }
    }
    if (R.concentracion && R.concentracion.parte >= 0.4 && R.abiertas.n >= 5 && ctx.conectado !== false) {
      A.push({ id: 'com-concentracion', nivel: 'media', foco: 'comercial', monto: R.concentracion.monto,
        titulo: 'El ' + Math.round(R.concentracion.parte * 100) + '% de lo esperable del pipeline depende de un solo cliente (' + R.concentracion.cliente + ')',
        detalle: 'Si ese negocio se cae, el pronóstico pierde ' + mm(R.concentracion.monto) + ' de base.',
        accion: 'Diversificar: sumar cotizaciones de otros clientes en la misma línea.', fuente: 'Comercial' });
    }
    for (const q of top(ab.filter(x => x.estado === 'negociacion' && x.monto > 0 && !x.estancada), 3)) {
      A.push({ id: 'com-empujar-' + q.id, nivel: 'oportunidad', foco: 'comercial', monto: q.monto,
        titulo: 'En negociación: ' + (q.cliente || 'sin cliente') + (q.descripcion ? ', ' + corto(q.descripcion, 60) : ''),
        detalle: mm(q.monto) + ' con ' + Math.round(q.prob * 100) + '% de probabilidad' + (q.diasSinContacto != null ? '; último contacto hace ' + q.diasSinContacto + ' días' : '') + '.',
        accion: 'Proponer fecha de inicio y condiciones para cerrar esta semana.', fuente: 'Comercial' });
    }
    return A;
  }

  /* ---------- acciones para la agenda ----------
     El id lleva la fecha que la dispara (seguimiento, último contacto o cierre estimado):
     marcarla hecha no esconde el siguiente vencimiento de la misma cotización. */
  function acciones(R, hoy) {
    const out = [];
    const ab = R.cotizaciones.filter(q => q.abierta && !q.estancada);
    const prio = q => (q.seguimientoVencido ? 0 : 1) * 1e12 - (q.monto || 0);
    for (const q of ab.filter(q => q.seguimientoVencido || (q.diasSinContacto != null && q.diasSinContacto > 10 && !esFecha(q.proximo_seguimiento)) || (esFecha(q.proximo_seguimiento) && q.proximo_seguimiento <= sumarDias(hoy, 2)))
      .sort((a, b) => prio(a) - prio(b)).slice(0, 6)) {
      out.push({ id: 'com-seg-' + q.id + '-' + (esFecha(q.proximo_seguimiento) ? q.proximo_seguimiento : 'c' + q.fechaContacto), cuando: q.seguimientoVencido || q.proximo_seguimiento <= hoy ? 'hoy' : 'esta semana', foco: 'comercial', prioridad: q.monto >= 1e6 ? 0 : 1,
        titulo: 'Seguimiento a ' + (q.cliente || 'cliente') + (q.monto ? ' por ' + mm(q.monto) : '') + (q.descripcion ? ' · ' + corto(q.descripcion, 40) : ''),
        por: q.estadoLabel + (q.diasSinContacto != null ? ' · último contacto hace ' + q.diasSinContacto + ' días' : '') + (q.proximo_seguimiento ? ' · tocaba el ' + q.proximo_seguimiento : ''),
        cotizacion: q.id });
    }
    for (const q of porFacturar(R, hoy).slice(0, 4)) {
      const sug = R.sii.find(s => s.id === q.id && s.como === 'sugerida');
      out.push({ id: 'com-fac-' + q.id, cuando: 'esta semana', foco: 'comercial', prioridad: 1,
        titulo: sug ? 'Confirmar si la factura ' + sug.folio + ' es de la venta a ' + q.cliente : 'Facturar la venta a ' + (q.cliente || 'cliente') + ' por ' + montoTxt(q),
        por: sug ? 'Calza por nombre y monto con el SII; si es, anota el folio.' : 'Ganada' + (q.fecha_cierre ? ' el ' + q.fecha_cierre : '') + ', sin folio registrado.', cotizacion: q.id });
    }
    for (const q of ab.filter(q => q.cierreVencido).sort((a, b) => b.monto - a.monto).slice(0, 3)) {
      out.push({ id: 'com-cierre-' + q.id + '-' + q.fecha_cierre_estimada, cuando: 'esta semana', foco: 'comercial', prioridad: 2,
        titulo: 'Definir si se gana o se pierde: ' + (q.cliente || 'cliente') + ' (' + montoTxt(q) + ')', por: 'El cierre estimado era el ' + q.fecha_cierre_estimada + '.', cotizacion: q.id });
    }
    return out;
  }

  /* ---------- eventos para «Lo que viene» ---------- */
  function eventos(R, hoy) {
    const ev = [];
    for (const q of R.cotizaciones) {
      if (q.abierta && esFecha(q.proximo_seguimiento) && q.proximo_seguimiento >= hoy)
        ev.push({ fecha: q.proximo_seguimiento, tipo: 'comercial', titulo: 'Seguimiento: ' + (q.cliente || 'cliente') + ' · ' + montoTxt(q), estado: q.estado, cotizacion: q.id });
      else if (q.abierta && esFecha(q.fecha_cierre_estimada) && q.fecha_cierre_estimada >= hoy && q.monto >= 1e6)
        ev.push({ fecha: q.fecha_cierre_estimada, tipo: 'comercial', titulo: 'Cierre estimado: ' + (q.cliente || 'cliente') + ' · ' + mm(q.monto), estado: q.estado, cotizacion: q.id });
      if (q.estado === 'ganada' && esFecha(q.fecha_ejecucion) && q.fecha_ejecucion >= hoy)
        ev.push({ fecha: q.fecha_ejecucion, tipo: 'comercial', titulo: 'Se ejecuta: ' + (q.cliente || 'cliente') + (q.descripcion ? ' · ' + corto(q.descripcion, 40) : ''), estado: 'ganada', cotizacion: q.id });
    }
    return ev;
  }

  /* ---------- importación ---------- */
  const ALIAS = {
    id: ['id', 'id aeria'],
    folio: ['folio', 'n°', 'nº', 'no', 'nro', 'numero', 'número', 'codigo', 'código', 'cotizacion', 'cotización', 'n cotizacion', 'numero cotizacion', 'num'],
    cliente: ['cliente', 'empresa', 'razon social', 'razón social', 'razon', 'nombre cliente', 'institucion', 'institución', 'organismo', 'cuenta', 'mandante', 'nombre'],
    rut: ['rut', 'rut cliente'],
    contacto: ['contacto', 'persona', 'solicitante', 'nombre contacto'],
    email: ['email', 'correo', 'e-mail', 'mail'],
    telefono: ['telefono', 'teléfono', 'fono', 'celular', 'whatsapp'],
    linea: ['linea', 'línea', 'tipo', 'servicio', 'producto', 'categoria', 'categoría', 'unidad', 'tipo de servicio'],
    descripcion: ['descripcion', 'descripción', 'detalle', 'glosa', 'concepto', 'curso', 'proyecto', 'asunto', 'titulo', 'título'],
    monto: ['monto', 'total', 'valor', 'monto total', 'neto', 'monto neto', 'precio', 'importe', 'total neto', 'valor total', 'monto clp'],
    estado: ['estado', 'status', 'etapa', 'situacion', 'situación', 'resultado', 'fase'],
    probabilidad: ['probabilidad', 'prob', '%', 'probabilidad %'],
    fecha_cotizacion: ['fecha', 'fecha cotizacion', 'fecha cotización', 'emision', 'emisión', 'fecha emision', 'fecha emisión', 'creada', 'fecha envio', 'fecha envío', 'enviada'],
    fecha_cierre_estimada: ['cierre estimado', 'fecha cierre estimada', 'cierre esperado', 'fecha estimada', 'estimado'],
    fecha_cierre: ['fecha cierre', 'fecha de cierre', 'cierre', 'fecha ganada', 'fecha adjudicacion', 'fecha adjudicación'],
    fecha_ejecucion: ['fecha ejecucion', 'fecha ejecución', 'ejecucion', 'ejecución', 'fecha curso', 'inicio', 'fecha inicio'],
    proximo_seguimiento: ['proximo seguimiento', 'próximo seguimiento', 'seguimiento', 'recordatorio'],
    ultimo_contacto: ['ultimo contacto', 'último contacto'],
    factura_folio: ['factura', 'n factura', 'folio factura', 'factura n°'],
    cobrada: ['cobrada', 'cobro', 'pagada', 'pago', 'estado cobro', 'estado de pago'],
    motivo_perdida: ['motivo', 'motivo perdida', 'motivo pérdida', 'razon perdida'],
    notas: ['notas', 'observaciones', 'comentarios', 'obs', 'nota'],
  };
  function sugerirMapeo(columnas) {
    const usadas = new Set(), mapeo = {};
    const cols = columnas.map(c => ({ c, p: plano(c).replace(/[_\-.:]+/g, ' ').replace(/\s+/g, ' ').trim() }));
    for (const [campo, alias] of Object.entries(ALIAS)) {
      const al = alias.map(plano);
      let hit = cols.find(x => !usadas.has(x.c) && al.includes(x.p));
      if (!hit) hit = cols.find(x => !usadas.has(x.c) && al.some(a => a.length > 3 && x.p.includes(a)));
      if (hit) { mapeo[campo] = hit.c; usadas.add(hit.c); }
    }
    return mapeo;
  }
  function puntaje(columnas) {
    const m = sugerirMapeo(columnas);
    return (m.cliente ? 3 : 0) + (m.monto ? 3 : 0) + (m.estado ? 2 : 0) + (m.fecha_cotizacion ? 1 : 0) + (m.folio ? 1 : 0) + (m.descripcion ? 1 : 0);
  }
  function deFilas(filas) {   // [[encabezados], [valores]…] → [{col: valor}]
    let i = filas.findIndex(f => f.filter(c => String(c).trim()).length >= 2 && puntaje(f.map(String)) >= 3);
    if (i < 0) i = 0;
    const cab = (filas[i] || []).map((c, j) => String(c).trim() || 'col' + (j + 1));
    return filas.slice(i + 1).filter(f => f.some(c => String(c).trim()))
      .map(f => Object.fromEntries(cab.map((h, j) => [h, f[j] == null ? '' : f[j]])));
  }
  /* CSV, TSV o «;» respetando comillas (un campo entre comillas puede traer saltos de línea) */
  function partirCSV(texto) {
    texto = texto.replace(/^\uFEFF/, '');
    const primera = (texto.match(/^[^\n]*/) || [''])[0];
    const sep = ['\t', ';', ','].map(s => [s, primera.split(s).length - 1]).sort((a, b) => b[1] - a[1])[0][0];
    const filas = [];
    let fila = [], cur = '', q = false;
    for (let i = 0; i < texto.length; i++) {
      const ch = texto[i];
      if (q) {
        if (ch === '"') { if (texto[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += ch;
      } else if (ch === '"' && !cur.trim()) { q = true; cur = ''; }
      else if (ch === sep) { fila.push(cur.trim()); cur = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && texto[i + 1] === '\n') i++;
        fila.push(cur.trim()); cur = '';
        if (fila.some(c => c !== '')) filas.push(fila);
        fila = [];
      } else cur += ch;
    }
    fila.push(cur.trim());
    if (fila.some(c => c !== '')) filas.push(fila);
    return filas;
  }
  function arreglosDe(v, ruta, out) {   // busca arreglos de objetos dentro de cualquier JSON
    if (Array.isArray(v)) {
      if (v.length && v.every(x => x && typeof x === 'object' && !Array.isArray(x))) out.push({ origen: ruta || 'json', filas: v });
      else if (v.length && v.every(Array.isArray)) out.push({ origen: ruta || 'tabla', filas: deFilas(v) });
      else v.slice(0, 50).forEach((x, i) => arreglosDe(x, ruta + '[' + i + ']', out));
    } else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        if (typeof x === 'string' && /^\s*[[{]/.test(x)) { try { arreglosDe(JSON.parse(x), (ruta ? ruta + '.' : '') + k, out); } catch (e) { /* no es JSON */ } }
        else arreglosDe(x, (ruta ? ruta + '.' : '') + k, out);
      }
    }
    return out;
  }
  /* Convierte lo pegado o subido en conjuntos de filas candidatos, el más probable primero */
  function conjuntos(texto) {
    texto = String(texto || '').trim();
    if (!texto) return [];
    let cand = [];
    if (/^[[{]/.test(texto)) {
      const j = JSON.parse(texto);
      if (j && j.fuente === 'aeria-extractor') {
        for (const t of j.tablas || []) cand.push({ origen: 'Tabla «' + t.titulo + '» del dashboard', filas: deFilas(t.filas || []) });
        cand = cand.concat(arreglosDe(j.almacenamiento || {}, 'localStorage', []).map(c => Object.assign(c, { origen: 'Datos guardados (' + c.origen + ')' })));
        cand = cand.concat(arreglosDe(j.globales || {}, 'página', []).map(c => Object.assign(c, { origen: 'Variable de la página (' + c.origen + ')' })));
      } else cand = arreglosDe(j, '', []);
    } else if (/<table[\s>]/i.test(texto)) {
      const tablas = texto.match(/<table[\s\S]*?<\/table>/gi) || [];
      tablas.forEach((t, i) => {
        const filas = (t.match(/<tr[\s\S]*?<\/tr>/gi) || []).map(tr => (tr.match(/<t[hd][\s\S]*?<\/t[hd]>/gi) || []).map(c => c.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()));
        cand.push({ origen: 'Tabla HTML ' + (i + 1), filas: deFilas(filas) });
      });
    } else cand.push({ origen: 'Texto pegado', filas: deFilas(partirCSV(texto)) });
    return cand.filter(c => c.filas.length)
      .map(c => { const cols = Object.keys(c.filas[0] || {}); return Object.assign(c, { columnas: cols, puntaje: puntaje(cols), mapeo: sugerirMapeo(cols) }); })
      .sort((a, b) => b.puntaje - a.puntaje || b.filas.length - a.filas.length);
  }
  /* Filas + mapeo → cotizaciones limpias. Cada cotización lleva en _presentes los campos
     que de verdad venían en la fila (para no pisar lo existente con valores por defecto). */
  const TOTAL = /^(sub)?\s*total(es)?\b|^suma\b|^totales?\s*:/;
  function presentes(q) {
    const p = [];
    for (const [k, v] of Object.entries(q)) {
      const s = String(v == null ? '' : v).trim();
      if (!s || k === 'notas' || k === 'origen') continue;
      if (k === 'estado' && !leerEstado(v)) continue;
      if (k === 'linea' && !(LINEA[plano(v)] || clasificarLinea(plano(v), plano(v)))) continue;
      if (k === 'monto' && !/\d/.test(s)) continue;
      if (k === 'probabilidad' && leerProb(v) === '') continue;
      if (k === 'cobrada' && !leerCobro(v)) continue;
      if (CAMPOS_FECHA.includes(k) && !leerFecha(v)) continue;
      p.push(k);
    }
    if (q.monto != null && typeof q.monto === 'string' && leerTipoMonto(q.monto) && !p.includes('monto_tipo')) p.push('monto_tipo');
    return p;
  }
  function mapear(filas, mapeo, origen) {
    const usadas = Object.values(mapeo || {}).filter(Boolean);
    return filas.map(f => {
      const primera = String(Object.values(f)[0] == null ? '' : Object.values(f)[0]).trim();
      const q = {};
      for (const [campo, col] of Object.entries(mapeo || {})) if (col) q[campo] = f[col];
      // un «id» que no es de AerIA (p. ej. el número interno del dashboard) es un folio
      if (q.id != null && !ID_AERIA.test(String(q.id).trim())) { if (!String(q.folio || '').trim()) q.folio = q.id; delete q.id; }
      if (q.id != null) q.id = String(q.id).trim();
      if (!q.id) delete q.id;
      const extra = Object.entries(f).filter(([k, v]) => !usadas.includes(k) && String(v).trim()).map(([k, v]) => k + ': ' + v);
      if (extra.length) q.notas = [q.notas, extra.join(' · ')].filter(Boolean).join(' · ');
      if (!leerEstado(q.estado) && q.estado) q.notas = [q.notas, 'Estado original: ' + q.estado].filter(Boolean).join(' · ');
      const pres = presentes(q);
      q.origen = origen || 'importación';
      const o = limpiar(q);
      o._presentes = pres;
      // fila de totales: dice «Total»/«Suma» y no trae estado reconocido ni descripción («Total Chile SpA, Enviada» sí es un cliente)
      o._total = (TOTAL.test(plano(primera)) || TOTAL.test(plano(o.cliente)) || TOTAL.test(plano(o.folio))) && !leerEstado(q.estado) && !String(q.descripcion || '').trim();
      return o;
    }).filter(q => !q._total && (q.cliente || q.descripcion)).map(q => { delete q._total; return q; });
  }
  /* Qué crear y qué actualizar frente a lo que ya existe. Busca la cotización existente
     por id, por folio, por folio de factura y, si nada de eso calza, por cliente parecido +
     monto (±3 %, con o sin IVA) + fecha cercana: así lo sembrado desde el SII, el banco o
     el plan no se duplica al importar el dashboard. Solo compara los campos que venían. */
  const grupo = e => e === 'ganada' ? 'ganada' : (ESTADO[e] || ESTADO.enviada).abierta ? 'abierta' : 'cerrada';
  /* Fechas comparables: cierre con cierre, cotización con cotización; si solo hay una de
     cada, la cotización debe ser anterior al cierre y a menos de un año. */
  function fechasCompatibles(n, e) {
    if (esFecha(n.fecha_cierre) && esFecha(e.fecha_cierre)) return Math.abs(dias(n.fecha_cierre, e.fecha_cierre)) <= 120;
    if (esFecha(n.fecha_cotizacion) && esFecha(e.fecha_cotizacion)) return Math.abs(dias(n.fecha_cotizacion, e.fecha_cotizacion)) <= 120;
    const cot = esFecha(n.fecha_cotizacion) ? n.fecha_cotizacion : e.fecha_cotizacion;
    const cie = esFecha(n.fecha_cierre) ? n.fecha_cierre : e.fecha_cierre;
    if (esFecha(cot) && esFecha(cie)) { const d = dias(cot, cie); return d >= -15 && d <= 365; }
    return true;
  }
  function candidatoParecido(n, existentes, tomadas) {
    const pres = n._presentes || CAMPOS;
    let mejor = null;
    for (const e of existentes) {
      if (tomadas.has(e.id) || !n.monto) continue;
      if (e.folio && n.folio && claveDuplicado(e) !== claveDuplicado(n)) continue; // folios distintos: son otras
      // la existente sin monto (sembrada «por completar») calza solo por nombre; con monto, debe calzar el monto
      if (e.monto && difMonto(n.monto, e.monto) > 0.03) continue;
      const nombre = n.rut && e.rut ? (mismoRut(n.rut, e.rut) ? 1 : 0) : Math.max(parecido(n.cliente, e.cliente), contenido(n.cliente, e.cliente) ? 0.6 : 0);
      if (nombre < 0.6) continue;
      // el estado puede avanzar (abierta → ganada o perdida), no retroceder: una ganada no es una cotización abierta nueva
      if (pres.includes('estado') && grupo(e.estado) !== grupo(n.estado) && grupo(e.estado) !== 'abierta') continue;
      if (!fechasCompatibles(n, e)) continue;
      const puntaje = nombre - (e.monto ? difMonto(n.monto, e.monto) : 0.5);
      if (!mejor || puntaje > mejor.puntaje) mejor = { e, puntaje };
    }
    return mejor && mejor.e;
  }
  /* Qué crear y qué actualizar frente a lo que ya existe. Primera pasada: coincidencias
     exactas (id, folio, folio de factura) de TODAS las filas. Segunda pasada: para las que
     quedaron sueltas, cliente parecido + monto (±3 %, con o sin IVA) + fechas compatibles,
     solo entre las existentes que nadie tomó. Así lo sembrado desde el SII, el banco o el
     plan no se duplica, y el orden de las filas no cambia el resultado. Solo se comparan
     los campos que venían en la fila. */
  function planImportacion(nuevas, existentes, opciones) {
    existentes = existentes || [];
    const unir = !opciones || opciones.unirParecidas !== false;
    const porId = new Map(existentes.map(q => [q.id, q]));
    const porClave = new Map(existentes.map(q => [claveDuplicado(q), q]));
    const porFactura = new Map(existentes.filter(q => q.factura_folio).map(q => [folioN(q.factura_folio), q]));
    const sufijo = n => n.id + '-' + hash(plano(n.cliente)).slice(0, 4);
    const otroCliente = (e, n) => e.cliente && n.cliente && parecido(e.cliente, n.cliente) < 0.3 && !contenido(e.cliente, n.cliente) && !(n.rut && mismoRut(n.rut, e.rut));
    const filas = [], vistas = new Map(), repetidas = [];
    for (const n0 of nuevas) {
      const n = Object.assign({}, n0);
      const k = claveDuplicado(n), previa = vistas.get(k);
      if (previa) {
        // misma clave en el mismo archivo: si es otro cliente, es otra cotización con el folio escrito parecido
        if (previa.cliente && n.cliente && parecido(previa.cliente, n.cliente) < 0.6 && !contenido(previa.cliente, n.cliente)) { n.id = sufijo(n); repetidas.push(n); }
        else continue;
      } else vistas.set(k, n);
      filas.push(n);
    }
    // 1) coincidencias exactas
    const tomadas = new Set(), par = new Map();
    for (const n of filas) {
      let e = porId.get(n.id) || porClave.get(claveDuplicado(n)) || (n.factura_folio && porFactura.get(folioN(n.factura_folio))) || null;
      // el id de AerIA (de un CSV exportado desde aquí) identifica sin dudas; un folio repetido con otro cliente no se pisa
      const porIdAerIA = e && e.id === n.id && (n._presentes || []).includes('id');
      if (e && !porIdAerIA && otroCliente(e, n)) {
        if (!repetidas.includes(n)) { n.id = sufijo(n); repetidas.push(n); }
        e = porId.get(n.id) || null;   // el aparte de una importación anterior
      }
      if (e && !tomadas.has(e.id)) { tomadas.add(e.id); par.set(n, { e, como: 'exacta' }); }
    }
    // 2) parecidas, solo para las filas sueltas y entre las existentes libres
    if (unir) for (const n of filas) {
      if (par.has(n)) continue;
      const e = candidatoParecido(n, existentes, tomadas);
      if (e) { tomadas.add(e.id); par.set(n, { e, como: 'parecida' }); }
    }
    const crear = [], actualizar = [], parecidas = [];
    let iguales = 0;
    const ocupados = new Set(existentes.map(q => q.id));
    for (const n of filas) {
      const m = par.get(n);
      if (!m) {
        // nunca crear con un id que ya existe: se le agrega un sufijo estable
        if (ocupados.has(n.id)) n.id = n.id + '-' + hash(JSON.stringify([plano(n.cliente), n.monto, plano(n.descripcion)])).slice(0, 4);
        ocupados.add(n.id);
        crear.push(n); continue;
      }
      const { e, como } = m;
      const pres = n._presentes || CAMPOS;
      const cambios = {};
      for (const c of CAMPOS) {
        if (['notas', 'origen', 'evidencia', 'confianza', 'historial'].includes(c) || !pres.includes(c)) continue;
        // en una coincidencia por parecido se conserva el nombre y el monto que ya estaban (vienen de la factura o del plan)
        if (como === 'parecida' && ['cliente', 'monto', 'monto_tipo', 'rut'].includes(c) && (c === 'monto' ? e.monto > 0 : c === 'monto_tipo' ? e.monto > 0 && !!e.monto_tipo : String(e[c] == null ? '' : e[c]) !== '')) continue;
        if (n[c] !== '' && n[c] != null && String(n[c]) !== String(e[c] == null ? '' : e[c])) cambios[c] = n[c];
      }
      if (como === 'parecida') parecidas.push({ id: e.id, antes: e, nueva: n });
      if (Object.keys(cambios).length) actualizar.push({ id: e.id, antes: e, cambios, como }); else iguales++;
    }
    for (const q of crear) delete q._presentes;
    return { crear, actualizar, iguales, parecidas, repetidas };
  }

  /* Código del extractor para correr en el dashboard local (marcador o consola) */
  const EXTRACTOR = "(()=>{const T=[...document.querySelectorAll('table')].map((t,i)=>({titulo:(t.caption&&t.caption.innerText.trim())||(t.closest('section,div')&&t.closest('section,div').querySelector('h1,h2,h3')||{}).innerText||('tabla '+(i+1)),filas:[...t.rows].map(r=>[...r.cells].map(c=>c.innerText.trim()))}));const L={};try{for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);L[k]=localStorage.getItem(k)}}catch(e){}const G={};for(const k of Object.keys(window)){try{const v=window[k];if(Array.isArray(v)&&v.length&&v[0]&&typeof v[0]==='object'){JSON.stringify(v);G[k]=v}}catch(e){}}const s=JSON.stringify({fuente:'aeria-extractor',url:location.href,fecha:new Date().toISOString(),tablas:T,almacenamiento:L,globales:G});const fin=()=>alert('AerIA: datos copiados ('+Math.round(s.length/1024)+' KB). Pégalos en AerIA → Comercial → Importar.');navigator.clipboard.writeText(s).then(fin,()=>{const a=document.createElement('textarea');a.value=s;document.body.appendChild(a);a.select();document.execCommand('copy');a.remove();fin()})})();";

  /* ---------- contexto para el chat ---------- */
  function resumenParaIA(R) {
    if (!R || !R.total) return '## COMERCIAL\n- No hay cotizaciones cargadas todavía en AerIA.';
    const L = ['## COMERCIAL (cotizaciones en AerIA: ' + R.total + ')'];
    L.push('- Abiertas: ' + R.abiertas.n + ' por ' + clp(R.abiertas.monto) + ' (ponderado ' + clp(R.abiertas.ponderado) + '; B2B ponderado ' + clp(R.abiertas.b2bPonderado) + ').' +
      (R.abiertas.estancadas ? ' De ellas, ' + R.abiertas.estancadas + ' por ' + clp(R.abiertas.montoEstancadas) + ' están estancadas (más de 90 días sin contacto, o viejas y sin cierre estimado): no cuentan en el ponderado ni en el pronóstico.' : ''));
    L.push('- Ganadas: ' + R.ganadas.n + ' por ' + clp(R.ganadas.monto) + '; este mes ' + clp(R.ganadas.mes) + '; últimos 90 días ' + clp(R.ganadas.ultimos90) + '; año ' + clp(R.ganadas.anio) + (R.ganadas.ticket ? '; ticket promedio ' + clp(R.ganadas.ticket) : '') + '.');
    L.push('- Perdidas o vencidas: ' + R.perdidas.n + ' por ' + clp(R.perdidas.monto) + '. Tasa de cierre 12 meses: ' +
      (R.tasa.referencia ? 'usa la del dashboard, ' + Math.round(R.tasa.referencia.valor * 100) + '% por monto al ' + R.tasa.referencia.corte + ' (la calculada con lo cargado está sesgada: casi solo se conocen las ganadas facturadas)'
        : (R.tasa.monto != null ? Math.round(R.tasa.monto * 100) + '% por monto, ' + Math.round(R.tasa.cantidad * 100) + '% por cantidad (muestra ' + R.tasa.muestra + ')' : 'sin muestra')) + '. Ciclo de venta: ' + (R.ciclo != null ? Math.round(R.ciclo) + ' días (' + R.cicloMuestra + ' casos)' : 'sin dato') + '.');
    L.push('- Por línea: ' + R.porLinea.map(l => l.label + ': abierto ' + clp(l.abierto) + ', ganado ' + clp(l.ganado) + (l.tasa != null ? ', cierre ' + Math.round(l.tasa * 100) + '%' : '')).join('; ') + '.');
    L.push('- Pronóstico de venta B2B por mes (ganado + esperado ponderado): ' + R.pronostico.meses.map(f => f.etiqueta + ' ' + clp(f.total) + ' (ganado ' + clp(f.ganado) + ', esperado ' + clp(f.esperado) + ')').join('; ') + '. Promedio próximos 3 meses ' + clp(R.pronostico.promedio3) + '.');
    const ab = R.cotizaciones.filter(q => q.abierta).sort((a, b) => b.monto - a.monto).slice(0, 15);
    if (ab.length) L.push('- Mayores abiertas: ' + ab.map(q => '[' + q.id + '] ' + (q.cliente || '?') + ' · ' + corto(q.descripcion, 50) + ' · ' + clp(q.monto) + ' · ' + q.estadoLabel + (q.estancada ? ' · estancada' : ' · prob ' + Math.round(q.prob * 100) + '%') + (q.proximo_seguimiento ? ' · seguimiento ' + q.proximo_seguimiento : '') + (q.diasSinContacto != null ? ' · sin contacto ' + q.diasSinContacto + 'd' : '')).join(' | '));
    const gan = R.cotizaciones.filter(q => q.estado === 'ganada').sort((a, b) => String(b.fecha_cierre).localeCompare(String(a.fecha_cierre))).slice(0, 12);
    if (gan.length) L.push('- Últimas ganadas: ' + gan.map(q => (q.fecha_cierre || '?') + ' ' + (q.cliente || '?') + ' ' + clp(q.monto) + (q.monto_tipo === 'con_iva' ? ' con IVA' : '') + ' [' + q.lineaLabel + ']' + (q.factura_folio ? ' f.' + q.factura_folio : ' sin factura')).join(' | '));
    if (R.clientes && R.clientes.length) L.push('- Clientes 2026 sin monto registrado (de cartas, blog y Notion): ' + R.clientes.map(c => c.cliente + (c.detalle ? ' (' + corto(c.detalle, 90) + ')' : '')).join('; ') + '.');
    return L.join('\n');
  }

  const API = {
    ESTADOS, LINEAS, ESTADO, LINEA, CAMPOS, EXTRACTOR,
    limpiar, aplicar, deshacer, deshacerPor, puedeDeshacer, diferencias, normalizar, analizar, pronostico, conciliarSII,
    conjuntos, sugerirMapeo, mapear, planImportacion, leerMonto, leerTipoMonto, leerFecha, leerEstado, leerLinea, leerCobro, leerProb,
    idPara, claveDuplicado, parecido,
    resumenParaIA,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else raiz.AeriaComercial = API;
})(typeof window !== 'undefined' ? window : this);
