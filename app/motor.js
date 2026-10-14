/* =============================================================================
   AerIA · MOTOR DE ANÁLISIS

   Funciones puras: reciben los datos de las fuentes (D) y la fecha de hoy, y
   devuelven la lectura de la empresa (KPIs, alertas, agenda, lo que viene,
   briefing). No toca el DOM: la página lo usa para dibujar y el chat lo usa
   como contexto. Se prueba en node con `node tools/probar_motor.js`.

   D = {
     finanzas,      PASADO   cartolas, SII y Mercado Pago del período
     cursos,        PRESENTE fechas y cupos publicados en aereo.cl
     licitaciones,  PRESENTE radar de Mercado Público
     cotizaciones,  PRESENTE dashboard de cotizaciones (o lo importado)
     plan, modelo,  FUTURO   plan de rentabilidad 2027 y sus constantes
     notas          memoria: decisiones y contexto que el usuario le dio a AerIA
   }
   ============================================================================= */
(function (raiz) {
  'use strict';

  const DIA = 86400000;

  /* Feriados de Chile que tocan el calendario de cursos. 2026 según el
     calendario legal; 2027 según las notas del Calendario 2027 del plan. */
  const FERIADOS = {
    '2026-10-12': 'Encuentro de Dos Mundos', '2026-10-31': 'Iglesias Evangélicas',
    '2026-11-01': 'Todos los Santos', '2026-12-08': 'Inmaculada Concepción',
    '2026-12-25': 'Navidad', '2027-01-01': 'Año Nuevo', '2027-03-26': 'Viernes Santo',
    '2027-03-27': 'Sábado Santo', '2027-05-01': 'Día del Trabajo', '2027-05-21': 'Glorias Navales',
    '2027-06-21': 'Pueblos Indígenas', '2027-06-28': 'San Pedro y San Pablo',
    '2027-07-16': 'Virgen del Carmen', '2027-08-15': 'Asunción de la Virgen',
    '2027-09-17': 'Feriado de Fiestas Patrias', '2027-09-18': 'Independencia Nacional',
    '2027-09-19': 'Glorias del Ejército', '2027-10-11': 'Encuentro de Dos Mundos',
    '2027-11-01': 'Todos los Santos', '2027-12-08': 'Inmaculada Concepción', '2027-12-25': 'Navidad',
  };

  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
    'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const MES3 = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const DIAS_SEM = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const NIVELES = ['critica', 'alta', 'oportunidad', 'media', 'baja'];
  /* Módulo comercial (app/comercial.js): en la página llega como global; en node, por require */
  const Com = (typeof module !== 'undefined' && module.exports) ? require('./comercial.js') : raiz.AeriaComercial;
  /* ¿Ya entró el detalle del dashboard comercial (no solo lo sembrado desde SII, Notion o el plan)?
     Cuenta solo lo importado como «dashboard» (el extractor o la casilla del importador) y
     desde un mínimo de cotizaciones: un pipeline parcial no debe alimentar alertas ni el 2027. */
  const MIN_DASHBOARD = 3;
  const vieneDelDashboard = q => /^dashboard/i.test(String(q.origen || '').trim()) || (q.historial || []).some(h => h.por === 'dashboard');
  const deDashboard = lista => (lista || []).filter(vieneDelDashboard).length >= MIN_DASHBOARD;
  const dashboardConectado = com => !!(com && deDashboard(com.cotizaciones));

  /* ---------- formato ---------- */
  function miles(n) {
    return String(Math.round(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }
  function clp(n) { return (n < 0 ? '−' : '') + '$' + miles(n); }
  function mm(n, dec) {
    if (n == null || isNaN(n)) return '—';
    if (Math.abs(n) < 1e6) return clp(n);
    const v = (Math.abs(n) / 1e6).toFixed(dec == null ? 1 : dec).replace('.', ',');
    return (n < 0 ? '−' : '') + '$' + v + 'M';
  }
  function pct(x, dec) { return (x * 100).toFixed(dec || 0).replace('.', ',') + '%'; }
  function fecha(s) { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); }
  function iso(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function sumarDias(s, n) { const d = fecha(s); d.setDate(d.getDate() + n); return iso(d); }
  function diasEntre(a, b) { return Math.round((fecha(b) - fecha(a)) / DIA); }
  function fCorta(s) { const d = fecha(s); return d.getDate() + '-' + MES3[d.getMonth()]; }
  function fLarga(s) { const d = fecha(s); return DIAS_SEM[d.getDay()] + ' ' + d.getDate() + ' de ' + MESES[d.getMonth()]; }
  function mesNombre(ym) { return MESES[Number(ym.slice(5, 7)) - 1]; }
  function sumarMesesISO(s, n) { const [y, m] = s.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
  function plano(t) { return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
  function cuando(dias) {
    if (dias < 0) return 'hace ' + (-dias) + (dias === -1 ? ' día' : ' días');
    if (dias === 0) return 'hoy';
    if (dias === 1) return 'mañana';
    return 'en ' + dias + ' días';
  }
  function horasA(texto, ahora) {
    const h = Math.round((new Date(texto) - ahora) / 3600000);
    if (h < 0) return 'cerrada';
    if (h < 48) return 'cierra en ' + h + ' h';
    return 'cierra en ' + Math.round(h / 24) + ' días';
  }

  /* ---------- PASADO ---------- */
  function leerPasado(F) {
    const meses = [...new Set(F.movs.map(m => m.mes))].sort();
    const grupoDe = c => (F.cats[c] || {}).grupo || '';
    const porMes = meses.map(mes => {
      const r = { mes, ingresos: 0, egresos: 0, socio: 0, cofundador: 0, otec: 0, porCat: {} };
      for (const m of F.movs) {
        if (m.mes !== mes) continue;
        r.porCat[m.cat] = (r.porCat[m.cat] || 0) + m.monto;
        const g = grupoDe(m.cat);
        if (g === 'Ingresos operacionales') r.ingresos += m.monto;
        else if (g === 'Egresos operacionales') r.egresos += m.monto;
        else if (m.cat === 'soc_out' || m.cat === 'soc_in') r.socio += m.monto;
        else if (m.cat === 'cof') r.cofundador += m.monto;
        else if (m.cat === 'rel_in' || m.cat === 'rel_out') r.otec += m.monto;
      }
      r.flujo = r.ingresos + r.egresos;
      // Venta por línea según el reporte de ventas por producto (bruto, antes de comisión MP)
      r.b2b = 0; r.escuela = 0; r.otros = 0; r.unidades = { n1: 0, pack: 0, n23: 0 };
      for (const v of F.ventas_prod.filter(x => x.mes === mes)) {
        if (/empresas/i.test(v.producto)) r.b2b += v.monto;
        else if (/nivel 1/i.test(v.producto)) { r.escuela += v.monto; r.unidades.n1 += v.unidades; }
        else if (/pack/i.test(v.producto)) { r.escuela += v.monto; r.unidades.pack += v.unidades; }
        else if (/nivel 2/i.test(v.producto)) { r.escuela += v.monto; r.unidades.n23 += v.unidades; }
        else r.otros += v.monto;
      }
      r.alumnos = r.unidades.n1 + r.unidades.pack + r.unidades.n23;
      r.marketing = -(r.porCat.mkt || 0);
      r.cac = r.alumnos ? r.marketing / r.alumnos : null;
      const fin = F.serie.filter(s => s.fecha.slice(0, 7) === mes).pop();
      r.cajaFin = fin ? fin.total : null;
      r.facturado = (F.facturacion[mes] || {}).neto || 0;
      return r;
    });
    const tot = k => porMes.reduce((a, r) => a + r[k], 0);
    const egresosCat = {};
    for (const m of F.movs) if (grupoDe(m.cat) === 'Egresos operacionales') egresosCat[m.cat] = (egresosCat[m.cat] || 0) + m.monto;
    const sev = { alta: 0, media: 0, baja: 0 };
    for (const h of F.hallazgos) sev[h.sev] = (sev[h.sev] || 0) + 1;
    const m3 = ym => MES3[Number(ym.slice(5, 7)) - 1];
    const etiqueta = m3(meses[0]) + (meses.length > 1 ? '–' + m3(meses[meses.length - 1]) : '') + ' ' + meses[meses.length - 1].slice(0, 4);
    return {
      meses: porMes, etiqueta,
      cajaInicial: F.serie[0].total,
      cajaFinal: F.serie[F.serie.length - 1].total,
      cajaMin: F.serie.reduce((m, x) => x.total < m.total ? x : m, F.serie[0]),
      fechaCorte: F.serie[F.serie.length - 1].fecha,
      flujoOperacional: tot('flujo'),
      ingresos: tot('ingresos'),
      egresos: tot('egresos'),
      socioNeto: tot('socio'),
      cofundador: tot('cofundador'),
      otec: tot('otec'),
      b2b: tot('b2b'),
      escuela: tot('escuela'),
      egresosCat: Object.entries(egresosCat)
        .map(([cat, monto]) => ({ cat, label: F.cats[cat].label, monto: -monto, conf: (F.conf_cat || {})[cat] || '' }))
        .sort((a, b) => b.monto - a.monto),
      hallazgosSev: sev,
    };
  }

  /* ---------- PRESENTE ---------- */
  function feriadosEn(c, nivel) {
    const dias = nivel === 'n1' ? diasEntre(c.inicio, c.fin) + 1 : 2;
    const out = [];
    for (let i = 0; i < dias; i++) {
      const d = nivel === 'n1' ? sumarDias(c.inicio, i) : (i === 0 ? c.inicio : c.fin);
      if (FERIADOS[d]) out.push({ fecha: d, nombre: FERIADOS[d] });
    }
    return out;
  }

  function leerCursos(C, hoy) {
    const arma = (lista, nivel, precio) => lista.map(c => ({
      ...c, nivel, precio,
      nombre: nivel === 'n1' ? 'Nivel 1' : 'Niveles 2+3',
      corto: nivel === 'n1' ? 'N1' : 'N2+N3',
      dias: diasEntre(hoy, c.inicio),
      terminado: diasEntre(hoy, c.fin) < 0,
      ocupacion: c.vendidos / c.max,
      feriados: feriadosEn(c, nivel),
    }));
    const n1 = arma(C.nivel1, 'n1', C.precios_web.nivel1);
    const n23 = arma(C.niveles23, 'n23', C.precios_web.nivel23);
    const proximos = [...n1, ...n23].filter(c => !c.terminado).sort((a, b) => a.inicio.localeCompare(b.inicio));
    const resumen = lista => {
      const p = lista.filter(c => !c.terminado);
      const cupos = p.reduce((a, c) => a + c.max, 0), vendidos = p.reduce((a, c) => a + c.vendidos, 0);
      const cerca = p.filter(c => c.dias <= 21);
      const cc = cerca.reduce((a, c) => a + c.max, 0), cv = cerca.reduce((a, c) => a + c.vendidos, 0);
      return {
        fechas: p.length, cupos, vendidos, libres: cupos - vendidos,
        ocupacion: cupos ? vendidos / cupos : 0,
        ocupacion21: cc ? cv / cc : null,
        vendidoMonto: p.reduce((a, c) => a + c.vendidos * c.precio, 0),
        libreMonto: p.reduce((a, c) => a + (c.max - c.vendidos) * c.precio, 0),
      };
    };
    // Racha de meses agotados: los históricos + los meses ya terminados con todo vendido
    const agotados = new Set(C.meses_agotados_2026 || []);
    const porMes = {};
    for (const c of n1) { const m = fecha(c.inicio).getMonth(); (porMes[m] = porMes[m] || []).push(c); }
    for (const [m, lista] of Object.entries(porMes)) {
      if (lista.every(c => c.libres === 0) && lista.every(c => c.terminado)) agotados.add(Number(m));
    }
    const racha = [...agotados].sort((a, b) => a - b);
    return { n1, n23, proximos, resN1: resumen(n1), resN23: resumen(n23), racha };
  }

  function leerLicitaciones(L, ahora) {
    const abiertas = L.abiertas
      .map(l => ({ ...l, horas: (new Date(l.cierre) - ahora) / 3600000 }))
      .filter(l => l.horas > 0);
    const rel = abiertas.filter(l => ['capacitacion', 'asesoria', 'servicio'].includes(l.encaje));
    return {
      abiertas, relevantes: rel,
      capacitacion: abiertas.filter(l => l.encaje === 'capacitacion'),
      montoRelevante: rel.reduce((a, l) => a + (l.monto || 0), 0),
      generado: L.generado_fuente,
    };
  }

  const CERRADA = /ganad|aceptad|adjudic|cerrad|perdid|rechaz|anulad|vendid|facturad/;
  function leerCotizaciones(Q, hoy) {
    const corte = Q.corte || (Q.extraido || '').slice(0, 10);
    const r = { corte, antiguedad: corte ? diasEntre(corte, hoy) : null, fuente: Q.fuente, notas: Q.notas || [] };
    if (Q.items && Q.items.length) {
      const abiertas = Q.items.filter(i => !CERRADA.test(plano(i.estado)));
      const ganadas = Q.items.filter(i => /ganad|aceptad|adjudic|vendid|facturad/.test(plano(i.estado)));
      const cerradas = Q.items.filter(i => CERRADA.test(plano(i.estado)));
      r.items = Q.items;
      r.abiertas = abiertas.length;
      r.abiertasMonto = abiertas.reduce((a, i) => a + (Number(i.monto) || 0), 0);
      const montoCerr = cerradas.reduce((a, i) => a + (Number(i.monto) || 0), 0);
      r.tasaCierre = montoCerr ? ganadas.reduce((a, i) => a + (Number(i.monto) || 0), 0) / montoCerr : Q.tasa_cierre_monto || null;
      r.mayores = abiertas.slice().sort((a, b) => (b.monto || 0) - (a.monto || 0)).slice(0, 8);
    } else {
      r.items = [];
      r.abiertasMonto = Q.abiertas_monto || 0;
      r.tasaCierre = Q.tasa_cierre_monto || null;
      r.mayores = [];
    }
    r.esperado = r.tasaCierre ? r.abiertasMonto * r.tasaCierre : null;
    return r;
  }

  /* Nombre corto de cada cuenta según la cuadratura del informe (SAN → «Santander»…) */
  function cuentas(F) {
    const c = {};
    for (const q of F.cuadratura || []) c[q.cta] = String(q.cuenta).split(' · ')[0];
    return c;
  }
  const nombresCuentas = F => [...new Set(Object.values(cuentas(F)))].join(' + ');

  /* Facturas que el registro interno da por pagadas después del corte de las cartolas */
  function cobradasDespues(F) {
    const post = (F.registro_post && F.registro_post.cobradas_del_periodo) || [];
    const m = new Map(post.map(x => [String(x.folio), x.fecha_cobro || '']));
    for (const s of F.sii) {
      const r = /se pag[oó] el (\d{1,2})-(\d{1,2})/i.exec(s.det || '');
      if (r && !m.has(String(s.folio))) m.set(String(s.folio), F.periodo.hasta.slice(0, 4) + '-' + r[2].padStart(2, '0') + '-' + r[1].padStart(2, '0'));
    }
    return m;
  }
  /* Por cobrar en tres grupos: «vencida» (pasó el plazo de pago), «por_vencer» (emitida hace
     menos del plazo) y «por_confirmar» (pendientes de antes del período, saldos de factoring o
     facturas que el informe dice que podrían cubrir otros pagos). El plazo sale del modelo. */
  function leerPorCobrar(F, hoy, plazo) {
    plazo = plazo || 30;
    const out = leerPorCobrarFilas(F).map(p => {
      const confirmar = /pendiente desde antes/i.test(p.estado) || /factoring/i.test(p.estado) || /podr[ií]a (respaldar|cubrir|corresponder)/i.test(p.det || '');
      const vence = sumarDias(p.fecha, plazo);
      return Object.assign(p, { vence, grupo: confirmar ? 'por_confirmar' : (hoy && vence >= hoy ? 'por_vencer' : 'vencida') });
    });
    return out;
  }
  function leerPorCobrarFilas(F) {
    const corte = fCorta(F.periodo.hasta);
    const pagadas = cobradasDespues(F);
    const out = [];
    for (const s of F.sii) {
      if (/por cobrar/i.test(s.estado) && pagadas.has(String(s.folio))) continue; // ya pagada según el registro interno
      if (/por cobrar/i.test(s.estado) && s.fecha > F.periodo.hasta) out.push({ ...s, saldo: s.monto, tipoDeuda: 'Emitida el ' + fCorta(s.fecha) + ' (después del corte de las cartolas), sin cobro en el registro interno al ' + fCorta(F.sii_hasta || s.fecha) });
      else if (/por cobrar/i.test(s.estado)) out.push({ ...s, saldo: s.monto, tipoDeuda: 'Emitida en el período, sin pago al ' + corte });
      else if (/pendiente desde antes/i.test(s.estado)) out.push({ ...s, saldo: s.monto, tipoDeuda: 'Pendiente desde antes de agosto (por confirmar)' });
      else if (/factoring/i.test(s.estado)) {
        const m = /\$([\d.]+)/.exec(s.det || '');
        const anticipo = m ? Number(m[1].replace(/\./g, '')) : 0;
        out.push({ ...s, saldo: s.monto - anticipo, tipoDeuda: 'Cedida a factoring: saldo por liquidar, si corresponde' });
      }
    }
    return out.sort((a, b) => b.saldo - a.saldo);
  }

  /* Lo que el SII y el registro interno traen después del corte de las cartolas. Las facturas
     de «cobros del período, facturados tarde» son ventas de antes del corte y van aparte. A
     empresas e instituciones = RUT de persona jurídica y monto que no es un puñado de cupos a
     precio de lista (eso es venta de la escuela). */
  function leerDespues(F, precios) {
    if (!F || !F.periodo) return null;
    const corte = F.periodo.hasta;
    const docs = (F.sii || []).filter(s => s.fecha > corte && !/nota de cr|anulad/i.test((s.tipo || '') + ' ' + (s.estado || '')));
    if (!docs.length) return null;
    const tarde = docs.filter(s => /del per[ií]odo/i.test(s.estado || ''));
    const nuevas = docs.filter(s => !tarde.includes(s));
    const rutNum = r => Number(String(r || '').replace(/[^0-9kK]/g, '').slice(0, -1)) || 0;
    const listas = Object.values(precios || F.precios || {}).filter(Boolean);
    const cupos = m => listas.some(p => m % p === 0 && m / p <= 6);
    const sinIva = s => /afecta/i.test(s.tipo || '') ? Math.round(s.monto / 1.19) : s.monto;
    const b2b = nuevas.filter(s => rutNum(s.rut) >= 50e6 && !cupos(s.monto));
    const P = F.registro_post || {};
    const cobradasAntes = (P.cobradas_del_periodo || []).reduce((a, x) => a + (x.total || 0), 0);
    return {
      hasta: F.sii_hasta || docs.map(s => s.fecha).sort().pop(), n: nuevas.length, monto: nuevas.reduce((a, s) => a + s.monto, 0),
      b2b: b2b.reduce((a, s) => a + sinIva(s), 0), b2bN: b2b.length,
      iva: nuevas.filter(s => /afecta/i.test(s.tipo || '')).reduce((a, s) => a + s.monto - sinIva(s), 0),
      tardias: tarde.length, tardiasMonto: tarde.reduce((a, s) => a + s.monto, 0),
      ventasRegistro: P.ventas || 0, cobradoRegistro: (P.cobrado || 0), cobradoPeriodo: cobradasAntes, pendienteRegistro: P.pendiente || 0,
    };
  }

  /* Cruce: lo que el plan 2027 da por cobrar contra lo que muestran las cartolas */
  function cruzarPorCobrarPlan(P, F) {
    if (!P) return null;
    const textos = P.secciones.flatMap(s => [...s.parrafos, ...s.listas.flat()]);
    const frase = textos.find(t => /falta cobrar|cobrar \$[\d,]+M pendientes/i.test(t));
    if (!frase) return null;
    const nombres = (/\(([^)]+)\)/.exec(frase) || [])[1];
    if (!nombres) return null;
    const lista = nombres.split(/,| y /).map(x => x.trim()).filter(Boolean);
    const estado = lista.map(n => {
      const filas = F.sii.filter(s => plano(s.cliente).includes(plano(n)));
      const det = F.hallazgos.map(h => h.detalle).join(' ');
      let leido = 'sin dato en las cartolas';
      const fact = filas.find(s => /factoring/i.test(s.estado));
      if (fact) leido = 'cedida a factoring' + (fact.det ? ' (' + String(fact.det).split(/(?<=\.)\s/)[0].replace(/\.$/, '') + ')' : '');
      else if (filas.length && filas.every(s => /^cobrada/i.test(s.estado))) leido = 'ya cobrada';
      else if (filas.some(s => /pendiente|por cobrar/i.test(s.estado))) leido = 'sigue por cobrar';
      else if (new RegExp(plano(n) + '[^.]*se cobr', 'i').test(plano(det))) leido = 'ya cobrada';
      return { cliente: n, leido };
    });
    const contradicen = estado.filter(e => e.leido === 'ya cobrada' || e.leido.startsWith('cedida'));
    return contradicen.length ? { frase, estado, contradicen } : null;
  }

  /* ---------- FUTURO ---------- */
  function resultado2027(M, b2bMes, escuela, palancas) {
    const activas = M.palancas.filter(p => (palancas ? palancas.includes(p.id) : p.activa));
    const sumPal = activas.reduce((a, p) => a + p.efecto, 0);
    const margenEsc = M.margen_escuela[escuela || 'realista'];
    const res = margenEsc + 12 * b2bMes * M.margen_b2b + sumPal - M.costos_fijos_anio;
    const equilibrio = (M.costos_fijos_anio - margenEsc - sumPal) / (12 * M.margen_b2b);
    return { resultado: res, equilibrio, palancas: sumPal, margenEscuela: margenEsc, margenB2B: 12 * b2bMes * M.margen_b2b };
  }

  function leerFuturo(M, pasado, hoy, com) {
    const ultimo = pasado.meses[pasado.meses.length - 1];
    const prom = pasado.b2b / pasado.meses.length;
    const escenarios = [
      { id: 'minimo', nombre: 'Mínimo del plan', b2b: M.b2b_minimo_mes },
      { id: 'ultimo', nombre: 'Ritmo de ' + mesNombre(ultimo.mes), b2b: ultimo.b2b, real: true },
      { id: 'meta', nombre: 'Meta 2027', b2b: M.b2b_meta_mes },
      { id: 'promedio', nombre: 'Promedio ' + pasado.meses.map(m => MES3[Number(m.mes.slice(5)) - 1]).join('–'), b2b: prom, real: true },
    ].concat(dashboardConectado(com) && com.pronostico.promedio3 > 0
      ? [{ id: 'comercial', nombre: 'Pronóstico comercial 3 meses', b2b: com.pronostico.promedio3, real: true }] : [])
      .map(e => ({ ...e, ...resultado2027(M, e.b2b) }))
      .sort((a, b) => a.b2b - b.b2b);
    const hito = M.hito_decisivo;
    return {
      escenarios,
      equilibrio: resultado2027(M, 0).equilibrio,
      equilibrioPlanB: resultado2027(M, 0, 'realista', M.palancas.filter(p => p.estado !== 'Opcional').map(p => p.id)).equilibrio,
      diasHito: diasEntre(hoy, hito.fecha),
      hito,
      runwayDias: pasado.cajaFinal / M.costo_dia_habil,
    };
  }

  function leerTablero(M, pasado, cursos, D, com) {
    const u = pasado.meses[pasado.meses.length - 1];
    const estado = (bien, mal) => bien ? 'bien' : (mal ? 'critico' : 'atencion');
    return M.tablero.map(t => {
      let valor = 'Sin dato', est = 'sindato', nota = '';
      if (t.id === 'b2b') {
        valor = mm(u.b2b) + ' en ' + mesNombre(u.mes);
        est = estado(u.b2b >= M.b2b_meta_mes, u.b2b < M.b2b_minimo_mes);
        nota = 'Venta a empresas e instituciones según las cartolas (incluye anticipos de factoring).';
        const dsp = leerDespues(D.finanzas, D.cursos && D.cursos.precios_web);
        if (dsp && dsp.b2bN) nota += ' Después del corte, al ' + fCorta(dsp.hasta) + ': ' + mm(dsp.b2b) + ' sin IVA facturados a empresas (SII).';
        if (dashboardConectado(com)) {
          const f = com.pronostico.meses[0];
          nota += ' Comercial: ' + f.etiqueta + ' lleva ' + mm(f.ganado) + ' ganado y ' + mm(f.esperado) + ' esperable de lo abierto.';
        }
      } else if (t.id === 'ocup_n1' && cursos.resN1.ocupacion21 != null) {
        valor = pct(cursos.resN1.ocupacion21) + ' vendido';
        est = estado(cursos.resN1.ocupacion21 >= t.umbral, cursos.resN1.ocupacion21 < 0.5);
        nota = 'Cursos que empiezan en los próximos 21 días.';
      } else if (t.id === 'ocup_n23' && cursos.resN23.ocupacion21 != null) {
        valor = pct(cursos.resN23.ocupacion21) + ' vendido';
        est = estado(cursos.resN23.ocupacion21 >= t.umbral, cursos.resN23.ocupacion21 < 0.4);
        nota = 'Cursos que empiezan en los próximos 21 días.';
      } else if (t.id === 'cac' && u.cac) {
        valor = clp(u.cac) + ' en ' + mesNombre(u.mes);
        est = estado(u.cac <= t.umbral, u.cac > 1.5 * t.umbral);
        const mk = pasado.meses.reduce((a, m) => a + m.marketing, 0), al = pasado.meses.reduce((a, m) => a + m.alumnos, 0);
        nota = 'Marketing pagado en el mes ÷ alumnos que pagaron en el mes (' + u.alumnos + '). El marketing de un mes vende cursos de los meses siguientes: el promedio de ' + pasado.meses.length + ' meses es ' + clp(mk / al) + '.';
      } else if (t.id === 'caja') {
        valor = clp(pasado.cajaFinal) + ' al ' + fCorta(pasado.fechaCorte);
        est = estado(pasado.cajaFinal >= t.umbral, pasado.cajaFinal < t.umbral / 3);
        nota = nombresCuentas(D.finanzas) + '.';
      } else if (t.id === 'fcl') {
        nota = 'Se mide desde enero de 2027, al cierre de cada trimestre.';
      } else if (t.id === 'upsell') {
        nota = 'Falta cruzar el registro de alumnos del N1 con los del N2+N3.';
      }
      return { ...t, valor, estado: est, nota };
    });
  }

  /* Fila de la tabla de riesgos del plan que menciona un tema, como «riesgo → qué hacer» */
  function riesgoPlan(P, patron) {
    if (!P) return null;
    for (const s of P.secciones) for (const t of s.tablas) for (const f of t.slice(1)) {
      if (f.some(c => patron.test(c))) return f.join(' → ');
    }
    return null;
  }

  /* ---------- ALERTAS ---------- */
  function construirAlertas(D, X, hoy, ahora) {
    const A = [];
    const add = a => A.push(a);
    const { pasado, cursos, lic, cot, porCobrar, cruce, futuro } = X;
    const M = D.modelo;

    // Caja (la acción sale del hallazgo de liquidez del informe, si lo trae)
    const liquidez = D.finanzas.hallazgos.find(h => h.id === 'liquidez');
    if (pasado.cajaFinal < M.costos_fijos_mes) {
      const viejo = diasEntre(pasado.fechaCorte, hoy) > 7;
      const dsp = X.despues;
      add({
        id: 'caja', nivel: 'critica', foco: 'cruce', monto: pasado.cajaFinal,
        titulo: (viejo ? 'Al ' + fCorta(pasado.fechaCorte) + ' la caja cubría ' : 'La caja cubre ') + futuro.runwayDias.toFixed(1).replace('.', ',') + ' días hábiles de operación',
        detalle: 'Al ' + fCorta(pasado.fechaCorte) + ' las dos cuentas sumaban ' + clp(pasado.cajaFinal) +
          '. La regla del plan 2027 es nunca bajar de 1 mes de costos fijos (' + mm(M.costos_fijos_mes, 2) + '). ' +
          'En ' + pasado.etiqueta.replace(/ \d{4}$/, '') + ' la operación dejó ' + mm(pasado.flujoOperacional) + ', pero socio, cofundador y Aéreo OTEC restaron ' +
          mm(-(pasado.socioNeto + pasado.cofundador + pasado.otec)) + ' netos. La caja más baja fue ' + clp(pasado.cajaMin.total) + ' el ' + fCorta(pasado.cajaMin.fecha) + '.' +
          (dsp && dsp.cobradoRegistro ? ' Después del corte, el registro interno anota cobros por ' + mm(dsp.cobradoRegistro) + ' al ' + fCorta(dsp.hasta) + ' (sin cartola que lo confirme).' : ''),
        accion: (liquidez && liquidez.accion ? liquidez.accion.replace(/\.?$/, '. ') : 'Fijar un saldo mínimo de operación. ') +
          'Cobrar lo pendiente y hacer preventa de ' + mesNombre(sumarMesesISO(hoy, 1)) + ' y ' + mesNombre(sumarMesesISO(hoy, 2)) + '.',
        fuente: 'Finanzas ' + pasado.etiqueta + ' + Plan 2027 (Tablero mensual)',
      });
    }
    // Hallazgos financieros: conservan su severidad; los que el modelo marca en «hallazgos_criticos» suben a crítica
    const criticos = new Set(M.hallazgos_criticos || []);
    for (const h of D.finanzas.hallazgos) {
      if (h.id === 'liquidez') continue; // ya está en «caja»
      const nivel = criticos.has(h.id) ? 'critica' : h.sev;
      add({
        id: 'fin-' + h.id, nivel, foco: 'pasado', monto: h.monto,
        titulo: h.titulo, detalle: h.detalle, accion: h.accion,
        fuente: 'Finanzas ' + pasado.etiqueta + ' (hallazgo «' + h.id + '»)',
      });
    }
    // B2B bajo la meta
    const u = pasado.meses[pasado.meses.length - 1];
    if (u.b2b < M.b2b_meta_mes) {
      add({
        id: 'b2b-' + u.mes, nivel: u.b2b < M.b2b_minimo_mes ? 'critica' : 'alta', foco: 'cruce', monto: u.b2b,
        titulo: 'B2B de ' + mesNombre(u.mes) + ': ' + mm(u.b2b) + ', bajo la meta de ' + mm(M.b2b_meta_mes),
        detalle: 'El plan 2027 depende del B2B: con ' + mm(M.b2b_meta_mes) + ' al mes el año cierra en ' +
          mm(resultado2027(M, M.b2b_meta_mes).resultado) + '; al ritmo de ' + mesNombre(u.mes) + ' cerraría en ' +
          mm(resultado2027(M, u.b2b).resultado) + '. El equilibrio está en ' + mm(futuro.equilibrio) + ' al mes. ' +
          'Las cotizaciones abiertas (' + mm(cot.abiertasMonto) + ') son la reserva para subirlo.',
        accion: 'Cerrar cotizaciones abiertas y armar la cartera de enero–marzo desde ahora' + (M.mix_b2b_meta ? ': ' + M.mix_b2b_meta + '.' : '.'),
        fuente: 'Finanzas (ventas por producto) + Plan 2027',
      });
    }
    // Cursos: feriados
    for (const c of cursos.proximos) {
      for (const f of c.feriados) {
        add({
          id: 'feriado-' + c.nivel + '-' + c.inicio, nivel: 'alta', foco: 'presente',
          titulo: 'El ' + c.corto + ' del ' + fCorta(c.inicio) + ' cae en feriado (' + fCorta(f.fecha) + ', ' + f.nombre + ')',
          detalle: 'La fecha sigue publicada en aereo.cl con ' + c.vendidos + ' de ' + c.max + ' cupos vendidos.' +
            (c.nivel === 'n23' && c.inicio === '2026-12-07' ? ' El plan 2027 ya pide moverlo al 14–15 de diciembre.' : ''),
          accion: 'Mover la fecha en datos/' + (c.nivel === 'n1' ? 'cursos-fechas.js' : 'n23-fechas.js') + ' del repo aereo-web y avisar a los inscritos.',
          fuente: 'aereo.cl (cursos publicados) + calendario de feriados', fecha_limite: c.inicio,
        });
      }
    }
    // Cursos: cupos por vender cerca de la fecha
    for (const c of cursos.proximos) {
      if (c.dias <= 21 && c.dias >= 0 && c.libres >= 3) {
        add({
          id: 'vender-' + c.nivel + '-' + c.inicio, nivel: c.dias <= 10 ? 'alta' : 'media', foco: 'presente',
          monto: c.libres * c.precio,
          titulo: 'El ' + c.corto + ' del ' + fCorta(c.inicio) + ' tiene ' + c.libres + ' de ' + c.max + ' cupos libres y empieza ' + cuando(c.dias),
          detalle: 'Cada cupo vale ' + clp(c.precio) + ' a precio actual. ' +
            (cursos.racha.length >= 3 ? 'Es la excepción: ' + cursos.racha.length + ' meses seguidos se agotaron y las fechas vecinas están llenas.' : ''),
          accion: 'Ofrecer los cupos a la lista de espera de las fechas agotadas y a empresas con SENCE' +
            (M.margen_alumno ? ' (un alumno SENCE deja ' + clp(M.margen_alumno.sence) + ' contra ' + clp(M.margen_alumno.nivel1) + ' de un particular).' : '.'),
          fuente: 'aereo.cl (cursos publicados)', fecha_limite: c.inicio,
        });
      }
    }
    // Meses sin ventas
    const vacios = cursos.proximos.filter(c => c.vendidos === 0 && c.dias > 21);
    if (vacios.length >= 3) {
      const meses = [...new Set(vacios.map(c => MESES[fecha(c.inicio).getMonth()]))];
      add({
        id: 'preventa', nivel: 'media', foco: 'futuro', monto: vacios.reduce((a, c) => a + c.max * c.precio, 0),
        titulo: vacios.length + ' fechas publicadas sin ningún cupo vendido (' + meses.join(' y ') + ')',
        detalle: 'Suman ' + vacios.reduce((a, c) => a + c.max, 0) + ' cupos.' + (riesgoPlan(D.plan, /preventa/i) ? ' Plan 2027: «' + riesgoPlan(D.plan, /preventa/i) + '».' : ''),
        accion: 'Lanzar preventa con fecha límite y abrir estos cupos a empresas con SENCE.',
        fuente: 'aereo.cl + Plan 2027 (Riesgos)',
      });
    }
    // Licitaciones
    for (const l of lic.relevantes) {
      if (l.horas > 24 * 10) continue;
      const urgente = l.horas <= 72;
      add({
        id: 'lic-' + l.codigo, nivel: l.encaje === 'capacitacion' && urgente ? 'alta' : 'oportunidad', foco: 'presente',
        monto: l.monto || null,
        titulo: l.encaje_label + ': ' + l.nombre.toLowerCase().replace(/^\w/, x => x.toUpperCase()).slice(0, 110),
        detalle: l.organismo + ' · ' + l.region + ' · ' + (l.monto ? 'presupuesto ' + clp(l.monto) : 'sin monto publicado') +
          ' · ' + horasA(l.cierre, ahora) + ' (' + fLarga(l.cierre) + ').',
        accion: urgente ? 'Revisar las bases y ofertar hoy.' : 'Revisar las bases y decidir si se postula.',
        fuente: 'Radar de licitaciones (' + (l.fuente === 'compra_agil' ? 'Compra Ágil' : 'Licitación') + ')',
        fecha_limite: l.cierre.slice(0, 10), url: l.url,
      });
    }
    // Dashboard comercial: si su detalle no ha entrado a AerIA, se avisa con lo último conocido
    const com = X.comercial;
    if (!dashboardConectado(com)) {
      add({
        id: 'cot-antiguas', nivel: 'alta', foco: 'comercial',
        titulo: 'Tu dashboard comercial todavía no está conectado a AerIA',
        detalle: 'Lo último que veo del dashboard es el agregado del ' + fCorta(cot.corte) + (cot.antiguedad != null ? ' (hace ' + cot.antiguedad + ' días)' : '') + ': ' +
          mm(cot.abiertasMonto) + ' abiertas con ' + (cot.tasaCierre ? pct(cot.tasaCierre) : '?') + ' de cierre por monto.' +
          (com && com.total ? ' En Comercial hay ' + com.total + ' cotizaciones cargadas desde otras fuentes (SII, Notion, plan), pero no el detalle del dashboard.' : '') +
          ' Sin ese detalle no puedo pronosticar bien ni decirte cuáles empujar.',
        accion: 'Abre tu dashboard, corre el extractor de AerIA y pega el resultado en Comercial → Importar (o sube el CSV o JSON exportado).',
        fuente: 'Dashboard de cotizaciones',
      });
    }
    if (com) for (const a of com.alertas) add(a);
    // Cruce plan vs cartolas
    if (cruce) {
      add({
        id: 'cruce-por-cobrar', nivel: 'media', foco: 'cruce',
        titulo: 'El plan 2027 da por cobrar facturas que las cartolas muestran resueltas',
        detalle: 'El plan dice: «' + cruce.frase + '». Las cartolas dicen: ' +
          cruce.estado.map(e => e.cliente + ' ' + e.leido).join('; ') + '.',
        accion: 'Corregir la cifra en el plan y usar la lista de Presente → Por cobrar, que sale del banco y el SII.',
        fuente: 'Plan 2027 × Finanzas ' + pasado.etiqueta,
      });
    }
    // Oportunidad: precio
    if (cursos.racha.length >= 4) {
      add({
        id: 'demanda', nivel: 'oportunidad', foco: 'futuro',
        titulo: 'La demanda respalda el alza de precio de 2027',
        detalle: 'El Nivel 1 se agotó ' + cursos.racha.length + ' meses seguidos (' + cursos.racha.map(m => MES3[m]).join(', ') +
          ') a ' + clp(D.cursos.precios_web.nivel1) + '. El plan sube el N1 a ' +
          clp(M.precios_2027.nivel1) + ' (+' + pct(M.precios_2027.nivel1 / D.cursos.precios_web.nivel1 - 1) + ').',
        accion: 'Mantener el alza y la regla de descuentos (máximo 10%, solo grupos de 3+). Evaluar publicar las fechas de enero ya con el precio 2027.',
        fuente: 'aereo.cl + Plan 2027',
      });
    }
    const orden = a => NIVELES.indexOf(a.nivel);
    return A.sort((a, b) => orden(a) - orden(b) ||
      String(a.fecha_limite || '9').localeCompare(String(b.fecha_limite || '9')) ||
      (Math.abs(b.monto || 0) - Math.abs(a.monto || 0)));
  }

  /* ---------- AGENDA: lo que AerIA te ordena hacer ---------- */
  function construirAgenda(D, X, alertas, hoy) {
    const items = [];
    const add = (o) => { if (!items.some(i => i.id === o.id)) items.push(o); };
    const { porCobrar, lic, pasado } = X;
    for (const a of alertas) {
      if (a.id.startsWith('lic-') && a.nivel === 'alta') {
        add({ id: a.id, cuando: 'hoy', titulo: 'Ofertar: ' + a.titulo.replace(/^[^:]+: /, ''), por: a.detalle, foco: 'presente', url: a.url, prioridad: 0 });
      }
    }
    const vencidas = porCobrar.filter(p => p.grupo === 'vencida'), confirmar = porCobrar.filter(p => p.grupo === 'por_confirmar');
    const suma = l => l.reduce((s, p) => s + p.saldo, 0);
    if (vencidas.length) {
      add({
        id: 'cobrar', cuando: 'esta semana', foco: 'presente', prioridad: 1,
        titulo: 'Cobrar ' + mm(suma(vencidas)) + (vencidas.length === 1 ? ' vencido' : ' vencidos'),
        por: vencidas.map(p => p.cliente + ' ' + clp(p.saldo) + ' (f. ' + p.folio + ', venció el ' + fCorta(p.vence) + ')').join(' · '),
      });
    }
    if (confirmar.length) {
      add({
        id: 'cobrar-confirmar', cuando: 'esta semana', foco: 'presente', prioridad: 2,
        titulo: 'Confirmar si siguen por cobrar ' + mm(suma(confirmar)),
        por: confirmar.map(p => p.cliente + ' ' + clp(p.saldo) + ' (f. ' + p.folio + ': ' + p.tipoDeuda.replace(/\s*\(por confirmar\)/, '') + ')').join(' · '),
      });
    }
    const primera = t => String(t || '').split(/(?<=\.)\s/)[0].replace(/\.$/, '');
    const fin = alertas.filter(a => a.id.startsWith('fin-'));
    const finMedias = fin.filter(a => a.nivel === 'media').sort((a, b) => (b.monto || 0) - (a.monto || 0)).slice(0, 3).map(a => a.id);
    const regla = a => {
      if (a.id === 'caja') return [1, 'esta semana'];
      if (a.id.startsWith('fin-') && a.nivel === 'critica') return [1, 'esta semana'];
      if (a.id.startsWith('fin-') && a.nivel === 'alta') return [2, 'este mes'];
      if (finMedias.includes(a.id)) return [3, 'este mes'];
      if (a.id === 'cot-antiguas') return [1, 'esta semana'];
      if (a.id === 'preventa') return [2, 'este mes'];
      if (a.id.startsWith('com-pronostico-')) return [2, 'esta semana'];
      if (a.id === 'cruce-por-cobrar') return [3, 'este mes'];
      return null;
    };
    for (const a of alertas) {
      if (a.id.startsWith('feriado-')) add({ id: a.id, cuando: 'esta semana', foco: 'presente', prioridad: 1, titulo: 'Mover ' + a.titulo.split(' cae')[0].replace(/^El /, 'el ') + ' a una fecha sin feriado', por: a.accion });
      else if (a.id.startsWith('vender-')) add({ id: a.id, cuando: 'esta semana', foco: 'presente', prioridad: 1, titulo: 'Llenar ' + a.titulo.split(' tiene')[0].replace(/^El /, 'el ') + ' (' + a.titulo.split(' tiene ')[1].split(' y ')[0] + ')', por: a.accion });
      else if (regla(a)) {
        const [pr, cuando] = regla(a);
        add({ id: a.id, cuando, foco: a.foco, prioridad: pr, titulo: primera(a.accion), por: a.titulo });
      } else if (a.id.startsWith('lic-') && a.nivel === 'oportunidad' && /capacitaci/i.test(a.titulo)) {
        add({ id: a.id, cuando: 'antes del ' + fCorta(a.fecha_limite), foco: 'presente', prioridad: 2, titulo: 'Preparar oferta: ' + a.titulo.replace(/^[^:]+: /, ''), por: a.detalle, url: a.url });
      }
    }
    // Acciones comerciales: seguimientos, facturar lo ganado, definir cierres vencidos
    if (X.comercial) for (const c of X.comercial.acciones) add(c);
    // Las acciones de «Esta semana» del plan que no estén ya cubiertas
    const plan = (D.plan && D.plan.secciones.find(s => /plan de acci/i.test(s.titulo))) || null;
    if (plan) {
      for (const t of plan.listas.flat()) {
        if (/cobrar|mover el n2|sacar el caf/i.test(t)) continue;
        add({ id: 'plan-' + plano(t).replace(/[^a-z0-9]+/g, '-').slice(0, 40), cuando: 'esta semana', foco: 'futuro', prioridad: 2, titulo: t, por: 'Plan 2027 · Plan de acción' });
      }
    }
    const peso = { hoy: 0, 'esta semana': 1, 'este mes': 3 };
    return items.sort((a, b) => (a.prioridad - b.prioridad) || ((peso[a.cuando] ?? 2) - (peso[b.cuando] ?? 2)));
  }

  /* ---------- LO QUE VIENE ---------- */
  function construirViene(D, X, hoy) {
    const ev = [];
    const hasta = sumarDias(hoy, 90);
    for (const c of X.cursos.proximos) {
      if (c.inicio > hasta) continue;
      ev.push({ fecha: c.inicio, tipo: 'curso', titulo: c.nombre + ' · ' + c.vendidos + '/' + c.max + ' vendidos',
        estado: c.libres === 0 ? 'lleno' : (c.vendidos === 0 ? 'vacio' : 'parcial'), nivel: c.nivel });
    }
    for (const l of X.lic.relevantes) {
      if (l.cierre.slice(0, 10) > hasta) continue;
      ev.push({ fecha: l.cierre.slice(0, 10), tipo: 'licitacion', titulo: 'Cierra: ' + l.nombre.slice(0, 70).toLowerCase(),
        estado: l.encaje, url: l.url });
    }
    for (let i = 0; i < 4; i++) {
      const d = fecha(hoy); d.setDate(1); d.setMonth(d.getMonth() + i); d.setDate(20);
      const f = iso(d);
      if (f >= hoy && f <= hasta) {
        const prev = new Date(d); prev.setMonth(prev.getMonth() - 1);
        ev.push({ fecha: f, tipo: 'impuesto', titulo: 'Vence el F29 de ' + MESES[prev.getMonth()] + ' (IVA, PPM y retenciones)', estado: 'tributario' });
      }
    }
    for (const p of X.porCobrar.filter(x => x.grupo === 'por_vencer' && x.vence >= hoy && x.vence <= hasta))
      ev.push({ fecha: p.vence, tipo: 'cobro', titulo: 'Vence la factura ' + p.folio + ' de ' + p.cliente + ' · ' + mm(p.saldo), estado: 'por cobrar' });
    if (X.comercial) for (const e of X.comercial.eventos) if (e.fecha <= hasta) ev.push(e);
    const fijos = [
      { fecha: '2026-12-31', tipo: 'hito', titulo: 'Cierre 2026 · se fijan precios y fechas de 2027', estado: 'hito' },
      { fecha: '2027-01-06', tipo: 'hito', titulo: 'Primer Nivel 1 de 2027 a ' + clp(D.modelo.precios_2027.nivel1), estado: 'hito' },
      { fecha: '2027-03-31', tipo: 'hito', titulo: 'Gatillo del plan: si el B2B ene–mar promedia < ' + mm(D.modelo.b2b_minimo_mes) + ', plan B', estado: 'hito' },
    ];
    for (const f of fijos) if (f.fecha >= hoy) ev.push(f);
    return ev.sort((a, b) => a.fecha.localeCompare(b.fecha)).map(e => ({ ...e, dias: diasEntre(hoy, e.fecha) }));
  }

  /* ---------- BRIEFING: la voz de AerIA ---------- */
  function construirBriefing(D, X, alertas, hoy) {
    const { pasado, cursos, futuro, cot, lic, porCobrar, despues } = X;
    const u = pasado.meses[pasado.meses.length - 1];
    const criticas = alertas.filter(a => a.nivel === 'critica').length;
    const totalCobrar = porCobrar.filter(p => p.grupo === 'vencida').reduce((s, p) => s + p.saldo, 0);
    const porVencer = porCobrar.filter(p => p.grupo === 'por_vencer');
    const capUrg = lic.capacitacion.filter(l => l.horas <= 72);
    const titular = cursos.racha.length >= 4 && pasado.cajaFinal < D.modelo.costos_fijos_mes
      ? 'Aéreo vende bien y se queda sin caja'
      : (pasado.cajaFinal < D.modelo.costos_fijos_mes ? 'La caja es la prioridad' : 'La empresa está en ruta');
    const p = [];
    p.push('La escuela está en su mejor momento: el Nivel 1 se agotó ' + cursos.racha.length + ' meses seguidos y de las ' +
      cursos.resN1.fechas + ' fechas de Nivel 1 que vienen ya están vendidos ' + cursos.resN1.vendidos + ' de ' + cursos.resN1.cupos + ' cupos. ' +
      'En ' + pasado.meses.map(m => mesNombre(m.mes)).join(' y ') + ' la operación dejó ' + mm(pasado.flujoOperacional) + ' de caja.');
    // los hallazgos que el modelo marca como críticos se nombran con su propio título (texto del informe)
    const criticos = new Set(D.modelo.hallazgos_criticos || []);
    const hCrit = D.finanzas.hallazgos.filter(h => criticos.has(h.id));
    p.push('Pero esa caja no se quedó en la empresa: salieron ' + mm(-pasado.socioNeto) + ' netos a la cuenta del socio y ' +
      mm(-pasado.cofundador) + ' al cofundador (desde Aéreo OTEC entraron ' + mm(pasado.otec) + '). Al ' + fCorta(pasado.fechaCorte) + ' quedaban ' + clp(pasado.cajaFinal) +
      ': ' + futuro.runwayDias.toFixed(1).replace('.', ',') + ' días hábiles de costos fijos.' +
      (hCrit.length ? ' Lo más urgente del informe: ' + hCrit.map(h => h.titulo.replace(/\.$/, '').replace(/^./, c => c.toLowerCase())).join('; ') + '.' : ''));
    const com = X.comercial;
    const f0 = com && com.total ? com.pronostico.meses[0] : null;
    p.push('Hacia 2027 el punto es el B2B. En ' + mesNombre(u.mes) + ' le vendiste ' + mm(u.b2b) + ' a empresas e instituciones; el equilibrio del plan es ' +
      mm(futuro.equilibrio) + ' al mes y la meta ' + mm(D.modelo.b2b_meta_mes) + '. ' +
      (despues && despues.b2bN ? 'Después del corte, al ' + fCorta(despues.hasta) + ', el SII ya trae ' + mm(despues.b2b) + ' sin IVA facturados a empresas e instituciones (' + despues.b2bN + (despues.b2bN === 1 ? ' factura' : ' facturas') + ', sin contar cupos sueltos)' +
        (despues.b2b >= D.modelo.b2b_meta_mes ? ', sobre la meta del mes' : despues.b2b >= futuro.equilibrio ? ', sobre el equilibrio' : '') + '. ' : '') +
      (dashboardConectado(com)
        ? 'En Comercial tienes ' + com.abiertas.n + ' cotizaciones abiertas por ' + mm(com.abiertas.monto) + ' (~' + mm(com.abiertas.ponderado) + ' ponderado), en los últimos 90 días ganaste ' + mm(com.ganadas.ultimos90) +
          ' y para ' + f0.etiqueta + ' espero ' + mm(f0.total) + ' de venta B2B'
        : 'Tu dashboard reportaba ' + mm(cot.abiertasMonto) + ' en cotizaciones abiertas al ' + fCorta(cot.corte) + (cot.esperado ? ' (~' + mm(cot.esperado) + ' esperables)' : '') +
          ', pero su detalle aún no entra a AerIA' + (com && com.total ? '; lo que sí tengo (' + com.total + ' negocios desde SII, Notion y el plan) suma ' + mm(com.ganadas.ultimos90) + ' ganado en 90 días' : '')) +
      '. Además hay ' + lic.relevantes.length + ' licitaciones abiertas que calzan con lo que hace Aéreo.');
    const hoyTxt = [];
    if (!dashboardConectado(com)) hoyTxt.push('conectar el dashboard comercial a AerIA');
    if (capUrg.length) hoyTxt.push('ofertar a ' + capUrg.length + (capUrg.length === 1 ? ' licitación' : ' licitaciones') + ' de capacitación que ' + (capUrg.length === 1 ? 'cierra' : 'cierran') + ' en menos de 72 horas');
    if (totalCobrar) hoyTxt.push('cobrar ' + mm(totalCobrar) + ' vencidos');
    if (porVencer.length) hoyTxt.push('seguir ' + mm(porVencer.reduce((s, x) => s + x.saldo, 0)) + ' facturados que vencen entre el ' + fCorta(porVencer.map(x => x.vence).sort()[0]) + ' y el ' + fCorta(porVencer.map(x => x.vence).sort().pop()));
    if (hCrit.length) hoyTxt.push('resolver ' + (hCrit.length === 1 ? 'el hallazgo crítico' : 'los ' + hCrit.length + ' hallazgos críticos') + ' de finanzas');
    if (pasado.cajaFinal < D.modelo.costos_fijos_mes) hoyTxt.push('fijar un saldo mínimo de caja');
    p.push('Mi recomendación para esta semana: ' + (hoyTxt.length > 1 ? hoyTxt.slice(0, -1).join(', ') + ' y ' + hoyTxt[hoyTxt.length - 1] : hoyTxt[0]) + '.');
    return { titular, parrafos: p, criticas };
  }

  /* ---------- EN SIMPLE: la empresa contada con palabras de todos los días ----------
     Cada tema es una pregunta que se responde en una frase y se abre paso a paso:
     por qué, qué hacer y los números. Nada se calcula aquí que no venga de analizar;
     solo se elige qué decir y cómo. Sin jerga: «ventas a empresas» en vez de B2B,
     «lo mínimo para no perder plata» en vez de equilibrio, «lo probable» en vez de ponderado. */
  function fDia(s) { const d = fecha(s); return d.getDate() + ' de ' + MESES[d.getMonth()]; }
  const yLista = a => a.length > 1 ? a.slice(0, -1).join(', ') + ' y ' + a[a.length - 1] : (a[0] || '');
  const mayus = t => String(t || '').replace(/^./, c => c.toUpperCase());
  const sinJerga = t => String(t || '').replace(/\bel B2B\b/g, 'la venta a empresas').replace(/\bB2B\b/g, 'venta a empresas');
  function diasTxt(n) { const r = Math.round(n); return n < 1 ? 'menos de un día' : r === 1 ? 'un día' : 'unos ' + r + ' días'; }
  function explicar(D, I) {
    const { pasado: P, futuro: U, cursos: Cu, lic, porCobrar, despues: Dp, comercial: R } = I;
    const Mo = D.modelo;
    const conectado = dashboardConectado(R);
    const hayCom = !!(R && R.total);
    const cot = id => hayCom ? R.cotizaciones.find(q => q.id === id) : null;
    // una tarea de la agenda dicha en simple: un seguimiento es «llamar a quién y por cuánto»
    const tareaSimple = it => {
      const q = it.cotizacion && cot(it.cotizacion);
      if (q && /^com-seg-/.test(it.id)) return 'Llamar a ' + q.cliente + ' por su cotización de ' + mm(q.monto);
      if (q && /^com-fac-/.test(it.id)) return 'Facturar la venta a ' + q.cliente + ' (' + mm(q.monto) + ') o anotar su factura';
      return sinJerga(it.titulo);
    };
    const hacerDe = (f, n) => I.agenda.filter(f).slice(0, n || 3).map(it => ({ id: it.id, texto: tareaSimple(it), cotizacion: it.cotizacion || '' }));
    const nivelAlerta = id => (I.alertas.find(a => a.id === id) || {}).nivel;
    const temas = [];

    // 1) la plata en el banco
    const salioSocios = -((P.socioNeto || 0) + (P.cofundador || 0));
    const corteViejo = diasEntre(P.fechaCorte, I.hoy) > 7;
    const meses = P.meses.map(m => mesNombre(m.mes));
    temas.push({
      id: 'plata', pregunta: '¿Cuánta plata tenemos?',
      semaforo: P.cajaFinal < Mo.costos_fijos_mes ? (U.runwayDias < 10 ? 'urgente' : 'ojo') : 'bien',
      frase: 'Al ' + fDia(P.fechaCorte) + ' había ' + clp(P.cajaFinal) + ' en el banco. Alcanza para ' + diasTxt(U.runwayDias) + ' de trabajo.',
      porque: [
        P.flujoOperacional >= 0
          ? 'En ' + yLista(meses) + ' la escuela y las ventas dejaron ' + mm(P.flujoOperacional) + ' a favor: entró más plata de la que se gastó en operar.'
          : 'En ' + yLista(meses) + ' se gastó en operar ' + mm(-P.flujoOperacional) + ' más de lo que entró.',
        salioSocios > 0 ? 'Pero salieron ' + mm(salioSocios) + ' a los socios, así que esa plata no se quedó en la empresa.' : null,
        'El plan pide tener siempre en el banco al menos un mes de gastos fijos: ' + mm(Mo.costos_fijos_mes) + '.',
        corteViejo ? 'Es el último dato del banco que tengo. Si después entraron pagos, hoy debería haber más.' : null,
        Dp && Dp.cobradoRegistro ? 'Después del ' + fDia(P.fechaCorte) + ' tu registro de ventas anota ' + mm(Dp.cobradoRegistro) + ' cobrados; el banco todavía no lo confirma.' : null,
      ].filter(Boolean),
      hacer: hacerDe(it => it.id === 'caja' || (/^fin-/.test(it.id) && nivelAlerta(it.id) === 'critica')),
      numeros: [
        { l: 'Plata en el banco al ' + fCorta(P.fechaCorte), v: clp(P.cajaFinal), cls: P.cajaFinal < Mo.costos_fijos_mes ? 'mal' : '' },
        { l: 'Un mes de gastos fijos', v: mm(Mo.costos_fijos_mes, 2) },
        { l: 'Lo que dejó la operación', s: P.etiqueta, v: mm(P.flujoOperacional), cls: P.flujoOperacional >= 0 ? 'bien' : 'mal' },
        { l: 'Lo que salió a los socios', s: P.etiqueta, v: mm(-salioSocios), cls: salioSocios > 0 ? 'mal' : '' },
      ],
      detalle: { tab: 'pasado', texto: 'Ver la plata en detalle' },
      fuente: 'cartolas del banco, SII y Mercado Pago (' + P.etiqueta + ')',
    });

    // 2) las ventas a empresas, las que deciden 2027
    const u = P.meses[P.meses.length - 1];
    const f0 = hayCom ? R.pronostico.meses[0] : null, f1 = hayCom ? R.pronostico.meses[1] : null;
    const mesHoy = MESES[fecha(I.hoy).getMonth()];
    const facturadoMes = Dp && Dp.b2bN && String(Dp.hasta).slice(0, 7) === I.hoy.slice(0, 7) ? Dp.b2b : null;
    const base = conectado && f0 ? Math.max(f0.total, facturadoMes || 0) : (facturadoMes != null ? facturadoMes : u.b2b);
    const comoVa = v => v >= Mo.b2b_meta_mes ? 'sobre la meta del mes' : v >= U.equilibrio ? 'sobre lo mínimo para no perder plata' : 'bajo lo mínimo para no perder plata';
    const flojo = conectado && f1 && f1.total < U.equilibrio;
    temas.push({
      id: 'ventas', pregunta: '¿Cuánto le vendemos a empresas?',
      semaforo: base >= U.equilibrio ? (flojo ? 'ojo' : 'bien') : base >= Mo.b2b_minimo_mes ? 'ojo' : 'urgente',
      frase: (facturadoMes != null
        ? 'En ' + mesHoy + ' ya facturaste ' + mm(facturadoMes) + ' a empresas e instituciones: ' + comoVa(facturadoMes) + '.'
        : 'En ' + mesNombre(u.mes) + ' le vendiste ' + mm(u.b2b) + ' a empresas e instituciones: ' + comoVa(u.b2b) + '.') +
        (flojo ? ' ' + mayus(mesNombre(f1.mes)) + ' se ve más flojo.' : ''),
      porque: [
        'Las ventas a empresas (cursos cerrados, SENCE, asesorías y servicios con drones) son las que deciden si 2027 deja plata.',
        'Hay que venderles ' + mm(U.equilibrio) + ' al mes para no perder plata, y la meta es ' + mm(Mo.b2b_meta_mes) + '.',
        facturadoMes != null ? 'En ' + mesNombre(u.mes) + ' fueron ' + mm(u.b2b) + '.' : null,
        flojo ? (f1.ganado > 0 ? 'Para ' + mesNombre(f1.mes) + ' llevas ' + mm(f1.ganado) + ' ganados, y de lo cotizado lo probable es cerrar ' + mm(f1.esperado) + ' más: ' + mm(f1.total) + ' en total.'
          : 'Para ' + mesNombre(f1.mes) + ' todavía no hay nada ganado; de lo cotizado, lo probable es cerrar ' + mm(f1.esperado) + '.') : null,
      ].filter(Boolean),
      hacer: hacerDe(it => /^com-pronostico-|^b2b-|^preventa$/.test(it.id)),
      numeros: [
        facturadoMes != null ? { l: 'Facturado a empresas en ' + mesHoy, s: 'al ' + fCorta(Dp.hasta) + ', sin IVA', v: mm(facturadoMes), cls: facturadoMes >= U.equilibrio ? 'bien' : '' } : null,
        { l: 'Vendido a empresas en ' + mesNombre(u.mes), v: mm(u.b2b), cls: u.b2b >= U.equilibrio ? 'bien' : 'mal' },
        { l: 'Lo mínimo al mes para no perder plata', v: mm(U.equilibrio) },
        { l: 'La meta al mes', v: mm(Mo.b2b_meta_mes) },
        conectado && f1 ? { l: 'Lo que se espera para ' + mesNombre(f1.mes), s: 'ganado + lo probable de lo cotizado', v: mm(f1.total), cls: f1.total < U.equilibrio ? 'mal' : 'bien' } : null,
      ].filter(Boolean),
      detalle: { tab: 'comercial', texto: 'Ver las ventas' },
      fuente: 'SII, cartolas y cotizaciones de Comercial; mínimo y meta del plan 2027',
    });

    // 3) los clientes que están por decidir (lo que el equipo tiene en curso)
    if (hayCom) {
      const ab = R.cotizaciones.filter(q => q.abierta && !q.estancada);
      const frias = ab.filter(q => q.diasSinContacto != null && q.diasSinContacto > 14);
      const tasa = R.tasa && (R.tasa.cantidad != null ? R.tasa.cantidad : R.tasa.monto);
      temas.push({
        id: 'clientes', pregunta: '¿Qué clientes están por decidir?',
        semaforo: frias.length >= 3 ? 'ojo' : ab.length ? 'bien' : 'ojo',
        frase: ab.length
          ? 'Hay ' + ab.length + (ab.length === 1 ? ' cotización esperando respuesta' : ' cotizaciones esperando respuesta') + ' por ' + mm(ab.reduce((a, q) => a + (q.monto || 0), 0)) + '.' +
            (frias.length ? ' ' + (frias.length === 1 ? 'Una lleva' : frias.length + ' llevan') + ' más de 2 semanas sin contacto.' : '')
          : 'No hay cotizaciones esperando respuesta: conviene cotizar más.',
        porque: [
          ab.length ? 'De eso, lo probable es cerrar unos ' + mm(R.abiertas.ponderado) + ', según la probabilidad de cada una.' : null,
          tasa != null && R.tasa.muestra ? 'De cada 10 cotizaciones que los clientes deciden, ganas ' + Math.round(tasa * 10) + '.' : null,
          R.ciclo != null ? 'Una venta tarda unos ' + Math.round(R.ciclo) + ' días desde que envías la cotización.' : null,
          frias.length ? 'Una cotización que nadie sigue se enfría: llamar a tiempo es lo que más ayuda a cerrarla.' : null,
          R.abiertas.estancadas ? (R.abiertas.estancadas === 1 ? 'Una cotización lleva' : R.abiertas.estancadas + ' cotizaciones llevan') + ' tanto tiempo quieta que ya no la cuento como probable.' : null,
          lic && lic.relevantes.length ? 'Además hay ' + lic.relevantes.length + (lic.relevantes.length === 1 ? ' licitación del Estado abierta que calza' : ' licitaciones del Estado abiertas que calzan') + ' con lo que hace Aéreo.' : null,
        ].filter(Boolean),
        hacer: hacerDe(it => /^com-seg-|^lic-/.test(it.id)),
        numeros: [
          { l: 'Esperando respuesta', s: ab.length + ' cotizaciones', v: mm(ab.reduce((a, q) => a + (q.monto || 0), 0)) },
          { l: 'Lo probable de cerrar', v: mm(R.abiertas.ponderado) },
          { l: 'Ganado en los últimos 90 días', v: mm(R.ganadas.ultimos90), cls: 'bien' },
          tasa != null && R.tasa.muestra ? { l: 'De cada 10 que se deciden, ganas', v: String(Math.round(tasa * 10)) } : null,
          R.ciclo != null ? { l: 'Días que tarda una venta', v: String(Math.round(R.ciclo)) } : null,
        ].filter(Boolean),
        detalle: { tab: 'comercial', texto: 'Ver las cotizaciones' },
        fuente: 'cotizaciones de Comercial' + (conectado ? ' (tu dashboard)' : ''),
      });
    }

    // 4) lo que nos deben
    const suma = l => l.reduce((a, p) => a + p.saldo, 0);
    const venc = porCobrar.filter(p => p.grupo === 'vencida'), pv = porCobrar.filter(p => p.grupo === 'por_vencer'), conf = porCobrar.filter(p => p.grupo === 'por_confirmar');
    const sinFac = hayCom ? (R.ganadas.sinFactura || []) : [];
    const totalCobrar = suma(porCobrar);
    const top = porCobrar.slice().sort((a, b) => b.saldo - a.saldo)[0];
    const vences = pv.map(p => p.vence).sort();
    temas.push({
      id: 'cobros', pregunta: '¿Quién nos debe plata?',
      semaforo: venc.length ? 'urgente' : (conf.length || sinFac.length) ? 'ojo' : 'bien',
      frase: totalCobrar
        ? 'Te deben ' + mm(totalCobrar) + ' en facturas.' + (venc.length ? ' ' + mm(suma(venc)) + ' ya pasaron su plazo de pago.' : pv.length ? ' Lo grueso (' + mm(suma(pv)) + ') vence entre el ' + fDia(vences[0]) + ' y el ' + fDia(vences[vences.length - 1]) + '.' : '')
        : 'No hay facturas pendientes de cobro en lo que tengo.',
      porque: [
        totalCobrar ? 'Son facturas que ya emitiste y el cliente todavía no paga. El plazo normal es de ' + (Mo.plazo_cobro_dias || 30) + ' días.' : null,
        top ? 'La más grande es de ' + top.cliente + ': ' + mm(top.saldo) + '.' : null,
        conf.length ? 'De ' + mm(suma(conf)) + ' no está claro si ya se pagaron (por ejemplo, una factura que se le vendió a una financiera): hay que confirmarlo.' : null,
        sinFac.length ? (sinFac.length === 1 ? 'Una venta ganada no tiene' : sinFac.length + ' ventas ganadas no tienen') + ' factura anotada (' + mm(sinFac.reduce((a, q) => a + (q.monto || 0), 0)) + '): falta facturar o anotar el número en Comercial.' : null,
      ].filter(Boolean),
      hacer: hacerDe(it => /^cobrar|^com-fac-|^com-cobrar-/.test(it.id)),
      numeros: [
        { l: 'Atrasado', s: 'ya pasó el plazo de pago', v: mm(suma(venc)), cls: venc.length ? 'mal' : '' },
        { l: 'Vence pronto', s: pv.length ? 'entre el ' + fCorta(vences[0]) + ' y el ' + fCorta(vences[vences.length - 1]) : '', v: mm(suma(pv)) },
        { l: 'Por confirmar', s: 'no está claro si ya se pagó', v: mm(suma(conf)) },
        sinFac.length ? { l: 'Ventas ganadas sin factura anotada', s: sinFac.length + ' ventas', v: mm(sinFac.reduce((a, q) => a + (q.monto || 0), 0)) } : null,
      ].filter(Boolean),
      detalle: { tab: 'presente', texto: 'Ver quién debe' },
      fuente: 'SII y cartolas' + (D.finanzas.sii_hasta ? ' (SII al ' + fCorta(D.finanzas.sii_hasta) + ')' : '') + ', y ventas ganadas de Comercial',
    });

    // 5) los cursos abiertos
    const prox = Cu.proximos.filter(c => c.dias >= 0);
    const pronto = prox.filter(c => c.dias <= 21 && c.libres >= 3).slice(0, 2);
    const feriados = prox.filter(c => c.feriados.length);
    const vacios = prox.filter(c => c.vendidos === 0 && c.dias > 21);
    const vend = Cu.resN1.vendidos + Cu.resN23.vendidos, cup = Cu.resN1.cupos + Cu.resN23.cupos, libres = Cu.resN1.libres + Cu.resN23.libres;
    temas.push({
      id: 'cursos', pregunta: '¿Cómo van los cursos?',
      semaforo: feriados.length || pronto.some(c => c.dias <= 10) ? 'ojo' : 'bien',
      frase: (Cu.racha.length >= 3 ? 'El Nivel 1 se agotó ' + Cu.racha.length + ' meses seguidos. ' : '') +
        'De las próximas fechas ya vendiste ' + vend + ' de ' + cup + ' cupos.',
      porque: [
        libres ? 'Quedan ' + libres + ' cupos libres; a precio de hoy son ' + mm(Cu.resN1.libreMonto + Cu.resN23.libreMonto) + '.' : null,
        ...pronto.map(c => 'El ' + c.corto + ' del ' + fDia(c.inicio) + ' tiene ' + c.libres + ' de ' + c.max + ' cupos libres y empieza ' + cuando(c.dias) + '.'),
        ...feriados.slice(0, 2).map(c => 'El ' + c.corto + ' del ' + fDia(c.inicio) + ' cae en feriado (' + c.feriados[0].nombre + '): hay que moverlo.'),
        vacios.length >= 3 ? 'Hay ' + vacios.length + ' fechas sin ningún cupo vendido todavía.' : null,
      ].filter(Boolean),
      hacer: hacerDe(it => /^feriado-|^vender-|^preventa$/.test(it.id)),
      numeros: [
        { l: 'Nivel 1: cupos vendidos', s: Cu.resN1.fechas + ' fechas publicadas', v: Cu.resN1.vendidos + ' de ' + Cu.resN1.cupos },
        { l: 'Niveles 2 y 3: cupos vendidos', s: Cu.resN23.fechas + ' fechas publicadas', v: Cu.resN23.vendidos + ' de ' + Cu.resN23.cupos },
        { l: 'Cupos libres', s: 'a precio de hoy', v: mm(Cu.resN1.libreMonto + Cu.resN23.libreMonto) },
      ],
      detalle: { tab: 'presente', texto: 'Ver los cursos' },
      fuente: 'cursos publicados en aereo.cl',
    });

    // 6) 2027
    const ritmo = U.escenarios.find(e => e.id === 'ultimo');
    const b2bAl = I.alertas.find(a => /^b2b-/.test(a.id));
    temas.push({
      id: 'futuro', pregunta: '¿Cómo se ve 2027?',
      semaforo: ritmo.resultado < 0 ? 'ojo' : 'bien',
      frase: 'Si 2027 se vende como ' + mesNombre(u.mes) + ', el año cerraría ' + (ritmo.resultado < 0 ? 'perdiendo ' + mm(-ritmo.resultado) : 'ganando ' + mm(ritmo.resultado)) +
        '. Para no perder hay que venderles ' + mm(U.equilibrio) + ' al mes a empresas.',
      porque: [
        'Los gastos fijos de un año suman ' + mm(Mo.costos_fijos_anio) + '. Los cursos abiertos y las medidas del plan ayudan, pero el resto tiene que venir de ventas a empresas.',
        'Cada millón más al mes en ventas a empresas deja ' + mm(12e6 * Mo.margen_b2b) + ' más en el año.',
        'El ' + fDia(U.hito.fecha) + ' es el día clave (faltan ' + U.diasHito + ' días): ' + sinJerga(U.hito.regla).replace(/^./, c => c.toLowerCase()),
      ],
      hacer: b2bAl ? [{ id: b2bAl.id, texto: sinJerga(b2bAl.accion.split(/(?<=\.)\s/)[0]) }] : [],
      numeros: [
        { l: 'Resultado de 2027 al ritmo de ' + mesNombre(u.mes), v: mm(ritmo.resultado), cls: ritmo.resultado < 0 ? 'mal' : 'bien' },
        { l: 'Venta a empresas para no perder', s: 'al mes', v: mm(U.equilibrio) },
        { l: 'Venta a empresas de la meta', s: 'al mes', v: mm(Mo.b2b_meta_mes) },
        { l: 'Días para el ' + fCorta(U.hito.fecha), v: String(U.diasHito) },
      ],
      detalle: { tab: 'futuro', texto: 'Ver 2027' },
      fuente: 'modelo del plan de rentabilidad 2027',
    });

    // lo que AerIA diría primero
    const t = id => temas.find(x => x.id === id);
    const titular = P.cajaFinal < Mo.costos_fijos_mes && Cu.racha.length >= 4 ? 'Vendes bien, pero falta plata en el banco'
      : P.cajaFinal < Mo.costos_fijos_mes ? 'Lo urgente es la plata en el banco'
      : ritmo.resultado < 0 ? 'Vas bien, pero 2027 pide vender más' : 'Aéreo va por buen camino';
    const urgentes = temas.filter(x => x.semaforo === 'urgente'), ojos = temas.filter(x => x.semaforo === 'ojo');
    const minus = s => s.replace(/^./, c => c.toLowerCase());
    // lo bueno se dice primero, aunque el tema tenga otra cosa que mirar
    const buenas = [
      Cu.racha.length >= 3 ? 'el Nivel 1 se agotó ' + Cu.racha.length + ' meses seguidos' : null,
      facturadoMes != null && facturadoMes >= U.equilibrio ? 'en ' + mesHoy + ' ya facturaste ' + mm(facturadoMes) + ' a empresas, ' + comoVa(facturadoMes) : null,
      hayCom && R.ganadas.ultimos90 ? 'en los últimos 90 días ganaste ' + mm(R.ganadas.ultimos90) + ' en ventas' : null,
    ].filter(Boolean).slice(0, 2);
    const resumen = [
      buenas.length ? 'Lo bueno: ' + yLista(buenas) + '.' : null,
      urgentes.length ? 'Lo urgente: ' + minus(urgentes[0].frase) : ojos.length ? 'Para tener a la vista: ' + minus(ojos[0].frase) : null,
      'Abajo te lo cuento por partes. Abre cada pregunta para ver el porqué, qué hacer y los números.',
    ].filter(Boolean);
    const tareas = I.agenda.map(it => ({ id: it.id, texto: tareaSimple(it), por: sinJerga(it.por), cuando: it.cuando, cotizacion: it.cotizacion || '', url: it.url || '' }));
    const pestanas = {
      pasado: { texto: [t('plata').frase].concat(t('plata').porque.slice(0, 2)), datos: [
        { l: 'Entró por la operación', s: P.etiqueta, v: mm(P.ingresos) },
        { l: 'Se gastó en operar', s: P.etiqueta, v: mm(Math.abs(P.egresos)) },
        { l: 'Quedó a favor', s: 'antes de los socios', v: mm(P.flujoOperacional), cls: P.flujoOperacional >= 0 ? 'bien' : 'mal' },
        { l: 'Salió a los socios', v: mm(-salioSocios), cls: salioSocios > 0 ? 'mal' : '' },
        { l: 'En el banco al ' + fCorta(P.fechaCorte), v: clp(P.cajaFinal), cls: P.cajaFinal < Mo.costos_fijos_mes ? 'mal' : '' },
      ] },
      presente: { texto: [t('cursos').frase, t('cobros').frase, lic && lic.relevantes.length ? 'Hay ' + lic.relevantes.length + (lic.relevantes.length === 1 ? ' licitación del Estado abierta que calza' : ' licitaciones del Estado abiertas que calzan') + ' con lo que hace Aéreo.' : null].filter(Boolean), datos: [
        { l: 'Nivel 1 vendido', v: Cu.resN1.vendidos + ' de ' + Cu.resN1.cupos, s: 'cupos de las próximas fechas' },
        { l: 'Niveles 2 y 3 vendido', v: Cu.resN23.vendidos + ' de ' + Cu.resN23.cupos, s: 'cupos de las próximas fechas' },
        { l: 'Te deben', v: mm(totalCobrar), s: venc.length ? mm(suma(venc)) + ' atrasado' : 'nada atrasado', cls: venc.length ? 'mal' : '' },
        { l: 'Licitaciones que calzan', v: String(lic ? lic.relevantes.length : 0) },
      ] },
      comercial: { texto: [t('ventas').frase].concat(t('clientes') ? [t('clientes').frase] : []), datos: t('clientes') ? t('clientes').numeros.slice(0, 4) : [] },
      futuro: { texto: [t('futuro').frase].concat(t('futuro').porque.slice(0, 2)), datos: t('futuro').numeros },
    };
    return { titular, resumen, temas, tareas, pestanas };
  }

  /* ---------- análisis completo ---------- */
  function analizar(D, hoy, ahora) {
    hoy = hoy || iso(new Date());
    ahora = ahora || new Date();
    const pasado = leerPasado(D.finanzas);
    const cursos = leerCursos(D.cursos, hoy);
    const lic = leerLicitaciones(D.licitaciones, ahora);
    const cot = leerCotizaciones(D.cotizaciones, hoy);
    const porCobrar = leerPorCobrar(D.finanzas, hoy, D.modelo.plazo_cobro_dias);
    const despues = leerDespues(D.finanzas, D.cursos && D.cursos.precios_web);
    const cruce = cruzarPorCobrarPlan(D.plan, D.finanzas);
    const equilibrio = resultado2027(D.modelo, 0).equilibrio;
    const conectado = !!(D.comercial && deDashboard(D.comercial.cotizaciones));
    const comercial = Com && D.comercial ? Com.analizar(D.comercial.cotizaciones || [], hoy, {
      meta: D.modelo.b2b_meta_mes, minimo: D.modelo.b2b_minimo_mes, equilibrio,
      sii: D.finanzas.sii, siiCorte: D.finanzas.sii_hasta || D.finanzas.periodo.hasta, clientes: D.comercial.clientes || [],
      tasaReferencia: !conectado && D.cotizaciones.tasa_cierre_monto ? { valor: D.cotizaciones.tasa_cierre_monto, corte: D.cotizaciones.corte } : null,
      conectado,
    }) : null;
    const futuro = leerFuturo(D.modelo, pasado, hoy, comercial);
    const tablero = leerTablero(D.modelo, pasado, cursos, D, comercial);
    const X = { pasado, cursos, lic, cot, porCobrar, cruce, futuro, tablero, comercial, despues };
    const alertas = construirAlertas(D, X, hoy, ahora);
    const agenda = construirAgenda(D, X, alertas, hoy);
    const viene = construirViene(D, X, hoy);
    const briefing = construirBriefing(D, X, alertas, hoy);
    const R0 = { hoy, ...X, alertas, agenda, viene, briefing };
    R0.simple = explicar(D, R0);
    return R0;
  }

  /* ---------- consultas para el chat (herramientas de AerIA) ---------- */
  function buscarMovimientos(D, q) {
    const texto = plano(q.texto || '');
    let r = D.finanzas.movs.filter(m =>
      (!texto || plano(m.desc + ' ' + m.contra + ' ' + m.nota + ' ' + (D.finanzas.cats[m.cat] || {}).label).includes(texto)) &&
      (!q.categoria || m.cat === q.categoria) &&
      (!q.mes || m.mes === q.mes) &&
      (!q.tipo || (q.tipo === 'ingreso' ? m.monto > 0 : m.monto < 0)) &&
      (!q.monto_minimo || Math.abs(m.monto) >= Number(q.monto_minimo)));
    const total = r.reduce((a, m) => a + m.monto, 0);
    const n = r.length;
    r = r.sort((a, b) => Math.abs(b.monto) - Math.abs(a.monto)).slice(0, Number(q.limite) || 30);
    return {
      encontrados: n, suma: total, mostrando: r.length,
      movimientos: r.map(m => ({ fecha: m.fecha, cuenta: m.cta, monto: m.monto, glosa: m.desc, contraparte: m.contra, categoria: (D.finanzas.cats[m.cat] || {}).label, nota: m.nota || undefined })),
    };
  }

  function resumenParaIA(D, I) {
    const L = [];
    const { pasado, cursos, futuro, cot, lic, porCobrar, tablero } = I;
    L.push('FECHA DE HOY: ' + fLarga(I.hoy) + ' de ' + I.hoy.slice(0, 4) + ' (' + I.hoy + ').');
    L.push('\n## PASADO · Finanzas ' + D.finanzas.periodo.desde + ' a ' + D.finanzas.periodo.hasta + ' (cartolas ' + nombresCuentas(D.finanzas) + ', SII, Mercado Pago; corte ' + pasado.fechaCorte + ')');
    for (const m of pasado.meses) {
      L.push('- ' + mesNombre(m.mes) + ': ingresos operacionales ' + clp(m.ingresos) + ', egresos operacionales ' + clp(m.egresos) +
        ', flujo operacional ' + clp(m.flujo) + '; socio neto ' + clp(m.socio) + ', cofundador ' + clp(m.cofundador) + ', Aéreo OTEC ' + clp(m.otec) +
        '; caja a fin de mes ' + clp(m.cajaFin) + '; venta B2B ' + clp(m.b2b) + ', escuela ' + clp(m.escuela) +
        ' (N1 ' + m.unidades.n1 + ', Pack ' + m.unidades.pack + ', N2+3 ' + m.unidades.n23 + '); marketing ' + clp(m.marketing) + '; facturado SII neto ' + clp(m.facturado) + '.');
    }
    L.push('- Caja: ' + clp(pasado.cajaInicial) + ' al 31-07 → ' + clp(pasado.cajaFinal) + ' al ' + pasado.fechaCorte + '. Caja más baja: ' + clp(pasado.cajaMin.total) + ' el ' + pasado.cajaMin.fecha + ' (' + Object.entries(cuentas(D.finanzas)).map(([k, n]) => n + ' ' + clp(pasado.cajaMin[k.toLowerCase()] || 0)).join(', ') + ')' +
      (D.finanzas.caja_minima ? '; ' + (cuentas(D.finanzas).SAN || 'la cuenta principal') + ' quedó en ' + clp(D.finanzas.caja_minima.san) + ' el ' + D.finanzas.caja_minima.fecha : '') + '.');
    L.push('- Egresos por categoría (2 meses): ' + pasado.egresosCat.map(e => e.label + ' ' + clp(e.monto)).join('; ') + '.');
    L.push('- Hallazgos del informe (' + D.finanzas.hallazgos.length + '): ' + D.finanzas.hallazgos.map(h => '[' + h.sev + '] ' + h.titulo + (h.monto ? ' (' + clp(h.monto) + ')' : '')).join('; ') + '.');
    L.push('\n## PRESENTE');
    L.push('- Cursos publicados en aereo.cl (precio actual N1 ' + clp(D.cursos.precios_web.nivel1) + ', N2+3 ' + clp(D.cursos.precios_web.nivel23) + ', Pack ' + clp(D.cursos.precios_web.pack) + '; 6 cupos por curso). Meses agotados 2026: ' + cursos.racha.map(m => MESES[m]).join(', ') + '.');
    for (const c of cursos.proximos) L.push('  · ' + c.nombre + ' ' + c.inicio + (c.nivel === 'n1' ? '→' + c.fin : '/' + c.fin) + ': ' + c.vendidos + '/' + c.max + ' vendidos' + (c.feriados.length ? ' — FERIADO ' + c.feriados.map(f => f.fecha + ' ' + f.nombre).join(', ') : ''));
    L.push('- Agregado del dashboard comercial (' + (dashboardConectado(I.comercial) ? 'ya reemplazado por el detalle en Comercial' : 'su detalle aún no está en AerIA') + ', corte ' + cot.corte + '): abiertas ' + clp(cot.abiertasMonto) + ', cierre por monto ' + (cot.tasaCierre ? pct(cot.tasaCierre) : '?') + (cot.esperado ? ', esperable ' + clp(cot.esperado) : '') + '. ' + cot.notas.join(' '));
    if (cot.mayores.length) L.push('  Mayores abiertas: ' + cot.mayores.map(i => (i.cliente || '?') + ' ' + clp(i.monto) + ' [' + (i.estado || '') + ']').join('; '));
    const GR = { vencida: 'vencida', por_vencer: 'por vencer', por_confirmar: 'por confirmar' };
    L.push('- Por cobrar (banco + SII + registro interno; plazo de pago ' + (D.modelo.plazo_cobro_dias || 30) + ' días): ' + porCobrar.map(p => p.cliente + ' f.' + p.folio + ' ' + clp(p.saldo) + ' [' + GR[p.grupo] + (p.grupo === 'por_vencer' ? ', vence ' + p.vence : '') + '] — ' + p.tipoDeuda).join('; ') + '.');
    if (I.despues) {
      const d = I.despues;
      L.push('- Después del corte de las cartolas (SII y registro interno al ' + d.hasta + '): ' + d.n + ' facturas nuevas por ' + clp(d.monto) + (d.b2bN ? ', de ellas ' + d.b2bN + ' a empresas e instituciones por ' + clp(d.b2b) + ' sin IVA (sin contar cupos sueltos)' : '') +
        (d.iva ? '; IVA débito de facturas afectas ' + clp(d.iva) + ' (va al F29 del mes siguiente)' : '') + (d.tardias ? '; además ' + d.tardias + ' facturas emitidas tarde por ventas cobradas en el período (' + clp(d.tardiasMonto) + ')' : '') +
        (d.ventasRegistro ? '. Registro interno: ventas posteriores ' + clp(d.ventasRegistro) + ', cobrado ' + clp(d.cobradoRegistro) + ', pendiente ' + clp(d.pendienteRegistro) : '') + '.');
    }
    L.push('- Licitaciones abiertas que calzan (' + lic.relevantes.length + ' de ' + lic.abiertas.length + '): ' + lic.relevantes.map(l => l.encaje_label + ' · ' + l.nombre.slice(0, 80) + ' · ' + l.organismo + ' · ' + (l.monto ? clp(l.monto) : 's/monto') + ' · cierra ' + l.cierre.slice(0, 16)).join(' | '));
    if (Com && I.comercial) L.push('\n' + Com.resumenParaIA(I.comercial));
    L.push('\n## FUTURO · Plan 2027');
    const M = D.modelo;
    L.push('- Modelo: costos fijos ' + clp(M.costos_fijos_mes) + '/mes (' + clp(M.costos_fijos_anio) + '/año, ' + clp(M.costo_dia_habil) + ' por día hábil); margen B2B ' + pct(M.margen_b2b, 1) + '; margen escuela ' + clp(M.margen_escuela.realista) + ' realista / ' + clp(M.margen_escuela.llena) + ' llena. Resultado = margen escuela + 12×B2B×0,675 + palancas − fijos.');
    L.push('- Palancas: ' + M.palancas.map(p => p.nombre + ' +' + clp(p.efecto) + ' [' + p.estado + ']').join('; ') + '.');
    L.push('- Escenarios: ' + futuro.escenarios.map(e => e.nombre + ' (B2B ' + clp(e.b2b) + '/mes) → ' + clp(e.resultado)).join('; ') + '. Equilibrio ' + clp(futuro.equilibrio) + '/mes; con plan B ' + clp(futuro.equilibrioPlanB) + '.');
    L.push('- Precios 2027: N1 ' + clp(M.precios_2027.nivel1) + ', N2+3 ' + clp(M.precios_2027.nivel23) + ', Pack ' + clp(M.precios_2027.pack) + ', revalidación ' + clp(M.precios_2027.revalidacion) + ', SENCE ' + clp(M.precios_2027.sence_participante) + '/participante.');
    L.push('- Hito: ' + M.hito_decisivo.fecha + ' — ' + M.hito_decisivo.regla);
    L.push('- Tablero mensual: ' + tablero.map(t => t.indicador + ': ' + t.valor + ' (meta ' + t.meta + ', ' + t.estado + ')').join('; ') + '.');
    const sit = D.plan && D.plan.secciones.find(s => /situaci/i.test(s.titulo));
    if (sit) L.push('- Lectura del plan: ' + [...sit.parrafos, ...sit.listas.flat()].join(' '));
    L.push('\n## ALERTAS ACTIVAS (de AerIA)');
    for (const a of I.alertas) L.push('- [' + a.nivel + '|' + a.foco + '] ' + a.titulo + ' → ' + a.accion);
    if (D.notas && D.notas.length) {
      L.push('\n## MEMORIA: decisiones y contexto que te dio el usuario');
      for (const n of D.notas) L.push('- (' + (n.fecha || '').slice(0, 10) + ') ' + n.texto);
    }
    return L.join('\n');
  }

  const API = {
    analizar, explicar, resultado2027, buscarMovimientos, resumenParaIA, cuentas, dashboardConectado,
    fmt: { clp, mm, pct, fCorta, fLarga, fDia, mesNombre, cuando, horasA, plano, diasEntre, sumarDias, iso },
    FERIADOS, MESES,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else raiz.AeriaMotor = API;
})(typeof window !== 'undefined' ? window : this);
