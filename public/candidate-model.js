export const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export const roleLabel = role => role === 'regional' ? 'Gobernador regional' : 'Alcalde provincial';
export const sections = ['education', 'experience', 'political', 'legal', 'finances'];
export const partyKey = value => normalize(value).replace(/[^a-z0-9]+/g, ' ').trim();
export const humanize = value => String(value ?? '').toLocaleLowerCase('es-PE').replace(/(^|\s|[(/-])\p{L}/gu, text => text.toLocaleUpperCase('es-PE'));

export function describeCandidate(candidate) {
  const reviewed = candidate.reviewedSections || [];
  const education = candidate.education || [], jobs = candidate.experience || [];
  const qualification = education.find(item => item.level === 'Universitaria' && item.completed && !/bachiller|no concluido/i.test(item.degree))
    || education.find(item => item.level !== 'Básica' && !/no concluido/i.test(item.degree));
  const sentences = [];
  if (qualification) sentences.push(`Declara estudios de ${qualification.degree.toLocaleLowerCase('es-PE')}${qualification.institution ? ' en ' + humanize(qualification.institution) : ''}.`);
  else if (!reviewed.includes('education')) sentences.push('Su formación académica está pendiente de revisión.');
  else if (education.some(item=>item.level!=='Básica')) sentences.push('La ficha registra estudios superiores sin detalle suficiente para describir un título.');
  else sentences.push(education.some(item=>item.level==='Básica') ? 'Declara educación básica; la ficha consultada no registra estudios superiores.' : 'La sección académica consultada no registra estudios.');
  if (reviewed.includes('experience')) {
    const latest = [...jobs].sort((a,b) => (b.endYear ?? 0) - (a.endYear ?? 0) || (b.startYear ?? 0) - (a.startYear ?? 0))[0];
    if (latest) sentences.push(`Su experiencia declarada incluye ${latest.position.toLocaleLowerCase('es-PE')} en ${humanize(latest.organization)}.`);
    else sentences.push('La sección laboral consultada no registra empleos.');
  }
  const elected = (candidate.political || []).filter(item => item.kind === 'Cargo electivo');
  if (elected.length) sentences.push(`Declara trayectoria como ${elected[0].position.toLocaleLowerCase('es-PE')}.`);
  return sentences.join(' ');
}

export function electoralFor(candidate, reports) {
  const election = reports?.[candidate.role];
  if (!election || partyKey(candidate.scope) !== partyKey(election.scope)) return null;
  const position = election.parties.findIndex(party => partyKey(party.name) === partyKey(candidate.party));
  if (position < 0) return null;
  const party = election.parties[position];
  const source = reports.sources.find(item => item.id === election.source);
  return { percent: party.percent, position: position + 1, party: party.name, role: candidate.role, scope: election.scope, cutoff: election.cutoff, progress: election.reportedProgress, source: { name: source.name, url: source.url, type: source.type }, status: 'Reporte parcial por organización' };
}

const median = values => {
  if (!values.length) return null;
  const sorted = [...values].sort((a,b) => a-b), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle-1] + sorted[middle]) / 2;
};

export function businessAnalytics(candidates) {
  const records = candidates.map(candidate => ({ candidate, analysis: candidate.analysis || analyze(candidate) }));
  const educationReviewed = records.filter(item => item.candidate.reviewedSections?.includes('education'));
  const experience = records.map(item => item.analysis.years).filter(value => value != null);
  const incomeGroups = new Map();
  for (const { candidate, analysis } of records) if (analysis.income != null && candidate.finances?.year != null) {
    const key = candidate.finances.year; if (!incomeGroups.has(key)) incomeGroups.set(key, []); incomeGroups.get(key).push(analysis.income);
  }
  const income = [...incomeGroups].sort((a,b) => b[0] - a[0]).map(([year, values]) => ({ year, count: values.length, median: median(values) }));
  const postgraduates = educationReviewed.filter(item => item.analysis.highest === 'Posgrado').length;
  const levels = ['Posgrado', 'Universitaria', 'No universitaria', 'Técnica', 'Básica', 'No registra estudios'];
  const education = levels.map(level => { const count = educationReviewed.filter(item => item.analysis.highest === level).length; return { level, count, percent: educationReviewed.length ? count / educationReviewed.length * 100 : null }; }).filter(item => item.count);
  const reported = candidates.filter(candidate => candidate.electoral?.percent != null);
  const roles = ['municipal', 'regional'].map(role => {
    const cohort = candidates.filter(candidate => candidate.role === role);
    return { role, total: cohort.length, reported: cohort.filter(candidate => candidate.electoral?.percent != null).length,
      ranking: cohort.filter(candidate => candidate.electoral?.percent != null).sort((a,b) => b.electoral.percent - a.electoral.percent).map(candidate => ({ id: candidate.id, name: candidate.name, party: candidate.party, photo: candidate.photo, electoral: candidate.electoral, years: analyze(candidate).years })) };
  }).filter(role => role.total);
  return { total: candidates.length, withPercent: reported.length, percentCoverage: candidates.length ? reported.length / candidates.length * 100 : null,
    averageExperience: experience.length ? experience.reduce((total,value) => total + value,0) / experience.length : null, experienceCount: experience.length,
    postgraduates, postgraduatePercent: educationReviewed.length ? postgraduates / educationReviewed.length * 100 : null, educationCount: educationReviewed.length, education, income, roles };
}

