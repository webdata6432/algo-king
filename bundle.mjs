import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=new URL('./dist/',import.meta.url);
let html=await readFile(new URL('index.html',root),'utf8');
for(const match of [...html.matchAll(/<link rel="stylesheet" href="([^"]+)">|<script src="([^"]+)"><\/script>/g)]){
 const source=await readFile(new URL(match[1]||match[2],root),'utf8');
 html=html.replace(match[0],()=>match[1]?'<style>'+source+'</style>':'<script>'+source.replace(/<\/script/gi,'<\\/script')+'</script>');
}
await writeFile(process.argv[2]||fileURLToPath(new URL('AlgoKing.html',root)),html);
