import {createServer,type Server} from 'node:https';
import {randomBytes,createHash,X509Certificate} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir,networkInterfaces} from 'node:os';
import {join} from 'node:path';

const run=promisify(execFile);
export class PairingTransfer {
  private server?:Server;
  private timer?:NodeJS.Timeout;
  private command='';
  private expiresAt=0;
  private status='';
  private receiving=false;
  constructor(private ingest:(value:unknown)=>Promise<unknown>){}
  state(){return {active:!!this.server,command:this.command,expiresAt:this.expiresAt,status:this.status,receiving:this.receiving};}
  stop(){clearTimeout(this.timer);this.server?.close();this.server?.closeAllConnections();this.server=undefined;this.command='';this.expiresAt=0;}
  async start(host?:string){
    if(this.receiving)throw Error('Wait for the current import to finish.');
    this.stop();
    const addresses=Object.values(networkInterfaces()).flat().filter(a=>a?.family==='IPv4'&&!a.internal).map(a=>a!.address);
    const address=host??addresses.find(a=>/^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a));
    if(!address||(!addresses.includes(address)&&address!=='127.0.0.1'))throw Error('Connect your Mac to the same local network as the Pi first.');
    const directory=await mkdtemp(join(tmpdir(),'agent-squad-transfer-'));
    let key:Buffer,cert:Buffer;
    try {
      await run('/usr/bin/openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(directory,'key.pem'),'-out',join(directory,'cert.pem'),'-days','1','-subj','/CN=Agent Squad pairing'],{timeout:15000});
      key=await readFile(join(directory,'key.pem'));cert=await readFile(join(directory,'cert.pem'));
    } finally {await rm(directory,{recursive:true,force:true});}
    const certificate=new X509Certificate(cert);
    const pin=createHash('sha256').update(certificate.publicKey.export({type:'spki',format:'der'})).digest('base64');
    const fingerprint=createHash('sha256').update(certificate.raw).digest('hex');
    const token=randomBytes(24).toString('hex');
    let script='';
    const server=createServer({key,cert,minVersion:'TLSv1.2'},async(req,res)=>{
      res.setHeader('Cache-Control','no-store');
      const reply=(code:number,text:string)=>{res.writeHead(code,{'Content-Type':'text/plain'});res.end(text);};
      if(req.headers.origin||Date.now()>this.expiresAt||!req.url?.startsWith('/'+token+'/')){reply(403,'Transfer unavailable');return;}
      if(req.method==='GET'&&req.url===`/${token}/setup`){reply(200,script);return;}
      if(req.method!=='POST'||req.url!==`/${token}/pairing`){reply(404,'Not found');return;}
      if(this.receiving){reply(409,'An import is already in progress');return;}
      this.receiving=true;this.status='Checking pairing…';
      try {
        let size=0;const chunks:Buffer[]=[];
        for await(const chunk of req){size+=chunk.length;if(size>65536){reply(413,'Pairing is too large');return;}chunks.push(chunk);}
        await this.ingest(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        this.status='Pairing saved in Keychain';
        // Finish the receipt before closing the one-use receiver.
        res.on('finish',()=>this.stop());reply(200,'Pairing saved in Agent Squad. Keep the Pi Muse service disabled. You may turn the Pi off.');
      } catch {this.status='Import failed. Check the Pi pairing and try again.';reply(400,this.status);}
      finally {this.receiving=false;}
    });
    server.requestTimeout=120000;server.headersTimeout=10000;server.maxConnections=8;
    await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,address,()=>{server.off('error',reject);resolve();});});
    server.on('error',()=>{this.status='Transfer receiver stopped';this.stop();});
    this.server=server;
    const port=(server.address() as {port:number}).port;
    script=piScript(address,port,token,fingerprint);
    this.expiresAt=Date.now()+600000;this.status='Waiting for Raspberry Pi';
    this.command=`bash -c 'set -euo pipefail; code=$(curl --fail --silent --show-error --max-time 20 --insecure --pinnedpubkey "sha256//${pin}" "https://${address}:${port}/${token}/setup"); printf "%s" "$code" | sudo python3 -'`;
    this.timer=setTimeout(()=>{if(this.receiving){this.command='';this.status='Finishing import…';server.close();}else{this.status='Transfer expired. Start again for a new command.';this.stop();}},600000);
    return this.state();
  }
}

export function piScript(host:string,port:number,token:string,fingerprint:string){return `import hashlib, http.client, json, os, pathlib, ssl, subprocess, sys
try:
    root = pathlib.Path(os.environ.get('MUSEGADGET_STATE_DIR', '/var/lib/musegadget'))
    def read(name):
        with (root / name).open('rb') as f:
            raw = f.read(65537)
        if len(raw) > 65536: raise ValueError('Pairing file too large')
        return raw.decode('utf-8')
    # Read and validate before stopping the existing service. Never print secrets.
    device = json.loads(read('identity.json'))
    pairing = json.loads(read('pairing.json'))
    sdk = read('sdk_token').strip()
    if not pairing.get('access_token') or not pairing.get('refresh_token') or not sdk:
        raise ValueError('Pair this Pi with Muse first')
    subprocess.run(['systemctl', 'disable', '--now', 'musegadget.service'], check=True, stdout=subprocess.DEVNULL)
    active = subprocess.run(['systemctl', 'is-active', 'musegadget.service'], capture_output=True, text=True)
    if active.stdout.strip() not in ('inactive', 'failed'): raise ValueError('Stop the Muse service first')
    running = subprocess.run(['pgrep', '-f', '(^|/)(musegadget|musegadget.py) run'], capture_output=True)
    if running.returncode == 0: raise ValueError('Stop the manually launched musegadget run process first')
    # Re-read after stopping: a running service may have rotated its tokens.
    pairing = json.loads(read('pairing.json'))
    data = json.dumps({'format':'agent-squad-muse-pairing','version':1,'identity':{'mac':device['mac']},'sdk_token':sdk,'pairing':{k:pairing.get(k,'') for k in ('access_token','refresh_token','api_url_v2','noise_host')}}).encode()
    if len(data) > 65536: raise ValueError('Pairing export too large')
    conn = http.client.HTTPSConnection('${host}', ${port}, timeout=110, context=ssl._create_unverified_context())
    conn.connect()
    if hashlib.sha256(conn.sock.getpeercert(binary_form=True)).hexdigest() != '${fingerprint}':
        raise ValueError('Mac identity changed; copy a fresh command from Agent Squad')
    conn.request('POST', '/${token}/pairing', body=data, headers={'Content-Type':'application/json'})
    response = conn.getresponse()
    if response.status != 200: raise ValueError('Agent Squad could not import the pairing. Check the Mac and retry.')
    print(response.read(4096).decode())
    conn.close()
except Exception:
    sys.exit('Transfer failed. Check that the Pi is paired, both devices are on the same network, and the Mac transfer window is open. The Pi service stays stopped; no credentials were printed.')
`;}
