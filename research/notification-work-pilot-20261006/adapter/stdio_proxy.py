#!/usr/bin/env python3
"""MCP stdio transport to the isolated, shared real Coordinator adaptation."""
import argparse
import json
import sys
from urllib.request import Request, urlopen

parser=argparse.ArgumentParser(); parser.add_argument('--endpoint',required=True); args=parser.parse_args()
for line in sys.stdin:
    if not line.strip(): continue
    message=json.loads(line)
    request=Request(args.endpoint.rstrip('/')+'/rpc',data=json.dumps(message).encode(),headers={'Content-Type':'application/json'})
    try:
        with urlopen(request,timeout=70) as response: result=json.load(response)
    except Exception as error:
        result={'jsonrpc':'2.0','id':message.get('id'),'error':{'code':-32603,'message':str(error)}}
    if result is not None:
        sys.stdout.write(json.dumps(result)+'\n'); sys.stdout.flush()
