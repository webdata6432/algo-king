"""Replay the 09:45 NIFTY 500 five-sector short strategy with observed minute packs."""
import argparse
import json
from collections import defaultdict
from datetime import date
from pathlib import Path

from first_five import apply_september_review, hhmm, membership

ENTRY, EXIT, SLIP = 585, 900, .0005


def short_fill(bars, slippage):
    if ENTRY not in bars:
        return None
    op = bars[ENTRY][0]
    ep = op * (1 - slippage)
    stop, target = ep * 1.01, ep * .98
    for m in range(ENTRY, EXIT + 1):
        if m not in bars:
            return None
        o, h, l, _ = bars[m]
        if o >= stop:
            raw, reason = o, 'Stop loss at open'
        elif o <= target:
            raw, reason = o, 'Target at open'
        elif m == EXIT:
            raw, reason = o, '15:00 exit'
        elif h >= stop:
            raw, reason = stop, 'Stop loss'
        elif l <= target:
            raw, reason = target, 'Target'
        else:
            continue
        return dict(ep=ep, xp=raw*(1+slippage), entryRef=op, exitRef=raw,
                    entry='09:45', exit=hhmm(m), reason=reason)


def build(folder, first, last, universe, slippage=SLIP):
    updates = apply_september_review(universe['updates'])
    days = [d for d in universe['sessions'] if first <= d <= last]
    sessions = []
    for month in sorted({d[:7] for d in days}):
        ds = [d for d in days if d.startswith(month)]
        names, sectors, states, candidates = {}, {}, {}, defaultdict(list)
        for d in ds:
            snapshot = membership(updates, d)
            traded = json.loads((folder / f'ak-traded-{d}.json').read_text())
            names[d] = {k: traded[k] for k in snapshot.keys() & traded.keys()}
            sectors[d] = {k: snapshot[k][1] for k in names[d]}
            states[d] = dict(d=d, size=len(names[d]), observed=0, down=0, orders=[])
        for key in sorted(set().union(*(set(n) for n in names.values()))):
            pack = folder / f'ak-minute-{month}-{key}.json'
            if not pack.exists():
                continue
            by_day = defaultdict(dict)
            for epoch, op, hi, lo, close in json.loads(pack.read_text()):
                local = epoch+330
                minute = local % 1440
                if 555 <= minute <= EXIT:
                    d = date.fromordinal(date(1970, 1, 1).toordinal() + local//1440).isoformat()
                    if key in names.get(d, {}):
                        if minute in by_day[d] or not 0 < lo <= min(op, close) <= max(op, close) <= hi:
                            raise ValueError(f'Bad candle for {key} on {d}')
                        by_day[d][minute] = (op, hi, lo, close)
            for d, bars in by_day.items():
                if 555 not in bars or 584 not in bars:
                    continue
                state = states[d]
                op, close = bars[555][0], bars[584][3]
                down = (1-close/op)*100
                state['observed'] += 1
                state['down'] += close < op
                if not (1 <= down < 6) or not sectors[d][key] or any(m not in bars for m in range(555,585)):
                    continue
                if close >= bars[579][3]:
                    continue
                item = dict(s=names[d][key], isin=key, sector=sectors[d][key], side='Sell',
                            open=op, close0944=close, fallPct=down)
                candidates[d].append((item, short_fill(bars, slippage)))
        for d in ds:
            s = states[d]
            if not s['size'] or s['observed'] < .98*s['size']:
                s['missing'] = 'Insufficient regular-session opening data'
            elif 100*s['down'] < 55*s['size']:
                s['status'] = 'Breadth below 55%'
            else:
                picks, used = [], set()
                for item, fill in sorted(candidates[d], key=lambda r: (-r[0]['fallPct'], r[0]['s'])):
                    if item['sector'] in used:
                        continue
                    used.add(item['sector'])
                    picks.append((item,fill))
                    if len(picks) == 5:
                        break
                if len(picks) < 5:
                    s['status'] = 'Fewer than five qualifying sectors'
                elif any(f is None for _,f in picks):
                    s['missing'] = 'Incomplete execution candles in the selected basket'
                else:
                    s['orders'] = [dict(**item, **fill, leg=i) for i,(item,fill) in enumerate(picks,1)]
            sessions.append(s)
    return dict(first=first,last=last,sessions=sessions)


if __name__ == '__main__':
    p=argparse.ArgumentParser(description=__doc__)
    for name in ('folder','first','last','output'):
        p.add_argument(name)
    args=p.parse_args()
    catalog=json.loads(Path(__file__).with_name('dist').joinpath('market/breadth-universe.json').read_text())
    result=build(Path(args.folder),args.first,args.last,catalog)
    Path(args.output).write_text(json.dumps(result,separators=(',',':')))
