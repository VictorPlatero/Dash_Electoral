import { sections, describeCandidate } from '../public/candidate-model.js';

function fail(message) { throw Object.assign(new Error(message), { status: 400 }); }
function text(value, field, required = false, limit = 3000) {
  if (value == null && !required) return '';
  if (typeof value !== 'string' || value.length > limit || (required && !value.trim())) fail(`Campo inválido: ${field}`);
  return value.trim();
}
function numeric(value, field, max = 1e14) {
  if (value == null || value === '') return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max) fail(`Número inválido: ${field}`);
  return value;
}
function year(value, field) {
  const number = numeric(value, field, 2100);
  if (number !== null && (!Number.isInteger(number) || number < 1900)) fail(`Año inválido: ${field}`);
  return number;
}
function list(value, field, mapper) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 200) fail(`Lista inválida: ${field}`);
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) fail(`Registro inválido: ${field}[${index}]`);
    return mapper(item);
  });
}
function url(value, field, required = false) {
  const result = text(value, field, required, 2000);
  if (!result) return '';
  try { const parsed = new URL(result); if (parsed.protocol !== 'https:' || parsed.username || parsed.password) fail(`URL inválida: ${field}`); }
  catch { fail(`URL HTTPS requerida: ${field}`); }
  return result;
}

export function validateCandidate(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('La ficha debe ser un objeto');
  const id = text(value.id, 'id', true, 100);
  if (!/^[\w-]+$/.test(id)) fail('ID inválido');
  if (!['municipal', 'regional'].includes(value.role)) fail('Cargo inválido');
  const source = value.source;
  if (!source || typeof source !== 'object') fail('La fuente es obligatoria');
  const consultedAt = text(source.consultedAt, 'source.consultedAt', true, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(consultedAt) || !Number.isFinite(Date.parse(consultedAt)) || new Date(consultedAt).toISOString().slice(0,10) !== consultedAt) fail('Fecha de consulta inválida');
  const reviewed = value.reviewedSections ?? [];
  if (!Array.isArray(reviewed) || reviewed.some(item => !sections.includes(item))) fail('Secciones revisadas inválidas');
  if (value.additional != null && !Array.isArray(value.additional)) fail('Lista inválida: additional');
  if (value.finances != null && (typeof value.finances !== 'object' || Array.isArray(value.finances))) fail('Objeto inválido: finances');
  const result = {
    id, name: text(value.name, 'name', true, 180), party: text(value.party, 'party', true, 180),
    role: value.role, scope: text(value.scope, 'scope', true, 180), status: text(value.status, 'status', false, 100),
    description: text(value.description, 'description', false, 2000),
    photo: null,
    source: { name: text(source.name, 'source.name', true, 180), url: url(source.url, 'source.url', true), consultedAt, pdfUrl: url(source.pdfUrl, 'source.pdfUrl') },
    reviewedSections: [...new Set(reviewed)],
    education: list(value.education, 'education', item => {
      if (!['Básica', 'Técnica', 'No universitaria', 'Universitaria', 'Posgrado'].includes(item.level)) fail('Nivel educativo inválido');
      return { level: item.level, institution: text(item.institution, 'institution'), degree: text(item.degree, 'degree', true), completed: item.completed === true, year: year(item.year, 'education.year'), note: text(item.note, 'education.note') };
    }),
    experience: list(value.experience, 'experience', item => {
      const startYear = year(item.startYear, 'startYear'), endYear = year(item.endYear, 'endYear');
      if (startYear !== null && endYear !== null && endYear < startYear) fail('El año final debe ser posterior al inicial');
      return { organization: text(item.organization, 'organization', true), position: text(item.position, 'position', true), startYear, endYear };
    }),
    political: list(value.political, 'political', item => ({ kind: text(item.kind, 'kind', true), organization: text(item.organization, 'organization'), position: text(item.position, 'position'), startYear: year(item.startYear, 'political.startYear'), endYear: year(item.endYear, 'political.endYear') })),
    legal: list(value.legal, 'legal', item => ({ kind: text(item.kind, 'kind', true), subject: text(item.subject, 'subject'), outcome: text(item.outcome, 'outcome'), court: text(item.court, 'court'), caseNumber: text(item.caseNumber, 'caseNumber'), date: text(item.date, 'legal.date'), note: text(item.note, 'legal.note') })),
    finances: value.finances == null ? null : { year: year(value.finances.year, 'finances.year'), annualIncome: numeric(value.finances.annualIncome, 'annualIncome'), publicIncome: numeric(value.finances.publicIncome, 'publicIncome'), privateIncome: numeric(value.finances.privateIncome, 'privateIncome'), properties: numeric(value.finances.properties, 'properties', 10000), vehicles: numeric(value.finances.vehicles, 'vehicles', 10000) },
    additional: (value.additional ?? []).map(item => text(item, 'additional', false, 20000)),
    annotations: list(value.annotations, 'annotations', item => ({ section: text(item.section, 'section'), date: text(item.date, 'annotation.date'), before: text(item.before, 'before', false, 20000), after: text(item.after, 'after', false, 20000) }))
  };
  if (result.additional.length > 200) fail('Demasiados textos adicionales');
  if (value.photo != null) {
    const photo = value.photo;
    if (typeof photo !== 'object' || Array.isArray(photo)) fail('Fotografía inválida');
    const path = text(photo.url, 'photo.url', true, 2000);
    if (!/^\/portraits\/[\w-]+\.(jpg|png)$/.test(path)) fail('La fotografía debe ser un archivo local en portraits');
    result.photo = { url: path, sourceUrl: url(photo.sourceUrl, 'photo.sourceUrl', true), consultedAt: text(photo.consultedAt, 'photo.consultedAt', true, 10), attribution: text(photo.attribution, 'photo.attribution', false, 180) };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(result.photo.consultedAt) || !Number.isFinite(Date.parse(result.photo.consultedAt)) || new Date(result.photo.consultedAt).toISOString().slice(0,10) !== result.photo.consultedAt) fail('Fecha de fotografía inválida');
  }
  if (!result.description) result.description = describeCandidate(result);
  return result;
}

export function validateBatch(payload) {
  if (!payload || !Array.isArray(payload.candidates) || payload.candidates.length < 1 || payload.candidates.length > 500) fail('Se requieren entre 1 y 500 fichas en candidates');
  const candidates = payload.candidates.map(validateCandidate);
  if (new Set(candidates.map(item => item.id)).size !== candidates.length) fail('El archivo contiene IDs duplicados');
  return candidates;
}
