const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.dirname(__dirname); // 服务插件根目录，preview 在 /screenshots/ 下
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };

http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0]).replace(/\/+$/, '') || '/preview.html');
  fs.readFile(p, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': mime[path.extname(p)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(8971, () => console.log('serving on http://127.0.0.1:8971/preview.html'));
