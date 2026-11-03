#!/usr/bin/env python3
"""Opt-in read-only probe; private raw output, sanitized summaries only.
Uses only configured upstream, does not follow redirects or print credentials.
"""
import argparse, json, os, subprocess, time
from pathlib import Path
from urllib.parse import urlsplit

os.umask(0o077)
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'work/private/live-contract'

def config():
    d={}
    for line in (ROOT/'.dev.vars').read_text().splitlines():
        line=line.strip()
        if line and not line.startswith('#') and '=' in line:
            k,v=line.split('=',1);d[k.strip()]=v.strip().strip('\"\'')
    return d

def fetch(path, name):
    c=config();base=c['MMWX_BASE_URL'].rstrip('/')
    parsed=urlsplit(base)
    if parsed.scheme not in ('http','https') or parsed.username or parsed.password:raise ValueError('Invalid base URL')
    if not path.startswith('/') or path.startswith('//'):raise ValueError('Relative upstream path required')
    OUT.mkdir(parents=True,exist_ok=True,mode=0o700)
    dest=OUT/(name+'.raw'); err=OUT/(name+'.stderr')
    # Feed secret/header on stdin, keeping it out of command-line process listings.
    cfg='url = '+json.dumps(base+path)+'\nheader = '+json.dumps('X-MMwx-Probe-Token: '+c['MMWX_PROBE_TOKEN'])+'\n'
    start=time.monotonic()
    with err.open('w') as e:
        p=subprocess.run(['curl','--config','-','--http1.1','--silent','--show-error','--connect-timeout','15','--max-time',('180' if path.startswith('/assets/') else '45'),'--output',str(dest),'--write-out','%{http_code}'],input=cfg,text=True,stdout=subprocess.PIPE,stderr=e)
    summary={'case':name,'status':p.stdout,'curl_exit':p.returncode,'seconds':round(time.monotonic()-start,2)}
    if p.returncode==0:
      try:
        d=json.loads(dest.read_text());summary['keys']=list(d) if isinstance(d,dict) else []
        if isinstance(d,dict):
          for k in ('success','enabled','bucket_sec','history_days'): 
            if k in d:summary[k]=d[k]
          if isinstance(d.get('servers'),list):summary['servers']=len(d['servers'])
          if isinstance(d.get('series'),dict):
            summary['series_keys']=list(d['series'])
            summary['series_lengths']={k:len(v) for k,v in d['series'].items() if isinstance(v,list)}
            summary['series_sample_keys']={k:list(v[0]) for k,v in d['series'].items() if isinstance(v,list) and v and isinstance(v[0],dict)}
          if isinstance(d.get('all_series'),list):summary['all_series_count']=len(d['all_series'])
      except Exception:summary['json']=False
    (OUT/(name+'.summary.json')).write_text(json.dumps(summary,indent=2))
    print(json.dumps(summary),flush=True)
    return summary

