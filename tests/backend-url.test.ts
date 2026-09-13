import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveBackendUrl} from '../mobile/lib/backend-url';
test('development follows the current Expo host instead of retaining an old Wi-Fi address',()=>{
  assert.equal(resolveBackendUrl({platform:'ios',expoHost:'192.168.1.22:8081'}),'http://192.168.1.22:3000');
  assert.equal(resolveBackendUrl({platform:'ios',expoHost:'10.1.2.3:8081'}),'http://10.1.2.3:3000');
  assert.equal(resolveBackendUrl({platform:'android'}),'http://10.0.2.2:3000');
});
test('web follows the browser hostname to keep cookie sessions same-site; explicit deployments win',()=>{
  assert.equal(resolveBackendUrl({platform:'web',webHostname:'localhost',expoHost:'192.168.1.22:8081'}),'http://localhost:3000');
  assert.equal(resolveBackendUrl({platform:'web',webHostname:'192.168.1.22'}),'http://192.168.1.22:3000');
  assert.equal(resolveBackendUrl({platform:'ios',configured:' https://api.example.com/ ',expoHost:'10.1.2.3:8081'}),'https://api.example.com');
});
