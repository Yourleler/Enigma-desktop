import assert from 'node:assert/strict';
import test from 'node:test';
import {githubRequest,githubRemote} from '../src/merge-request-source.js';
test('MR source parsing accepts registered GitHub identities and rejects credentialed or unrelated endpoints',()=>{
  assert.deepEqual(githubRequest('https://github.com/Owner/project/pull/12'),{owner:'Owner',repository:'project',number:12});
  assert.deepEqual(githubRemote('git@github.com:Owner/project.git'),{owner:'Owner',repository:'project'});assert.deepEqual(githubRemote('https://github.com/Owner/project.git'),{owner:'Owner',repository:'project'});
  assert.throws(()=>githubRequest('https://user:secret@github.com/Owner/project/pull/12'),/pull request/);assert.throws(()=>githubRequest('https://other.invalid/Owner/project/pull/12'),/pull request/);assert.equal(githubRemote('https://other.invalid/Owner/project.git'),null);
});
