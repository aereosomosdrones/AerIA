#!/usr/bin/env node
/* Pruebas del módulo comercial con datos FICTICIOS (el repo es público).
   Uso: node tools/probar_comercial.js */
const path = require('path');
const C = require(path.resolve(__dirname, '..', 'app', 'comercial.js'));

let ok = 0, mal = 0;
function prueba(nombre, fn) {
  try { fn(); ok++; console.log('  ✓ ' + nombre); } catch (e) { mal++; console.log('  ✗ ' + nombre + '\n      ' + e.message); }
}
function igual(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((msg || '') + ' esperado ' + JSON.stringify(b) + ', obtuve ' + JSON.stringify(a)); }
function cierto(v, msg) { if (!v) throw new Error(msg || 'esperaba verdadero'); }

console.log('Lectura de valores');
prueba('montos chilenos', () => {
  igual(C.leerMonto('$1.234.567'), 1234567);
  igual(C.leerMonto('1.234.567,50'), 1234568);
  igual(C.leerMonto('4,7M'), 4700000);
  igual(C.leerMonto('4,7 MM'), 4700000);
  igual(C.leerMonto('450 mil'), 450000);
  igual(C.leerMonto('1234567.00'), 1234567);
  igual(C.leerMonto('1,234,567'), 1234567);
  igual(C.leerMonto(''), 0);
  igual(C.leerMonto(98000), 98000);
});
prueba('fechas en varios formatos', () => {
  igual(C.leerFecha('2026-09-28'), '2026-09-28');
  igual(C.leerFecha('28-09-2026'), '2026-09-28');
  igual(C.leerFecha('28/9/26'), '2026-09-28');
  igual(C.leerFecha('28 sep 2026'), '2026-09-28');
  igual(C.leerFecha(46293), '2026-09-28');
  igual(C.leerFecha('mañana'), '');
});
prueba('estados con sinónimos', () => {
  igual(C.leerEstado('Adjudicada'), 'ganada');
  igual(C.leerEstado('No adjudicada'), 'perdida');
  igual(C.leerEstado('En negociación'), 'negociacion');
  igual(C.leerEstado('Enviada al cliente'), 'enviada');
  igual(C.leerEstado('OC recibida'), 'ganada');
  igual(C.leerEstado('vencida'), 'vencida');
  igual(C.leerEstado('???'), '');
});
prueba('líneas desde el texto', () => {
  igual(C.leerLinea('', 'Curso Nivel 1 cerrado para 8 funcionarios'), 'curso_cerrado');
  igual(C.leerLinea('', 'Grupo SENCE vía OTEC'), 'sence');
  igual(C.leerLinea('', 'Asesoría AOC DAN 151'), 'aoc');
  igual(C.leerLinea('', 'Termografía de paneles'), 'servicios');
  igual(C.leerLinea('', '2 cupos curso abierto Nivel 1'), 'escuela');
  igual(C.leerLinea('aoc', ''), 'aoc');
});

console.log('Historial y deshacer');
prueba('aplicar registra cambios y fecha de cierre', () => {
  const r1 = C.aplicar(null, { cliente: 'Empresa Uno', monto: '1.000.000', estado: 'enviada', fecha_cotizacion: '2026-09-01' }, 'usuario', '', '2026-09-01T10:00:00Z');
  const r2 = C.aplicar(r1.cotizacion, { estado: 'ganada' }, 'AerIA', 'Confirmó por correo', '2026-10-05T10:00:00Z');
  igual(r2.cotizacion.estado, 'ganada');
  igual(r2.cotizacion.fecha_cierre, '2026-10-05');
  igual(Object.keys(r2.cambios).sort(), ['estado', 'fecha_cierre']);
  igual(r2.cotizacion.historial.length, 2);
  const d = C.deshacer(r2.cotizacion, '2026-10-05T11:00:00Z');
  igual(d.estado, 'enviada');
  igual(d.fecha_cierre, '');
  igual(d.creada, '2026-09-01T10:00:00Z');
});
prueba('crear o importar una ganada sin fecha no inventa la fecha de cierre', () => {
  const r = C.aplicar(null, { cliente: 'Empresa Siete', monto: 100, estado: 'ganada' }, 'importación', '', '2026-10-10T10:00:00Z');
  igual(r.cotizacion.fecha_cierre, '');
});

