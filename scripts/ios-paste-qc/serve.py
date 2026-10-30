from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
import json

class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.split('?')[0] in ('/', '/index.html'):
            data=Path('index.html').read_text().replace('<head>', '<head><script src="/fixture.js"></script>')
            self.send_response(200); self.send_header('Content-Type','text/html'); self.end_headers(); self.wfile.write(data.encode()); return
        super().do_GET()
    def do_POST(self):
        if self.path != '/qc': self.send_error(405); return
        data=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        Path('qc-result.json').write_text(json.dumps(data,ensure_ascii=False))
        self.send_response(204); self.end_headers()

ThreadingHTTPServer(('127.0.0.1',8769),Handler).serve_forever()
