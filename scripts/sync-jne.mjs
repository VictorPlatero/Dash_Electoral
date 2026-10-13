import { mkdir, writeFile, readFile, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { validateCandidate } from '../src/schema.mjs';

const API = 'https://votoinformado.jne.gob.pe/api/v1';
const clean = value => String(value ?? '').trim();
export function plainText(value) {
  let result = clean(value).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?\s*>|<\/p\s*>/gi, '\n').replace(/<[^>]*>/g, '');
  for (let pass = 0; pass < 2; pass++) result = result.replace(/&amp;/gi, '&').replace(/&nbsp;/gi, ' ').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&#(x[0-9a-f]+|\d+);/gi, (_, code) => { const number = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1),16) : Number(code); return number >= 0 && number <= 0x10ffff ? String.fromCodePoint(number) : ''; });
  return result.replace(/[ \t]+/g, ' ').replace(/\n\s*\n/g, '\n').trim();
}
const year = value => /^\d{4}$/.test(clean(value)) ? Number(value) : null;
const amount = value => value == null || value === '' ? null : Number.isFinite(Number(value)) ? Number(value) : null;

export function mapProfile(profile, roster, consultedAt) {
  const g = profile.datoGeneral;
  if (!g || !['GOBERNADOR REGIONAL', 'ALCALDE PROVINCIAL'].includes(g.cargo) || g.postulaDepartamento !== 'TACNA' || (g.cargo === 'ALCALDE PROVINCIAL' && g.postulaProvincia !== 'TACNA')) throw new Error('Ficha fuera del ámbito');
  const education = [], f = profile.formacionAcademica || {};
  if (f.educacionBasica?.tengoEduBasica === 'SI') education.push({ level: 'Básica', degree: `Primaria ${f.educacionBasica.concluidoEduPrimaria === 'SI' ? 'concluida' : 'sin concluir'} · Secundaria ${f.educacionBasica.concluidoEduSecundaria === 'SI' ? 'concluida' : 'sin concluir'}`, institution: '', completed: f.educacionBasica.concluidoEduSecundaria === 'SI' });
  const groups = [
    ['educacionTecnico', 'Técnica', 'centroEstudio', 'carreraTecnico', 'concluidoEduTec', 'anioTitulo'],
    ['educacionNoUniversitaria', 'No universitaria', 'centroEstudio', 'carreraNoUni', 'concluidoNoUni', 'anioTitulo'],
    ['educacionUniversitaria', 'Universitaria', 'universidad', 'carreraUni', 'concluidoEduUni', 'anioBachiller'],
    ['educacionPosgrado', 'Posgrado', 'txCenEstudioPosgrado', 'txEspecialidadPosgrado', 'concluidoPosgrado', 'txAnioPosgrado'],
    ['educacionPosgradoOtro', 'Posgrado', 'txCenEstudioPosgradoOtro', 'txEspecialidadPosgradoOtro', 'concluidoPosgradoOtro', 'txAnioPosgradoOtro']
  ];
  for (const [key, level, institution, degree, completed, date] of groups) for (const item of f[key] || []) {
    if (clean(item[degree])) education.push({ level, institution: clean(item[institution]), degree: clean(item[degree]), completed: item[completed] === 'SI', year: year(item[date]), note: clean(item.txComentario) });
  }
  const political = [
    ...(profile.trayectoria?.cargoEleccion || []).map(item => ({ kind: 'Cargo electivo', position: clean(item.cargoEleccion), organization: clean(item.orgPolCargoElec), startYear: year(item.anioCargoElecDesde), endYear: year(item.anioCargoElecHasta) })),
    ...(profile.trayectoria?.cargoPartidario || []).map(item => ({ kind: 'Cargo partidario', position: clean(item.cargoPartidario || item.cargoPartido), organization: clean(item.orgPolCargoPartidario || item.orgPolCargoPartido), startYear: year(item.anioCargoPartiDesde), endYear: year(item.anioCargoPartiHasta) })),
    ...(profile.renunciaEfectuada || []).map(item => ({ kind: 'Renuncia', position: 'Renuncia declarada', organization: clean(item.orgPolRenunciaOp), startYear: year(item.anioRenunciaOp), endYear: year(item.anioRenunciaOp) }))
  ];
  const legal = ['sentenciaPenal', 'sentenciaObliga'].flatMap(key => (profile[key] || []).map(item => ({ kind: key === 'sentenciaPenal' ? 'Registro penal declarado' : 'Registro de obligaciones declarado', subject: clean(item.materia), outcome: clean(item.fallo), court: clean(item.fuero), caseNumber: clean(item.expediente), date: clean(item.fecSentencia), note: clean(item.txComentario) })));
  const dj = profile.declaracionJurada, income = [...(dj?.ingreso || [])].sort((a,b) => clean(b.anioIngresos).localeCompare(clean(a.anioIngresos)))[0];
  const sum = values => values.every(value => amount(value) !== null) ? values.reduce((total, value) => total + amount(value), 0) : null;
  const reviewedSections = [];
  if (profile.formacionAcademica) reviewedSections.push('education');
  if (Array.isArray(profile.experienciaLaboral)) reviewedSections.push('experience');
  if (profile.trayectoria && Array.isArray(profile.renunciaEfectuada)) reviewedSections.push('political');
  if (Array.isArray(profile.sentenciaPenal) && Array.isArray(profile.sentenciaObliga)) reviewedSections.push('legal');
  if (dj) reviewedSections.push('finances');
  return validateCandidate({
    id: g.idHojaVida, name: [g.nombres, g.apellidoPaterno, g.apellidoMaterno].map(clean).join(' '), party: clean(g.organizacionPolitica),
    role: g.cargo === 'GOBERNADOR REGIONAL' ? 'regional' : 'municipal', scope: g.cargo === 'GOBERNADOR REGIONAL' ? 'Departamento de Tacna' : 'Provincia de Tacna', status: clean(g.estado),
    source: { name: 'JNE · Voto Informado · DJHV', url: `https://votoinformado.jne.gob.pe/candidatos/hoja-vida/${encodeURIComponent(g.idHojaVida)}`, consultedAt, pdfUrl: roster.rutaHojaVida ? `https://mpesije.jne.gob.pe/apidocs/${roster.rutaHojaVida}` : '' },
    reviewedSections, education, political, legal,
    experience: (profile.experienciaLaboral || []).filter(item => clean(item.centroTrabajo)).map(item => ({ organization: clean(item.centroTrabajo), position: clean(item.ocupacionProfesion) || 'Sin detalle de ocupación', startYear: year(item.anioTrabajoDesde), endYear: year(item.anioTrabajoHasta) })),
    finances: dj ? { year: year(income?.anioIngresos), annualIncome: amount(income?.totalIngresos), publicIncome: income ? sum([income.remuBrutaPublico, income.rentaIndividualPublico, income.otroIngresoPublico]) : null, privateIncome: income ? sum([income.remuBrutaPrivado, income.rentaIndividualPrivado, income.otroIngresoPrivado]) : null, properties: Array.isArray(dj.bienInmueble) ? dj.bienInmueble.length : null, vehicles: Array.isArray(dj.bienMueble) ? dj.bienMueble.length : null } : null,
    additional: (profile.informacionAdicional || []).map(item => clean(item.infoAdicional)).filter(Boolean),
    annotations: (profile.anotacionMarginal || []).map(item => ({ section: clean(item.rubro), date: clean(item.fePublicacion || item.feRegistro), before: plainText(item.dice), after: plainText(item.debeDecir) }))
  });
}

