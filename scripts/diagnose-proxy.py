#!/usr/bin/env python3
"""Explicit read-only comparison using the user's authorized local proxy.
Never changes global proxy settings. Credentials are passed to curl on stdin.
Raw responses and error diagnostics stay in ignored work/private/proxy/.
"""
import argparse
import json
import os
import socket
import struct
import subprocess
import time
from pathlib import Path
from urllib.parse import urlsplit

os.umask(0o077)
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'work/private/proxy'
PROXY_HOST = '127.0.0.1'
PROXY_PORT = 7897
PATH = '/api/public/probe-series?server=0&metric=system&range=1h'


def config():
    values = {}
    for line in (ROOT / '.dev.vars').read_text().splitlines():
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            key, value = line.split('=', 1)
            values[key.strip()] = value.strip().strip('\"\'')
    url = urlsplit(values['MMWX_BASE_URL'])
    if url.scheme not in ('http', 'https') or not url.hostname or url.username or url.password:
        raise ValueError('Invalid configured upstream origin')
    return values, url


def save(name, value):
    OUT.mkdir(parents=True, exist_ok=True, mode=0o700)
    (OUT / (name + '.json')).write_text(json.dumps(value, indent=2))


def read_exact(conn, count):
    data = b''
    while len(data) < count:
        part = conn.recv(count - len(data))
        if not part:
            raise EOFError()
        data += part
    return data


def protocols():
    _, target = config()
    result = {'case': 'protocols', 'proxy_port': PROXY_PORT, 'listening': False,
              'http_connect': False, 'socks5_noauth': False, 'socks5_connect': False}
    target_port = target.port or (443 if target.scheme == 'https' else 80)
    try:
        with socket.create_connection((PROXY_HOST, PROXY_PORT), 3):
            result['listening'] = True
    except Exception as error:
        result['listen_error_type'] = type(error).__name__
        save('protocols', result)
        print(json.dumps(result), flush=True)
        return result
    try:
        with socket.create_connection((PROXY_HOST, PROXY_PORT), 3) as conn:
            conn.settimeout(15)
            authority = target.hostname + ':' + str(target_port)
            conn.sendall(('CONNECT ' + authority + ' HTTP/1.1\r\nHost: ' + authority + '\r\n\r\n').encode())
            response = b''
            while not response.endswith(b'\r\n\r\n') and len(response) < 16384:
                response += read_exact(conn, 1)
            parts = response.split(b'\r\n', 1)[0].split()
            result['http_connect_status'] = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else None
            result['http_connect'] = parts[0].startswith(b'HTTP/') and result['http_connect_status'] == 200
    except Exception as error:
        result['http_error_type'] = type(error).__name__
    try:
        with socket.create_connection((PROXY_HOST, PROXY_PORT), 3) as conn:
            conn.settimeout(15)
            conn.sendall(bytes([5, 1, 0]))
            greeting = read_exact(conn, 2)
            result['socks5_noauth'] = greeting == bytes([5, 0])
            if result['socks5_noauth']:
                hostname = target.hostname.encode('idna')
                conn.sendall(bytes([5, 1, 0, 3, len(hostname)]) + hostname + struct.pack('!H', target_port))
                reply = read_exact(conn, 4)
                result['socks5_reply_code'] = reply[1]
                result['socks5_connect'] = reply[0] == 5 and reply[1] == 0
                if reply[3] == 1:
                    read_exact(conn, 6)
                elif reply[3] == 4:
                    read_exact(conn, 18)
                elif reply[3] == 3:
                    read_exact(conn, read_exact(conn, 1)[0] + 2)
    except Exception as error:
        result['socks_error_type'] = type(error).__name__
    save('protocols', result)
    print(json.dumps(result), flush=True)
    return result


