#!/usr/bin/env python3
"""Isolated extension of the REAL Agent Coordination server (84fa1a0e).

The unchanged upstream store and MCP contract live in upstream_server.py.
One loopback daemon owns the board; stdio clients proxy JSON-RPC to it.
No production board, default database or global MCP configuration is used.
"""
from __future__ import annotations
import argparse
import hmac
import json
import signal
import sqlite3
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import Request, urlopen
import upstream_server as upstream

MUTATIONS = {'upsert_activity', 'start_activity', 'update_activity', 'finish_activity', 'post_message', 'publish_update'}


def schema(description, properties, required):
    return {'description': description, 'inputSchema': {'type': 'object', 'properties': properties, 'required': required}}


TEXT = {'type': 'string'}
NUMBER = {'type': 'integer', 'minimum': 0}
SCOPE = {'project': TEXT, 'actor': TEXT, 'cursor': NUMBER,
         'areas': {'type': 'array', 'items': TEXT}, 'files': {'type': 'array', 'items': TEXT}}
EXTRA_TOOLS = {
    'start_activity': upstream.TOOL_SCHEMAS['upsert_activity'],
    'update_activity': upstream.TOOL_SCHEMAS['upsert_activity'],
    'subscribe_notifications': schema('Subscribe explicit actor/project/Pi UUID/loopback destination. No inference is started.',
        {**SCOPE, 'sessionId': TEXT, 'url': TEXT, 'ttl_seconds': {'type': 'integer', 'minimum': 1, 'maximum': 7200}},
        ['project', 'actor', 'sessionId', 'url']),
    'unsubscribe_notifications': schema('End this subscription and cancel queued deliveries.',
        {'subscriptionId': TEXT}, ['subscriptionId']),
    'get_updates': schema('Read the same durable actor-relevant facts used by notifications, after cursor.',
        {**SCOPE, 'limit': {'type': 'integer', 'minimum': 1, 'maximum': 200}}, ['project', 'actor']),
    'await_next': schema('Return queued updates immediately, otherwise await one relevant update. Bounded and cancellable.',
        {**SCOPE, 'timeout_seconds': {'type': 'number', 'minimum': 0, 'maximum': 60}, 'waitId': TEXT}, ['project', 'actor']),
    'cancel_wait': schema('Cancel a pending await_next by its caller-provided wait ID.', {'waitId': TEXT}, ['waitId']),
    'publish_update': schema('Publish an actual external diagnostic/fact, without fabricating board activity. Revision is idempotent.',
        {'project':TEXT,'targets':{'type':'array','items':TEXT},'kind':TEXT,'payload':{'type':'object'},
         'producerId':TEXT,'revision':{'type':'integer','minimum':1}},
        ['project','targets','kind','payload','producerId','revision']),
}
EXTRA_TOOLS['update_activity'] = schema('Update an existing activity; start_activity creates an activity.',
    upstream.TOOL_SCHEMAS['upsert_activity']['inputSchema']['properties'], ['activity_id'])


