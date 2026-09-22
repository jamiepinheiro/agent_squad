import express from 'express';
import { timingSafeEqual } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Protocol } from './protocol.js';
import { messageOf } from './types.js';

export function application(protocol:Protocol,controlToken:string,state:()=>unknown,action:(input:any)=>Promise<unknown>,trustedHosts:string[]=[]) {
  const app=express();app.disable('x-powered-by');
  app.use((req,res,next)=>{
    const host=req.headers.host;
    if(!host || (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host) && !trustedHosts.includes(host.toLowerCase()))) {res.status(403).json({error:'Untrusted Host.'});return;}
    // Native clients and the tunnel do not need browser origins.
    if(req.headers.origin) {res.status(403).json({error:'Browser origins are not allowed.'});return;}
    next();
  });
  // Private app control uses an internal secret. MCP and A2A trust the tunnel/network.
  // Mount this with Express's own path matching, including case-insensitive /API.
  app.use('/api',(req,res,next)=>{
    if(!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host ?? '')) {res.sendStatus(403);return;}
    const supplied=req.headers.authorization ?? '';
    const wanted=`Bearer ${controlToken}`;
    if(Buffer.byteLength(supplied)!==Buffer.byteLength(wanted) || !timingSafeEqual(Buffer.from(supplied),Buffer.from(wanted))) {res.status(401).json({error:'Authentication required.'});return;}
    next();
  });
  app.use(express.json({limit:'1mb'}));
  app.get('/api/state',(_req,res)=>res.json(state()));
  app.post('/api/action',async(req,res)=>{
    try {res.json({result:await action(req.body) ?? null});}
    catch(error) {res.status(400).json({error:messageOf(error)});}
  });
  app.post('/mcp',async(req,res)=>{
    const server=protocol.mcp(`http://${req.headers.host}`);
    const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
    res.on('close',()=>{void transport.close();void server.close();});
    try {await server.connect(transport);await transport.handleRequest(req,res,req.body);}
    catch {if(!res.headersSent) res.status(500).json({jsonrpc:'2.0',id:null,error:{code:-32603,message:'MCP request failed.'}});}
  });
  app.all('/mcp',(_req,res)=>{res.setHeader('Allow','POST');res.sendStatus(405);});
  app.get('/a2a/:agentId/.well-known/agent-card.json',async(req,res)=>{
    try {res.json(await protocol.card(req.params.agentId,`http://${req.headers.host}`));}catch(error){res.status(404).json({error:messageOf(error)});}
  });
  app.post('/a2a/:agentId',async(req,res)=>{
    const {jsonrpc,id,method,params}=req.body ?? {};
    if(jsonrpc!=='2.0' || !(typeof id==='string'||typeof id==='number') || typeof method!=='string') {res.status(400).json({jsonrpc:'2.0',id:null,error:{code:-32600,message:'Invalid request.'}});return;}
    try {res.json({jsonrpc:'2.0',id,result:await protocol.a2a(req.params.agentId,method,params)});}
    catch(error) {res.json({jsonrpc:'2.0',id,error:{code:-32000,message:messageOf(error)}});}
  });
  app.use((error:any,_req:express.Request,res:express.Response,_next:express.NextFunction)=>res.status(error.status ?? 500).json({error:'Invalid request.'}));
  return app;
}
