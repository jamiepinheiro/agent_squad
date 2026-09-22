import { readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const root=fileURLToPath(new URL('..',import.meta.url));
await import('../libraries/surfaces/whatsapp/scripts/patch-baileys.mjs');
// Remove obsolete compiled modules after moves; never package stale adapters.
for(const workspace of JSON.parse(readFileSync(join(root,'package.json'),'utf8')).workspaces) rmSync(join(root,workspace,'dist'),{recursive:true,force:true});
const result=spawnSync(process.execPath,[join(root,'node_modules/typescript/bin/tsc'),'-b'],{cwd:root,stdio:'inherit'});
process.exit(result.status ?? 1);
