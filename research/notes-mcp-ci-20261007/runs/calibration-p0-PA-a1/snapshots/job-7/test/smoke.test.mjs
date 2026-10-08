import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openStore} from '../src/store.mjs';
test('legacy create/get smoke',()=>{const s=openStore(':memory:'); const n=s.createNote('hello',['work']); assert.equal(s.getNote(n.id).text,'hello'); s.close();});
