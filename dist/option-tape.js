// Private minute archives. Immutable filenames allow repeat runs to reuse the exact same data.
const tapeCatalogFiles = {"NIFTY": "catalog-6de02d59904388b1a39b.gz", "SENSEX": "catalog-e209920b87b563969fa8.gz"};
const tapeSpotFiles = {"NIFTY":[{"year":2021,"file":"NIFTY-2021-b7495c49f2fbea088afe.gz","first":"2021-11-29","last":"2021-12-31","rows":9375},{"year":2022,"file":"NIFTY-2022-34700ae00eef5c749d0f.gz","first":"2022-01-03","last":"2022-12-30","rows":92682},{"year":2023,"file":"NIFTY-2023-c081c73a598c172cb941.gz","first":"2023-01-02","last":"2023-12-29","rows":91936},{"year":2024,"file":"NIFTY-2024-b51b76544b8f885e9f6b.gz","first":"2024-01-01","last":"2024-12-31","rows":92523},{"year":2025,"file":"NIFTY-2025-c98c1a4164479c288d15.gz","first":"2025-01-01","last":"2025-12-31","rows":93060},{"year":2026,"file":"NIFTY-2026-87a21631bb32af7305ea.gz","first":"2026-01-01","last":"2026-11-27","rows":83695}],"SENSEX":[{"year":2021,"file":"SENSEX-2021-0a0903cf53c72c43435c.gz","first":"2021-11-29","last":"2021-12-31","rows":9374},{"year":2022,"file":"SENSEX-2022-4e5febaf49d04eb07477.gz","first":"2022-01-03","last":"2022-12-30","rows":92685},{"year":2023,"file":"SENSEX-2023-ad390c07718a1ca555bb.gz","first":"2023-01-02","last":"2023-12-29","rows":91936},{"year":2024,"file":"SENSEX-2024-2017275d31ac68becff2.gz","first":"2024-01-01","last":"2024-12-31","rows":92525},{"year":2025,"file":"SENSEX-2025-8f8efe69ab4b5f8ac207.gz","first":"2025-01-01","last":"2025-12-31","rows":93060},{"year":2026,"file":"SENSEX-2026-5db48bb1424cf77d90c3.gz","first":"2026-01-01","last":"2026-11-27","rows":83695}]};
const archiveMemory=new Map();
let archiveRefresh;
async function archiveSession(){
 if(!session)throw Error('Unlock Algo King to open the candle archive.');
 if(session.expires_at*1000<Date.now()+45000){
  const owner=session;
  archiveRefresh??=accountRequest('/auth/v1/token?grant_type=refresh_token',{refresh_token:owner.refresh_token})
   .then(s=>{if(session===owner)sessionChanged(s)}).finally(()=>{archiveRefresh=null});
  await archiveRefresh;
 }
 return session;
}
function archiveMemo(id,read){
 if(archiveMemory.has(id)){const item=archiveMemory.get(id);archiveMemory.delete(id);archiveMemory.set(id,item);return item}
 if(archiveMemory.size>=42)archiveMemory.delete(archiveMemory.keys().next().value);
 const promise=read().catch(err=>{if(archiveMemory.get(id)===promise)archiveMemory.delete(id);throw err});
 archiveMemory.set(id,promise);return promise;
}
async function privateArchiveBytes(path,range){
 const owner=await archiveSession(),url=authOrigin+'/storage/v1/object/authenticated/index-history/'+path;
 const key=new URL('local-archive/'+owner.user.id+'/'+path+(range?'?bytes='+range.join('-'):''),document.baseURI).href;
 let cache;
 try{if(globalThis.caches){cache=await caches.open('ak-private-index-v1');const hit=await cache.match(key);if(hit)return new Uint8Array(await hit.arrayBuffer())}}catch{}
 const res=await fetch(url,{headers:{apikey:publicKey,Authorization:'Bearer '+owner.access_token,...(range?{Range:'bytes='+range.join('-')}:{})},signal:AbortSignal.timeout(35000)});
 if(!res.ok)throw Error('Candle archive returned HTTP '+res.status+' for '+path.split('/')[0]+'.');
 let bytes=new Uint8Array(await res.arrayBuffer());
 if(range&&res.status===200)bytes=bytes.slice(range[0],range[1]+1);
 if(range&&bytes.length!==range[1]-range[0]+1)throw Error('Incomplete option candle block.');
 try{if(cache)await cache.put(key,new Response(bytes))}catch{}
 return bytes;
}
async function privateArchiveJSON(path){
 return archiveMemo('json:'+path,async()=>new Response(new Blob([await privateArchiveBytes(path)]).stream().pipeThrough(new DecompressionStream('gzip'))).json());
}
async function unpackTape(compressed){
 const buf=await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
 const data=new Uint8Array(buf),header=new DataView(buf),n=header.getUint32(4,true);
 if(header.getUint32(0)!==0x414b4f31 || buf.byteLength!==17+20*n)throw Error('Invalid candle archive block.');
 let epoch=header.getUint32(8,true),last=header.getUint32(12,true),day=-1,d;
 const scale=data[16]/100,rows=[];
 function col(k,i){const a=17+4*n*k+i;return data[a]+data[a+n]*256+data[a+2*n]*65536+data[a+3*n]*16777216}
 const signed=n=>n%2?-(n+1)/2:n/2;
 for(let i=0;i<n;i++){
  epoch+=col(0,i);const ist=epoch+330,today=Math.floor(ist/1440);
  if(today!==day){day=today;d=new Date(day*86400000).toISOString().slice(0,10)}
  const o=last+signed(col(1,i)),c=o+signed(col(2,i)),h=Math.max(o,c)+col(3,i),l=Math.min(o,c)-col(4,i);
  rows.push({d,m:ist%1440,o:o*scale,h:h*scale,l:l*scale,c:c*scale});last=c;
 }
 return rows;
}
async function spotTape(symbol,from,to){
 const years=tapeSpotFiles[symbol],valid=years.filter(y=>y.first<=to&&y.last>=from);
 const chunks=await Promise.all(valid.map(y=>archiveMemo('spot:'+y.file,async()=>unpackTape(await privateArchiveBytes('spot/'+y.file)))));
 return chunks.flatMap(rows=>rows.filter(r=>r.d>=from&&r.d<=to));
}
async function archivedOptionBook(symbol){
 const data=await privateArchiveJSON(symbol+'/'+tapeCatalogFiles[symbol]);
 const expiries=Object.keys(data.expiries).sort();
 function expiry(day,term){
  if(/^\d{4}-/.test(term))return term;
  const upcoming=data.calendar.filter(x=>x[0]>=day);
  return (term==='Monthly'?upcoming.find(r=>r[1]):upcoming[term==='Next week'?1:0])?.[0];
 }
 function listed(day,p){
  const date=expiry(day,p.optionExpiry),info=data.expiries[date];
  if(!info||!info.days.includes(day))return null;
  const cp=Number(p.cp==='PE');
  return info.contracts.filter(c=>c[0]===cp).map(c=>[symbol+' '+c[1]+' '+p.cp+' '+date,'tape/'+symbol+'/'+date+'/'+c[2]+'/'+c[3],date,c[1],p.cp,info.lot,info.monthly]);
 }
 function whole(date){const path=symbol+'/'+data.expiries[date].file;return archiveMemo('whole:'+path,()=>privateArchiveBytes(path))}
 async function bars(key,from,to,useWhole){
  const [,,date,off,size]=key.split('/'),path=symbol+'/'+data.expiries[date].file;
  const rows=await archiveMemo(key,async()=>unpackTape(useWhole?(await whole(date)).subarray(+off,+off+(+size)):await privateArchiveBytes(path,[+off,+off+(+size)-1])));
  return rows.filter(b=>b.d>=from&&b.d<=to);
 }
 return {listed,bars,partial:e=>Boolean(data.expiries[e]?.partial),lookup:(day,term)=>data.calendar.find(r=>r[0]===expiry(day,term)),first:data.first,last:data.last,expiries};
}
