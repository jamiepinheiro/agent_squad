import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac, randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Kernel } from '../dist/kernel.js';
import { application } from '../dist/server.js';
import { publicAddress, callbackURL, signingKey, webhookPost } from '../dist/webhook.js';

const secret='whsec_'+randomBytes(32).toString('base64');
async function fixture(t) {
  const directory=mkdtempSync(join(tmpdir(),'agent-squad-events-'));
  const deliveries=[];
  let responseStatus=200;
  let verificationOK=true,verifications=0;
  const post=async(url,body,headers)=>{
    const expected=createHmac('sha256',Buffer.from(secret.slice(6),'base64')).update(`${headers['webhook-id']}.${headers['webhook-timestamp']}.${body}`).digest('base64');
    assert.equal(headers['webhook-signature'],`v1,${expected}`);
    assert.ok(headers['X-MCP-Subscription-Id']);
    const parsed=JSON.parse(body);
    if(parsed.type==='verification') {verifications++;return {status:200,body:JSON.stringify({challenge:verificationOK?parsed.challenge:'wrong'})};}
    assert.equal(parsed.eventId,headers['webhook-id']);
    deliveries.push({url,body:parsed,headers});
    return {status:responseStatus,body:''};
  };
  let kernel=new Kernel({directory,surfaces:[],webhookPost:post});
  let server;
  async function listen() {
    await kernel.start();
    server=application(kernel.protocol,'test-control',()=>kernel.snapshot(),a=>kernel.action(a)).listen(0,'127.0.0.1');
    await new Promise(resolve=>server.once('listening',resolve));
  }
  await listen();
  t.after(async()=>{await kernel.stop();await new Promise(resolve=>server.close(resolve));rmSync(directory,{recursive:true,force:true});});
  const rpc=async(method,params={},legacy=false,extraHeaders={})=>{
    const response=await fetch(`http://127.0.0.1:${server.address().port}/mcp`,{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json, text/event-stream',...(!legacy?{'MCP-Protocol-Version':'2026-07-28','Mcp-Method':method,...(params.name?{'Mcp-Name':params.name}:{})}:{}),...extraHeaders},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
    assert.equal(response.status,200);return response.json();
  };
  const call=async(name,args)=>{
    const r=await rpc('tools/call',{name,arguments:args});assert.equal(r.error,undefined);assert.equal(r.result.isError,undefined,JSON.stringify(r));return JSON.parse(r.result.content[0].text);
  };
  const register=async(id='worker')=>(await call('register_event_agent',{registration_id:id,name:id})).agent_id;
  const subscription=(id,url='https://callback.example/events')=>({name:'agent_squad.task.assigned',arguments:{agent_id:id},delivery:{mode:'webhook',url,secret}});
  const subscribe=async(id,url)=>{const r=await rpc('events/subscribe',subscription(id,url));assert.equal(r.error,undefined,JSON.stringify(r));return r.result;};
  const dispatch=async(id,prompt='Synthetic task')=>{
    const r=await kernel.protocol.a2a(id,'message/send',{message:{role:'user',messageId:randomBytes(8).toString('hex'),parts:[{kind:'text',text:prompt}]}});
    await delay(20);return kernel.router.get(id,r.id);
  };
  return {get kernel(){return kernel;},get verifications(){return verifications;},setVerification:value=>{verificationOK=value;},directory,deliveries,rpc,call,register,subscribe,subscription,dispatch,setStatus:status=>{responseStatus=status;},restart:async()=>{await kernel.stop();await new Promise(resolve=>server.close(resolve));kernel=new Kernel({directory,surfaces:[],webhookPost:post});await listen();}};
}
async function until(check) {for(let i=0;i<80;i++){if(check()) return;await delay(50);}assert.fail('Timed out waiting for state');}

test('MCP 2 discovery, legacy tools, agent registration and full A2A event round trip',async t=>{
  const f=await fixture(t);
  assert.deepEqual((await f.rpc('server/discover')).result.capabilities.events,{});
  const modern=(await f.rpc('tools/list')).result.tools;
  const legacy=(await f.rpc('tools/list',{},true)).result.tools;
  assert.deepEqual(modern.map(t=>t.name),legacy.map(t=>t.name));
  assert.ok(modern.some(t=>t.name==='complete_assigned_task'));
  const id=await f.register();assert.equal(await f.register(),id);assert.equal(f.kernel.router.agents().length,1);
  const other=await f.register('other');await f.subscribe(other,'https://other.example/events');
  const sub=await f.subscribe(id);assert.equal((await f.subscribe(id)).id,sub.id);
  const session=await f.dispatch(id);await f.kernel.events.flush();
  assert.equal(f.deliveries.length,1);assert.equal(f.deliveries[0].url,'https://callback.example/events');
  const assigned=f.deliveries[0].body.data;assert.equal(assigned.agent_id,id);assert.equal(assigned.task_id,session.remoteTaskId);
  assert.equal((await f.call('get_assigned_task',{agent_id:id,task_id:assigned.task_id})).prompt,'Synthetic task');
  const wrong=await f.rpc('tools/call',{name:'get_assigned_task',arguments:{agent_id:other,task_id:assigned.task_id}});assert.equal(wrong.result.isError,true);
  const result={agent_id:id,task_id:assigned.task_id,status:'completed',text:'Synthetic answer'};
  await f.call('complete_assigned_task',result);await f.call('complete_assigned_task',result);
  await until(()=>session.status==='completed');
  assert.equal(session.messages.filter(m=>m.role==='agent').length,1);
  assert.equal((await f.kernel.protocol.a2a(id,'tasks/get',{id:session.id})).status.state,'completed');
  const changed=await f.rpc('tools/call',{name:'complete_assigned_task',arguments:{...result,text:'Different answer'}});assert.equal(changed.result.isError,true);
  assert.equal(statSync(join(f.directory,'mcp-events.json')).mode & 0o777,0o600);
  assert.equal(JSON.stringify(f.kernel.snapshot()).includes(secret),false);
});

test('durable subscription and task resume after restart without losing or duplicating work',async t=>{
  const f=await fixture(t);const id=await f.register();await f.subscribe(id);
  const session=await f.dispatch(id);await f.kernel.events.flush();const taskId=session.remoteTaskId;
  await f.restart();
  assert.equal(f.kernel.router.get(id,session.id).status,'working');
  assert.equal((await f.call('list_assigned_tasks',{agent_id:id}))[0].task_id,taskId);
  await f.kernel.events.flush();assert.equal(f.deliveries.length,1);
  await f.call('complete_assigned_task',{agent_id:id,task_id:taskId,status:'completed',text:'After restart'});
  await until(()=>f.kernel.router.get(id,session.id).status==='completed');
});

test('cancellation rejects late answers; input-required creates a separate follow-up assignment',async t=>{
  const f=await fixture(t);const id=await f.register();await f.subscribe(id);
  const first=await f.dispatch(id);
  await f.kernel.router.cancel(id,first.id);
  const late=await f.rpc('tools/call',{name:'complete_assigned_task',arguments:{agent_id:id,task_id:first.remoteTaskId,status:'completed',text:'Late'}});assert.equal(late.result.isError,true);
  const next=await f.dispatch(id);
  await f.call('complete_assigned_task',{agent_id:id,task_id:next.remoteTaskId,status:'input-required',text:'Which one?'});
  await until(()=>next.status==='input-required');
  const old=next.remoteTaskId;
  f.kernel.router.send(id,next.id,'The second one');await delay(20);assert.notEqual(next.remoteTaskId,old);
  await f.call('complete_assigned_task',{agent_id:id,task_id:next.remoteTaskId,status:'completed',text:'Done'});
  await until(()=>next.status==='completed');assert.equal(next.messages.filter(m=>m.role==='agent').length,2);
});

test('subscription validation, routing headers, unsubscribe and a non-listening agent',async t=>{
  const f=await fixture(t);const id=await f.register();
  const notListening=await f.dispatch(id);assert.equal(notListening.status,'failed');assert.match(notListening.error,/not listening/);
  let p=f.subscription(id);p.delivery.secret='whsec_bad';assert.equal((await f.rpc('events/subscribe',p)).error.code,-32602);
  p=f.subscription(id);p.delivery.url='http://callback.example';assert.equal((await f.rpc('events/subscribe',p)).error.code,-32602);
  assert.equal((await f.rpc('tools/list',{},false,{'Mcp-Method':'tools/call'})).error.code,-32020);
  await f.subscribe(id);
  p=f.subscription(id);delete p.delivery.secret;
  await f.rpc('events/unsubscribe',p);await f.rpc('events/unsubscribe',p);
  assert.equal(f.kernel.snapshot().surfaceState.mcpEvents.agents[0].listening,false);
});

test('transient retry keeps event ID; 410 disables further delivery',async t=>{
  const f=await fixture(t);const id=await f.register();await f.subscribe(id);f.setStatus(503);
  await f.dispatch(id);await f.kernel.events.flush();assert.equal(f.deliveries.length,1);
  f.setStatus(410);await delay(2200);await f.kernel.events.flush();
  assert.equal(f.deliveries.length,2);assert.equal(f.deliveries[0].body.eventId,f.deliveries[1].body.eventId);
  assert.equal(f.kernel.snapshot().surfaceState.mcpEvents.agents[0].listening,false);
});

test('callback security blocks private, reserved, mapped and redirect destinations',async()=>{
  for(const ip of ['127.0.0.1','10.0.0.2','172.16.0.1','192.168.1.1','169.254.169.254','0.0.0.0','100.64.0.1','224.0.0.1','::1','fc00::1','fe80::1','::ffff:127.0.0.1','2001:db8::1']) assert.equal(publicAddress(ip),false,ip);
  assert.equal(publicAddress('8.8.8.8'),true);
  assert.throws(()=>callbackURL('https://user:pass@example.com'));
  assert.throws(()=>callbackURL('https://example.com:8080'));
  assert.throws(()=>signingKey('whsec_'+Buffer.alloc(12).toString('base64')));
  await assert.rejects(webhookPost('https://127.0.0.1','{}',{}),/not public/);
});

test('failed verification never activates a subscription; cached verification and TTL are honored',async t=>{
  const f=await fixture(t),id=await f.register();f.setVerification(false);
  assert.equal((await f.rpc('events/subscribe',f.subscription(id))).error.code,-32015);
  assert.equal(f.kernel.snapshot().surfaceState.mcpEvents.agents[0].listening,false);
  f.setVerification(true);await f.subscribe(id);const count=f.verifications;
  await f.subscribe(id);assert.equal(f.verifications,count);
  const p=f.subscription(id);p.ttlMs=30;
  const result=await f.rpc('events/subscribe',p);assert.ok(Date.parse(result.result.refreshBefore)<=Date.now()+30);
  await delay(40);assert.equal(f.kernel.snapshot().surfaceState.mcpEvents.agents[0].listening,false);
});

test('removal clears the subscription and re-registration requires a fresh subscription',async t=>{
  const f=await fixture(t),id=await f.register();await f.subscribe(id);
  await f.kernel.action({action:'deleteAgent',agentId:id});assert.equal(f.kernel.router.agents().length,0);
  assert.equal(await f.register(),id);
  assert.equal(f.kernel.snapshot().surfaceState.mcpEvents.agents[0].listening,false);
  assert.equal(JSON.parse(readFileSync(join(f.directory,'mcp-events.json'),'utf8')).subscriptions.length,0);
});

test('refresh image requests an avatar through MCP Events and saves the reply image',async t=>{
  const f=await fixture(t),id=await f.register();await f.subscribe(id);
  const realFetch=globalThis.fetch;
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX9sAAAAASUVORK5CYII=','base64');
  globalThis.fetch=async(url,options)=>String(url)==='https://avatar.example/profile.png'
    ? new Response(png,{headers:{'Content-Type':'image/png'}}):realFetch(url,options);
  t.after(()=>{globalThis.fetch=realFetch;});
  await f.kernel.action({action:'refreshProfilePhoto',agentId:id});
  const [assigned]=f.kernel.events.pending(id);
  assert.ok(assigned);
  assert.match(f.kernel.events.read(id,assigned.task_id).prompt,/profile picture or avatar/);
  f.kernel.events.complete({agent_id:id,task_id:assigned.task_id,status:'completed',text:'https://avatar.example/profile.png'});
  await until(()=>f.kernel.router.agent(id).profilePhotoStatus==='ready');
  assert.equal(f.kernel.router.agent(id).profilePhoto,`data:image/png;base64,${png.toString('base64')}`);
});
