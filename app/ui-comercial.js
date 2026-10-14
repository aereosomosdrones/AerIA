/* =============================================================================
   AerIA · PESTAÑA COMERCIAL
   El dashboard comercial dentro de AerIA: cotizaciones editables (una por
   documento en la base de la página), embudo, pronóstico de venta B2B, lo
   ganado, acciones, importador desde el dashboard local y exportación.
   La lógica vive en comercial.js; aquí solo se dibuja y se edita.
   ui.js crea este módulo con AeriaComercialUI(ctx) antes de pintar.
   ============================================================================= */
(function () {
  'use strict';
  window.AeriaComercialUI = function (ctx) {
    const { $, $$, esc, F, C } = ctx;
    const S = ctx.S;
    const L = (S.comUI = S.comUI || { filtro: 'abiertas', linea: '', texto: '', orden: 'monto', ver: 40, editor: null, borrar: false, imp: null });
    const hoy = () => F.iso(new Date());
    const ahoraISO = () => new Date().toISOString();
    const R = () => ctx.I().comercial;
    const opciones = (lista, actual, vacio) => (vacio != null ? `<option value="">${esc(vacio)}</option>` : '') +
      lista.map(o => `<option value="${esc(o.id)}"${o.id === actual ? ' selected' : ''}>${esc(o.label)}</option>`).join('');
    const ESTADO_PILL = { borrador: '', enviada: 'media', negociacion: 'oportunidad', ganada: 'bien', perdida: 'critica', vencida: '' };
    const fechaCorta = s => s ? F.fCorta(s) : '—';
    // cómo se nombra cada campo ante la persona (historial, cambios del importador y choques): las claves no cambian
    const ETQ = { cliente: 'Cliente', rut: 'RUT', contacto: 'Persona de contacto', email: 'Correo', telefono: 'Teléfono', folio: 'N° de cotización',
      linea: 'Tipo de venta', descripcion: 'Qué se cotizó', monto: 'Monto', monto_tipo: '¿Incluye IVA?', estado: 'En qué va', probabilidad: 'Qué tan seguro (%)',
      fecha_cotizacion: 'Día que se cotizó', fecha_cierre_estimada: 'Cuándo debería decidir', fecha_cierre: 'Día que respondió', fecha_ejecucion: 'Día del curso o servicio',
      proximo_seguimiento: 'Próxima llamada', ultimo_contacto: 'Última vez que hablaron', factura_folio: 'N° de factura', cobrada: '¿Ya pagó?',
      motivo_perdida: 'Por qué se perdió', notas: 'Notas', origen: 'De dónde salió', evidencia: 'Respaldo', confianza: 'Confianza' };
    const IVA = [{ id: 'neto', label: 'No, hay que sumarle IVA' }, { id: 'exento', label: 'No lleva IVA (exento)' }, { id: 'con_iva', label: 'Sí, ya incluye IVA' }, { id: 'desconocido', label: 'No sé' }];
    const COBRO = [{ id: 'si', label: 'Sí' }, { id: 'no', label: 'No' }, { id: 'parcial', label: 'Una parte' }, { id: 'desconocido', label: 'No sé' }];
    const etq = k => ETQ[k] || k;
    const valorLegible = (k, v) => {
      const s = v == null ? '' : String(v);
      if (!s) return '—';
      const de = lista => (lista.find(o => o.id === s) || {}).label || s;
      if (k === 'estado') return (C.ESTADO[s] || {}).label || s;
      if (k === 'linea') return (C.LINEA[s] || {}).label || s;
      if (k === 'monto_tipo') return de(IVA);
      if (k === 'cobrada') return de(COBRO);
      if (k === 'monto' && /^\d+(\.\d+)?$/.test(s)) return F.clp(Number(s));
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return F.fCorta(s);
      return s;
    };
    // quién hizo un cambio del historial, dicho en simple (el valor guardado no cambia)
    const QUIEN = { usuario: 'tú', dashboard: 'tu dashboard', 'importación': 'importación', 'AerIA (siembra)': 'AerIA, al armarla', deshacer: 'al deshacer' };
    // las horas del historial se guardan en UTC: se muestran en la hora de este computador
    const cuandoFue = f => {
      const s = String(f || '');
      if (!s) return '';
      if (s.length <= 10) return F.fCorta(s);
      const d = new Date(s);
      if (isNaN(d.getTime())) return s.slice(0, 16).replace('T', ' ');
      return F.fCorta(F.iso(d)) + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    };

    /* ---------------- vista principal ---------------- */
    function render() {
      const v = $('#v-comercial');
      const Rc = R();
      if (!Rc) { v.innerHTML = '<p class="panel-b mudo">Las ventas no se pueden mostrar en esta versión de AerIA.</p>'; return; }
      // un cambio que llega de la base repinta todo: se conserva el foco, lo escrito y el importador en curso
      const act = document.activeElement, idAct = act && act.id && v.contains(act) ? act.id : '';
      const filaAct = act && act.classList && act.classList.contains('fila-cot') && v.contains(act) ? act.dataset.id : '';
      const sel = idAct && typeof act.selectionStart === 'number' ? [act.selectionStart, act.selectionEnd] : null;
      const impVivo = L.imp && L.imp.guardando ? $('#panel-importar') : null;
      const conectado = ctx.M.dashboardConectado(Rc);
      const cot = ctx.I().cot;
      const kp = (l, val, s, cls) => `<div class="panel kpi"><span class="k-l">${l}</span><span class="k-v ${cls || ''}">${val}</span><span class="k-s">${s}</span></div>`;
      const f0 = Rc.pronostico.meses[0];
      const Ps = (ctx.I().simple || {}).pestanas || {};
      v.innerHTML = `
        ${Ps.comercial && ctx.enSimpleHtml ? ctx.enSimpleHtml({ texto: Ps.comercial.texto, datos: Ps.comercial.datos }) : ''}
        ${conectado ? '' : avisoConexion(cot, Rc)}
        <div class="grilla g-7-5 arriba">
          <section class="panel" id="panel-cotizaciones"><div class="panel-c"><h2>Cotizaciones</h2><span class="bajada">${Rc.total} en AerIA${ctx.persistencia() === 'db' ? ' · las ve todo el equipo' : ' · ' + esc(ctx.persistencia())}. Toca una para ver su ficha.</span>
              <span class="acc"><button class="btn sm" type="button" data-com="nueva">Nueva cotización</button><button class="btn sm sec" type="button" data-com="importar">Importar</button><button class="btn sm sec" type="button" data-com="exportar">Exportar CSV</button></span></div>
            ${conectado ? `<div class="panel-b sync" data-sync>${syncHtml()}</div>` : ''}
            <div class="panel-b" style="padding-bottom:10px">${filtrosHtml(Rc)}</div>
            <div class="panel-b ras" id="tabla-cot">${tablaHtml(Rc)}</div></section>
          <div class="lado">
            <section class="panel" id="panel-mover"><div class="panel-c"><h2>Tus pendientes</h2><span class="bajada">Llamadas, clientes que ya debían decidir y facturas por emitir. Toca uno para abrirlo.</span></div>
              <div class="agenda">${accionesHtml(Rc)}</div></section>
          </div>
        </div>
        <section class="panel" id="panel-importar"${L.imp ? '' : ' hidden'}>${L.imp ? importadorHtml() : ''}</section>
        ${(ctx.capa || ((id, t, b, c) => c))('com-numeros', 'Los números de las ventas', 'Lo que se espera vender cada mes, en qué va cada cotización y lo que ya vendiste.', `
        <div class="grilla g-5">
          ${kp('Esperando respuesta', F.mm(Rc.abiertas.monto), Rc.abiertas.n + ' cotizaciones · lo probable: ' + F.mm(Rc.abiertas.ponderado))}
          ${kp('Vendido en los últimos 90 días', F.mm(Rc.ganadas.ultimos90), F.mm(Rc.ganadas.anio) + ' en lo que va del año · ' + Rc.ganadas.n + ' ventas en total')}
          ${kp('Se espera vender a empresas en ' + esc(F.mesNombre(f0.mes)), F.mm(f0.total), conectado ? 'para no perder plata: ' + F.mm(f0.equilibrio || 0) + ' · meta: ' + F.mm(f0.meta || 0) : 'incompleto: falta conectar tu dashboard', conectado && f0.equilibrio && f0.total < f0.equilibrio ? 'mal' : '')}
          ${Rc.tasa.referencia
            ? kp('Cuánto se gana de lo cotizado', F.pct(Rc.tasa.referencia.valor), 'contado en pesos · según tu dashboard al ' + esc(F.fCorta(Rc.tasa.referencia.corte)))
            : kp('Cuánto se gana de lo cotizado', Rc.tasa.monto != null ? F.pct(Rc.tasa.monto) : '—', Rc.tasa.muestra ? 'contado en pesos, último año · de ' + Rc.tasa.muestra + ' que ya tienen respuesta' : 'aún no hay cotizaciones con respuesta')}
          ${kp('Lo que tarda una venta', Rc.ciclo != null ? Math.round(Rc.ciclo) + ' días' : '—', Rc.ganadas.ticket ? 'venta promedio ' + F.mm(Rc.ganadas.ticket) : 'desde que cotizas hasta el sí')}
        </div>
        <div class="grilla g-2">
          <section class="panel"><div class="panel-c"><h2>Lo que se espera vender a empresas</h2><span class="bajada">Mes a mes: lo ya vendido más lo probable de lo cotizado (cada cotización cuenta según qué tan segura es). Las líneas marcan lo mínimo para no perder plata y la meta del plan 2027.</span></div>
            <div class="panel-b"><div class="grafico" id="g-pronostico"></div></div>
            ${conectado ? '' : '<p class="nota-panel"><b>Ojo: este gráfico está incompleto.</b> Solo ve las cotizaciones cargadas aquí; las de tu dashboard todavía no. Por eso no lo uso para avisarte ni para calcular 2027 hasta que lo conectes.</p>'}
            ${Rc.pronostico.sinFechaEstimada ? `<p class="nota-panel">${Rc.pronostico.sinFechaEstimada} cotizaciones no dicen cuándo decidiría el cliente: las ubico según lo que ${Rc.ciclo != null ? 'suele tardar una venta (' + Math.round(Rc.ciclo) + ' días)' : 'podría tardar una venta (un supuesto de 30 días)'}.</p>` : ''}
            ${Rc.abiertas.estancadas ? `<p class="nota-panel">${Rc.abiertas.estancadas === 1 ? 'Una cotización está dormida' : Rc.abiertas.estancadas + ' cotizaciones están dormidas'} (${F.mm(Rc.abiertas.montoEstancadas)}): más de 90 días sin contacto, o antiguas y sin fecha de decisión. No las cuento en lo que se espera vender hasta que las retomes.</p>` : ''}</section>
          <section class="panel"><div class="panel-c"><h2>En qué etapa están</h2><span class="bajada">Cuántas cotizaciones hay en cada etapa y por cuánto.</span></div>
            <div class="panel-b ras">${embudoHtml(Rc)}</div>
            <div class="panel-b ras">${lineasHtml(Rc)}</div></section>
        </div>
        <section class="panel"><div class="panel-c"><h2>Lo que ya vendiste</h2><span class="bajada">Mes a mes, según cuándo el cliente dijo que sí.</span></div>
          <div class="panel-b ras">${ganadoHtml(Rc)}</div></section>`)}`;
      if (impVivo) $('#panel-importar').replaceWith(impVivo);
      graficoPronostico($('#g-pronostico'), Rc);
      if (filaAct) { const f = $$('.fila-cot').find(r => r.dataset.id === filaAct); if (f) f.focus({ preventScroll: true }); }
      if (idAct) {
        const el = document.getElementById(idAct);
        if (el) { el.focus({ preventScroll: true }); if (sel && el.setSelectionRange) try { el.setSelectionRange(sel[0], sel[1]); } catch (e) { /* no todos los campos tienen selección */ } }
      }
      if (L.editor && !$('#modal-com')) pintarEditor();
    }

    function avisoConexion(cot, Rc) {
      return `<section class="panel conectar"><div class="panel-c"><h2>Conecta tu dashboard comercial</h2>
          <span class="bajada">Lo último que sé de tu dashboard es del ${esc(F.fCorta(cot.corte))}: ${F.mm(cot.abiertasMonto)} en cotizaciones esperando respuesta${cot.tasaCierre ? ', y se ganaba el ' + F.pct(cot.tasaCierre) + ' de lo cotizado' : ''}.${Rc.total ? ' Abajo están las ' + Rc.total + ' que ya reuní desde el SII, el banco, Notion y el plan.' : ''}</span></div>
        <div class="panel-b sync" data-sync>${syncHtml()}</div>
        <div class="panel-b pasos">
          <div class="paso"><b>1</b><div><p>¿No usas la app de escritorio de Claude? Arrastra este botón a tu barra de marcadores.</p><a class="btn sm marcador" href="javascript:${esc(C.EXTRACTOR)}" data-com="marcador" title="Arrástrame a la barra de marcadores">AerIA · Extraer</a>
            <p class="c-sub">¿No ves la barra? En Chrome, aprieta Cmd+Shift+B. Otra forma, más técnica: <button class="enlace-btn" type="button" data-com="copiar-extractor">copiar el código</button> y pegarlo en la consola del dashboard.</p></div></div>
          <div class="paso"><b>2</b><div><p>Abre tu dashboard (<span class="mono">localhost:8765/_Dashboard/dashboard.html</span>) y haz clic en el marcador. Se copian tus cotizaciones.</p></div></div>
          <div class="paso"><b>3</b><div><p>Vuelve aquí y pega con Cmd+V en el importador. También sirve una planilla de Excel guardada como CSV.</p>
            <button class="btn sm" type="button" data-com="importar">Abrir el importador</button></div></div>
        </div></section>`;
    }

    function embudoHtml(Rc) {
      const max = Math.max(1, ...Rc.embudo.map(e => e.monto));
      const color = id => id === 'ganada' ? '--s-3' : (id === 'perdida' || id === 'vencida') ? '--s-neutro' : '--s-1';
      return Rc.embudo.map(e => `<div class="hbar"><span class="h-l">${esc(e.label)}<small>${e.n}</small></span>
        <span class="h-p"><i style="width:${(e.monto / max * 100).toFixed(1)}%;background:var(${color(e.id)})"></i></span><span class="h-v">${F.mm(e.monto)}</span></div>`).join('');
    }
    function lineasHtml(Rc) {
      if (!Rc.porLinea.length) return '';
      const tasa = !Rc.tasa.referencia; // con el dashboard sin conectar, la tasa por línea sale sesgada: no se muestra
      return `<div class="tabla-env"><table><thead><tr><th>Tipo de venta</th><th class="d">Esperando respuesta</th><th class="d">Vendido</th>${tasa ? '<th class="d">Se gana</th>' : ''}</tr></thead><tbody>
        ${Rc.porLinea.map(l => `<tr><td>${esc(l.label)}${l.b2b ? '' : ' <span class="c-sub">(no cuenta para la meta de ventas a empresas)</span>'}</td><td class="d">${F.mm(l.abierto)}</td><td class="d">${F.mm(l.ganado)}</td>${tasa ? `<td class="d">${l.tasa != null ? F.pct(l.tasa) : '—'}</td>` : ''}</tr>`).join('')}
        </tbody></table></div>`;
    }
    function filtrosHtml(Rc) {
      const n = id => Rc.cotizaciones.filter(q => id === 'abiertas' ? q.abierta : id === 'perdidas' ? (q.estado === 'perdida' || q.estado === 'vencida') : id === 'todas' ? true : q.estado === id).length;
      const ops = [['abiertas', 'Esperando respuesta'], ['ganada', 'Ganadas'], ['perdidas', 'Perdidas'], ['todas', 'Todas']];
      return `<div class="filtros-com">
        <div class="chips" role="group" aria-label="Filtrar cotizaciones">${ops.map(([k, t]) => `<button class="chip" type="button" data-com="filtro" data-valor="${k}" aria-pressed="${L.filtro === k}">${t}<span class="n">${n(k)}</span></button>`).join('')}</div>
        <div class="fila-filtros">
          <label class="sr" for="com-buscar">Buscar cotización</label><input id="com-buscar" type="search" placeholder="Busca por cliente, N° o lo que se cotizó" value="${esc(L.texto)}" data-com-input="texto">
          <label class="sr" for="com-linea">Tipo de venta</label><select id="com-linea" data-com-input="linea">${opciones(C.LINEAS, L.linea, 'Todos los tipos de venta')}</select>
          <label class="sr" for="com-orden">Ordenar</label><select id="com-orden" data-com-input="orden">
            ${[['monto', 'Mayor monto'], ['reciente', 'Más recientes'], ['seguimiento', 'Próxima llamada'], ['cierre', 'Fecha de decisión'], ['cliente', 'Cliente A–Z']].map(([k, t]) => `<option value="${k}"${L.orden === k ? ' selected' : ''}>${t}</option>`).join('')}</select>
        </div></div>`;
    }
    function filtradas(Rc) {
      const t = F.plano(L.texto);
      let l = Rc.cotizaciones.filter(q => L.filtro === 'abiertas' ? q.abierta : L.filtro === 'perdidas' ? (q.estado === 'perdida' || q.estado === 'vencida') : L.filtro === 'todas' ? true : q.estado === L.filtro);
      if (L.linea) l = l.filter(q => q.linea === L.linea);
      if (t) l = l.filter(q => F.plano([q.cliente, q.folio, q.descripcion, q.contacto, q.notas, q.rut].join(' ')).includes(t));
      const fecha = q => q.fecha_cierre || q.fecha_cotizacion || (q.actualizada || '').slice(0, 10) || '';
      const orden = {
        monto: (a, b) => (b.monto || 0) - (a.monto || 0),
        reciente: (a, b) => fecha(b).localeCompare(fecha(a)),
        seguimiento: (a, b) => (a.proximo_seguimiento || '9999').localeCompare(b.proximo_seguimiento || '9999'),
        cierre: (a, b) => (a.cierreEstimado || a.fecha_cierre || '9999').localeCompare(b.cierreEstimado || b.fecha_cierre || '9999'),
        cliente: (a, b) => String(a.cliente).localeCompare(String(b.cliente), 'es'),
      }[L.orden];
      return l.sort(orden);
    }
    function tablaHtml(Rc) {
      const l = filtradas(Rc);
      if (!l.length) return `<p class="panel-b mudo">${Rc.total ? 'No hay cotizaciones con lo que elegiste.' : 'Todavía no hay cotizaciones. Créalas con «Nueva cotización» o tráelas desde tu dashboard con «Importar».'}</p>`;
      const vis = l.slice(0, L.ver);
      const total = l.reduce((a, q) => a + (q.valor || 0), 0); // neto, igual que los KPI
      return `<div class="tabla-env"><table class="tabla-cot"><thead><tr><th>Cliente y qué se cotizó</th><th class="d">Monto</th><th>En qué va</th><th>Próxima llamada</th></tr></thead><tbody>
        ${vis.map(q => `<tr class="fila-cot" data-com="abrir" data-id="${esc(q.id)}" tabindex="0">
          <td class="ancho"><div class="c-main">${esc(q.cliente || 'Sin cliente')}</div><div class="c-sub">${esc([q.folio ? 'N° ' + q.folio : '', q.lineaLabel, q.descripcion].filter(Boolean).join(' · ').slice(0, 160))}</div></td>
          <td class="d">${F.clp(q.monto || 0)}${q.monto_tipo === 'con_iva' ? '<div class="c-sub">con IVA</div>' : ''}${q.abierta ? `<div class="c-sub">${q.estancada ? 'dormida: no la cuento' : Math.round(q.prob * 100) + '% · lo probable: ' + F.mm(q.ponderado)}</div>` : ''}${!q.monto ? '<div class="c-sub">monto por completar</div>' : ''}</td>
          <td class="nw"><label class="sr" for="est-${esc(q.id)}">En qué va la cotización de ${esc(q.cliente)}</label><select id="est-${esc(q.id)}" class="sel-estado ${ESTADO_PILL[q.estado] || ''}" data-com-estado="${esc(q.id)}">${opciones(C.ESTADOS, q.estado)}</select>
            ${q.estado === 'ganada' ? `<div class="c-sub">${q.factura_folio ? 'Factura N° ' + esc(q.factura_folio) + (q.cobrada === 'si' ? ' · ya pagó' : '') : 'Sin factura anotada'}</div>` : ''}</td>
          <td class="nw">${q.abierta ? (q.proximo_seguimiento ? `<span class="pill${q.seguimientoVencido ? ' critica' : ''}">${esc(fechaCorta(q.proximo_seguimiento))}${q.seguimientoVencido ? ' · atrasada' : ''}</span>` : '<span class="c-sub">sin llamada agendada</span>') +
            (q.diasSinContacto != null ? `<div class="c-sub">último contacto hace ${q.diasSinContacto} ${q.diasSinContacto === 1 ? 'día' : 'días'}</div>` : '') : `<span class="c-sub">${q.fecha_cierre ? (q.estado === 'vencida' ? 'venció el ' : 'respondió el ') + esc(fechaCorta(q.fecha_cierre)) : '—'}</span>`}</td></tr>`).join('')}
        </tbody><tfoot><tr><td style="font-weight:700">${l.length} cotizaciones</td><td class="d" style="font-weight:700">${F.clp(total)}<div class="c-sub">sin IVA</div></td><td colspan="2"></td></tr></tfoot></table></div>
        ${l.length > L.ver ? `<div class="pie-lista"><button class="enlace-btn" type="button" data-com="ver-mas">Ver ${Math.min(40, l.length - L.ver)} más (quedan ${l.length - L.ver})</button></div>` : ''}`;
    }
    function accionesHtml(Rc) {
      if (!Rc.acciones.length) return '<p class="nota-panel" style="padding-top:12px">Nada pendiente: no hay llamadas atrasadas, clientes que ya debían decidir ni ventas sin factura.</p>';
      // dicho en simple: a quién llamar o qué facturar, y por cuánto; la descripción completa está en la ficha
      const simple = a => {
        const q = Rc.cotizaciones.find(x => x.id === a.cotizacion);
        if (!q) return a.titulo;
        if (/^com-seg-/.test(a.id)) return 'Llamar a ' + q.cliente + ' por su cotización de ' + F.mm(q.monto);
        if (/^com-fac-/.test(a.id)) return 'Facturar la venta a ' + q.cliente + ' (' + F.mm(q.monto) + ') o anotar su factura';
        if (/^com-cierre-/.test(a.id)) return 'Preguntarle a ' + q.cliente + ' si ya decidió (' + F.mm(q.monto) + ')';
        return a.titulo;
      };
      return Rc.acciones.map(a => `<div class="ag-item${a.cuando === 'hoy' ? ' hoy' : ''}"><span></span>
        <button class="enlace-btn ag-tit" type="button" data-com="abrir" data-id="${esc(a.cotizacion)}">${esc(simple(a))}</button>
        <span class="por">${esc(a.por)}</span></div>`).join('');
    }
    function ganadoHtml(Rc) {
      const meses = Rc.ganadas.porMes.slice(-8).reverse();
      if (!meses.length) return '<p class="nota-panel" style="padding-top:12px">Aún no hay ventas ganadas anotadas.</p>';
      return `<div class="tabla-env"><table><thead><tr><th>Mes</th><th class="d">Ventas</th><th class="d">Total</th><th class="d">A empresas</th></tr></thead><tbody>
        ${meses.map(m => `<tr><td>${m.mes === 'sin fecha' ? 'Sin fecha' : esc(F.mesNombre(m.mes + '-01')) + ' ' + m.mes.slice(0, 4)}</td><td class="d">${m.n}</td><td class="d">${F.clp(m.monto)}</td><td class="d">${F.clp(m.b2b)}</td></tr>`).join('')}
        </tbody></table></div>
        ${Rc.ganadas.topClientes.length ? `<p class="nota-panel" style="padding-top:10px">Los que más te han comprado: ${Rc.ganadas.topClientes.slice(0, 5).map(c => esc(c.cliente) + ' ' + F.mm(c.monto)).join(' · ')}.</p>` : ''}
        ${Rc.clientes && Rc.clientes.length ? `<p class="nota-panel">Clientes de 2026 que te compraron, pero no sé por cuánto: ${Rc.clientes.map(c => esc(c.cliente)).join(' · ')}. Si tienes los montos, anótalos como cotizaciones ganadas.</p>` : ''}
        <p class="nota-panel">Los montos no incluyen IVA. Si una venta venía con IVA, se lo quité.</p>`;
    }

    /* --- gráfico: pronóstico (barras apiladas ganado + esperado, con equilibrio y meta) --- */
    function graficoPronostico(el, Rc) {
      if (!el) return;
      const filas = Rc.pronostico.meses;
      const W = 640, H = 250, pl = 54, pr = 18, pt = 24, pb = 30;
      const meta = filas[0].meta || 0, eq = filas[0].equilibrio || 0;
      const max = Math.max(2e6, Math.ceil(Math.max(meta, eq, ...filas.map(f => f.total)) / 2e6) * 2e6);
      const y = v => pt + (1 - v / max) * (H - pt - pb);
      const paso = (W - pl - pr) / filas.length, bw = Math.min(46, paso * 0.56);
      let g = '';
      for (let v = 0; v <= max; v += max > 12e6 ? 4e6 : 2e6) g += `<line class="${v ? 'g-l' : 'e-l'}" x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}"/><text class="eje" x="${pl - 8}" y="${y(v) + 4}" text-anchor="end">${v ? '$' + v / 1e6 + 'M' : '$0'}</text>`;
      filas.forEach((f, i) => {
        const x = pl + paso * i + (paso - bw) / 2;
        const yG = y(f.ganado), yT = y(f.total);
        if (f.ganado > 0) g += `<path d="M${x},${y(0)} V${f.esperado > 0 ? yG : yG + 4} ${f.esperado > 0 ? `H${x + bw}` : `Q${x},${yG} ${x + 4},${yG} H${x + bw - 4} Q${x + bw},${yG} ${x + bw},${yG + 4}`} V${y(0)} Z" fill="var(--s-3)"/>`;
        if (f.esperado > 0) { const top = yT, bot = f.ganado > 0 ? yG - 2 : y(0); if (bot - top > 1) g += `<path d="M${x},${bot} V${top + 4} Q${x},${top} ${x + 4},${top} H${x + bw - 4} Q${x + bw},${top} ${x + bw},${top + 4} V${bot} Z" fill="var(--s-1)"/>`; }
        g += `<text class="etq" x="${x + bw / 2}" y="${yT - 7}" text-anchor="middle">${f.total ? F.mm(f.total) : '$0'}</text>`;
        g += `<text class="eje" x="${x + bw / 2}" y="${H - 8}" text-anchor="middle">${esc(f.etiqueta)}</text>`;
        g += `<rect x="${x - 6}" y="${pt}" width="${bw + 12}" height="${H - pt - pb}" fill="transparent" data-mes="${i}"/>`;
      });
      if (eq) g += `<line x1="${pl}" x2="${W - pr}" y1="${y(eq)}" y2="${y(eq)}" stroke="var(--tinta-2)" stroke-width="1.5" stroke-dasharray="2 3"/><text class="etq2" x="${pl + 4}" y="${y(eq) - 6}">Para no perder plata ${F.mm(eq)}</text>`;
      if (meta) g += `<line x1="${pl}" x2="${W - pr}" y1="${y(meta)}" y2="${y(meta)}" stroke="var(--tinta-2)" stroke-width="1.5" stroke-dasharray="6 4"/><text class="etq2" x="${W - pr}" y="${y(meta) - 6}" text-anchor="end">Meta ${F.mm(meta)}</text>`;
      el.innerHTML = `<div class="leyenda"><span><span class="punto" style="background:var(--s-3)"></span>Ya vendido</span><span><span class="punto" style="background:var(--s-1)"></span>Lo probable de lo cotizado</span></div>
        <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Lo que se espera vender a empresas por mes: ${filas.map(f => esc(F.mesNombre(f.mes)) + ' ' + F.mm(f.total)).join('; ')}.">${g}</svg>`;
      for (const r of $$('[data-mes]', el)) {
        r.addEventListener('pointermove', ev => {
          const f = filas[Number(r.dataset.mes)];
          ctx.verTip(ev, `<div class="tt">${esc(f.etiqueta)}</div>
            <div class="tr"><span class="punto" style="background:var(--s-3)"></span><span class="n">Ya vendido (${f.nGanadas} ${f.nGanadas === 1 ? 'venta' : 'ventas'})</span><span class="v">${F.clp(f.ganado)}</span></div>
            <div class="tr"><span class="punto" style="background:var(--s-1)"></span><span class="n">Lo probable (${f.nAbiertas} esperando respuesta)</span><span class="v">${F.clp(f.esperado)}</span></div>
            <div class="tr"><span></span><span class="n">Total</span><span class="v">${F.clp(f.total)}</span></div>`);
        });
        r.addEventListener('pointerleave', ctx.ocultarTip);
      }
    }

    /* ---------------- editor ---------------- */
    const FONDO = 'body > header, body > nav, body > main, body > footer';
    function abrirEditor(id) {
      // una cotización que ya no existe (borrada por otro o deshecha) no abre nada
      if (id && id !== 'nueva' && !ctx.cotizaciones().some(q => q.id === id)) { ctx.avisar('Esa cotización ya no existe.'); return; }
      if (!L.editor) L.volver = document.activeElement;
      L.editor = id || 'nueva'; L.borrar = false;
      pintarEditor();
      if (!L.editor || !$('#modal-com')) return;
      for (const el of $$(FONDO)) el.inert = true;
      const m = $('#modal-com');
      if (m) { const f = L.editor === 'nueva' ? $('#ce-cliente') : $('#ce-titulo'); if (f) f.focus(); }
    }
    function cerrarEditor() {
      const id = L.editor;
      L.editor = null; L.borrar = false; L.inicial = null;
      const m = $('#modal-com'); if (m) m.remove();
      for (const el of $$(FONDO)) el.inert = false;
      // devolver el foco a lo que abrió el editor (o a su fila, si la tabla se repintó)
      const v = L.volver; L.volver = null;
      const destino = v && document.contains(v) ? v : id ? $$('.fila-cot').find(r => r.dataset.id === id) : null;
      if (destino && destino.focus) destino.focus();
    }
    /* Lo que el usuario cambió en el formulario respecto de como se pintó */
    function cambiosFormulario() {
      const d = leerFormulario(), ini = L.inicial || {}, o = {};
      for (const k of Object.keys(d)) if (d[k] !== ini[k]) o[k] = d[k];
      return o;
    }
    function pintarEditor(conservar) {
      const previos = conservar && $('#f-cot') ? cambiosFormulario() : null;
      const raw = L.editor === 'nueva' ? null : ctx.cotizaciones().find(q => q.id === L.editor);
      if (L.editor !== 'nueva' && !raw) { cerrarEditor(); return; }
      const q = raw ? C.normalizar(C.limpiar(raw), hoy(), R() ? R().ciclo || 30 : 30) : C.limpiar({ estado: 'enviada', fecha_cotizacion: hoy(), linea: 'curso_cerrado' });
      let m = $('#modal-com');
      if (!m) { m = document.createElement('div'); m.id = 'modal-com'; m.className = 'modal'; document.body.appendChild(m); }
      const campo = (k, label, tipo, extra) => `<label class="campo-f"><span>${label}</span>${tipo === 'area'
        ? `<textarea id="ce-${k}" data-campo="${k}" rows="${extra || 3}">${esc(q[k])}</textarea>`
        : `<input id="ce-${k}" data-campo="${k}" type="${tipo || 'text'}" value="${esc(q[k])}"${extra || ''}>`}</label>`;
      const hist = (raw && raw.historial ? raw.historial.slice().reverse() : []);
      m.innerHTML = `<div class="modal-fondo" data-com="cerrar"></div>
        <div class="modal-caja" role="dialog" aria-modal="true" aria-labelledby="ce-titulo">
          <div class="modal-cab"><h2 id="ce-titulo" tabindex="-1">${raw ? esc(q.cliente || 'Cotización') : 'Nueva cotización'}</h2>
            ${raw ? `<span class="pill ${ESTADO_PILL[q.estado] || ''}">${esc(q.estadoLabel)}</span>` : ''}
            <button class="cerrar" type="button" data-com="cerrar" aria-label="Cerrar">×</button></div>
          <form class="modal-cuerpo" id="f-cot" novalidate>
            <fieldset><legend>Cliente</legend><div class="g-campos">
              ${campo('cliente', 'Cliente *')}${campo('rut', 'RUT')}${campo('contacto', 'Persona de contacto')}${campo('email', 'Correo', 'email')}${campo('telefono', 'Teléfono', 'tel')}${campo('folio', 'N° de cotización')}
            </div></fieldset>
            <fieldset><legend>La venta</legend><div class="g-campos">
              <label class="campo-f"><span>Tipo de venta</span><select id="ce-linea" data-campo="linea">${opciones(C.LINEAS, q.linea)}</select></label>
              <label class="campo-f"><span>Monto en pesos</span><input id="ce-monto" data-campo="monto" inputmode="numeric" value="${q.monto ? F.clp(q.monto) : ''}" placeholder="$1.200.000"></label>
              <label class="campo-f"><span>¿Incluye IVA?</span><select id="ce-monto_tipo" data-campo="monto_tipo">${opciones(IVA, q.monto_tipo || 'exento')}</select></label>
              <label class="campo-f"><span>En qué va</span><select id="ce-estado" data-campo="estado">${opciones(C.ESTADOS, q.estado)}</select></label>
              <label class="campo-f"><span>¿Qué tan seguro es? (%)</span><input id="ce-probabilidad" data-campo="probabilidad" type="number" min="0" max="100" value="${esc(q.probabilidad)}" placeholder="si lo dejas vacío: ${Math.round((C.ESTADO[q.estado] || C.ESTADO.enviada).prob * 100)}"></label>
              <label class="campo-f ancho2"><span>Qué se cotizó</span><textarea id="ce-descripcion" data-campo="descripcion" rows="2">${esc(q.descripcion)}</textarea></label>
              ${campo('motivo_perdida', 'Si se perdió, ¿por qué?')}
            </div></fieldset>
            <fieldset><legend>Fechas</legend><div class="g-campos">
              ${campo('fecha_cotizacion', 'Día que se cotizó', 'date')}${campo('fecha_cierre_estimada', 'Cuándo debería decidir', 'date')}${campo('proximo_seguimiento', 'Próxima llamada', 'date')}
              ${campo('ultimo_contacto', 'Última vez que hablaron', 'date')}${campo('fecha_cierre', 'Día que respondió', 'date')}${campo('fecha_ejecucion', 'Día del curso o servicio', 'date')}
            </div></fieldset>
            <fieldset><legend>Factura</legend><div class="g-campos">
              ${campo('factura_folio', 'N° de factura')}
              <label class="campo-f"><span>¿Ya pagó?</span><select id="ce-cobrada" data-campo="cobrada">${opciones(COBRO, q.cobrada, '—')}</select></label>
            </div></fieldset>
            <fieldset><legend>Notas</legend>${campo('notas', 'Notas internas', 'area', 3)}
              ${raw && (raw.origen || raw.evidencia) ? `<p class="c-sub">De dónde salió: ${esc(raw.origen === 'manual' ? 'la creaste en AerIA' : raw.origen || '—')}${raw.evidencia ? ' · ' + esc(raw.evidencia) : ''}</p>` : ''}</fieldset>
            ${raw ? `<fieldset class="seguimiento"><legend>Anota una llamada o un correo</legend><div class="g-campos">
              <label class="campo-f ancho2"><span>Qué pasó</span><input id="ce-seg-nota" placeholder="Ej.: Llamé, piden ajustar a 8 participantes"></label>
              <label class="campo-f"><span>¿Cuándo vuelves a llamar?</span><input id="ce-seg-fecha" type="date" value="${esc(F.sumarDias(hoy(), 7))}"></label>
              <div class="campo-f"><span>&nbsp;</span><button class="btn sm sec" type="button" data-com="seguimiento">Anotar</button></div></div></fieldset>` : ''}
            <p class="msg" id="ce-msg" aria-live="polite"></p>
            <div class="modal-pie">
              <button class="btn" type="submit">${raw ? 'Guardar cambios' : 'Crear cotización'}</button>
              <button class="btn sec" type="button" data-com="cerrar">Cancelar</button>
              ${raw ? `<button class="btn sec" type="button" data-com="preguntar">Preguntar a AerIA</button>
                <span class="sep"></span><span id="ce-borrar" class="ce-borrar">${borrarHtml()}</span>` : ''}
            </div>
            ${hist.length ? `<details class="historial"${L.histAbierto ? ' open' : ''}><summary>Qué ha cambiado (${hist.length})</summary>
              ${raw && C.puedeDeshacer(raw) ? '<button class="enlace-btn" type="button" data-com="deshacer">Deshacer el último cambio</button>' : ''}
              <ol>${hist.map(h => `<li${h.deshecha ? ' class="deshecha"' : ''}><b>${esc(cuandoFue(h.fecha))}</b> · ${esc(QUIEN[h.por] || h.por || '')}${h.nota ? ' · ' + esc(h.nota) : ''}${h.deshecha ? ' · <i>deshecho</i>' : ''}${Object.keys(h.cambios || {}).length ? '<div class="c-sub">' + Object.entries(h.cambios).map(([k, [a, b]]) => esc(etq(k)) + ': ' + esc(valorLegible(k, a)) + ' → ' + esc(valorLegible(k, b))).join(' · ') + '</div>' : ''}</li>`).join('')}</ol></details>` : ''}
          </form></div>`;
      L.inicial = leerFormulario();
      if (previos) for (const [k, val] of Object.entries(previos)) { const el = $('#ce-' + k); if (el) el.value = val; }
    }
    const borrarHtml = () => L.borrar
      ? '<span class="peligro">¿Eliminarla para siempre?</span><button class="btn sm peligro" type="button" data-com="borrar-si">Sí, eliminar</button><button class="enlace-btn" type="button" data-com="borrar-no">No</button>'
      : '<button class="enlace-btn peligro" type="button" data-com="borrar">Eliminar</button>';
    function pintarBorrar(foco) { const b = $('#ce-borrar'); if (!b) return; b.innerHTML = borrarHtml(); const f = b.querySelector(foco); if (f) f.focus(); }
    function leerFormulario() {
      const o = {};
      for (const el of $$('#f-cot [data-campo]')) o[el.dataset.campo] = el.value;
      return o;
    }
    async function guardarFormulario() {
      if (L.guardando) return;
      const msg = $('#ce-msg');
      const actual = L.editor === 'nueva' ? null : ctx.cotizaciones().find(q => q.id === L.editor);
      if (L.editor !== 'nueva' && !actual) { msg.textContent = 'Esta cotización ya no existe (alguien la eliminó).'; return; }
      // en una existente se mandan solo los campos que cambiaron: no se pisa lo que otro cambió mientras el editor estaba abierto
      const datos = actual ? cambiosFormulario() : leerFormulario();
      if (actual && !Object.keys(datos).length) { cerrarEditor(); return; }
      if ((!actual || 'cliente' in datos) && !String(datos.cliente || '').trim()) { msg.textContent = 'Falta el nombre del cliente.'; $('#ce-cliente').focus(); return; }
      if (!actual) {
        const prov = C.limpiar(Object.assign({}, datos, { origen: 'manual' }));
        if (ctx.cotizaciones().some(q => q.id === prov.id)) prov.id = prov.id + '-' + Date.now().toString(36);
        datos.id = prov.id; datos.origen = 'manual';
      }
      const r = C.aplicar(actual, datos, 'usuario', actual ? '' : 'Creada en AerIA', ahoraISO());
      msg.textContent = 'Guardando…'; L.guardando = true;
      const ok = await ctx.guardarCot(r.cotizacion);
      L.guardando = false;
      if (!ok) { msg.textContent = 'No se pudo guardar. Revisa tu conexión e intenta de nuevo.'; return; }
      cerrarEditor(); ctx.pintar();
    }
    async function anotarSeguimiento() {
      const actual = ctx.cotizaciones().find(q => q.id === L.editor); if (!actual) return;
      const nota = $('#ce-seg-nota').value.trim(), prox = $('#ce-seg-fecha').value;
      if (!nota && !prox) { $('#ce-msg').textContent = 'Escribe qué pasó o cuándo vuelves a llamar.'; return; }
      const r = C.aplicar(actual, { ultimo_contacto: hoy(), proximo_seguimiento: prox || actual.proximo_seguimiento }, 'usuario', 'Seguimiento: ' + (nota || 'contacto'), ahoraISO());
      if (await ctx.guardarCot(r.cotizacion)) { pintarEditor(true); $('#ce-msg').textContent = 'Listo, quedó anotado.'; ctx.pintar(); }
      else $('#ce-msg').textContent = 'No se pudo anotar. Intenta de nuevo.';
    }

    /* ---------------- importador ---------------- */
    function abrirImportador() {
      L.imp = L.imp || { paso: 1, texto: '', conjuntos: [], elegido: 0, mapeo: {}, origen: '', plan: null, msg: '', unir: true, esDashboard: false };
      const p = $('#panel-importar'); if (!p) return;
      p.hidden = false; p.innerHTML = importadorHtml(); p.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
    function pintarImportador() {
      const p = $('#panel-importar'); if (!p || !L.imp) return;
      const act = document.activeElement, idAct = act && act.id && p.contains(act) ? act.id : '';
      p.innerHTML = importadorHtml();
      if (idAct && document.getElementById(idAct)) document.getElementById(idAct).focus({ preventScroll: true });
    }
    function importadorHtml() {
      const I0 = L.imp;
      const cab = `<div class="panel-c"><h2>Importar cotizaciones</h2><span class="bajada">Paso ${I0.paso} de 3 · ${['', 'Pega tus datos', 'Dime qué es cada columna', 'Revisa y guarda'][I0.paso]}</span>
        <span class="acc"><button class="btn sm sec" type="button" data-com="imp-cerrar">Cerrar</button></span></div>`;
      if (I0.paso === 1) return cab + `<div class="importar">
        <p class="c-sub">Pega aquí lo que copió el marcador «AerIA · Extraer» en tu dashboard, o una tabla copiada de Excel. También puedes elegir un archivo (CSV, JSON o texto).</p>
        <div class="fila"><label class="btn sm sec" for="imp-archivo">Elegir archivo</label><input id="imp-archivo" type="file" accept=".csv,.json,.txt,.tsv,.html,.htm" class="sr" data-com-archivo="1"><span class="c-sub">${esc(I0.origen || '')}</span></div>
        <label class="sr" for="imp-texto">Datos a importar</label>
        <textarea id="imp-texto" placeholder="Pega aquí (Cmd+V)…">${esc(I0.texto)}</textarea>
        <div class="fila"><button class="btn sm" type="button" data-com="imp-leer">Revisar lo pegado</button>${ctx.puedeIA() ? '<button class="btn sm sec" type="button" data-com="imp-ia">Que AerIA lo ordene</button>' : ''}</div>
        <p class="msg" aria-live="polite">${esc(I0.msg)}</p></div>`;
      if (I0.paso === 2) {
        const cj = I0.conjuntos[I0.elegido];
        const cols = cj.columnas;
        const campos = [['cliente', 'Cliente *'], ['monto', 'Monto'], ['estado', 'En qué va'], ['folio', 'N° de cotización'], ['descripcion', 'Qué se cotizó'], ['linea', 'Tipo de venta'],
          ['fecha_cotizacion', 'Día que se cotizó'], ['fecha_cierre', 'Día que respondió'], ['fecha_cierre_estimada', 'Cuándo debería decidir'], ['fecha_ejecucion', 'Día del curso o servicio'],
          ['proximo_seguimiento', 'Próxima llamada'], ['probabilidad', 'Qué tan seguro (%)'], ['contacto', 'Persona de contacto'], ['email', 'Correo'], ['telefono', 'Teléfono'], ['rut', 'RUT'],
          ['factura_folio', 'N° de factura'], ['cobrada', '¿Ya pagó?'], ['motivo_perdida', 'Por qué se perdió'], ['notas', 'Notas'], ['id', 'Código de AerIA (solo si el archivo salió de AerIA)']];
        const muestra = C.mapear(cj.filas.slice(0, 5), I0.mapeo, 'vista previa');
        return cab + `<div class="importar">
          ${I0.conjuntos.length > 1 ? `<label class="campo-f"><span>Encontré ${I0.conjuntos.length} tablas. ¿Cuál uso?</span><select data-com-input="imp-conjunto">${I0.conjuntos.map((c, i) => `<option value="${i}"${i === I0.elegido ? ' selected' : ''}>${esc(c.origen)} · ${c.filas.length} filas</option>`).join('')}</select></label>` : `<p class="c-sub">${esc(cj.origen)} · ${cj.filas.length} filas.</p>`}
          <p class="c-sub">Para cada dato, elige la columna de tu tabla que lo trae. Ya marqué las que reconocí.</p>
          <div class="mapeo">${campos.map(([k, t]) => `<label class="campo-f"><span>${t}</span><select data-com-mapeo="${k}"><option value="">— no viene —</option>${cols.map(c => `<option value="${esc(c)}"${I0.mapeo[k] === c ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select></label>`).join('')}</div>
          <p class="c-sub">Lo que no elijas no se pierde: queda en las notas de cada cotización.</p>
          <div class="tabla-env"><table><thead><tr><th>Cliente</th><th class="d">Monto</th><th>En qué va</th><th>Cotizada</th><th>Tipo de venta</th></tr></thead><tbody>
            ${muestra.map(q => `<tr><td>${esc(q.cliente || '—')}<div class="c-sub">${esc(q.descripcion.slice(0, 80))}</div></td><td class="d">${F.clp(q.monto)}</td><td>${esc((C.ESTADO[q.estado] || {}).label || q.estado)}</td><td class="nw">${esc(fechaCorta(q.fecha_cotizacion))}</td><td>${esc((C.LINEA[q.linea] || {}).label || '')}</td></tr>`).join('')}
          </tbody></table></div>
          <div class="fila"><button class="btn sm" type="button" data-com="imp-plan"${I0.mapeo.cliente || I0.mapeo.descripcion ? '' : ' disabled'}>Seguir</button><button class="enlace-btn" type="button" data-com="imp-volver">Volver</button></div>
          ${I0.mapeo.cliente || I0.mapeo.descripcion ? '' : '<p class="c-sub">Para seguir, dime al menos qué columna trae el cliente (o lo que se cotizó).</p>'}
          <p class="msg" aria-live="polite">${esc(I0.msg)}</p></div>`;
      }
      const P = I0.plan;
      const n = P.crear.length + P.actualizar.length;
      return cab + `<div class="importar">
        <p>Se van a <b>crear ${P.crear.length}</b> cotizaciones y <b>actualizar ${P.actualizar.length}</b>${P.iguales ? '; ' + P.iguales + ' ya estaban iguales' : ''}. Cada cambio queda anotado en «Qué ha cambiado» de su cotización.</p>
        ${P.parecidas.length || !I0.unir ? `<div class="aviso-imp"><p>${P.parecidas.length ? P.parecidas.length + (P.parecidas.length === 1 ? ' fila se parece' : ' filas se parecen') + ' a cotizaciones que ya estaban (las armé desde el SII, el banco, Notion o el plan): mismo cliente y mismo monto.' : 'Ojo: no estoy juntando las filas parecidas con lo que ya estaba. Si hay alguna, quedará repetida.'}</p>
          ${P.parecidas.length ? `<ul class="c-sub">${P.parecidas.slice(0, 30).map(x => '<li>' + esc(x.nueva.cliente) + ' ' + F.clp(x.nueva.monto) + ' → se junta con ' + esc(x.antes.cliente) + ' (' + esc(x.antes.id) + ')</li>').join('')}</ul>` : ''}
          <label class="chk"><input type="checkbox" id="imp-unir" data-com-input="imp-unir"${I0.unir ? ' checked' : ''}> Juntarlas con las que ya estaban, para no repetirlas (recomendado)</label></div>` : ''}
        ${P.repetidas.length ? `<p class="c-sub">${P.repetidas.length} ${P.repetidas.length === 1 ? 'fila trae' : 'filas traen'} un N° de cotización que ya usa otro cliente: ${P.repetidas.length === 1 ? 'la agrego aparte' : 'las agrego aparte'}.</p>` : ''}
        ${P.actualizar.length ? `<details><summary>Ver los cambios (${P.actualizar.length})</summary><ul class="c-sub">${P.actualizar.slice(0, 80).map(u => '<li>' + esc(u.antes.cliente || u.id) + ': ' + Object.entries(u.cambios).map(([k, v]) => esc(etq(k)) + ' → ' + esc(valorLegible(k, v))).join(', ') + '</li>').join('')}</ul></details>` : ''}
        <label class="chk"><input type="checkbox" id="imp-dashboard" data-com-input="imp-dashboard"${I0.esDashboard ? ' checked' : ''}${I0.guardando ? ' disabled' : ''}> Son las cotizaciones de mi dashboard comercial: AerIA las usará para calcular lo que se espera vender y para avisarte</label>
        <div class="fila"><button class="btn sm" type="button" data-com="imp-go"${n && !I0.guardando ? '' : ' disabled'}>${I0.guardando ? 'Importando…' : 'Importar'}</button>${I0.guardando ? '' : '<button class="enlace-btn" type="button" data-com="imp-volver">Volver</button>'}</div>
        <div class="progreso"${I0.guardando ? '' : ' hidden'}><i style="width:${Math.round((I0.avance || 0) * 100)}%"></i></div>
        <p class="msg" aria-live="polite">${esc(I0.msg)}</p></div>`;
    }
    function leerImportacion(texto, origen) {
      const I0 = L.imp;
      I0.texto = texto; I0.origen = origen || I0.origen || 'texto pegado';
      try { I0.conjuntos = C.conjuntos(texto); } catch (e) { I0.conjuntos = []; }
      I0.esDashboard = /aeria-extractor/.test(texto.slice(0, 200));
      if (!I0.conjuntos.length) { I0.msg = 'No encontré una tabla en lo que pegaste. Revisa que traiga títulos de columna como cliente, monto o estado.'; pintarImportador(); return; }
      I0.elegido = 0; I0.mapeo = Object.assign({}, I0.conjuntos[0].mapeo); I0.paso = 2; I0.msg = '';
      pintarImportador();
    }
    function planificar() {
      const I0 = L.imp, cj = I0.conjuntos[I0.elegido];
      const nuevas = C.mapear(cj.filas, I0.mapeo, 'importación');
      I0.plan = C.planImportacion(nuevas, ctx.cotizaciones().map(C.limpiar), { unirParecidas: I0.unir !== false });
      I0.paso = 3; I0.msg = ''; pintarImportador();
    }
    async function ejecutarImportacion() {
      const I0 = L.imp;
      if (!I0 || !I0.plan || I0.guardando) return;   // un segundo clic no lanza otra pasada
      const P = I0.plan;
      // «dashboard» marca que esto es el pipeline completo (conecta el pronóstico y las alertas)
      const por = I0.esDashboard ? 'dashboard' : 'importación';
      const origen = por + ' ' + hoy();
      I0.guardando = true; I0.avance = 0; I0.msg = 'Guardando…'; pintarImportador();
      // se arma cada cotización con lo último de la base, no con lo que había al planificar
      const vigente = u => ctx.cotizaciones().find(q => q.id === u.id) || u.antes;
      const tareas = P.crear.map(q => () => C.aplicar(null, Object.assign({}, q, { origen }), por, 'Importada desde ' + I0.origen, ahoraISO()).cotizacion)
        .concat(P.actualizar.map(u => () => C.aplicar(vigente(u), u.cambios, por, 'Actualizada desde ' + I0.origen, ahoraISO()).cotizacion));
      let hechas = 0, fallas = 0;
      for (const t of tareas) {
        const ok = await ctx.guardarCot(t(), true);
        if (ok) hechas++; else fallas++;
        I0.avance = (hechas + fallas) / tareas.length; I0.msg = 'Guardando ' + (hechas + fallas) + ' de ' + tareas.length + '…';
        const p = $('#panel-importar');
        if (p) { const i = p.querySelector('.progreso i'), m = p.querySelector('.msg'); if (i) i.style.width = Math.round(I0.avance * 100) + '%'; if (m) m.textContent = I0.msg; }
      }
      L.imp = null;
      ctx.pintar();
      ctx.avisar(fallas ? 'Importé ' + hechas + ' cotizaciones; ' + fallas + ' no se pudieron guardar. Vuelve a importar para reintentar las que faltan.' : 'Listo: importé ' + hechas + ' cotizaciones.');
    }

    /* ---------------- exportar ---------------- */
    async function exportarCSV() {
      const campos = ['id'].concat(C.CAMPOS);
      // una celda que empieza con = + - @ se neutraliza para que Excel no la ejecute como fórmula
      const cel = v => { let s = String(v == null ? '' : v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
      const csv = '﻿' + [campos.join(';')].concat(ctx.cotizaciones().map(q => campos.map(k => cel(q[k])).join(';'))).join('\n');
      const nombre = 'aeria-cotizaciones-' + hoy() + '.csv';
      const d = await ctx.descargas();
      if (d) {
        try { await d.save({ filename: nombre, data: csv }); return; } catch (e) { if (e && e.code === 'declined') return; }
      }
      try { await navigator.clipboard.writeText(csv); ctx.avisar('No pude descargar el archivo aquí, así que lo copié: pégalo en Excel o en un archivo de texto.'); }
      catch (e) { ctx.avisar('No pude descargar ni copiar el archivo desde aquí.'); }
    }


    /* ---------------- conexión automática con el dashboard ----------------
       En la app de escritorio de Claude, AerIA abre el dashboard local con el
       navegador integrado (servidor «host:claude_browser» de la capacidad mcp),
       lee su texto, lo convierte en filas (tabla directa o, si no, con Claude)
       e importa con el mismo plan del importador: no duplica, solo cambia lo
       que la fila trae y marca cada cambio con la sincronización, para poder
       deshacerla entera. Fuera de la app no hay navegador: queda el marcador. */
    const NAV = 'host:claude_browser';
    const SYNC_CADA = 20 * 60 * 1000;      // como mucho una sincronización automática cada 20 minutos
    const SYNC_MAX = 150;                  // un cambio más grande se revisa a mano en el importador
    const espera = ms => new Promise(r => setTimeout(r, ms));
    const OTRA_VIA = 'Otra forma: abre tú el dashboard en el navegador de Claude (Cmd+Shift+B) y aprieta «Leer la pestaña abierta». Te muestro lo que encontré antes de guardar.';
    const PASOS = { abrir: 'abrir el dashboard', navegar: 'volver a la pestaña del dashboard', leer: 'leer el dashboard', ordenar: 'ordenar las cotizaciones con Claude', guardar: 'guardar los cambios', 'pestaña': 'leer la pestaña abierta' };
    // la respuesta del navegador no tiene un formato fijo: se busca el id de la pestaña y el texto más largo
    function idDePestana(v) {
      if (v == null) return undefined;
      if (typeof v === 'number') return v;
      if (typeof v === 'string') { const m = /tab\s*(?:id)?\s*[:=#]?\s*(\d+)/i.exec(v); return m ? Number(m[1]) : undefined; }
      if (typeof v === 'object') {
        for (const k of ['tabId', 'tab_id', 'tab', 'id']) if (typeof v[k] === 'number' || /^\d+$/.test(String(v[k] || ''))) return Number(v[k]);
        for (const x of Object.values(v)) { const r = idDePestana(x); if (r !== undefined) return r; }
      }
      return undefined;
    }
    function textoDe(v) {
      if (v == null) return '';
      if (typeof v === 'string') return v;
      if (Array.isArray(v)) return v.map(textoDe).sort((a, b) => b.length - a.length)[0] || '';
      if (typeof v === 'object') {
        if (Array.isArray(v.content)) return v.content.filter(b => b && b.type === 'text').map(b => b.text).join('\n');
        return Object.values(v).map(textoDe).sort((a, b) => b.length - a.length)[0] || '';
      }
      return '';
    }
    const navegadorDisponible = async () => {
      const mcp = ctx.mcp(); if (!mcp) return false;
      try {
        const r = await mcp.listTools(NAV);
        const s = ((r && r.servers) || []).find(x => x.server === NAV && (x.tools || []).length);
        // para el diagnóstico: cómo ve la app el navegador y qué herramientas declara de solo lectura
        if (s) L.navInfo = { auth: s.authStatus || '', ro: (s.tools || []).filter(t => t.annotations && t.annotations.readOnlyHint).map(t => t.name).join(',') };
        return !!s;
      }
      catch (e) { return false; }
    };
    // permiso de la página para el navegador de Claude: se lee sin preguntar; en un clic se pide si falta
    async function permisoNav(pedir) {
      let p = null; try { p = await ctx.permisos(); } catch (e) { p = null; }
      if (!p) return 'sin-dato';
      const nombre = 'mcp:' + NAV;
      let st = await p.state(nombre).catch(() => 'sin-dato');
      if (pedir && st === 'prompt') st = await p.request([nombre]).then(r => (r && r[nombre]) || st).catch(() => st);
      return st;
    }
    const leerPestana = async (mcp, id) => textoDe(await mcp.callTool(NAV, 'get_page_text', id !== undefined ? { tabId: id } : {}, { cache: false }).then(r => r.payload !== undefined ? r.payload : r));
    /* Cuando la app no deja abrir el dashboard, la persona puede abrirlo ella en el navegador de
       Claude y pedir con un botón que AerIA lea esa pestaña. Nunca se hace solo, y lo leído no se
       guarda directo: se abre en el importador para que revise que sea su dashboard antes de guardar. */
    async function leerPestanaAbierta() {
      if (L.syncLock) return;
      if (!ctx.listoParaSync()) { ctx.avisar('Todavía estoy cargando tus datos. Intenta en unos segundos.'); return; }
      const mcp = ctx.mcp();
      if (!mcp || !(await navegadorDisponible())) { L.sync = { estado: 'sin-app' }; pintarSync(); return; }
      L.syncLock = true;
      const previo = ctx.syncEstado() || {}, ahora = ahoraISO();
      const rechazo = previo.intento && (previo.intento.rechazo || (['cancelled', 'approval_required'].includes(previo.intento.codigo) ? previo.intento.codigo : '')) || '';
      const anotar = async (estado, extra) => {
        L.sync = Object.assign({ estado, fecha: ahora }, extra || {}); pintarSync();
        await ctx.guardarSync(Object.assign({}, ctx.syncEstado() || previo, { intento: Object.assign({ fecha: ahora, estado, manual: true, via: 'pestaña' }, rechazo ? { rechazo } : {}, extra && extra.diag ? extra.diag : {}) }));
      };
      try {
        L.sync = { corriendo: true, paso: 'Leyendo la pestaña abierta en el navegador de Claude…' }; pintarSync();
        const texto = await leerPestana(mcp, undefined);
        const cj = C.tablasDeTexto(texto)[0];
        if (!(cj && cj.mapeo.cliente && cj.puntaje >= 6)) return anotar('pestana-sin-tabla', { diag: { activa: texto.trim() ? 'sin tabla' : 'vacía' } });
        const nuevas = C.mapear(cj.filas, cj.mapeo, 'dashboard');
        const plan = C.planImportacion(nuevas, ctx.cotizaciones().map(C.limpiar), { respetarEdiciones: true, mismaFuente: true });
        const raras = C.anomalias(nuevas, plan, cj.columnas);
        L.imp = { paso: 3, texto: '', conjuntos: [{ origen: 'La pestaña abierta en el navegador de Claude', filas: cj.filas, columnas: cj.columnas, puntaje: cj.puntaje, mapeo: cj.mapeo }], elegido: 0, mapeo: cj.mapeo, origen: 'la pestaña abierta en el navegador de Claude', plan,
          msg: 'Leí la pestaña que tienes abierta en el navegador de Claude. Revisa que sea tu dashboard antes de guardar.' + (raras.length ? ' Ojo: ' + raras.slice(0, 5).join('; ') + '.' : ''), unir: true, esDashboard: true };
        ctx.pintar();
        const p = $('#panel-importar'); if (p) p.scrollIntoView({ block: 'start' });
        return anotar('revisar-pestana', { n: plan.crear.length + plan.actualizar.length, diag: { activa: 'leída' } });
      } catch (e) {
        const c = e && e.code;
        return anotar(c === 'cancelled' ? 'cancelada' : c === 'approval_required' ? 'sin-aprobar' : 'error', { msg: 'No pude leer la pestaña abierta.' + (e && e.message ? ' (' + String(e.message).slice(0, 140) + ')' : ''), diag: { codigo: String(c || 'sin código'), paso: 'pestaña', mensaje: String((e && e.message) || '').slice(0, 200) } });
      } finally { L.syncLock = false; if (L.sync) L.sync.corriendo = false; pintarSync(); }
    }
    const PROMPT_SYNC = 'Este es el texto de la página de un dashboard de cotizaciones de una empresa chilena (escuela de pilotos de drones). Extrae SOLO las cotizaciones (no totales, KPIs ni menús) como un JSON array de objetos con estas claves: folio, cliente, descripcion, monto (número en pesos, sin puntos), estado (borrador, enviada, negociacion, ganada, perdida o vencida, según lo que diga la página), probabilidad (número 0-100 o ""), fecha_cotizacion (AAAA-MM-DD o ""), fecha_cierre (AAAA-MM-DD o ""), fecha_cierre_estimada (AAAA-MM-DD o ""), proximo_seguimiento (AAAA-MM-DD o ""), linea (sence, curso_cerrado, aoc, servicios, escuela, flota, venta_equipos u otro), contacto, notas. Copia los valores tal como aparecen; no inventes datos: deja "" lo que no esté. Responde solo el JSON.\n\n';
    // la pestaña del dashboard se reutiliza entre sincronizaciones (se recuerda en este navegador)
    const tabGuardada = () => { try { const v = localStorage.getItem('aeria:tab-dashboard'); return v ? Number(v) : undefined; } catch (e) { return undefined; } };
    const guardarTab = id => { L.tabDash = id; try { if (id !== undefined) localStorage.setItem('aeria:tab-dashboard', String(id)); else localStorage.removeItem('aeria:tab-dashboard'); } catch (e) { /* sin almacenamiento */ } };
    async function abrirDashboard(mcp, url) {
      const previa = L.tabDash !== undefined ? L.tabDash : tabGuardada();
      if (previa !== undefined) {
        L.pasoNav = 'navegar';
        try { await mcp.callTool(NAV, 'navigate', { url, tabId: previa }); return previa; }
        catch (e) { if (e && ['cancelled', 'not_in_manifest', 'approval_required', 'server_not_connected'].includes(e.code)) throw e; guardarTab(undefined); }  // pestaña cerrada: se abre otra
      }
      L.pasoNav = 'abrir';
      const abierta = await mcp.callTool(NAV, 'preview_start', { url });
      const id = idDePestana(abierta && (abierta.payload !== undefined ? abierta.payload : abierta));
      guardarTab(id);
      return id;
    }
    async function sincronizar(manual) {
      if (L.syncLock) return;                 // una sola sincronización a la vez (doble clic, o clic durante la automática)
      L.syncLock = true;
      try { await sincronizarUnaVez(manual); } finally { L.syncLock = false; if (L.sync) L.sync.corriendo = false; pintarSync(); }
    }
    async function sincronizarUnaVez(manual) {
      if (!ctx.listoParaSync()) {             // sin las cotizaciones de la base cargadas no se escribe nada
        L.sync = { estado: 'esperando' }; pintarSync();
        if (manual) ctx.avisar('Todavía estoy cargando tus datos. Intenta en unos segundos.');
        return;
      }
      const mcp = ctx.mcp();
      if (!mcp || !(await navegadorDisponible())) {
        L.sync = { estado: 'sin-app' }; pintarSync();
        if (manual) ctx.avisar('La conexión automática necesita la app de escritorio de Claude (abre AerIA desde una conversación de Cowork). Aquí usa el marcador «AerIA · Extraer».');
        return;
      }
      const previo = ctx.syncEstado() || {};
      const ahora = ahoraISO();
      // cada intento queda anotado (sin tocar la última sincronización que cambió algo)
      const anotar = async (estado, extra) => {
        L.sync = Object.assign({ estado, fecha: ahora }, extra || {}); pintarSync();
        // el intento guarda qué respondió la app y en qué paso, para entender una falla sin ver la pantalla
        const intento = Object.assign({ fecha: ahora, estado, manual: !!manual }, extra && extra.diag ? extra.diag : {});
        await ctx.guardarSync(Object.assign({}, ctx.syncEstado() || previo, { intento }, extra && extra.reg ? extra.reg : {}));
      };
      // en un clic se pide antes el permiso de la página para el navegador; si está bloqueado no se llama
      L.sync = { corriendo: true, paso: manual ? 'Pidiendo permiso para usar el navegador de Claude…' : 'Abriendo tu dashboard en el navegador de Claude…' }; pintarSync();
      const permiso = await permisoNav(!!manual);
      if (permiso === 'denied') return anotar('bloqueado', { diag: { permiso } });
      L.sync = { corriendo: true, paso: 'Abriendo tu dashboard en el navegador de Claude…' }; pintarSync();
      L.pasoNav = 'abrir';
      try {
        const url = await ctx.urlDashboard();
        // si la app no deja abrir el dashboard (cancelled, approval_required), no se lee nada más:
        // la pestaña que la persona tenga abierta solo se lee cuando ella lo pide con su botón
        const tabId = await abrirDashboard(mcp, url);
        L.pasoNav = 'leer';
        L.sync.paso = 'Leyendo tu dashboard…'; pintarSync();
        let texto = await leerPestana(mcp, tabId);
        if (texto.replace(/\s+/g, '').length < 200) { await espera(2500); texto = await leerPestana(mcp, tabId); }   // el dashboard puede cargar sus datos después
        if (!texto.trim()) return anotar('vacio');
        const firma = C.huellaTexto(texto);
        if (!manual && previo.firma === firma) return anotar('sin-cambios');
        // 1) una tabla del texto (por bloques: no mezcla resúmenes ni segundas tablas); 2) si no, Claude la ordena
        let filas = null, mapeo = null, columnas = null, via = 'tabla', inventadas = 0;
        const cj = C.tablasDeTexto(texto)[0];
        if (cj && cj.mapeo.cliente && cj.puntaje >= 6) { filas = cj.filas; mapeo = cj.mapeo; columnas = cj.columnas; }
        if (!filas) {
          if (!ctx.puedeIA()) return anotar('sin-ia');
          via = 'ia'; L.pasoNav = 'ordenar'; L.sync.paso = 'Ordenando las cotizaciones con Claude…'; pintarSync();
          const arr = await ctx.iaJSON(PROMPT_SYNC + texto.slice(0, 60000));
          filas = (Array.isArray(arr) ? arr : []).filter(x => x && typeof x === 'object' && !Array.isArray(x));
          // solo filas cuyo cliente (o folio) aparece en la página: lo que Claude no leyó ahí no se escribe
          const pagina = F.plano(texto).replace(/\s+/g, ' ');
          const enPagina = f => { const c = F.plano(f.cliente || '').replace(/\s+/g, ' ').trim(), fo = F.plano(f.folio || '').trim(); return (c && pagina.includes(c.slice(0, 24))) || (fo && pagina.includes(fo)); };
          inventadas = filas.filter(f => !enPagina(f)).length;
          filas = filas.filter(enPagina);
          // las columnas son todas las claves que trajo alguna fila, no solo las de la primera
          columnas = Array.from(new Set([].concat(...filas.map(f => Object.keys(f)))));
          mapeo = C.sugerirMapeo(columnas);
        }
        const nuevas = C.mapear(filas, mapeo, 'dashboard');
        if (!nuevas.length) return anotar('sin-filas');
        const plan = C.planImportacion(nuevas, ctx.cotizaciones().map(C.limpiar), { respetarEdiciones: true, mismaFuente: true });
        const n = plan.crear.length + plan.actualizar.length;
        const raras = C.anomalias(nuevas, plan, columnas);
        if (inventadas) raras.push(inventadas + (inventadas === 1 ? ' cotización que entregó Claude no está en tu dashboard (la dejé fuera)' : ' cotizaciones que entregó Claude no están en tu dashboard (las dejé fuera)'));
        if (n > SYNC_MAX || raras.length) {
          // muchos cambios o algo raro en la lectura: se revisa en el importador antes de escribir
          L.imp = { paso: 3, texto: '', conjuntos: [{ origen: 'Tu dashboard (sincronización)', filas, columnas: columnas || Object.keys(filas[0] || {}), puntaje: 9, mapeo }], elegido: 0, mapeo, origen: 'tu dashboard', plan,
            msg: (n > SYNC_MAX ? 'Encontré ' + n + ' cambios. ' : '') + (raras.length ? 'Antes de guardar, revisa: ' + raras.slice(0, 5).join('; ') + (raras.length > 5 ? '…' : '') + '.' : 'Revísalos antes de importar.'), unir: true, esDashboard: true };
          ctx.pintar(); return anotar('revisar', { n, raras: raras.length });
        }
        if (!n) {
          // nada que cambiar: se conserva la última sincronización que sí cambió algo (y su «deshacer»)
          return anotar(manual ? 'al-dia' : 'sin-cambios', { reg: { firma, revisado: ahora }, conflictos: plan.conflictos.length });
        }
        L.pasoNav = 'guardar';
        const id = ahora, marca = { resp: id };
        const origen = 'dashboard ' + hoy();
        const vigente = u => ctx.cotizaciones().find(q => q.id === u.id) || u.antes;
        const tareas = plan.crear.map(q => ({ tipo: 'c', hacer: () => C.aplicar(null, Object.assign({}, q, { origen }), 'dashboard', 'Sincronizada desde tu dashboard', ahoraISO(), marca).cotizacion }))
          .concat(plan.actualizar.map(u => ({ tipo: 'a', hacer: () => C.aplicar(vigente(u), u.cambios, 'dashboard', 'Actualizada desde tu dashboard', ahoraISO(), marca).cotizacion })));
        let creadas = 0, actualizadas = 0, fallas = 0; const ids = [];
        L.sync.paso = 'Guardando ' + n + (n === 1 ? ' cambio…' : ' cambios…'); pintarSync();
        for (const t of tareas) { const q = t.hacer(); if (await ctx.guardarCot(q)) { if (t.tipo === 'c') creadas++; else actualizadas++; ids.push(q.id); } else fallas++; }
        // con fallas no se guarda la firma: la próxima vez se vuelve a intentar lo que faltó
        const reg = { id, fecha: id, firma: fallas ? '' : firma, revisado: ahora, via, url, filas: nuevas.length, creadas, actualizadas, iguales: plan.iguales, parecidas: plan.parecidas.length, ids, fallas,
          conflictos: plan.conflictos.slice(0, 30), deshecha: false };
        ctx.pintar();
        await anotar(fallas ? 'parcial' : 'ok', { reg });
        ctx.avisar('Sincronicé tu dashboard: ' + creadas + ' nuevas y ' + actualizadas + ' actualizadas' + (fallas ? '; ' + fallas + ' no se guardaron' : '') +
          (plan.conflictos.length ? '. ' + plan.conflictos.length + (plan.conflictos.length === 1 ? ' cambio no lo apliqué porque choca' : ' cambios no los apliqué porque chocan') + ' con lo que ya estaba en AerIA' : '') + '.');
      } catch (e) {
        const c = e && e.code, det = e && e.message ? ' (' + String(e.message).slice(0, 140) + ')' : '';
        const nav = L.navInfo || {};
        // un error de Claude al ordenar trae su código aparte (iaCodigo): no se confunde con uno del navegador
        const diag = { codigo: String(c || (e && e.iaCodigo) || 'sin código'), paso: L.pasoNav || '', mensaje: String((e && e.message) || '').slice(0, 200), permiso, auth: nav.auth || '', soloLectura: nav.ro || '' };
        if (c === 'server_not_connected' || c === 'not_granted' || c === 'capability_disabled' || c === 'capability_removed') return anotar('sin-app', { diag });
        if (c === 'not_in_manifest') return anotar('no-permitido', { diag });
        // la app no deja que una página abra programas del propio computador (localhost): no es un permiso que falte
        if (c === 'cancelled' && /only web sites|aren.t available to artifacts/i.test(String((e && e.message) || ''))) return anotar('solo-web', { diag });
        if (c === 'cancelled') return anotar('cancelada', { diag });
        if (c === 'approval_required') return anotar('sin-aprobar', { diag });
        if (c === 'tool_error') return anotar('error', { msg: 'El navegador de Claude no pudo abrir o leer el dashboard. ¿Está encendido en tu Mac (localhost:8765)?' + det, diag });
        return anotar('error', { msg: 'No se pudo sincronizar ahora.' + det, diag });
      }
    }
    /* Revierte entera la última sincronización: lo que creó se borra (si nadie lo tocó
       después) y lo que actualizó vuelve a como estaba. */
    async function deshacerSync() {
      const reg = ctx.syncEstado(); if (!reg || !reg.id || reg.deshecha) return;
      if (!ctx.listoParaSync()) { ctx.avisar('Todavía estoy cargando tus datos. Intenta en unos segundos.'); return; }
      let conflictos = 0, fallas = 0;
      for (const id of reg.ids || []) {
        const q = ctx.cotizaciones().find(x => x.id === id);
        if (!q) { fallas++; continue; }      // no está en lo cargado: no se puede asegurar que se deshizo
        const r = C.deshacerPor(q, reg.id, ahoraISO());
        if (r.creada) {
          const ajenas = (q.historial || []).some(h => h.resp !== reg.id && !h.deshecha && Object.keys(h.cambios || {}).length);
          if (ajenas) conflictos++; else if (!await ctx.borrarCot(id)) fallas++;
        } else if (r.conflicto) conflictos++;
        else if (r.cotizacion && !await ctx.guardarCot(r.cotizacion)) fallas++;
      }
      await ctx.guardarSync(Object.assign({}, reg, { deshecha: !conflictos && !fallas, deshechaEl: ahoraISO() }));
      ctx.pintar();
      ctx.avisar(conflictos ? 'Deshice la sincronización salvo ' + conflictos + (conflictos === 1 ? ' cotización que cambió' : ' cotizaciones que cambiaron') + ' después.' : fallas ? 'No pude deshacer ' + fallas + ' cambios. Intenta de nuevo.' : 'Listo: deshice la última sincronización.');
    }
    function syncHtml() {
      const s = L.sync || {}, reg = ctx.syncEstado();
      const hace = f => { const m = Math.round((Date.now() - new Date(f).getTime()) / 60000); return m < 1 ? 'recién' : m < 60 ? 'hace ' + m + ' min' : m < 1440 ? 'hace ' + Math.round(m / 60) + ' h' : 'el ' + F.fCorta(f.slice(0, 10)); };
      if (s.corriendo) return `<span class="sync-linea"><span class="punto-vivo"></span>${esc(s.paso || 'Sincronizando…')}</span>`;
      const ult = reg && reg.fecha ? `Última: ${hace(reg.fecha)} · ${reg.creadas || 0} nuevas, ${reg.actualizadas || 0} actualizadas${reg.deshecha ? ' (deshecha)' : ''}` : 'Aún no se ha sincronizado';
      const msgs = {
        'sin-app': 'Para que se conecte sola, abre AerIA en la app de escritorio de Claude, desde una conversación de Cowork. En este navegador usa el marcador.',
        esperando: 'Cargando tus datos…',
        'sin-cambios': 'Tu dashboard no cambió desde la última vez.',
        'al-dia': 'Tu dashboard ya estaba al día en AerIA.',
        vacio: 'El navegador abrió el dashboard, pero llegó vacío. ¿Está encendido en tu Mac (localhost:8765)?',
        'sin-filas': 'Leí el dashboard pero no encontré cotizaciones en él.',
        'sin-ia': 'El dashboard no viene como tabla y Claude no está disponible ahora para ordenarlo.',
        revisar: s.raras ? 'Algo de la lectura se ve raro: lo dejé en el importador para que lo revises antes de guardar.' : 'Hay ' + (s.n || 'muchos') + ' cambios: revísalos en el importador antes de guardarlos.',
        'no-permitido': 'No permitiste que AerIA use el navegador de Claude. Actívalo en los permisos de la página y vuelve a apretar «Sincronizar ahora».',
        bloqueado: 'Tienes bloqueado el navegador de Claude para AerIA. Actívalo en los permisos de la página y vuelve a apretar «Sincronizar ahora».',
        cancelada: 'La app de Claude no dejó abrir tu dashboard: la pregunta para usar su navegador se rechazó. Al apretar «Sincronizar ahora» vuelve a preguntar: elige Permitir. ' + OTRA_VIA,
        'sin-aprobar': 'La app de Claude esperaba tu aprobación para usar su navegador y no la recibió (o la pregunta no se vio). Vuelve a apretar «Sincronizar ahora» y elige Permitir. ' + OTRA_VIA,
        'solo-web': 'La app de Claude no deja que una página abra programas de tu computador, como tu dashboard en localhost: solo sitios web. Para traerlo, pídele a Claude en Chrome que lea tu dashboard y lo cargue en AerIA, o usa el marcador «AerIA · Extraer» y el importador.',
        'pestana-sin-tabla': 'Leí la pestaña abierta en el navegador de Claude, pero no trae una tabla de cotizaciones que pueda importar sola. Usa el marcador «AerIA · Extraer» o el importador.',
        'revisar-pestana': 'Leí la pestaña abierta: revisa en el importador que sea tu dashboard y guarda.',
        error: s.msg || 'No se pudo sincronizar.',
      };
      const conf = reg && !reg.deshecha && (reg.conflictos || []).length ? reg.conflictos : [];
      const d = s.diag && s.diag.codigo ? s.diag : null;
      const aviso = (s.estado && msgs[s.estado] ? `<span class="c-sub">${esc(msgs[s.estado])}</span>` : '') +
        (['bloqueado', 'no-permitido'].includes(s.estado) ? '<button class="enlace-btn" type="button" data-com="sync-permisos">Revisar permisos</button>' : '') +
        (['cancelada', 'sin-aprobar'].includes(s.estado) ? '<button class="enlace-btn" type="button" data-com="sync-pestana">Leer la pestaña abierta</button>' : '') +
        (d ? `<span class="c-sub mono">Detalle: ${esc(d.codigo)}${d.paso ? ' al ' + esc(PASOS[d.paso] || d.paso) : ''}${d.permiso ? ' · permiso ' + esc(d.permiso) : ''}${d.activa ? ' · pestaña activa: ' + esc(d.activa) : ''}</span>` : '') +
        (conf.length ? `<details class="c-sub"><summary>${conf.length} ${conf.length === 1 ? 'cambio de tu dashboard no lo apliqué: choca' : 'cambios de tu dashboard no los apliqué: chocan'} con lo que ya estaba en AerIA</summary><ul>${conf.slice(0, 12).map(x => '<li>' + esc(x.cliente || x.id) + ' · ' + esc(etq(x.campo)) + ': aquí dice «' + esc(valorLegible(x.campo, x.aerIA)) + '», tu dashboard «' + esc(valorLegible(x.campo, x.fuente)) + '»' + (x.motivo === 'reabre una cerrada' ? ' (volvería a abrir una cotización que ya tuvo respuesta)' : '') + '</li>').join('')}</ul></details>` : '');
      return `<span class="sync-linea"><b>Conexión automática</b> · ${esc(ult)}
        <button class="enlace-btn" type="button" data-com="sync">Sincronizar ahora</button>${reg && reg.id && !reg.deshecha && (reg.ids || []).length ? '<button class="enlace-btn" type="button" data-com="sync-deshacer">Deshacer la última</button>' : ''}</span>${aviso}`;
    }
    function pintarSync() { for (const el of $$('[data-sync]')) el.innerHTML = syncHtml(); }
    let autoHecho = false;
    async function autoSync() {
      if (autoHecho || !ctx.listoParaSync()) return;
      autoHecho = true;
      const reg = ctx.syncEstado() || {};
      // el intervalo se mide desde el último intento (con o sin cambios), no solo desde el último éxito
      const ultimo = [reg.fecha, reg.revisado, reg.intento && reg.intento.fecha].filter(Boolean).sort().pop();
      if (ultimo && Date.now() - new Date(ultimo).getTime() < SYNC_CADA) return;
      // si la persona rechazó el navegador, no se vuelve a preguntar solo: queda «Sincronizar ahora»
      // tras un rechazo, o una lectura de la pestaña abierta, solo un clic vuelve a llamar al navegador
      if (reg.intento && (['cancelada', 'sin-aprobar', 'no-permitido', 'bloqueado', 'pestana-sin-tabla', 'solo-web'].includes(reg.intento.estado) || reg.intento.rechazo)) { L.sync = { estado: reg.intento.estado, diag: reg.intento }; pintarSync(); return; }
      if (await navegadorDisponible()) sincronizar(false); else { L.sync = { estado: 'sin-app' }; pintarSync(); }
    }

    /* ---------------- eventos ---------------- */
    document.addEventListener('click', async ev => {
      const t = ev.target.closest('[data-com]');
      if (!t) return;
      const a = t.dataset.com;
      if (a === 'marcador') { ev.preventDefault(); ctx.avisar('Aquí dentro este botón no hace nada: arrástralo a tu barra de marcadores.'); return; }
      if (a === 'abrir') {
        // el selector de estado y los demás controles de la fila no abren el editor
        if (ev.target !== t && ev.target.closest('select, input, label, textarea, a, button:not([data-com])')) return;
        abrirEditor(t.dataset.id); return;
      }
      if (a === 'nueva') { abrirEditor('nueva'); return; }
      if (a === 'cerrar') { cerrarEditor(); return; }
      if (a === 'importar') { abrirImportador(); return; }
      if (a === 'sync') { sincronizar(true); return; }
      if (a === 'sync-deshacer') { deshacerSync(); return; }
      if (a === 'sync-pestana') { leerPestanaAbierta(); return; }
      if (a === 'sync-permisos') {
        const p = await ctx.permisos().catch(() => null);
        try { if (!p) throw new Error('sin panel'); await p.manage(); }
        catch (e) { ctx.avisar('Abre el menú de permisos de esta página (arriba) y activa el navegador de Claude para AerIA.'); }
        return;
      }
      if (a === 'exportar') { exportarCSV(); return; }
      if (a === 'filtro') { L.filtro = t.dataset.valor; L.ver = 40; render(); return; }
      if (a === 'ver-mas') { L.ver += 40; $('#tabla-cot').innerHTML = tablaHtml(R()); return; }
      if (a === 'copiar-extractor') {
        try { await navigator.clipboard.writeText(C.EXTRACTOR); ctx.avisar('Copié el código. En tu dashboard abre la consola (Cmd+Option+J), pégalo y presiona Enter.'); }
        catch (e) { ctx.avisar('No pude copiar aquí. Arrastra el botón «AerIA · Extraer» a tu barra de marcadores.'); }
        return;
      }
      if (a === 'seguimiento') { anotarSeguimiento(); return; }
      if (a === 'borrar') { L.borrar = true; pintarBorrar('[data-com="borrar-no"]'); return; }
      if (a === 'borrar-no') { L.borrar = false; pintarBorrar('[data-com="borrar"]'); return; }
      if (a === 'borrar-si') { const id = L.editor; if (await ctx.borrarCot(id)) { cerrarEditor(); ctx.pintar(); } return; }
      if (a === 'deshacer') {
        const actual = ctx.cotizaciones().find(q => q.id === L.editor); if (!actual) return;
        const d = C.deshacer(actual, ahoraISO());
        if (!d) { $('#ce-msg').textContent = 'No hay cambios que deshacer.'; return; }
        L.histAbierto = true;
        if (await ctx.guardarCot(d)) { pintarEditor(true); $('#ce-msg').textContent = 'Cambio deshecho.'; ctx.pintar(); }
        else $('#ce-msg').textContent = 'No se pudo deshacer. Intenta de nuevo.';
        return;
      }
      if (a === 'preguntar') {
        const q = ctx.cotizaciones().find(x => x.id === L.editor); cerrarEditor();
        if (q) ctx.preguntar('¿Qué tan probable es ganar la cotización [' + q.id + '] de ' + q.cliente + ' (' + F.clp(q.monto || 0) + ')? ¿Qué hago para ganarla y cuál es el próximo paso, con fecha? Respóndeme simple, en pocas frases.');
        return;
      }
      if (a === 'imp-cerrar') { L.imp = null; const p = $('#panel-importar'); if (p) { p.hidden = true; p.innerHTML = ''; } return; }
      if (a === 'imp-volver') { L.imp.paso = Math.max(1, L.imp.paso - 1); L.imp.msg = ''; pintarImportador(); return; }
      if (a === 'imp-leer') { leerImportacion($('#imp-texto').value, L.imp.origen && L.imp.origen !== 'texto pegado' ? L.imp.origen : 'texto pegado'); return; }
      if (a === 'imp-plan') { planificar(); return; }
      if (a === 'imp-go') { ejecutarImportacion(); return; }
      if (a === 'imp-ia') {
        const I0 = L.imp; if (!I0 || I0.ordenando) return;
        const txt = $('#imp-texto').value.trim();
        I0.texto = txt;
        if (!txt) { I0.msg = 'Primero pega tus datos.'; pintarImportador(); return; }
        const MAX = 50000;
        I0.ordenando = true; I0.msg = 'AerIA está ordenando los datos…'; pintarImportador();
        try {
          const arr = await ctx.iaJSON('Convierte este export de un dashboard de cotizaciones de una empresa chilena en un JSON array de objetos con estas claves: cliente, monto (número en pesos, sin puntos), estado (enviada, negociacion, ganada, perdida o vencida), fecha_cotizacion (AAAA-MM-DD o ""), fecha_cierre (AAAA-MM-DD o ""), linea (sence, curso_cerrado, aoc, servicios, escuela, flota, venta_equipos u otro), descripcion, folio, contacto, notas. Una fila por cotización; ignora totales y encabezados. Responde solo el JSON.\n\n' + txt.slice(0, MAX));
          const filas = Array.isArray(arr) ? arr.filter(x => x && typeof x === 'object' && !Array.isArray(x)) : [];
          I0.conjuntos = filas.length ? [{ origen: 'Ordenado por AerIA', filas, columnas: Object.keys(filas[0] || {}), puntaje: 9, mapeo: C.sugerirMapeo(Object.keys(filas[0] || {})) }] : [];
          if (!filas.length) { I0.msg = 'AerIA no encontró cotizaciones en lo que pegaste.'; return; }
          I0.elegido = 0; I0.mapeo = Object.assign({}, I0.conjuntos[0].mapeo); I0.paso = 2;
          I0.msg = txt.length > MAX ? 'Ojo: era muy largo y AerIA solo leyó los primeros ' + MAX.toLocaleString('es-CL') + ' caracteres de ' + txt.length.toLocaleString('es-CL') + '. Revisa que estén todas, o usa «Revisar lo pegado», que lee todo.' : '';
        } catch (e) { I0.msg = e && e.message ? e.message : 'No se pudo ordenar ahora.'; }
        finally { I0.ordenando = false; if (L.imp === I0) pintarImportador(); }
      }
    });
    document.addEventListener('change', async ev => {
      const t = ev.target;
      if (t.dataset.comEstado) {
        const actual = ctx.cotizaciones().find(q => q.id === t.dataset.comEstado); if (!actual) return;
        const r = C.aplicar(actual, { estado: t.value }, 'usuario', '', ahoraISO());
        if (await ctx.guardarCot(r.cotizacion)) ctx.pintar(); else t.value = actual.estado;
      } else if (t.dataset.comInput === 'linea' || t.dataset.comInput === 'orden') {
        L[t.dataset.comInput] = t.value; L.ver = 40; $('#tabla-cot').innerHTML = tablaHtml(R());
      } else if (t.dataset.comInput === 'imp-unir' && L.imp) {
        L.imp.unir = t.checked; planificar();
      } else if (t.dataset.comInput === 'imp-dashboard' && L.imp) {
        L.imp.esDashboard = t.checked;
      } else if (t.dataset.comInput === 'imp-conjunto') {
        L.imp.elegido = Number(t.value); L.imp.mapeo = Object.assign({}, L.imp.conjuntos[L.imp.elegido].mapeo); pintarImportador();
      } else if (t.dataset.comMapeo) {
        L.imp.mapeo[t.dataset.comMapeo] = t.value; pintarImportador();
      } else if (t.dataset.comArchivo && t.files && t.files[0]) {
        const f = t.files[0]; L.imp.origen = f.name;
        // Excel guarda los CSV en Windows-1252: si no es UTF-8 válido, se lee así
        const buf = await f.arrayBuffer();
        let txt;
        try { txt = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (e) { txt = new TextDecoder('windows-1252').decode(buf); }
        leerImportacion(txt, f.name);
      }
    });
    document.addEventListener('input', ev => {
      if (ev.target.dataset.comInput === 'texto') { L.texto = ev.target.value; L.ver = 40; $('#tabla-cot').innerHTML = tablaHtml(R()); }
      else if (ev.target.id === 'imp-texto' && L.imp) L.imp.texto = ev.target.value;   // lo pegado sobrevive a un repintado
    });
    document.addEventListener('submit', ev => { if (ev.target.id === 'f-cot') { ev.preventDefault(); guardarFormulario(); } });
    document.addEventListener('keydown', ev => {
      if (ev.key === 'Escape' && L.editor) { cerrarEditor(); return; }
      // Enter en «Qué pasó» o en su fecha anota el seguimiento (no envía todo el formulario)
      if (ev.key === 'Enter' && (ev.target.id === 'ce-seg-nota' || ev.target.id === 'ce-seg-fecha')) { ev.preventDefault(); anotarSeguimiento(); return; }
      // el foco no sale del editor con Tab
      if (ev.key === 'Tab' && L.editor) {
        const caja = $('#modal-com .modal-caja'); if (!caja) return;
        const f = $$('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex="0"]', caja).filter(x => x.offsetParent !== null);
        if (!f.length) return;
        const i = f.indexOf(document.activeElement);
        if (ev.shiftKey && (i <= 0)) { ev.preventDefault(); f[f.length - 1].focus(); }
        else if (!ev.shiftKey && (i === f.length - 1 || i < 0)) { ev.preventDefault(); f[0].focus(); }
        return;
      }
      if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.classList && ev.target.classList.contains('fila-cot')) { ev.preventDefault(); abrirEditor(ev.target.dataset.id); }
    });
    document.addEventListener('paste', ev => {
      if (S.tab !== 'comercial' || (ev.target && /input|textarea/i.test(ev.target.tagName))) return;
      const txt = ev.clipboardData && ev.clipboardData.getData('text');
      if (!txt || txt.length < 20) return;
      ev.preventDefault(); abrirImportador(); leerImportacion(txt, /aeria-extractor/.test(txt.slice(0, 200)) ? 'extractor de AerIA' : 'texto pegado');
    });

    return { render, abrirEditor, abrirImportador, cerrarEditor, autoSync, pintarSync, sincronizar };
  };
})();
