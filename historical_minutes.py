"""Keep exact-contract minute opens for the ready-made strategies."""
import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import quote
import subprocess

base = Path("dist/market")
out = base / "historical-minutes.json"
archive = json.loads(out.read_text()) if out.exists() else {}
contracts = {(expiry, strike, side): key for name, key, expiry, strike, side, *_ in
             json.loads((base / "contracts.json").read_text()) if name.startswith("NIFTY ")}
jobs = {}
for rows in json.loads((base / "historical.json").read_text()).values():
    for day, _, side, expiry, strike, *_ in rows or []:
        tag = f"{day}/{expiry}/{strike:g}/{side}"
        key = contracts.get((expiry, strike, side))
        if key and tag not in archive:
            jobs[tag] = (key, day)


def fetch(item):
    tag, (key, day) = item
    url = f"https://api.upstox.com/v3/historical-candle/{quote(key, safe='')}/minutes/1/{day}/{day}"
    try:
        candles = json.loads(subprocess.check_output(["curl", "-fsSL", "--retry", "1", "--max-time", "25", url]))["data"]["candles"]
        prices = [None] * 375
        for stamp, op, _, _, _, volume, *_ in candles:
            minute = int(stamp[11:13]) * 60 + int(stamp[14:16]) - 555
            if stamp.startswith(day) and stamp.endswith("+05:30") and 0 <= minute < 375 and op > 0 and volume > 0:
                prices[minute] = round(op * 100)
        if any(prices):
            return tag, prices
    except (OSError, KeyError, ValueError, subprocess.SubprocessError):
        pass
    return tag, None


with ThreadPoolExecutor(max_workers=4) as pool:
    for tag, prices in pool.map(fetch, jobs.items()):
        if prices:
            archive[tag] = prices
out.write_text(json.dumps(archive, separators=(",", ":")) + "\n")
print(f"{len(archive)} archived option contract sessions")
