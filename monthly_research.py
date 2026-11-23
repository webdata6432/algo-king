"""Monthly NIFTY trend and premium research using published F&O bhavcopies."""
import calendar
import csv
import datetime as dt
import io
import json
import subprocess
import zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

DEST = Path("dist/market/monthly-research.json")
TODAY = dt.datetime.now(dt.timezone(dt.timedelta(hours=5, minutes=30))).date()
SWITCH = dt.date(2024, 7, 8)
DAY = dt.timedelta(days=1)


def report(day):
    old = day < SWITCH
    month = day.strftime("%b").upper()
    path = (f"content/historical/DERIVATIVES/{day:%Y}/{month}/" + f"fo{day.strftime('%d%b%Y').upper()}bhav.csv.zip"
            if old else f"content/fo/BhavCopy_NSE_FO_0_0_0_{day:%Y%m%d}_F_0000.csv.zip")
    url = "https://archives.nseindia.com/" + path
    buf = subprocess.check_output(["curl", "-fsSL", "--retry", "2", "--max-time", "24", url], stderr=subprocess.DEVNULL)
    archive = zipfile.ZipFile(io.BytesIO(buf))
    out = []
    for r in csv.DictReader(io.TextIOWrapper(archive.open(archive.namelist()[0]))):
        if r.get("SYMBOL", r.get("TckrSymb")) != "NIFTY":
            continue
        if old:
            if r["TIMESTAMP"].upper() != day.strftime("%d-%b-%Y").upper():
                raise ValueError("Date mismatch")
            expiry = str(dt.datetime.strptime(r["EXPIRY_DT"], "%d-%b-%Y").date())
            side, strike, op, cl, vol = [r[k] for k in ("OPTION_TYP","STRIKE_PR","OPEN","CLOSE","CONTRACTS")]
            lot = 50 if day < dt.date(2024,4,26) else 25
        else:
            if r["TradDt"] != str(day):
                raise ValueError("Date mismatch")
            expiry = r["XpryDt"]
            side, strike, op, cl, vol = [r[k] for k in ("OptnTp","StrkPric","OpnPric","ClsPric","TtlTradgVol")]
            lot = int(float(r["NewBrdLotQty"]))
        if float(vol) > 0 and float(op)>0 and float(cl)>0:
            out.append((expiry,side or "XX",float(strike or 0),float(op),float(cl),lot))
    return out


def test(day):
    try:
        prior = report(day-DAY)
        futures = min(r for r in prior if r[1]=="XX" and r[0]>=str(day))
        side = "PE" if futures[4]>futures[3] else "CE" if futures[4]<futures[3] else None
        choices = [r for r in prior if r[1] in ("CE","PE") and r[0]>=str(day)]
        expiry = min(r[0] for r in choices)
        choices = [r for r in choices if r[0]==expiry]
        current = {r[:3]:r for r in report(day)}
        rows=[]
        for name,offset,leg in [("Trend ATM",0,side),("Trend OTM",0.01,side),("Monthly put",0.01,"PE")]:
            pool=[r for r in choices if r[1]==leg]
            if not pool:
                continue
            target=futures[4]*(1+offset*(1 if leg=="CE" else -1))
            contract=min(pool,key=lambda r:(abs(r[2]-target),r[2]))
            fill=current.get(contract[:3])
            if fill:
                exp,side_,k,op,cl,lot=fill
                rows.append([str(day),name,side_,exp,k,op,cl,lot])
        return rows
    except (OSError, ValueError, KeyError, zipfile.BadZipFile, subprocess.SubprocessError):
        return []


if __name__=="__main__":
    data=json.loads(DEST.read_text()) if DEST.exists() else {}
    dates=[]
    for year in range(2022,TODAY.year+1):
        for month in range(1,13):
            day=dt.date(year,month,15)
            day+=dt.timedelta(days=(calendar.WEDNESDAY-day.weekday())%7)
            if day<=TODAY and len(data.get(str(day),[]))<3:
                dates.append(day)
    with ThreadPoolExecutor(max_workers=8) as pool:
        for day,rows in zip(dates,pool.map(test,dates)):
            existing = {r[1]: r for r in data.get(str(day), [])}
            existing.update({r[1]: r for r in rows})
            data[str(day)] = list(existing.values())
    DEST.write_text(json.dumps(data,sort_keys=True,separators=(",",":"))+"\n")
