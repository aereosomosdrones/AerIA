/* =============================================================================
   AerIA · INTERFAZ
   Dibuja las cinco vistas (Mando, Pasado, Presente, Futuro, Hablar), guarda el
   estado compartido (alertas resueltas, agenda, memoria, cotizaciones) en la
   base del artifact y conversa con Claude usando herramientas que leen los
   datos de Aéreo. El análisis vive en motor.js.
   ============================================================================= */
(function () {
  'use strict';
  const M = window.AeriaMotor, F = M.fmt;
  const D0 = JSON.parse(document.getElementById('aeria-datos').textContent);
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const NIVEL_TXT = { critica: 'Crítica', alta: 'Alta', oportunidad: 'Oportunidad', media: 'Media', baja: 'Baja' };
  const FOCO_TXT = { pasado: 'Pasado', presente: 'Presente', futuro: 'Futuro', cruce: 'Cruce', comercial: 'Comercial' };
  const C = window.AeriaComercial;
  const VISTAS = ['mando', 'pasado', 'presente', 'comercial', 'futuro', 'hablar'];
  const MES3 = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const DIA3 = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

  const S = {
    tab: 'mando', filtroAlertas: 'principales', filtroLic: 'calzan', abiertas: new Set(),
    sim: null, alertas: {}, agenda: {}, notas: [],
    chat: [], ctl: null, profundo: false, enCurso: false,
    sample: null, tools: 0, ia: 'cargando', db: null, pasos: new Set(),
    comDocs: new Map(), comCargado: false, comUI: null,
  };
  let I = null;

  /* ---------- almacenamiento ---------- */
  const LS = {
    get(k, d) { try { const v = localStorage.getItem('aeria:' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('aeria:' + k, JSON.stringify(v)); } catch (e) { /* sin almacenamiento */ } },
  };
  const DOCS = { alertas: 'estado/alertas', agenda: 'estado/agenda', notas: 'memoria/notas' };
  const aCuerpo = (k, v) => k === 'notas' ? { items: v } : { mapa: v };
  const deCuerpo = (k, d) => {
    if (!d) return k === 'notas' ? [] : {};
    if (k === 'notas') return Array.isArray(d.items) ? d.items : [];
    return d.mapa || {};
  };
  async function guardar(k) {
    if (S.db) {
      try { await S.db.doc(DOCS[k]).set(aCuerpo(k, S[k])); return true; } catch (e) { console.warn('AerIA: no se pudo guardar', k, e); }
    }
    LS.set(k, S[k]);
    return false;
  }
  for (const k of Object.keys(DOCS)) S[k] = LS.get(k, S[k]);
  S.chat = LS.get('chat', []);
  S.pasos = new Set(LS.get('pasos', []));

  /* ---------- cotizaciones: una por documento en cotizaciones/<id> ----------
     Con base de datos: lo que hay en la base (antes de que responda, el paquete).
     Sin base (fuera de claude.ai): lo guardado en este navegador o el paquete. */
  const paqueteCot = () => ((D0.comercial || {}).cotizaciones || []);
  function cotizacionesActuales() {
    if (S.db && S.comCargado) return Array.from(S.comDocs.values());
    if (!S.db) { const loc = LS.get('cotizaciones', null); if (loc) return Object.values(loc); }
    return paqueteCot();
  }
  const espera = ms => new Promise(r => setTimeout(r, ms));
  async function guardarCot(q, signal) {
    if (S.db) {
      for (let i = 0; i < 5; i++) {
        if (signal && signal.aborted) return false;
        try { await S.db.doc('cotizaciones/' + q.id).set(q); S.comDocs.set(q.id, q); return true; }
        catch (e) {
          if (!e || !['resource_exhausted', 'unavailable'].includes(e.code)) { console.warn('AerIA: no se pudo guardar la cotización', e); return false; }
          await espera(500 * Math.pow(2, i));
        }
      }
      return false;
    }
    const loc = LS.get('cotizaciones', null) || Object.fromEntries(paqueteCot().map(x => [x.id, x]));
    loc[q.id] = q; LS.set('cotizaciones', loc);
    return true;
  }
  async function borrarCot(id) {
    if (S.db) {
      try { await S.db.doc('cotizaciones/' + id).delete(); S.comDocs.delete(id); return true; } catch (e) { console.warn('AerIA: no se pudo borrar', e); return false; }
    }
    const loc = LS.get('cotizaciones', null) || Object.fromEntries(paqueteCot().map(x => [x.id, x]));
    delete loc[id]; LS.set('cotizaciones', loc);
    return true;
  }
  function avisar(msg) {
    const t = $('#toast'); if (!t) return;
    t.textContent = msg; t.hidden = false;
    clearTimeout(avisar.t); avisar.t = setTimeout(() => { t.hidden = true; }, 6000);
  }

  /* ---------- cálculo ---------- */
  const hoy = () => F.iso(new Date());
  const datos = () => Object.assign({}, D0, { notas: S.notas, comercial: Object.assign({}, D0.comercial, { cotizaciones: cotizacionesActuales() }) });
  function recalcular() { I = M.analizar(datos(), hoy(), new Date()); }
  const resuelta = a => S.alertas[a.id] && S.alertas[a.id].estado === 'resuelta';
  const fuerte = t => esc(t).replace(/(−?\$[\d.,]+M?)/g, '<b>$1</b>');
  const fechaCaja = s => { const d = F.fCorta(s).split('-'); return '<b>' + d[0] + '</b><small>' + d[1] + '</small>'; };
  const dSem = s => { const p = s.split('-').map(Number); return DIA3[new Date(p[0], p[1] - 1, p[2]).getDay()]; };

  /* ---------- tooltip ---------- */
  const tip = $('#tip');
  function verTip(ev, html) {
    tip.innerHTML = html; tip.hidden = false;
    const r = tip.getBoundingClientRect();
    let x = ev.clientX + 14, y = ev.clientY + 14;
    if (x + r.width > innerWidth - 8) x = ev.clientX - r.width - 14;
    if (y + r.height > innerHeight - 8) y = ev.clientY - r.height - 14;
    tip.style.left = Math.max(8, x) + 'px'; tip.style.top = Math.max(8, y) + 'px';
  }
  const ocultarTip = () => { tip.hidden = true; };

  /* ---------- en simple: piezas que se abren paso a paso ---------- */
  const SEMAFORO_TXT = { urgente: 'Urgente', ojo: 'Ojo', bien: 'Bien', info: 'Para saber' };
  // las palabras que no se pueden evitar se explican al pasar el cursor (o con el foco del teclado)
  const GLOSARIO = {
    'ventas a empresas': 'Cursos cerrados, SENCE, asesoría AOC y servicios con drones que compran empresas e instituciones. No incluye los cupos sueltos de los cursos abiertos.',
    'punto de equilibrio': 'Lo que hay que vender cada mes para no perder plata: ni ganar ni perder.',
    'costos fijos': 'Lo que Aéreo gasta cada mes aunque no venda nada: sueldos, arriendos, sistemas.',
    'factoring': 'Venderle una factura a una financiera para recibir la plata antes, a cambio de una comisión.',
    'cotización abierta': 'Una propuesta enviada que el cliente todavía no acepta ni rechaza.',
    'lo probable': 'Lo cotizado multiplicado por la probabilidad de cerrar cada cotización: una estimación realista, no lo máximo.',
    'por cobrar': 'Facturas emitidas que el cliente todavía no paga.',
    'vencida': 'Una factura cuyo plazo de pago (30 días) ya pasó.',
    'licitación': 'Un concurso público del Estado (Mercado Público) en que Aéreo puede postular.',
    'palanca': 'Una medida del plan 2027 que suma plata: subir precios, vender almuerzos, abrir revalidación.',
    'caja': 'La plata disponible en las cuentas del banco de Aéreo.',
    'SII': 'Servicio de Impuestos Internos: ahí quedan todas las facturas que Aéreo emite.',
    'cartola': 'El detalle de movimientos que entrega el banco.',
    'ciclo de venta': 'Los días que pasan, en promedio, desde que cotizas hasta que el cliente acepta.',
  };
  const RX_GLOSA = new RegExp('\\b(' + Object.keys(GLOSARIO).map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\b', 'i');
  // marca en un texto ya escapado la primera palabra del glosario que aparezca
  const glosar = html => html.replace(RX_GLOSA, m => '<dfn class="glosa" tabindex="0" data-glosa="' + esc(Object.keys(GLOSARIO).find(k => k.toLowerCase() === m.toLowerCase()) || m) + '">' + m + '</dfn>');
  const simple = t => glosar(fuerte(t));
  // un tema: la pregunta y la frase siempre a la vista; el porqué, qué hacer y los números se abren en orden
  const hecho = id => !!(S.agenda[id] && S.agenda[id].hecho);
  const fechaHecho = ids => { const f = ids.map(id => S.agenda[id] && S.agenda[id].fecha).filter(Boolean).sort().pop(); return f ? F.fCorta(String(f).slice(0, 10)) : ''; };
  // una acción de «¿Qué hago?»: con casilla si está en la agenda (una fila agrupada marca todos sus ids)
  function accionHtml(x, pre) {
    const ids = x.ids || (x.id ? [x.id] : []);
    const abrir = x.cotizacion ? ` · <button class="enlace-btn" type="button" data-com="abrir" data-id="${esc(x.cotizacion)}">abrir</button>` : '';
    const ficha = x.url ? ` · <a href="${esc(x.url)}" target="_blank" rel="noopener">ficha ↗</a>` : '';
    if (x.alerta) {
      const r = resuelta({ id: x.alerta });
      return `<li class="${r ? 'hecho' : ''}"><span><span>${simple(x.texto)}</span>${x.por ? '<span class="c-sub">' + esc(x.por) + '</span>' : ''}</span><button class="enlace-btn" type="button" data-accion="resolver" data-id="${esc(x.alerta)}">${r ? 'Volver a mostrar' : 'Ya lo vi'}</button></li>`;
    }
    if (!ids.length) return `<li><span><span>${simple(x.texto)}${abrir}${ficha}</span>${x.por ? '<span class="c-sub">' + esc(x.por) + '</span>' : ''}</span></li>`;
    const h = ids.every(hecho), id = (pre || 'tq-') + ids[0].replace(/[^a-z0-9-]/gi, '');
    const sub = (x.grupo || []).length ? `<ul class="hacer-sub">${x.grupo.map(g => accionHtml(g, pre + 'g')).join('')}</ul>` : '';
    return `<li class="con-casilla${h ? ' hecho' : ''}"><input type="checkbox" id="${id}" data-accion="agenda" data-id="${esc(ids.join(','))}"${h ? ' checked' : ''}>
      <span><span><label for="${id}">${simple(x.texto)}</label>${abrir}${ficha}</span>${x.por ? '<span class="c-sub">' + esc(x.por) + '</span>' : ''}${h ? '<span class="c-sub">Hecho el ' + esc(fechaHecho(ids)) + '</span>' : ''}${sub}</span></li>`;
  }
  const irBoton = (d, sec) => d && d.tab ? `<button class="btn sm ${sec ? 'sec ' : ''}ir-detalle" type="button" data-accion="ir-detalle" data-tab-ir="${esc(d.tab)}" data-capa="${esc(d.capa || '')}" data-ancla="${esc(d.ancla || '')}" data-filtro="${esc(d.filtro || '')}">${esc(d.texto || 'Ver el detalle')} →</button>` : '';
  function temaHtml(h) {
    const abierto = n => S.pasos.has(h.id + '-' + n) ? ' open' : '';
    const paso = (n, titulo, cuerpo) => cuerpo ? `<details class="paso-d" data-paso="${esc(h.id + '-' + n)}"${abierto(n)}><summary><span class="n-paso">${n}</span><span>${titulo}</span></summary><div class="paso-cuerpo">${cuerpo}</div></details>` : '';
    const porque = (h.porque || []).concat(h.porqueUI || []).map(p => '<p>' + simple(p) + '</p>').join('');
    const hacer = (h.hacer || []).length ? '<ul class="hacer-lista">' + h.hacer.map(x => accionHtml(x, 'tq-' + h.id + '-')).join('') + '</ul>' : '<p class="c-sub">Por ahora no hay nada que hacer aquí.</p>';
    const nums = (h.numeros || []).length ? '<dl class="numeros">' + h.numeros.map(x => `<dt>${glosar(esc(x.l))}${x.s ? '<small>' + esc(x.s) + '</small>' : ''}</dt><dd class="${x.cls || ''}">${esc(x.v)}</dd>`).join('') + '</dl>' : '';
    const fuente = h.fuente ? `<p class="c-sub">De dónde sale: ${esc(h.fuente)}</p>` : '';
    const ir = `<div class="chips">${irBoton(h.detalle)}${irBoton(h.detalle2, true)}</div>`;
    return `<article class="panel tema" id="tema-${esc(h.id)}" data-semaforo="${esc(h.semaforo)}">
      <div class="tema-cab"><div class="tema-pregunta"><span class="semaforo ${esc(h.semaforo)}">${SEMAFORO_TXT[h.semaforo] || ''}</span><h3>${esc(h.pregunta)}</h3></div>
        <p class="tema-frase">${simple(h.frase)}</p></div>
      <div class="pasos-tema">
        ${paso(1, '¿Por qué?', porque)}
        ${paso(2, '¿Qué hago?', hacer)}
        ${paso(3, 'Ver los números', nums + fuente + ir)}
      </div></article>`;
  }
  // el resumen «En simple» que abre cada pestaña
  function enSimpleHtml(o) {
    const datos = (o.datos || []).length ? '<dl class="datos-simples">' + o.datos.map(d => `<div><dt>${glosar(esc(d.l))}</dt><dd class="${d.cls || ''}">${esc(d.v)}${d.s ? '<small>' + esc(d.s) + '</small>' : ''}</dd></div>`).join('') + '</dl>' : '';
    return `<section class="panel en-simple" aria-label="En simple">
      <div class="ceja"><span class="iso chico tinta" aria-hidden="true"></span>En simple</div>
      <div class="voz">${(o.texto || []).map(p => '<p>' + simple(p) + '</p>').join('')}</div>${datos}${o.extra || ''}</section>`;
  }
  // el detalle completo, cerrado hasta que se pide
  function capa(id, titulo, bajada, cuerpo) {
    return `<details class="capa" data-paso="capa-${esc(id)}"${S.pasos.has('capa-' + id) ? ' open' : ''}><summary><h2>${esc(titulo)}</h2>${bajada ? '<span class="bajada">' + esc(bajada) + '</span>' : ''}</summary><div class="capa-cuerpo">${cuerpo}</div></details>`;
  }

  /* ========================================================================
     BANDA, PESTAÑAS Y PIE
     ======================================================================== */
  function renderBanda() {
    const crit = I.alertas.filter(a => a.nivel === 'critica' && !resuelta(a)).length;
    $('#banda-estado').innerHTML =
      '<span><span class="led' + (crit ? ' rojo' : '') + '"></span><b>' + crit + '</b> ' + (crit === 1 ? 'aviso urgente' : 'avisos urgentes') + '</span>' +
      '<span>Banco al <b>' + F.fCorta(I.pasado.fechaCorte) + '</b></span>' +
      '<span>Cursos al <b>' + F.fCorta((D0.cursos.extraido || '').slice(0, 10)) + '</b></span>' +
      '<span>Hoy <b>' + F.fLarga(I.hoy) + '</b></span>';
    const c = $('#cuenta-criticas');
    c.hidden = !crit; c.textContent = crit;
    const hoyCom = I.comercial ? I.comercial.acciones.filter(a => a.cuando === 'hoy').length : 0;
    const cc = $('#cuenta-comercial');
    if (cc) { cc.hidden = !hoyCom; cc.textContent = hoyCom; }
  }
  function irA(tab, foco) {
    S.tab = tab;
    for (const b of $$('.pestana')) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
    for (const v of $$('.vista')) v.hidden = v.id !== 'v-' + tab;
    try { history.replaceState(null, '', '#' + tab); } catch (e) { /* frame */ }
    pintar();
    if (foco !== false) window.scrollTo(0, 0);
  }
  function renderPie() {
    $('#pie').innerHTML =
      '<p><b>Fuentes.</b> Pasado: ' + esc(D0.finanzas.fuente) + ', generado el ' + esc(D0.finanzas.generado_fuente.slice(0, 10)) +
      '. Presente: ' + esc(D0.cursos.fuente) + ' (commit ' + esc(D0.cursos.commit || '?') + '); ' + esc(D0.licitaciones.fuente) +
      ', ' + esc((D0.licitaciones.generado_fuente || '').slice(0, 16).replace('T', ' ')) + ' UTC; ' + esc(D0.cotizaciones.fuente) + '; Comercial: ' + (I.comercial ? I.comercial.total : 0) + ' cotizaciones en la base de AerIA' +
      '. Futuro: ' + esc(D0.plan.fuente) + '; ' + esc(D0.modelo.fuente) + '.</p>' +
      '<p><b>Método.</b> AerIA no inventa cifras: todo número sale de esas fuentes o de cálculos sobre ellas, y cada alerta dice de dónde viene. ' +
      'Montos en pesos chilenos. Paquete armado el ' + esc((D0.construido || '').slice(0, 16).replace('T', ' ')) + '.</p>';
  }

  /* ========================================================================
     MANDO
     ======================================================================== */
  const SUGERENCIAS = [
    '¿Qué hago hoy y por qué?',
    'Explícame en simple cómo está la plata',
    '¿Llegamos bien a 2027? Dímelo con peras y manzanas',
    '¿Dónde se fue la plata del último período?',
    '¿Llegamos a la meta 2027 al ritmo actual? ¿Qué palanca mueve más?',
    '¿Qué licitaciones vale la pena postular esta semana?',
    'Arma un plan de preventa para noviembre y diciembre',
    '¿Qué riesgos tributarios ves y qué le pregunto al contador?',
    '¿Qué cotizaciones debo empujar esta semana y por qué?',
    '¿Cuánto hemos ganado y en qué líneas nos va mejor?',
  ];

  function titular(t) {
    const i = t.lastIndexOf(' y ');
    return i > 0 ? esc(t.slice(0, i + 3)) + '<mark>' + esc(t.slice(i + 3)) + '</mark>' : esc(t);
  }

  function renderMando() {
    const v = $('#v-mando');
    const Sm = I.simple;
    const d = new Date(); const dd = d.getDate() + '·' + (d.getMonth() + 1);
    // lo que el equipo marcó como hecho en la última semana (sale del estado compartido de la agenda)
    const hace7 = F.sumarDias(I.hoy, -7);
    const hechas7 = Object.values(S.agenda).filter(x => x && x.hecho && String(x.fecha || '').slice(0, 10) >= hace7).length;
    const temas = Sm.temas.map(t => t.id === 'equipo' ? Object.assign({}, t, { porqueUI: [hechas7 ? 'En AerIA se marcaron ' + hechas7 + (hechas7 === 1 ? ' tarea' : ' tareas') + ' como hechas en los últimos 7 días.' : 'En los últimos 7 días no se marcó ninguna tarea como hecha en AerIA.'] }) : t);
    const voz = Sm.resumen.map(p => {
      let h = simple(p);
      if (Sm.preocupa) h = h.replace(esc(Sm.preocupa.nombre), `<button class="enlace-btn enlace-voz" type="button" data-accion="ver-tema" data-id="${esc(Sm.preocupa.id)}">${esc(Sm.preocupa.nombre)}</button>`);
      return '<p>' + h + '</p>';
    }).join('');
    const conteo = [['urgente', 'urgente', 'urgentes'], ['ojo', 'para mirar', 'para mirar'], ['bien', 'bien', 'bien']]
      .map(([k, uno, varios]) => `<button class="chip" type="button" data-accion="ver-semaforo" data-id="${k}"${Sm.conteo[k] ? '' : ' disabled'}><span class="semaforo ${k}">${Sm.conteo[k]}</span> ${Sm.conteo[k] === 1 ? uno : varios}</button>`).join('');
    const n = I.alertas.filter(a => !resuelta(a)).length;
    v.innerHTML = `
      <div class="grilla g-7-5 arriba">
        <article class="panel hoy-cab">
          <span class="fondo-num" aria-hidden="true">${dd}</span>
          <div class="ceja"><span class="iso chico tinta" aria-hidden="true"></span>AerIA · ${esc(F.fLarga(I.hoy))}</div>
          <h2 class="titular">${titular(Sm.titular)}</h2>
          <div class="voz">${voz}</div>
          <div class="chips conteo" role="group" aria-label="Preguntas por color">${conteo}</div>
          <form class="pregunta" id="f-pregunta">
            <label class="sr" for="in-pregunta">Pregúntale a AerIA</label>
            <input id="in-pregunta" autocomplete="off" placeholder="Pregúntale lo que quieras sobre Aéreo…">
            <button class="btn" type="submit">Preguntar</button>
          </form>
          <div class="chips">${SUGERENCIAS.slice(0, 3).map(q => `<button class="chip" type="button" data-accion="preguntar" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div>
        </article>
        <section class="panel tareas-hoy" aria-labelledby="h-tareas">
          <div class="panel-c"><h2 id="h-tareas">Lo que tienes que hacer</h2><span class="bajada">Lo más importante primero. Marca lo que ya hiciste: se guarda para todo el equipo.</span></div>
          <div class="agenda" id="tareas-hoy">${tareasHtml()}</div>
        </section>
      </div>
      <div class="panel-c" style="padding:4px 0 0"><h2>Lo importante, en ${temas.length} preguntas</h2><span class="bajada">Cada respuesta se abre paso a paso: primero el porqué, después qué hacer y al final los números.</span></div>
      <div class="temas">${temas.map(temaHtml).join('')}</div>
      ${capa('alertas', 'Todo lo que AerIA revisó', n + ' avisos, del más importante al menos. Cada uno dice de dónde sale y qué hacer.', `
        <section class="panel" aria-label="Avisos">
          <div class="panel-b" style="padding-top:14px;padding-bottom:10px">${chipsAlertas()}</div>
          <div class="alertas" id="lista-alertas">${listaAlertas()}</div>
        </section>`)}
      ${capa('agenda', 'La lista completa de tareas', I.agenda.length + ' tareas, ordenadas por urgencia.', `<section class="panel"><div class="agenda" id="agenda">${agendaHtml()}</div></section>`)}
      ${capa('viene', 'Lo que viene', 'Los próximos 90 días: cursos, cobros, concursos del Estado, impuestos e hitos del plan.', `<section class="panel"><div class="panel-b ras"><div class="viene" id="viene">${vieneHtml()}</div></div></section>`)}`;
  }
  // «Lo que tienes que hacer»: las filas que el motor eligió (una por pregunta que preocupa, después el resto)
  const TEMA_TXT = { plata: 'Plata', cobros: 'Cobros', ventas: 'Ventas', equipo: 'Equipo', cursos: 'Cursos' };
  function tareasHtml() {
    const filas = I.simple.tareas.filter(f => f.principal && (!f.ids.every(hecho) || f.ids.some(id => String((S.agenda[id] || {}).fecha || '').slice(0, 10) === I.hoy)));
    const ver = filas.slice(0, 6);
    const resto = I.simple.tareas.filter(f => !f.ids.every(hecho)).length - ver.filter(f => !f.ids.every(hecho)).length;
    if (!ver.length) return '<p class="panel-b mudo">No hay tareas pendientes. Buen trabajo.</p>';
    return ver.map(f => {
      const h = f.ids.every(hecho), id = 'th-' + f.ids[0].replace(/[^a-z0-9-]/gi, '');
      const meta = `<span class="por"><span class="pill foco">${esc(TEMA_TXT[f.tema] || '')}</span> ${f.cuando === 'hoy' ? '' : esc(mayus1(f.cuando)) + ' · '}${esc(f.por || '')}${f.cotizacion ? ` · <button class="enlace-btn" type="button" data-com="abrir" data-id="${esc(f.cotizacion)}">ver cotización</button>` : ''}${f.url ? ` · <a href="${esc(f.url)}" target="_blank" rel="noopener">ficha ↗</a>` : ''} · <button class="enlace-btn" type="button" data-accion="ver-tema" data-id="${esc(f.tema)}" data-paso-n="1">¿Por qué?</button></span>`;
      if (f.sub && f.sub.length > 1) {
        const pend = f.ids.filter(x => !hecho(x)).length;
        return `<div class="ag-item grupo${f.cuando === 'hoy' ? ' hoy' : ''}${h ? ' hecho' : ''}"><span class="ag-n" aria-hidden="true">${pend || '✓'}</span>
          <details data-paso="tareas-${esc(f.ids[0])}"${S.pasos.has('tareas-' + f.ids[0]) ? ' open' : ''}><summary>${esc(f.texto)}${meta}</summary>
            <ul class="hacer-lista hacer-sub">${f.sub.map(x => accionHtml(x, 'tg-')).join('')}</ul></details></div>`;
      }
      return `<div class="ag-item${h ? ' hecho' : ''}${f.cuando === 'hoy' ? ' hoy' : ''}">
        <input type="checkbox" id="${id}" data-accion="agenda" data-id="${esc(f.ids.join(','))}"${h ? ' checked' : ''}>
        <label for="${id}">${esc(f.texto)}</label>${meta}</div>`;
    }).join('') + (resto > 0 ? `<div class="pie-lista"><span class="mudo">Y ${resto} más en «La lista completa de tareas», abajo.</span></div>` : '');
  }
  const mayus1 = t => String(t || '').replace(/^./, c => c.toUpperCase());

  function resumenAlertas() {
    const act = I.alertas.filter(a => !resuelta(a));
    const c = n => act.filter(a => a.nivel === n).length;
    return act.length + ' activas: ' + c('critica') + ' críticas, ' + c('alta') + ' altas, ' + c('oportunidad') + ' oportunidades. Cada una dice de dónde viene y qué hacer.';
  }
  function chipsAlertas() {
    const act = I.alertas.filter(a => !resuelta(a));
    const ops = [['principales', 'Principales', null], ['critica', 'Críticas', act.filter(a => a.nivel === 'critica').length],
      ['alta', 'Altas', act.filter(a => a.nivel === 'alta').length], ['oportunidad', 'Oportunidades', act.filter(a => a.nivel === 'oportunidad').length],
      ['media', 'Medias', act.filter(a => a.nivel === 'media').length], ['baja', 'Bajas', act.filter(a => a.nivel === 'baja').length],
      ['resueltas', 'Resueltas', I.alertas.filter(resuelta).length]];
    return '<div class="chips" role="group" aria-label="Filtrar alertas">' + ops.map(([k, t, n]) =>
      `<button class="chip" type="button" data-accion="filtro-alertas" data-valor="${k}" aria-pressed="${S.filtroAlertas === k}">${t}${n != null ? '<span class="n">' + n + '</span>' : ''}</button>`).join('') + '</div>';
  }
  function alertasFiltradas() {
    const f = S.filtroAlertas;
    if (f === 'resueltas') return I.alertas.filter(resuelta);
    const act = I.alertas.filter(a => !resuelta(a));
    if (f === 'principales') return act.filter(a => a.nivel !== 'baja').slice(0, 9);
    return act.filter(a => a.nivel === f);
  }
  function plazo(a) {
    if (!a.fecha_limite) return '';
    const dias = F.diasEntre(I.hoy, a.fecha_limite);
    return '<span class="pill' + (dias <= 3 ? ' critica' : '') + '">' + (dias < 0 ? 'vencida' : F.cuando(dias)) + '</span>';
  }
  function alertaHtml(a) {
    const r = resuelta(a);
    return `<div class="alerta ${a.nivel}${r ? ' resuelta' : ''}"><span class="barra" aria-hidden="true"></span>
      <details data-id="${esc(a.id)}"${S.abiertas.has(a.id) ? ' open' : ''}>
        <summary><span class="a-tit">${esc(a.titulo)}</span><span class="a-monto">${a.monto ? F.mm(a.monto) : ''}</span>
          <span class="a-meta"><span class="pill ${a.nivel}">${NIVEL_TXT[a.nivel]}</span><span class="pill foco">${FOCO_TXT[a.foco]}</span>${plazo(a)}</span></summary>
        <div class="a-cuerpo">
          <p>${fuerte(a.detalle)}</p>
          <p class="hacer"><b>Qué hacer:</b> ${esc(a.accion)}</p>
          <p class="mudo">Fuente: ${esc(a.fuente)}</p>
          <div class="a-acciones">
            <button class="btn sm sec" type="button" data-accion="resolver" data-id="${esc(a.id)}">${r ? 'Reabrir' : 'Marcar resuelta'}</button>
            <button class="btn sm" type="button" data-accion="preguntar-alerta" data-id="${esc(a.id)}">Preguntar a AerIA</button>
            ${a.url ? `<a href="${esc(a.url)}" target="_blank" rel="noopener">Ver ficha en Mercado Público ↗</a>` : ''}
          </div>
        </div>
      </details></div>`;
  }
  function listaAlertas() {
    const l = alertasFiltradas();
    const resto = I.alertas.filter(a => !resuelta(a)).length - l.length;
    return (l.length ? l.map(alertaHtml).join('') : '<p class="panel-b mudo">No hay alertas en este filtro.</p>') +
      (S.filtroAlertas === 'principales' && resto > 0 ? `<div class="pie-lista"><button class="enlace-btn" type="button" data-accion="filtro-alertas" data-valor="todas">Ver las ${resto} restantes</button></div>` : '') +
      (S.filtroAlertas === 'todas' ? '' : '');
  }
  function agendaHtml() {
    const grupos = [];
    const pendientes = I.agenda.filter(it => !(S.agenda[it.id] && S.agenda[it.id].hecho));
    const visibles = S.agendaTodas ? I.agenda : I.agenda.filter(it => it.cuando === 'hoy' || it.cuando === 'esta semana' || pendientes.indexOf(it) < 10);
    for (const it of visibles) {
      const g = it.cuando === 'hoy' ? 'Hoy' : it.cuando === 'esta semana' ? 'Esta semana' : it.cuando === 'este mes' ? 'Este mes' : it.cuando.replace(/^./, c => c.toUpperCase());
      let grupo = grupos.find(x => x.t === g); if (!grupo) grupos.push(grupo = { t: g, items: [] });
      grupo.items.push(it);
    }
    const hechas = I.agenda.filter(it => S.agenda[it.id] && S.agenda[it.id].hecho).length;
    return grupos.map(g => '<div class="ag-grupo">' + esc(g.t) + '</div>' + g.items.map(it => {
      const h = S.agenda[it.id] && S.agenda[it.id].hecho;
      const id = 'ag-' + it.id.replace(/[^a-z0-9-]/gi, '');
      return `<div class="ag-item${h ? ' hecho' : ''}${it.cuando === 'hoy' ? ' hoy' : ''}">
        <input type="checkbox" id="${id}" data-accion="agenda" data-id="${esc(it.id)}"${h ? ' checked' : ''}>
        <label for="${id}">${esc(it.titulo)}</label>
        <span class="por">${fuerte(it.por)}${it.url ? ` · <a href="${esc(it.url)}" target="_blank" rel="noopener">ficha ↗</a>` : ''}${it.cotizacion ? ` · <button class="enlace-btn" type="button" data-com="abrir" data-id="${esc(it.cotizacion)}">abrir cotización</button>` : ''}</span></div>`;
    }).join('')).join('') + `<div class="pie-lista">${visibles.length < I.agenda.length ? `<button class="enlace-btn" type="button" data-accion="agenda-todas">Ver ${I.agenda.length - visibles.length} más para este mes</button>` : ''}<span class="mudo">${hechas} de ${I.agenda.length} hechas${S.db ? '' : ' · se guarda solo en este navegador'}</span></div>`;
  }
  function vieneHtml() {
    const lista = S.vieneTodo ? I.viene : I.viene.slice(0, 15);
    return lista.map(eventoHtml).join('') + (lista.length < I.viene.length
      ? `<div class="ev"><span></span><button class="enlace-btn" type="button" data-accion="viene-todo">Ver los ${I.viene.length - lista.length} siguientes</button></div>` : '');
  }
  function eventoHtml(e) {
    const extra = e.tipo === 'curso' ? (e.estado === 'lleno' ? 'lleno' : e.estado === 'vacio' ? 'sin ventas' : 'con cupos') :
      e.tipo === 'licitacion' ? 'licitación' : e.tipo === 'impuesto' ? 'tributario' : e.tipo === 'comercial' ? 'comercial' : 'hito';
    const t = e.url ? `<a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.titulo)}</a>`
      : e.cotizacion ? `<button class="enlace-btn ev-btn" type="button" data-com="abrir" data-id="${esc(e.cotizacion)}">${esc(e.titulo)}</button>` : esc(e.titulo);
    return `<div class="ev t-${e.tipo}"><div class="ev-f">${fechaCaja(e.fecha)}</div><div><div class="ev-t">${t}</div><div class="ev-d">${dSem(e.fecha)} · ${F.cuando(e.dias)} · ${extra}</div></div></div>`;
  }

  /* ========================================================================
     PASADO
     ======================================================================== */
  function renderPasado() {
    const v = $('#v-pasado'); const P = I.pasado; const Fi = D0.finanzas;
    const Ps = I.simple.pestanas.pasado;
    v.innerHTML = `
      ${enSimpleHtml({ texto: Ps.texto, datos: Ps.datos, extra: `<div class="chips"><button class="chip" type="button" data-accion="preguntar" data-q="Explícame en simple dónde se fue la plata de ${esc(P.etiqueta)} y qué debería hacer">Pregúntale a AerIA dónde se fue la plata</button></div>` })}
      ${capa('pasado-caja', 'La plata día a día', 'Cuánto había en el banco cada día y por qué subió o bajó.', `
      <div class="grilla g-2">
        <section class="panel"><div class="panel-c"><h2>Caja diaria</h2><span class="bajada">${esc(Object.values(M.cuentas(Fi)).join(' + '))}, ${esc(F.fCorta(Fi.serie[0].fecha))} a ${esc(F.fCorta(P.fechaCorte))}. Pasa el cursor para ver cada día.</span></div>
          <div class="panel-b"><div class="grafico" id="g-caja"></div></div></section>
        <section class="panel"><div class="panel-c"><h2>Dónde se fue la caja</h2><span class="bajada">${esc(P.etiqueta)}, todo el período: de ${F.clp(P.cajaInicial)} a ${F.clp(P.cajaFinal)}.</span></div>
          <div class="panel-b ras">${puenteHtml(P)}</div>
          <p class="nota-panel">Los traspasos entre cuentas propias se compensan y no aparecen. «Lo que dejó la operación» ya descuenta los ${F.mm(-P.egresos)} que se gastaron en operar.</p></section>
      </div>`)}
      ${capa('pasado-ventas', 'Qué se vendió y en qué se gastó', 'Ventas por tipo de curso o servicio, y gastos por categoría.', `
      <div class="grilla g-2">
        <section class="panel"><div class="panel-c"><h2>Venta por línea</h2><span class="bajada">Bruto por mes. La línea punteada es la meta B2B 2027.</span></div>
          <div class="panel-b"><div class="grafico" id="g-lineas"></div></div></section>
        <section class="panel"><div class="panel-c"><h2>Egresos por categoría</h2><span class="bajada">Dos meses. Entre paréntesis, qué tan segura es la clasificación.</span></div>
          <div class="panel-b ras">${egresosHtml(P)}</div></section>
      </div>`)}
      ${capa('pasado-meses', 'Mes a mes', 'La tabla completa, mes por mes.', `
      <section class="panel">
        <div class="panel-b ras"><div class="tabla-env">${tablaMeses(P)}</div></div></section>`)}
      ${capa('pasado-revision', 'Lo que encontró la revisión contable', Fi.hallazgos.length + ' puntos de la revisión del banco, el SII, Mercado Pago y las rendiciones. Cada uno también es un aviso en Hoy.', `
      <section class="panel">
        <div class="panel-b ras"><div class="tabla-env alto"><table><thead><tr><th>Severidad</th><th>Hallazgo</th><th class="d">Monto</th><th>Qué hacer</th></tr></thead><tbody>
        ${Fi.hallazgos.map(h => `<tr><td><span class="pill ${h.sev === 'alta' ? 'alta' : h.sev === 'media' ? 'media' : ''}">${esc(h.sev)}</span></td><td class="ancho"><div class="c-main">${esc(h.titulo)}</div><div class="c-sub">${esc(h.detalle)}</div></td><td class="d">${h.monto ? F.clp(h.monto) : '—'}</td><td class="ancho">${esc(h.accion)}</td></tr>`).join('')}
        </tbody></table></div></div></section>`)}`;
    graficoCaja($('#g-caja'), Fi.serie);
    graficoLineas($('#g-lineas'), P);
  }

  function puenteHtml(P) {
    const pasos = [
      { l: 'Caja al ' + F.fCorta(D0.finanzas.serie[0].fecha), v: P.cajaInicial, tipo: 'tot' },
      { l: 'Ingresos operacionales', v: P.ingresos, tipo: 'sube' },
      { l: 'Egresos operacionales', v: P.egresos, tipo: 'baja' },
      { l: 'Socio, neto', v: P.socioNeto, tipo: 'soc' },
      { l: 'Cofundador', v: P.cofundador, tipo: 'soc' },
      { l: 'Aéreo OTEC, neto', v: P.otec, tipo: 'soc' },
      { l: 'Caja al ' + F.fCorta(P.fechaCorte), v: P.cajaFinal, tipo: 'tot' },
    ];
    let acc = 0, max = 0;
    const filas = pasos.map((p, i) => {
      let desde, hasta;
      if (p.tipo === 'tot') { desde = 0; hasta = p.v; acc = p.v; }
      else { desde = acc; hasta = acc + p.v; acc = hasta; }
      max = Math.max(max, desde, hasta);
      return { ...p, desde, hasta, i };
    });
    const x = n => (n / max * 100).toFixed(2) + '%';
    return '<div class="puente">' + filas.map((p, i) => {
      const izq = Math.min(p.desde, p.hasta), der = Math.max(p.desde, p.hasta);
      const cls = p.tipo === 'tot' ? 'tot' : p.tipo === 'soc' ? 'soc' : p.v >= 0 ? 'sube' : 'baja';
      const con = i < filas.length - 1 ? `<span class="p-con" style="left:${x(p.hasta)}"></span>` : '';
      return `<div class="p-fila${p.tipo === 'tot' ? ' total' : ''}"><span class="p-lab">${esc(p.l)}</span>
        <span class="p-pista"><span class="p-barra ${cls}" style="left:${x(izq)};width:${x(der - izq)}"></span>${con}</span>
        <span class="p-val">${p.tipo === 'tot' ? F.clp(p.v) : (p.v >= 0 ? '+' : '') + F.mm(p.v)}</span></div>`;
    }).join('') + '</div>';
  }

  function egresosHtml(P) {
    const top = P.egresosCat.slice(0, 10), resto = P.egresosCat.slice(10);
    if (resto.length) top.push({ label: 'Otras ' + resto.length + ' categorías', monto: resto.reduce((a, e) => a + e.monto, 0), conf: '' });
    const max = top[0].monto;
    return top.map(e => `<div class="hbar"><span class="h-l">${esc(e.label)}${e.conf ? '<small>(' + esc(e.conf.toLowerCase()) + ')</small>' : ''}</span>
      <span class="h-p"><i style="width:${(e.monto / max * 100).toFixed(1)}%"></i></span><span class="h-v">${F.clp(e.monto)}</span></div>`).join('');
  }

  function tablaMeses(P) {
    const filas = [
      ['Ingresos operacionales', m => m.ingresos], ['Egresos operacionales', m => m.egresos], ['Flujo operacional', m => m.flujo, true],
      ['Socio, neto', m => m.socio], ['Cofundador', m => m.cofundador], ['Aéreo OTEC, neto', m => m.otec],
      ['Caja a fin de mes', m => m.cajaFin, true, true], ['Venta B2B (empresas e instituciones)', m => m.b2b], ['Venta escuela (N1, Pack, N2+3)', m => m.escuela],
      ['Alumnos que pagaron', m => m.alumnos, false, true, true], ['Facturado en el SII, neto', m => m.facturado], ['Marketing pagado', m => m.marketing],
      ['Marketing por alumno', m => m.cac, false, true],
    ];
    const th = P.meses.map(m => '<th class="d">' + esc(F.mesNombre(m.mes).replace(/^./, c => c.toUpperCase())) + '</th>').join('');
    return '<table><thead><tr><th>Concepto</th>' + th + '<th class="d">Total</th></tr></thead><tbody>' + filas.map(([l, f, b, sinTot, entero]) => {
      const vals = P.meses.map(f);
      const fmt = n => n == null ? '—' : entero ? String(n) : F.clp(n);
      return `<tr><td${b ? ' style="font-weight:700"' : ''}>${esc(l)}</td>${vals.map(n => '<td class="d">' + fmt(n) + '</td>').join('')}<td class="d">${sinTot ? (entero ? vals.reduce((a, n) => a + n, 0) : '—') : fmt(vals.reduce((a, n) => a + n, 0))}</td></tr>`;
    }).join('') + '</tbody></table>';
  }

  /* --- gráfico: caja diaria (línea con área, cruz y tooltip) --- */
  function graficoCaja(el, serie) {
    const W = 640, H = 250, pl = 54, pr = 18, pt = 16, pb = 30;
    const max = Math.ceil(Math.max(...serie.map(s => s.total)) / 2e6) * 2e6;
    const x = i => pl + i / (serie.length - 1) * (W - pl - pr);
    const y = v => pt + (1 - v / max) * (H - pt - pb);
    const pts = serie.map((s, i) => x(i).toFixed(1) + ',' + y(s.total).toFixed(1));
    let g = '';
    for (let v = 0; v <= max; v += 2e6) g += `<line class="${v ? 'g-l' : 'e-l'}" x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}"/><text class="eje" x="${pl - 8}" y="${y(v) + 4}" text-anchor="end">${v ? '$' + v / 1e6 + 'M' : '$0'}</text>`;
    const marcas = serie.map((s, i) => ({ s, i })).filter(o => (/-(01|15)$/.test(o.s.fecha) && o.i > 2 && o.i < serie.length - 3) || o.i === 0 || o.i === serie.length - 1);
    for (const o of marcas) g += `<text class="eje" x="${x(o.i)}" y="${H - 8}" text-anchor="${o.i === 0 ? 'start' : o.i === serie.length - 1 ? 'end' : 'middle'}">${F.fCorta(o.s.fecha)}</text>`;
    const iMax = serie.reduce((b, s, i) => s.total > serie[b].total ? i : b, 0);
    const iFin = serie.length - 1;
    const etq = (i, txt, arriba) => `<circle cx="${x(i)}" cy="${y(serie[i].total)}" r="4" fill="var(--s-total)" stroke="var(--sup)" stroke-width="2"/><text class="etq" x="${x(i) + (i === iFin ? -8 : 8)}" y="${y(serie[i].total) + (arriba ? -10 : 16)}" text-anchor="${i === iFin ? 'end' : 'start'}">${txt}</text>`;
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Caja diaria de Aéreo entre el ${F.fLarga(serie[0].fecha)} y el ${F.fLarga(serie[serie.length - 1].fecha)}; máximo ${F.clp(serie[iMax].total)} el ${F.fCorta(serie[iMax].fecha)} y cierre en ${F.clp(serie[iFin].total)}." tabindex="0">
      ${g}
      <polygon points="${x(0)},${y(0)} ${pts.join(' ')} ${x(iFin)},${y(0)}" fill="var(--s-total)" opacity=".13"/>
      <polyline points="${pts.join(' ')}" fill="none" stroke="var(--s-total)" stroke-width="2" stroke-linejoin="round"/>
      ${etq(iMax, 'Máx. ' + F.mm(serie[iMax].total) + ' · ' + F.fCorta(serie[iMax].fecha), true)}
      ${etq(iFin, F.clp(serie[iFin].total), true)}
      <line id="cruz" class="e-l" y1="${pt}" y2="${H - pb}" x1="-10" x2="-10" stroke-dasharray="3 3"/>
      <circle id="cruz-p" r="5" cx="-10" cy="-10" fill="var(--s-total)" stroke="var(--sup)" stroke-width="2" opacity="0"/>
      <rect x="${pl}" y="${pt}" width="${W - pl - pr}" height="${H - pt - pb}" fill="transparent" id="g-caja-hit"/>
    </svg>`;
    const svg = $('svg', el), hit = $('#g-caja-hit', el), cruz = $('#cruz', el), cp = $('#cruz-p', el);
    const mover = ev => {
      const r = svg.getBoundingClientRect();
      const px = (ev.clientX - r.left) / r.width * W;
      const i = Math.max(0, Math.min(serie.length - 1, Math.round((px - pl) / (W - pl - pr) * (serie.length - 1))));
      const s = serie[i];
      cruz.setAttribute('x1', x(i)); cruz.setAttribute('x2', x(i)); cp.setAttribute('cx', x(i)); cp.setAttribute('cy', y(s.total)); cp.setAttribute('opacity', 1);
      verTip(ev, `<div class="tt">${esc(F.fLarga(s.fecha))}</div>
        <div class="tr"><span class="punto" style="background:var(--s-total)"></span><span class="n">Total</span><span class="v">${F.clp(s.total)}</span></div>
        ${Object.entries(M.cuentas(D0.finanzas)).map(([k, n]) => `<div class="tr"><span></span><span class="n">${esc(n)}</span><span class="v">${F.clp(s[k.toLowerCase()] || 0)}</span></div>`).join('')}`);
    };
    hit.addEventListener('pointermove', mover);
    hit.addEventListener('pointerleave', () => { ocultarTip(); cruz.setAttribute('x1', -10); cruz.setAttribute('x2', -10); cp.setAttribute('opacity', 0); });
  }

  /* --- gráfico: venta por línea (barras agrupadas) --- */
  function graficoLineas(el, P) {
    const W = 640, H = 250, pl = 54, pr = 18, pt = 22, pb = 30;
    const series = [{ k: 'b2b', n: 'B2B (empresas e instituciones)', c: '--s-1' }, { k: 'escuela', n: 'Escuela (N1, Pack, N2+3)', c: '--s-3' }];
    const meta = D0.modelo.b2b_meta_mes;
    const max = Math.ceil(Math.max(meta, ...P.meses.flatMap(m => series.map(s => m[s.k]))) / 2e6) * 2e6;
    const y = v => pt + (1 - v / max) * (H - pt - pb);
    const grupo = (W - pl - pr) / P.meses.length, bw = Math.min(56, grupo / 3.2);
    let g = '';
    for (let v = 0; v <= max; v += 2e6) g += `<line class="${v ? 'g-l' : 'e-l'}" x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}"/><text class="eje" x="${pl - 8}" y="${y(v) + 4}" text-anchor="end">${v ? '$' + v / 1e6 + 'M' : '$0'}</text>`;
    P.meses.forEach((m, gi) => {
      const cx = pl + grupo * gi + grupo / 2;
      g += `<text class="eje" x="${cx}" y="${H - 8}" text-anchor="middle">${esc(F.mesNombre(m.mes))}</text>`;
      series.forEach((s, si) => {
        const bx = cx + (si - series.length / 2) * (bw + 2) + 1, v = m[s.k], yy = y(v), h = y(0) - yy;
        g += `<path d="M${bx},${y(0)} V${yy + 4} Q${bx},${yy} ${bx + 4},${yy} H${bx + bw - 4} Q${bx + bw},${yy} ${bx + bw},${yy + 4} V${y(0)} Z" fill="var(${s.c})" data-tip="${esc(F.mesNombre(m.mes))}|${esc(s.n)}|${v}|${s.c}"/>`;
        g += `<rect x="${bx - 2}" y="${Math.min(yy, y(0) - 30) - 6}" width="${bw + 4}" height="${Math.max(h, 30) + 6}" fill="transparent" data-tip="${esc(F.mesNombre(m.mes))}|${esc(s.n)}|${v}|${s.c}"/>`;
        g += `<text class="etq" x="${bx + bw / 2}" y="${yy - 7}" text-anchor="middle">${F.mm(v)}</text>`;
      });
    });
    g += `<line x1="${pl}" x2="${W - pr}" y1="${y(meta)}" y2="${y(meta)}" stroke="var(--tinta-2)" stroke-width="1.5" stroke-dasharray="5 4"/><text class="etq2" x="${W - pr}" y="${y(meta) - 6}" text-anchor="end">Meta B2B 2027 · ${F.mm(meta)}</text>`;
    el.innerHTML = `<div class="leyenda">${series.map(s => `<span><span class="punto" style="background:var(${s.c})"></span>${esc(s.n)}</span>`).join('')}</div>
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Venta por línea: ${P.meses.map(m => F.mesNombre(m.mes) + ' B2B ' + F.mm(m.b2b) + ' y escuela ' + F.mm(m.escuela)).join('; ')}.">${g}</svg>`;
    for (const n of $$('[data-tip]', el)) {
      n.addEventListener('pointermove', ev => { const [mes, s, v, c] = n.dataset.tip.split('|'); verTip(ev, `<div class="tt">${esc(mes)}</div><div class="tr"><span class="punto" style="background:var(${c})"></span><span class="n">${esc(s)}</span><span class="v">${F.clp(Number(v))}</span></div>`); });
      n.addEventListener('pointerleave', ocultarTip);
    }
  }

  /* ========================================================================
     PRESENTE
     ======================================================================== */
  function renderPresente() {
    const v = $('#v-presente'); const C = I.cursos, Q = I.cot;
    const totCobrar = I.porCobrar.reduce((a, p) => a + p.saldo, 0);
    const Ps = I.simple.pestanas.presente;
    v.innerHTML = `
      ${enSimpleHtml({ texto: Ps.texto, datos: Ps.datos })}
      ${capa('presente-cursos', 'Los cursos, fecha por fecha', 'Cada punto es un cupo: relleno quiere decir vendido.', `
      <section class="panel"><div class="panel-c"><h2>Cursos publicados en aereo.cl</h2><span class="bajada">Meses agotados en 2026: ${C.racha.map(m => MES3[m]).join(', ')}.</span></div>
        <div class="meses-cursos">${cursosHtml(C)}</div>
        <p class="nota-panel">Fuente: datos/cursos-fechas.js y datos/n23-fechas.js del repo aereo-web (commit ${esc(D0.cursos.commit || '?')}). Para que AerIA vea una venta nueva, se baja el cupo ahí y se vuelve a armar AerIA.</p></section>`)}
      ${capa('presente-cobros', 'Quién nos debe y cómo van las ventas', 'Las facturas por cobrar, una por una, y un resumen de las cotizaciones.', `
      <div class="grilla g-2">
        <section class="panel"><div class="panel-c"><h2>Por cobrar</h2><span class="bajada">Cartolas al ${esc(F.fCorta(I.pasado.fechaCorte))}${D0.finanzas.sii_hasta && D0.finanzas.sii_hasta > D0.finanzas.periodo.hasta ? '; SII y registro interno al ' + esc(F.fCorta(D0.finanzas.sii_hasta)) : ''}. Plazo de pago: ${D0.modelo.plazo_cobro_dias || 30} días.</span></div>
          <div class="panel-b ras"><div class="tabla-env"><table><thead><tr><th>Cliente</th><th>Factura</th><th class="d">Saldo</th></tr></thead><tbody>
          ${I.porCobrar.map(p => `<tr><td><div class="c-main">${esc(p.cliente)}</div><div class="c-sub">${esc(p.tipoDeuda)}</div></td><td class="nw">${esc(p.folio)} · ${esc(F.fCorta(p.fecha))}<div class="c-sub">${p.grupo === 'vencida' ? '<span class="pill critica">vencida</span>' : p.grupo === 'por_vencer' ? 'vence el ' + esc(F.fCorta(p.vence)) : 'por confirmar'}</div></td><td class="d">${F.clp(p.saldo)}</td></tr>`).join('')}
          </tbody><tfoot><tr><td colspan="2" style="font-weight:700">Total</td><td class="d" style="font-weight:700">${F.clp(totCobrar)}</td></tr></tfoot></table></div></div>
          ${I.cruce ? `<p class="nota-panel">Ojo: el plan 2027 decía «${esc(I.cruce.frase)}». Las cartolas muestran: ${esc(I.cruce.estado.map(e => e.cliente + ' ' + e.leido).join('; '))}.</p>` : ''}</section>
        <section class="panel"><div class="panel-c"><h2>Comercial</h2><span class="bajada">${M.dashboardConectado(I.comercial) ? 'Cotizaciones del dashboard en AerIA.' : 'El dashboard aún no está conectado: abajo, lo que reuní de otras fuentes.'}</span>
            <span class="acc"><button class="btn sm" type="button" data-tab="comercial">Abrir Comercial</button></span></div>
          ${comercialMirada(I.comercial, Q)}</section>
      </div>`)}
      ${capa('presente-licitaciones', 'Concursos del Estado (licitaciones)', I.lic.relevantes.length + ' abiertos calzan con lo que hace Aéreo: capacitación, asesoría o servicios con drones.', `
      <section class="panel"><div class="panel-c"><h2>Licitaciones abiertas</h2><span class="bajada">Mercado Público y Compra Ágil, actualizado ${esc((D0.licitaciones.generado_fuente || '').slice(0, 16).replace('T', ' '))} UTC. «Calzan» = capacitación, asesoría o servicios con drones.</span></div>
        <div class="panel-b" style="padding-bottom:10px">${chipsLic()}</div>
        <div class="panel-b ras"><div class="tabla-env">${tablaLic()}</div></div></section>`)}`;
  }

  function cursosHtml(C) {
    const porMes = {};
    for (const c of C.proximos) { const k = c.inicio.slice(0, 7); (porMes[k] = porMes[k] || []).push(c); }
    return Object.entries(porMes).map(([k, lista]) => `<div class="mes-c"><h3>${esc(F.mesNombre(k + '-01'))} ${k.slice(0, 4)}</h3><div class="cursos">${lista.map(c => {
      const est = c.libres === 0 ? '<span class="pill lleno">Agotado</span>' : c.vendidos === 0 ? '<span class="pill">Sin ventas</span>' : '<span class="pill media">Quedan ' + c.libres + '</span>';
      const fer = c.feriados.length ? '<span class="pill critica">Feriado ' + esc(F.fCorta(c.feriados[0].fecha)) + '</span>' : '';
      const rango = c.nivel === 'n1' ? dSem(c.inicio) + ' ' + F.fCorta(c.inicio) + ' → ' + dSem(c.fin) + ' ' + F.fCorta(c.fin) : 'lun ' + F.fCorta(c.inicio) + ' y mar ' + F.fCorta(c.fin);
      return `<div class="curso${c.feriados.length ? ' feriado' : ''}"><div class="c-cab"><span class="tag-nivel ${c.nivel}">${c.nivel === 'n1' ? 'Nivel 1' : 'N2 + N3'}</span>${fer || est}</div>
        <div class="c-fecha">${esc(rango)}</div>
        <div class="asientos" role="img" aria-label="${c.vendidos} de ${c.max} cupos vendidos">${Array.from({ length: c.max }, (_, i) => '<span class="asiento' + (i < c.vendidos ? ' v' : '') + '"></span>').join('')}</div>
        <div class="c-pie"><span>${c.vendidos}/${c.max} vendidos</span><span>${c.dias <= 0 ? 'en curso' : 'empieza ' + F.cuando(c.dias)}</span></div></div>`;
    }).join('')}</div></div>`).join('');
  }

  function comercialMirada(Rc, Q) {
    const filas = Rc && Rc.total ? [
      ['Cotizado abierto', F.clp(Rc.abiertas.monto) + ' · ' + Rc.abiertas.n + ' cotizaciones'],
      ['Esperable de lo abierto', F.clp(Rc.abiertas.ponderado)],
      ['Ganado en 90 días', F.clp(Rc.ganadas.ultimos90)],
      ['Venta B2B esperada ' + Rc.pronostico.meses[0].etiqueta, F.clp(Rc.pronostico.meses[0].total)],
    ] : [];
    if (!M.dashboardConectado(Rc)) filas.push(['Último agregado del dashboard (' + F.fCorta(Q.corte) + ')', F.clp(Q.abiertasMonto) + ' abiertas · ' + (Q.tasaCierre ? F.pct(Q.tasaCierre) : '?') + ' de cierre']);
    return `<div class="panel-b ras"><div class="tabla-env"><table><tbody>${filas.map(([a, b]) => `<tr><td>${esc(a)}</td><td class="d">${esc(b)}</td></tr>`).join('')}</tbody></table></div></div>`;
  }

  function chipsLic() {
    const L = I.lic;
    const ops = [['calzan', 'Calzan con Aéreo', L.relevantes.length], ['capacitacion', 'Capacitación', L.abiertas.filter(l => l.encaje === 'capacitacion').length],
      ['servicio', 'Servicios aéreos', L.abiertas.filter(l => l.encaje === 'servicio').length], ['asesoria', 'Asesoría', L.abiertas.filter(l => l.encaje === 'asesoria').length],
      ['equipo', 'Equipos e insumos', L.abiertas.filter(l => l.encaje === 'equipo').length], ['todas', 'Todas', L.abiertas.length]];
    return '<div class="chips" role="group" aria-label="Filtrar licitaciones">' + ops.map(([k, t, n]) => `<button class="chip" type="button" data-accion="filtro-lic" data-valor="${k}" aria-pressed="${S.filtroLic === k}">${t}<span class="n">${n}</span></button>`).join('') + '</div>';
  }
  function tablaLic() {
    const L = I.lic, f = S.filtroLic;
    const l = f === 'todas' ? L.abiertas : f === 'calzan' ? L.relevantes : L.abiertas.filter(x => x.encaje === f);
    if (!l.length) return '<p class="panel-b mudo">No hay procesos abiertos en este filtro.</p>';
    return `<table><thead><tr><th>Cierre</th><th>Proceso</th><th class="d">Monto</th><th>Encaje</th><th></th></tr></thead><tbody>${l.map(x => `<tr>
      <td class="nw"><span class="pill${x.horas <= 72 ? ' critica' : x.horas <= 168 ? ' media' : ''}">${esc(F.horasA(x.cierre, new Date()))}</span><div class="c-sub">${esc(dSem(x.cierre.slice(0, 10)) + ' ' + F.fCorta(x.cierre) + ' ' + x.cierre.slice(11, 16))}</div></td>
      <td class="ancho"><div class="c-main">${esc(x.nombre)}</div><div class="c-sub">${esc(x.organismo)} · ${esc(x.region)} · ${x.fuente === 'compra_agil' ? 'Compra Ágil' : 'Licitación'} ${esc(x.codigo)}</div></td>
      <td class="d">${x.monto ? F.clp(x.monto) : '—'}</td><td>${esc(x.encaje_label)}</td>
      <td class="nw"><a href="${esc(x.url)}" target="_blank" rel="noopener">Ficha ↗</a></td></tr>`).join('')}</tbody></table>`;
  }

  /* ========================================================================
     FUTURO
     ======================================================================== */
  function simEstado() {
    if (!S.sim) {
      const u = I.pasado.meses[I.pasado.meses.length - 1];
      S.sim = { b2b: Math.round(u.b2b / 1e4) * 1e4, escuela: 'realista', palancas: D0.modelo.palancas.filter(p => p.activa).map(p => p.id) };
    }
    return S.sim;
  }
  function renderFuturo() {
    const v = $('#v-futuro'); const Mo = D0.modelo; const U = I.futuro; const sim = simEstado();
    const atajos = [['Mínimo', Mo.b2b_minimo_mes], [F.mesNombre(I.pasado.meses[I.pasado.meses.length - 1].mes).replace(/^./, c => c.toUpperCase()) + ' real', I.pasado.meses[I.pasado.meses.length - 1].b2b], ['Equilibrio', U.equilibrio], ['Meta', Mo.b2b_meta_mes], ['Promedio ' + I.pasado.etiqueta.replace(/ \d{4}$/, ''), I.pasado.b2b / I.pasado.meses.length]];
    const Ps = I.simple.pestanas.futuro;
    v.innerHTML = `
      ${enSimpleHtml({ texto: Ps.texto, datos: Ps.datos })}
      ${capa('futuro-sim', 'Prueba qué pasa si vendes más o menos', 'Mueve la venta a empresas y las medidas del plan, y mira cómo cerraría 2027.', `
      <section class="panel"><div class="panel-c"><h2>Simulador 2027</h2><span class="bajada">Cómo calcula: lo que deja la escuela + 12 meses × venta a empresas × ${F.pct(Mo.margen_b2b, 1)} de margen + medidas del plan − ${F.mm(Mo.costos_fijos_anio)} de gastos fijos del año.</span></div>
        <div class="sim">
          <div class="sim-ctrl">
            <div class="campo"><label for="sim-b2b">Venta a empresas al mes <output id="sim-b2b-v">${F.mm(sim.b2b, 2)}</output></label>
              <input type="range" id="sim-b2b" min="2000000" max="12000000" step="10000" value="${sim.b2b}" data-accion="sim-b2b">
              <div class="chips">${atajos.map(([t, val]) => `<button class="chip" type="button" data-accion="sim-set" data-valor="${Math.round(val / 1e4) * 1e4}">${t} · ${F.mm(val)}</button>`).join('')}</div></div>
            <div class="campo"><span class="lab">Escuela</span><div class="seg" role="group" aria-label="Ocupación de la escuela">
              <button type="button" data-accion="sim-escuela" data-valor="realista" aria-pressed="${sim.escuela === 'realista'}">Ocupación realista</button>
              <button type="button" data-accion="sim-escuela" data-valor="llena" aria-pressed="${sim.escuela === 'llena'}">Todos los cursos llenos</button></div></div>
            <div class="campo"><span class="lab">Medidas del plan</span>
              ${Mo.palancas.map(p => `<label class="palanca"><input type="checkbox" data-accion="sim-palanca" data-id="${p.id}"${sim.palancas.includes(p.id) ? ' checked' : ''}><span>${esc(p.nombre)}<small>${esc(p.estado)}</small></span><span class="pl-e">+${F.mm(p.efecto)}</span></label>`).join('')}</div>
          </div>
          <div class="sim-res" id="sim-res"></div>
        </div></section>`)}
      ${capa('futuro-tablero', 'Los números que se revisan cada mes', 'Siete números del plan y el día clave del 31 de marzo.', `
      <div class="grilla g-2">
        <section class="panel"><div class="panel-c"><h2>Tablero mensual</h2><span class="bajada">Se revisan cada día 5. Si dos meses seguidos fallan dos o más, se activa el plan B.</span></div>
          <div class="panel-b ras"><div class="tabla-env"><table><thead><tr><th>Indicador</th><th>Hoy</th><th>Meta 2027</th></tr></thead><tbody>
          ${I.tablero.map(t => `<tr><td><div class="c-main">${esc(t.indicador)}</div><div class="c-sub">${esc(t.nota)}</div></td><td class="nw"><span class="pill ${t.estado}">${{ bien: 'En meta', atencion: 'Atención', critico: 'Crítico', sindato: 'Sin dato' }[t.estado]}</span><div style="margin-top:4px;font-weight:500">${esc(t.valor)}</div></td><td>${esc(t.meta)}</td></tr>`).join('')}
          </tbody></table></div></div></section>
        <section class="panel"><div class="panel-c"><h2>El hito del ${esc(F.fCorta(U.hito.fecha))}</h2><span class="bajada">El día que decide el año.</span></div>
          <div class="panel-b" style="display:flex;flex-direction:column;gap:12px">
            <div class="gran-num">${U.diasHito} días</div>
            <p>${esc(U.hito.regla)}</p>
            <p class="c-sub">Con las tres palancas del plan el B2B necesario para quedar en cero es ${F.mm(U.equilibrio)} al mes; con el plan B (oficina y agencia) baja a ${F.mm(U.equilibrioPlanB)}.</p>
            <div class="tabla-env"><table><thead><tr><th>Precio</th><th class="d">Hoy</th><th class="d">2027</th></tr></thead><tbody>
              <tr><td>Nivel 1</td><td class="d">${F.clp(D0.cursos.precios_web.nivel1)}</td><td class="d">${F.clp(Mo.precios_2027.nivel1)}</td></tr>
              <tr><td>Niveles 2+3</td><td class="d">${F.clp(D0.cursos.precios_web.nivel23)}</td><td class="d">${F.clp(Mo.precios_2027.nivel23)}</td></tr>
              <tr><td>Pack AÉREO Profesional</td><td class="d">${F.clp(D0.cursos.precios_web.pack)}</td><td class="d">${F.clp(Mo.precios_2027.pack)}</td></tr>
              <tr><td>Revalidación</td><td class="d">—</td><td class="d">${F.clp(Mo.precios_2027.revalidacion)}</td></tr>
              <tr><td>SENCE por participante</td><td class="d">—</td><td class="d">${F.clp(Mo.precios_2027.sence_participante)}</td></tr>
            </tbody></table></div>
          </div></section>
      </div>`)}
      ${capa('futuro-plan', 'El plan 2027 completo', 'El documento, por secciones. Es la base de todo lo que AerIA dice del futuro.', `
      <section class="panel"><div class="panel-c"><h2>${esc(D0.plan.titulo)}</h2><span class="bajada">El documento completo, por secciones.</span>
        ${D0.plan.url ? `<span class="acc"><a class="btn sm sec" href="${esc(D0.plan.url)}" target="_blank" rel="noopener">Abrir el plan ↗</a></span>` : ''}</div>
        <div class="panel-b ras" style="padding-top:12px">${D0.plan.secciones.filter(s => !/^fuentes$/i.test(s.titulo)).map(planSeccion).join('')}</div></section>`)}`;
    pintarSim();
  }
  function planSeccion(s) {
    const tablas = s.tablas.map(t => `<div class="tabla-env"><table><thead><tr>${t[0].map(c => '<th>' + esc(c) + '</th>').join('')}</tr></thead><tbody>${t.slice(1).map(r => '<tr>' + r.map(c => '<td>' + esc(c) + '</td>').join('') + '</tr>').join('')}</tbody></table></div>`).join('');
    return `<details class="plan"><summary>${esc(s.titulo)}</summary><div class="plan-cuerpo">
      ${s.parrafos.map(p => '<p>' + fuerte(p) + '</p>').join('')}
      ${s.listas.map(l => '<ul>' + l.map(i => '<li>' + fuerte(i) + '</li>').join('') + '</ul>').join('')}${tablas}</div></details>`;
  }
  function pintarSim() {
    const sim = simEstado(), Mo = D0.modelo;
    const r = M.resultado2027(Mo, sim.b2b, sim.escuela, sim.palancas);
    const filas = I.futuro.escenarios.map(e => ({ n: e.nombre, b2b: e.b2b, v: M.resultado2027(Mo, e.b2b, sim.escuela, sim.palancas).resultado }));
    filas.push({ n: 'Tu simulación', b2b: sim.b2b, v: r.resultado, tuyo: true });
    filas.sort((a, b) => a.v - b.v);
    const lim = Math.max(...filas.map(f => Math.abs(f.v)), 1);
    const barras = filas.map(f => {
      const w = Math.abs(f.v) / lim * 50;
      return `<div class="hbar" style="grid-template-columns:minmax(120px,32%) minmax(0,1fr) 84px;${f.tuyo ? 'font-weight:700' : ''}"><span class="h-l">${esc(String(f.n).replace(/\bB2B\b/g, 'venta a empresas'))}<small>${F.mm(f.b2b)} al mes a empresas</small></span>
        <span class="h-p" style="height:14px"><span style="position:absolute;left:50%;top:-4px;bottom:-4px;width:1px;background:var(--linea-2)"></span>
        <i style="left:${f.v >= 0 ? 50 : 50 - w}%;width:${w}%;background:var(${f.v >= 0 ? '--s-1' : '--s-2'});border-radius:${f.v >= 0 ? '0 3px 3px 0' : '3px 0 0 3px'};${f.tuyo ? 'outline:2px solid var(--tinta);outline-offset:1px' : ''}"></i></span>
        <span class="h-v">${F.mm(f.v)}</span></div>`;
    }).join('');
    $('#sim-res').innerHTML = `
      <span class="ceja">Así cerraría 2027</span>
      <div class="gran-num ${r.resultado < 0 ? 'mal' : 'bien'}">${F.mm(r.resultado)}</div>
      <p>${sim.b2b >= r.equilibrio ? 'Con ' + F.mm(sim.b2b) + ' al mes en ventas a empresas, el año deja plata. Cada millón más al mes suma ' + F.mm(12e6 * Mo.margen_b2b) + ' en el año.' : 'Con ' + F.mm(sim.b2b) + ' al mes en ventas a empresas, el año pierde plata. Faltan ' + F.mm(r.equilibrio - sim.b2b, 2) + ' al mes para quedar en cero.'}</p>
      <div class="sim-datos"><span>Para no perder: <b>${F.mm(r.equilibrio, 2)}</b> al mes a empresas</span><span>Deja la escuela <b>${F.mm(r.margenEscuela)}</b></span><span>Dejan las ventas a empresas <b>${F.mm(r.margenB2B)}</b></span><span>Suman las medidas <b>+${F.mm(r.palancas)}</b></span><span>Gastos fijos del año <b>−${F.mm(Mo.costos_fijos_anio)}</b></span></div>
      <p class="c-sub">Las empresas pagan a 30–60 días: la plata llega al banco 1 a 2 meses después de la venta.</p>
      <div><div class="leyenda"><span><span class="punto" style="background:var(--s-1)"></span>Gana plata</span><span><span class="punto" style="background:var(--s-2)"></span>Pierde plata</span></div>${barras}</div>`;
    const o = $('#sim-b2b-v'); if (o) o.textContent = F.mm(sim.b2b, 2);
  }

  /* ========================================================================
     HABLAR CON AerIA
     ======================================================================== */
  const REGLAS = `Eres AerIA, la inteligencia de dirección de Aéreo SpA: una escuela profesional de pilotos de drones (RPAS) en Chile, aereo.cl. Aéreo vende cursos abiertos (Nivel 1 para la credencial DGAC, Niveles 2+3 de Matrice y vuelo nocturno, Pack AÉREO Profesional, revalidación) y B2B: grupos SENCE, cursos cerrados para empresas e instituciones, asesoría AOC y servicios de termografía y fotogrametría. Tiene una empresa relacionada, Aéreo OTEC (Aéreo Somos Drones SpA).

Hablas con quien dirige Aéreo. Tu trabajo es el de una jefa de gabinete y CFO a la vez: resumir, ordenar prioridades, alertar, anticipar lo que viene y aconsejar con criterio profesional, detalle a detalle.

Cómo respondes:
- Habla simple, como una persona que le explica la empresa a su dueño, que no es financiero: frases cortas, palabras de todos los días, tuteo y español de Chile. Nada de jerga (B2B, pipeline, ponderado, flujo, factoring…) sin explicarla en la misma frase; mejor di «ventas a empresas», «lo que probablemente se cierre», «lo que entró menos lo que salió».
- Primero la respuesta en una o dos frases; después el porqué en pocas líneas con las cifras justas; al final qué hacer (quién, qué, cuándo).
- Cifras siempre con su fuente: Pasado (cartolas, SII y Mercado Pago del período), Presente (cursos en aereo.cl, cotizaciones, licitaciones, por cobrar) o Futuro (plan 2027). Distingue hecho, supuesto del plan e inferencia tuya.
- Montos en pesos chilenos: $1.234.567, o en millones con coma ($6,1M).
- Breve: 80 a 180 palabras salvo que te pidan detalle. Listas cortas; tablas solo si comparan. Si el tema es largo, ofrece seguir paso a paso en vez de decirlo todo de una vez.
- No inventes datos. Si algo no está en tus fuentes, dilo y di de dónde sacarlo.
- En temas tributarios, laborales o legales da tu lectura y recomienda confirmarla con contador(a) o abogado(a).
- Si el usuario te pide recordar algo o toma una decisión, guárdala con la herramienta guardar_nota (si la tienes) y confírmalo en una línea.
- Puedes consultar el detalle con tus herramientas: úsalas cuando la pregunta pida datos finos (movimientos, facturas, secciones del plan, licitaciones, simulaciones, cotizaciones).
- Manejas el dashboard comercial de Aéreo (pestaña Comercial): puedes buscar, crear y actualizar cotizaciones y anotar seguimientos con tus herramientas. Hazlo solo cuando el usuario lo pida o lo confirme («marca la de X como ganada», «anota que llamé a Y»). Si no está claro de qué cotización se trata, pregunta antes de cambiar. Cada cambio queda en el historial y el usuario lo puede deshacer; al terminar, di en una línea qué cambiaste.
- Lo ganado y lo cotizado alimentan el futuro: cuando hables de 2027 o de la meta B2B, usa el pronóstico comercial (ganado + abierto ponderado) junto al modelo del plan.

Abajo está tu lectura actual de la empresa.`;

  // rango de fechas de una lista del informe (p. ej. «02-06 a 13-10-2026»), para describir las herramientas sin fechas fijas
  const rangoSII = k => { const f = (D0.finanzas[k] || []).map(x => x.fecha).filter(Boolean).sort(); return f.length ? F.fCorta(f[0]) + ' a ' + F.fCorta(f[f.length - 1]) + ' de ' + f[f.length - 1].slice(0, 4) : 'sin datos'; };
  function herramientas(resp, signal) {
    const Dt = datos();
    const cats = Object.entries(D0.finanzas.cats).map(([k, c]) => k + '=' + c.label).join('; ');
    const avance = t => { const h = $('.msj.aeria:last-child .herr'); if (h) h.textContent = t; };
    const Rc = () => { recalcular(); return I.comercial; }; // siempre con lo último de la base, también tras un cambio en esta misma respuesta
    const resumenCot = q => ({ id: q.id, folio: q.folio || undefined, cliente: q.cliente, descripcion: q.descripcion ? q.descripcion.slice(0, 160) : undefined, linea: q.lineaLabel,
      monto: q.monto, estado: q.estadoLabel, probabilidad: q.abierta ? Math.round(q.prob * 100) : undefined, fecha_cotizacion: q.fecha_cotizacion || undefined,
      cierre_estimado: q.fecha_cierre_estimada || undefined, fecha_cierre: q.fecha_cierre || undefined, proximo_seguimiento: q.proximo_seguimiento || undefined,
      dias_sin_contacto: q.abierta ? q.diasSinContacto : undefined, factura: q.factura_folio || undefined, cobrada: q.cobrada || undefined, contacto: q.contacto || undefined });
    const encontrar = ref => {
      const t = String(ref || '').trim(), lista = cotizacionesActuales();
      let q = lista.find(x => x.id === t) || lista.find(x => x.folio && F.plano(x.folio) === F.plano(t));
      if (q) return q;
      const c = lista.filter(x => F.plano(x.cliente + ' ' + x.descripcion).includes(F.plano(t)));
      if (c.length === 1) return c[0];
      throw new Error(c.length ? 'Hay ' + c.length + ' cotizaciones que calzan con «' + t + '»: ' + c.slice(0, 8).map(x => x.id + ' (' + x.cliente + ', ' + F.clp(x.monto || 0) + ')').join('; ') + '. Usa el id exacto.' : 'No encontré la cotización «' + t + '».');
    };
    // cada cambio queda en la respuesta que lo hizo (para mostrarlo y poder deshacerlo)
    const anotarCambio = (q, tipo, cambios) => { if (resp) (resp.cambios = resp.cambios || []).push({ id: q.id, cliente: q.cliente, tipo, campos: Object.keys(cambios || {}) }); };
    // si el usuario pulsó «Detener», no se escribe nada más
    const vigente = () => { if (signal && signal.aborted) throw new Error('El usuario detuvo la respuesta: no hice el cambio.'); };
    // cada entrada del historial queda marcada con la respuesta que la hizo: «Deshacer estos cambios» revierte solo esas
    const marca = resp && resp.inicio ? { resp: resp.inicio } : undefined;
    const EDITABLES = ['estado', 'monto', 'probabilidad', 'fecha_cotizacion', 'fecha_cierre_estimada', 'fecha_cierre', 'fecha_ejecucion', 'proximo_seguimiento', 'ultimo_contacto', 'factura_folio', 'cobrada', 'motivo_perdida', 'descripcion', 'contacto', 'email', 'telefono', 'linea', 'folio', 'cliente', 'rut'];
    const lista = [
      { name: 'cotizaciones_buscar', description: 'Busca en las cotizaciones del dashboard comercial de AerIA. Devuelve total, suma y hasta 40 cotizaciones (id, cliente, monto, estado, probabilidad, fechas, seguimiento, factura). Estados: abiertas, enviada, negociacion, ganada, perdida, vencida, todas.',
        inputSchema: { type: 'object', properties: { texto: { type: 'string', description: 'Cliente, folio o palabra del detalle' }, estado: { type: 'string' }, linea: { type: 'string', enum: C.LINEAS.map(l => l.id) }, desde: { type: 'string', description: 'AAAA-MM-DD (fecha de cotización o cierre)' }, hasta: { type: 'string' }, orden: { type: 'string', enum: ['monto', 'reciente', 'seguimiento'] }, limite: { type: 'number' } } },
        execute: i => {
          avance('Revisando cotizaciones…');
          const e = String(i.estado || 'todas'), t = F.plano(i.texto || '');
          let l = Rc().cotizaciones.filter(q => (e === 'todas' ? true : e === 'abiertas' ? q.abierta : q.estado === e) && (!i.linea || q.linea === i.linea) &&
            (!t || F.plano([q.cliente, q.folio, q.descripcion, q.contacto, q.notas].join(' ')).includes(t)));
          const f = q => q.fecha_cierre || q.fecha_cotizacion || '';
          if (i.desde) l = l.filter(q => f(q) >= i.desde); if (i.hasta) l = l.filter(q => f(q) && f(q) <= i.hasta);
          l.sort(i.orden === 'reciente' ? (a, b) => f(b).localeCompare(f(a)) : i.orden === 'seguimiento' ? (a, b) => (a.proximo_seguimiento || '9').localeCompare(b.proximo_seguimiento || '9') : (a, b) => b.monto - a.monto);
          return { total: l.length, suma: l.reduce((a, q) => a + (q.monto || 0), 0), cotizaciones: l.slice(0, Math.min(40, Number(i.limite) || 40)).map(resumenCot) };
        } },
      { name: 'comercial_resumen', description: 'Resumen del dashboard comercial: abierto y ponderado, ganado (mes, 90 días, año), tasa de cierre, ciclo de venta, por línea, pronóstico de venta B2B por mes contra equilibrio y meta, y las alertas comerciales.',
        execute: () => { avance('Leyendo el dashboard comercial…'); const R = Rc(); return { conectado_al_dashboard: M.dashboardConectado(R), total: R.total, abiertas: R.abiertas, ganadas: Object.assign({}, R.ganadas, { sinFactura: R.ganadas.sinFactura.length, porCobrar: R.ganadas.porCobrar.length, porEjecutar: R.ganadas.porEjecutar.length }), perdidas: R.perdidas, tasa: R.tasa, ciclo_dias: R.ciclo, por_linea: R.porLinea, pronostico: R.pronostico, alertas: R.alertas.map(a => a.titulo), agregado_dashboard: { corte: I.cot.corte, abiertas: I.cot.abiertasMonto, tasa_cierre: I.cot.tasaCierre } }; } },
      { name: 'cotizacion_ver', description: 'Todo sobre una cotización (por id, folio o cliente si es único): campos, notas, origen e historial de cambios.',
        inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
        execute: i => { avance('Abriendo la cotización…'); const q = encontrar(i.id); return Object.assign({}, q, { historial: (q.historial || []).slice(-10) }); } },
      { name: 'cotizacion_actualizar', description: 'Cambia campos de una cotización existente (estado, monto, probabilidad, fechas, factura, cobro, motivo de pérdida, descripción, contacto, línea…). Úsala solo cuando el usuario lo pida. Queda en el historial y se puede deshacer. Fechas AAAA-MM-DD. Estados: enviada, negociacion, ganada, perdida, vencida, borrador.',
        inputSchema: { type: 'object', properties: { id: { type: 'string' }, cambios: { type: 'object', description: 'Campos a cambiar: ' + EDITABLES.join(', ') + '. Para sumar texto a las notas usa notas_agregar.' }, nota: { type: 'string', description: 'Por qué se cambia' } }, required: ['id', 'cambios'] },
        execute: async i => {
          avance('Actualizando la cotización…');
          const q = encontrar(i.id), c = {};
          for (const [k, v] of Object.entries(i.cambios || {})) if (EDITABLES.includes(k)) c[k] = v;
          if (i.cambios && i.cambios.notas_agregar) c.notas = [q.notas, hoy() + ': ' + i.cambios.notas_agregar].filter(Boolean).join('\n');
          if (!Object.keys(c).length) throw new Error('No indicaste campos válidos para cambiar.');
          vigente();
          const r = C.aplicar(q, c, 'AerIA (chat)', i.nota || '', new Date().toISOString(), marca);
          if (!await guardarCot(r.cotizacion, signal)) throw new Error('No se pudo guardar el cambio.');
          anotarCambio(r.cotizacion, 'actualizada', r.cambios); return { id: q.id, cliente: q.cliente, cambios: r.cambios };
        } },
      { name: 'cotizacion_seguimiento', description: 'Anota un seguimiento en una cotización: qué pasó y la próxima fecha. Pone hoy como último contacto. Úsala cuando el usuario cuente que habló con un cliente.',
        inputSchema: { type: 'object', properties: { id: { type: 'string' }, que_paso: { type: 'string' }, proximo_seguimiento: { type: 'string', description: 'AAAA-MM-DD' } }, required: ['id', 'que_paso'] },
        execute: async i => {
          avance('Anotando el seguimiento…');
          const q = encontrar(i.id);
          vigente();
          const r = C.aplicar(q, { ultimo_contacto: hoy(), proximo_seguimiento: i.proximo_seguimiento || q.proximo_seguimiento }, 'AerIA (chat)', 'Seguimiento: ' + String(i.que_paso).slice(0, 400), new Date().toISOString(), marca);
          if (!await guardarCot(r.cotizacion, signal)) throw new Error('No se pudo guardar el seguimiento.');
          anotarCambio(r.cotizacion, 'seguimiento', r.cambios); return { id: q.id, cliente: q.cliente, proximo_seguimiento: r.cotizacion.proximo_seguimiento };
        } },
      { name: 'cotizacion_crear', description: 'Crea una cotización nueva en el dashboard comercial. Úsala solo cuando el usuario lo pida. Monto en pesos. Líneas: ' + C.LINEAS.map(l => l.id).join(', ') + '.',
        inputSchema: { type: 'object', properties: { cliente: { type: 'string' }, monto: { type: 'number' }, descripcion: { type: 'string' }, linea: { type: 'string', enum: C.LINEAS.map(l => l.id) }, estado: { type: 'string' }, folio: { type: 'string' }, fecha_cotizacion: { type: 'string' }, fecha_cierre_estimada: { type: 'string' }, proximo_seguimiento: { type: 'string' }, contacto: { type: 'string' }, email: { type: 'string' }, telefono: { type: 'string' }, notas: { type: 'string' } }, required: ['cliente', 'monto'] },
        execute: async i => {
          avance('Creando la cotización…');
          const datosQ = Object.assign({ estado: 'enviada', fecha_cotizacion: hoy(), origen: 'chat' }, i);
          const prov = C.limpiar(datosQ);
          if (cotizacionesActuales().some(x => x.id === prov.id)) datosQ.id = prov.id + '-' + Date.now().toString(36); else datosQ.id = prov.id;
          vigente();
          const r = C.aplicar(null, datosQ, 'AerIA (chat)', 'Creada desde la conversación', new Date().toISOString(), marca);
          if (!await guardarCot(r.cotizacion, signal)) throw new Error('No se pudo guardar la cotización.');
          anotarCambio(r.cotizacion, 'creada', r.cambios); return resumenCot(C.normalizar(r.cotizacion, hoy(), 30));
        } },
      { name: 'guardar_nota', description: 'Guarda en la memoria permanente de AerIA una decisión, preferencia o dato que el usuario pidió recordar. Úsala solo si el usuario lo pide o decide algo explícitamente.',
        inputSchema: { type: 'object', properties: { texto: { type: 'string' } }, required: ['texto'] },
        execute: async i => { avance('Guardando en la memoria…'); vigente(); const n = { id: 'n' + Date.now().toString(36), texto: String(i.texto).slice(0, 600), fecha: new Date().toISOString() }; S.notas = S.notas.concat([n]); await guardar('notas'); pintarMemoria(); return { guardada: n.texto }; } },
      { name: 'buscar_movimientos', description: 'Busca movimientos de las cuentas de Aéreo (' + Object.values(M.cuentas(D0.finanzas)).join(' y ') + ', ' + D0.finanzas.serie[0].fecha + ' a ' + D0.finanzas.periodo.hasta + '). Devuelve cuántos hay, la suma con signo (+ ingreso, − egreso) y hasta 30 movimientos ordenados por monto.',
        inputSchema: { type: 'object', properties: { texto: { type: 'string', description: 'Texto a buscar en glosa, contraparte, nota o categoría (sin importar tildes)' }, categoria: { type: 'string', description: 'Código de categoría. ' + cats }, mes: { type: 'string', description: 'AAAA-MM' }, tipo: { type: 'string', enum: ['ingreso', 'egreso'] }, monto_minimo: { type: 'number' }, limite: { type: 'number' } } },
        execute: i => { avance('Consultando movimientos bancarios…'); return M.buscarMovimientos(Dt, i || {}); } },
      { name: 'ver_hallazgo', description: 'Detalle completo y acción de un hallazgo del informe financiero. Ids: ' + D0.finanzas.hallazgos.map(h => h.id).join(', ') + '.',
        inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
        execute: i => { avance('Leyendo el hallazgo…'); const q = F.plano(String(i.id || '')); const h = D0.finanzas.hallazgos.find(x => x.id === i.id || F.plano(x.titulo).includes(q)); if (!h) throw new Error('No existe ese hallazgo'); return h; } },
      { name: 'facturas_emitidas', description: 'Facturas de venta en el SII (' + rangoSII('sii') + ') con su estado de cobro y detalle del cruce con el banco y el registro interno. Filtra por texto de cliente o estado.',
        inputSchema: { type: 'object', properties: { cliente: { type: 'string' }, estado: { type: 'string' } } },
        execute: i => { avance('Revisando facturas emitidas…'); return D0.finanzas.sii.filter(s => (!i.cliente || F.plano(s.cliente).includes(F.plano(i.cliente))) && (!i.estado || F.plano(s.estado).includes(F.plano(i.estado)))); } },
      { name: 'facturas_proveedores', description: 'Registro de compras del SII (facturas de proveedores, ' + rangoSII('compras') + ') con estado de pago y medio. Filtra por proveedor o por estado de pago (ej. "sin pago").',
        inputSchema: { type: 'object', properties: { proveedor: { type: 'string' }, pago: { type: 'string' } } },
        execute: i => { avance('Revisando facturas de proveedores…'); const r = D0.finanzas.compras.filter(c => (!i.proveedor || F.plano(c.prov).includes(F.plano(i.proveedor))) && (!i.pago || F.plano(c.pago).includes(F.plano(i.pago)))); return { n: r.length, total: r.reduce((a, c) => a + c.monto, 0), facturas: r.slice(0, 40) }; } },
      { name: 'leer_plan_2027', description: 'Devuelve una sección del plan de rentabilidad 2027 con sus párrafos, listas y tablas. Secciones: ' + D0.plan.secciones.map(s => s.titulo).join(' | ') + '.',
        inputSchema: { type: 'object', properties: { seccion: { type: 'string' } }, required: ['seccion'] },
        execute: i => { avance('Leyendo el plan 2027…'); const q = F.plano(String(i.seccion || '')); const s = D0.plan.secciones.find(x => F.plano(x.titulo).includes(q)) || D0.plan.secciones.find(x => q.split(' ').some(w => w.length > 3 && F.plano(x.titulo).includes(w))); if (!s) throw new Error('No encontré esa sección'); return s; } },
      { name: 'licitaciones_abiertas', description: 'Licitaciones y compras ágiles abiertas sobre drones (Mercado Público). Filtra por encaje (capacitacion, asesoria, servicio, equipo, otro) o texto.',
        inputSchema: { type: 'object', properties: { encaje: { type: 'string' }, texto: { type: 'string' } } },
        execute: i => { avance('Revisando licitaciones…'); return I.lic.abiertas.filter(l => (!i.encaje || l.encaje === i.encaje) && (!i.texto || F.plano(l.nombre + ' ' + l.organismo).includes(F.plano(i.texto)))).map(l => ({ ...l, cierra: F.horasA(l.cierre, new Date()) })); } },
      { name: 'simular_2027', description: 'Calcula el resultado anual 2027 con el modelo del plan. Palancas (ids): ' + D0.modelo.palancas.map(p => p.id + ' ' + p.nombre).join('; ') + '. Sin palancas indicadas usa las del plan.',
        inputSchema: { type: 'object', properties: { b2b_mensual: { type: 'number' }, escuela: { type: 'string', enum: ['realista', 'llena'] }, palancas: { type: 'array', items: { type: 'string' } } }, required: ['b2b_mensual'] },
        execute: i => { avance('Simulando 2027…'); return M.resultado2027(D0.modelo, Number(i.b2b_mensual), i.escuela === 'llena' ? 'llena' : 'realista', Array.isArray(i.palancas) ? i.palancas.map(String) : undefined); } },
    ];
    // Orden de prioridad por si la vista permite menos herramientas: comercial, memoria, finanzas, plan
    return S.tools ? lista.slice(0, S.tools) : [];
  }

  function md(t) {
    const L = String(t || '').replace(/\r/g, '').split('\n');
    const inl = s => esc(s).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    const esLista = l => /^\s*[-*•]\s+/.test(l), esNum = l => /^\s*\d+[.)]\s+/.test(l), esTabla = l => /^\s*\|/.test(l), esTit = l => /^#{1,4}\s/.test(l);
    let h = '', i = 0;
    while (i < L.length) {
      const l = L[i];
      if (!l.trim()) { i++; continue; }
      if (esTit(l)) { h += '<h3>' + inl(l.replace(/^#+\s/, '')) + '</h3>'; i++; continue; }
      if (esTabla(l)) {
        const filas = []; while (i < L.length && esTabla(L[i])) filas.push(L[i++]);
        const celdas = filas.map(f => f.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim()))
          .filter(c => !c.every(x => /^:?-{2,}:?$/.test(x)));
        if (celdas.length) h += '<div class="tabla-env"><table><thead><tr>' + celdas[0].map(c => '<th>' + inl(c) + '</th>').join('') + '</tr></thead><tbody>' +
          celdas.slice(1).map(r => '<tr>' + r.map(c => '<td' + (/^[−+-]?\$?[\d.,]+%?M?$/.test(c) ? ' class="d"' : '') + '>' + inl(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>';
        continue;
      }
      if (esLista(l)) { let li = ''; while (i < L.length && esLista(L[i])) li += '<li>' + inl(L[i++].replace(/^\s*[-*•]\s+/, '')) + '</li>'; h += '<ul>' + li + '</ul>'; continue; }
      if (esNum(l)) { let li = ''; while (i < L.length && esNum(L[i])) li += '<li>' + inl(L[i++].replace(/^\s*\d+[.)]\s+/, '')) + '</li>'; h += '<ol>' + li + '</ol>'; continue; }
      const p = []; while (i < L.length && L[i].trim() && !esTit(L[i]) && !esTabla(L[i]) && !esLista(L[i]) && !esNum(L[i])) p.push(L[i++]);
      h += '<p>' + inl(p.join(' ')) + '</p>';
    }
    return h;
  }

  function renderHablar() {
    const v = $('#v-hablar');
    if (!$('#mensajes', v)) {
      v.innerHTML = `<div class="chat">
        <section class="panel conversa" aria-label="Conversación con AerIA">
          <div class="mensajes" id="mensajes" aria-live="polite"></div>
          <form class="componer" id="f-chat">
            <div id="aviso-ia"></div>
            <div class="fila"><label class="sr" for="in-chat">Mensaje para AerIA</label>
              <textarea id="in-chat" rows="2" placeholder="Pregunta, pide un análisis o dile algo que deba recordar…"></textarea>
              <button class="btn" type="submit" id="b-enviar">Enviar</button>
              <button class="btn sec" type="button" id="b-parar" data-accion="chat-parar" hidden>Detener</button></div>
            <div class="opciones"><label class="chk"><input type="checkbox" id="chk-profundo"${S.profundo ? ' checked' : ''}> Análisis profundo (más lento)</label>
              <button class="enlace-btn" type="button" data-accion="chat-limpiar">Nueva conversación</button>
              <span id="estado-ia"></span></div>
          </form>
        </section>
        <div class="lado">
          <section class="panel"><div class="panel-c"><h2>Memoria</h2><span class="bajada">Decisiones y contexto que AerIA tiene en cuenta siempre.</span></div>
            <div id="memoria"></div>
            <form class="form-nota" id="f-nota"><label class="sr" for="in-nota">Nueva nota</label><input id="in-nota" placeholder="Ej.: La meta de ventas a empresas de noviembre es $6M"><button class="btn sm" type="submit">Guardar</button></form></section>
          <section class="panel"><div class="panel-c"><h2>Lo que AerIA lee</h2></div><div id="fuentes-ia"></div></section>
        </div></div>`;
    }
    pintarMensajes(); pintarMemoria(); pintarFuentes(); pintarAvisoIA();
  }
  function pintarAvisoIA() {
    const a = $('#aviso-ia'), e = $('#estado-ia');
    if (!a) return;
    const txt = {
      cargando: '', lista: '',
      no: 'La conversación con AerIA funciona cuando abres esta página en claude.ai con tu cuenta. Aquí puedes ver todo el análisis; para preguntarle, ábrela desde claude.ai.',
      denegada: 'AerIA no tiene permiso para usar Claude en esta vista. Puedes permitirlo la próxima vez que abras la página.',
    }[S.ia] || '';
    a.innerHTML = txt ? '<div class="aviso">' + esc(txt) + '</div>' : '';
    if (e) e.textContent = S.ia === 'lista' ? (S.tools ? 'Con acceso a ' + S.tools + ' herramientas de datos' : 'Responde con el resumen de datos') : S.ia === 'cargando' ? 'Conectando…' : '';
    const b = $('#b-enviar'); if (b) b.disabled = S.ia !== 'lista' || S.enCurso;
  }
  function pintarMensajes() {
    const c = $('#mensajes'); if (!c) return;
    if (!S.chat.length) {
      c.innerHTML = `<div class="vacio-chat"><div class="ceja"><span class="iso tinta chico" aria-hidden="true"></span>AerIA</div>
        <p>Conozco tus finanzas de ${esc(I.pasado.etiqueta)}, los cursos publicados, las cotizaciones, las licitaciones abiertas y el plan 2027. Pregúntame lo que necesites para dirigir Aéreo: te respondo con cifras, te digo de dónde salen y qué haría yo.</p>
        <div class="chips">${SUGERENCIAS.map(q => `<button class="chip" type="button" data-accion="preguntar" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div></div>`;
      return;
    }
    c.innerHTML = S.chat.map((m, i) => m.role === 'user'
      ? `<div class="msj yo">${esc(m.content)}</div>`
      : `<div class="msj aeria${S.enCurso && i === S.chat.length - 1 ? ' pensando' : ''}"><span class="quien"><span class="iso" aria-hidden="true"></span>AerIA${m.profundo ? ' · análisis profundo' : ''}</span>
          <span class="herr">${esc(m.herr || '')}</span><div class="md">${m.content ? md(m.content) : ''}</div>${m.error ? '<p class="aviso">' + esc(m.error) + '</p>' : ''}${cambiosHtml(m, i)}</div>`).join('');
  }
  function cambiosHtml(m, i) {
    if (!m.cambios || !m.cambios.length) return '';
    const txt = { creada: 'creó', actualizada: 'actualizó', seguimiento: 'anotó un seguimiento en' };
    return `<div class="cambios-ia"><b>AerIA ${m.deshecho ? 'había cambiado' : 'cambió'} en Comercial:</b><ul>${m.cambios.map(c => `<li>${txt[c.tipo] || c.tipo} <button class="enlace-btn" type="button" data-com="abrir" data-id="${esc(c.id)}">${esc(c.cliente || c.id)}</button>${c.campos && c.campos.length && c.tipo !== 'creada' ? ' (' + esc(c.campos.join(', ')) + ')' : ''}</li>`).join('')}</ul>
      ${m.deshecho ? '<span class="c-sub">Cambios deshechos.</span>' : `<button class="btn sm sec" type="button" data-accion="deshacer-ia" data-i="${i}">Deshacer estos cambios</button>`}</div>`;
  }
  /* Deshace de una vez lo que AerIA cambió en esa respuesta (las entradas del historial
     marcadas con ella), aunque haya tocado dos veces la misma cotización. Si otra respuesta
     o una persona la cambió después, no la toca y lo avisa. Lo ya deshecho queda anotado
     en el mensaje (m.hechas): un reintento sigue con lo que faltó. */
  async function deshacerIA(i) {
    const m = S.chat[i]; if (!m || !m.cambios || m.deshecho || m.deshaciendo) return;
    if (!m.inicio) { avisar('Este mensaje es de una versión anterior de AerIA: revisa los cambios en Comercial → historial de cada cotización.'); return; }
    m.deshaciendo = true;
    m.hechas = m.hechas || [];
    let conflictos = 0, fallas = 0;
    const ids = Array.from(new Set(m.cambios.map(c => c.id))).filter(id => !m.hechas.includes(id));
    for (const id of ids) {
      const actual = cotizacionesActuales().find(q => q.id === id);
      if (!actual) { m.hechas.push(id); continue; }
      const r = C.deshacerPor(actual, m.inicio, new Date().toISOString());
      if (r.creada) {
        // creada en esta respuesta: deshacerla es borrarla, salvo que alguien más la haya editado
        const ajenas = (actual.historial || []).some(h => h.resp !== m.inicio && !h.deshecha && Object.keys(h.cambios || {}).length);
        if (ajenas) conflictos++; else if (await borrarCot(id)) m.hechas.push(id); else fallas++;
      } else if (r.conflicto) conflictos++;
      else if (r.nada) m.hechas.push(id);
      else if (await guardarCot(r.cotizacion)) m.hechas.push(id); else fallas++;
    }
    m.deshaciendo = false;
    m.deshecho = !conflictos && !fallas;
    guardarChat();
    pintarMensajes(); recalcular(); if (S.tab !== 'hablar') pintar();
    avisar(conflictos ? 'Deshice lo que pude; ' + conflictos + (conflictos === 1 ? ' cotización cambió' : ' cotizaciones cambiaron') + ' después (otra respuesta o alguien más) y no las toqué. Revísalas en Comercial.'
      : fallas ? 'No pude guardar ' + fallas + (fallas === 1 ? ' cambio' : ' cambios') + '. Intenta de nuevo.' : 'Listo: deshice los cambios de AerIA.');
  }
  const guardarChat = () => LS.set('chat', S.chat.slice(-40).map(m => ({ role: m.role, content: m.content, profundo: m.profundo, cambios: m.cambios, deshecho: m.deshecho, inicio: m.inicio, hechas: m.hechas })));

  function pintarMemoria() {
    const c = $('#memoria'); if (!c) return;
    c.innerHTML = S.notas.length ? S.notas.slice().reverse().map(n => `<div class="nota-mem"><span>${esc(n.texto)}<small>${esc(F.fCorta((n.fecha || '').slice(0, 10)))}</small></span><button type="button" data-accion="nota-borrar" data-id="${esc(n.id)}" aria-label="Borrar nota">×</button></div>`).join('')
      : '<p class="nota-panel" style="padding-top:12px">Aún no hay notas. Dile a AerIA «recuerda que…» o escribe una aquí.</p>';
    if (!S.db) c.insertAdjacentHTML('beforeend', '<p class="nota-panel">Se guarda solo en este navegador.</p>');
  }
  function pintarFuentes() {
    const c = $('#fuentes-ia'); if (!c) return;
    const Q = D0.cotizaciones;
    const f = [
      ['Pasado', 'Finanzas ' + I.pasado.etiqueta, 'Cartolas, SII y Mercado Pago · corte ' + F.fCorta(I.pasado.fechaCorte)],
      ['Presente', 'Cursos de aereo.cl', D0.cursos.nivel1.length + ' fechas N1 y ' + D0.cursos.niveles23.length + ' N2+N3 · commit ' + (D0.cursos.commit || '?').split(' ')[0]],
      ['Comercial', 'Cotizaciones', (I.comercial ? I.comercial.total : 0) + ' en AerIA' + (M.dashboardConectado(I.comercial) ? ' · dashboard conectado' : ' · dashboard sin conectar (agregado al ' + F.fCorta(Q.corte) + ')')],
      ['Presente', 'Licitaciones', D0.licitaciones.abiertas.length + ' abiertas al ' + (D0.licitaciones.generado_fuente || '').slice(0, 10)],
      ['Futuro', 'Plan de rentabilidad 2027', D0.plan.secciones.length + ' secciones · modelo v4 del 8-oct'],
      ['Memoria', 'Notas', S.notas.length + ' guardadas'],
    ];
    c.innerHTML = f.map(([t, n, d]) => `<div class="fuente"><span class="f-t">${t}</span><span>${esc(n)}</span><span class="f-d">${esc(d)}</span></div>`).join('');
  }

  const ERRORES = {
    rate_limited: 'Demasiadas consultas seguidas o llegaste a tu límite de uso. Intenta de nuevo en un rato.',
    session_expired: 'Tu sesión de claude.ai expiró. Vuelve a iniciar sesión y pregunta otra vez.',
    refused: 'Claude no respondió a esa pregunta. Reformúlala.',
    prompt_too_large: 'La conversación quedó demasiado larga. Empieza una nueva conversación.',
    empty_completion: 'No llegó respuesta. Pregunta de otra forma o pide menos a la vez.',
    upstream_error: 'Se cortó la conexión con Claude. Puedes volver a preguntar.',
  };
  async function preguntar(texto) {
    texto = String(texto || '').trim();
    if (!texto) return;
    if (S.tab !== 'hablar') irA('hablar');
    if (S.ia !== 'lista' || S.enCurso) { pintarAvisoIA(); const t = $('#in-chat'); if (t && S.ia !== 'lista') t.value = texto; return; }
    S.chat.push({ role: 'user', content: texto });
    const resp = { role: 'assistant', content: '', herr: 'Pensando…', profundo: S.profundo, inicio: new Date().toISOString() };
    S.chat.push(resp);
    S.enCurso = true; S.ctl = new AbortController();
    $('#b-parar').hidden = false; pintarAvisoIA(); pintarMensajes(); $('#iso-banda').classList.add('gira');
    $('#mensajes').lastElementChild.scrollIntoView({ block: 'end', behavior: 'smooth' });
    const contexto = REGLAS + '\n\n' + M.resumenParaIA(datos(), I);
    let turnos = S.chat.slice(0, -1).filter(m => m.content).map(m => ({ role: m.role, content: m.content }));
    while (turnos.length > 16) turnos = turnos.slice(2);
    while (turnos.length && turnos[0].role !== 'user') turnos.shift();
    const entrada = [{ role: 'user', content: contexto }].concat(turnos);
    const opciones = { signal: S.ctl.signal, modelTier: S.profundo ? 'complex' : 'default', onText: ({ text }) => { resp.content = text; resp.herr = ''; actualizarUltimo(); } };
    const tools = herramientas(resp, S.ctl.signal);
    if (tools.length) opciones.tools = tools; else opciones.cache = false;
    try {
      const r = await S.sample(entrada, opciones);
      resp.content = r.text; resp.herr = r.truncated ? 'Respuesta cortada por largo: pide menos a la vez.' : '';
    } catch (e) {
      resp.content = e && e.text ? e.text : resp.content;
      resp.herr = '';
      if (e && e.code === 'cancelled') resp.herr = 'Detenida.';
      else if (e && ['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed'].includes(e.code)) { S.ia = 'denegada'; resp.error = 'AerIA no tiene permiso para usar Claude en esta vista.'; }
      else if (e && e.code === 'tools_unavailable') { S.tools = 0; resp.error = 'Esta vista no permite que AerIA consulte el detalle. Vuelve a preguntar: responderá con el resumen.'; }
      else resp.error = ERRORES[e && e.code] || ERRORES.upstream_error;
      if (!resp.content) resp.content = '';
    } finally {
      S.enCurso = false; S.ctl = null;
      $('#b-parar').hidden = true; $('#iso-banda').classList.remove('gira');
      if (!resp.content && !resp.error && !resp.herr) S.chat.pop();
      guardarChat();
      if (resp.cambios && resp.cambios.length) recalcular();
      pintarMensajes(); pintarAvisoIA();
    }
  }
  function actualizarUltimo() {
    const ult = $('#mensajes .msj.aeria:last-child'); const m = S.chat[S.chat.length - 1];
    if (!ult || !m) return pintarMensajes();
    $('.md', ult).innerHTML = md(m.content); $('.herr', ult).textContent = m.herr || '';
  }

  /* ========================================================================
     EVENTOS
     ======================================================================== */
  function pintar() {
    recalcular(); renderBanda();
    ({ mando: renderMando, pasado: renderPasado, presente: renderPresente, comercial: () => COM && COM.render(), futuro: renderFuturo, hablar: renderHablar })[S.tab]();
    renderPie();
  }

  document.addEventListener('click', async ev => {
    const t = ev.target.closest('[data-tab],[data-accion]');
    if (!t) return;
    if (t.dataset.tab && !t.dataset.accion) { irA(t.dataset.tab); return; }
    const a = t.dataset.accion, id = t.dataset.id;
    if (a === 'filtro-alertas') { S.filtroAlertas = t.dataset.valor; renderMando(); }
    else if (a === 'resolver') {
      const r = S.alertas[id] && S.alertas[id].estado === 'resuelta';
      S.alertas = Object.assign({}, S.alertas); if (r) delete S.alertas[id]; else S.alertas[id] = { estado: 'resuelta', fecha: new Date().toISOString() };
      S.abiertas.delete(id); pintar(); guardar('alertas');
    } else if (a === 'preguntar') preguntar(t.dataset.q);
    else if (a === 'ir-detalle') {
      // «Ver los números»: abre la sección exacta de la pestaña y baja hasta ella
      const capa = t.dataset.capa, ancla = t.dataset.ancla, filtro = t.dataset.filtro;
      if (capa) { S.pasos.add('capa-' + capa); LS.set('pasos', [...S.pasos].slice(-80)); }
      if (filtro && S.comUI) S.comUI.filtro = filtro;
      if (t.dataset.tabIr === S.tab) pintar(); else irA(t.dataset.tabIr, false);
      const el = ancla ? document.getElementById(ancla) : capa ? $('[data-paso="capa-' + capa + '"]') : null;
      if (el) el.scrollIntoView({ block: 'start' }); else window.scrollTo(0, 0);
    } else if (a === 'ver-tema' || a === 'ver-semaforo') {
      // baja a una pregunta (o a la primera de un color) y abre el paso pedido
      const el = a === 'ver-tema' ? $('#tema-' + id) : $('.tema[data-semaforo="' + id + '"]');
      if (el) {
        const n = t.dataset.pasoN || (a === 'ver-tema' ? '2' : '');
        if (n) { const d = el.querySelector('details[data-paso$="-' + n + '"]'); if (d && !d.open) d.open = true; }
        el.scrollIntoView({ block: 'start' });
      }
    }
    else if (a === 'preguntar-alerta') {
      const al = I.alertas.find(x => x.id === id);
      if (al) preguntar('Explícame la alerta «' + al.titulo + '»: qué significa para Aéreo, qué tan grave es y qué hago exactamente, paso a paso.');
    } else if (a === 'filtro-lic') { S.filtroLic = t.dataset.valor; renderPresente(); }
    else if (a === 'sim-set') { simEstado().b2b = Number(t.dataset.valor); const r = $('#sim-b2b'); if (r) r.value = S.sim.b2b; pintarSim(); }
    else if (a === 'sim-escuela') { simEstado().escuela = t.dataset.valor; for (const b of $$('[data-accion="sim-escuela"]')) b.setAttribute('aria-pressed', String(b === t)); pintarSim(); }
    else if (a === 'nota-borrar') { S.notas = S.notas.filter(n => n.id !== id); pintarMemoria(); pintarFuentes(); guardar('notas'); }
    else if (a === 'viene-todo') { S.vieneTodo = true; $('#viene').innerHTML = vieneHtml(); }
    else if (a === 'agenda-todas') { S.agendaTodas = true; $('#agenda').innerHTML = agendaHtml(); }
    else if (a === 'chat-parar') { if (S.ctl) S.ctl.abort(); }
    else if (a === 'chat-limpiar') { if (S.ctl) S.ctl.abort(); S.chat = []; LS.set('chat', []); pintarMensajes(); }
    else if (a === 'deshacer-ia') deshacerIA(Number(t.dataset.i));
  });
  document.addEventListener('change', async ev => {
    const t = ev.target;
    if (t.dataset.accion === 'agenda') {
      // una casilla puede marcar varias tareas (las llamadas a un cliente, un grupo de facturas)
      S.agenda = Object.assign({}, S.agenda);
      const ids = t.dataset.id.split(',').filter(Boolean), ahora = new Date().toISOString();
      for (const id of ids) { if (t.checked) S.agenda[id] = { hecho: true, fecha: ahora }; else delete S.agenda[id]; }
      // las otras casillas de las mismas tareas (en la portada, en cada pregunta y en la lista) se ponen al día sin repintar todo
      for (const c of $$('input[data-accion="agenda"]')) {
        if (c === t) continue;
        const cid = c.dataset.id.split(',');
        if (cid.some(x => ids.includes(x))) { c.checked = cid.every(hecho); const li = c.closest('.ag-item, li'); if (li) li.classList.toggle('hecho', c.checked); }
      }
      const li = t.closest('.ag-item, li'); if (li) li.classList.toggle('hecho', t.checked);
      if ($('#agenda') && !$('#agenda').contains(t)) $('#agenda').innerHTML = agendaHtml();
      guardar('agenda');
    } else if (t.dataset.accion === 'sim-palanca') {
      const sim = simEstado(); sim.palancas = t.checked ? sim.palancas.concat([t.dataset.id]) : sim.palancas.filter(p => p !== t.dataset.id); pintarSim();
    } else if (t.id === 'chk-profundo') S.profundo = t.checked;
  });
  document.addEventListener('input', ev => {
    if (ev.target.id === 'sim-b2b') { simEstado().b2b = Number(ev.target.value); pintarSim(); }
  });
  // glosario: la explicación aparece al pasar el cursor o al llegar con el teclado
  const verGlosa = (ev, el) => { const k = el.dataset.glosa; if (!GLOSARIO[k]) return; const r = el.getBoundingClientRect(); verTip(ev.clientX != null ? ev : { clientX: r.left, clientY: r.bottom }, '<div class="tt">' + esc(k.replace(/^./, c => c.toUpperCase())) + '</div>' + esc(GLOSARIO[k])); };
  document.addEventListener('mouseover', ev => { const el = ev.target.closest && ev.target.closest('dfn.glosa'); if (el) verGlosa(ev, el); });
  document.addEventListener('mouseout', ev => { if (ev.target.closest && ev.target.closest('dfn.glosa')) ocultarTip(); });
  document.addEventListener('focusin', ev => { const el = ev.target.closest && ev.target.closest('dfn.glosa'); if (el) verGlosa({}, el); });
  document.addEventListener('focusout', ev => { if (ev.target.closest && ev.target.closest('dfn.glosa')) ocultarTip(); });
  document.addEventListener('toggle', ev => {
    const d = ev.target; if (!(d instanceof HTMLDetailsElement)) return;
    // los pasos abiertos se recuerdan en este navegador
    if (d.dataset.paso) { if (d.open) S.pasos.add(d.dataset.paso); else S.pasos.delete(d.dataset.paso); LS.set('pasos', [...S.pasos].slice(-80)); return; }
    if (!d.dataset.id) return;
    if (d.open) S.abiertas.add(d.dataset.id); else S.abiertas.delete(d.dataset.id);
  }, true);
  document.addEventListener('submit', ev => {
    ev.preventDefault();
    if (ev.target.id === 'f-pregunta') { const i = $('#in-pregunta'); const q = i.value; i.value = ''; preguntar(q); }
    else if (ev.target.id === 'f-chat') { const i = $('#in-chat'); const q = i.value; if (S.ia === 'lista' && !S.enCurso) i.value = ''; preguntar(q); }
    else if (ev.target.id === 'f-nota') {
      const i = $('#in-nota'); const txt = i.value.trim(); if (!txt) return;
      S.notas = S.notas.concat([{ id: 'n' + Date.now().toString(36), texto: txt.slice(0, 600), fecha: new Date().toISOString() }]);
      i.value = ''; pintarMemoria(); pintarFuentes(); guardar('notas');
    }
  });
  document.addEventListener('keydown', ev => {
    if (ev.target.id === 'in-chat' && ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); $('#f-chat').requestSubmit(); }
  });

  /* ========================================================================
     ARRANQUE
     ======================================================================== */
  const COM = window.AeriaComercialUI ? window.AeriaComercialUI({
    S, $, $$, esc, F, C, M, I: () => I, pintar, verTip, ocultarTip, avisar, enSimpleHtml, capa,
    cotizaciones: cotizacionesActuales, guardarCot, borrarCot,
    persistencia: () => S.db ? 'db' : (window.claude ? 'conectando con la base…' : 'se guarda solo en este navegador'),
    preguntar: q => preguntar(q), puedeIA: () => S.ia === 'lista' && !!S.sample,
    iaJSON: async prompt => {
      try { return await S.sample.json(prompt, { modelTier: 'quick' }); }
      catch (e) {
        const c = e && e.code;
        if (['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed'].includes(c)) { S.ia = 'denegada'; pintarAvisoIA(); const err = new Error('AerIA no tiene permiso para usar Claude en esta vista. Usa «Leer»: no lo necesita.'); err.iaCodigo = c; throw err; }
        const err = new Error(c === 'invalid_json' ? 'AerIA no pudo leerlo como tabla. Prueba con el CSV del dashboard.' : (ERRORES[c] || 'No se pudo ordenar ahora.'));
        err.iaCodigo = c || '';   // el código de Claude va aparte: «code» se reserva para los errores del navegador
        throw err;
      }
    },
    descargas: async () => (window.claude && typeof window.claude.use === 'function') ? window.claude.use('downloads') : null,
    permisos: async () => (window.claude && typeof window.claude.use === 'function') ? window.claude.use('permissions') : null,
    // conexión automática con el dashboard local (navegador integrado de la app de escritorio)
    mcp: () => S.mcp || null,
    syncEstado: () => S.syncDash || null,
    guardarSync: async d => { S.syncDash = d; if (S.db) { try { await S.db.doc('estado/sync_dashboard').set(d); } catch (e) { console.warn('AerIA: no se pudo guardar la sincronización', e); } } else LS.set('sync_dashboard', d); },
    urlDashboard: async () => {
      if (S.urlDash) return S.urlDash;
      let u = '';
      try { if (S.db) { const f = await S.db.doc('config/fuentes').get(); u = (f.exists && f.data().cotizaciones_local) || ''; } } catch (e) { /* sin config */ }
      return (S.urlDash = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(u) ? u : 'http://localhost:8765/_Dashboard/dashboard.html');
    },
    listoParaSync: () => !!(S.mcp && S.db && S.comCargado && S.syncCargado && S.ia !== 'cargando'),
  }) : null;
  const intentarSync = () => { if (COM && COM.autoSync) COM.autoSync(); };
  const inicial = (location.hash || '').replace('#', '');
  if (VISTAS.includes(inicial)) S.tab = inicial;
  irA(S.tab, false);
  window.addEventListener('hashchange', () => {
    const t = (location.hash || '').replace('#', '');
    if (t !== S.tab && VISTAS.includes(t)) irA(t);
  });

  if (window.claude && typeof window.claude.use === 'function') {
    window.claude.use('sample').then(async s => {
      S.sample = s;
      if (!s) { S.ia = 'no'; pintarAvisoIA(); intentarSync(); return; }
      const lim = await s.limits().catch(() => null);
      S.tools = lim && lim.tools ? Math.min(lim.tools.maxCount || 0, 14) : 0;
      S.ia = 'lista'; pintarAvisoIA();
      if (S.tab === 'comercial') pintar();
      intentarSync();
    }).catch(() => { S.ia = 'no'; pintarAvisoIA(); intentarSync(); });
    window.claude.use('mcp').then(m => { S.mcp = m; intentarSync(); }).catch(() => { S.mcp = null; });
    window.claude.use('db').then(db => {
      if (!db) return;
      S.db = db;
      for (const [k, ruta] of Object.entries(DOCS)) {
        db.doc(ruta).onSnapshot(snap => {
          if (snap.metadata && snap.metadata.hasPendingWrites) return;
          S[k] = deCuerpo(k, snap.exists ? snap.data() : null);
          if (k === 'notas') { pintarMemoria(); pintarFuentes(); if (S.tab !== 'hablar') pintar(); }
          else if (S.tab !== 'hablar') pintar();
        }, e => console.warn('AerIA: suscripción', k, e && e.code));
      }
      db.collection('cotizaciones').limit(1000).onSnapshot(snap => {
        if (snap.metadata && snap.metadata.hasPendingWrites && S.comCargado) return;
        S.comDocs = new Map(snap.docs.map(d => [d.id, d.data()]));
        S.comCargado = true;
        recalcular();
        if (S.tab !== 'hablar') pintar(); else pintarFuentes();
        intentarSync();
      }, e => { console.warn('AerIA: suscripción a cotizaciones', e && e.code); avisar('No pude leer las cotizaciones de la base. Muestro las del paquete.'); });
      db.doc('estado/sync_dashboard').onSnapshot(snap => {
        if (snap.metadata && snap.metadata.hasPendingWrites) return;
        S.syncDash = snap.exists ? snap.data() : null; S.syncCargado = true;
        if (COM && COM.pintarSync) COM.pintarSync();
        intentarSync();
      }, () => { S.syncCargado = true; intentarSync(); });
      if (S.tab === 'comercial') pintar();
    });
  } else { S.ia = 'no'; pintarAvisoIA(); }
})();
