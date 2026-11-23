"""Build NIFTY intraday model trades from consecutive NSE F&O reports."""
import csv
import datetime as dt
import io
import json
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
    days = sorted(TODAY - dt.timedelta(days=i) for i in range(36))
    history = json.loads(OUT.read_text()) if OUT.exists() else {}
    prior = None
    with ThreadPoolExecutor(max_workers=4) as workers:
        for day, rows in zip(days, workers.map(report, days)):
            if rows is None:
                prior = None
            elif rows:
                if prior:
                    history[str(day)] = trades(day, prior, rows)
                prior = rows
    if not any(history.values()):
        raise SystemExit("No verified historical trades")
    OUT.write_text(json.dumps(history, sort_keys=True, separators=(",", ":")) + "\n")
