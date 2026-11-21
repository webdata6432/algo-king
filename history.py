"""Download Upstox observed daily or one-minute candles to an import-ready CSV."""
import argparse
import csv
from datetime import date, timedelta, datetime
import json
import os
from urllib.parse import quote
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

def fetch_candles(instrument_key,symbol,start,end,daily,token):
    rows = {}
    while start <= end:
        stop = min(start + timedelta(days=27), end)
        unit = "days" if daily else "minutes"
        key = quote(instrument_key, safe="")
        url = f"https://api.upstox.com/v3/historical-candle/{key}/{unit}/1/{stop}/{start}"
        req = Request(url, headers={"Authorization": "Bearer "+token, "Accept":"application/json"})
        with urlopen(req, timeout=25) as response:
            candles = json.load(response)["data"]["candles"]
        for t,o,h,l,c,*_ in candles:
            stamp = datetime.fromisoformat(t).astimezone(ZoneInfo("Asia/Kolkata"))
            rows[t] = [symbol, str(stamp.date()), *([] if daily else [stamp.strftime("%H:%M")]), o,h,l,c]
        start = stop + timedelta(days=1)
    return rows

def main():
    p = argparse.ArgumentParser(description=__doc__)
    for k in ("instrument_key", "symbol", "start", "end", "output"):
        p.add_argument(k)
    p.add_argument("--daily", action="store_true")
    args = p.parse_args()
    token = os.environ["UPSTOX_ACCESS_TOKEN"]
    start, end = map(date.fromisoformat, (args.start, args.end))
    if start > end:
        p.error("Start date follows end date.")
    rows = fetch_candles(args.instrument_key,args.symbol,start,end,args.daily,token)
    if not rows:
        raise SystemExit("No candles returned for this instrument and period.")
    with open(args.output, "x", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["symbol","date", *([] if args.daily else ["time"]), "open","high","low","close"])
        writer.writerows(rows[t] for t in sorted(rows))
    print(len(rows), "observed candles saved.")
if __name__=="__main__":
    main()

