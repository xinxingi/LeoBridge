import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error JavaScript architecture tool is exercised without a declaration shim.
import { architectureErrors } from '../scripts/check-architecture.mjs';
const graph=(sources:Record<string,string>):string[]=>architectureErrors(new Map(Object.entries(sources)));
test('architecture check rejects reversed and cross-ecosystem dependencies including type-only imports',()=>{
  const errors=graph({'src/core/model.ts':"import type { X } from '../protocols/cfsm/adapter.ts';",'src/protocols/cfsm/adapter.ts':"export type X=string;",'src/protocols/komari/adapter.ts':"export {X} from '../cfsm/adapter.ts';"});
  assert.equal(errors.filter(error=>error.includes('cannot import')).length,2);
});
test('architecture check detects cycles and Node dependencies reached transitively by Worker',()=>{
  const errors=graph({'src/runtime/worker.ts':"import './helper.ts';",'src/runtime/helper.ts':"import 'node:fs'; import './worker.ts';"});
  assert.ok(errors.some(error=>error.startsWith('Dependency cycle:')));assert.ok(errors.some(error=>error.includes('Worker reaches Node-only')));
});
test('architecture check accepts neutral facts shared by independent protocols and fails closed on computed imports',()=>{
  const sources={'src/core/model.ts':'export type X=string;','src/upstream/client.ts':"import type {X} from '../core/model.ts';",'src/protocols/cfsm/service.ts':"import '../../upstream/client.ts';",'src/protocols/komari/service.ts':"import '../../upstream/client.ts';"};
  assert.deepEqual(graph(sources),[]);assert.ok(graph({...sources,'src/app/site.ts':"import('./'+name);"}).some(error=>error.includes('computed module')));
});