console.log('Importación');
prueba('CSV con punto y coma, encabezados en español', () => {
  const csv = 'N°;Cliente;Detalle;Monto;Estado;Fecha\n101;Empresa Uno;Curso cerrado 6 personas;$1.200.000;Enviada;01-09-2026\n102;Muni Dos;Termografía;"2.500.000";Adjudicada;05/08/2026\n';
  const c = C.conjuntos(csv)[0];
  igual(c.mapeo.cliente, 'Cliente'); igual(c.mapeo.monto, 'Monto'); igual(c.mapeo.folio, 'N°'); igual(c.mapeo.descripcion, 'Detalle');
  const q = C.mapear(c.filas, c.mapeo, 'prueba');
  igual(q.length, 2);
  igual(q[1].estado, 'ganada'); igual(q[1].monto, 2500000); igual(q[1].linea, 'servicios'); igual(q[0].fecha_cotizacion, '2026-09-01');
  igual(q[0].id, 'f-101');
});
prueba('payload del extractor: elige la tabla correcta y lee localStorage', () => {
  const payload = JSON.stringify({ fuente: 'aeria-extractor', tablas: [
    { titulo: 'menú', filas: [['Inicio', 'Ayuda']] },
    { titulo: 'Cotizaciones', filas: [['Cliente', 'Monto', 'Estado'], ['Empresa Tres', '900.000', 'Perdida'], ['Empresa Cuatro', '1.500.000', 'En negociación']] },
  ], almacenamiento: { cot_v2: JSON.stringify({ items: [{ cliente: 'X', total: 10, estado: 'ganada', fecha: '2026-01-01' }] }) }, globales: {} });
  const cs = C.conjuntos(payload);
  cierto(cs.some(c => c.origen === 'Tabla «Cotizaciones» del dashboard'), 'no encontró la tabla de cotizaciones');
  cierto(cs.some(c => /localStorage/.test(c.origen)), 'no leyó localStorage');
  cierto(!cs.some(c => /menú/.test(c.origen)), 'la tabla del menú no debía ser candidata');
  cierto(cs.every((c, i) => i === 0 || cs[i - 1].puntaje >= c.puntaje), 'candidatos sin ordenar por puntaje');
});
prueba('tabla HTML pegada', () => {
  const html = '<table><tr><th>Empresa</th><th>Valor</th><th>Status</th></tr><tr><td>Empresa Cinco</td><td>$ 300.000</td><td>Ganada</td></tr></table>';
  const c = C.conjuntos(html)[0];
  const q = C.mapear(c.filas, c.mapeo);
  igual(q[0].cliente, 'Empresa Cinco'); igual(q[0].monto, 300000); igual(q[0].estado, 'ganada');
});
prueba('plan de importación: crea, actualiza y no duplica', () => {
  const existentes = [C.limpiar({ folio: '101', cliente: 'Empresa Uno', monto: 1200000, estado: 'enviada' })];
  const nuevas = [C.limpiar({ folio: '101', cliente: 'Empresa Uno', monto: 1200000, estado: 'ganada' }), C.limpiar({ folio: '103', cliente: 'Otra', monto: 5 }), C.limpiar({ folio: '103', cliente: 'Otra', monto: 5 })];
  const p = C.planImportacion(nuevas, existentes);
  igual(p.crear.length, 1); igual(p.actualizar.length, 1); igual(p.actualizar[0].cambios, { estado: 'ganada' });
});

console.log('Análisis');
const HOY = '2026-10-10';
const lista = [
  { folio: 'A1', cliente: 'Empresa Uno', linea: 'curso_cerrado', monto: 1200000, estado: 'ganada', fecha_cotizacion: '2026-08-01', fecha_cierre: '2026-08-20' },
  { folio: 'A2', cliente: 'Muni Dos', linea: 'servicios', monto: 2000000, estado: 'ganada', fecha_cotizacion: '2026-09-01', fecha_cierre: '2026-10-02', factura_folio: '' },
  { folio: 'A3', cliente: 'Empresa Tres', linea: 'aoc', monto: 3000000, estado: 'negociacion', fecha_cotizacion: '2026-09-15', fecha_cierre_estimada: '2026-10-25', proximo_seguimiento: '2026-10-08' },
  { folio: 'A4', cliente: 'Empresa Cuatro', linea: 'sence', monto: 2400000, estado: 'enviada', fecha_cotizacion: '2026-09-01' },
  { folio: 'A5', cliente: 'Empresa Cinco', linea: 'curso_cerrado', monto: 900000, estado: 'perdida', fecha_cotizacion: '2026-07-01', fecha_cierre: '2026-07-20' },
  { folio: 'A6', cliente: 'Persona Seis', linea: 'escuela', monto: 298000, estado: 'ganada', fecha_cotizacion: '2026-10-01', fecha_cierre: '2026-10-03' },
];
const sii = [{ folio: 501, fecha: '2026-08-21', cliente: 'Empresa Uno SpA', monto: 1200000, estado: 'Cobrada', tipo: 'Factura exenta' }];
const R = C.analizar(lista, HOY, { meta: 5000000, equilibrio: 4500000, minimo: 3000000, sii, siiCorte: '2026-09-30' });
prueba('totales, ganado y tasa de cierre', () => {
  igual(R.abiertas.n, 2); igual(R.abiertas.monto, 5400000);
  igual(Math.round(R.abiertas.ponderado), Math.round(3000000 * 0.6 + 2400000 * 0.3));
  igual(R.ganadas.monto, 3498000); igual(R.ganadas.mes, 2298000);
  igual(Math.round(R.tasa.monto * 1000), Math.round(3498000 / 4398000 * 1000));
  igual(Math.round(R.ciclo), Math.round((19 + 31 + 2) / 3));
});
prueba('pronóstico B2B excluye la escuela y usa la fecha estimada', () => {
  const oct = R.pronostico.meses[0];
  igual(oct.mes, '2026-10'); igual(oct.ganado, 2000000);
  cierto(oct.esperado >= 1800000, 'A3 debía caer en octubre');
});
prueba('cruce con el SII sugiere la factura de la venta sin folio', () => {
  const s = R.sii.find(x => x.id === 'f-a1');
  igual(s.como, 'sugerida'); igual(s.folio, 501); igual(s.cobro, 'si');
  igual(R.sii.find(x => x.id === 'f-a2'), undefined, 'A2 es posterior al corte del SII');
});
prueba('alertas comerciales y acciones', () => {
  const ids = R.alertas.map(a => a.id);
  cierto(ids.some(i => i.startsWith('com-seguimientos-')), 'falta seguimiento vencido');
  cierto(ids.some(i => i.startsWith('com-frias-')), 'falta cotización sin contacto');
  cierto(ids.some(i => i.startsWith('com-facturar-')), 'falta ganada sin factura');
  cierto(ids.includes('com-pronostico-2026-10') || ids.includes('com-pronostico-2026-11'), 'falta pronóstico bajo el equilibrio');
  cierto(R.acciones.some(a => a.id === 'com-seg-f-a3-2026-10-08' && a.cuando === 'hoy'), 'falta la acción de seguimiento de A3 (con la fecha en el id)');
  cierto(R.eventos.length >= 1, 'faltan eventos');
});
prueba('resumen para el chat', () => {
  const t = C.resumenParaIA(R);
  cierto(/COMERCIAL/.test(t) && /Pronóstico/.test(t), 'resumen incompleto');
});

