import { mkdir, cp } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
await cp('public', 'dist', { recursive: true, filter: path => !path.endsWith('.tmp') });
console.log('Dashboard preparado en dist/');
