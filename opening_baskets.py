"""Predefined five-sector opening-hour signals, October 2023 through September 2026."""
import datetime as dt
import gzip
import json
from concurrent.futures import ThreadPoolExecutor
from stock_baskets import download, SECTORS, FIRST, LAST, ROOT, hours


def study():
    symbols = [s for pair in SECTORS for s in pair]
    jobs = [(s,y,m) for s in symbols for y in range(2023,2027) for m in (1,4,7,10)
            if FIRST <= str(dt.date(y,m,1)) <= LAST]
    history = {s:{} for s in symbols}
    with ThreadPoolExecutor(max_workers=8) as pool:
        for symbol,bars in pool.map(download,jobs):
            for ts,o,h,l,c,v,*_ in bars:
                if ts.endswith('+05:30') and ts[11:16] in hours and v>0 and 0<l<=min(o,c)<=max(o,c)<=h:
                    history[symbol].setdefault(ts[:10],{})[ts[11:16]] = (o,h,l,c)
    results=[]
    for name,side in [('Opening strength','Buy'),('Opening weakness','Sell')]:
        fills=[]
        sign=1 if side=='Buy' else -1
        for d in sorted(set.union(*(set(v) for v in history.values()))):
            def score(s):
                o,_,_,c=history[s][d][hours[0]]
                return sign*(c/o-1)
            if any(hours[0] not in history[s].get(d,{}) for s in symbols):
                continue
            chosen=[max(pair,key=score) for pair in SECTORS]
            if any(score(s)<0.005 for s in chosen):
                continue
            if any(set(history[s][d])!=set(hours) for s in chosen):
                continue
            for s in chosen:
                bars=history[s][d]
                ep=bars['10:15'][0]
                stop,target=ep*(1-sign*0.008),ep*(1+sign*0.016)
                xp,time,reason=bars['15:15'][0],'15:15','Time'
                for tm in hours[1:-1]:
                    op,high,low,_=bars[tm]
                    if sign*(op-stop)<=0: xp,reason=op,'Stop'
                    elif sign*(op-target)>=0: xp,reason=op,'Target'
                    elif (low<=stop if sign==1 else high>=stop): xp,reason=stop,'Stop'
                    elif (high>=target if sign==1 else low<=target): xp,reason=target,'Target'
                    else: continue
                    time=tm
                    break
                fills.append([d,s,ep,round(xp,4),time,reason])
        results.append(dict(name=name,side=side,entry='10:15',stop=.8,target=1.6,fills=fills))
    return results


if __name__=='__main__':
    output=ROOT/'opening-baskets.json.gz'
    output.write_bytes(gzip.compress(json.dumps(study(),separators=(',',':')).encode(),mtime=0))
