"""Private, loopback-only read-only market data gateway."""
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timezone
from history import fetch_candles
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PORT = int(os.getenv("ATLAS_PORT", "8765"))
def now():
    return datetime.now(timezone.utc).isoformat()

def up(path, params, token):
    url = "https://api.upstox.com/v2/" + path + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"Authorization":"Bearer "+token,"Accept":"application/json"})
    with urllib.request.urlopen(req,timeout=10) as response:
        return json.load(response)["data"]

class Handler(SimpleHTTPRequestHandler):
    def api_json(self, status, body):
        payload=json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type","application/json")
        self.send_header("Cache-Control","no-store")
        self.send_header("X-Content-Type-Options","nosniff")
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        if self.headers.get("Host") not in {f"localhost:{PORT}", f"127.0.0.1:{PORT}"}:
            return self.send_error(403)
        url=urllib.parse.urlsplit(self.path)
        if not url.path.startswith("/api/"):
            return super().do_GET()
        if self.headers.get("Sec-Fetch-Site")=="cross-site":
            return self.send_error(403)
        key=os.getenv("ANGEL_API_KEY")
        jwt=os.getenv("ANGEL_ACCESS_TOKEN")
        token=os.getenv("UPSTOX_ACCESS_TOKEN")
        try:
            if url.path=="/api/status":
                return self.api_json(200,{"angel":bool(key and jwt),"depth":bool(token)})
            if url.path=="/api/angel/test":
                if not (key and jwt):
                    return self.api_json(503,{"error":"Personal Angel One credentials pending."})
                from SmartApi import SmartConnect
                client=SmartConnect(api_key=key,timeout=10)
                client.setAccessToken(jwt)
                res=client.getMarketData("LTP",{"NSE":["2885"]})
                if not res.get("status") or not (res.get("data") or {}).get("fetched"):
                    return self.api_json(502,{"error":"Quote test failed. Check session expiry and market-data entitlement."})
                return self.api_json(200,{"checked":now()})
            if url.path in ("/api/search","/api/candles"):
                if not token:
                    return self.api_json(503,{"error":"Personal Upstox token required."})
                params=dict(urllib.parse.parse_qsl(url.query))
                if url.path=="/api/search":
                    q=params.get("q","").strip()
                    if not 2<=len(q)<=80:
                        return self.api_json(400,{"error":"Enter 2–80 characters."})
                    hits=up("instruments/search",{"query":q,"records":25},token)
                    return self.api_json(200,[{"symbol":i["trading_symbol"],"key":i["instrument_key"],"type":i.get("instrument_type",""),"kind":{"CE":"Option contract","PE":"Option contract","FUT":"Future","INDEX":"Index"}.get(i.get("instrument_type"),"Equity"),"expiry":i.get("expiry",""),"strike":i.get("strike_price",0)} for i in hits if i.get("trading_symbol")])
                start,end=map(date.fromisoformat,[params["from"],params["to"]])
                if not 0<=(end-start).days<=736:
                    return self.api_json(400,{"error":"Choose a period of up to two years."})
                data=fetch_candles(params["key"],"",start,end,False,token)
                result=[]
                for stamp in sorted(data):
                    _,d,t,o,h,l,c=data[stamp]
                    hour,minute=map(int,t.split(":"))
                    result.append(dict(d=d,m=hour*60+minute,o=o,h=h,l=l,c=c))
                return self.api_json(200,result)
            if url.path=="/api/depth":
                if not token:
                    return self.api_json(503,{"error":"Personal Upstox market-data access pending."})
                s=urllib.parse.parse_qs(url.query).get("symbol",[""])[0].upper()
                if not re.fullmatch(r"[A-Z0-9&.-]{1,40}",s):
                    return self.api_json(400,{"error":"Enter an NSE trading symbol."})
                hits=up("instruments/search",{"query":s,"exchanges":"NSE","segments":"EQ","records":30},token)
                match=next((h for h in hits if h["trading_symbol"].upper()==s and h["instrument_key"].startswith("NSE_EQ|")),None)
                if not match:
                    return self.api_json(404,{"error":"No exact NSE equity symbol found."})
                quotes=up("market-quote/quotes",{"instrument_key":match["instrument_key"]},token)
                q=next(iter(quotes.values()))
                result={k:q.get(k) for k in ("last_price","symbol","timestamp","last_trade_time","last_traded_quantity")}
                for side in ("buy","sell"):
                    result[side]=[x for x in (q.get("depth") or {}).get(side,[]) if x.get("price",0)>0][:30]
                return self.api_json(200,{**result,"fetched":now()})
            return self.api_json(404,{"error":"Unknown route."})
        except Exception:
            return self.api_json(502,{"error":"Provider request failed. Check SDK installation, personal token, network and data entitlement."})
if __name__=="__main__":
    root=Path(__file__).resolve().parent/"dist"
    print(f"Algo King: http://127.0.0.1:{PORT}",flush=True)
    ThreadingHTTPServer(("127.0.0.1",PORT),partial(Handler,directory=str(root))).serve_forever()

