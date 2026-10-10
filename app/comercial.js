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
  function leerMonto(v) {
    if (typeof v === 'number') return isFinite(v) ? Math.round(v) : 0;
    let s = plano(v).replace(/clp|\$|pesos|\s/g, '');
    if (!s) return 0;
    let mult = 1;
    const suf = /(mm|m|mill(?:ones?)?|k|mil)$/.exec(s);
    if (suf) { mult = /^k|mil$/.test(suf[1]) ? 1e3 : 1e6; s = s.slice(0, -suf[1].length); }
    // «1.234.567» (miles con punto), «1,5» (decimal con coma), «1234567.00» (decimal con punto)
    if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
    else s = s.replace(',', '.');
    const n = parseFloat(s);
    return isFinite(n) ? Math.round(n * mult) : 0;
  }
  function leerFecha(v) {
    if (v == null || v === '') return '';
    if (typeof v === 'number' && v > 20000 && v < 80000) { // número de serie de Excel
      const d = new Date(Date.UTC(1899, 11, 30) + v * DIA);
      return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
    }
    const s = String(v).trim();
    let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
    if (m) return m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0');
    m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/.exec(s);
    if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return y + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0'); }
    m = /^(\d{1,2})[\s-]+([a-záéíóú]{3,})\.?[\s-]+(\d{4})/i.exec(s);
    if (m) { const i = MES3.indexOf(plano(m[2]).slice(0, 3)); if (i >= 0) return m[3] + '-' + String(i + 1).padStart(2, '0') + '-' + m[1].padStart(2, '0'); }
    if (/^\d{5}$/.test(s)) return leerFecha(Number(s));
    return '';
  }
  function leerEstado(v) {
    const s = plano(v);
    if (!s) return '';
    if (ESTADO[s]) return s;
    if (/no adjudic|rechaz|perdid|desiert|cancelad|descartad|no acept|declin|anulad/.test(s)) return 'perdida';
    if (/ganad|aceptad|adjudic|aprobad|vendid|facturad|confirmad|orden de compra|\boc\b|ejecutad|pagad|cobrad|cerrad[ao] ganad|^won/.test(s)) return 'ganada';
    if (/vencid|expirad|caducad|sin respuesta|congelad/.test(s)) return 'vencida';
    if (/negoci|seguimiento|revisi|evaluaci|ajuste|contraoferta|reuni|calient/.test(s)) return 'negociacion';
    if (/borrador|preparaci|por enviar|redactand/.test(s)) return 'borrador';
    if (/enviad|emitid|pendiente|abiert|presentad|cotizad|curso|nuev|contactad|espera/.test(s)) return 'enviada';
    return '';
  }
  function leerLinea(v, texto) {
    const s = plano(v), t = plano(texto);
    if (LINEA[s]) return s;
    const p = s + ' ' + t;
    if (/sence|otec|franquicia/.test(p)) return 'sence';
    if (/\baoc\b|asesor|certificaci[oó]n de operador|dan[\s-]?151|explotador/.test(p)) return 'aoc';
    if (/flota|airdata/.test(p)) return 'flota';
    if (/venta de (dron|equipo)|compra de (dron|equipo)|suministro|bateria|repuesto/.test(p)) return 'venta_equipos';
    if (/termogra|fotogram|levantamiento|inspecci|ortofoto|ortomosaico|filmaci|video|lidar|topogra|mapeo|servicio|vuelo|registro aereo/.test(p)) return 'servicios';
    if (/cupo|curso abierto|nivel 1|n1\b|pack/.test(p) && !/cerrad|in.?company|exclusiv/.test(p)) return 'escuela';
    if (/curso|capacitaci|formaci|taller|in.?company|cerrad|piloto|credencial|entrenamiento|instrucci/.test(p)) return 'curso_cerrado';
    return s ? 'otro' : '';
  }
  const leerCobro = v => { const s = plano(v); if (!s) return ''; if (/parcial|abono/.test(s)) return 'parcial'; if (/^(si|sí|yes|true|1)$|cobrad|pagad/.test(s)) return 'si'; if (/^(no|false|0)$|pendiente|por cobrar|impag/.test(s)) return 'no'; return ''; };
  const slug = t => plano(t).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  function hash(t) { let h = 2166136261; for (const c of String(t)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }
  function idPara(q) {
    if (q.id && /^[A-Za-z0-9_\-.~:@+]{1,200}$/.test(q.id)) return q.id;
    if (q.folio) return 'f-' + (slug(q.folio) || hash(q.folio));
    return 'q-' + hash([plano(q.cliente), q.monto || 0, q.fecha_cotizacion || '', plano(q.descripcion).slice(0, 40)].join('|'));
  }
  const claveDuplicado = q => q.folio ? 'f:' + plano(q.folio) : 'c:' + plano(q.cliente) + '|' + (q.monto || 0) + '|' + (q.fecha_cotizacion || '');

  /* Deja una cotización con todos sus campos y tipos en orden */
  function limpiar(q) {
    const o = {};
    for (const k of CAMPOS) o[k] = q[k] == null ? '' : q[k];
    o.monto = leerMonto(o.monto);
    o.estado = leerEstado(o.estado) || 'enviada';
    o.linea = leerLinea(o.linea, (q.descripcion || '') + ' ' + (q.cliente || '')) || 'otro';
    o.cobrada = leerCobro(o.cobrada) || (o.cobrada === '' ? '' : 'desconocido');
    o.probabilidad = o.probabilidad === '' || o.probabilidad == null ? '' : Math.max(0, Math.min(100, Number(String(o.probabilidad).replace('%', '').replace(',', '.')) || 0));
    for (const k of CAMPOS_FECHA) o[k] = leerFecha(o[k]);
    for (const k of ['folio', 'cliente', 'rut', 'contacto', 'email', 'telefono', 'descripcion', 'factura_folio', 'motivo_perdida', 'notas', 'origen', 'evidencia', 'confianza', 'monto_tipo']) o[k] = String(o[k]).trim().slice(0, k === 'notas' || k === 'evidencia' || k === 'descripcion' ? 4000 : 300);
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
  function aplicar(actual, cambios, por, nota, ahoraISO) {
    const base = actual ? Object.assign({}, actual) : {};
    const nueva = limpiar(Object.assign(base, cambios, { id: actual ? actual.id : cambios.id }));
    // Fecha de cierre automática solo cuando una cotización existente PASA a ganada, perdida o vencida
    if (actual && cambios.estado && actual.estado !== nueva.estado && ['ganada', 'perdida', 'vencida'].includes(nueva.estado) && !nueva.fecha_cierre) nueva.fecha_cierre = ahoraISO.slice(0, 10);
    const dif = diferencias(actual, nueva);
    nueva.historial = (actual && actual.historial ? actual.historial : []).concat(
      Object.keys(dif).length || nota ? [{ fecha: ahoraISO, por: por || 'usuario', cambios: dif, nota: nota || '' }] : []).slice(-60);
    nueva.creada = actual && actual.creada ? actual.creada : ahoraISO;
    nueva.actualizada = ahoraISO;
    return { cotizacion: nueva, cambios: dif };
  }
  /* Revierte el último cambio registrado */
  function deshacer(actual, ahoraISO) {
    const h = (actual.historial || []).slice();
    const ult = h.pop();
    if (!ult || !Object.keys(ult.cambios || {}).length) return null;
    const vuelta = {};
    for (const [k, [a]] of Object.entries(ult.cambios)) vuelta[k] = a;
    const r = aplicar(Object.assign({}, actual, { historial: h }), vuelta, 'deshacer', 'Deshace el cambio del ' + ult.fecha.slice(0, 16).replace('T', ' ') + ' (' + ult.por + ')', ahoraISO);
    return r.cotizacion;
  }

  /* ---------- lectura enriquecida ---------- */
  function normalizar(q, hoy, ciclo) {
    const e = ESTADO[q.estado] || ESTADO.enviada;
    const l = LINEA[q.linea] || LINEA.otro;
    const prob = e.abierta ? (q.probabilidad !== '' && q.probabilidad != null ? Number(q.probabilidad) / 100 : e.prob) : e.prob;
    const base = q.fecha_cotizacion || (q.creada || '').slice(0, 10);
    const contacto = [q.ultimo_contacto, ...(q.historial || []).filter(h => /seguimiento|contacto|llam|correo|reuni/i.test(h.nota || '')).map(h => (h.fecha || '').slice(0, 10))]
      .filter(esFecha).sort().pop() || base;
    let cierreEst = q.fecha_cierre_estimada;
    let cierreSupuesto = false;
    if (e.abierta && !esFecha(cierreEst)) {
      cierreEst = esFecha(base) ? sumarDias(base, Math.round(ciclo || 30)) : hoy;
      if (cierreEst < hoy) cierreEst = hoy;
      cierreSupuesto = true;
    }
    // valor = venta sin IVA (lo que cuenta para la meta B2B); monto queda tal como se escribió
    const valor = q.monto_tipo === 'con_iva' ? Math.round((q.monto || 0) / 1.19) : (q.monto || 0);
    return Object.assign({}, q, {
      estadoLabel: e.label, lineaLabel: l.label, b2b: l.b2b, abierta: e.abierta, prob, valor,
      ponderado: e.abierta ? valor * prob : 0,
      edad: esFecha(base) ? dias(base, hoy) : null,
      diasSinContacto: esFecha(contacto) ? dias(contacto, hoy) : null,
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
      abiertas: { n: abiertas.length, monto: totalAbierto, ponderado: suma(abiertas, 'ponderado'), b2bPonderado: suma(abiertas.filter(q => q.b2b), 'ponderado') },
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
      const esp = qs.filter(q => q.b2b && q.abierta && q.mesCierre === mes);
      const ganado = gan.reduce((a, q) => a + q.valor, 0), esperado = esp.reduce((a, q) => a + q.ponderado, 0);
      filas.push({ mes, etiqueta: nombreMes(mes), ganado, esperado, total: ganado + esperado, nGanadas: gan.length, nAbiertas: esp.length,
        meta: ctx.meta || null, equilibrio: ctx.equilibrio || null, supuestas: esp.filter(q => q.cierreSupuesto).length });
    }
    const prox3 = filas.slice(0, 3);
    return {
      meses: filas,
      promedio3: prox3.reduce((a, f) => a + f.total, 0) / Math.max(1, prox3.length),
      sinFechaEstimada: qs.filter(q => q.b2b && q.abierta && q.cierreSupuesto).length,
      mas: qs.filter(q => q.b2b && q.abierta && q.mesCierre > sumarMeses(m0, meses - 1)).reduce((a, q) => a + q.ponderado, 0),
    };
  }

  /* Cruce de lo ganado con las facturas del SII (por nombre y monto) */
  const VACIAS = new Set(['municipalidad', 'ilustre', 'i', 'de', 'del', 'la', 'las', 'los', 'el', 'y', 'spa', 'ltda', 'limitada', 'sa', 's', 'a', 'eirl', 'universidad', 'cuerpo', 'servicio', 'servicios', 'empresa', 'sociedad', 'comercial', 'ingenieria', 'chile', 'consultores', 'compania']);
  const fichas = t => plano(t).replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length >= 3 && !VACIAS.has(w));
  function parecido(a, b) {
    const A = new Set(fichas(a)), B = fichas(b);
    if (!A.size || !B.length) return 0;
    const comunes = B.filter(w => A.has(w)).length;
    return comunes / Math.min(A.size, B.length);
  }
  function conciliarSII(ganadas, sii, corte) {
    const facturas = (sii || []).filter(s => !/nota de cr|anulad/i.test((s.tipo || '') + ' ' + (s.estado || '')));
    const usadas = new Set();
    const res = [];
    for (const q of ganadas) {
      if (q.factura_folio) { res.push({ id: q.id, folio: q.factura_folio, como: 'registrada' }); usadas.add(String(q.factura_folio)); continue; }
      if (corte && esFecha(q.fecha_cierre) && q.fecha_cierre > corte) continue; // el SII cargado no llega a esa fecha
      const cand = facturas.filter(s => !usadas.has(String(s.folio)) && parecido(q.cliente, s.cliente) >= 0.5)
        .map(s => ({ s, dif: q.monto ? Math.min(Math.abs(s.monto - q.monto), Math.abs(s.monto - q.monto * 1.19), Math.abs(s.monto * 1.19 - q.monto)) / q.monto : 1 }))
        .sort((a, b) => a.dif - b.dif);
      if (cand.length && cand[0].dif <= 0.03) {
        const s = cand[0].s; usadas.add(String(s.folio));
        res.push({ id: q.id, folio: s.folio, como: 'sugerida', cobro: /^cobrada/i.test(s.estado) ? 'si' : /por cobrar|pendiente/i.test(s.estado) ? 'no' : '', estadoSII: s.estado, fechaFactura: s.fecha });
      } else res.push({ id: q.id, folio: '', como: 'sin-factura' });
    }
    return res;
  }

  /* ---------- alertas (mismo formato que motor.js) ---------- */
  function alertas(R, hoy, ctx) {
    const A = [];
    const ab = R.cotizaciones.filter(q => q.abierta);
    const top = (l, n) => l.slice().sort((a, b) => (b.monto || 0) - (a.monto || 0)).slice(0, n || 5);
    const nombre = q => (q.cliente || 'Sin cliente') + (q.descripcion ? ' · ' + corto(q.descripcion, 50) : '') + ' (' + (q.monto ? mm(q.monto) : 'monto por completar') + ')';
    const seg = ab.filter(q => q.seguimientoVencido);
    if (seg.length) {
      const m = seg.reduce((a, q) => a + q.valor, 0);
      A.push({ id: 'com-seguimientos', nivel: m >= 3e6 ? 'alta' : 'media', foco: 'comercial', monto: m,
        titulo: seg.length + (seg.length === 1 ? ' cotización con el seguimiento vencido' : ' cotizaciones con el seguimiento vencido'),
        detalle: 'Las más grandes: ' + top(seg, 4).map(q => nombre(q) + ', debía ser el ' + q.proximo_seguimiento.slice(8, 10) + '-' + MES3[Number(q.proximo_seguimiento.slice(5, 7)) - 1]).join('; ') + '.',
        accion: 'Llamar o escribir hoy y anotar el resultado y la próxima fecha en Comercial.', fuente: 'Comercial' });
    }
    const frias = ab.filter(q => !q.seguimientoVencido && !esFecha(q.proximo_seguimiento) && q.diasSinContacto != null && q.diasSinContacto > 14);
    if (frias.length) {
      const m = frias.reduce((a, q) => a + q.valor, 0);
      const muy = frias.filter(q => q.diasSinContacto > 45).length;
      A.push({ id: 'com-frias', nivel: m >= 5e6 ? 'alta' : 'media', foco: 'comercial', monto: m,
        titulo: frias.length + ' cotizaciones abiertas sin contacto hace más de 2 semanas',
        detalle: 'Suman ' + mm(m) + (muy ? '; ' + muy + ' llevan más de 45 días y probablemente estén perdidas' : '') + '. Las mayores: ' + top(frias, 4).map(q => nombre(q) + ', ' + q.diasSinContacto + ' días').join('; ') + '.',
        accion: 'Contactar las más grandes, ponerles próxima fecha de seguimiento y cerrar como perdidas las que ya no van.', fuente: 'Comercial' });
    }
    const cierres = ab.filter(q => q.cierreVencido);
    if (cierres.length) {
      A.push({ id: 'com-cierres', nivel: 'media', foco: 'comercial', monto: cierres.reduce((a, q) => a + q.valor, 0),
        titulo: cierres.length + ' cotizaciones pasaron su fecha estimada de cierre',
        detalle: top(cierres, 5).map(q => nombre(q) + ', estimada ' + q.fecha_cierre_estimada).join('; ') + '. El pronóstico las cuenta como si cerraran este mes.',
        accion: 'Actualizar el estado (ganada, perdida) o mover la fecha estimada de cierre.', fuente: 'Comercial' });
    }
    // Facturar: lo ya ejecutado y ganado en los últimos 120 días (o sin fecha). Lo más antiguo sin folio es un dato por completar, no una urgencia.
    const sinFac = R.ganadas.sinFactura.filter(q => (!esFecha(q.fecha_ejecucion) || q.fecha_ejecucion <= hoy) && (!esFecha(q.fecha_cierre) || dias(q.fecha_cierre, hoy) <= 120));
    const sugeridas = R.sii.filter(s => s.como === 'sugerida');
    const sinFacReal = sinFac.filter(q => !sugeridas.some(s => s.id === q.id));
    if (sinFacReal.length) {
      A.push({ id: 'com-facturar', nivel: 'alta', foco: 'comercial', monto: sinFacReal.reduce((a, q) => a + q.valor, 0),
        titulo: sinFacReal.length + (sinFacReal.length === 1 ? ' venta ganada sin factura' : ' ventas ganadas sin factura'),
        detalle: top(sinFacReal, 5).map(nombre).join('; ') + '.',
        accion: 'Facturar el día en que termina cada curso o servicio y registrar el folio en Comercial.', fuente: 'Comercial × SII' });
    }
    if (sugeridas.length) {
      A.push({ id: 'com-sii-sugeridas', nivel: 'baja', foco: 'comercial',
        titulo: sugeridas.length + ' ventas ganadas calzan con facturas del SII y no tienen el folio anotado',
        detalle: sugeridas.slice(0, 6).map(s => { const q = R.cotizaciones.find(x => x.id === s.id); return (q ? q.cliente : s.id) + ' → factura ' + s.folio; }).join('; ') + '.',
        accion: 'Confirmar el folio en cada cotización (Comercial → editar).', fuente: 'Comercial × SII' });
    }
    // Lo facturado que viene del SII ya lo sigue el informe financiero (Presente → Por cobrar): aquí solo lo registrado en Comercial
    const cobrar = R.ganadas.porCobrar.filter(q => esFecha(q.fecha_cierre) && dias(q.fecha_cierre, hoy) > 30 && !/SII/.test(q.origen || ''));
    if (cobrar.length) {
      A.push({ id: 'com-cobrar', nivel: 'media', foco: 'comercial', monto: cobrar.reduce((a, q) => a + q.valor, 0),
        titulo: cobrar.length + ' ventas facturadas sin cobro hace más de 30 días',
        detalle: top(cobrar, 5).map(q => nombre(q) + ', factura ' + q.factura_folio).join('; ') + '.',
        accion: 'Llamar a cobranza de cada cliente y anotar la fecha comprometida.', fuente: 'Comercial' });
    }
    // El pronóstico solo alerta cuando ve el pipeline completo (dashboard conectado o cotizaciones cargadas a mano)
    if (ctx.equilibrio && ctx.conectado !== false) {
      for (const f of R.pronostico.meses.slice(0, 2)) {
        if (f.total < ctx.equilibrio) {
          A.push({ id: 'com-pronostico-' + f.mes, nivel: f.total < (ctx.minimo || 0) ? 'alta' : 'media', foco: 'cruce', monto: f.total, fecha_limite: f.mes + '-28',
            titulo: 'Venta B2B esperada para ' + f.etiqueta + ': ' + mm(f.total) + ', bajo el equilibrio de ' + mm(ctx.equilibrio),
            detalle: 'Ganado ' + mm(f.ganado) + ' + esperable de lo abierto ' + mm(f.esperado) + ' (' + f.nAbiertas + ' cotizaciones, ponderadas por probabilidad)' +
              (f.supuestas ? '; ' + f.supuestas + ' sin fecha estimada de cierre, calculada con el ciclo histórico' : '') + '. La meta del plan es ' + mm(ctx.meta || 0) + '.',
            accion: 'Cotizar más B2B este mes (SENCE, cursos cerrados, AOC, servicios) y empujar las negociaciones más avanzadas.', fuente: 'Comercial × Plan 2027' });
        }
      }
    }
    if (R.concentracion && R.concentracion.parte >= 0.4 && R.abiertas.n >= 5 && ctx.conectado !== false) {
      A.push({ id: 'com-concentracion', nivel: 'media', foco: 'comercial', monto: R.concentracion.monto,
        titulo: 'El ' + Math.round(R.concentracion.parte * 100) + '% de lo esperable del pipeline depende de un solo cliente (' + R.concentracion.cliente + ')',
        detalle: 'Si ese negocio se cae, el pronóstico pierde ' + mm(R.concentracion.monto) + ' de base.',
        accion: 'Diversificar: sumar cotizaciones de otros clientes en la misma línea.', fuente: 'Comercial' });
    }
    for (const q of top(ab.filter(x => x.estado === 'negociacion' && x.monto > 0), 3)) {
      A.push({ id: 'com-empujar-' + q.id, nivel: 'oportunidad', foco: 'comercial', monto: q.monto,
        titulo: 'En negociación: ' + (q.cliente || 'sin cliente') + (q.descripcion ? ', ' + corto(q.descripcion, 60) : ''),
        detalle: mm(q.monto) + ' con ' + Math.round(q.prob * 100) + '% de probabilidad' + (q.diasSinContacto != null ? '; último contacto hace ' + q.diasSinContacto + ' días' : '') + '.',
        accion: 'Proponer fecha de inicio y condiciones para cerrar esta semana.', fuente: 'Comercial' });
    }
    return A;
  }

  /* ---------- acciones para la agenda ---------- */
  function acciones(R, hoy) {
    const out = [];
    const ab = R.cotizaciones.filter(q => q.abierta);
    const prio = q => (q.seguimientoVencido ? 0 : 1) * 1e12 - (q.monto || 0);
    for (const q of ab.filter(q => q.seguimientoVencido || (q.diasSinContacto != null && q.diasSinContacto > 10 && !esFecha(q.proximo_seguimiento)) || (esFecha(q.proximo_seguimiento) && q.proximo_seguimiento <= sumarDias(hoy, 2)))
      .sort((a, b) => prio(a) - prio(b)).slice(0, 6)) {
      out.push({ id: 'com-seg-' + q.id, cuando: q.seguimientoVencido || q.proximo_seguimiento <= hoy ? 'hoy' : 'esta semana', foco: 'comercial', prioridad: q.monto >= 1e6 ? 0 : 1,
        titulo: 'Seguimiento a ' + (q.cliente || 'cliente') + (q.monto ? ' por ' + mm(q.monto) : '') + (q.descripcion ? ' (' + corto(q.descripcion, 40) + ')' : ''),
        por: q.estadoLabel + (q.diasSinContacto != null ? ' · último contacto hace ' + q.diasSinContacto + ' días' : '') + (q.proximo_seguimiento ? ' · tocaba el ' + q.proximo_seguimiento : ''),
        cotizacion: q.id });
    }
    for (const q of R.ganadas.sinFactura.filter(q => (!esFecha(q.fecha_ejecucion) || q.fecha_ejecucion <= hoy) && (!esFecha(q.fecha_cierre) || dias(q.fecha_cierre, hoy) <= 120)).slice(0, 4)) {
      const sug = R.sii.find(s => s.id === q.id && s.como === 'sugerida');
      out.push({ id: 'com-fac-' + q.id, cuando: 'esta semana', foco: 'comercial', prioridad: 1,
        titulo: sug ? 'Anotar la factura ' + sug.folio + ' en la venta a ' + q.cliente : 'Facturar la venta a ' + (q.cliente || 'cliente') + (q.monto ? ' por ' + mm(q.monto) : ' (monto por completar)'),
        por: sug ? 'Calza por nombre y monto con el SII.' : 'Ganada' + (q.fecha_cierre ? ' el ' + q.fecha_cierre : '') + ', sin folio registrado.', cotizacion: q.id });
    }
    for (const q of ab.filter(q => q.cierreVencido).sort((a, b) => b.monto - a.monto).slice(0, 3)) {
      out.push({ id: 'com-cierre-' + q.id, cuando: 'esta semana', foco: 'comercial', prioridad: 2,
        titulo: 'Definir si se gana o se pierde: ' + (q.cliente || 'cliente') + ' (' + mm(q.monto) + ')', por: 'El cierre estimado era el ' + q.fecha_cierre_estimada + '.', cotizacion: q.id });
    }
    return out;
  }

  /* ---------- eventos para «Lo que viene» ---------- */
  function eventos(R, hoy) {
    const ev = [];
    for (const q of R.cotizaciones) {
      if (q.abierta && esFecha(q.proximo_seguimiento) && q.proximo_seguimiento >= hoy)
        ev.push({ fecha: q.proximo_seguimiento, tipo: 'comercial', titulo: 'Seguimiento: ' + (q.cliente || 'cliente') + ' · ' + mm(q.monto), estado: q.estado, cotizacion: q.id });
      else if (q.abierta && esFecha(q.fecha_cierre_estimada) && q.fecha_cierre_estimada >= hoy && q.monto >= 1e6)
        ev.push({ fecha: q.fecha_cierre_estimada, tipo: 'comercial', titulo: 'Cierre estimado: ' + (q.cliente || 'cliente') + ' · ' + mm(q.monto), estado: q.estado, cotizacion: q.id });
      if (q.estado === 'ganada' && esFecha(q.fecha_ejecucion) && q.fecha_ejecucion >= hoy)
        ev.push({ fecha: q.fecha_ejecucion, tipo: 'comercial', titulo: 'Se ejecuta: ' + (q.cliente || 'cliente') + (q.descripcion ? ' · ' + corto(q.descripcion, 40) : ''), estado: 'ganada', cotizacion: q.id });
    }
    return ev;
  }

  /* ---------- importación ---------- */
  const ALIAS = {
    folio: ['folio', 'n°', 'nº', 'no', 'nro', 'numero', 'número', 'id', 'codigo', 'código', 'cotizacion', 'cotización', 'n cotizacion', 'numero cotizacion', 'num'],
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
  function partirCSV(texto) {
    const lineas = texto.replace(/\r/g, '').split('\n').filter(l => l.trim());
    if (!lineas.length) return [];
    const sep = ['\t', ';', ','].map(s => [s, (lineas[0].match(new RegExp(s === '\t' ? '\t' : '\\' + s, 'g')) || []).length]).sort((a, b) => b[1] - a[1])[0][0];
    return lineas.map(l => { const out = []; let cur = '', q = false; for (let i = 0; i < l.length; i++) { const ch = l[i]; if (ch === '"') { if (q && l[i + 1] === '"') { cur += '"'; i++; } else q = !q; } else if (ch === sep && !q) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out.map(s => s.trim()); });
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
  /* Filas + mapeo → cotizaciones limpias */
  function mapear(filas, mapeo, origen) {
    return filas.map(f => {
      const q = {};
      for (const [campo, col] of Object.entries(mapeo || {})) if (col) q[campo] = f[col];
      const extra = Object.entries(f).filter(([k, v]) => !Object.values(mapeo || {}).includes(k) && String(v).trim()).map(([k, v]) => k + ': ' + v);
      if (extra.length) q.notas = [q.notas, extra.join(' · ')].filter(Boolean).join(' · ');
      q.origen = origen || 'importación';
      if (!leerEstado(q.estado) && q.estado) q.notas = [q.notas, 'Estado original: ' + q.estado].filter(Boolean).join(' · ');
      return limpiar(q);
    }).filter(q => q.cliente || q.monto || q.descripcion);
  }
  /* Qué crear y qué actualizar frente a lo que ya existe */
  function planImportacion(nuevas, existentes) {
    const idx = new Map((existentes || []).map(q => [claveDuplicado(q), q]));
    const porId = new Map((existentes || []).map(q => [q.id, q]));
    const crear = [], actualizar = [];
    let iguales = 0;
    const vistas = new Set();
    for (const n of nuevas) {
      const k = claveDuplicado(n);
      if (vistas.has(k)) continue;
      vistas.add(k);
      const e = idx.get(k) || porId.get(n.id);
      if (!e) { crear.push(n); continue; }
      const cambios = {};
      for (const c of CAMPOS) {
        if (['notas', 'origen', 'evidencia', 'historial'].includes(c)) continue;
        if (n[c] !== '' && n[c] != null && String(n[c]) !== String(e[c] == null ? '' : e[c])) cambios[c] = n[c];
      }
      if (Object.keys(cambios).length) actualizar.push({ id: e.id, antes: e, cambios }); else iguales++;
    }
    return { crear, actualizar, iguales };
  }

  /* Código del extractor para correr en el dashboard local (marcador o consola) */
  const EXTRACTOR = "(()=>{const T=[...document.querySelectorAll('table')].map((t,i)=>({titulo:(t.caption&&t.caption.innerText.trim())||(t.closest('section,div')&&t.closest('section,div').querySelector('h1,h2,h3')||{}).innerText||('tabla '+(i+1)),filas:[...t.rows].map(r=>[...r.cells].map(c=>c.innerText.trim()))}));const L={};try{for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);L[k]=localStorage.getItem(k)}}catch(e){}const G={};for(const k of Object.keys(window)){try{const v=window[k];if(Array.isArray(v)&&v.length&&v[0]&&typeof v[0]==='object'){JSON.stringify(v);G[k]=v}}catch(e){}}const s=JSON.stringify({fuente:'aeria-extractor',url:location.href,fecha:new Date().toISOString(),tablas:T,almacenamiento:L,globales:G});const fin=()=>alert('AerIA: datos copiados ('+Math.round(s.length/1024)+' KB). Pégalos en AerIA → Comercial → Importar.');navigator.clipboard.writeText(s).then(fin,()=>{const a=document.createElement('textarea');a.value=s;document.body.appendChild(a);a.select();document.execCommand('copy');a.remove();fin()})})();";

  /* ---------- contexto para el chat ---------- */
  function resumenParaIA(R) {
    if (!R || !R.total) return '## COMERCIAL\n- No hay cotizaciones cargadas todavía en AerIA.';
    const L = ['## COMERCIAL (cotizaciones en AerIA: ' + R.total + ')'];
    L.push('- Abiertas: ' + R.abiertas.n + ' por ' + clp(R.abiertas.monto) + ' (ponderado ' + clp(R.abiertas.ponderado) + '; B2B ponderado ' + clp(R.abiertas.b2bPonderado) + ').');
    L.push('- Ganadas: ' + R.ganadas.n + ' por ' + clp(R.ganadas.monto) + '; este mes ' + clp(R.ganadas.mes) + '; últimos 90 días ' + clp(R.ganadas.ultimos90) + '; año ' + clp(R.ganadas.anio) + (R.ganadas.ticket ? '; ticket promedio ' + clp(R.ganadas.ticket) : '') + '.');
    L.push('- Perdidas o vencidas: ' + R.perdidas.n + ' por ' + clp(R.perdidas.monto) + '. Tasa de cierre 12 meses: ' +
      (R.tasa.referencia ? 'usa la del dashboard, ' + Math.round(R.tasa.referencia.valor * 100) + '% por monto al ' + R.tasa.referencia.corte + ' (la calculada con lo cargado está sesgada: casi solo se conocen las ganadas facturadas)'
        : (R.tasa.monto != null ? Math.round(R.tasa.monto * 100) + '% por monto, ' + Math.round(R.tasa.cantidad * 100) + '% por cantidad (muestra ' + R.tasa.muestra + ')' : 'sin muestra')) + '. Ciclo de venta: ' + (R.ciclo != null ? Math.round(R.ciclo) + ' días (' + R.cicloMuestra + ' casos)' : 'sin dato') + '.');
    L.push('- Por línea: ' + R.porLinea.map(l => l.label + ': abierto ' + clp(l.abierto) + ', ganado ' + clp(l.ganado) + (l.tasa != null ? ', cierre ' + Math.round(l.tasa * 100) + '%' : '')).join('; ') + '.');
    L.push('- Pronóstico de venta B2B por mes (ganado + esperado ponderado): ' + R.pronostico.meses.map(f => f.etiqueta + ' ' + clp(f.total) + ' (ganado ' + clp(f.ganado) + ', esperado ' + clp(f.esperado) + ')').join('; ') + '. Promedio próximos 3 meses ' + clp(R.pronostico.promedio3) + '.');
    const ab = R.cotizaciones.filter(q => q.abierta).sort((a, b) => b.monto - a.monto).slice(0, 15);
    if (ab.length) L.push('- Mayores abiertas: ' + ab.map(q => '[' + q.id + '] ' + (q.cliente || '?') + ' · ' + corto(q.descripcion, 50) + ' · ' + clp(q.monto) + ' · ' + q.estadoLabel + ' · prob ' + Math.round(q.prob * 100) + '%' + (q.proximo_seguimiento ? ' · seguimiento ' + q.proximo_seguimiento : '') + (q.diasSinContacto != null ? ' · sin contacto ' + q.diasSinContacto + 'd' : '')).join(' | '));
    const gan = R.cotizaciones.filter(q => q.estado === 'ganada').sort((a, b) => String(b.fecha_cierre).localeCompare(String(a.fecha_cierre))).slice(0, 12);
    if (gan.length) L.push('- Últimas ganadas: ' + gan.map(q => (q.fecha_cierre || '?') + ' ' + (q.cliente || '?') + ' ' + clp(q.monto) + (q.monto_tipo === 'con_iva' ? ' con IVA' : '') + ' [' + q.lineaLabel + ']' + (q.factura_folio ? ' f.' + q.factura_folio : ' sin factura')).join(' | '));
    if (R.clientes && R.clientes.length) L.push('- Clientes 2026 sin monto registrado (de cartas, blog y Notion): ' + R.clientes.map(c => c.cliente + (c.detalle ? ' (' + corto(c.detalle, 90) + ')' : '')).join('; ') + '.');
    return L.join('\n');
  }

  const API = {
    ESTADOS, LINEAS, ESTADO, LINEA, CAMPOS, EXTRACTOR,
    limpiar, aplicar, deshacer, diferencias, normalizar, analizar, pronostico, conciliarSII,
    conjuntos, sugerirMapeo, mapear, planImportacion, leerMonto, leerFecha, leerEstado, leerLinea, idPara, claveDuplicado,
    resumenParaIA,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else raiz.AeriaComercial = API;
})(typeof window !== 'undefined' ? window : this);
