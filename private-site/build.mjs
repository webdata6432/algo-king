import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {randomBytes,createCipheriv,publicEncrypt} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
await mkdir('published',{recursive:true});
execFileSync(process.execPath,['bundle.mjs','/tmp/ak-private-app.html']);
let html=await readFile('/tmp/ak-private-app.html','utf8');
for(const [file,mime] of [['algo-king.svg','image/svg+xml'],['rohit.jpg','image/jpeg']])
 html=html.replaceAll(file,'data:'+mime+';base64,'+(await readFile('dist/'+file)).toString('base64'));
for(const file of ['caps','shares','contracts','historical','historical-minutes']){
 const bytes=await readFile('dist/market/'+file+'.json');
 html=html.replaceAll("'market/"+file+".json'","'data:application/json;base64,"+bytes.toString('base64')+"'");
}
const key=randomBytes(32),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
await writeFile('published/app.gz.bin',Buffer.concat([iv,cipher.update(gzipSync(html,{level:9})),cipher.final(),cipher.getAuthTag()]));
await writeFile('published/key.txt',publicEncrypt({key:await readFile('private-site/public.pem'),oaepHash:'sha256'},key).toString('base64'));
await copyFile('private-site/index.html','published/index.html');
