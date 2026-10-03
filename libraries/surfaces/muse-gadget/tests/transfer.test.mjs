import test from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import {execFile,execFileSync} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile);
import {PairingTransfer} from '../dist/transfer.js';
function request(url,method='GET',body='',headers={}){return new Promise((resolve,reject)=>{const r=https.request(url,{rejectUnauthorized:false,method,headers},res=>{let text='';res.on('data',c=>text+=c);res.on('end',()=>resolve({status:res.statusCode,text}));});r.on('error',reject);r.end(body);});}
test('pinned download, bounded import, origin rejection and single-use success',async()=>{
 let calls=0;const receiver=new PairingTransfer(async data=>{calls++;assert.equal(data.synthetic,true);});
 try{
  const state=await receiver.start('127.0.0.1');
  const url=state.command.match(/https:\/\/[^" ]+/)[0];
  const pin=state.command.match(/sha256\/\/[^" ]+/)[0];
  const {stdout:script}=await run('/usr/bin/curl',['-fsSk','--pinnedpubkey',pin,url],{encoding:'utf8'});
  assert.match(script,/getpeercert/);assert.match(script,/disable', '--now'/);
  execFileSync('python3',['-c','import sys; compile(sys.stdin.read(), "transfer", "exec")'],{input:script});
  await assert.rejects(run('/usr/bin/curl',['-fsSk','--pinnedpubkey','sha256//AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',url]));
  assert.equal((await request(url.replace('/setup','/pairing'),'POST','{}',{Origin:'http://evil.example'})).status,403);
  assert.equal((await request(url.replace('/setup','/pairing'),'POST','x'.repeat(65537))).status,413);
  assert.equal((await request(url.replace('/setup','/pairing'),'POST','bad json')).status,400);
  assert.equal(calls,0);
  assert.equal((await request(url.replace('/setup','/pairing'),'POST','{"synthetic":true}')).status,200);
  assert.equal(calls,1);assert.equal(receiver.state().active,false);assert.equal(receiver.state().command,'');
  await assert.rejects(request(url));
 }finally{receiver.stop();}
});
test('expired, canceled and superseded commands cannot submit',async()=>{
 const receiver=new PairingTransfer(async()=>{throw Error('must not import')});
 try{
  const first=await receiver.start('127.0.0.1');const url=first.command.match(/https:\/\/[^" ]+/)[0];
  receiver.expiresAt=Date.now()-1;
  assert.equal((await request(url)).status,403);
  await receiver.start('127.0.0.1');await assert.rejects(request(url));
  receiver.stop();assert.equal(receiver.state().active,false);
 }finally{receiver.stop();}
});
