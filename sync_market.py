"""Update observed NSE daily candles for the dashboard universe."""
import argparse
import csv
import io
import json
import re
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta, datetime
from pathlib import Path

root = Path(__file__).parent
# Evaluate the frontend universe including corrected exchange symbols.
import subprocess
symbols = set(json.loads(subprocess.check_output(['node','-e', "eval(require('fs').readFileSync('dist/data.js','utf8')+';console.log(JSON.stringify(groups.flat()))')"],cwd=root)))
aliases = {'GMRINFRA':'GMRAIRPORT','BIRLASOFT':'BSOFT','JINDALSTEL':'JINDALSTEL'}
lookup = {aliases.get(s,s):s for s in symbols}
index_names = {'Nifty 50':'NIFTY 50','Nifty Bank':'BANKNIFTY','NIFTY Midcap 100':'NIFTY MIDCAP 100'}
def fetch(job):
    day, index = job
    stamp = day.strftime('%d%m%Y')
    path = ('content/indices/ind_close_all_'+stamp+'.csv' if index else 'products/content/sec_bhavdata_full_'+stamp+'.csv')
    try:
        with urllib.request.urlopen('https://archives.nseindia.com/'+path,timeout=25) as response:
            reader = csv.DictReader(io.StringIO(response.read().decode('utf-8-sig')))
            result = []
            for raw in reader:
                row = {k.strip():v.strip() for k,v in raw.items() if k and v}
                if index:
                    s=index_names.get(row.get('Index Name'))
                    if not s: continue
                    d=datetime.strptime(row['Index Date'],'%d-%m-%Y').date()
                    o,c=float(row['Open Index Value']),float(row['Closing Index Value'])
                    prev=round(c-float(row['Points Change']),2)
                else:
                    s=lookup.get(row.get('SYMBOL'))
                    if not s or row.get('SERIES') not in ('EQ','BE'): continue
                    d=datetime.strptime(row['DATE1'],'%d-%b-%Y').date()
                    o,c,prev=map(float,(row['OPEN_PRICE'],row['CLOSE_PRICE'],row['PREV_CLOSE']))
                if d==day and min(o,c,prev)>0: result.append((s,[d.isoformat(),o,c,prev]))
            return result
    except Exception as exc:
        print(day,path,str(exc)[:80],file=sys.stderr)
        return []
parser=argparse.ArgumentParser()
parser.add_argument('--days',type=int,default=10)
args=parser.parse_args()
dest=root/'dist/market/daily.json'
data=json.loads(dest.read_text()) if dest.exists() else {}
bars={s:{r[0]:r for r in rows} for s,rows in data.items()}
days=[date.today()-timedelta(days=i) for i in range(args.days)]
count=0
with ThreadPoolExecutor(max_workers=6) as pool:
    for records in pool.map(fetch,[(d,index) for d in days for index in (False,True)]):
        for s,row in records:
            bars.setdefault(s,{})[row[0]]=row
            count+=1
# SENSEX trades on BSE and is absent from the NSE daily index report.
try:
    today = date.today()
    first = today - timedelta(days=max(args.days + 10, 20))
    url = f'https://api.upstox.com/v3/historical-candle/BSE_INDEX%7CSENSEX/days/1/{today}/{first}'
    raw = subprocess.check_output(['curl', '-fsSL', '--max-time', '30', url])
    prev = None
    for stamp, op, _, _, close, *_ in sorted(json.loads(raw)['data']['candles']):
        if op <= 0 or close <= 0:
            continue
        if prev is not None:
            bars.setdefault('SENSEX', {})[stamp[:10]] = [stamp[:10], op, close, prev]
            count += 1
        prev = close
except (subprocess.SubprocessError, KeyError, ValueError) as exc:
    print('SENSEX daily update unavailable:', exc, file=sys.stderr)
if not count:sys.exit('No exchange observations received')
dest.write_text(json.dumps({s:sorted(rows.values())[-520:] for s,rows in sorted(bars.items())},separators=(',',':')))
print(len(bars),'instruments;',count,'observations received')
