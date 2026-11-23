"""Cache observed regular-session minute candles for recent index ATM contracts."""
import datetime as dt
import json
import gzip
import subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import quote

root=Path('dist/market')
target=root/'option-window.json.gz'
cache=json.loads(gzip.decompress(target.read_bytes())) if target.exists() else {}
end=dt.datetime.now(dt.timezone(dt.timedelta(hours=5,minutes=30))).date()
start=end-dt.timedelta(days=10)
chain=json.loads((root/'contracts.json').read_text())


def load(key):
    url=f'https://api.upstox.com/v3/historical-candle/{quote(key,safe="")}/minutes/1/{end}/{start}'
    raw=subprocess.check_output(['curl','-fsSL','--max-time','35','--retry','1',url])
    days={}
    for ts,o,h,l,c,*_ in json.loads(raw)['data']['candles']:
        m=int(ts[11:13])*60+int(ts[14:16])
        if ts.endswith('+05:30') and 555<=m<930 and 0<l<=min(o,c)<=max(o,c)<=h:
            days.setdefault(ts[:10],[]).append([m,*[round(x*100) for x in (o,h,l,c)]])
    return {d:sorted(b) for d,b in days.items()}


requests={}
for name,key in [('NIFTY','NSE_INDEX|Nifty 50'),('SENSEX','BSE_INDEX|SENSEX')]:
    days=load(key)
    for day,bars in days.items():
        price=next((b[1]/100 for b in bars if b[0]==570),None)
        if not price:continue
        cache[name+'|'+day]=bars
        monday=dt.date.fromisoformat(day)-dt.timedelta(days=dt.date.fromisoformat(day).weekday())
        choices=[r for r in chain if r[0].startswith(name+' ') and day<=r[2]<=str(monday+dt.timedelta(days=6))]
        if not choices:continue
        expiry=min(r[2] for r in choices)
        strikes=sorted({r[3] for r in choices if r[2]==expiry},key=lambda k:abs(k-price))[:3]
        for r in choices:
            if r[2]==expiry and r[3] in strikes:
                requests.setdefault(r[1],[]).append((day,r[0]))
def cache_contract(item):
    key,dates=item
    try:days=load(key)
    except (OSError,subprocess.SubprocessError,ValueError,KeyError):return {}
    return {name+'|'+day:days[day] for day,name in dates if day in days}

with ThreadPoolExecutor(max_workers=6) as pool:
    for records in pool.map(cache_contract,requests.items()):cache.update(records)
cache={k:v for k,v in cache.items() if k.split('|')[-1]>=str(end-dt.timedelta(days=30))}
target.write_bytes(gzip.compress(json.dumps(cache,separators=(',',':')).encode(),mtime=0))
