// Adds a fixed delay to every request to the local Supabase API, to reproduce a far-away database
// (production functions run in Vercel iad1 while Supabase is in Seoul: about 180 ms per round trip).
//   node scripts/perf/latency-proxy.mjs [listenPort=55421] [targetPort=55321] [delayMs=180]
import http from "node:http";

const [listen = "55421", target = "55321", delay = "180"] = process.argv.slice(2);
const delayMs = Number(delay);
http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    setTimeout(() => {
      const upstream = http.request({ host: "127.0.0.1", port: Number(target), method: req.method, path: req.url, headers: req.headers }, (response) => {
        res.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(res);
      });
      upstream.on("error", () => { res.statusCode = 502; res.end(); });
      upstream.end(Buffer.concat(chunks));
    }, delayMs);
  });
}).listen(Number(listen), () => console.log(`latency proxy :${listen} -> :${target} +${delayMs}ms`));