class Board(upstream.CoordinationStore):
    def __init__(self, path):
        # Upstream sqlite connection is retained; central daemon serializes all access.
        super().__init__(path)
        self.conn.close()
        self.conn = sqlite3.connect(str(path), check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute('PRAGMA busy_timeout=5000')
        self.conn.execute('PRAGMA foreign_keys=ON')
        self.conn.executescript('''
          CREATE TABLE IF NOT EXISTS notification_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS events(sequence INTEGER PRIMARY KEY AUTOINCREMENT,
            project TEXT NOT NULL,actor TEXT NOT NULL,kind TEXT NOT NULL,entity_id TEXT NOT NULL,
            revision INTEGER NOT NULL,target_actor TEXT,payload TEXT NOT NULL,created_at TEXT NOT NULL,
            UNIQUE(kind,entity_id,revision));
          CREATE TABLE IF NOT EXISTS subscriptions(id TEXT PRIMARY KEY,project TEXT NOT NULL,actor TEXT NOT NULL,
            session_id TEXT NOT NULL,url TEXT NOT NULL,areas TEXT NOT NULL,files TEXT NOT NULL,
            expires REAL NOT NULL,active INTEGER NOT NULL DEFAULT 1);
          CREATE TABLE IF NOT EXISTS deliveries(subscription_id TEXT NOT NULL,event_sequence INTEGER NOT NULL,
            state TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,next_attempt REAL NOT NULL DEFAULT 0,
            notification_id TEXT,error TEXT,PRIMARY KEY(subscription_id,event_sequence));
          CREATE TRIGGER IF NOT EXISTS activity_insert_event AFTER INSERT ON activities BEGIN
            INSERT INTO events(project,actor,kind,entity_id,revision,payload,created_at)
            VALUES(NEW.project,NEW.agent,'activity',NEW.id,1,
              json_object('id',NEW.id,'project',NEW.project,'agent',NEW.agent,'status',NEW.status,
                'description',NEW.description,'areas',json(NEW.areas_json),'files',json(NEW.files_json)),NEW.updated_at);
          END;
          CREATE TRIGGER IF NOT EXISTS activity_update_event AFTER UPDATE ON activities BEGIN
            INSERT INTO events(project,actor,kind,entity_id,revision,payload,created_at)
            VALUES(NEW.project,NEW.agent,'activity',NEW.id,
              (SELECT COALESCE(MAX(revision),0)+1 FROM events WHERE kind='activity' AND entity_id=NEW.id),
              json_object('id',NEW.id,'project',NEW.project,'agent',NEW.agent,'status',NEW.status,
                'description',NEW.description,'areas',json(NEW.areas_json),'files',json(NEW.files_json)),NEW.updated_at);
          END;
          CREATE TRIGGER IF NOT EXISTS message_insert_event AFTER INSERT ON messages BEGIN
            INSERT INTO events(project,actor,kind,entity_id,revision,target_actor,payload,created_at)
            VALUES(NEW.project,NEW.from_agent,'message',NEW.id,1,
              COALESCE(NEW.to_agent,(SELECT agent FROM activities WHERE id=NEW.to_activity_id AND project=NEW.project)),
              json_object('id',NEW.id,'project',NEW.project,'from_agent',NEW.from_agent,'to_agent',NEW.to_agent,
                'to_activity_id',NEW.to_activity_id,'message',NEW.message),NEW.created_at);
          END;
          CREATE TRIGGER IF NOT EXISTS event_delivery AFTER INSERT ON events BEGIN
            INSERT OR IGNORE INTO deliveries(subscription_id,event_sequence)
              SELECT id,NEW.sequence FROM subscriptions WHERE active=1 AND project=NEW.project;
          END;
        ''')
        self.conn.execute('INSERT OR IGNORE INTO notification_meta VALUES(?,?)', ('board_id', str(uuid.uuid4())))
        self.conn.commit()
        self.board_id = self.conn.execute("SELECT value FROM notification_meta WHERE key='board_id'").fetchone()[0]

    def event(self, row):
        return {'eventId': f'coord:{self.board_id}:{row["sequence"]}', 'cursor': row['sequence'],
                'project': row['project'], 'actor': row['actor'], 'kind': row['kind'],
                'entityId': row['entity_id'], 'revision': row['revision'], 'targetActor': row['target_actor'],
                'createdAt': row['created_at'], 'fact': json.loads(row['payload'])}

    def relevant(self, row, args):
        if row['project'] != args['project'] or row['actor'] == args['actor']:
            return False
        if row['kind'] == 'message':
            return row['target_actor'] is None or row['target_actor'] == args['actor']
        fact = json.loads(row['payload'])
        if row['kind'] != 'activity':
            return not fact['targets'] or args['actor'] in fact['targets']
        areas, files = set(args.get('areas') or []), set(args.get('files') or [])
        return not (areas or files) or bool(areas & set(fact['areas']) or files & set(fact['files']))

    def get_updates(self, args):
        upstream.required_text(args, 'project'); upstream.required_text(args, 'actor')
        cursor = int(args.get('cursor', 0)); limit = int(args.get('limit', 100))
        if cursor < 0 or not 1 <= limit <= 200:
            raise ValueError('cursor >= 0 and limit 1..200 required')
        result = []
        for row in self.conn.execute('SELECT * FROM events WHERE sequence>? ORDER BY sequence', (cursor,)):
            cursor = row['sequence']
            if self.relevant(row, args):
                result.append(self.event(row))
                if len(result) >= limit:
                    break
        return {'updates': result, 'cursor': cursor, 'count': len(result)}

    def subscribe(self, args):
        project = upstream.required_text(args, 'project'); actor = upstream.required_text(args, 'actor')
        session = str(uuid.UUID(upstream.required_text(args, 'sessionId')))
        url = upstream.required_text(args, 'url').rstrip('/')
        parsed = urlparse(url)
        if parsed.scheme != 'http' or parsed.hostname not in {'127.0.0.1', 'localhost', '::1'} or not parsed.port:
            raise ValueError('Explicit HTTP loopback destination with port required')
        if parsed.path not in {'', '/notify'} or parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError('Destination must be base URL or /notify with no credentials/query')
        if not parsed.path:
            url += '/notify'
        ttl = int(args.get('ttl_seconds', 3600))
        if not 1 <= ttl <= 7200:
            raise ValueError('ttl_seconds must be 1..7200')
        cursor = int(args.get('cursor', self.conn.execute('SELECT COALESCE(MAX(sequence),0) FROM events').fetchone()[0]))
        if cursor < 0:
            raise ValueError('cursor must be >=0')
        subscription_id = 'sub_' + uuid.uuid4().hex
        self.conn.execute('INSERT INTO subscriptions VALUES(?,?,?,?,?,?,?,?,1)',
            (subscription_id,project,actor,session,url,json.dumps(args.get('areas', [])),json.dumps(args.get('files', [])),time.time()+ttl))
        self.conn.execute('INSERT OR IGNORE INTO deliveries(subscription_id,event_sequence) SELECT ?,sequence FROM events WHERE project=? AND sequence>?',
                          (subscription_id,project,cursor))
        self.conn.commit()
        return {'subscriptionId':subscription_id,'sessionId':session,'url':url,'cursor':cursor,'ttl_seconds':ttl}

    def unsubscribe(self, args):
        sid = upstream.required_text(args, 'subscriptionId')
        found = self.conn.execute('UPDATE subscriptions SET active=0 WHERE id=?', (sid,)).rowcount
        self.conn.execute("UPDATE deliveries SET state='cancelled' WHERE subscription_id=? AND state IN ('pending','retry')", (sid,))
        self.conn.commit()
        return {'subscriptionId':sid,'found':bool(found)}

    def post_message(self,args):
        if args.get('to_activity_id'):
            target=self.fetch_activity_row(args['to_activity_id'])
            if target['project'] != args['project']:
                raise ValueError('Directed activity belongs to another project')
        return super().post_message(args)

    def publish_update(self,args):
        project=upstream.required_text(args,'project'); producer=upstream.required_text(args,'producerId')
        kind=upstream.required_text(args,'kind'); revision=int(args.get('revision',0))
        if kind in {'activity','message'} or not 1<=revision:
            raise ValueError('External kind must not be activity/message; revision >=1 required')
        if not isinstance(args.get('payload'),dict) or not isinstance(args.get('targets'),list):
            raise ValueError('payload object and targets array required')
        fact={'targets':args['targets'],'payload':args['payload'],'producerId':producer}
        serialized=upstream.dump_json(fact)
        if len(serialized)>6000:
            raise ValueError('External fact must fit 6000 chars; use artifact references for larger diagnostics')
        entity=project+':'+producer+':'+kind
        previous=self.conn.execute('SELECT * FROM events WHERE kind=? AND entity_id=? AND revision=?',
                                   (kind,entity,revision)).fetchone()
        if previous:
            if previous['payload'] != serialized: raise ValueError('Producer revision payload conflict')
            return {'event':self.event(previous),'duplicate':True}
        self.conn.execute('INSERT INTO events(project,actor,kind,entity_id,revision,payload,created_at) VALUES(?,?,?,?,?,?,?)',
                          (project,producer,kind,entity,revision,serialized,upstream.iso(upstream.now_utc())))
        self.conn.commit()
        row=self.conn.execute('SELECT * FROM events WHERE kind=? AND entity_id=? AND revision=?',(kind,entity,revision)).fetchone()
        return {'event':self.event(row),'duplicate':False}


class Runtime:
    def __init__(self, path, trace):
        self.board = Board(path)
        self.trace_path = trace
        self.condition = threading.Condition(threading.RLock())
        self.closed = False
        self.cancelled = set()
        self.worker = threading.Thread(target=self.deliver, daemon=True)
        self.worker.start()

    def trace(self, kind, **data):
        if self.trace_path:
            with open(self.trace_path, 'a') as f:
                f.write(json.dumps({'time':time.time(),'mono':time.monotonic(),'type':kind,**data})+'\n')

    def call(self, name, args):
        with self.condition:
            self.trace('tool_call', name=name, arguments=args)
            if name == 'await_next':
                timeout = float(args.get('timeout_seconds', 30))
                if not 0 <= timeout <= 60:
                    raise ValueError('timeout_seconds must be 0..60')
                wait_id = args.get('waitId') or str(uuid.uuid4())
                deadline = time.monotonic()+timeout
                while True:
                    result = self.board.get_updates(args)
                    if result['updates'] or wait_id in self.cancelled or self.closed or time.monotonic() >= deadline:
                        result.update({'waitId':wait_id,'cancelled':wait_id in self.cancelled,
                                       'timedOut':not result['updates'] and time.monotonic()>=deadline})
                        self.cancelled.discard(wait_id)
                        return result
                    self.condition.wait(deadline-time.monotonic())
            if name == 'cancel_wait':
                self.cancelled.add(upstream.required_text(args,'waitId')); self.condition.notify_all()
                return {'waitId':args['waitId'],'cancelRequested':True}
            if name == 'get_updates': result = self.board.get_updates(args)
            elif name == 'subscribe_notifications': result = self.board.subscribe(args)
            elif name == 'unsubscribe_notifications': result = self.board.unsubscribe(args)
            elif name in {'start_activity','update_activity'}:
                if name=='update_activity': upstream.required_text(args,'activity_id')
                result = self.board.upsert_activity(args)
            elif name=='publish_update': result = self.board.publish_update(args)
            elif name in upstream.TOOL_SCHEMAS: result = getattr(self.board,name)(args)
            else: raise ValueError('Unknown tool: '+str(name))
            if name in MUTATIONS or name in {'subscribe_notifications','unsubscribe_notifications'}:
                self.condition.notify_all()
            return result

    def rpc(self, message):
        method = message.get('method'); rid = message.get('id')
        if method == 'notifications/initialized': return None
        if method == 'initialize':
            return {'jsonrpc':'2.0','id':rid,'result':{'protocolVersion':upstream.PROTOCOL_VERSION,
                'capabilities':{'tools':{}},'serverInfo':{'name':'agent-coordination-notification-pilot','version':'0.1.0'}}}
        if method == 'ping': return {'jsonrpc':'2.0','id':rid,'result':{}}
        if method == 'tools/list':
            return {'jsonrpc':'2.0','id':rid,'result':{'tools':[{'name':k,**v} for k,v in {**upstream.TOOL_SCHEMAS,**EXTRA_TOOLS}.items()]}}
        if method == 'tools/call':
            try:
                params = message.get('params') or {}
                return upstream.tool_response(rid,self.call(params.get('name'),params.get('arguments') or {}))
            except Exception as e:
                self.trace('tool_error',error=str(e)); return upstream.tool_response(rid,{'error':str(e)},True)
        if method in {'resources/list','prompts/list'}:
            return {'jsonrpc':'2.0','id':rid,'result':{'resources' if method=='resources/list' else 'prompts':[]}}
        return upstream.error_response(rid,-32601,'Method not found: '+str(method))

    def deliver(self):
        while True:
            with self.condition:
                if self.closed: return
                self.board.conn.execute("UPDATE deliveries SET state='expired' WHERE state IN ('pending','retry') AND subscription_id IN (SELECT id FROM subscriptions WHERE expires<?)", (time.time(),))
                row = self.board.conn.execute("SELECT d.*,s.project,s.actor,s.session_id,s.url,s.areas,s.files,s.expires,s.active FROM deliveries d JOIN subscriptions s ON s.id=d.subscription_id WHERE d.state IN ('pending','retry') AND d.next_attempt<=? AND s.active=1 AND s.expires>? ORDER BY d.event_sequence LIMIT 1", (time.time(),time.time())).fetchone()
                self.board.conn.commit()
                if row is None:
                    self.condition.wait(0.2); continue
                event_row = self.board.conn.execute('SELECT * FROM events WHERE sequence=?',(row['event_sequence'],)).fetchone()
                scope = {'project':row['project'],'actor':row['actor'],'areas':json.loads(row['areas']),'files':json.loads(row['files'])}
                if not self.board.relevant(event_row,scope):
                    self.board.conn.execute("UPDATE deliveries SET state='irrelevant' WHERE subscription_id=? AND event_sequence=?",(row['subscription_id'],row['event_sequence']))
                    self.board.conn.commit(); continue
                event = self.board.event(event_row)
                payload = {'sessionId':row['session_id'],'source':'agent-coordination','eventId':event['eventId'],
                           'message':json.dumps(event,ensure_ascii=True,separators=(',',':'))}
            # No DB lock while contacting the explicit loopback destination.
            error = None; notification_id = None
            try:
                req = Request(row['url'],data=json.dumps(payload).encode(),headers={'Content-Type':'application/json'})
                with urlopen(req,timeout=3) as res:
                    if res.status != 201: raise RuntimeError('Unexpected notify status '+str(res.status))
                    notification_id = json.load(res)['id']
            except Exception as e: error = str(e)
            with self.condition:
                attempts = row['attempts']+1
                state = 'delivered' if error is None else 'failed' if attempts >= 8 else 'retry'
                # Unsubscribe wins for subsequent deliveries; in-flight POST may already have arrived.
                active = self.board.conn.execute('SELECT active FROM subscriptions WHERE id=?',(row['subscription_id'],)).fetchone()[0]
                if not active and error is not None: state = 'cancelled'
                self.board.conn.execute('UPDATE deliveries SET state=?,attempts=?,next_attempt=?,notification_id=?,error=? WHERE subscription_id=? AND event_sequence=?',
                    (state,attempts,time.time()+min(5,0.2*2**attempts),notification_id,error,row['subscription_id'],row['event_sequence']))
                self.board.conn.commit()
                self.trace('delivery',state=state,eventId=event['eventId'],revision=event['revision'],
                           subscriptionId=row['subscription_id'],sessionId=row['session_id'],notificationId=notification_id,error=error)
                self.condition.notify_all()

    def close(self):
        with self.condition: self.closed=True; self.condition.notify_all()
        self.worker.join(4)
        self.board.conn.close()


def serve(args):
    Path(args.database).parent.mkdir(parents=True,exist_ok=True)
    runtime = Runtime(Path(args.database),args.trace)
    producer_key_path=Path(args.producer_key_file or args.ready+'.producer.key')
    if producer_key_path.exists(): producer_key=producer_key_path.read_text().strip()
    else:
        producer_key=uuid.uuid4().hex+uuid.uuid4().hex
        producer_key_path.write_text(producer_key); producer_key_path.chmod(0o600)
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*_): pass
        def do_GET(self):
            if self.path != '/health': self.send_error(404); return
            data=json.dumps({'ready':True,'boardId':runtime.board.board_id,'database':str(args.database)}).encode()
            self.send_response(200); self.send_header('Content-Type','application/json'); self.end_headers(); self.wfile.write(data)
        def do_POST(self):
            if self.path != '/rpc': self.send_error(404); return
            size=int(self.headers.get('Content-Length','0'))
            if size>65536: self.send_error(413); return
            try:
                message=json.loads(self.rfile.read(size))
                producer_call=message.get('method')=='tools/call' and (message.get('params') or {}).get('name')=='publish_update'
                if producer_call and not hmac.compare_digest(self.headers.get('X-Coordinator-Producer-Token',''),producer_key):
                    self.send_response(403); self.send_header('Content-Type','application/json'); self.end_headers()
                    self.wfile.write(json.dumps({'error':'External producer authorization required'}).encode()); return
                result=runtime.rpc(message)
                data=json.dumps(result).encode(); self.send_response(200); self.send_header('Content-Type','application/json'); self.end_headers(); self.wfile.write(data)
            except Exception as e: self.send_error(400,str(e))
    http=ThreadingHTTPServer(('127.0.0.1',args.port),Handler)
    endpoint='http://127.0.0.1:'+str(http.server_port)
    Path(args.ready).write_text(json.dumps({'url':endpoint,'boardId':runtime.board.board_id,'database':str(args.database),
                                          'producerKeyFile':str(producer_key_path)}))
    # SIGTERM triggers bounded cleanup, never touches another process.
    signal.signal(signal.SIGTERM,lambda *_: threading.Thread(target=http.shutdown,daemon=True).start())
    try: http.serve_forever(poll_interval=0.2)
    finally: http.server_close(); runtime.close()


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--database',required=True); parser.add_argument('--ready',required=True)
    parser.add_argument('--trace'); parser.add_argument('--port',type=int,default=0)
    parser.add_argument('--producer-key-file')
    serve(parser.parse_args())
