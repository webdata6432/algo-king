"""Replay weekly stock baskets over twelve complete quarters from observed Upstox hourly bars."""
import calendar
import datetime as dt
import json
import gzip
import subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import quote

SECTORS = [('INFY','TCS'),('HDFCBANK','ICICIBANK'),('MARUTI','M&M'),('SUNPHARMA','CIPLA'),('ITC','HINDUNILVR')]
FIRST, LAST = '2023-10-01','2026-09-30'
RULES = [('Leader continuation',1,True,1,2),('Laggard continuation',-1,False,1,2),
         ('Leader fade',-1,True,0.8,1.2),('Laggard rebound',1,False,0.8,1.2)]
ROOT=Path('dist/market')
symbols={s:k for s,_,k in json.loads((ROOT/'shares.json').read_text())}
hours=['09:15','10:15','11:15','12:15','13:15','14:15','15:15']


def download(job):
    symbol,year,month=job
    last=dt.date(year,month+2,calendar.monthrange(year,month+2)[1])
    first=dt.date(year,month,1)
    key=quote(symbols[symbol],safe='')
    url=f'https://api.upstox.com/v3/historical-candle/{key}/hours/1/{last}/{first}'
    raw=subprocess.check_output(['curl','-fsSL','--retry','3','--max-time','40',url])
    bars=json.loads(raw)['data']['candles']
    if not bars:
        raise ValueError((symbol,first))
    return symbol,bars


def replay():
    jobs=[(s,y,m) for sector in SECTORS for s in sector for y in range(2023,2027)
          for m in (1,4,7,10) if FIRST<=str(dt.date(y,m,1))<=LAST]
    history={}
    with ThreadPoolExecutor(max_workers=8) as pool:
        for symbol,bars in pool.map(download,jobs):
            days=history.setdefault(symbol,{})
            for ts,o,h,l,c,v,*_ in bars:
                if ts.endswith('+05:30') and ts[11:16] in hours and v>0 and 0<l<=min(o,c)<=max(o,c)<=h:
                    days.setdefault(ts[:10],{})[ts[11:16]]=(o,h,l,c)
    days=sorted(set.union(*(set(h) for h in history.values())))
    output=[[] for _ in RULES]
    for i,d in enumerate(days):
        if not i or dt.date.fromisoformat(d).weekday()!=1:
            continue
        prev=days[i-1]
        if any(set(history[s].get(prev,{}))!=set(hours) for sec in SECTORS for s in sec):
            continue
        for ix,(_,sign,leader,sl,tp) in enumerate(RULES):
            fills=[]
            for sector in SECTORS:
                def signal(s):
                    bars=history[s][prev]
                    return bars[hours[-1]][3]/bars[hours[0]][0]-1
                s=(max if leader else min)(sector,key=signal)
                bars=history[s].get(d,{})
                if set(bars)!=set(hours):break
                ep=bars[hours[0]][0]; stop=ep*(1-sign*sl/100);target=ep*(1+sign*tp/100)
                xp=bars[hours[-1]][0];time=hours[-1];reason='Time'
                for tm in hours[:-1]:
                    op,h,l,_=bars[tm]
                    if sign*(op-stop)<=0 or (l<=stop if sign==1 else h>=stop):
                        if sign*(op-target)>=0:xp,reason=op,'Target'
                        else:xp,reason=(op if sign*(op-stop)<=0 else stop),'Stop'
                    elif sign*(op-target)>=0 or (h>=target if sign==1 else l<=target):
                        xp,reason=(op if sign*(op-target)>=0 else target),'Target'
                    else:continue
                    time=tm;break
                fills.append([d,s,ep,round(xp,4),time,reason])
            if len(fills)==5:output[ix].extend(fills)
    return [{'name':r[0],'side':'Buy' if r[1]==1 else 'Sell','stop':r[3],'target':r[4],'fills':fills} for r,fills in zip(RULES,output)]


if __name__=='__main__':
    (ROOT/'stock-baskets.json.gz').write_bytes(gzip.compress(json.dumps(replay(),separators=(',',':')).encode(),mtime=0))