// Annual intervals are half-open: 2023–2026 contributes 3 years, not 4.
// Overlapping jobs are merged; a same-year job has no measurable annual duration.
export function experienceYears(jobs, cutoffYear = 2026) {
  const intervals = jobs.map(job => [job.startYear, job.endYear])
    .filter(([start, end]) => Number.isInteger(start) && Number.isInteger(end) && end >= start)
    .map(([start, end]) => [start, Math.min(end, cutoffYear)])
    .filter(([start, end]) => end >= start).sort((a, b) => a[0] - b[0]);
  let years = 0, previousEnd = -Infinity;
  for (const [start, end] of intervals) {
    years += Math.max(0, end - Math.max(start, previousEnd));
    previousEnd = Math.max(previousEnd, end);
  }
  return years;
}

export function analyze(candidate) {
  const reviewed = candidate.reviewedSections || [];
  const education = candidate.education || [];
  const experience = candidate.experience || [];
  const legal = candidate.legal || [];
  const missing = sections.filter(section => !reviewed.includes(section));
  const highest = ['Posgrado', 'Universitaria', 'No universitaria', 'Técnica', 'Básica']
    .find(level => education.some(item => item.level === level)) || (reviewed.includes('education') ? 'No registra estudios' : 'Pendiente');
  return {
    coverage: Math.round((sections.length - missing.length) / sections.length * 100), missing, highest,
    jobs: reviewed.includes('experience') ? experience.length : null,
    years: reviewed.includes('experience') ? experienceYears(experience) : null,
    judicialRecords: reviewed.includes('legal') ? legal.length : null,
    acquittals: legal.filter(item => /absuelt|absolv/.test(normalize(item.outcome))).length,
    legalLabel: !reviewed.includes('legal') ? 'Sección pendiente' : legal.length ? `${legal.length} registro(s) declarado(s)` : 'No registra sentencias en la DJHV',
    income: reviewed.includes('finances') ? candidate.finances?.annualIncome ?? null : null,
    warnings: [
      ...(missing.length ? ['La ficha tiene secciones pendientes de revisión.'] : []),
      ...(experience.some(item => item.startYear === null || item.endYear === null) ? ['Hay empleos sin fechas completas; no se incluyen en el cálculo de años.'] : []),
      ...(legal.some(item => /absuelt|absolv/.test(normalize(item.outcome))) ? ['La declaración contiene una absolución; un registro judicial no equivale a una condena.'] : []),
      ...(candidate.annotations?.length ? ['La fuente registra anotaciones marginales. Revisa las correcciones en el JNE.'] : [])
    ]
  };
}

export function csvCell(value) {
  let text = String(value ?? '');
  if (/^[\s]*[=+@-]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}

export function candidateCSV(candidates) {
  const rows = [['nombre','organizacion','cargo','ambito','descripcion','foto_local','porcentaje_reportado_lista','posicion_en_reporte','corte_resultados','fuente_resultados','formacion','anios_experiencia_sin_solapamiento','registros_judiciales_declarados','absoluciones_declaradas','ingreso_anual_pen','anio_ingresos','secciones_revisadas_porcentaje','consulta','fuente'], ...candidates.map(c => {
    const a=analyze(c);return [c.name,c.party,c.role,c.scope,c.description,c.photo?.url,c.electoral?.percent,c.electoral?.position,c.electoral?.cutoff,c.electoral?.source.url,a.highest,a.years,a.judicialRecords,a.acquittals,a.income,c.finances?.year,a.coverage,c.source.consultedAt,c.source.url];
  })];
  return '\uFEFF'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n');
}
