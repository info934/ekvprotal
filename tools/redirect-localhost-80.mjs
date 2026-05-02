import http from 'node:http';

const target = 'http://127.0.0.1:3000';

http.createServer((req, res) => {
  const location = new URL(req.url || '/', target);
  res.writeHead(302, { Location: location.toString() });
  res.end();
}).listen(80, '127.0.0.1', () => {
  console.log(`Redirecting http://127.0.0.1/ to ${target}/`);
});