def websocket_probe(name):
    import base64, hashlib, socket, ssl, struct
    c=config(); u=urlsplit(c['MMWX_BASE_URL']);OUT.mkdir(parents=True,exist_ok=True,mode=0o700)
    summary={'case':name,'frames':[]}
    conn=None
    try:
      summary['stage']='connect'
      conn=socket.create_connection((u.hostname,u.port or (443 if u.scheme=='https' else 80)),15)
      summary['stage']='tls'
      if u.scheme=='https':conn=ssl.create_default_context().wrap_socket(conn,server_hostname=u.hostname)
      summary['stage']='upgrade'
      conn.settimeout(25)
      key=base64.b64encode(os.urandom(16)).decode()
      headers=['GET /api/public/probe-ws HTTP/1.1','Host: '+u.netloc,'Upgrade: websocket','Connection: Upgrade','Sec-WebSocket-Key: '+key,'Sec-WebSocket-Version: 13','X-MMwx-Probe-Token: '+c['MMWX_PROBE_TOKEN']]
      conn.sendall(('\r\n'.join(headers)+'\r\n\r\n').encode())
      header=b''
      while not header.endswith(b'\r\n\r\n'):
        ch=conn.recv(1)
        if not ch:raise EOFError()
        header+=ch
        if len(header)>65536:raise ValueError('header too large')
      summary['status']=header.decode().split(' ',2)[1]
      if summary['status']!='101':return
      expected=base64.b64encode(hashlib.sha1((key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').encode()).digest()).decode()
      if expected not in header.decode():raise ValueError('bad accept')
      def exact(n):
        b=b''
        while len(b)<n:
          r=conn.recv(n-len(b))
          if not r:raise EOFError()
          b+=r
        return b
      summary['stage']='frames'
      for index in range(4):
        start=time.monotonic();a,b=exact(2);length=b&127
        if length==126:length=struct.unpack('!H',exact(2))[0]
        elif length==127:length=struct.unpack('!Q',exact(8))[0]
        if length>10000000:raise ValueError('oversized')
        mask=exact(4) if b&128 else None
        data=exact(length)
        if mask:data=bytes(v^mask[i%4] for i,v in enumerate(data))
        record={'opcode':a&15,'bytes':length,'wait_seconds':round(time.monotonic()-start,2)}
        (OUT/(name+'-frame-'+str(index)+'.raw')).write_bytes(data)
        try:
          d=json.loads(data);record['keys']=list(d) if isinstance(d,dict) else []
          if isinstance(d,dict) and isinstance(d.get('servers'),list):record['servers']=len(d['servers'])
        except Exception:pass
        summary['frames'].append(record)
      # Send a masked normal close frame and release resources.
      conn.sendall(bytes([0x88,0x82])+bytes(4)+struct.pack('!H',1000))
    except Exception as e:summary['error_type']=type(e).__name__
    finally:
      if conn:conn.close()
      (OUT/(name+'.summary.json')).write_text(json.dumps(summary,indent=2));print(json.dumps(summary),flush=True)

def websocket_curl(name):
    import base64, struct
    c=config();OUT.mkdir(parents=True,exist_ok=True,mode=0o700)
    key=base64.b64encode(os.urandom(16)).decode()
    cfg='url = '+json.dumps(c['MMWX_BASE_URL'].rstrip('/')+'/api/public/probe-ws')+'\n'
    for h in ('X-MMwx-Probe-Token: '+c['MMWX_PROBE_TOKEN'],'Upgrade: websocket','Connection: Upgrade','Sec-WebSocket-Key: '+key,'Sec-WebSocket-Version: 13'):
      cfg+='header = '+json.dumps(h)+'\n'
    raw=OUT/(name+'.raw');hdr=OUT/(name+'.headers');err=OUT/(name+'.stderr')
    with err.open('w') as e:
      p=subprocess.run(['curl','--config','-','--http1.1','--silent','--show-error','--no-buffer','--connect-timeout','15','--max-time','120','--output',str(raw),'--dump-header',str(hdr),'--write-out','%{http_code}'],input=cfg,text=True,stdout=subprocess.PIPE,stderr=e)
    summary={'case':name,'status':p.stdout,'curl_exit':p.returncode,'frames':[]}
    if p.stdout=='101' and raw.exists():
      data=raw.read_bytes();offset=0;summary['raw_bytes']=len(data);payload_digests=set()
      while offset+2<=len(data):
        frame_start=offset;a,b=data[offset:offset+2];offset+=2;length=b&127
        if length==126:
          if offset+2>len(data):break
          length=struct.unpack('!H',data[offset:offset+2])[0];offset+=2
        elif length==127:
          if offset+8>len(data):break
          length=struct.unpack('!Q',data[offset:offset+8])[0];offset+=8
        if b&128:break
        if offset+length>len(data):
          summary['incomplete_frame_bytes']=len(data)-frame_start
          summary['incomplete_frame_expected_payload']=length
          break
        payload=data[offset:offset+length];offset+=length
        record={'opcode':a&15,'bytes':length,'fin':bool(a&128)}
        import hashlib
        payload_digests.add(hashlib.sha256(payload).hexdigest())
        summary['distinct_complete_payloads']=len(payload_digests)
        try:
          d=json.loads(payload);record['keys']=list(d)
          if isinstance(d.get('servers'),list):record['servers']=len(d['servers'])
          (OUT/(name+'-frame-'+str(len(summary['frames']))+'.json')).write_text(json.dumps(d))
        except Exception:pass
        summary['frames'].append(record)
    (OUT/(name+'.summary.json')).write_text(json.dumps(summary,indent=2));print(json.dumps(summary),flush=True)

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('path');p.add_argument('name');a=p.parse_args();websocket_probe(a.name) if a.path=='ws' else websocket_curl(a.name) if a.path=='wscurl' else fetch(a.path,a.name)
