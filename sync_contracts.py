"""Publish exact tradable index option identifiers from Upstox's daily masters."""
import gzip
import json
import os
import urllib.request
from datetime import datetime, timezone, timedelta
from pathlib import Path

ist=timezone(timedelta(hours=5,minutes=30))
target=Path('dist/market/contracts.json')
archive_path=target.with_name("retired-options.json")
previous=json.loads(target.read_text()) if target.exists() else []
result=[]
for exchange,symbol in [('NSE','NIFTY'),('BSE','SENSEX')]:
    path=os.environ.get(exchange+'_MASTER')
    raw=Path(path).read_bytes() if path else urllib.request.urlopen('https://assets.upstox.com/market-quote/instruments/exchange/'+exchange+'.json.gz',timeout=45).read()
    master=json.loads(gzip.decompress(raw))
    if exchange=='NSE':
        shares=sorted([x['trading_symbol'],x.get('short_name') or x.get('name') or x['trading_symbol'],x['instrument_key']] for x in master if x.get('segment')=='NSE_EQ' and x.get('instrument_type') in ('EQ','BE'))
        Path('dist/market/shares.json').write_text(json.dumps(shares,separators=(',',':')))
    options=[x for x in master if x.get('underlying_symbol')==symbol and x.get('instrument_type') in ('CE','PE')]
    expiries=sorted({x['expiry'] for x in options if datetime.fromtimestamp(x['expiry']/1000,ist).date()>=datetime.now(ist).date()})[:4]
    monthly=sorted({x['expiry'] for x in options if x.get('weekly') is False and datetime.fromtimestamp(x['expiry']/1000,ist).date()>=datetime.now(ist).date()})
    expiries=set(expiries+monthly[:2])
    if not expiries:raise ValueError('No active expiries for '+symbol)
    for x in options:
        if x['expiry'] in expiries:
            result.append([x['trading_symbol'],x['instrument_key'],datetime.fromtimestamp(x['expiry']/1000,ist).date().isoformat(),x['strike_price'],x['instrument_type'],x['lot_size'],x.get('weekly') is False])
today=datetime.now(ist).date()
archive=json.loads(archive_path.read_text()) if archive_path.exists() else {"since":str(today),"rows":[]}
cutoff=str(today-timedelta(days=60))
retired={r[0]:r for r in archive["rows"]+previous if cutoff<=r[2]<str(today) and len(r)==7}
archive={"since":max(archive["since"],cutoff),"rows":sorted(retired.values())}
archive_path.write_text(json.dumps(archive,separators=(',',':')))
target.write_text(json.dumps(sorted(result),separators=(',',':')))
