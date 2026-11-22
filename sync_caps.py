"""Build the cap and FYERS instrument directory. No price history is stored."""
import csv
import io
import json
import re
import subprocess
from pathlib import Path
from openpyxl import load_workbook

def download(url):
    return subprocess.check_output(['curl','-fsSL','--retry','2','--max-time','45',url])

page = download('https://www.amfiindia.com/otherdata/categorisation-of-stocks').decode()
url = next(link for link in re.findall(r'https://[^"<>\\\s]+\.xlsx', page)
           if 'averagemarketcapital' in link.lower())
sheet = load_workbook(io.BytesIO(download(url)), read_only=True, data_only=True).active
directory = {}
by_symbol = {}
listing_isin = {}
for exchange in ['BSE','NSE']:
    content = download(f'https://public.fyers.in/sym_details/{exchange}_CM.csv').decode()
    for row in csv.reader(io.StringIO(content)):
        if len(row) > 13 and row[5].startswith('IN') and row[9].startswith(exchange + ':'):
            directory[row[5]] = row[9]
            listing_isin[row[9]] = row[5]
            by_symbol[exchange, row[13]] = row[9]
companies = {}
assigned = set()
for row in sheet.values:
    if row[10] not in ('Large Cap','Mid Cap','Small Cap'):
        continue
    isin = str(row[2]).strip()
    ticker = directory.get(isin) or by_symbol.get(('NSE',row[5])) or by_symbol.get(('BSE',row[3]))
    symbol = ticker.split(':')[1].rsplit('-',1)[0] if ticker else next((str(s) for s in [row[5],row[3],isin] if s and s != '-'),isin)
    if ticker in assigned:
        ticker = None
    if ticker:
        assigned.add(ticker)
    exchange = ticker.split(':')[0] if ticker else ('NSE' if row[5] and row[5]!='-' else 'BSE')
    companies[isin] = [symbol,row[1],row[10],ticker,isin,exchange+'_EQ|'+listing_isin.get(ticker,isin)]
assert len(companies)>1000
dest=Path(__file__).parent/'dist/market/caps.json'
dest.write_text(json.dumps({'source':url,'companies':list(companies.values())},ensure_ascii=True,separators=(',',':')))
