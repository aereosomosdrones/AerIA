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
  // se redondea antes de poner el signo: así no sale «-0%», y el menos es el mismo de los montos
  function pct(x, dec) { const f = 10 ** (dec || 0), v = Math.round(x * 100 * f) / f; return (v < 0 ? '−' : '') + Math.abs(v).toFixed(dec || 0).replace('.', ',') + '%'; }
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
  // el curso dicho en palabras: «curso de Nivel 1», «curso de Niveles 2 y 3»
  const cursoTxt = c => 'curso de ' + (c.nivel === 'n1' ? 'Nivel 1' : 'Niveles 2 y 3');
  // «TEXTO EN MAYÚSCULAS» → «Texto en mayúsculas»
  const oracion = t => String(t || '').toLowerCase().replace(/^./, c => c.toUpperCase());
  // corta en una palabra completa y lo avisa con «…»
  function recortar(t, n) {
    t = String(t || '').replace(/\s+/g, ' ').trim();
    if (t.length <= n) return t;
    let c = t.slice(0, n - 1);
    const i = c.lastIndexOf(' ');
    if (i > n * 0.6) c = c.slice(0, i);
    if ((c.match(/"/g) || []).length % 2) c = c.slice(0, c.lastIndexOf('"'));   // sin comillas abiertas
    return c.replace(/[\s,;:·\-–"«(]+$/, '') + '…';
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
    const corte = fDia(F.periodo.hasta);
    const mesInicio = MESES[fecha(F.periodo.desde || F.periodo.hasta).getMonth()];
    const pagadas = cobradasDespues(F);
    const out = [];
    for (const s of F.sii) {
      if (/por cobrar/i.test(s.estado) && pagadas.has(String(s.folio))) continue; // ya pagada según el registro interno
      if (/por cobrar/i.test(s.estado) && s.fecha > F.periodo.hasta) out.push({ ...s, saldo: s.monto, tipoDeuda: 'La emitiste el ' + fDia(s.fecha) + '. Al ' + fDia(F.sii_hasta || s.fecha) + ', tu registro de ventas no anota el pago' });
      else if (/por cobrar/i.test(s.estado)) out.push({ ...s, saldo: s.monto, tipoDeuda: 'El banco no mostraba el pago al ' + corte });
      else if (/pendiente desde antes/i.test(s.estado)) out.push({ ...s, saldo: s.monto, tipoDeuda: 'Viene de antes de ' + mesInicio + ': falta confirmar si se pagó' });
      else if (/factoring/i.test(s.estado)) {
        const m = /\$([\d.]+)/.exec(s.det || '');
        const anticipo = m ? Number(m[1].replace(/\./g, '')) : 0;
        out.push({ ...s, saldo: s.monto - anticipo, tipoDeuda: 'Se la vendiste a una financiera: puede quedar un saldo a tu favor' });
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
      { id: 'ultimo', nombre: 'Como en ' + mesNombre(ultimo.mes), b2b: ultimo.b2b, real: true },
      { id: 'meta', nombre: 'Meta 2027', b2b: M.b2b_meta_mes },
      { id: 'promedio', nombre: 'Promedio de ' + yLista(pasado.meses.map(m => mesNombre(m.mes))), b2b: prom, real: true },
    ].concat(dashboardConectado(com) && com.pronostico.promedio3 > 0
      ? [{ id: 'comercial', nombre: 'Lo probable de tus cotizaciones (3 meses)', b2b: com.pronostico.promedio3, real: true }] : [])
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

  /* ---------- EBITDA: lo que deja el negocio antes de impuestos, intereses y compras de equipos ----------
     Base caja, mes a mes, con las cartolas:
       ventas cobradas (sin IVA)
       − gastos de operar (incluye las cotizaciones del personal; sin el pago de impuestos al SII ni las
         compras de equipos, que son inversión)
       − el sueldo base del socio que el plan cuenta como gasto fijo (modelo.sueldo_socio_mes; si el banco
         ya trae «Remuneración de socios», se usa lo mayor)
       − lo pagado al cofundador, que el plan también tiene en sus costos fijos aunque para el SII sea retiro.
     No entran las transferencias y aportes del socio, OTEC ni los traspasos.
     Semáforo con las metas del plan: bajo $0 rojo; entre $0 y la meta amarillo; sobre la meta verde. La meta
     del mes es el resultado anual del plan con la venta meta a empresas, dividido en 12 (sin estacionalidad).
     El semáforo grande mira los últimos meses cerrados juntos (hasta 3), porque la caja de un mes sola sube y
     baja con los cobros; un mes que la cartola corta a la mitad queda «en curso» y no se pinta. */
  const ES_COTIZACION = /previred|afp|isapre|fonasa|mutual|achs|cotizaci/i;
  /* ---------- CONTABLE: el pre cierre del contador (balance y resultado acumulados del año) ----------
     Se lee por el plan de cuentas: 1 activos, 2 pasivos y patrimonio, 3 ingresos, 4 gastos. */
  const NO_OPERACIONAL = /correcci[oó]n monetaria|diferencia de cambio|iva no recuperable|impuesto a la renta|intereses|multas/i;
  const PATRIMONIO = /capital|utilidad|p[eé]rdidas? acumulad|dividendo|reserva|resultado/i;
  // pagos que el contador deja como anticipo porque esperan boleta, factura o rendición
  const ESPERA_DOC = [
    { id: 'honorarios', re: /anticipo\s+(a\s+|de\s+)?honorarios/i, nombre: 'Honorarios pagados sin boleta', corto: 'honorarios sin boleta' },
    { id: 'proveedores', re: /anticipo\s+(a\s+)?proveedores/i, nombre: 'Proveedores pagados sin factura', corto: 'proveedores sin factura' },
    { id: 'fondos', re: /fondos?\s+por\s+rendir/i, nombre: 'Fondos por rendir', corto: 'fondos sin rendir' },
  ];
  // «TRANSFERENCIA A FULANO» → «fulano»: a quién se le pagó, para juntar sus pagos
  function contraparteDe(detalle) {
    const t = String(detalle || '').trim()
      .replace(/^pago\s+honorarios\s+[a-záéíóúñ]+\s*-\s*/i, '')
      .replace(/^fondos?\s+por\s+rendir\s+/i, '')
      .replace(/^(transferencias?|transf\.?|trans|tranf|traspaso)\s+(a\s+|de\s+)?/i, '')
      .replace(/^pago(\s+en\s+l[ií]nea|\s+mercado\s+pago)?\s*:?\s*/i, '')
      .replace(/[\s,.]+(spa|ltda|limitada|s\.?a)\.?$/i, '').trim();
    return t || 'sin detalle';
  }
  function leerContable(D) {
    const C = D.contable, M = D.modelo;
    if (!C || !(C.cuentas || []).length || !C.hasta) return null;
    const cu = C.cuentas;
    const suma = (l, f) => l.reduce((t, x) => t + (f(x) || 0), 0);
    const grupo = c => String(c.codigo || '').trim().charAt(0);
    const saldoActivo = c => (c.activo || 0) - (c.pasivo || 0), saldoPasivo = c => (c.pasivo || 0) - (c.activo || 0);
    const g = n => cu.filter(c => grupo(c) === n);
    const de = (re, l) => l.filter(c => re.test(c.nombre));
    const ventasCtas = g('3').filter(c => !NO_OPERACIONAL.test(c.nombre));
    const gastosCtas = g('4').filter(c => !NO_OPERACIONAL.test(c.nombre));
    const ventas = suma(ventasCtas, c => c.ganancia - c.perdida);
    const gastos = suma(gastosCtas, c => c.perdida - c.ganancia);
    const gastosTop = gastosCtas.map(c => ({ nombre: c.nombre, monto: c.perdida - c.ganancia })).filter(x => x.monto > 0).sort((a, b) => b.monto - a.monto);
    const activos = suma(g('1'), saldoActivo);
    const pasivosCtas = g('2').filter(c => !PATRIMONIO.test(c.nombre));
    const pasivos = suma(pasivosCtas, saldoPasivo);
    const movsDe = re => (C.analisis || []).filter(a => re.test(a.hoja)).flatMap(a => a.movs || []);
    const glosaCof = M.cofundador_glosa ? new RegExp(M.cofundador_glosa, 'i') : null;
    const espera = ESPERA_DOC.map(t => {
      const movs = movsDe(t.re);
      return { id: t.id, nombre: t.nombre, corto: t.corto, monto: suma(de(t.re, g('1')), saldoActivo), n: movs.length, movs };
    }).filter(t => t.monto > 0);
    const sinDoc = suma(espera, t => t.monto);
    // lo pagado al cofundador como honorario sin boleta: es su pago, no un gasto de operar
    const hon = espera.find(t => t.id === 'honorarios');
    const cofundador = hon && glosaCof ? suma(hon.movs.filter(m => glosaCof.test(m.detalle)), m => m.monto) : 0;
    const porNombre = {};
    for (const t of espera) for (const m of t.movs) {
      const n = contraparteDe(m.detalle), k = plano(n);
      const r = porNombre[k] || (porNombre[k] = { nombre: nombrePropio(n), monto: 0, n: 0, tipos: new Set() });
      r.monto += m.monto; r.n += 1; r.tipos.add(t.corto);
    }
    // un nombre que el banco cortó («fulano de t») se junta con el completo («fulano de tal»), si hay uno solo que calce
    for (const k of Object.keys(porNombre)) {
      if (k.length < 8) continue;
      const largos = Object.keys(porNombre).filter(o => o !== k && o.startsWith(k));
      if (largos.length !== 1) continue;
      const L = porNombre[largos[0]], r = porNombre[k];
      L.monto += r.monto; L.n += r.n; for (const t of r.tipos) L.tipos.add(t);
      delete porNombre[k];
    }
    const contrapartes = Object.values(porNombre).map(r => ({ ...r, tipos: [...r.tipos] })).sort((a, b) => b.monto - a.monto);
    const prestamos = de(/pr[eé]stamo/i, pasivosCtas).filter(c => /socio/i.test(c.nombre)).map(c => ({ nombre: c.nombre, monto: saldoPasivo(c) })).filter(x => x.monto > 0);
    const prestamosTotal = suma(prestamos, x => x.monto);
    const dividendos = suma(de(/dividendo/i, g('2')), saldoActivo);
    const [y0, m0] = C.desde.split('-').map(Number), [y1, m1] = C.hasta.split('-').map(Number);
    const nMeses = (y1 - y0) * 12 + (m1 - m0) + 1;
    const sueldoSocio = (M.sueldo_socio_mes || 0) * nMeses;
    const gastosOperar = gastos + sinDoc - cofundador;
    const ebitda = ventas - gastosOperar - sueldoSocio - cofundador;
    const etiqueta = mesNombre(C.desde.slice(0, 7)) + ' a ' + mesNombre(C.hasta.slice(0, 7));
    return {
      fuente: C.fuente, desde: C.desde, hasta: C.hasta, nMeses, etiqueta,
      ventas, gastos, gastosTop, resultado: C.resultado, resultadoOperacional: ventas - gastos,
      espera, sinDoc, contrapartes, cofundador,
      socios: { prestamos, prestamosTotal, dividendos },
      balance: {
        activos, pasivos, patrimonio: activos - pasivos,
        caja: suma(de(/^caja/i, g('1')), saldoActivo),
        bancos: suma(de(/banco/i, g('1')), saldoActivo),
        clientes: suma(de(/clientes/i, g('1')).filter(c => !/anticipo/i.test(c.nombre)), saldoActivo),
        equipos: suma(de(/drones?\b|equipos?|maquinaria|veh[ií]culos?/i, g('1')), saldoActivo),
        proveedores: suma(de(/proveedores/i, pasivosCtas).filter(c => !/anticipo/i.test(c.nombre)), saldoPasivo),
        anticiposClientes: suma(de(/anticipo.*clientes?/i, pasivosCtas), saldoPasivo),
      },
      ebitda: { ingresos: ventas, gastos: gastosOperar, sueldoSocio, cofundador, ebitda, margen: ventas > 0 ? ebitda / ventas : null },
      avisos: C.avisos || [],
    };
  }

  function leerEbitda(D, X, hoy) {
    const P = X.pasado, M = D.modelo, Fi = D.finanzas;
    if (!P || !P.meses.length) return null;
    const sueldo = M.sueldo_socio_mes || 0;
    const metaAnio = resultado2027(M, M.b2b_meta_mes).resultado, metaMes = metaAnio / 12;
    const color = (v, meta) => v == null ? 'sindato' : v < 0 ? 'urgente' : v < meta ? 'ojo' : 'bien';
    const etiqueta = c => (Fi.cats[c] || {}).label || c;
    const afectas = (Fi.sii || []).filter(x => /afecta/i.test(x.tipo || '') && x.monto > 0);
    const finMes = ym => iso(new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0));
    const digitos = r => String(r || '').replace(/[^0-9kK]/g, '').replace(/^0+/, '').toUpperCase();
    const rutGlosa = d => { const m = /^\s*(\d{8,10}[\dkK]?)\b/.exec(d || ''); return m ? digitos(m[1]) : ''; };
    const usadas = new Set();
    const meses = P.meses.map(m => {
      const movs = Fi.movs.filter(x => x.mes === m.mes);
      // del pago de impuestos, las cotizaciones del personal son costo; lo que va al SII (F29) queda fuera
      const impSII = -movs.filter(x => x.cat === 'imp' && !ES_COTIZACION.test((x.desc || '') + ' ' + (x.contra || ''))).reduce((t, x) => t + x.monto, 0);
      const equipos = -(m.porCat.equip || 0);
      const rem = -(m.porCat.soc_rem || 0);
      // un cobro que calza exacto con una factura afecta del SII (mismo monto y, si la glosa trae RUT, el mismo RUT)
      // trae su IVA, que es del SII y no venta; cada factura se usa una sola vez
      const ivaVentas = movs.filter(x => (x.cat === 'ing_b2b' || x.cat === 'ing_fact') && x.monto > 0).reduce((t, x) => {
        const f = afectas.find(a => !usadas.has(a) && a.monto === x.monto && (!rutGlosa(x.desc) || rutGlosa(x.desc) === digitos(a.rut)));
        if (!f) return t;
        usadas.add(f);
        return t + x.monto - Math.round(x.monto / 1.19);
      }, 0);
      const ingresos = m.ingresos - ivaVentas;
      const gastos = -m.egresos - impSII - equipos - rem;
      const sueldoSocio = Math.max(sueldo, rem);
      const cofundador = Math.max(0, -(m.cofundador || 0));
      const ebitda = ingresos - gastos - sueldoSocio - cofundador;
      const gastosTop = Object.entries(m.porCat)
        .filter(([c, v]) => (Fi.cats[c] || {}).grupo === 'Egresos operacionales' && !['imp', 'equip', 'soc_rem'].includes(c) && v < 0)
        .map(([c, v]) => ({ cat: c, label: etiqueta(c), monto: -v })).sort((x, y) => y.monto - x.monto);
      const empresas = (m.porCat.ing_b2b || 0) + (m.porCat.ing_fact || 0) - ivaVentas;
      const parcial = P.fechaCorte.slice(0, 7) === m.mes && P.fechaCorte < finMes(m.mes);
      return { mes: m.mes, ingresos, ivaVentas, empresas, particulares: ingresos - empresas, gastos, rem, sueldoSocio, cofundador, impSII, equipos, ebitda,
        margen: ingresos > 0 ? ebitda / ingresos : null, estado: parcial ? 'sindato' : color(ebitda, metaMes), gastosTop, parcial, hasta: parcial ? P.fechaCorte : finMes(m.mes),
        comprasSinPago: ((Fi.compras_resumen || {})[m.mes] || {}).sin_pago || 0 };
    });
    const cerrados = meses.filter(m => !m.parcial);
    const sum = (l, k) => l.reduce((t, x) => t + (x[k] || 0), 0);
    const juntar = l => {
      const r = { meses: l.map(x => x.mes), n: l.length };
      for (const k of ['ingresos', 'empresas', 'gastos', 'sueldoSocio', 'cofundador', 'ebitda', 'comprasSinPago', 'ivaVentas']) r[k] = sum(l, k);
      r.meta = metaMes * l.length;
      r.margen = r.ingresos > 0 ? r.ebitda / r.ingresos : null;
      r.estado = l.length ? color(r.ebitda, r.meta) : 'sindato';
      return r;
    };
    const periodo = juntar(cerrados.slice(-3));
    // el año: lo que cubre el contador va en un bloque; después, los meses cerrados del banco
    const Cn = X.contable;
    let anual = null;
    if (Cn) {
      const corte = Cn.hasta.slice(0, 7), anio = Cn.hasta.slice(0, 4);
      const banco = cerrados.filter(m => m.mes > corte && m.mes.slice(0, 4) === anio);
      const B = Cn.ebitda;
      const bloque = { contable: true, mes: Cn.desde.slice(0, 7), hastaMes: corte, etiqueta: Cn.etiqueta, n: Cn.nMeses,
        ingresos: B.ingresos, gastos: B.gastos, sueldoSocio: B.sueldoSocio, cofundador: B.cofundador, ebitda: B.ebitda, margen: B.margen,
        meta: metaMes * Cn.nMeses, estado: color(B.ebitda, metaMes * Cn.nMeses) };
      // meses entre el corte del contador y el primer mes del banco que no tiene ninguna de las dos fuentes
      const hueco = [];
      if (banco.length) for (let ym = sumarMesesISO(corte, 1); ym < banco[0].mes; ym = sumarMesesISO(ym, 1)) hueco.push(ym);
      const partes = [bloque, ...banco];
      const n = Cn.nMeses + banco.length;
      const t = k => partes.reduce((a, x) => a + (x[k] || 0), 0);
      const ebitdaAnio = t('ebitda'), ingresosAnio = t('ingresos');
      anual = { partes, banco, bloque, hueco, n, anio, desde: Cn.desde, hasta: banco.length ? finMes(banco[banco.length - 1].mes) : Cn.hasta,
        etiqueta: mesNombre(Cn.desde.slice(0, 7)) + ' a ' + mesNombre((banco.length ? banco[banco.length - 1].mes : corte)),
        ingresos: ingresosAnio, gastos: t('gastos'), sueldoSocio: t('sueldoSocio'), cofundador: t('cofundador'), ebitda: ebitdaAnio,
        meta: metaMes * n, estado: color(ebitdaAnio, metaMes * n), margen: ingresosAnio > 0 ? ebitdaAnio / ingresosAnio : null };
    }
    const ultimo = cerrados[cerrados.length - 1] || null;
    const siguiente = ultimo ? sumarMesesISO(ultimo.mes, 1) : null;
    const prom = X.futuro.escenarios.find(e => e.id === 'promedio'), ritmo = X.futuro.escenarios.find(e => e.id === 'ultimo');
    const est = r => r.resultado < 0 ? 'urgente' : r.resultado < metaAnio ? 'ojo' : 'bien';
    const temporada = riesgoPlan(D.plan, /en rojo/i);
    return {
      meses, cerrados, ultimo, periodo, anual, metaMes, metaAnio, sueldo, enCurso: meses.find(m => m.parcial) || null,
      siguiente, siguienteCierra: siguiente ? finMes(siguiente) : null, siguienteCerro: siguiente ? hoy > finMes(siguiente) : false,
      anio: { promedio: prom ? { resultado: prom.resultado, b2b: prom.b2b, estado: est(prom) } : null, ritmo: ritmo ? { resultado: ritmo.resultado, b2b: ritmo.b2b, estado: est(ritmo) } : null },
      cofundador: etiqueta('cof'), temporada: temporada ? temporada[0] : '',
      // hallazgos del informe que pueden cambiar el EBITDA (la lista vive en el modelo): si siguen abiertos, es provisorio
      salvedades: (M.ebitda_salvedades || []).map(id => (Fi.hallazgos || []).find(h => h.id === id)).filter(Boolean).map(h => h.titulo),
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
        nota = 'Lo que entró al banco por ventas a empresas en ' + mesNombre(u.mes) + ' (incluye lo que adelantó una financiera por facturas).';
        const dsp = leerDespues(D.finanzas, D.cursos && D.cursos.precios_web);
        if (dsp && dsp.b2bN) nota += ' Después, al ' + fDia(dsp.hasta) + ', el SII ya muestra ' + mm(dsp.b2b) + ' sin IVA facturados a empresas.';
        if (dashboardConectado(com)) {
          const f = com.pronostico.meses[0];
          nota += ' Para ' + mesNombre(f.mes) + ' llevas ' + mm(f.ganado) + ' ganados, y lo probable de lo cotizado suma ' + mm(f.esperado) + ' más.';
        }
      } else if (t.id === 'ocup_n1' && cursos.resN1.ocupacion21 != null) {
        valor = pct(cursos.resN1.ocupacion21) + ' vendido';
        est = estado(cursos.resN1.ocupacion21 >= t.umbral, cursos.resN1.ocupacion21 < 0.5);
        nota = 'Solo los cursos que empiezan en las próximas 3 semanas.';
      } else if (t.id === 'ocup_n23' && cursos.resN23.ocupacion21 != null) {
        valor = pct(cursos.resN23.ocupacion21) + ' vendido';
        est = estado(cursos.resN23.ocupacion21 >= t.umbral, cursos.resN23.ocupacion21 < 0.4);
        nota = 'Solo los cursos que empiezan en las próximas 3 semanas.';
      } else if (t.id === 'cac' && u.cac) {
        valor = clp(u.cac) + ' en ' + mesNombre(u.mes);
        est = estado(u.cac <= t.umbral, u.cac > 1.5 * t.umbral);
        const mk = pasado.meses.reduce((a, m) => a + m.marketing, 0), al = pasado.meses.reduce((a, m) => a + m.alumnos, 0);
        nota = 'Lo gastado en publicidad en ' + mesNombre(u.mes) + ', dividido por los ' + u.alumnos + ' alumnos que pagaron ese mes. La publicidad también vende cursos de los meses siguientes: juntando los ' + pasado.meses.length + ' meses, sale ' + clp(mk / al) + ' por alumno.';
      } else if (t.id === 'caja') {
        valor = clp(pasado.cajaFinal) + ' al ' + fCorta(pasado.fechaCorte);
        est = estado(pasado.cajaFinal >= t.umbral, pasado.cajaFinal < t.umbral / 3);
        nota = 'Lo que había en ' + yLista([...new Set(Object.values(cuentas(D.finanzas)))]) + ' ese día.';
      } else if (t.id === 'fcl') {
        nota = 'La plata que queda después de pagar todo, mirada cada 3 meses. Se empieza a medir en enero de 2027.';
      } else if (t.id === 'upsell') {
        nota = 'Falta comparar la lista de alumnos del Nivel 1 con la de los Niveles 2 y 3.';
      }
      return { ...t, valor, estado: est, nota };
    });
  }

  /* Fila de la tabla de riesgos del plan que menciona un tema: [riesgo, qué hacer…] */
  function riesgoPlan(P, patron) {
    if (!P) return null;
    for (const s of P.secciones) for (const t of s.tablas) for (const f of t.slice(1)) {
      if (f.some(c => patron.test(c))) return f;
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
      const mesesTxt = yLista(pasado.meses.map(m => mesNombre(m.mes)));
      const neto = pasado.socioNeto + pasado.cofundador + pasado.otec;   // socios y Aéreo OTEC: lo que entró menos lo que salió
      add({
        id: 'caja', nivel: 'critica', foco: 'cruce', monto: pasado.cajaFinal,
        titulo: (viejo ? 'Al ' + fDia(pasado.fechaCorte) + ' la plata del banco alcanzaba para ' : 'La plata del banco alcanza para ') + futuro.runwayDias.toFixed(1).replace('.', ',') + ' días hábiles de gastos',
        detalle: 'Al ' + fDia(pasado.fechaCorte) + ' tenías ' + clp(pasado.cajaFinal) + ' en el banco (' + yLista([...new Set(Object.values(cuentas(D.finanzas)))]) + '). ' +
          'El plan 2027 pide no bajar nunca de un mes de gastos fijos: ' + mm(M.costos_fijos_mes, 2) + '. ' +
          (pasado.flujoOperacional >= 0 ? 'En ' + mesesTxt + ' la operación dejó ' + mm(pasado.flujoOperacional) + ' a favor. '
            : 'En ' + mesesTxt + ' operar costó ' + mm(-pasado.flujoOperacional) + ' más de lo que entró. ') +
          (neto < 0 ? (pasado.flujoOperacional >= 0 ? 'Pero entre' : 'Entre') + ' socios y Aéreo OTEC salieron ' + mm(-neto) + ' más de lo que entró. '
            : neto > 0 ? 'Entre socios y Aéreo OTEC entraron ' + mm(neto) + ' más de lo que salió. ' : '') +
          'El día más justo fue el ' + fDia(pasado.cajaMin.fecha) + ': quedaban ' + clp(pasado.cajaMin.total) + '.' +
          (dsp && dsp.cobradoRegistro ? ' Después, tu registro de ventas anota ' + mm(dsp.cobradoRegistro) + ' cobrados hasta el ' + fDia(dsp.hasta) + '. El banco aún no lo confirma.' : ''),
        accion: (liquidez && liquidez.accion ? liquidez.accion.replace(/\.?$/, '. ') : 'Decidir un piso de plata que nunca se saca del banco. ') +
          'Cobrar lo pendiente y vender por adelantado los cursos de ' + mesNombre(sumarMesesISO(hoy, 1)) + ' y ' + mesNombre(sumarMesesISO(hoy, 2)) + '.',
        fuente: 'Movimientos del banco de ' + pasado.etiqueta + ' y el mínimo de plata que pide el plan 2027',
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
        fuente: 'Revisión contable de ' + pasado.etiqueta,
      });
    }
    // Lo que muestra el pre cierre del contador (los ids llevan el mes de corte: un pre cierre nuevo vuelve a avisar)
    const Cn = X.contable;
    if (Cn) {
      const corte = Cn.hasta.slice(0, 7), alCorte = fDia(Cn.hasta);
      if (Cn.sinDoc > 0) {
        const top = Cn.contrapartes.slice(0, 3);
        add({
          id: 'cont-sin-respaldo-' + corte, nivel: criticos.has('cont-sin-respaldo') ? 'critica' : 'alta', foco: 'pasado', monto: Cn.sinDoc,
          titulo: 'Pagos sin boleta, factura ni rendición: ' + mm(Cn.sinDoc) + ' de ' + Cn.etiqueta,
          detalle: 'El contador dejó ' + mm(Cn.sinDoc) + ' como anticipos porque no tienen documento: ' +
            yLista(Cn.espera.map(t => minus(t.nombre) + ' ' + mm(t.monto) + ' (' + t.n + (t.n === 1 ? ' pago' : ' pagos') + ')')) + '.' +
            (top.length ? ' Los más grandes: ' + yLista(top.map(r => r.nombre + ' ' + mm(r.monto))) + '.' : '') +
            ' Sin documento, el SII puede rechazar esos gastos, y la utilidad que muestra el contador (' + mm(Cn.resultadoOperacional) + ') se ve mejor de lo que fue.',
          accion: 'Conseguir las boletas y facturas, o rendir los fondos, y pasárselas al contador antes del cierre del año.',
          tarea: 'Juntar las boletas y facturas de los ' + mm(Cn.sinDoc) + ' pagados sin documento',
          fuente: Cn.fuente,
        });
      }
      const B = Cn.balance, So = Cn.socios;
      if (B.patrimonio < 0 || So.prestamosTotal > 0) {
        add({
          id: 'cont-patrimonio-' + corte, nivel: B.patrimonio < 0 ? (criticos.has('cont-patrimonio') ? 'critica' : 'alta') : 'media', foco: 'pasado', monto: So.prestamosTotal,
          titulo: B.patrimonio < 0 ? 'La empresa debe más de lo que tiene: ' + mm(-B.patrimonio) + ' al ' + alCorte : 'La empresa les debe ' + mm(So.prestamosTotal) + ' a los socios',
          detalle: 'Al ' + alCorte + ', Aéreo tiene ' + mm(B.activos) + ' y debe ' + mm(B.pasivos) + (So.prestamosTotal ? '; ' + mm(So.prestamosTotal) + ' de eso son préstamos de los socios' : '') + '.' +
            (So.dividendos > 0 ? ' Además, el contador anotó ' + mm(So.dividendos) + ' como dividendos (reparto de utilidades a los socios), y la empresa todavía no tiene utilidades para repartir.' : '') +
            ' Un inversionista descuenta la deuda con los socios del precio, si no pasa antes a capital.',
          accion: 'Definir con el contador qué fue lo que recibieron los socios (sueldo, devolución del préstamo o reembolso de gastos) y si los préstamos pasan a capital.',
          tarea: 'Ordenar con el contador la deuda con los socios (' + mm(So.prestamosTotal) + ')',
          fuente: Cn.fuente,
        });
      }
    }
    // Ventas a empresas bajo la meta
    const u = pasado.meses[pasado.meses.length - 1];
    if (u.b2b < M.b2b_meta_mes) {
      const cierra = r => r >= 0 ? 'ganando ' + mm(r) : 'perdiendo ' + mm(-r);
      const receta = M.mix_b2b_meta ? sinJerga(M.mix_b2b_meta).replace(/curso cerrado o para una empresa/g, 'curso cerrado para una empresa')
        .replace(/\b1 AOC\b/g, '1 asesoría AOC').replace(/~\$/g, 'cerca de $').replace(/\.$/, '') : '';
      add({
        id: 'b2b-' + u.mes, nivel: u.b2b < M.b2b_minimo_mes ? 'critica' : 'alta', foco: 'cruce', monto: u.b2b,
        titulo: 'En ' + mesNombre(u.mes) + ' vendiste ' + mm(u.b2b) + ' a empresas: menos que la meta de ' + mm(M.b2b_meta_mes) + ' al mes',
        detalle: 'El plan 2027 depende de las ventas a empresas. Con ' + mm(M.b2b_meta_mes) + ' al mes, 2027 cierra ' +
          cierra(resultado2027(M, M.b2b_meta_mes).resultado) + '. Al ritmo de ' + mesNombre(u.mes) + ', cerraría ' +
          cierra(resultado2027(M, u.b2b).resultado) + '. Lo mínimo para no perder plata es venderles ' + mm(futuro.equilibrio) + ' al mes. ' +
          // con el dashboard conectado se usan sus cotizaciones (sin IVA); si no, el último resumen que mandó
          (dashboardConectado(X.comercial) ? 'En Ventas hay ' + mm(X.comercial.abiertas.monto) + ' en cotizaciones esperando respuesta (lo probable: ' + mm(X.comercial.abiertas.ponderado) + ')'
            : (cot.corte ? 'Según el último resumen de tu dashboard (' + fDia(cot.corte) + '), tenías ' : 'Tenías ') + mm(cot.abiertasMonto) + ' en cotizaciones esperando respuesta') +
          ': de ahí puede salir la diferencia.',
        accion: 'Cierra las cotizaciones que esperan respuesta y busca desde ya ventas a empresas para enero a marzo' + (receta ? ': ' + receta + '.' : '.'),
        fuente: 'Ventas por producto de ' + pasado.etiqueta + ' y el plan 2027',
      });
    }
    // Cursos: feriados
    for (const c of cursos.proximos) {
      for (const f of c.feriados) {
        add({
          id: 'feriado-' + c.nivel + '-' + c.inicio, nivel: 'alta', foco: 'presente',
          titulo: 'El ' + cursoTxt(c) + ' del ' + fDia(c.inicio) + ' cae en feriado (' + fDia(f.fecha) + ', ' + f.nombre + ')',
          detalle: 'Sigue publicado en aereo.cl' + (c.vendidos ? ' y ya tiene ' + c.vendidos + ' de ' + c.max + ' cupos vendidos.' : '. Todavía no tiene alumnos, así que moverlo es fácil.') +
            (c.nivel === 'n23' && c.inicio === '2026-12-07' ? ' El plan 2027 ya propone moverlo al 14 y 15 de diciembre.' : ''),
          accion: 'Cambia la fecha en aereo.cl' + (c.vendidos ? ' y avísales a ' + (c.vendidos === 1 ? 'la persona inscrita.' : 'los ' + c.vendidos + ' inscritos.') : '.'),
          fuente: 'Cursos publicados en aereo.cl y el calendario de feriados', fecha_limite: c.inicio,
        });
      }
    }
    // Cursos: cupos por vender cerca de la fecha
    for (const c of cursos.proximos) {
      if (c.dias <= 21 && c.dias >= 0 && c.libres >= 3) {
        const anterior = cursos[c.nivel].filter(x => x.inicio < c.inicio).sort((a, b) => a.inicio.localeCompare(b.inicio)).pop();
        add({
          id: 'vender-' + c.nivel + '-' + c.inicio, nivel: c.dias <= 10 ? 'alta' : 'media', foco: 'presente',
          monto: c.libres * c.precio,
          titulo: c.libres === c.max ? 'El ' + cursoTxt(c) + ' del ' + fDia(c.inicio) + ' empieza ' + cuando(c.dias) + ' y todavía no vende ningún cupo'
            : 'Al ' + cursoTxt(c) + ' del ' + fDia(c.inicio) + ' le quedan ' + c.libres + ' de ' + c.max + ' cupos libres y empieza ' + cuando(c.dias),
          detalle: 'Cada cupo vale ' + clp(c.precio) + ' a precio de hoy.' +
            (anterior && anterior.libres === 0 ? ' El curso anterior, del ' + fDia(anterior.inicio) + ', se llenó.' : '') +
            (c.nivel === 'n1' && cursos.racha.length >= 3 ? ' El Nivel 1 se agotó ' + cursos.racha.length + ' meses seguidos: hay interés.' : ''),
          accion: 'Avísale a la lista de espera y ofrece los cupos a empresas con SENCE.' +
            (c.nivel === 'n1' && M.margen_alumno ? ' Un alumno por SENCE te deja ' + clp(M.margen_alumno.sence) + '; uno particular, ' + clp(M.margen_alumno.nivel1) + '.' : ''),
          fuente: 'Cursos publicados en aereo.cl', fecha_limite: c.inicio,
        });
      }
    }
    // Meses sin ventas
    const vacios = cursos.proximos.filter(c => c.vendidos === 0 && c.dias > 21);
    if (vacios.length >= 3) {
      const meses = [...new Set(vacios.map(c => MESES[fecha(c.inicio).getMonth()]))];
      const riesgo = riesgoPlan(D.plan, /preventa/i);
      add({
        id: 'preventa', nivel: 'media', foco: 'futuro', monto: vacios.reduce((a, c) => a + c.max * c.precio, 0),
        titulo: vacios.length + ' cursos de ' + yLista(meses) + ' todavía no tienen ningún alumno',
        detalle: 'Son ' + vacios.reduce((a, c) => a + c.max, 0) + ' cupos por vender.' +
          (riesgo ? ' El plan 2027 ya lo había previsto: «' + riesgo[0] + '».' + (riesgo.length > 1 ? ' Y propone: «' + riesgo.slice(1).join(' ') + '».' : '') : ''),
        accion: 'Vende estos cupos por adelantado, con una fecha límite. Y ofrécelos a empresas con SENCE.',
        tarea: 'Vender por adelantado los cupos de los cursos que no tienen alumnos',
        fuente: 'Cursos publicados en aereo.cl y los riesgos del plan 2027',
      });
    }
    // Licitaciones
    for (const l of lic.relevantes) {
      if (l.horas > 24 * 10) continue;
      const urgente = l.horas <= 72;
      add({
        id: 'lic-' + l.codigo, nivel: l.encaje === 'capacitacion' && urgente ? 'alta' : 'oportunidad', foco: 'presente',
        monto: l.monto || null,
        titulo: l.encaje_label + ': ' + recortar(oracion(l.nombre), 110),
        detalle: 'Lo pide ' + nombrePropio(l.organismo) + ' (' + l.region + '). Presupuesto: ' + (l.monto ? clp(l.monto) : 'no lo publicaron') +
          '. Puedes postular hasta el ' + fLarga(l.cierre) + ' (' + horasA(l.cierre, ahora).replace(/^cierra en [01] h$/, 'queda menos de 1 hora').replace(/^cierra en /, 'quedan ').replace(/ h$/, ' horas') + ').',
        accion: urgente ? 'Lee lo que piden (las bases) y manda tu oferta hoy.' : 'Lee lo que piden (las bases) y decide si postulas.',
        fuente: 'Mercado Público (' + (l.fuente === 'compra_agil' ? 'Compra Ágil' : 'licitación') + '), visto por tu radar de concursos del Estado',
        fecha_limite: l.cierre.slice(0, 10), url: l.url,
      });
    }
    // Dashboard comercial: si su detalle no ha entrado a AerIA, se avisa con lo último conocido
    const com = X.comercial;
    if (!dashboardConectado(com)) {
      add({
        id: 'cot-antiguas', nivel: 'alta', foco: 'comercial',
        titulo: 'AerIA todavía no ve las cotizaciones de tu dashboard',
        detalle: 'Lo último que vi de tu dashboard' + (cot.corte ? ' es del ' + fDia(cot.corte) + (cot.antiguedad != null ? ' (hace ' + cot.antiguedad + ' días)' : '') : '') + ': ' +
          mm(cot.abiertasMonto) + ' en cotizaciones esperando respuesta' + (cot.tasaCierre ? ', y ganabas el ' + pct(cot.tasaCierre) + ' de la plata cotizada que ya tenía respuesta' : '') + '.' +
          (com && com.total ? ' En Ventas tengo ' + com.total + ' negocios sacados de facturas, Notion y el plan, pero faltan los de tu dashboard.' : '') +
          ' Sin ellos no puedo decirte cuánto vas a vender ni a quién llamar.',
        accion: 'Abre AerIA en la app de escritorio de Claude: así lee tu dashboard sola. Si no puedes, usa el marcador «AerIA · Extraer» en tu dashboard y pega lo que copia en Ventas → Importar.',
        tarea: 'Conectar tu dashboard de cotizaciones a AerIA',
        fuente: 'El último resumen de tu dashboard de cotizaciones',
      });
    }
    if (com) for (const a of com.alertas) add(a);
    // Cruce plan vs cartolas
    if (cruce) {
      // lo leído en las cartolas, dicho en simple (los valores de «leido» no cambian: los usa el cruce)
      const LEIDO = { 'ya cobrada': 'ya te pagó', 'sigue por cobrar': 'todavía te debe', 'sin dato en las cartolas': 'el banco no muestra nada' };
      const leidoTxt = t => LEIDO[t] || String(t).replace(/^cedida a factoring/, 'se la vendiste a una financiera');
      add({
        id: 'cruce-por-cobrar', nivel: 'media', foco: 'cruce',
        titulo: 'Según el plan 2027 te deben facturas que el banco muestra resueltas',
        detalle: 'El plan dice: «' + cruce.frase.replace(/\.$/, '') + '». Lo que muestra el banco: ' +
          cruce.estado.map(e => e.cliente + ', ' + leidoTxt(e.leido)).join('; ') + '.',
        accion: 'Corrige ese número en el plan. Para saber quién te debe, mira la lista de cobros en «Cursos y cobros»: sale del banco y del SII.',
        tarea: 'Corregir en el plan 2027 lo que da por cobrar',
        fuente: 'El plan 2027 y el banco (' + pasado.etiqueta + ')',
      });
    }
    // Oportunidad: precio
    if (cursos.racha.length >= 4) {
      add({
        id: 'demanda', nivel: 'oportunidad', foco: 'futuro',
        titulo: 'El Nivel 1 se agota: hay espacio para subir el precio en 2027',
        detalle: 'El Nivel 1 se agotó ' + cursos.racha.length + ' meses seguidos (' + yLista(cursos.racha.map(m => MESES[m])) +
          ') a ' + clp(D.cursos.precios_web.nivel1) + '. El plan lo sube a ' +
          clp(M.precios_2027.nivel1) + ' en 2027: ' + pct(M.precios_2027.nivel1 / D.cursos.precios_web.nivel1 - 1) + ' más.',
        accion: 'Mantén el alza y la regla de descuentos: máximo 10%, y solo para grupos de 3 o más. Piensa en publicar las fechas de enero con el precio nuevo.',
        fuente: 'Cursos publicados en aereo.cl y el plan 2027',
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
        add({ id: a.id, cuando: 'hoy', titulo: 'Postular hoy: ' + a.titulo.replace(/^[^:]+: /, ''), por: a.detalle, foco: 'presente', url: a.url, prioridad: 0 });
      }
    }
    const vencidas = porCobrar.filter(p => p.grupo === 'vencida'), confirmar = porCobrar.filter(p => p.grupo === 'por_confirmar');
    const suma = l => l.reduce((s, p) => s + p.saldo, 0);
    if (vencidas.length) {
      add({
        id: 'cobrar', cuando: 'esta semana', foco: 'presente', prioridad: 1,
        titulo: 'Cobrar ' + mm(suma(vencidas)) + (vencidas.length === 1 ? ' de una factura atrasada' : ' de facturas atrasadas'),
        por: vencidas.map(p => p.cliente + ': ' + clp(p.saldo) + ', factura ' + p.folio + ', debía pagar el ' + fDia(p.vence)).join(' · '),
      });
    }
    if (confirmar.length) {
      add({
        id: 'cobrar-confirmar', cuando: 'esta semana', foco: 'presente', prioridad: 2,
        titulo: 'Revisar si ya te pagaron ' + mm(suma(confirmar)) + (confirmar.length === 1 ? ' de una factura' : ' en facturas'),
        por: confirmar.map(p => p.cliente + ': ' + clp(p.saldo) + ', factura ' + p.folio + ' (' + minus(p.tipoDeuda) + ')').join(' · '),
      });
    }
    const primera = t => String(t || '').split(/(?<=\.)\s/)[0].replace(/\.$/, '');
    const fin = alertas.filter(a => a.id.startsWith('fin-') || a.id.startsWith('cont-'));
    const finMedias = fin.filter(a => a.nivel === 'media').sort((a, b) => (b.monto || 0) - (a.monto || 0)).slice(0, 3).map(a => a.id);
    const regla = a => {
      if (a.id === 'caja') return [1, 'esta semana'];
      const deRevision = a.id.startsWith('fin-') || a.id.startsWith('cont-');
      if (deRevision && a.nivel === 'critica') return [1, 'esta semana'];
      if (deRevision && a.nivel === 'alta') return [2, 'este mes'];
      if (finMedias.includes(a.id)) return [3, 'este mes'];
      if (a.id === 'cot-antiguas') return [1, 'esta semana'];
      if (a.id === 'preventa') return [2, 'este mes'];
      if (a.id.startsWith('com-pronostico-')) return [2, 'esta semana'];
      if (a.id === 'cruce-por-cobrar') return [3, 'este mes'];
      return null;
    };
    // el curso de una alerta de feriado o de cupos (la tarea se arma con el curso, no cortando el título)
    const cursoDe = id => X.cursos.proximos.find(c => id === 'feriado-' + c.nivel + '-' + c.inicio || id === 'vender-' + c.nivel + '-' + c.inicio);
    for (const a of alertas) {
      const c = cursoDe(a.id);
      if (a.id.startsWith('feriado-')) add({ id: a.id, cuando: 'esta semana', foco: 'presente', prioridad: 1, titulo: c ? 'Cambiar la fecha del ' + cursoTxt(c) + ' del ' + fDia(c.inicio) + ': cae en feriado' : a.titulo, por: a.accion });
      else if (a.id.startsWith('vender-')) add({ id: a.id, cuando: 'esta semana', foco: 'presente', prioridad: 1,
        titulo: !c ? a.titulo : c.libres === c.max ? 'Conseguir alumnos para el ' + cursoTxt(c) + ' del ' + fDia(c.inicio) + ': todavía no tiene'
          : 'Vender los ' + c.libres + ' cupos libres del ' + cursoTxt(c) + ' del ' + fDia(c.inicio),
        por: primera(a.accion) });
      else if (regla(a)) {
        const [pr, cuando] = regla(a);
        add({ id: a.id, cuando, foco: a.foco, prioridad: pr, titulo: a.tarea || primera(a.accion), por: a.titulo });
      } else if (a.id.startsWith('lic-') && a.nivel === 'oportunidad' && /capacitaci/i.test(a.titulo)) {
        add({ id: a.id, cuando: 'antes del ' + fDia(a.fecha_limite), foco: 'presente', prioridad: 2, titulo: 'Preparar la postulación: ' + a.titulo.replace(/^[^:]+: /, ''), por: a.detalle, url: a.url });
      }
    }
    // Acciones comerciales: seguimientos, facturar lo ganado, definir cierres vencidos
    if (X.comercial) for (const c of X.comercial.acciones) add(c);
    // Las acciones de «Esta semana» del plan que no estén ya cubiertas
    const plan = (D.plan && D.plan.secciones.find(s => /plan de acci/i.test(s.titulo))) || null;
    if (plan) {
      for (const t of plan.listas.flat()) {
        if (/cobrar|mover el n2|sacar el caf/i.test(t)) continue;
        add({ id: 'plan-' + plano(t).replace(/[^a-z0-9]+/g, '-').slice(0, 40), cuando: 'esta semana', foco: 'futuro', prioridad: 2, titulo: t, por: 'Lo pide el plan 2027' });
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
      ev.push({ fecha: c.inicio, tipo: 'curso', titulo: (c.nivel === 'n1' ? 'Nivel 1' : 'Niveles 2 y 3') + ': ' + c.vendidos + ' de ' + c.max + ' cupos vendidos',
        estado: c.libres === 0 ? 'lleno' : (c.vendidos === 0 ? 'vacio' : 'parcial'), nivel: c.nivel });
    }
    for (const l of X.lic.relevantes) {
      if (l.cierre.slice(0, 10) > hasta) continue;
      ev.push({ fecha: l.cierre.slice(0, 10), tipo: 'licitacion', titulo: 'Último día para postular: ' + recortar(oracion(l.nombre), 70),
        estado: l.encaje, url: l.url });
    }
    for (let i = 0; i < 4; i++) {
      const d = fecha(hoy); d.setDate(1); d.setMonth(d.getMonth() + i); d.setDate(20);
      const f = iso(d);
      if (f >= hoy && f <= hasta) {
        const prev = new Date(d); prev.setMonth(prev.getMonth() - 1);
        ev.push({ fecha: f, tipo: 'impuesto', titulo: 'Último día para declarar y pagar los impuestos de ' + MESES[prev.getMonth()] + ' (formulario F29)', estado: 'tributario' });
      }
    }
    for (const p of X.porCobrar.filter(x => x.grupo === 'por_vencer' && x.vence >= hoy && x.vence <= hasta))
      ev.push({ fecha: p.vence, tipo: 'cobro', titulo: nombrePropio(p.cliente) + ' debería pagarte ' + mm(p.saldo) + ' (factura ' + p.folio + ')', estado: 'por cobrar' });
    if (X.comercial) for (const e of X.comercial.eventos) if (e.fecha <= hasta) ev.push(e);
    const fijos = [
      { fecha: '2026-12-31', tipo: 'hito', titulo: 'Fin de año: dejar listos los precios y fechas de 2027', estado: 'hito' },
      { fecha: '2027-01-06', tipo: 'hito', titulo: 'Primer Nivel 1 de 2027, ya con el precio nuevo: ' + clp(D.modelo.precios_2027.nivel1), estado: 'hito' },
      { fecha: '2027-03-31', tipo: 'hito', titulo: 'Día clave del plan: si de enero a marzo vendes a empresas menos de ' + mm(D.modelo.b2b_minimo_mes) + ' al mes, va el plan B', estado: 'hito' },
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
      ? 'Vendes bien, pero falta plata en el banco'
      : (pasado.cajaFinal < D.modelo.costos_fijos_mes ? 'Lo urgente es la plata en el banco' : 'Aéreo va por buen camino');
    const p = [];
    const mesesTxt = yLista(pasado.meses.map(m => mesNombre(m.mes)));
    p.push('La escuela anda muy bien: el Nivel 1 se agotó ' + cursos.racha.length + ' meses seguidos. De las ' +
      cursos.resN1.fechas + ' fechas de Nivel 1 que vienen, ya vendiste ' + cursos.resN1.vendidos + ' de ' + cursos.resN1.cupos + ' cupos. ' +
      (pasado.flujoOperacional >= 0 ? 'En ' + mesesTxt + ' la operación dejó ' + mm(pasado.flujoOperacional) + ' a favor.'
        : 'En ' + mesesTxt + ' operar costó ' + mm(-pasado.flujoOperacional) + ' más de lo que entró.'));
    // los hallazgos que el modelo marca como críticos se nombran con su propio título (texto del informe)
    const criticos = new Set(D.modelo.hallazgos_criticos || []);
    const hCrit = D.finanzas.hallazgos.filter(h => criticos.has(h.id));
    p.push('Pero esa plata no se quedó en la empresa: salieron ' + mm(-pasado.socioNeto) + ' a la cuenta del socio (descontando lo que devolvió) y ' +
      mm(-pasado.cofundador) + ' al cofundador. Desde Aéreo OTEC entraron ' + mm(pasado.otec) + '. Al ' + fDia(pasado.fechaCorte) + ' quedaban ' + clp(pasado.cajaFinal) +
      ' en el banco: alcanza para ' + futuro.runwayDias.toFixed(1).replace('.', ',') + ' días hábiles de gastos fijos.' +
      (hCrit.length ? ' Lo más urgente que encontró la revisión contable: ' + hCrit.map(h => h.titulo.replace(/\.$/, '').replace(/^./, c => c.toLowerCase())).join('; ') + '.' : ''));
    const com = X.comercial;
    const f0 = com && com.total ? com.pronostico.meses[0] : null;
    p.push('Para 2027, lo importante son las ventas a empresas. En ' + mesNombre(u.mes) + ' les vendiste ' + mm(u.b2b) + '. Lo mínimo para no perder plata es ' +
      mm(futuro.equilibrio) + ' al mes, y la meta, ' + mm(D.modelo.b2b_meta_mes) + '. ' +
      (despues && despues.b2bN ? 'Después, al ' + fDia(despues.hasta) + ', el SII ya muestra ' + mm(despues.b2b) + ' sin IVA facturados a empresas (' + despues.b2bN + (despues.b2bN === 1 ? ' factura' : ' facturas') + ', sin contar cupos de cursos abiertos)' +
        (despues.b2b >= D.modelo.b2b_meta_mes ? ': más que la meta del mes' : despues.b2b >= futuro.equilibrio ? ': más que lo mínimo' : '') + '. ' : '') +
      (dashboardConectado(com)
        ? 'En Ventas tienes ' + com.abiertas.n + ' cotizaciones esperando respuesta por ' + mm(com.abiertas.monto) + ' (lo probable: ' + mm(com.abiertas.ponderado) + '). En los últimos 90 días ganaste ' + mm(com.ganadas.ultimos90) +
          ', y para ' + mesNombre(f0.mes) + ' lo probable en ventas a empresas es ' + mm(f0.total)
        : 'Tu dashboard mostraba ' + mm(cot.abiertasMonto) + ' en cotizaciones esperando respuesta' + (cot.corte ? ' al ' + fDia(cot.corte) : '') + (cot.esperado ? ' (lo probable: ' + mm(cot.esperado) + ')' : '') +
          ', pero AerIA todavía no ve el detalle' + (com && com.total ? '. Lo que sí tengo (' + com.total + ' negocios sacados de facturas, Notion y el plan) suma ' + mm(com.ganadas.ultimos90) + ' ganados en 90 días' : '')) +
      '. Además hay ' + lic.relevantes.length + (lic.relevantes.length === 1 ? ' concurso del Estado (licitación) abierto que calza' : ' concursos del Estado (licitaciones) abiertos que calzan') + ' con lo que hace Aéreo.');
    const hoyTxt = [];
    if (!dashboardConectado(com)) hoyTxt.push('conectar tu dashboard de cotizaciones a AerIA');
    if (capUrg.length) hoyTxt.push('postular a ' + capUrg.length + (capUrg.length === 1 ? ' concurso' : ' concursos') + ' de capacitación que ' + (capUrg.length === 1 ? 'cierra' : 'cierran') + ' en menos de 72 horas');
    if (totalCobrar) hoyTxt.push('cobrar ' + mm(totalCobrar) + ' de facturas atrasadas');
    if (porVencer.length) hoyTxt.push('estar atento a ' + mm(porVencer.reduce((s, x) => s + x.saldo, 0)) + ' facturados que deberían pagarte entre el ' + fDia(porVencer.map(x => x.vence).sort()[0]) + ' y el ' + fDia(porVencer.map(x => x.vence).sort().pop()));
    if (hCrit.length) hoyTxt.push('resolver con tu contador ' + (hCrit.length === 1 ? 'el tema urgente' : 'los ' + hCrit.length + ' temas urgentes') + ' de la revisión contable');
    if (pasado.cajaFinal < D.modelo.costos_fijos_mes) hoyTxt.push('decidir un piso de plata que nunca se saca del banco');
    p.push(hoyTxt.length ? 'Esta semana te recomiendo: ' + yLista(hoyTxt) + '.' : 'Esta semana no veo nada urgente.');
    return { titular, parrafos: p, criticas };
  }

  /* ---------- EN SIMPLE: la empresa contada con palabras de todos los días ----------
     Cinco preguntas fijas (plata, cobros, ventas, equipo, cursos), cada una con semáforo,
     una frase y tres pasos que se abren: por qué, qué hacer y los números. Nada se calcula
     aquí que no venga de analizar; solo se elige qué decir y cómo. Sin jerga: «ventas a
     empresas» en vez de B2B, «lo mínimo para no perder plata» en vez de equilibrio,
     «lo probable» en vez de ponderado. Los montos de cotizaciones van sin IVA (q.valor). */
  function fDia(s) { const d = fecha(s); return d.getDate() + ' de ' + MESES[d.getMonth()]; }
  const yLista = a => a.length > 1 ? a.slice(0, -1).join(', ') + ' y ' + a[a.length - 1] : (a[0] || '');
  const mayus = t => String(t || '').replace(/^./, c => c.toUpperCase());
  const minus = t => String(t || '').replace(/^./, c => c.toLowerCase());
  function diasTxt(n) { const r = Math.round(n); return n < 1 ? 'menos de un día' : r === 1 ? 'un día' : 'unos ' + r + ' días'; }
  const PALABRAS = [
    [/\bVenta B2B\b/g, 'Venta a empresas'], [/\bel B2B\b/g, 'la venta a empresas'], [/\bB2B\b/g, 'venta a empresas'],
    [/\bel N2\+N3\b/g, 'los Niveles 2 y 3'], [/\bNiveles 2\+3\b/g, 'Niveles 2 y 3'], [/\begresos\b/g, 'gastos'],
    [/saldo m[ií]nimo de operaci[oó]n/gi, 'piso de plata en el banco'], [/\bcartera\b/g, 'ventas'],
    [/\bfactoring\b/g, 'venta de la factura a una financiera'], [/\bin-company\b/g, 'para una empresa'],
    [/\bponderado\b/g, 'lo probable'], [/\bequilibrio\b/g, 'lo mínimo para no perder plata'],
    [/\bN2\+N3\b/g, 'Niveles 2 y 3'], [/\bN1\b/g, 'Nivel 1'], [/enero[–-]marzo/g, 'enero a marzo'],
    [/\b(ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic) \d{2}\b/g, m => MESES[MES3.indexOf(m.slice(0, 3))]],
    [/\bcostos fijos\b/g, 'gastos fijos'], [/\bFlujo de caja libre\b/g, 'Plata libre (después de pagar todo)'],
    [/^Caja a fin de mes/, 'Plata en el banco a fin de mes'], [/^Ocupación /, 'Cupos vendidos, '],
  ];
  const sinJerga = t => PALABRAS.reduce((x, [re, por]) => x.replace(re, por), String(t || ''));
  // «MUNICIPALIDAD DE VILLA FICTICIA» → «Municipalidad de Villa Ficticia»; lo que ya trae minúsculas queda igual
  const CHICAS = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y', 'e', 'en', 'para', 'por', 'a']);
  const nombrePropio = t => /[a-záéíóúñ]/.test(String(t || '')) ? String(t || '') : String(t || '').toLowerCase()
    .replace(/[^\s·\-/]+/g, (w, i) => (i > 0 && CHICAS.has(w)) ? w : w.replace(/^./, c => c.toUpperCase()));
  function explicar(D, I) {
    const { pasado: P, futuro: U, cursos: Cu, lic, porCobrar, despues: Dp, comercial: R } = I;
    const Mo = D.modelo;
    const con = dashboardConectado(R);
    const hayCom = !!(R && R.total);
    const cot = id => hayCom ? R.cotizaciones.find(q => q.id === id) : null;
    const val = q => (q && (q.valor != null ? q.valor : q.monto)) || 0;
    const suma = (l, f) => l.reduce((a, x) => a + f(x), 0);
    const alerta = id => I.alertas.find(a => a.id === id);
    const pend = f => I.agenda.filter(f);
    const tab = id => (I.tablero.find(t => t.id === id) || {});
    const temas = [];

    // 1) ¿Cuánta plata hay en el banco?
    const colchon = Mo.costos_fijos_mes;
    const estCaja = tab('caja').estado;
    const socios = -((P.socioNeto || 0) + (P.cofundador || 0));
    const diasDato = diasEntre(P.fechaCorte, I.hoy);
    const meses = yLista(P.meses.map(m => mesNombre(m.mes)));
    const f29 = (I.viene || []).find(e => e.tipo === 'impuesto');
    const semPlata = estCaja === 'critico' ? 'urgente' : estCaja === 'atencion' ? 'ojo' : estCaja === 'bien' ? 'bien' : (P.cajaFinal < colchon ? 'ojo' : 'bien');
    const finCrit = pend(it => /^fin-/.test(it.id) && (alerta(it.id) || {}).nivel === 'critica');
    const Cn = I.contable;
    // el año según el pre cierre del contador, en una frase
    const anioPlata = Cn ? 'Según el contador, de ' + Cn.etiqueta + ' Aéreo vendió ' + mm(Cn.ventas) + ' (sin IVA).' +
      (Cn.sinDoc > 0 || Cn.socios.prestamosTotal > 0 ? ' Pero ' + yLista([Cn.sinDoc > 0 ? 'hay ' + mm(Cn.sinDoc) + ' pagados sin boleta, factura ni rendición' : null,
        Cn.socios.prestamosTotal > 0 ? 'la empresa les debe ' + mm(Cn.socios.prestamosTotal) + ' a los socios' : null].filter(Boolean)) + '.' : '') : null;
    const prevision = t => sinJerga(t).replace(/\bcotizaciones\b(?! previsionales)/g, 'cotizaciones previsionales').replace(/\bF29\b(?! \()/g, 'F29 (pago mensual de impuestos)');
    const hacerPlata = [];
    if (I.agenda.some(it => it.id === 'caja')) hacerPlata.push({ id: 'caja', texto: 'Fijar un piso de ' + mm(colchon) + ' en el banco y retirar solo lo que sobre', por: 'Los retiros de socios, después de pagar los gastos del mes' });
    for (const it of finCrit) hacerPlata.push({ id: it.id, texto: prevision(it.titulo), por: sinJerga(it.por) });
    for (const it of pend(it => /^cont-/.test(it.id))) if (hacerPlata.length < 3) hacerPlata.push({ id: it.id, texto: sinJerga(it.titulo), por: sinJerga(it.por) });
    if (hacerPlata.length < 3 && I.agenda.some(it => it.id === 'cobrar')) hacerPlata.push({ id: 'cobrar', texto: sinJerga(I.agenda.find(it => it.id === 'cobrar').titulo).replace(/vencidos?$/, 'atrasados') });
    temas.push({
      id: 'plata', pregunta: '¿Cuánta plata hay en el banco?', nombre: 'la plata en el banco', semaforo: semPlata,
      frase: semPlata === 'bien'
        ? 'Al ' + fDia(P.fechaCorte) + ', Aéreo tenía ' + clp(P.cajaFinal) + ' en el banco: más que el mínimo del plan (' + mm(colchon) + ').'
        : 'Al ' + fDia(P.fechaCorte) + ', Aéreo tenía ' + clp(P.cajaFinal) + ' en el banco. Alcanza para pagar ' + diasTxt(U.runwayDias) + ' de gastos fijos.',
      porque: [
        P.flujoOperacional >= 0 ? 'En ' + meses + ', la operación dejó ' + mm(P.flujoOperacional) + ' a favor: entró más de lo que se gastó.'
          : 'En ' + meses + ', operar costó ' + mm(-P.flujoOperacional) + ' más de lo que entró.',
        socios > 0 ? 'Pero salieron ' + mm(socios) + ' a los socios' + (socios > P.flujoOperacional ? ', más de lo que dejó la operación' : '') + '.' + (P.otec > 0 ? ' De Aéreo OTEC entraron ' + mm(P.otec) + '.' : '') : null,
        'El plan pide tener siempre ' + mm(colchon) + ' en el banco: un mes de gastos fijos.',
        anioPlata,
        diasDato > 7 ? 'Ese dato del banco tiene ' + diasDato + ' días.' + (Dp && Dp.cobradoRegistro ? ' Después, tu registro anota ' + mm(Dp.cobradoRegistro) + ' cobrados, sin confirmar en el banco.' : '')
          : (f29 && f29.dias <= 7 ? 'El ' + fDia(f29.fecha) + ' vence el F29 (pago mensual de impuestos).' : null),
      ].filter(Boolean),
      hacer: hacerPlata.slice(0, 3),
      numeros: [
        { l: 'En el banco al ' + fCorta(P.fechaCorte), v: clp(P.cajaFinal), cls: semPlata === 'bien' ? '' : 'mal' },
        { l: 'Mínimo del plan', s: 'un mes de gastos fijos', v: mm(colchon) },
        { l: 'Lo que dejó la operación', s: P.etiqueta, v: mm(P.flujoOperacional), cls: P.flujoOperacional >= 0 ? 'bien' : 'mal' },
        { l: 'Salió a los socios', s: P.etiqueta, v: mm(socios), cls: socios > 0 ? 'mal' : '' },
        P.otec ? { l: 'Entró de Aéreo OTEC', s: P.etiqueta, v: mm(P.otec) } : null,
        Cn && Cn.sinDoc > 0 ? { l: 'Pagado sin documento', s: Cn.etiqueta + ', según el contador', v: mm(Cn.sinDoc), cls: 'mal' } : null,
        Cn && Cn.socios.prestamosTotal > 0 ? { l: 'La empresa les debe a los socios', s: 'al ' + fCorta(Cn.hasta), v: mm(Cn.socios.prestamosTotal), cls: 'mal' } : null,
        f29 ? { l: 'Próximo F29 (impuestos)', v: (f29.dias === 0 ? 'hoy, ' : f29.dias === 1 ? 'mañana, ' : '') + fCorta(f29.fecha), cls: f29.dias <= 1 ? 'mal' : '' } : null,
      ].filter(Boolean),
      detalle: { tab: 'pasado', capa: 'pasado-caja', texto: 'Ver la plata día a día' },
      detalle2: Cn ? { tab: 'pasado', capa: 'pasado-anio', texto: 'Ver el año según el contador' }
        : finCrit.length ? { tab: 'pasado', capa: 'pasado-revision', texto: 'Ver lo que encontró la revisión contable' } : null,
      fuente: 'cartolas del banco, SII y Mercado Pago (' + P.etiqueta + ')' + (Cn ? '; ' + minus(Cn.fuente) : '') + '; el mínimo sale del plan 2027',
    });

    // 2) ¿Qué falta facturar y cobrar?
    const venc = porCobrar.filter(p => p.grupo === 'vencida'), pv = porCobrar.filter(p => p.grupo === 'por_vencer'), conf = porCobrar.filter(p => p.grupo === 'por_confirmar');
    const deben = suma(porCobrar.filter(p => p.grupo !== 'por_confirmar'), p => p.saldo), atrasado = suma(venc, p => p.saldo), porConf = suma(conf, p => p.saldo);
    const vences = pv.map(p => p.vence).sort();
    const porFac = hayCom ? (R.ganadas.porFacturar || []) : [];
    const montoFac = suma(porFac, val);
    const mayorFac = porFac.slice().sort((a, b) => val(b) - val(a))[0];
    const mayor = porCobrar.find(p => p.grupo !== 'por_confirmar');
    const masAtrasada = venc.slice().sort((a, b) => a.vence.localeCompare(b.vence))[0];
    const plazo = Mo.plazo_cobro_dias || 30;
    const semCobros = venc.length ? 'urgente'
      : (conf.length || I.alertas.some(a => /^com-(facturar|cobrar)-/.test(a.id)) || pv.some(p => diasEntre(I.hoy, p.vence) <= 7)) ? 'ojo' : 'bien';
    const facAg = pend(it => /^com-fac-/.test(it.id));
    const hacerCobros = [];
    if (venc.length && I.agenda.some(it => it.id === 'cobrar')) hacerCobros.push({ id: 'cobrar', texto: 'Cobrar ' + mm(atrasado) + ' atrasados', por: yLista([...new Set(venc.map(p => nombrePropio(p.cliente)))].slice(0, 3)) });
    if (facAg.length) hacerCobros.push({
      ids: facAg.map(it => it.id),
      texto: 'Facturar las ' + (facAg.length === 1 ? 'venta más grande' : facAg.length + ' ventas más grandes') + ' sin factura (' + mm(suma(facAg, it => val(cot(it.cotizacion)))) + ') o anotar sus facturas',
      por: porFac.length > facAg.length ? 'Hay ' + porFac.length + ' en total (' + mm(montoFac) + ')' : '',
      grupo: facAg.map(it => { const q = cot(it.cotizacion); return { id: it.id, cotizacion: it.cotizacion, texto: /^Confirmar/.test(it.titulo) ? sinJerga(it.titulo) : 'Facturar a ' + nombrePropio(q ? q.cliente : '') + ' (' + mm(val(q)) + ')' }; }),
    });
    if (I.agenda.some(it => it.id === 'cobrar-confirmar')) hacerCobros.push({ id: 'cobrar-confirmar', texto: 'Revisar en el banco si ya pagaron ' + conf.length + (conf.length === 1 ? ' factura' : ' facturas') + ' (' + mm(porConf) + ')', por: yLista([...new Set(conf.map(p => nombrePropio(p.cliente)))].slice(0, 3)) });
    temas.push({
      id: 'cobros', pregunta: '¿Qué falta facturar y cobrar?', nombre: 'lo que falta facturar y cobrar', semaforo: semCobros,
      frase: (deben ? 'Te deben ' + mm(deben) + ' en facturas ya enviadas, ' + (atrasado ? 'y ' + mm(atrasado) + ' ya pasó su plazo de pago.'
          : vences.length > 1 ? 'que vencen entre el ' + fDia(vences[0]) + ' y el ' + fDia(vences[vences.length - 1]) + '.' : vences.length ? 'que vence el ' + fDia(vences[0]) + '.' : 'sin plazo vencido.')
        : porFac.length ? 'No hay facturas por cobrar.' : 'No hay facturas por cobrar ni ventas por facturar.') +
        (porFac.length ? (deben ? ' Y hay ' : ' Pero hay ') + porFac.length + (porFac.length === 1 ? ' venta ganada sin factura anotada' : ' ventas ganadas sin factura anotada') + ', por ' + mm(montoFac) + '.' : ''),
      porque: [
        'Una venta se vuelve plata cuando se factura y el cliente paga. El plazo normal es de ' + plazo + ' días.',
        masAtrasada ? 'La más atrasada es de ' + nombrePropio(masAtrasada.cliente) + ': ' + mm(masAtrasada.saldo) + ', venció el ' + fDia(masAtrasada.vence) + '.'
          : mayor ? 'La factura más grande es de ' + nombrePropio(mayor.cliente) + ': ' + mm(mayor.saldo) + (mayor.vence ? ', vence el ' + fDia(mayor.vence) : '') + '.' : null,
        mayorFac ? 'La venta más grande sin factura es de ' + nombrePropio(mayorFac.cliente) + ': ' + mm(val(mayorFac)) + '. Quizás ya la facturaste y falta anotarla.' : null,
        conf.length ? 'De otros ' + mm(porConf) + ' (' + conf.length + (conf.length === 1 ? ' factura' : ' facturas') + ') no sé si ya te pagaron: hay que mirarlo en el banco.' : null,
      ].filter(Boolean),
      hacer: hacerCobros.slice(0, 3),
      numeros: [
        { l: 'Te deben', s: 'facturas enviadas', v: mm(deben) },
        { l: 'Ya pasó su plazo', v: mm(atrasado), cls: atrasado ? 'mal' : '' },
        { l: 'Vence pronto', s: vences.length ? 'entre el ' + fCorta(vences[0]) + ' y el ' + fCorta(vences[vences.length - 1]) : '', v: mm(suma(pv, p => p.saldo)) },
        { l: 'No sé si ya pagaron', v: mm(porConf) },
        hayCom ? { l: 'Ventas ganadas sin factura', s: porFac.length + ' ventas, sin IVA', v: mm(montoFac) } : null,
      ].filter(Boolean),
      detalle: { tab: 'presente', capa: 'presente-cobros', texto: 'Ver quién debe' },
      detalle2: porFac.length ? { tab: 'comercial', ancla: 'panel-mover', texto: 'Ver las ventas por facturar' } : null,
      fuente: 'SII y cartolas' + (D.finanzas.sii_hasta ? ' (SII al ' + fCorta(D.finanzas.sii_hasta) + ')' : '') + '; ventas ganadas de Comercial',
    });

    // 3) ¿Vendemos lo suficiente a empresas? (y qué significa para 2027)
    const u = P.meses[P.meses.length - 1];
    const mesId = I.hoy.slice(0, 7), dia = Number(I.hoy.slice(8, 10));
    const f0 = hayCom ? R.pronostico.meses[0] : null, f1 = hayCom ? R.pronostico.meses[1] : null;
    const fact = Dp && Dp.b2bN && String(Dp.hasta).slice(0, 7) === mesId ? Dp.b2b : null;
    const vendido = fact != null ? fact : (con && f0 ? f0.ganado : null);
    const verbo = fact != null ? 'facturaste' : 'ganaste';
    const comoVa = v => v >= Mo.b2b_meta_mes ? 'más que la meta del mes (' + mm(Mo.b2b_meta_mes) + ')' : v >= U.equilibrio ? 'más de lo mínimo para no perder plata' : 'menos de lo mínimo para no perder plata (' + mm(U.equilibrio) + ')';
    const ritmo = U.escenarios.find(e => e.id === 'ultimo'), metaEsc = U.escenarios.find(e => e.id === 'meta');
    const flojo = con && f1 && f1.total < U.equilibrio;
    const semVentas = (con ? ((alerta('com-pronostico-' + mesId) || {}).nivel === 'alta' && dia >= 15) : (I.alertas.some(a => /^b2b-/.test(a.id) && a.nivel === 'critica') && !(fact >= Mo.b2b_minimo_mes))) ? 'urgente'
      : (!con || I.alertas.some(a => /^com-pronostico-/.test(a.id)) || ritmo.resultado < 0) ? 'ojo' : 'bien';
    const sinFecha = hayCom ? (R.ganadas.porMes.find(m => m.mes === 'sin fecha') || null) : null;
    const hacerVentas = [];
    for (const it of pend(it => /^com-pronostico-/.test(it.id)).slice(0, 1)) hacerVentas.push({ id: it.id, texto: 'Cotizar más a empresas para cerrar en ' + mesNombre(it.id.slice(15)) + ': SENCE, cursos cerrados, AOC o servicios con drones' });
    for (const it of pend(it => /^lic-/.test(it.id)).slice(0, 1)) {
      const l = lic.relevantes.find(x => 'lic-' + x.codigo === it.id);
      hacerVentas.push({ id: it.id, texto: l ? 'Preparar la oferta para ' + nombrePropio(l.organismo) + ': cierra el ' + fDia(l.cierre.slice(0, 10)) : sinJerga(it.titulo), url: it.url || '' });
    }
    const b2bAl = I.alertas.find(a => /^b2b-/.test(a.id));
    if (b2bAl) hacerVentas.push({ alerta: b2bAl.id, texto: 'Armar desde ya las ventas a empresas de enero a marzo', por: Mo.mix_b2b_meta ? 'La receta de cada mes: ' + sinJerga(Mo.mix_b2b_meta).replace(/curso cerrado o para una empresa/g, 'curso cerrado para una empresa').replace(/\b1 AOC\b/g, '1 asesoría AOC').replace(/~\$/g, 'cerca de $') : '' });
    temas.push({
      id: 'ventas', pregunta: '¿Vendemos lo suficiente a empresas?', nombre: 'cuánto le vendemos a empresas', semaforo: semVentas,
      frase: (vendido != null && (dia > 10 || vendido >= u.b2b) ? 'En ' + MESES[fecha(I.hoy).getMonth()] + ' ya ' + verbo + ' ' + mm(vendido) + ' a empresas: ' + comoVa(vendido) + '.'
          : 'En ' + mesNombre(u.mes) + ' le vendiste ' + mm(u.b2b) + ' a empresas: ' + comoVa(u.b2b) + '.') +
        (flojo ? ' ' + mayus(mesNombre(f1.mes)) + ' viene flojo: por ahora, lo probable es ' + mm(f1.total) + '.' : '') +
        (!con ? ' Aún no veo tus cotizaciones, así que no sé cómo viene ' + mesNombre(sumarMesesISO(I.hoy, 1)) + '.' : ''),
      porque: [
        'Para no perder plata hay que venderles ' + mm(U.equilibrio) + ' al mes a empresas. La meta es ' + mm(Mo.b2b_meta_mes) + '.',
        'Si en 2027 le vendes a empresas como en ' + mesNombre(u.mes) + ' (' + mm(ritmo.b2b) + ' al mes), el año ' + (ritmo.resultado < 0 ? 'pierde ' + mm(-ritmo.resultado) : 'gana ' + mm(ritmo.resultado)) + '.' + (metaEsc ? ' Con la meta, ' + (metaEsc.resultado >= 0 ? 'gana ' + mm(metaEsc.resultado) : 'pierde ' + mm(-metaEsc.resultado)) + '.' : ''),
        flojo ? 'Para ' + mesNombre(f1.mes) + (f1.ganado > 0 ? ' llevas ' + mm(f1.ganado) + ' ganado.' : ' todavía no hay nada ganado.') + (R.ciclo != null && (R.cicloMuestra || 0) >= 3 ? ' Una venta tarda unos ' + Math.round(R.ciclo) + ' días: lo de ' + mesNombre(f1.mes) + ' se cotiza ahora.' : '')
          : 'En ' + mesNombre(u.mes) + ' fueron ' + mm(u.b2b) + ' a empresas' + (u.escuela != null ? ' y ' + mm(u.escuela) + ' en cursos de la escuela' : '') + '.',
        'Faltan ' + U.diasHito + ' días para el ' + fDia(U.hito.fecha) + '. Ese día, si de enero a marzo vendiste menos de ' + mm(Mo.b2b_minimo_mes) + ' al mes, va el plan B.',
      ].filter(Boolean),
      hacer: hacerVentas.slice(0, 3),
      numeros: [
        fact != null ? { l: 'Facturado a empresas en ' + MESES[fecha(I.hoy).getMonth()], s: 'al ' + fCorta(Dp.hasta) + ', sin IVA', v: mm(fact), cls: fact >= U.equilibrio ? 'bien' : '' } : null,
        { l: 'Vendido a empresas en ' + mesNombre(u.mes), v: mm(u.b2b), cls: u.b2b >= U.equilibrio ? 'bien' : 'mal' },
        { l: 'Mínimo al mes para no perder plata', v: mm(U.equilibrio) },
        { l: 'Meta al mes', v: mm(Mo.b2b_meta_mes) },
        con && f1 ? { l: 'Lo probable para ' + mesNombre(f1.mes), s: 'ganado + lo probable de lo cotizado', v: mm(f1.total), cls: f1.total < U.equilibrio ? 'mal' : 'bien' } : null,
        { l: '2027 al ritmo de ' + mesNombre(u.mes), v: mm(ritmo.resultado), cls: ritmo.resultado < 0 ? 'mal' : 'bien' },
        sinFecha && sinFecha.n ? { l: 'Ventas ganadas sin fecha de cierre', s: 'no entran en ningún mes', v: sinFecha.n + ' · ' + mm(sinFecha.monto) } : null,
      ].filter(Boolean),
      detalle: { tab: 'comercial', capa: 'com-numeros', texto: 'Ver las ventas mes a mes' },
      detalle2: { tab: 'futuro', capa: 'futuro-sim', texto: 'Probar qué pasa en 2027' },
      fuente: 'SII (facturado sin IVA), cotizaciones de Comercial y el modelo del plan 2027',
    });

    // 4) ¿En qué anda el equipo? (lo que se está cotizando y a quién falta llamar)
    if (!hayCom) {
      const conectar = I.agenda.find(it => it.id === 'cot-antiguas');
      temas.push({
        id: 'equipo', pregunta: '¿En qué anda el equipo?', nombre: 'las cotizaciones del equipo', semaforo: 'ojo',
        frase: 'Todavía no hay cotizaciones en AerIA: conecta tu dashboard para ver lo que está cotizando el equipo.',
        porque: ['Sin las cotizaciones no puedo decirte a quién falta llamar, qué se está por cerrar ni cuánto se espera vender.'],
        hacer: conectar ? [{ id: conectar.id, texto: 'Conectar tu dashboard de cotizaciones a AerIA' }] : [],
        numeros: [], detalle: { tab: 'comercial', texto: 'Ir a Ventas' }, fuente: 'cotizaciones de Comercial',
      });
    } else {
      const ab = R.cotizaciones.filter(q => q.abierta && !q.estancada);
      const frias = ab.filter(q => q.diasSinContacto != null && q.diasSinContacto > 14).length;
      const alDia = R.cotizaciones.filter(q => q.abierta && q.diasSinContacto != null && q.diasSinContacto <= 7).length;
      const desde30 = sumarDias(I.hoy, -30);
      const env30 = R.cotizaciones.filter(q => q.fecha_cotizacion && q.fecha_cotizacion >= desde30 && q.fecha_cotizacion <= I.hoy);
      const gan30 = env30.filter(q => q.estado === 'ganada').length, perd30 = env30.filter(q => q.estado === 'perdida' || q.estado === 'vencida').length;
      const deCada10 = R.tasa && R.tasa.muestra >= 10 && R.tasa.cantidad != null ? Math.round(R.tasa.cantidad * 10) : null;
      const cierres = pend(it => /^com-cierre-/.test(it.id));
      const semEquipo = con && (R.abiertas.n === 0 || I.alertas.some(a => /^com-seguimientos-/.test(a.id) && a.nivel === 'alta')) ? 'urgente'
        : (!con || I.alertas.some(a => /^com-(seguimientos|frias|cierres)-/.test(a.id))) ? 'ojo' : 'bien';
      // las llamadas se agrupan por cliente: marcar la fila marca todas sus cotizaciones
      const porCliente = new Map();
      for (const it of pend(it => /^com-seg-/.test(it.id))) {
        const q = cot(it.cotizacion); if (!q) continue;
        const k = plano(q.cliente);
        const g = porCliente.get(k) || { cliente: nombrePropio(q.cliente), ids: [], qs: [] };
        g.ids.push(it.id); g.qs.push(q); porCliente.set(k, g);
      }
      const hacerEquipo = [...porCliente.values()].sort((a, b) => suma(b.qs, val) - suma(a.qs, val)).slice(0, 3).map(g => {
        const mayorQ = g.qs.slice().sort((a, b) => val(b) - val(a))[0];
        return { ids: g.ids, cotizacion: mayorQ.id, texto: g.qs.length === 1 ? 'Llamar a ' + g.cliente + ' por su cotización de ' + mm(val(mayorQ)) : 'Llamar a ' + g.cliente + ' por sus ' + g.qs.length + ' cotizaciones (' + mm(suma(g.qs, val)) + ')',
          por: Math.max(...g.qs.map(q => q.diasSinContacto || 0)) + ' días sin contacto' };
      });
      if (hacerEquipo.length < 3) for (const it of cierres.slice(0, 3 - hacerEquipo.length)) { const q = cot(it.cotizacion); hacerEquipo.push({ id: it.id, cotizacion: it.cotizacion, texto: 'Definir con ' + nombrePropio(q ? q.cliente : 'el cliente') + ' si se gana o se pierde' }); }
      temas.push({
        id: 'equipo', pregunta: '¿En qué anda el equipo?', nombre: 'las cotizaciones que esperan una llamada', semaforo: semEquipo,
        frase: !con ? 'Tu dashboard de cotizaciones no está conectado: todavía no veo todo lo que hace el equipo.'
          : R.abiertas.n === 0 ? 'No hay cotizaciones esperando respuesta: nadie está cotizando.'
          : 'Hay ' + R.abiertas.n + (R.abiertas.n === 1 ? ' cotización esperando respuesta' : ' cotizaciones esperando respuesta') + ', por ' + mm(R.abiertas.monto) + '. ' +
            (frias ? (frias === 1 ? 'Una lleva' : frias + ' llevan') + ' más de 2 semanas sin una llamada.' : 'Todas tuvieron contacto en las últimas 2 semanas.'),
        porque: [
          env30.length ? 'En los últimos 30 días el equipo envió ' + env30.length + (env30.length === 1 ? ' cotización' : ' cotizaciones') + ': ' + gan30 + ' ya ' + (gan30 === 1 ? 'se ganó' : 'se ganaron') + ' y ' + perd30 + ' ' + (perd30 === 1 ? 'se perdió' : 'se perdieron') + '.'
            : 'En los últimos 30 días no salió ninguna cotización nueva.',
          R.abiertas.n ? (alDia >= R.abiertas.n ? 'En los últimos 7 días todas tuvieron contacto.' : (alDia ? 'En los últimos 7 días solo ' + alDia + ' de las ' + R.abiertas.n + (alDia === 1 ? ' tuvo' : ' tuvieron') + ' contacto.' : 'En los últimos 7 días ninguna de las ' + R.abiertas.n + ' tuvo contacto.') + ' Sin llamada, una cotización se enfría.') : null,
          cierres.length ? cierres.length + (cierres.length === 1 ? ' cotización pasó' : ' cotizaciones pasaron') + ' su fecha de cierre: hay que definir si se ganan o se pierden.'
            : deCada10 != null ? 'De cada 10 cotizaciones que los clientes deciden, ganas ' + deCada10 + '.' : null,
          R.abiertas.n ? 'De lo que espera respuesta, lo probable es cerrar unos ' + mm(R.abiertas.ponderado) + '.' : null,
        ].filter(Boolean),
        hacer: hacerEquipo,
        numeros: [
          { l: 'Esperando respuesta', s: R.abiertas.n + ' cotizaciones, sin IVA', v: mm(R.abiertas.monto) },
          { l: 'Lo probable de cerrar', v: mm(R.abiertas.ponderado) },
          { l: 'Enviadas en 30 días', s: gan30 + (gan30 === 1 ? ' ganada · ' : ' ganadas · ') + perd30 + (perd30 === 1 ? ' perdida' : ' perdidas'), v: String(env30.length) },
          deCada10 != null ? { l: 'De cada 10 que se deciden, ganas', v: String(deCada10) } : null,
          R.ciclo != null ? { l: 'Días que tarda una venta', s: R.cicloMuestra ? 'promedio de ' + R.cicloMuestra + ' ventas' : '', v: String(Math.round(R.ciclo)) } : null,
        ].filter(Boolean),
        detalle: { tab: 'comercial', ancla: 'panel-cotizaciones', filtro: 'abiertas', texto: 'Ver las cotizaciones' },
        detalle2: { tab: 'mando', capa: 'agenda', texto: 'Ver la lista completa de tareas' },
        fuente: 'cotizaciones de Comercial' + (con ? ' (tu dashboard)' : '') + ' y tareas marcadas en AerIA',
      });
    }

    // 5) ¿Se están llenando los cursos?
    const prox = Cu.proximos.filter(c => c.dias >= 0);
    const c21 = prox.filter(c => c.dias <= 21);
    const libres21 = suma(c21, c => c.libres), cupos21 = suma(c21, c => c.max);
    const lejos = prox.filter(c => c.dias > 21);
    const pronto = c21.filter(c => c.libres >= 3).slice(0, 2);
    const conFeriado = prox.find(c => c.feriados.length);
    const vacios = lejos.filter(c => c.vendidos === 0);
    const nombreCurso = c => 'de ' + String(c.nombre || c.corto || '').replace('+', ' y ').replace(/^N1$/, 'Nivel 1').replace(/^N2 y N3$/, 'Niveles 2 y 3');
    const estN = [tab('ocup_n1').estado, tab('ocup_n23').estado];
    const semCursos = (estN.includes('critico') || I.alertas.some(a => /^vender-/.test(a.id) && a.nivel === 'alta') || prox.some(c => c.feriados.length && c.dias <= 14)) ? 'urgente'
      : (estN.includes('atencion') || I.alertas.some(a => /^(feriado|vender)-/.test(a.id) || a.id === 'preventa')) ? 'ojo' : 'bien';
    const curso = id => prox.find(c => id === 'vender-' + c.nivel + '-' + c.inicio || id === 'feriado-' + c.nivel + '-' + c.inicio);
    const hacerCursos = pend(it => /^(feriado|vender)-|^preventa$/.test(it.id)).slice(0, 3).map(it => {
      const c = curso(it.id);
      if (/^feriado-/.test(it.id) && c) return { id: it.id, texto: 'Cambiarle la fecha al curso ' + nombreCurso(c) + ' del ' + fDia(c.inicio) + (c.vendidos ? ' y avisar a ' + (c.vendidos === 1 ? 'la persona inscrita' : 'los ' + c.vendidos + ' inscritos') : ''), por: 'Cae en feriado (' + c.feriados[0].nombre + ')' };
      if (/^vender-/.test(it.id) && c) return { id: it.id, texto: 'Llenar el curso ' + nombreCurso(c) + ' del ' + fDia(c.inicio) + ': ' + (c.libres === 1 ? 'queda 1 cupo' : 'quedan ' + c.libres + ' cupos'), por: 'Ofrécelos a la lista de espera y a empresas con SENCE' };
      if (it.id === 'preventa') return { id: it.id, texto: 'Lanzar una preventa con fecha límite para ' + yLista([...new Set(vacios.map(c => MESES[fecha(c.inicio).getMonth()]))]) };
      return { id: it.id, texto: sinJerga(it.titulo) };
    });
    temas.push({
      id: 'cursos', pregunta: '¿Se están llenando los cursos?', nombre: 'los cupos libres de los cursos', semaforo: semCursos,
      frase: (cupos21 ? (libres21 ? 'En las próximas 3 semanas quedan ' + libres21 + ' cupos libres de ' + cupos21 + '.' : 'Los cursos de las próximas 3 semanas están llenos.') : 'No hay cursos en las próximas 3 semanas.') + ' ' +
        (Cu.racha.length >= 3 ? 'El Nivel 1 se agotó ' + Cu.racha.length + ' meses seguidos.' : 'Más adelante llevas ' + suma(lejos, c => c.vendidos) + ' de ' + suma(lejos, c => c.max) + ' cupos vendidos.'),
      porque: [
        ...pronto.map(c => c.libres === c.max ? 'El curso ' + nombreCurso(c) + ' del ' + fDia(c.inicio) + ' empieza ' + cuando(c.dias) + ' y todavía no vende ningún cupo.'
          : 'El curso ' + nombreCurso(c) + ' del ' + fDia(c.inicio) + ' tiene ' + c.libres + ' de ' + c.max + ' cupos libres y empieza ' + cuando(c.dias) + '.'),
        conFeriado ? 'El curso ' + nombreCurso(conFeriado) + ' del ' + fDia(conFeriado.inicio) + ' cae en feriado (' + conFeriado.feriados[0].nombre + '): hay que cambiarle la fecha.' : null,
        vacios.length >= 3 ? 'Hay ' + vacios.length + ' fechas de ' + yLista([...new Set(vacios.map(c => MESES[fecha(c.inicio).getMonth()]))]) + ' sin ningún cupo vendido todavía.' : null,
        'Los ' + (Cu.resN1.libres + Cu.resN23.libres) + ' cupos libres valen ' + mm(Cu.resN1.libreMonto + Cu.resN23.libreMonto) + ' a precio de hoy.',
      ].filter(Boolean).slice(0, 4),
      hacer: hacerCursos,
      numeros: [
        cupos21 ? { l: 'Próximas 3 semanas', s: libres21 + ' libres de ' + cupos21, v: pct(1 - libres21 / cupos21) + ' vendido' } : null,
        { l: 'Nivel 1', s: Cu.resN1.fechas + ' fechas publicadas', v: Cu.resN1.vendidos + ' de ' + Cu.resN1.cupos },
        { l: 'Niveles 2 y 3', s: Cu.resN23.fechas + ' fechas publicadas', v: Cu.resN23.vendidos + ' de ' + Cu.resN23.cupos },
        { l: 'Cupos libres', s: 'a precio de hoy', v: mm(Cu.resN1.libreMonto + Cu.resN23.libreMonto) },
      ].filter(Boolean),
      detalle: { tab: 'presente', capa: 'presente-cursos', texto: 'Ver los cursos fecha por fecha' },
      fuente: 'cursos publicados en aereo.cl' + (D.cursos.extraido ? ' (al ' + fCorta(String(D.cursos.extraido).slice(0, 10)) + ')' : ''),
    });

    // «Lo que tienes que hacer»: la agenda dicha en simple, una fila por tarea o por grupo
    const temaDe = id => /^(caja|fin-|plan-|cruce-)/.test(id) ? 'plata' : /^(cobrar|com-fac-|com-cobrar-)/.test(id) ? 'cobros'
      : /^(com-pronostico-|b2b-|lic-)/.test(id) ? 'ventas' : /^(com-seg-|com-cierre-|cot-antiguas|com-empujar-)/.test(id) ? 'equipo'
      : /^(feriado-|vender-|preventa)/.test(id) ? 'cursos' : 'plata';
    const simpleDe = id => { for (const t of temas) for (const h of t.hacer) { if (h.id === id) return h; if (h.grupo && h.grupo.some(x => x.id === id)) return h.grupo.find(x => x.id === id); } return null; };
    const filas = [], usados = new Set();
    const grupo = (ids, texto, por, sub, it0, tema) => { ids.forEach(i => usados.add(i)); filas.push({ ids, texto, por, sub, cuando: it0.cuando, tema, orden: I.agenda.indexOf(it0) }); };
    for (const it of I.agenda) {
      if (usados.has(it.id)) continue;
      if (/^com-seg-/.test(it.id)) {
        const todas = I.agenda.filter(x => /^com-seg-/.test(x.id)), clientes = new Set(todas.map(x => plano((cot(x.cotizacion) || {}).cliente || x.id)));
        grupo(todas.map(x => x.id), 'Llamar a ' + clientes.size + (clientes.size === 1 ? ' cliente que espera respuesta' : ' clientes que esperan respuesta') + ' (' + mm(suma(todas, x => val(cot(x.cotizacion)))) + ')',
          'La que más espera lleva ' + Math.max(0, ...todas.map(x => (cot(x.cotizacion) || {}).diasSinContacto || 0)) + ' días sin contacto',
          todas.map(x => { const q = cot(x.cotizacion); return { id: x.id, cotizacion: x.cotizacion, texto: q ? 'Llamar a ' + nombrePropio(q.cliente) + ' por su cotización de ' + mm(val(q)) : sinJerga(x.titulo), por: x.por }; }), it, 'equipo');
      } else if (/^com-fac-/.test(it.id)) {
        const todas = I.agenda.filter(x => /^com-fac-/.test(x.id));
        grupo(todas.map(x => x.id), 'Facturar ' + todas.length + (todas.length === 1 ? ' venta ganada o anotar su factura' : ' ventas ganadas o anotar sus facturas') + ' (' + mm(suma(todas, x => val(cot(x.cotizacion)))) + ')', 'Sin factura, el cliente no paga',
          todas.map(x => simpleDe(x.id) || { id: x.id, texto: sinJerga(x.titulo), cotizacion: x.cotizacion }), it, 'cobros');
      } else if (/^fin-/.test(it.id) && (alerta(it.id) || {}).nivel === 'critica') {
        const todas = I.agenda.filter(x => /^fin-/.test(x.id) && (alerta(x.id) || {}).nivel === 'critica');
        if (todas.length === 1) grupo([it.id], prevision(it.titulo), sinJerga(it.por), null, it, 'plata');
        else grupo(todas.map(x => x.id), 'Revisar con tu contador ' + todas.length + ' temas urgentes de la plata', yLista(todas.map(x => minus(sinJerga(x.por)))).slice(0, 140),
          todas.map(x => ({ id: x.id, texto: prevision(x.titulo), por: sinJerga(x.por) })), it, 'plata');
      } else {
        const h = simpleDe(it.id);
        const c = curso(it.id);
        const porCorto = it.id === 'caja' ? 'Hoy alcanza para ' + diasTxt(U.runwayDias) + ' de gastos fijos'
          : /^com-pronostico-/.test(it.id) && f1 ? 'Para ' + mesNombre(it.id.slice(15)) + ' lo probable es ' + mm((R.pronostico.meses.find(m => m.mes === it.id.slice(15)) || f1).total) + '; lo mínimo, ' + mm(U.equilibrio)
          : /^feriado-/.test(it.id) && c ? 'Cae en feriado (' + c.feriados[0].nombre + ')'
          : /^vender-/.test(it.id) && c ? 'Empieza ' + cuando(c.dias)
          : /^lic-/.test(it.id) ? 'Concurso del Estado (licitación) que calza con lo que hace Aéreo'
          : (h && h.por) || sinJerga(it.por);
        filas.push({ ids: [it.id], texto: (h && h.texto) || sinJerga(it.titulo), por: porCorto, cuando: it.cuando, tema: temaDe(it.id), cotizacion: it.cotizacion || '', url: it.url || '', orden: I.agenda.indexOf(it) });
        usados.add(it.id);
      }
    }
    // a la vista: primero una tarea por cada pregunta que no está en bien (urgentes primero, y entre
    // iguales la que es para hoy); después el resto en el orden de la agenda, sin las de «este mes»
    // y como mucho dos por pregunta. Más abajo queda la lista completa.
    const SEM = { urgente: 0, ojo: 1, bien: 2 }, ORDEN = ['plata', 'cobros', 'ventas', 'equipo', 'cursos'];
    const fechaCuando = c => sinJerga(c).replace(/(\d{1,2})-(ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)\b/, (m, d, mes) => d + ' de ' + MESES[MES3.indexOf(mes)]);
    const todas = filas.map(f => ({ ...f, cuando: fechaCuando(f.cuando) })).sort((a, b) => a.orden - b.orden);
    const delTema = id => todas.filter(f => f.tema === id);
    const conTareas = temas.filter(x => x.semaforo !== 'bien' && delTema(x.id).length)
      .sort((a, b) => (SEM[a.semaforo] - SEM[b.semaforo]) || ((delTema(a.id)[0].cuando === 'hoy' ? 0 : 1) - (delTema(b.id)[0].cuando === 'hoy' ? 0 : 1)) || (ORDEN.indexOf(a.id) - ORDEN.indexOf(b.id)));
    const principales = conTareas.map(x => delTema(x.id)[0]);
    const cuenta = id => principales.filter(f => f.tema === id).length;
    for (const f of todas) {
      if (principales.includes(f) || f.cuando === 'este mes' || cuenta(f.tema) >= 2) continue;
      principales.push(f);
    }
    const tareas = principales.map(f => ({ ...f, principal: true })).concat(todas.filter(f => !principales.includes(f)));

    // lo que AerIA dice primero
    const t = id => temas.find(x => x.id === id) || { semaforo: 'bien', frase: '', porque: [], numeros: [] };
    const plataMal = t('plata').semaforo !== 'bien';
    const titular = plataMal && Cu.racha.length >= 4 ? 'Vendes bien, pero falta plata en el banco'
      : plataMal ? 'Lo urgente es la plata en el banco'
      : t('cobros').semaforo === 'urgente' ? 'Hay plata atrasada por cobrar'
      : t('ventas').semaforo !== 'bien' ? 'Vas bien, pero hay que vender más a empresas' : 'Aéreo va por buen camino';
    const buenas = [
      Cu.racha.length >= 3 ? 'el Nivel 1 se agotó ' + Cu.racha.length + ' meses seguidos' : null,
      fact != null && fact >= U.equilibrio ? 'en ' + MESES[fecha(I.hoy).getMonth()] + ' ya facturaste ' + mm(fact) + ' a empresas' : null,
      P.flujoOperacional > 0 ? 'en ' + meses + ' la operación dejó ' + mm(P.flujoOperacional) + ' a favor' : null,
      hayCom && R.tasa && R.tasa.muestra >= 10 && R.tasa.cantidad >= 0.5 ? 'ganas ' + Math.round(R.tasa.cantidad * 10) + ' de cada 10 cotizaciones que se deciden' : null,
    ].filter(Boolean).slice(0, 2);
    const preocupa = temas.find(x => x.semaforo === 'urgente') || temas.find(x => x.semaforo === 'ojo') || null;
    const resumen = [
      buenas.length ? 'Hola. Lo bueno: ' + yLista(buenas) + '.' : 'Hola.',
      preocupa ? 'Lo que más me preocupa es ' + preocupa.nombre + '.' + (tareas[0] ? ' Lo primero: ' + minus(tareas[0].texto) + '.' : '') : 'Hoy no veo nada urgente.',
      diasDato > 7 ? 'Ojo: lo último que vi del banco es del ' + fDia(P.fechaCorte) + '.' : null,
      'Abajo te lo cuento en ' + temas.length + ' preguntas. Abre cada una para ver por qué, qué hacer y los números.',
    ].filter(Boolean);
    const conteo = { urgente: temas.filter(x => x.semaforo === 'urgente').length, ojo: temas.filter(x => x.semaforo === 'ojo').length, bien: temas.filter(x => x.semaforo === 'bien').length };
    const pestanas = {
      pasado: { texto: [t('plata').frase].concat(t('plata').porque.slice(0, 2), anioPlata ? [anioPlata] : []), datos: [
        { l: 'Entró por la operación', s: P.etiqueta, v: mm(P.ingresos) },
        { l: 'Se gastó en operar', s: P.etiqueta, v: mm(Math.abs(P.egresos)) },
        { l: 'Quedó a favor', s: 'antes de los socios', v: mm(P.flujoOperacional), cls: P.flujoOperacional >= 0 ? 'bien' : 'mal' },
        { l: 'Salió a los socios', v: mm(socios), cls: socios > 0 ? 'mal' : '' },
        { l: 'En el banco al ' + fCorta(P.fechaCorte), v: clp(P.cajaFinal), cls: plataMal ? 'mal' : '' },
      ].concat(I.contable ? [
        { l: 'Vendido según el contador', s: I.contable.etiqueta + ', sin IVA', v: mm(I.contable.ventas) },
        { l: 'La empresa les debe a los socios', s: 'al ' + fCorta(I.contable.hasta), v: mm(I.contable.socios.prestamosTotal), cls: I.contable.socios.prestamosTotal > 0 ? 'mal' : '' },
      ] : []) },
      presente: { texto: [t('cursos').frase, t('cobros').frase, lic && lic.relevantes.length ? 'Hay ' + lic.relevantes.length + (lic.relevantes.length === 1 ? ' concurso del Estado (licitación) abierto que calza' : ' concursos del Estado (licitaciones) abiertos que calzan') + ' con lo que hace Aéreo.' : null].filter(Boolean), datos: [
        { l: 'Nivel 1 vendido', v: Cu.resN1.vendidos + ' de ' + Cu.resN1.cupos, s: 'cupos de las próximas fechas' },
        { l: 'Niveles 2 y 3 vendido', v: Cu.resN23.vendidos + ' de ' + Cu.resN23.cupos, s: 'cupos de las próximas fechas' },
        { l: 'Te deben', v: mm(deben), s: atrasado ? mm(atrasado) + ' atrasado' : 'nada atrasado', cls: atrasado ? 'mal' : '' },
        { l: 'Concursos que calzan', v: String(lic ? lic.relevantes.length : 0) },
      ] },
      comercial: { texto: [t('ventas').frase].concat(hayCom ? [t('equipo').frase] : []), datos: hayCom ? t('equipo').numeros.slice(0, 4) : [] },
      futuro: { texto: [
        'Si en 2027 le vendes a empresas como en ' + mesNombre(u.mes) + ', el año ' + (ritmo.resultado < 0 ? 'pierde ' + mm(-ritmo.resultado) : 'gana ' + mm(ritmo.resultado)) + '. Para no perder hay que venderles ' + mm(U.equilibrio) + ' al mes.',
        'Los gastos fijos de un año suman ' + mm(Mo.costos_fijos_anio) + '. Los cursos abiertos y las medidas del plan ayudan, pero el resto tiene que venir de ventas a empresas. Cada millón más al mes deja ' + mm(12e6 * Mo.margen_b2b) + ' más en el año.',
        'El ' + fDia(U.hito.fecha) + ' es el día clave (faltan ' + U.diasHito + ' días): si de enero a marzo vendes menos de ' + mm(Mo.b2b_minimo_mes) + ' al mes a empresas, va el plan B.',
      ], datos: [
        { l: '2027 al ritmo de ' + mesNombre(u.mes), v: mm(ritmo.resultado), cls: ritmo.resultado < 0 ? 'mal' : 'bien' },
        { l: 'Para no perder', s: 'al mes, a empresas', v: mm(U.equilibrio) },
        { l: 'La meta', s: 'al mes, a empresas', v: mm(Mo.b2b_meta_mes) },
        { l: 'Días para el ' + fCorta(U.hito.fecha), v: String(U.diasHito) },
      ] },
    };
    pestanas.ebitda = explicarEbitda(D, I);
    return { titular, resumen, preocupa: preocupa ? { id: preocupa.id, nombre: preocupa.nombre } : null, conteo, temas, tareas, pestanas };
  }
  // la pestaña EBITDA en simple: qué es, por qué está así, qué hacer y los números
  function explicarEbitda(D, I) {
    const E = I.ebitda, M = D.modelo;
    if (!E || !E.ultimo) return null;
    const R = E.periodo, u = E.ultimo, mesU = mesNombre(u.mes);
    const cuando = yLista(R.meses.map(mesNombre));
    const solo = R.n === 1;
    const frase = (solo ? 'En ' + cuando + ', el EBITDA fue ' : 'En ' + cuando + ', el EBITDA sumó ') + mm(R.ebitda) + ': ' + (R.ebitda < 0
      ? 'lo que entró por ventas no alcanzó para los gastos de operar y lo que el plan cuenta para los socios. Faltaron ' + mm(-R.ebitda) + '.'
      : R.ebitda < R.meta ? 'lo que entró por ventas cubrió los gastos de operar y lo de los socios, pero quedó bajo la meta del plan para ' + (solo ? 'el mes' : 'esos meses') + ' (' + mm(R.meta) + ').'
      : 'quedó sobre la meta del plan para ' + (solo ? 'el mes' : 'esos meses') + ' (' + mm(R.meta) + ').') +
      // si el último mes solo fue rojo, se dice aunque el período vaya bien
      (!solo && u.estado === 'urgente' && R.estado !== 'urgente' ? ' Ojo: ' + mesU + ' solo dio ' + mm(u.ebitda) + '.' : '');
    const delMes = !solo ? 'Mes a mes: ' + yLista(E.cerrados.slice(-R.n).map(m => mesNombre(m.mes) + ' ' + mm(m.ebitda))) + '. La caja de un mes sola sube y baja con los cobros; por eso el semáforo mira los meses juntos.' : null;
    const top = u.gastosTop.slice(0, 3);
    const porque = [
      'En ' + mesU + ' entraron ' + mm(u.ingresos) + ' por ventas' + (u.ivaVentas ? ' (sin ' + mm(u.ivaVentas) + ' de IVA)' : '') + ': ' + mm(u.empresas) + ' de empresas e instituciones y ' + mm(u.particulares) + ' de alumnos particulares y Mercado Pago.',
      'Operar costó ' + mm(u.gastos) + (top.length ? '. Lo que más pesó: ' + yLista(top.map(g => minus(g.label) + ' (' + mm(g.monto) + ')')) : '') + '.',
      u.rem > 0 ? 'Tu sueldo: ' + mm(u.rem) + ' salieron del banco como remuneración de socios; cuento ' + mm(u.sueldoSocio) + ' (el sueldo del plan es ' + mm(E.sueldo) + ').'
        : u.sueldoSocio ? 'Cuento tu sueldo del plan, ' + mm(u.sueldoSocio) + '. En el banco no sale como sueldo, porque lo que te llevas son transferencias sin clasificar.' : null,
      u.cofundador ? 'Cuento también lo que se le pagó al cofundador (' + mm(u.cofundador) + '): el plan lo tiene en sus costos fijos, aunque para el SII sea retiro de socio.' : null,
      delMes,
    ].filter(Boolean);
    const promE = R.n ? R.empresas / R.n : 0;
    const faltaVenta = Math.max(0, M.b2b_meta_mes - promE);
    const hacer = [
      R.ebitda < R.meta && faltaVenta > 0 ? { texto: 'El plan llega a la meta vendiéndoles ' + mm(M.b2b_meta_mes) + ' al mes a empresas. En ' + cuando + ' cobraste ' + (solo ? '' : 'en promedio ') + mm(promE) + (solo ? '' : ' al mes') + ' de empresas: faltan ' + mm(faltaVenta) + ' al mes.' } : null,
      top.length ? { texto: 'Revisar ' + minus(top[0].label) + ': fue el gasto más grande de ' + mesU + ' (' + mm(top[0].monto) + ').' } : null,
      E.salvedades.length ? { texto: 'Cerrar con tu contador lo que deja el EBITDA en duda: ' + yLista(E.salvedades.map(t => minus(t.replace(/\.$/, '')))) + '.' } : null,
      E.siguiente ? { texto: E.siguienteCerro ? 'Actualizar el informe de finanzas con la cartola de ' + mesNombre(E.siguiente) + ' para ver su EBITDA.'
        : 'Cuando cierre ' + mesNombre(E.siguiente) + ' (el ' + fDia(E.siguienteCierra) + '), actualizar el informe de finanzas con su cartola para ver su EBITDA.' } : null,
    ].filter(Boolean);
    const sinPago = R.comprasSinPago;
    const provisorio = E.salvedades.length || sinPago ? 'Es provisorio.' + (sinPago ? ' Hay compras de la empresa por ' + mm(sinPago) + ' que no pasaron por estas cuentas: si las pagó Aéreo por otro lado, el EBITDA es menor.' : '') +
      (E.salvedades.length ? ' Y el informe de finanzas tiene puntos abiertos que pueden cambiarlo: ' + yLista(E.salvedades.map(t => minus(t.replace(/\.$/, '')))) + '.' : '') : '';
    const pr = E.anio.promedio, rt = E.anio.ritmo;
    // el año: el bloque del pre cierre del contador más los meses cerrados del banco
    const A = E.anual, Cn = I.contable;
    let anio = null;
    if (A && Cn) {
      const Bq = A.bloque, banco = A.banco;
      const bancoEbitda = banco.reduce((t, m) => t + m.ebitda, 0);
      const bancoTxt = yLista(banco.map(m => mesNombre(m.mes)));
      anio = {
        frase: 'En lo que va de ' + A.anio + ' (' + A.etiqueta + '), el EBITDA suma ' + mm(A.ebitda) + ': ' +
          (A.ebitda < 0 ? 'se perdió plata.' : A.ebitda < A.meta ? 'quedó a favor, pero bajo la meta del plan para esos meses (' + mm(A.meta) + ').' : 'quedó sobre la meta del plan para esos meses (' + mm(A.meta) + ').') +
          (banco.length && Bq.ebitda < 0 && bancoEbitda >= 0 ? ' De ' + Cn.etiqueta + ' se perdieron ' + mm(-Bq.ebitda) + '; desde ' + mesNombre(banco[0].mes) + ', el negocio deja plata.' : ''),
        porque: [
          'De ' + Cn.etiqueta + ' uso el pre cierre del contador: ventas por ' + mm(Cn.ventas) + ' (sin IVA) y gastos con documento por ' + mm(Cn.gastos) + '. Con eso, el contador muestra una utilidad de ' + mm(Cn.resultadoOperacional) + '.',
          Cn.sinDoc > 0 ? 'Pero el contador dejó fuera ' + mm(Cn.sinDoc) + ' pagados sin boleta, factura ni rendición: ' + yLista(Cn.espera.map(t => minus(t.nombre) + ' ' + mm(t.monto))) + '. Yo los cuento como gasto, porque la plata ya salió.' : null,
          'También cuento tu sueldo del plan (' + mm(Bq.sueldoSocio) + ' en ' + Bq.n + ' meses)' + (Bq.cofundador ? ' y lo pagado al cofundador (' + mm(Bq.cofundador) + ')' : '') + ', igual que en los meses del banco.',
          banco.length ? 'Ojo: ' + Cn.etiqueta + ' sale de la contabilidad (lo facturado y lo anotado) y ' + bancoTxt + ', del banco (lo cobrado y lo pagado). Se pueden sumar, pero no son exactamente lo mismo.' : null,
          A.hueco.length ? 'Faltan ' + yLista(A.hueco.map(mesNombre)) + ': no están ni en el pre cierre ni en las cartolas.' : null,
        ].filter(Boolean),
        // de la utilidad del contador al EBITDA del bloque
        puente: [
          { l: 'Utilidad que muestra el contador', v: Cn.resultadoOperacional, tot: true },
          { l: 'Pagado sin documento' + (Bq.cofundador ? ' (sin lo del cofundador)' : ''), v: -(Cn.sinDoc - Bq.cofundador) },
          { l: 'Lo pagado al cofundador', v: -Bq.cofundador },
          { l: 'Tu sueldo del plan', v: -Bq.sueldoSocio },
          { l: 'EBITDA de ' + Cn.etiqueta, v: Bq.ebitda, tot: true },
        ].filter(x => x.tot || x.v),
        provisorio: Cn.sinDoc > 0 ? 'Es provisorio: es un pre cierre, y ' + mm(Cn.sinDoc) + ' todavía esperan boleta, factura o rendición. Si alguno de esos pagos fue una compra de equipos, el EBITDA mejora un poco.' : '',
        hacer: Cn.sinDoc > 0 ? 'Juntar las boletas y facturas de los ' + mm(Cn.sinDoc) + ' que el contador dejó sin documento: así el EBITDA de ' + Cn.etiqueta + ' queda firme.' : null,
      };
      if (anio.hacer) hacer.splice(1, 0, { texto: anio.hacer });
    }
    return {
      anio,
      texto: [frase, 'El EBITDA es lo que deja el negocio antes de impuestos, intereses y compras de equipos: lo que entra por ventas menos lo que cuesta operar, incluidos tu sueldo y lo del cofundador.'],
      provisorio,
      que: [
        'Es la plata que genera la operación, antes de impuestos, intereses y compras de equipos.',
        'Aquí se calcula con el banco: lo que entró por ventas (sin IVA), menos los gastos de operar, menos tu sueldo del plan (' + mm(E.sueldo) + ') y lo pagado al cofundador, que el plan también cuenta como costo.',
        'Verde: ' + mm(E.metaMes) + ' o más al mes. Es el resultado que el plan 2027 espera con la venta meta a empresas (' + mm(E.metaAnio) + ' en el año), dividido en 12. Amarillo: entre $0 y eso. Rojo: bajo $0, se perdió plata.',
        E.temporada ? 'El plan avisa que no todos los meses son iguales: «' + E.temporada.replace(/\.$/, '') + '». Por eso el semáforo grande mira hasta 3 meses juntos.' : null,
        'Margen: el EBITDA dividido por lo que entró por ventas. Un margen de 20% quiere decir que de cada $100 cobrados quedaron $20.',
      ].filter(Boolean),
      porque, hacer,
      anioFrase: pr ? 'Con el modelo del plan, si 2027 se vende como ' + cuando + ' (' + mm(pr.b2b) + ' al mes a empresas), el EBITDA del año sería ' + mm(pr.resultado) + '.' + (rt && R.n > 1 ? ' Si se vende solo como ' + mesU + ' (' + mm(rt.b2b) + ' al mes), sería ' + mm(rt.resultado) + '.' : '') + ' Con la meta del plan, ' + mm(E.metaAnio) + '.' : '',
      siguienteFrase: E.siguiente ? (E.siguienteCerro ? 'Aún no tengo la cartola de ' + mesNombre(E.siguiente) + '.' : mayus(mesNombre(E.siguiente)) + ' todavía no termina.') +
        (I.despues && I.despues.ventasRegistro ? ' Lo que ya se ve: tu registro anota ' + mm(I.despues.ventasRegistro - (I.despues.iva || 0)) + ' facturados sin IVA al ' + fDia(I.despues.hasta) + (I.despues.cobradoRegistro ? ', de los que van cobrados ' + mm(I.despues.cobradoRegistro) : '') + '.' : '') : '',
    };
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
    const contable = leerContable(D);
    const X = { pasado, cursos, lic, cot, porCobrar, cruce, futuro, tablero, comercial, despues, contable };
    X.ebitda = leerEbitda(D, X, hoy);
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
    if (I.contable) {
      const C = I.contable, B = C.balance;
      L.push('\n## CONTABILIDAD · ' + C.fuente + ' (acumulado ' + C.desde + ' a ' + C.hasta + ')');
      L.push('- Ventas ' + clp(C.ventas) + ' (sin IVA); gastos con documento ' + clp(C.gastos) + ' (' + C.gastosTop.slice(0, 6).map(g => g.nombre + ' ' + clp(g.monto)).join(', ') + '); utilidad que muestra el contador ' + clp(C.resultado) + '.');
      if (C.espera.length) L.push('- Pagado sin documento (el contador lo deja como anticipo): ' + C.espera.map(t => t.nombre + ' ' + clp(t.monto) + ' en ' + t.n + ' pagos').join('; ') + '. Mayores: ' + C.contrapartes.slice(0, 6).map(r => r.nombre + ' ' + clp(r.monto)).join(', ') + '.');
      L.push('- Socios: préstamos ' + (C.socios.prestamos.map(x => x.nombre + ' ' + clp(x.monto)).join(', ') || 'ninguno') + '; dividendos provisorios ' + clp(C.socios.dividendos) + '.');
      L.push('- Balance al ' + C.hasta + ': activos ' + clp(B.activos) + ' (bancos ' + clp(B.bancos) + ', caja ' + clp(B.caja) + ', clientes por cobrar ' + clp(B.clientes) + ', equipos ' + clp(B.equipos) + ', pagado sin documento ' + clp(C.sinDoc) + '); pasivos ' + clp(B.pasivos) + ' (préstamos de socios ' + clp(C.socios.prestamosTotal) + ', proveedores por pagar ' + clp(B.proveedores) + ', anticipos de clientes ' + clp(B.anticiposClientes) + '); patrimonio ' + clp(B.patrimonio) + '.');
      L.push('- EBITDA ' + C.etiqueta + ' según AerIA (ventas − gastos − pagado sin documento − sueldo del socio del plan ' + clp(C.ebitda.sueldoSocio) + '; lo del cofundador va aparte, ' + clp(C.ebitda.cofundador) + '): ' + clp(C.ebitda.ebitda) + '.');
    }
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
    if (I.ebitda && I.ebitda.ultimo) {
      const E = I.ebitda;
      L.push('\n## EBITDA (base caja: ventas cobradas sin IVA − gastos de operar, con cotizaciones del personal y sin pagos de impuestos al SII ni compras de equipos − sueldo base del socio del plan ' + clp(E.sueldo) + '/mes − lo pagado al cofundador, que el plan cuenta en sus costos fijos)');
      for (const m of E.meses) L.push('- ' + m.mes + (m.parcial ? ' (en curso, al ' + m.hasta + ')' : '') + ': ventas ' + clp(m.ingresos) + ', gastos ' + clp(m.gastos) + ', sueldo socio ' + clp(m.sueldoSocio) + ', cofundador ' + clp(m.cofundador) + ' → EBITDA ' + clp(m.ebitda) + (m.margen != null ? ' (' + pct(m.margen) + ')' : '') + ' [' + m.estado + '].');
      if (E.anual) {
        const A = E.anual;
        L.push('- Año ' + A.anio + ' (' + A.desde + ' a ' + A.hasta + '): ' + A.partes.map(x => (x.contable ? x.etiqueta + ' según el pre cierre (contable, cuenta como gasto lo pagado sin documento)' : x.mes) + ' ' + clp(x.ebitda)).join(' + ') + ' = EBITDA ' + clp(A.ebitda) + ' contra una meta de ' + clp(A.meta) + ' [' + A.estado + ']' + (A.hueco.length ? '; faltan ' + A.hueco.join(', ') : '') + '.');
      }
      L.push('- Semáforo de los últimos ' + E.periodo.n + ' meses cerrados: EBITDA ' + clp(E.periodo.ebitda) + ' contra una meta de ' + clp(E.periodo.meta) + ' [' + E.periodo.estado + ']. Rojo < $0; amarillo hasta la meta; verde ≥ meta (' + clp(E.metaMes) + '/mes = meta anual del plan ' + clp(E.metaAnio) + ' / 12).' + (E.salvedades.length ? ' Provisorio por: ' + E.salvedades.join('; ') + '.' : ''));
    }
    L.push('\n## ALERTAS ACTIVAS (de AerIA)');
    for (const a of I.alertas) L.push('- [' + a.nivel + '|' + a.foco + '] ' + a.titulo + ' → ' + a.accion);
    if (D.notas && D.notas.length) {
      L.push('\n## MEMORIA: decisiones y contexto que te dio el usuario');
      for (const n of D.notas) L.push('- (' + (n.fecha || '').slice(0, 10) + ') ' + n.texto);
    }
    return L.join('\n');
  }

  const API = {
    analizar, explicar, resultado2027, buscarMovimientos, resumenParaIA, cuentas, dashboardConectado, leerContable,
    fmt: { clp, mm, pct, fCorta, fLarga, fDia, mesNombre, cuando, horasA, plano, diasEntre, sumarDias, iso, nombrePropio, sinJerga },
    FERIADOS, MESES,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else raiz.AeriaMotor = API;
})(typeof window !== 'undefined' ? window : this);
