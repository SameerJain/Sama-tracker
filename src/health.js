import http from 'node:http';

// railway hits this before switching traffic to a new deploy, so it only answers
// 200 once the bot is logged in and tracking. anything else is still starting or stopping
let ready = false;
let server = null;

export const isHealthReady = () => ready;

export function setHealthReady(value = true) {
  ready = value;
}

// railway injects PORT, which doubles as the healthcheck port. anywhere else it listens on 3000
export function healthPort(env = process.env) {
  const port = Number(env.PORT);
  return Number.isInteger(port) && port > 0 ? port : 3000;
}

export function startHealth(port = healthPort()) {
  if (server) return server;
  const created = http.createServer((req, res) => {
    // not new URL(): a path like //[ makes it throw, and a throw in here takes the whole bot down. this port is
    // public on railway, so anyone could send one
    const path = (req.url ?? '').split('?')[0];
    if (req.method === 'GET' && path === '/health') {
      const code = ready ? 200 : 503;
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: ready ? 'ok' : 'starting' }));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'not found' }));
  });
  // with no listener a taken port throws and takes the bot down with it. a failed healthcheck is the
  // right signal for railway, and a local run doesn't need one
  created.on('error', (err) => {
    console.error(`the health check couldn't listen on port ${port} (${err.message}), the bot keeps running without it`);
    if (server === created) server = null;
  });
  server = created;
  server.listen(port);
  return server;
}

export function stopHealth() {
  return new Promise((resolve) => {
    if (!server) return resolve();
    const closing = server;
    server = null;
    closing.close(() => resolve());
  });
}
