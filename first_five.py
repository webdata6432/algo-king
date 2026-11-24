"""Build the first-five report from observed minute packs and traded NSE ISINs.

Usage: python first_five.py DATA_DIR YYYY-MM-DD YYYY-MM-DD OUTPUT.json
DATA_DIR contains ak-minute-YYYY-MM-ISIN.json (epoch minute, OHLC) and
ak-traded-YYYY-MM-DD.json (NSE daily report mapping traded ISIN to symbol).
"""
import argparse
import json
from collections import defaultdict
from datetime import date
from pathlib import Path

OPEN, START, EXIT = 555, 560, 900
SLIPPAGE = 0.0005


def hhmm(minute):
    return f'{minute // 60:02}:{minute % 60:02}'


def first_cross(bars):
    """Use a completed OHLC bar, then fill at the open of the following bar."""
    if OPEN not in bars or START - 1 not in bars:
        return None, OPEN
    reference = round(bars[OPEN][0] * 100)
    upper, lower = 102 * reference, 98 * reference
    prev = round(bars[START - 1][3] * 100) * 100
    for minute in range(START, EXIT - 1):
        if minute not in bars:
            return None, minute
        o, h, l, c = (round(p * 100) * 100 for p in bars[minute])
        buy, sell = prev <= upper < h, prev >= lower > l
        if buy and sell and lower <= o <= upper:
            return None, minute
        if buy or sell:
            return (minute, 'Buy' if buy and (not sell or o > upper) else 'Sell'), None
        prev = c
    return None, None


def fill_trade(bars, minute, side):
    entry = minute + 1
    if entry not in bars:
        return None
    sign = 1 if side == 'Buy' else -1
    raw_entry = bars[entry][0]
    ep = raw_entry * (1 + sign * SLIPPAGE)
    stop = ep * (1 - sign * .01)
    for m in range(entry, EXIT + 1):
        if m not in bars:
            return None
        o, h, l, _ = bars[m]
        if sign * (o - stop) <= 0:
            raw_exit, reason = o, 'Stop loss at open'
        elif m == EXIT:
            raw_exit, reason = o, '15:00 exit'
        elif (l <= stop if sign == 1 else h >= stop):
            raw_exit, reason = stop, 'Stop loss'
        else:
            continue
        xp = raw_exit * (1 - sign * SLIPPAGE)
        return dict(sessionOpen=bars[OPEN][0], level=bars[OPEN][0]*(1+sign*.02), signal=hhmm(minute), entry=hhmm(entry), exit=hhmm(m),
                    ep=ep, xp=xp, entryRef=raw_entry, exitRef=raw_exit, reason=reason)


def membership(updates, day):
    roster = {}
    for stamp, changes, removed in updates:
        if stamp > day:
            break
        for k in removed:
            roster.pop(k, None)
        roster.update(changes)
    return roster


def apply_september_review(updates):
    # NSE Indices, semiannual review announced before 30 September 2026.
    # The matching fund disclosure became public on 10 October. Only the
    # announced struck/additional names take effect on the exchange date.
    # https://noticeblue.com/circulars/e56dd516-fb39-4f99-8f84-4b8bd582f5c2
    prior = membership(updates, '2026-09-29')
    later = membership(updates, '2026-10-10')
    added = {k: later[k] for k in later.keys() - prior.keys() if k != 'INE0Y9J01020'}
    removed = sorted(prior.keys() - later.keys())
    if len(added) != 27 or len(removed) != 27:
        raise ValueError('September 2026 constituent review has changed. Verify the exchange bulletin.')
    return sorted([*updates, ['2026-09-30', added, removed]], key=lambda row: row[0])


def build(folder, start, end, universe):
    sessions = [d for d in universe['sessions'] if start <= d <= end]
    if not sessions:
        raise ValueError('No covered exchange sessions')
    updates = apply_september_review(universe['updates'])
    out = []
    for month in sorted({d[:7] for d in sessions}):
        days = [d for d in sessions if d.startswith(month)]
        rosters = {d: membership(updates, d) for d in days}
        allowed = {}
        for d in days:
            traded = json.loads((folder / f'ak-traded-{d}.json').read_text())
            allowed[d] = {k: traded[k] for k in rosters[d] if k in traded}
            if not allowed[d]:
                raise ValueError(f'No exchange symbols matched for {d}')
        signals, unknown = defaultdict(list), defaultdict(list)
        for key in sorted(set.union(*(set(a) for a in allowed.values()))):
            pack = folder / f'ak-minute-{month}-{key}.json'
            rows = json.loads(pack.read_text()) if pack.exists() else []
            grouped = defaultdict(dict)
            for epoch, o, h, l, c in rows:
                local = epoch + 330
                m = local % 1440
                if not OPEN <= m <= EXIT:
                    continue
                d = date.fromordinal(date(1970, 1, 1).toordinal() + local // 1440).isoformat()
                if key not in allowed.get(d, {}):
                    continue
                if m in grouped[d] or min(o, h, l, c) <= 0 or l > min(o, c) or h < max(o, c):
                    raise ValueError(f'Invalid or duplicate bar for {key} on {d}')
                grouped[d][m] = (o, h, l, c)
            for d in days:
                if key not in allowed[d]:
                    continue
                bars = grouped[d]
                signal, gap = first_cross(bars)
                if gap is not None:
                    unknown[d].append(gap)
                if signal:
                    minute, side = signal
                    # Preserve rank even when a later fill is missing.
                    fill = fill_trade(bars, minute, side)
                    signals[d].append((minute, allowed[d][key], key, side, fill))
        for d in days:
            chosen = sorted(signals[d])[:5]
            cutoff = chosen[-1][0] if len(chosen) == 5 else EXIT - 2
            uncertain = sum(m <= cutoff for m in unknown[d])
            result = dict(d=d, members=len(rosters[d]), traded=len(allowed[d]), orders=[])
            if len(chosen) == 5:
                result['sameMinuteExtras'] = sum(row[0] == cutoff for row in signals[d]) - sum(row[0] == cutoff for row in chosen)
            if uncertain == len(allowed[d]) and all(m == OPEN for m in unknown[d]):
                result['missing'] = 'No 09:15–09:20 regular-session opening window'
            elif uncertain:
                result['missing'] = f'{uncertain} instruments with uncertain prices before the selection cutoff'
            elif any(not x[4] for x in chosen):
                result['missing'] = 'A selected stock has a missing execution candle'
            else:
                for i, (_, symbol, key, side, fill) in enumerate(chosen, 1):
                    result['orders'].append(dict(leg=i, s=symbol, isin=key, side=side, **fill))
            out.append(result)
    return dict(version=1, first=start, last=end, sessions=out)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('folder', 'start', 'end', 'output'):
        parser.add_argument(name)
    args = parser.parse_args()
    series = json.loads(Path(__file__).with_name('dist').joinpath('market/breadth-universe.json').read_text())
    report = build(Path(args.folder), args.start, args.end, series)
    Path(args.output).write_text(json.dumps(report, separators=(',', ':')))
