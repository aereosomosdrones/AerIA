#!/usr/bin/env node
/* Corre el motor de AerIA sobre datos/ y muestra lo que vería la página.
   Uso: node tools/probar_motor.js [AAAA-MM-DD] [--resumen] */
const fs = require('fs'), path = require('path');
const raiz = path.resolve(__dirname, '..');
const leer = p => JSON.parse(fs.readFileSync(path.join(raiz, 'datos', p), 'utf8'));
const M = require(path.join(raiz, 'app', 'motor.js'));
const D = {
  finanzas: leer('privado/finanzas.json'), plan: leer('privado/plan2027.json'),
  modelo: leer('privado/modelo2027.json'), cotizaciones: leer('privado/cotizaciones.json'),
  cursos: leer('publico/cursos.json'), licitaciones: leer('publico/licitaciones.json'), notas: [],
  comercial: fs.existsSync(path.join(raiz, 'datos', 'privado', 'comercial.json')) ? leer('privado/comercial.json') : { cotizaciones: [] },
};
const hoy = process.argv.find(a => /^\d{4}-\d{2}-\d{2}$/.test(a)) || M.fmt.iso(new Date());
const I = M.analizar(D, hoy, new Date(hoy + 'T13:00:00-03:00'));
if (process.argv.includes('--resumen')) { const r = M.resumenParaIA(D, I); console.log(r); console.log('\n[' + Buffer.byteLength(r) + ' bytes]'); process.exit(0); }
console.log('== BRIEFING:', I.briefing.titular); I.briefing.parrafos.forEach(p => console.log('  ' + p));
console.log('\n== ALERTAS (' + I.alertas.length + ')'); I.alertas.forEach(a => console.log(' ', a.nivel.padEnd(11), a.foco.padEnd(8), a.titulo));
console.log('\n== AGENDA (' + I.agenda.length + ')'); I.agenda.forEach(a => console.log(' ', String(a.prioridad), a.cuando.padEnd(16), a.titulo));
console.log('\n== VIENE'); I.viene.slice(0, 18).forEach(e => console.log(' ', e.fecha, String(e.dias).padStart(3), e.tipo.padEnd(10), e.titulo));
console.log('\n== TABLERO'); I.tablero.forEach(t => console.log(' ', t.estado.padEnd(9), t.indicador, '→', t.valor));
console.log('\n== ESCENARIOS'); I.futuro.escenarios.forEach(e => console.log(' ', e.nombre.padEnd(22), M.fmt.mm(e.b2b), '→', M.fmt.mm(e.resultado)));
console.log('  equilibrio', M.fmt.mm(I.futuro.equilibrio), 'plan B', M.fmt.mm(I.futuro.equilibrioPlanB), 'runway', I.futuro.runwayDias.toFixed(2));
console.log('\n== PASADO', JSON.stringify({ flujo: I.pasado.flujoOperacional, socio: I.pasado.socioNeto, cof: I.pasado.cofundador, otec: I.pasado.otec, caja: I.pasado.cajaFinal, b2b: I.pasado.meses.map(m => m.b2b), esc: I.pasado.meses.map(m => m.escuela), cac: I.pasado.meses.map(m => Math.round(m.cac)) }));
console.log('== CURSOS', JSON.stringify(I.cursos.resN1), JSON.stringify(I.cursos.resN23), 'racha', I.cursos.racha);
console.log('== POR COBRAR', I.porCobrar.map(p => p.cliente + ' ' + p.saldo).join(' | '));
console.log('== CRUCE', JSON.stringify(I.cruce && I.cruce.estado));
if (I.comercial) {
  const R = I.comercial;
  console.log('== COMERCIAL', R.total, 'cotizaciones · abiertas', R.abiertas.n, M.fmt.mm(R.abiertas.monto), '· ponderado', M.fmt.mm(R.abiertas.ponderado), '· ganadas', R.ganadas.n, M.fmt.mm(R.ganadas.monto), '· tasa', R.tasa.monto, '· ciclo', R.ciclo && Math.round(R.ciclo));
  console.log('   pronóstico', R.pronostico.meses.map(f => f.etiqueta + ' ' + M.fmt.mm(f.total)).join(' | '));
  console.log('   alertas', R.alertas.map(a => a.id).join(', '));
}
