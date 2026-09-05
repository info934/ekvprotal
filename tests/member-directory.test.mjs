import test from 'node:test';
import assert from 'node:assert/strict';
import {certificationState,matchesCertification} from '../src/lib/memberDirectory.js';
const today='2026-09-05';
test('certification remains valid throughout its expiration date',()=>{assert.equal(certificationState([{expiry_date:today}],today),'soon');assert.equal(matchesCertification([{expiry_date:today}],'expired',today),false);});
test('expired and upcoming certificates are distinct filters',()=>{assert.equal(certificationState([{expiry_date:'2026-09-04'}],today),'expired');assert.equal(certificationState([{expiry_date:'2026-10-05'}],today),'soon');assert.equal(certificationState([{expiry_date:'2026-10-06'}],today),'valid');assert.equal(matchesCertification([{expiry_date:'2026-09-10'}],'valid',today),true);});
test('expired certificate takes priority over future ones',()=>assert.equal(certificationState([{expiry_date:'2027-01-01'},{expiry_date:'2026-01-01'}],today),'expired'));
test('no certificates differs from a certificate with unlimited validity',()=>{assert.equal(certificationState([],today),'none');assert.equal(certificationState([{expiry_date:null}],today),'valid');});
