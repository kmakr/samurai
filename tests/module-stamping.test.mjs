import test from 'node:test';
import assert from 'node:assert/strict';
import {stampImports} from '../tools/stamp-imports.mjs';

test('single-line, multiline, export, dynamic and side-effect imports share one version',()=>{
  const source=`import {\n makeSamurai,\n makeEnemy,\n} from './actors.js';\nimport {toon} from './actors.js';\nexport {foo} from '../foo.js';\nconst lab=await import('./lab.js');\nimport './init.js';\nimport * as THREE from 'three';`;
  const stamped=stampImports(source,'v=96');
  assert.equal(stamped.match(/actors\.js\?v=96/g).length,2);
  for(const path of ['../foo.js','./lab.js','./init.js']) assert.ok(stamped.includes(path+'?v=96'));
  assert.ok(stamped.includes("from 'three'"));
  assert.equal(stampImports(stamped,'v=96'),stamped);
});