def curl_case(case, proxy=None, websocket=False):
    values, _ = config()
    OUT.mkdir(parents=True, exist_ok=True, mode=0o700)
    path = '/api/public/probe-ws' if websocket else PATH
    cfg = 'url = ' + json.dumps(values['MMWX_BASE_URL'].rstrip('/') + path) + '\n'
    cfg += 'header = ' + json.dumps('X-MMwx-Probe-Token: ' + values['MMWX_PROBE_TOKEN']) + '\n'
    if proxy:
        cfg += 'proxy = ' + json.dumps(proxy) + '\n'
    if websocket:
        import base64
        key = base64.b64encode(os.urandom(16)).decode()
        for header in ('Upgrade: websocket', 'Connection: Upgrade', 'Sec-WebSocket-Key: ' + key, 'Sec-WebSocket-Version: 13'):
            cfg += 'header = ' + json.dumps(header) + '\n'
    fmt = '%{http_code} %{http_connect} %{time_connect} %{time_appconnect} %{time_starttransfer} %{time_total} %{size_download}'
    command = ['curl', '--disable', '--config', '-', '--http1.1', '--silent', '--show-error', '--noproxy', '' if proxy else '*',
               '--connect-timeout', '15', '--max-time', '45', '--output', str(OUT / (case + '.raw')),
               '--dump-header', str(OUT / (case + '.headers')), '--write-out', fmt]
    start = time.monotonic()
    with (OUT / (case + '.stderr')).open('w') as error_log:
        process = subprocess.run(command, input=cfg, text=True, stdout=subprocess.PIPE, stderr=error_log)
    fields = process.stdout.split()
    result = {'case': case, 'curl_exit': process.returncode, 'wall_seconds': round(time.monotonic() - start, 3)}
    if len(fields) == 7:
        result.update(dict(zip(('status', 'proxy_connect_status', 'tcp_connect_seconds', 'tls_appconnect_seconds', 'starttransfer_seconds', 'total_seconds', 'download_bytes'), fields)))
    if process.returncode == 0 and not websocket:
        try:
            body = json.loads((OUT / (case + '.raw')).read_text())
            result['success'] = body.get('success') is True
            result['bucket_sec'] = body.get('bucket_sec')
            result['series_point_counts'] = {key: len(value) for key, value in body.get('series', {}).items() if isinstance(value, list)}
        except Exception:
            result['json_valid'] = False
    if websocket and result.get('status') == '101':
        data = (OUT / (case + '.raw')).read_bytes()
        offset = 0
        frames = 0
        digests = set()
        import hashlib
        while offset + 2 <= len(data):
            a, b = data[offset:offset + 2]
            offset += 2
            length = b & 127
            if length == 126:
                if offset + 2 > len(data): break
                length = struct.unpack('!H', data[offset:offset + 2])[0]
                offset += 2
            elif length == 127:
                if offset + 8 > len(data): break
                length = struct.unpack('!Q', data[offset:offset + 8])[0]
                offset += 8
            if b & 128 or offset + length > len(data): break
            payload = data[offset:offset + length]
            offset += length
            if a & 15 == 1 and a & 128:
                try:
                    body = json.loads(payload)
                    if isinstance(body.get('servers'), list):
                        frames += 1
                        digests.add(hashlib.sha256(payload).digest())
                except Exception: pass
        result['complete_snapshot_frames'] = frames
        result['distinct_complete_payloads'] = len(digests)
    save(case, result)
    print(json.dumps(result), flush=True)
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=('protocols', 'direct', 'http', 'socks5', 'ws-http'))
    args = parser.parse_args()
    if args.action == 'protocols':
        protocols()
    elif args.action == 'direct':
        curl_case('system-1h-direct')
    else:
        evidence = json.loads((OUT / 'protocols.json').read_text())
        if evidence.get('proxy_port') != PROXY_PORT:
            raise ValueError('Protocol evidence is for another port')
        if args.action in ('http', 'ws-http'):
            if evidence.get('http_connect') is not True:
                raise ValueError('HTTP CONNECT has not been verified')
            curl_case('websocket-http-proxy' if args.action == 'ws-http' else 'system-1h-http-proxy',
                      'http://127.0.0.1:' + str(PROXY_PORT), args.action == 'ws-http')
        else:
            if evidence.get('socks5_connect') is not True:
                raise ValueError('SOCKS5 CONNECT has not been verified')
            curl_case('system-1h-socks5-proxy', 'socks5h://127.0.0.1:' + str(PROXY_PORT))
