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
    path = f'/content/cm/BhavCopy_NSE_CM_0_0_0_{key}_F_0000.csv.zip'
    for host in ('nsearchives.nseindia.com','archives.nseindia.com'):
        url='https://'+host+path
        try:
            with urllib.request.urlopen(url, timeout=12) as response:
                body=response.read()
                if body.startswith(b'PK'):
                    return day, body, 'report'
        except urllib.error.HTTPError as err:
            if err.code==404 and host=='nsearchives.nseindia.com':
                return day,b'','missing'
        except OSError:
            pass
    return day,b'','retry'

for batch in range(35):
    req = urllib.request.Request(os.environ['ACTIONS_ID_TOKEN_REQUEST_URL']+'&audience=algo-king-daily',headers={'Authorization':'Bearer '+os.environ['ACTIONS_ID_TOKEN_REQUEST_TOKEN']})
    with urllib.request.urlopen(req,timeout=20) as response:
        token = json.load(response)['value']
    days = send(token,'action=list')['days']
    if not days:
        break
    temporarily_unavailable=0
    with ThreadPoolExecutor(max_workers=4) as pool:
        for day, body, action in pool.map(download,days):
            temporarily_unavailable+=action=='retry'
            send(token,f'action={action}&day={day}',body)
    if temporarily_unavailable==len(days):
        raise SystemExit('NSE reports temporarily unavailable. Pending dates retained for the next run.')
    print(f'Processed {len(days)} exchange report requests',flush=True)
