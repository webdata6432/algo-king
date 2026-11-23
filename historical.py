"""Build NIFTY intraday model trades from consecutive NSE F&O reports."""
import csv
import datetime as dt
import io
import json
import os
import pathlib
import urllib.error
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor

OUT = pathlib.Path("dist/market/historical.json")
TODAY = dt.datetime.now(dt.timezone(dt.timedelta(hours=5, minutes=30))).date()


def report(day):
    url = f"https://nsearchives.nseindia.com/content/fo/BhavCopy_NSE_FO_0_0_0_{day:%Y%m%d}_F_0000.csv.zip"
    try:
        with urllib.request.urlopen(url, timeout=22) as response:
            archive = zipfile.ZipFile(io.BytesIO(response.read()))
        with archive.open(archive.namelist()[0]) as stream:
            rows = [r for r in csv.DictReader(io.TextIOWrapper(stream)) if
                    r["TckrSymb"] == "NIFTY" and r["FinInstrmTp"] == "IDO"
                    and r["TradDt"] == str(day)]
        return rows or None
    except urllib.error.HTTPError as err:
        return [] if err.code == 404 else None
    except (OSError, zipfile.BadZipFile):
        return None


def trades(day, prior, current):
    expiry = min(r["XpryDt"] for r in current)
    fills = {r["FinInstrmId"]: r for r in current}
    result = []
    for side in ("CE", "PE"):
        candidates = [r for r in prior if r["XpryDt"] == expiry and r["OptnTp"] == side
                      and float(r["TtlTradgVol"]) > 0 and float(r["ClsPric"]) > 0]
        if not candidates:
            continue
        for rule, cap in [("ATM", None), ("Under 200", 200), ("Near 300", 300)]:
            pool = [r for r in candidates if cap != 200 or float(r["ClsPric"]) < cap]
            if not pool:
                continue
            def distance(r):
                return (abs(float(r["ClsPric"]) - cap) if cap else
                        abs(float(r["StrkPric"]) - float(r["UndrlygPric"])), float(r["StrkPric"]))
            selected = min(pool, key=distance)
            r = fills.get(selected["FinInstrmId"])
            if not r or float(r["TtlTradgVol"]) <= 0:
                continue
            op, cl = float(r["OpnPric"]), float(r["ClsPric"])
            if min(op, cl) <= 0 or (cap == 200 and op >= cap):
                continue
            result.append([str(day), rule, side, expiry, float(r["StrkPric"]), op, cl, int(r["NewBrdLotQty"])])
    return result


if __name__ == "__main__":
    history = json.loads(OUT.read_text()) if OUT.exists() else {}
    # UDiFF files include the underlying close and actual contract lot.
    inception = dt.date(2024, 7, 8)
    oldest = min((dt.date.fromisoformat(d) for d in history), default=TODAY)
    batch = int(os.environ.get("HISTORY_BACKFILL_DAYS", "32"))
    intervals = [(max(inception, oldest - dt.timedelta(days=batch + 8)), oldest),
                 (TODAY - dt.timedelta(days=12), TODAY)]
    if intervals[0][1] >= intervals[1][0]:
        intervals = [(intervals[0][0], TODAY)]
    # Revisit failed publications, including the prior session needed for selection.
    retry = [dt.date.fromisoformat(d) for d, rows in sorted(history.items()) if rows is None][:6]
    for day in retry:
        if not any(lo <= day <= hi for lo, hi in intervals):
            intervals.append((max(inception, day-dt.timedelta(days=8)), day))
    for start, end in intervals:
        if start > end:
            continue
        days = [start + dt.timedelta(days=i) for i in range((end-start).days+1)]
        prior = None
        fetch_failed = False
        with ThreadPoolExecutor(max_workers=6) as workers:
            for day, rows in zip(days, workers.map(report, days)):
                if rows is None:
                    prior = None
                    fetch_failed = True
                    if day < TODAY:
                        history.setdefault(str(day), None)
                elif not rows:
                    if history.get(str(day)) is None:
                        history.pop(str(day), None)
                else:
                    if prior:
                        history[str(day)] = trades(day, prior, rows)
                    elif fetch_failed:
                        history.setdefault(str(day), None)
                    prior = rows
                    fetch_failed = False
    if not any(history.values()):
        raise SystemExit("No verified historical trades")
    OUT.write_text(json.dumps(history, sort_keys=True, separators=(",", ":")) + "\n")
    print(f"{len(history)} sessions: {min(history)} through {max(history)}")
