import test from 'node:test';
import assert from 'node:assert/strict';
import {backoffMinutes, decide, limaDay, pendingSteps, recordFailure} from '../scripts/sync-daily.mjs';

const now = new Date('2026-11-07T15:00:00Z');
const day = limaDay(now);

test('el día se calcula en hora de Lima', () => {
  assert.equal(limaDay(new Date('2026-11-08T03:00:00Z')), '2026-11-07');
  assert.equal(limaDay(new Date('2026-11-08T06:00:00Z')), '2026-11-08');
});

test('la espera entre fallos crece y tiene tope', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 9].map(backoffMinutes), [0, 15, 30, 60, 120, 180, 180]);
});

test('solo se repiten los pasos pendientes', () => {
  assert.deepEqual(pendingSteps({}, day, false), ['map', 'build']);
  assert.deepEqual(pendingSteps({mapDay: day}, day, false), ['build']);
  assert.deepEqual(pendingSteps({localDay: day}, day, false), [], 'estado de la versión anterior');
  assert.deepEqual(pendingSteps({mapDay: '2026-11-06', localDay: day}, day, false), ['map', 'build']);
  assert.deepEqual(pendingSteps({mapDay: day, localDay: day}, day, true), ['publish']);
  assert.deepEqual(pendingSteps({mapDay: day, localDay: day, supabaseDay: day}, day, true), []);
});

test('no vuelve a descargar si el día ya está actualizado', () => {
  assert.equal(decide({mapDay: day, localDay: day}, {now}).run, false);
  assert.equal(decide({mapDay: day, localDay: day}, {now, force: true}).run, true);
  assert.equal(decide({mapDay: '2026-11-06', localDay: '2026-11-06'}, {now}).run, true);
});

test('respeta la espera tras un fallo y la reinicia al cambiar de día', () => {
  const failed = recordFailure({}, new Error('HTTP 503'), now);
  assert.equal(failed.failures, 1);
  assert.equal(failed.lastError, 'HTTP 503');
  assert.equal(decide(failed, {now: new Date(now.getTime() + 5 * 60000)}).reason, 'backoff');
  assert.equal(decide(failed, {now: new Date(now.getTime() + 16 * 60000)}).run, true);
  const second = recordFailure(failed, 'otra', new Date(now.getTime() + 16 * 60000));
  assert.equal(second.failures, 2);
  assert.equal(Date.parse(second.nextAttemptAt) - (now.getTime() + 16 * 60000), 30 * 60000);
  const nextDay = new Date('2026-11-08T15:00:00Z');
  assert.equal(recordFailure(second, 'x', nextDay).failures, 1);
  assert.equal(decide({...second, nextAttemptAt: new Date(nextDay.getTime() + 60000).toISOString()}, {now: nextDay}).run, true);
});
