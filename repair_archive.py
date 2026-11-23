"""Deliver official NSE reports to the archive using the repository's workflow identity."""
import json
import os
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import date

endpoint = 'https://wpqcyyevhxqbhudsxydd.supabase.co/functions/v1/exchange-daily'
def send(token, action, body=b''):
    req = urllib.request.Request(endpoint+'?'+action, data=body, headers={'Authorization':'Bearer '+token})
    with urllib.request.urlopen(req, timeout=45) as response:
        return json.load(response)

def download(day):
    key = date.fromisoformat(day).strftime('%Y%m%d')
    url = f'https://nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0_{key}_F_0000.csv.zip'
    try:
        with urllib.request.urlopen(url, timeout=20) as response:
            return day, response.read(), 'report'
    except urllib.error.HTTPError as err:
        return day, b'', 'missing' if err.code==404 else 'retry'
    except OSError:
        return day, b'', 'retry'

for batch in range(35):
    req = urllib.request.Request(os.environ['ACTIONS_ID_TOKEN_REQUEST_URL']+'&audience=algo-king-daily',headers={'Authorization':'Bearer '+os.environ['ACTIONS_ID_TOKEN_REQUEST_TOKEN']})
    with urllib.request.urlopen(req,timeout=20) as response:
        token = json.load(response)['value']
    days = send(token,'action=list')['days']
    if not days:
        break
    with ThreadPoolExecutor(max_workers=4) as pool:
        for day, body, action in pool.map(download,days):
            send(token,f'action={action}&day={day}',body)
    print(f'Processed {len(days)} exchange report requests',flush=True)
