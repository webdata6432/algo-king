"""Build the private comparison report from audited research output."""
import argparse
import gzip
import hashlib
import json
import re
from pathlib import Path


def load(path):
    return json.loads(path.read_text())


def check_fills(trades, start, end, expected_n, expected_net):
    part = [row for row in trades if start <= row[0] <= end]
    if len(part) != expected_n or abs(sum(row[15] for row in part) - expected_net) > 0.015:
        raise ValueError('Trade ledger does not reconcile with its published summary')
    dates = [row[0] for row in trades]
    if dates != sorted(set(dates)):
        raise ValueError('The strategy must have at most one chronological basket per session')


def normalized_options(rr, hedge):
    models = []
    for m in rr['models']:
        for key, interval in rr['ranges'].items():
            totals = m['summary'][key]
            check_fills(m['trades'], interval['from'], interval['to'], totals['trades'], totals['net'])
        model={k: v for k, v in m.items() if k != 'summary'}
        model['fixedFees'] = m.get('fixedFees',188.80 if m['strategy']=='expiry-iron-fly' else 94.40)
        models.append(model)
    for symbol, study in hedge.items():
        status = {}
        for period in study['periods'].values():
            status.update(period['status'])
        fills = []
        for t in study['trades']:
            fills.append([t['date'], t['expiry'], t['side'], t['shortStrike'], t['hedgeStrike'],
                          t['qty'], t['shortEntry'], t['longEntry'], 900, t['shortExit'], t['longExit'],
                          'Time', t['gross'], t['charges'], t['slippage'], t['net'], None, None, t['source']])
        fills.sort()
        for interval in study['periods'].values():
            totals = interval['summary']
            check_fills(fills, interval['fromDate'], interval['toDate'], totals['n'], totals['net'])
        models.append(dict(strategy='expiry-otm', fixedFees=94.40, symbol=symbol, entry='10:30', exit='15:00', rr=None,
                           trades=sorted(fills), skips=sorted([d,s] for d,s in status.items() if s!='Trade')))
    periods = {k: {a: v[b] for a,b in [('from','fromDate'),('to','toDate'),('holdoutFrom','mid')]}
               for k,v in hedge['NIFTY']['periods'].items()}
    return dict(rrRanges=rr['ranges'], hedgeRanges={**{'year':periods['earlier'],'recent':periods['requested']},**({'july':periods['toJuly']} if 'toJuly' in periods else {})},
                columns=rr['columns'], models=models)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--rr', type=Path, required=True)
    parser.add_argument('--hedge', type=Path, required=True)
    parser.add_argument('--settlement', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--set-version', action='store_true')
    args = parser.parse_args()
    report = normalized_options(load(args.rr), load(args.hedge))
    settlement = load(args.settlement)
    report['settlement'] = {key: settlement[key] for key in ('fromDate','toDate','source','annual')}
    report['settlement']['eligible'] = len(settlement['dailyStatus'])
    blob = gzip.compress(json.dumps(report,separators=(',',':'),allow_nan=False).encode(),mtime=0)
    if len(blob)>8_000_000:
        raise ValueError('Split this report into smaller archives before publishing.')
    name = 'options-'+hashlib.sha256(blob).hexdigest()[:20]+'.gz'
    args.output.mkdir(parents=True,exist_ok=True)
    (args.output/name).write_bytes(blob)
    if args.set_version:
        script=Path(__file__).parent/'dist/intraday-study.js'
        content,count=re.subn(r"(?m)^const intradayStudyAsset = '[^']*';", f"const intradayStudyAsset = 'research/{name}';", script.read_text(),count=1)
        if count!=1:
            raise ValueError('Missing report reference')
        script.write_text(content)
    print(name,len(blob))


if __name__=='__main__':
    main()
