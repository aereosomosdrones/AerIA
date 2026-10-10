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
  igual(C.leerMonto('3,3M'), 3300000);
  igual(C.leerMonto('3,3 MM'), 3300000);
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
  { folio: 'A4', cliente: 'Empresa Cuatro', linea: 'sence', monto: 2688000, estado: 'enviada', fecha_cotizacion: '2026-09-01' },
  { folio: 'A5', cliente: 'Empresa Cinco', linea: 'curso_cerrado', monto: 900000, estado: 'perdida', fecha_cotizacion: '2026-07-01', fecha_cierre: '2026-07-20' },
  { folio: 'A6', cliente: 'Persona Seis', linea: 'escuela', monto: 298000, estado: 'ganada', fecha_cotizacion: '2026-10-01', fecha_cierre: '2026-10-03' },
];
const sii = [{ folio: 501, fecha: '2026-08-21', cliente: 'Empresa Uno SpA', monto: 1200000, estado: 'Cobrada', tipo: 'Factura exenta' }];
const R = C.analizar(lista, HOY, { meta: 6078000, equilibrio: 5296000, minimo: 4000000, sii, siiCorte: '2026-09-30' });
prueba('totales, ganado y tasa de cierre', () => {
  igual(R.abiertas.n, 2); igual(R.abiertas.monto, 5688000);
  igual(Math.round(R.abiertas.ponderado), Math.round(3000000 * 0.6 + 2688000 * 0.3));
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
  cierto(ids.includes('com-seguimientos'), 'falta seguimiento vencido');
  cierto(ids.includes('com-frias'), 'falta cotización sin contacto');
  cierto(ids.includes('com-facturar'), 'falta ganada sin factura');
  cierto(ids.includes('com-pronostico-2026-10') || ids.includes('com-pronostico-2026-11'), 'falta pronóstico bajo el equilibrio');
  cierto(R.acciones.some(a => a.id === 'com-seg-f-a3' && a.cuando === 'hoy'), 'falta la acción de seguimiento de A3');
  cierto(R.eventos.length >= 1, 'faltan eventos');
});
prueba('resumen para el chat', () => {
  const t = C.resumenParaIA(R);
  cierto(/COMERCIAL/.test(t) && /Pronóstico/.test(t), 'resumen incompleto');
});

console.log('\n' + ok + ' pruebas bien, ' + mal + ' con error');
process.exit(mal ? 1 : 0);