async function request(path, body) {
  const cachePath = `research/jne-${createHash('sha256').update(path + JSON.stringify(body ?? null)).digest('hex')}.json`;
  if (process.argv.includes('--resume')) {
    try { const cache = JSON.parse(await readFile(cachePath, 'utf8')); if (Date.now() - cache.savedAt < 86400000) return cache.data; } catch {}
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await new Promise(resolve => setTimeout(resolve, 1000));
      const response = await fetch(API + path, { signal: AbortSignal.timeout(20000), headers: { accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) });
      if (!response.ok) throw new Error(`JNE: HTTP ${response.status}`);
      const result = await response.json();
      if (!result.success || !result.data) throw new Error('Respuesta JNE no disponible');
      await mkdir('research', { recursive: true });
      await writeFile(cachePath, JSON.stringify({ savedAt: Date.now(), data: result.data }));
      return result.data;
    } catch (error) { if (attempt === 2) throw error; await new Promise(resolve => setTimeout(resolve, 8000 * (attempt + 1))); }
  }
}

async function sync() {
  const consultedAt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const location = { dep: '22', pro: '01', dis: null };
  const lists = await request('/candidatos/organizaciones', location);
  const tasks = lists.flatMap(election => election.organizaciones.flatMap(org => org.listas.map(list => ({ ...list, party: org.organizacionPolitica }))));
  const candidates = [], errors = [], unavailableLists = [];
  // Three workers bound both concurrency and load on the public JNE service.
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (tasks.length) {
      const list = tasks.shift();
      try {
        const detail = await request('/candidatos/organizaciones/candidatos', { ...location, idSolicitudLista: list.idSolicitudLista });
        const roster = detail.flatMap(e => e.organizaciones.flatMap(o => o.listas.flatMap(l => l.candidatos || [...(l.gobernadores || []), ...(l.consejeros || [])])));
        const heads = roster.filter(item => ['GOBERNADOR REGIONAL', 'ALCALDE PROVINCIAL'].includes(item.cargoEleccion));
        if (!heads.length) errors.push({ party: list.party, error: 'No se recibió candidato titular' });
        for (const head of heads) {
          if (!head.idHojaVida) {
            if (![head.nombres, head.apellidoPaterno, head.apellidoMaterno].some(value => clean(value))) {
              unavailableLists.push({ party: list.party, listId: list.idSolicitudLista, note: 'El JNE no devuelve nombre ni DJHV del titular en esta lista.' });
              continue;
            }
            candidates.push(validateCandidate({ id: `jne-list-${list.idSolicitudLista}`, name: [head.nombres, head.apellidoPaterno, head.apellidoMaterno].map(clean).filter(Boolean).join(' '), party: list.party, role: head.cargoEleccion === 'GOBERNADOR REGIONAL' ? 'regional' : 'municipal', scope: head.cargoEleccion === 'GOBERNADOR REGIONAL' ? 'Departamento de Tacna' : 'Provincia de Tacna', status: clean(head.estadoCandidato), source: { name: 'JNE · Listado de candidaturas; DJHV no disponible', url: 'https://votoinformado.jne.gob.pe/candidatos/resultados?departamento=Tacna&depCode=22&provincia=Tacna&provCode=01', consultedAt }, reviewedSections: [], additional: ['El listado del JNE devuelve esta candidatura sin un identificador de hoja de vida. No se completan sus datos por inferencia.'] }));
            continue;
          }
          try { candidates.push(mapProfile(await request(`/candidatos/hoja-vida/${encodeURIComponent(head.idHojaVida)}`), head, consultedAt)); }
          catch (error) { errors.push({ party: list.party, id: head.idHojaVida, error: error.message }); }
        }
        console.log(`${list.party}: consultada`);
      } catch (error) { errors.push({ party: list.party, error: error.message }); }
    }
  }));
  if (errors.length) { console.error(errors); throw new Error('Sincronización incompleta: se conserva el archivo anterior.'); }
  if (!candidates.length) throw new Error('Sin candidaturas: se conserva el archivo anterior.');
  const unique = [...new Map(candidates.map(candidate => [candidate.id, candidate])).values()].sort((a,b) => a.name.localeCompare(b.name, 'es'));
  await mkdir('public', { recursive: true });
  await writeFile('public/candidates.json.tmp', JSON.stringify({ schemaVersion: 1, consultedAt, source: 'https://votoinformado.jne.gob.pe/', scope: 'Gobernador regional de Tacna y alcalde provincial de Tacna; solo titulares devueltos por el JNE en la consulta', unavailableLists, candidates: unique }, null, 2) + '\n');
  await rename('public/candidates.json.tmp', 'public/candidates.json');
  console.log(`${unique.length} fichas oficiales guardadas. Ejecuta build y reinicia el servidor para importarlas en SQLite.`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await sync();
