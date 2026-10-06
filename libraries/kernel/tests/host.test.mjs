import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { application } from '../dist/server.js';

test('Tailscale proxy hostname can use MCP but cannot access app management',async t=>{
  const host='mac.example-tailnet.ts.net:9847';
  const protocol={modern:async()=>({capabilities:{tools:{},events:{}}})};
  const server=application(protocol,'private-control',()=>({}),async()=>({}),[host]).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const request=(hostname,path='/mcp',extra={})=>new Promise((resolve,reject)=>{
    const req=httpRequest(`http://127.0.0.1:${server.address().port}${path}`,{method:path==='/mcp'?'POST':'GET',headers:{Host:hostname,'Content-Type':'application/json',...extra}},res=>{res.resume();res.on('end',()=>resolve({status:res.statusCode}));});
    req.on('error',reject);req.end(path==='/mcp'?JSON.stringify({jsonrpc:'2.0',id:1,method:'server/discover'}):undefined);
  });
  assert.equal((await request(host)).status,200);
  assert.equal((await request('attacker.example')).status,403);
  assert.equal((await request(host,'/mcp',{Origin:'https://example.com'})).status,403);
  assert.equal((await request(host,'/api/state',{Authorization:'Bearer private-control'})).status,403);
  assert.equal((await request('localhost','/api/state')).status,401);
});
