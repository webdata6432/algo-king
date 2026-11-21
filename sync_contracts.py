"""Publish exact tradable index option identifiers from Upstox's daily masters."""
import gzip
import json
import os
import urllib.request
from datetime import datetime, timezone, timedelta
from pathlib import Path

ist=timezone(timedelta(hours=5,minutes=30))
target=Path('dist/market/contracts.json')
result=[]
for exchange,symbol in [('NSE','NIFTY'),('BSE','SENSEX')]:
    path=os.environ.get(exchange+'_MASTER')
    raw=Path(path).read_bytes() if path else urllib.request.urlopen('https://assets.upstox.com/market-quote/instruments/exchange/'+exchange+'.json.gz',timeout=45).read()
    master=json.loads(gzip.decompress(raw))
    options=[x for x in master if x.get('underlying_symbol')==symbol and x.get('instrument_type') in ('CE','PE')]
    expiries=sorted({x['expiry'] for x in options if datetime.fromtimestamp(x['expiry']/1000,ist).date()>=datetime.now(ist).date()})[:4]
    if not expiries:raise ValueError('No active expiries for '+symbol)
    for x in options:
        if x['expiry'] in expiries:
            result.append([x['trading_symbol'],x['instrument_key'],datetime.fromtimestamp(x['expiry']/1000,ist).date().isoformat(),x['strike_price'],x['instrument_type'],x['lot_size']])
target.write_text(json.dumps(sorted(result),separators=(',',':')))
