"""Pack observed TradeMarkk option candles for private, non-commercial backtests.

Input: options/{NIFTY,SENSEX}/YYYY-MM-DD.parquet from thetrademarkk/india-index-options-1m.
One gzip member per strike and side, indexed by byte range. Prices are stored
losslessly in paise or five-paise ticks; times are UTC epoch minutes.
"""
import argparse
import datetime as dt
import gzip
import hashlib
import json
import pathlib
import struct

import numpy as np
import pyarrow.parquet as pq

SYMBOLS = ('NIFTY','SENSEX')
VERSION = '0f4800e43e6f96cec0794369d78eb4d3c4211ef5'
FIRST = '2021-11-28'


def member(frame):
    epoch = frame.epoch.to_numpy(np.int64)
    units = np.rint(frame[['open','high','low','close']].to_numpy().T * 100).astype(np.int64)
    tick = 5 if (units % 5 == 0).all() else 1
    o,h,l,c = units // tick
    # Initial epoch and prior close in the header keep all body deltas small.
    prev = np.r_[o[0],c[:-1]]
    def zigzag(x):
        return (x << 1) ^ (x >> 63)
    cols = np.array([np.diff(epoch,prepend=epoch[0]),zigzag(o-prev),zigzag(c-o),h-np.maximum(o,c),np.minimum(o,c)-l],dtype='<u4')
    body = cols.view(np.uint8).reshape(5,len(c),4).transpose(0,2,1).tobytes()
    return gzip.compress(struct.pack('<4sIIIb',b'AKO1',len(c),int(epoch[0]),int(o[0]),tick)+body,compresslevel=5,mtime=0)


def pack(source, directory):
    symbol,expiry = source.parent.name,source.stem
    frame = pq.read_table(source).to_pandas()
    if set(frame.symbol)!={symbol} or set(frame.expiry)!={expiry}:
        raise ValueError(f'Mixed contracts in {source}')
    epoch = frame.timestamp.to_numpy(dtype='datetime64[m]').astype(np.int64)
    minute = (epoch+330)%1440
    days = ((epoch+330)//1440).astype('datetime64[D]').astype(str)
    if not np.array_equal(days,frame.trading_day.to_numpy()):
        raise ValueError(f'Trading day mismatch {source}')
    numeric = frame[['open','high','low','close']].to_numpy()
    if np.any(abs(numeric[np.isfinite(numeric)]*100-np.rint(numeric[np.isfinite(numeric)]*100))>.0001):
        raise ValueError(f'Unexpected sub-paise price in {source}')
    valid = (days>=FIRST)&(days<=expiry)&(minute>=555)&(minute<930)&(frame.volume.to_numpy()>0)&np.isfinite(numeric).all(axis=1)
    valid &= (frame.low>0)&(frame.low<=frame[['open','close']].min(axis=1))&(frame.high>=frame[['open','close']].max(axis=1))
    rejected = len(frame)-int(valid.sum())
    frame = frame.loc[valid].assign(epoch=epoch[valid]).sort_values(['option_type','strike','epoch'])
    if frame.empty:return None
    key=['option_type','strike','epoch']
    dupe=frame[frame.duplicated(key,False)]
    if len(dupe):
        ambiguous=dupe.groupby(key)[['open','high','low','close']].nunique().max(axis=1)
        if (ambiguous>1).any():raise ValueError(f'Conflicting duplicate {source}')
        frame=frame.drop_duplicates(key)
    payload=bytearray(); contracts=[]
    for (cp,strike),group in frame.groupby(['option_type','strike'],sort=True):
        data=member(group)
        contracts.append([int(cp=='PE'),int(strike),len(payload),len(data)])
        payload+=data
    dates=sorted(set(frame.trading_day));key=hashlib.sha256(payload).hexdigest()[:20]
    filename=f'{expiry}-{key}.bin'
    folder=directory/symbol;folder.mkdir(exist_ok=True,parents=True)
    (folder/filename).write_bytes(payload)
    meta=dict(expiry=expiry,file=filename,days=dates,contracts=contracts,rows=len(frame),rejected=rejected,bytes=len(payload))
    (folder/(expiry+'.meta')).write_text(json.dumps(meta,separators=(',',':')))
    return meta


if __name__=='__main__':
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('source',type=pathlib.Path);ap.add_argument('output',type=pathlib.Path);args=ap.parse_args()
    result=pack(args.source,args.output)
    if result:print(args.source.parent.name,result['expiry'],result['rows'],result['bytes'],flush=True)
