export const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export const roleLabel = role => role === 'regional' ? 'Gobernador regional' : 'Alcalde provincial';
export const sections = ['education', 'experience', 'political', 'legal', 'finances'];

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