console.log('Casos de la revisión');
prueba('montos con texto alrededor y tipo de monto', () => {
  igual(C.leerMonto('$1.200.000 + IVA'), 1200000);
  igual(C.leerMonto('$1.200.000.-'), 1200000);
  igual(C.leerMonto('1.200.000 neto'), 1200000);
  igual(C.leerMonto('$ 1.200.000 IVA incluido'), 1200000);
  igual(C.leerMonto('Total: $1.200.000'), 1200000);
  igual(C.leerMonto('Cotización 15 por $980.000'), 980000);
  igual(C.leerTipoMonto('$1.200.000 + IVA'), 'neto');
  igual(C.leerTipoMonto('$1.428.000 IVA incluido'), 'con_iva');
  igual(C.limpiar({ cliente: 'X', monto: '$1.428.000 IVA incluido' }).monto_tipo, 'con_iva');
});
prueba('fechas: más formatos y fechas imposibles', () => {
  igual(C.leerFecha('28 de septiembre de 2026'), '2026-09-28');
  igual(C.leerFecha('28-sep-26'), '2026-09-28');
  igual(C.leerFecha('2026/09/28'), '2026-09-28');
  igual(C.leerFecha('sep 28, 2026'), '2026-09-28');
  igual(C.leerFecha('9/28/2026'), '2026-09-28');
  igual(C.leerFecha(new Date(2026, 8, 28, 12).getTime()), '2026-09-28');
  igual(C.leerFecha('46293.5'), '2026-09-28');
  igual(C.leerFecha('31-02-2026'), '');
  igual(C.leerFecha('2026-13-01'), '');
});
prueba('estados: negaciones, órdenes de compra y facturación', () => {
  igual(C.leerEstado('No aprobada'), 'perdida');
  igual(C.leerEstado('No ganada'), 'perdida');
  igual(C.leerEstado('Pendiente de OC'), 'negociacion');
  igual(C.leerEstado('Sin OC'), 'negociacion');
  igual(C.leerEstado('Por facturar'), 'ganada');
  igual(C.leerEstado('Desistida'), 'perdida');
  igual(C.leerEstado('Rechazada'), 'perdida');
  igual(C.leerEstado('Adjudicada, pendiente de OC'), 'ganada');
});
prueba('líneas: cursos institucionales no van a la escuela', () => {
  igual(C.leerLinea('', 'Curso Nivel 1 para 8 funcionarios Municipalidad Ficticia'), 'curso_cerrado');
  igual(C.leerLinea('Curso', 'Pack N1+N2 para 6 funcionarios'), 'curso_cerrado');
  igual(C.leerLinea('', 'Capacitación Nivel 1 in situ, servicio agrícola ficticio'), 'curso_cerrado');
  igual(C.leerLinea('', 'Curso de vuelo nocturno para la Brigada Ficticia'), 'curso_cerrado');
  igual(C.leerLinea('Servicios', 'Vuelo de inspección y curso de uso del informe'), 'servicios');
  igual(C.leerLinea('', '1 cupo Nivel 1'), 'escuela');
});
prueba('cobro y probabilidad', () => {
  igual(C.leerCobro('No cobrada'), 'no');
  igual(C.leerCobro('No pagada'), 'no');
  igual(C.leerCobro('Sí'), 'si');
  igual(C.leerProb(0.6), 60);
  igual(C.leerProb('0,6'), 60);
  igual(C.leerProb('60%'), 60);
  igual(C.leerProb('Alta'), 80);
  igual(C.leerProb('???'), '');
});
prueba('notas largas: se conserva lo más nuevo', () => {
  const q = C.limpiar({ cliente: 'X', notas: 'x'.repeat(4000) });
  const r = C.aplicar(q, { notas: q.notas + '\n2026-10-10: llamé' }, 'usuario', '', '2026-10-10T10:00:00Z');
  cierto(r.cotizacion.notas.endsWith('llamé'), 'se perdió la nota nueva');
});
prueba('deshacer: pila, sin rehacer y sin borrar la creación', () => {
  const t = i => '2026-10-0' + i + 'T10:00:00Z';
  let q = C.aplicar(null, { cliente: 'Empresa Ficticia', monto: 1000000, estado: 'enviada' }, 'usuario', 'Creada', t(1)).cotizacion;
  cierto(!C.puedeDeshacer(q), 'no se debe ofrecer deshacer la creación');
  q = C.aplicar(q, { estado: 'negociacion' }, 'usuario', '', t(2)).cotizacion;
  q = C.aplicar(q, { monto: 2000000 }, 'usuario', '', t(3)).cotizacion;
  q = C.deshacer(q, t(4)); igual(q.monto, 1000000); igual(q.estado, 'negociacion');
  q = C.deshacer(q, t(5)); igual(q.monto, 1000000); igual(q.estado, 'enviada');
  igual(C.deshacer(q, t(6)), null);
  igual(q.cliente, 'Empresa Ficticia');
});
prueba('deshacer lo que hizo una respuesta del chat (dos cambios a la misma cotización), sin tocar otra respuesta', () => {
  const R1 = { resp: '2026-10-10T10:00:00Z' }, R2 = { resp: '2026-10-10T10:03:00Z' };
  let q = C.aplicar(null, { cliente: 'Empresa Ficticia', monto: 1000000, estado: 'negociacion' }, 'usuario', '', '2026-10-01T10:00:00Z').cotizacion;
  q = C.aplicar(q, { estado: 'ganada' }, 'AerIA (chat)', '', '2026-10-10T10:00:01Z', R1).cotizacion;
  q = C.aplicar(q, { ultimo_contacto: '2026-10-10', proximo_seguimiento: '2026-10-17' }, 'AerIA (chat)', 'Seguimiento: llamé', '2026-10-10T10:00:02Z', R1).cotizacion;
  const r = C.deshacerPor(q, R1.resp, '2026-10-10T10:05:00Z');
  cierto(r.cotizacion, 'no deshizo');
  igual(r.cotizacion.estado, 'negociacion'); igual(r.cotizacion.fecha_cierre, ''); igual(r.cotizacion.proximo_seguimiento, '');
  cierto(C.deshacerPor(r.cotizacion, R1.resp, '2026-10-10T10:06:00Z').nada, 'un reintento no debe contar como conflicto');
  const q2 = C.aplicar(q, { monto: 2000000 }, 'AerIA (chat)', '', '2026-10-10T10:03:01Z', R2).cotizacion;
  cierto(C.deshacerPor(q2, R1.resp, '2026-10-10T10:05:00Z').conflicto, 'otra respuesta cambió después: conflicto');
  const r2 = C.deshacerPor(q2, R2.resp, '2026-10-10T10:04:00Z');
  const r1 = C.deshacerPor(r2.cotizacion, R1.resp, '2026-10-10T10:05:00Z');
  cierto(r1.cotizacion, 'deshecha la 2ª respuesta, la 1ª ya se puede deshacer');
  igual(r1.cotizacion.estado, 'negociacion'); igual(r1.cotizacion.monto, 1000000);
  const q3 = C.aplicar(q, { monto: 5 }, 'usuario', '', '2026-10-10T10:01:00Z').cotizacion;
  cierto(C.deshacerPor(q3, R1.resp, '2026-10-10T10:05:00Z').conflicto, 'una persona cambió después: conflicto');
});
prueba('deshacer no inventa la fecha de cierre', () => {
  let q = C.aplicar(null, { cliente: 'Empresa Ficticia', monto: 1000000, estado: 'ganada' }, 'importación', '', '2026-10-01T10:00:00Z').cotizacion;
  q = C.aplicar(q, { estado: 'perdida' }, 'usuario', '', '2026-10-05T10:00:00Z').cotizacion;
  igual(q.fecha_cierre, '2026-10-05');
  q = C.deshacer(q, '2026-10-06T10:00:00Z');
  igual(q.estado, 'ganada'); igual(q.fecha_cierre, '');
});
prueba('importar sin columna de estado ni monto no pisa lo existente', () => {
  const ex = [C.aplicar(null, { folio: '101', cliente: 'Empresa Uno', monto: 1200000, estado: 'ganada', linea: 'aoc', fecha_cierre: '2026-09-20' }, 'usuario', '', '2026-09-01T10:00:00Z').cotizacion];
  const c = C.conjuntos('Folio;Cliente;Detalle;Monto\n101;Empresa Uno;Proyecto especial;\n')[0];
  const p = C.planImportacion(C.mapear(c.filas, c.mapeo, 'prueba'), ex);
  igual(p.crear.length, 0);
  igual(p.actualizar.length, 1); igual(p.actualizar[0].cambios, { descripcion: 'Proyecto especial' });
});
prueba('importar el dashboard no duplica lo sembrado (SII, plan sin folio, monto con IVA)', () => {
  const ex = [
    C.aplicar(null, { id: 'sii-31', cliente: 'Empresa Uno SpA', monto: 1428000, monto_tipo: 'con_iva', estado: 'ganada', factura_folio: '31', fecha_cierre: '2026-09-21' }, 'AerIA (siembra)', '', '2026-10-01T10:00:00Z').cotizacion,
    C.aplicar(null, { id: 'plan-tres', cliente: 'Constructora Ficticia Ambiental SpA', monto: 3000000, estado: 'negociacion' }, 'AerIA (siembra)', '', '2026-10-01T10:00:00Z').cotizacion,
    C.aplicar(null, { id: 'web-cuatro', cliente: 'Empresa Cuatro', monto: 0, estado: 'ganada', fecha_cierre: '2026-09-15' }, 'AerIA (siembra)', '', '2026-10-01T10:00:00Z').cotizacion,
    C.aplicar(null, { id: 'sii-40', cliente: 'Municipalidad de San Ficticio', monto: 1450000, estado: 'ganada', factura_folio: '40', fecha_cierre: '2026-09-02' }, 'AerIA (siembra)', '', '2026-10-01T10:00:00Z').cotizacion,
  ];
  const csv = 'N°;Cliente;Detalle;Monto;Estado;Fecha\n15;Empresa Uno;Curso cerrado;1.200.000;Ganada;01-09-2026\n215;Constructora Ficticia;AOC;3.000.000;Ganada;15-09-2026\n216;Empresa Cuatro;Servicio;850.000;Ganada;10-09-2026\n217;Municipalidad de San Otro;Curso;1.450.000;Ganada;01-09-2026\n';
  const c = C.conjuntos(csv)[0];
  const p = C.planImportacion(C.mapear(c.filas, c.mapeo, 'prueba'), ex);
  igual(p.crear.map(q => q.cliente), ['Municipalidad de San Otro']);
  const u = Object.fromEntries(p.actualizar.map(x => [x.id, x.cambios]));
  igual(u['sii-31'].folio, '15'); igual(u['sii-31'].monto, undefined, 'no debía pisar el monto de la factura');
  igual(u['plan-tres'].estado, 'ganada');
  igual(u['web-cuatro'].monto, 850000, 'la sembrada sin monto toma el del dashboard');
});
prueba('folio repetido con otro cliente no pisa: se crea aparte', () => {
  const ex = [C.limpiar({ folio: 'COT-2026-15', cliente: 'Empresa Uno', monto: 100, estado: 'enviada' })];
  const p = C.planImportacion([C.limpiar({ folio: 'COT 2026/15', cliente: 'Empresa Dos', monto: 200, estado: 'enviada' })], ex);
  igual(p.actualizar.length, 0); igual(p.crear.length, 1);
  cierto(p.crear[0].id !== ex[0].id, 'el id nuevo choca con el existente');
});
prueba('sin folio, dos cotizaciones con distinto detalle no se descartan', () => {
  const c = C.conjuntos('Cliente;Detalle;Monto;Estado;Fecha\nMuni Dos;Curso N1 grupo A;1.200.000;Enviada;01-09-2026\nMuni Dos;Curso N1 grupo B;1.200.000;Enviada;01-09-2026')[0];
  const q = C.mapear(c.filas, c.mapeo, 'prueba');
  igual(C.planImportacion(q, []).crear.length, 2);
});
prueba('exportar CSV y volver a importarlo no duplica', () => {
  const qs = [C.aplicar(null, { folio: '1001', cliente: 'Empresa Uno', monto: 100, estado: 'enviada', notas: 'línea 1\nlínea 2; "con comillas"' }, 'usuario', '', '2026-10-01T10:00:00Z').cotizacion,
    C.aplicar(null, { cliente: 'Empresa Dos', monto: 200, estado: 'ganada' }, 'usuario', '', '2026-10-01T10:00:00Z').cotizacion];
  const campos = ['id'].concat(C.CAMPOS);
  const cel = v => { const s = String(v == null ? '' : v); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const csv = '﻿' + [campos.join(';')].concat(qs.map(q => campos.map(k => cel(q[k])).join(';'))).join('\n');
  const c = C.conjuntos(csv)[0];
  igual(c.filas.length, 2); igual(c.mapeo.id, 'id'); igual(c.mapeo.folio, 'folio');
  const p = C.planImportacion(C.mapear(c.filas, c.mapeo, 'prueba'), qs);
  igual(p.crear.length, 0); igual(p.actualizar.length, 0); igual(p.iguales, 2);
});
prueba('la fila de totales no se importa', () => {
  const payload = JSON.stringify({ fuente: 'aeria-extractor', tablas: [{ titulo: 'Cotizaciones', filas: [['N°', 'Cliente', 'Monto', 'Estado'], ['1', 'Empresa A', '1.000.000', 'Enviada'], ['2', 'Empresa B', '2.000.000', 'Ganada'], ['Total', '', '3.000.000', '']] }], almacenamiento: {}, globales: {} });
  const c = C.conjuntos(payload)[0];
  igual(C.mapear(c.filas, c.mapeo).map(q => q.cliente), ['Empresa A', 'Empresa B']);
});
prueba('cierre estimado vencido cuenta este mes; viejas sin fecha quedan estancadas', () => {
  const R1 = C.analizar([{ folio: 'B1', cliente: 'Empresa Uno', linea: 'aoc', monto: 6000000, estado: 'negociacion', fecha_cotizacion: '2026-08-01', fecha_cierre_estimada: '2026-09-30', ultimo_contacto: '2026-10-01' }], HOY, { equilibrio: 5e6, conectado: true });
  igual(Math.round(R1.pronostico.meses[0].esperado), 3600000);
  const R2 = C.analizar([{ folio: 'V1', cliente: 'Empresa Dos', monto: 5000000, estado: 'enviada', fecha_cotizacion: '2026-02-01', linea: 'curso_cerrado' }], HOY, { equilibrio: 5e6, conectado: true });
  igual(R2.pronostico.meses[0].esperado, 0); igual(R2.abiertas.estancadas, 1);
});
prueba('SII: sin falsos positivos por nombre parecido ni facturas anteriores', () => {
  const g = [{ folio: 'G1', cliente: 'Municipalidad de San Alfa Ficticio', monto: 1450000, estado: 'ganada', fecha_cotizacion: '2026-09-01', fecha_cierre: '2026-09-10' },
    { folio: 'G2', cliente: 'Minera Alfa', monto: 900000, estado: 'ganada', fecha_cotizacion: '2026-09-01', fecha_cierre: '2026-09-10' },
    { folio: 'G3', cliente: 'Empresa Cinco', monto: 500000, estado: 'ganada', fecha_cotizacion: '2026-09-01', fecha_cierre: '2026-09-10' }];
  const s = [{ folio: 77, fecha: '2026-09-12', cliente: 'Ilustre Municipalidad de San Beta Ficticio', monto: 1450000, estado: 'Cobrada', tipo: 'Factura exenta' },
    { folio: 78, fecha: '2026-09-12', cliente: 'Minera Beta', monto: 900000, estado: 'Cobrada', tipo: 'Factura exenta' },
    { folio: 79, fecha: '2026-03-02', cliente: 'Empresa Cinco SpA', monto: 500000, estado: 'Cobrada', tipo: 'Factura exenta' }];
  const R3 = C.analizar(g, HOY, { sii: s, siiCorte: '2026-09-30' });
  igual(R3.sii.map(x => x.como), ['sin-factura', 'sin-factura', 'sin-factura']);
  cierto(R3.alertas.some(a => a.id.startsWith('com-facturar-') && a.nivel === 'alta'), 'debían quedar por facturar');
});
prueba('cobro: «No pagada» avisa y lo cobrado según el SII no', () => {
  const g = [{ folio: 'P1', cliente: 'Empresa Seis', monto: 800000, estado: 'ganada', factura_folio: '77', cobrada: '', fecha_cierre: '2026-08-01' },
    { folio: 'P2', cliente: 'Empresa Siete', monto: 700000, estado: 'ganada', factura_folio: '78', cobrada: 'No pagada', fecha_cierre: '2026-08-01' }];
  const s = [{ folio: 77, fecha: '2026-08-02', cliente: 'Empresa Seis', monto: 800000, estado: 'Cobrada', tipo: 'Factura exenta' },
    { folio: 78, fecha: '2026-08-02', cliente: 'Empresa Siete', monto: 700000, estado: 'Por cobrar al 30-09', tipo: 'Factura exenta' }];
  const R4 = C.analizar(g, HOY, { sii: s });
  igual(R4.ganadas.porCobrar.map(q => q.folio), ['P2']);
});
prueba('sin fecha de cotización, la carga no cuenta como contacto; montos 0 sin «$0»', () => {
  const sem = C.aplicar(null, { cliente: 'Empresa Ocho', monto: 0, estado: 'enviada', fecha_cierre_estimada: '2026-09-01', proximo_seguimiento: '2026-10-20' }, 'AerIA (siembra)', '', '2026-10-10T10:00:00Z').cotizacion;
  const R5 = C.analizar([sem], HOY, {});
  igual(R5.cotizaciones[0].diasSinContacto, null);
  const textos = R5.acciones.map(a => a.titulo).concat(R5.eventos.map(e => e.titulo)).join(' | ');
  cierto(!/\$0/.test(textos), 'quedó un «$0»: ' + textos);
  cierto(/monto por completar/.test(textos), 'falta «monto por completar»: ' + textos);
});
prueba('ganadas con confianza baja o sin monto no piden factura', () => {
  const R6 = C.analizar([{ folio: 'U1', cliente: 'Empresa Nueve', monto: 130000, estado: 'ganada', fecha_cierre: '2026-09-20', confianza: 'baja' },
    { folio: 'U2', cliente: 'Empresa Diez', monto: 0, estado: 'ganada', fecha_cierre: '2026-09-20' }], HOY, {});
  cierto(!R6.alertas.some(a => a.id.startsWith('com-facturar-')), 'no debía pedir factura');
  cierto(!R6.acciones.some(a => a.id.startsWith('com-fac-')), 'no debía haber acción de factura');
});

prueba('cobro según el SII: facturado tarde, cobrada después del corte y por cobrar', () => {
  const g = [{ folio: 'K1', cliente: 'Empresa Once', monto: 300000, estado: 'ganada', factura_folio: '201', fecha_cierre: '2026-08-01' },
    { folio: 'K2', cliente: 'Empresa Doce', monto: 400000, estado: 'ganada', factura_folio: '202', fecha_cierre: '2026-08-01' },
    { folio: 'K3', cliente: 'Empresa Trece', monto: 500000, estado: 'ganada', factura_folio: '203', fecha_cierre: '2026-08-01' }];
  const s = [{ folio: 201, fecha: '2026-10-08', cliente: 'Empresa Once', monto: 300000, estado: 'Cobro del período, facturado tarde', tipo: 'Factura exenta' },
    { folio: 202, fecha: '2026-09-22', cliente: 'Empresa Doce', monto: 400000, estado: 'Por cobrar al 30-09', det: 'Según el registro interno, se pagó el 07-10.', tipo: 'Factura exenta' },
    { folio: 203, fecha: '2026-10-13', cliente: 'Empresa Trece', monto: 500000, estado: 'Por cobrar, según el registro', tipo: 'Factura exenta' }];
  igual(C.analizar(g, HOY, { sii: s }).ganadas.porCobrar.map(q => q.folio), ['K3']);
});
console.log('Casos de la segunda revisión');
prueba('instituciones distintas de la misma ciudad no se unen', () => {
  const ex = [C.aplicar(null, { id: 'sii-40', cliente: 'Ilustre Municipalidad de Ciudad Alfa', monto: 1200000, estado: 'ganada', factura_folio: '40', fecha_cierre: '2026-09-02' }, 'AerIA (siembra)', '', '2026-10-01T10:00:00Z').cotizacion,
    C.aplicar(null, { id: 'plan-x', cliente: 'Municipalidad de Ciudad Beta', monto: 0, estado: 'negociacion' }, 'AerIA (siembra)', '', '2026-10-01T10:00:00Z').cotizacion];
  const c = C.conjuntos('N°;Cliente;Monto;Estado;Fecha cierre\n301;Universidad de Ciudad Alfa;1.200.000;Ganada;01-09-2026\n302;Gobierno Regional de Ciudad Beta;4.800.000;Ganada;01-09-2026\n303;Cuerpo de Bomberos de Ciudad Alfa;1.200.000;Ganada;01-09-2026\n')[0];
  const p = C.planImportacion(C.mapear(c.filas, c.mapeo, 'prueba'), ex);
  igual(p.crear.length, 3); igual(p.parecidas.length, 0);
  igual(C.parecido('Universidad de Ciudad Alfa', 'Municipalidad de Ciudad Alfa'), 0);
  igual(C.parecido('I. Municipalidad de Ciudad Alfa', 'Municipalidad de Ciudad Alfa'), 1);
});
prueba('el orden de las filas no cambia el resultado: primero las exactas', () => {
  const ex = [C.aplicar(null, { id: 'sii-31', cliente: 'Empresa Uno SpA', monto: 1000000, estado: 'ganada', factura_folio: '31', fecha_cierre: '2026-09-21' }, 'AerIA (siembra)', '', '2026-10-01T10:00:00Z').cotizacion];
  const c = C.conjuntos('N°;Cliente;Monto;Estado;Factura;Fecha cierre\n40;Empresa Uno;1.000.000;Ganada;;20-09-2026\n15;Empresa Uno;1.000.000;Ganada;31;20-09-2026\n')[0];
  const p = C.planImportacion(C.mapear(c.filas, c.mapeo, 'prueba'), ex);
  igual(p.actualizar.length, 1); igual(p.actualizar[0].como, 'exacta'); igual(p.actualizar[0].cambios.folio, '15');
  igual(p.crear.map(q => q.folio), ['40']);
});
prueba('un aparte con sufijo se reencuentra al reimportar (no se duplica ni se pisa)', () => {
  const ex = [C.limpiar({ folio: '15', cliente: 'Empresa Uno', monto: 100, estado: 'enviada' })];
  const fila = () => C.mapear(C.conjuntos('N°;Cliente;Monto;Estado\n15;Empresa Dos;2.500.000;En negociación\n')[0].filas, { folio: 'N°', cliente: 'Cliente', monto: 'Monto', estado: 'Estado' }, 'prueba');
  const p1 = C.planImportacion(fila(), ex);
  igual(p1.crear.length, 1);
  const creada = C.aplicar(null, p1.crear[0], 'importación', '', '2026-10-01T10:00:00Z').cotizacion;
  const p2 = C.planImportacion(fila(), ex.concat([creada]));
  igual(p2.crear.length, 0); igual(p2.iguales, 1);
});
prueba('una ganada con ciclo largo se reconoce por la fecha de cierre', () => {
  const ex = [C.aplicar(null, { id: 'sii-50', cliente: 'Empresa Delta SpA', monto: 1200000, estado: 'ganada', factura_folio: '50', fecha_cierre: '2026-08-25' }, 'AerIA (siembra)', '', '2026-10-01T10:00:00Z').cotizacion];
  const c = C.conjuntos('N°;Cliente;Monto;Estado;Fecha;Fecha cierre\n9;Empresa Delta;1.200.000;Ganada;10-03-2026;20-08-2026\n')[0];
  const p = C.planImportacion(C.mapear(c.filas, c.mapeo, 'prueba'), ex);
  igual(p.crear.length, 0); igual(p.actualizar[0].id, 'sii-50');
});
prueba('tipo de monto: lo que va pegado al número', () => {
  igual(C.leerTipoMonto('$1.200.000 neto ($1.428.000 con IVA)'), 'neto');
  igual(C.leerTipoMonto('$1.200.000 + IVA (total $1.428.000 IVA incluido)'), 'neto');
  igual(C.leerTipoMonto('Neto $1.200.000 / Bruto $1.428.000'), 'neto');
  igual(C.leerTipoMonto('$1.428.000 IVA incluido'), 'con_iva');
  igual(C.leerMonto('1 200 000'), 1200000);
  igual(C.leerMonto('2 cupos 298.000'), 2);
});
prueba('servicios con palabras de curso siguen siendo servicios', () => {
  igual(C.leerLinea('', 'Pack de 4 vuelos de inspección de techumbre'), 'servicios');
  igual(C.leerLinea('', 'Piloto y dron para filmación de evento'), 'servicios');
  igual(C.leerLinea('', 'Entrenamiento de pilotos de la empresa'), 'curso_cerrado');
});
prueba('estados pendientes no son pérdidas; ganada esperando OC es ganada', () => {
  igual(C.leerEstado('Sin adjudicar'), 'enviada');
  igual(C.leerEstado('Aún no aprobada'), 'enviada');
  igual(C.leerEstado('No confirmada aún'), 'enviada');
  igual(C.leerEstado('Ganada, pendiente de OC'), 'ganada');
});
prueba('«Total Chile SpA» con estado es un cliente; la fila «Total» sola no', () => {
  const c = C.conjuntos('Cliente;Monto;Estado\nTotal Ficticia SpA;1.000.000;Enviada\nTotal;1.000.000;\n')[0];
  igual(C.mapear(c.filas, c.mapeo).map(q => q.cliente), ['Total Ficticia SpA']);
});

console.log('Informe contable con facturas posteriores al corte');
prueba('«Posible cobro del período» no queda por cobrar', () => {
  const g = [{ folio: 'M1', cliente: 'Empresa Catorce SpA', monto: 150000, estado: 'ganada', factura_folio: '301', fecha_cierre: '2026-08-21', cobrada: '' }];
  const s = [{ folio: 301, fecha: '2026-10-13', cliente: 'Empresa Catorce SpA', monto: 150000, estado: 'Posible cobro del período', tipo: 'Factura exenta' }];
  igual(C.analizar(g, HOY, { sii: s }).ganadas.porCobrar.length, 0);
});
prueba('nombres hechos solo de palabras comunes se comparan enteros', () => {
  igual(C.parecido('Servicios y Consultores SpA', 'Servicios y Consultores SpA (proyecto X)'), 1);
  igual(C.parecido('Servicios y Consultores SpA', 'Sociedad Comercial SpA'), 0);
});
prueba('un «no cobrada» de la siembra cede ante el SII; el de una persona se respeta', () => {
  const sem = C.aplicar(null, { cliente: 'Empresa Quince', monto: 200000, estado: 'ganada', factura_folio: '302', fecha_cierre: '2026-09-22', cobrada: 'no' }, 'AerIA (siembra)', '', '2026-10-01T10:00:00Z').cotizacion;
  const man = C.aplicar(C.aplicar(null, { cliente: 'Empresa Dieciséis', monto: 300000, estado: 'ganada', factura_folio: '303', fecha_cierre: '2026-09-22' }, 'AerIA (siembra)', '', '2026-10-01T10:00:00Z').cotizacion,
    { cobrada: 'no' }, 'usuario', '', '2026-10-02T10:00:00Z').cotizacion;
  const s = [{ folio: 302, fecha: '2026-09-22', cliente: 'Empresa Quince', monto: 200000, estado: 'Por cobrar al 30-09', det: 'Según el registro interno, se pagó el 07-10.', tipo: 'Factura exenta' },
    { folio: 303, fecha: '2026-09-22', cliente: 'Empresa Dieciséis', monto: 300000, estado: 'Cobrada', tipo: 'Factura exenta' }];
  const R7 = C.analizar([sem, man], HOY, { sii: s });
  igual(R7.ganadas.porCobrar.map(q => q.cliente), ['Empresa Dieciséis']);
  cierto(R7.cotizaciones.find(q => q.cliente === 'Empresa Quince').cobroDesactualizado, 'debía marcar el cobro desactualizado');
});
prueba('facturas del SII a empresas sin venta en Comercial', () => {
  const g = [{ folio: 'N1', cliente: 'Empresa Diecisiete SpA', monto: 100000, estado: 'ganada', factura_folio: '310', fecha_cierre: '2026-10-01' }];
  const s = [{ folio: 310, fecha: '2026-10-01', cliente: 'Empresa Diecisiete SpA', rut: '76.000.001-1', monto: 100000, estado: 'Cobrada', tipo: 'Factura exenta' },
    { folio: 311, fecha: '2026-10-08', cliente: 'Empresa Dieciocho SpA', rut: '77.000.002-2', monto: 2000000, estado: 'Por cobrar, según el registro', tipo: 'Factura exenta' },
    { folio: 312, fecha: '2026-10-08', cliente: 'Persona Ficticia', rut: '12.345.678-5', monto: 149000, estado: 'Cobrada', tipo: 'Factura exenta' },
    { folio: 9, fecha: '2026-10-09', cliente: 'Empresa Dieciocho SpA', rut: '77.000.002-2', monto: 2000000, estado: 'Nota de crédito', tipo: 'Nota de crédito' }];
  const R8 = C.analizar(g, HOY, { sii: s });
  igual(R8.siiSinVenta.map(x => x.folio), [311]);
  cierto(R8.alertas.some(a => a.id.startsWith('com-sii-sin-venta-')), 'falta la alerta');
});

console.log('Sincronización con el dashboard');
prueba('tablas dentro del texto de la página: solo la tabla con encabezado', () => {
  const texto = 'Dashboard\nTotal abierto\t$9.000.000\tKPI\n\nN°\tCliente\tMonto\tEstado\n' +
    'D-1\tEmpresa Ficticia A\t1.000.000\tEnviada\nN°\tCliente\tMonto\tEstado\nD-2\tEmpresa Ficticia B\t2.000.000\tGanada\n' +
    'Pie de página sin tabulador\nCliente\tMotivo\tFecha\nEmpresa Ficticia C\tPrecio\t01/09/2026\n';
  const t = C.tablasDeTexto(texto);
  cierto(t.length >= 1, 'sin tablas');
  igual(t[0].filas.map(f => f['Cliente']), ['Empresa Ficticia A', 'Empresa Ficticia B']);
  cierto(!t.some(x => x.filas.some(f => /\$9\.000\.000/.test(JSON.stringify(f)))), 'leyó los KPI como cotización');
});
prueba('lectura sospechosa: clientes que no son clientes y montos que saltan', () => {
  const ex = [C.aplicar(null, { folio: 'D-9', cliente: 'Empresa Ficticia D', monto: 1000000, estado: 'enviada' }, 'dashboard', '', '2026-10-01T10:00:00Z').cotizacion];
  const nuevas = C.mapear([{ 'N°': 'D-9', Cliente: 'Empresa Ficticia D', Monto: '100', Estado: 'Enviada' }, { 'N°': 'D-10', Cliente: 'Cliente', Monto: '1.000.000', Estado: 'Enviada' }],
    { folio: 'N°', cliente: 'Cliente', monto: 'Monto', estado: 'Estado' }, 'dashboard');
  const plan = C.planImportacion(nuevas, ex, { respetarEdiciones: true, mismaFuente: true });
  const a = C.anomalias(nuevas, plan, ['N°', 'Cliente', 'Monto', 'Estado']);
  cierto(a.some(x => /no parece un cliente/.test(x)), 'faltó el encabezado leído como cliente');
  cierto(a.some(x => /el monto pasaría/.test(x)), 'faltó el salto de monto');
});
prueba('la sincronización no pisa lo editado en AerIA ni reabre una cerrada', () => {
  let q = C.aplicar(null, { folio: 'D-20', cliente: 'Empresa Ficticia E', monto: 1370000, estado: 'enviada', proximo_seguimiento: '2026-10-05' }, 'dashboard', '', '2026-10-01T10:00:00Z').cotizacion;
  q = C.aplicar(q, { proximo_seguimiento: '2026-10-20' }, 'usuario', '', '2026-10-02T10:00:00Z').cotizacion;
  let g = C.aplicar(null, { folio: 'D-21', cliente: 'Empresa Ficticia F', monto: 800000, estado: 'enviada' }, 'dashboard', '', '2026-10-01T10:00:00Z').cotizacion;
  g = C.aplicar(g, { estado: 'ganada', fecha_cierre: '2026-10-03' }, 'chat', '', '2026-10-03T10:00:00Z').cotizacion;
  const nuevas = C.mapear([{ 'N°': 'D-20', Cliente: 'Empresa Ficticia E', Monto: '1.370.000', Estado: 'En negociación', Seguimiento: '06/10/2026' },
    { 'N°': 'D-21', Cliente: 'Empresa Ficticia F', Monto: '800.000', Estado: 'Enviada', Seguimiento: '' }],
    { folio: 'N°', cliente: 'Cliente', monto: 'Monto', estado: 'Estado', proximo_seguimiento: 'Seguimiento' }, 'dashboard');
  const p = C.planImportacion(nuevas, [q, g], { respetarEdiciones: true });
  const u = p.actualizar.find(x => x.id === q.id);
  igual(u && u.cambios.estado, 'negociacion');
  cierto(!('proximo_seguimiento' in u.cambios), 'pisó el seguimiento editado');
  igual(p.conflictos.map(c => c.campo + ':' + c.motivo).sort(), ['estado:reabre una cerrada', 'proximo_seguimiento:editado en AerIA']);
  cierto(!p.actualizar.some(x => x.id === g.id), 'reabrió la ganada');
  const sinRegla = C.planImportacion(nuevas, [q, g]);
  cierto(sinRegla.actualizar.some(x => x.id === g.id), 'el importador manual sí propone el cambio');
});
prueba('sin folio: la misma cotización del dashboard con otro monto no se duplica', () => {
  const e = C.aplicar(null, { cliente: 'Empresa Ficticia G', descripcion: 'Curso cerrado 4 personas', monto: 900000, estado: 'enviada', fecha_cotizacion: '2026-10-02' }, 'dashboard', '', '2026-10-02T10:00:00Z').cotizacion;
  e.origen = 'dashboard';
  const n = C.mapear([{ Cliente: 'Empresa Ficticia G', Detalle: 'Curso cerrado 4 personas', Monto: '1.640.000', Estado: 'Enviada', Fecha: '02/10/2026' }],
    { cliente: 'Cliente', descripcion: 'Detalle', monto: 'Monto', estado: 'Estado', fecha_cotizacion: 'Fecha' }, 'dashboard');
  const p = C.planImportacion(n, [e], { mismaFuente: true });
  igual(p.crear.length, 0); igual(p.actualizar[0].cambios.monto, 1640000);
  const e2 = Object.assign({}, e, { id: e.id + '-b' });
  const p2 = C.planImportacion(n, [e, e2], { mismaFuente: true });
  igual(p2.ambiguas.length, 1);
});

console.log('\n' + ok + ' pruebas bien, ' + mal + ' con error');
process.exit(mal ? 1 : 0);
