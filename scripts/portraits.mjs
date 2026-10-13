import { mkdir, writeFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const BASE = 'https://stovotoinformadodev.blob.core.windows.net/contenedor-1/';

export async function downloadPortrait(filename, id, sourceUrl, consultedAt) {
  if (!filename) return null;
  if (!/^[\w.-]+\.(jpe?g|png)$/i.test(filename) || !/^[\w-]+$/.test(id)) throw new Error('Ruta de fotografía JNE inválida');
  let error;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(BASE + encodeURIComponent(filename), { signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error(`Fotografía JNE: HTTP ${response.status}`);
      if (Number(response.headers.get('content-length') || 0) > 2 * 1024 * 1024) throw new Error('Fotografía demasiado grande');
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > 2 * 1024 * 1024 || bytes.length < 100) throw new Error('Tamaño de fotografía inválido');
      const extension = bytes[0] === 0xff && bytes[1] === 0xd8 ? 'jpg' : bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'png' : null;
      if (!extension) throw new Error('La respuesta no es una fotografía JPEG o PNG');
      const digest = createHash('sha256').update(bytes).digest('hex').slice(0,16);
      const path = `public/portraits/${id}-${digest}.${extension}`;
      await mkdir('public/portraits', { recursive: true });
      try { await access(path); } catch { await writeFile(path, bytes); }
      return { url: path.replace(/^public/, ''), sourceUrl, consultedAt, attribution: 'Fotografía publicada en la DJHV · JNE' };
    } catch (failure) { error = failure; if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1))); }
  }
  throw error;
}
