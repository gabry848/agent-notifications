import test from 'node:test';import assert from 'node:assert/strict';
import {parseCSV,stringifyCSV} from '../src/csv.mjs';import {compareVersions} from '../src/version.mjs';import {createCatalog} from '../src/catalog.mjs';
test('plain CSV',()=>assert.deepEqual(parseCSV(stringifyCSV([['a','b'],['c','d']])),[['a','b'],['c','d']]));
test('equal versions',()=>assert.equal(compareVersions('1.2.3','1.2.3'),0));
test('store one record',()=>assert.equal(createCatalog([{id:'a',name:'A',version:'1.0.0',tags:[],dependencies:[]}]).get('a').name,'A'));
