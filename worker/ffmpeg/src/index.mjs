import { loadConfig } from "./config.mjs";
import { createServer, ffmpegVersion } from "./server.mjs";

const config = loadConfig();
const { server } = createServer(config);
server.listen(config.port, () => {
  ffmpegVersion().then((version) => console.log(`autobiz ffmpeg worker listening on :${config.port} (${version})`));
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => process.exit(0)));
