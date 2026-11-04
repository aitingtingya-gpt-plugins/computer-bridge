import {build} from "esbuild";
import {fileURLToPath} from "node:url";
import {appendLicenses} from './licenses.mjs';

const server=await build({entryPoints:["src/node/server.ts"],outfile:"build/server.mjs",bundle:true,platform:"node",metafile:true,
  target:"node24",format:"esm",external:["ws"],
  alias:{"cloudflare:workers":fileURLToPath(new URL("src/node/entrypoint.ts",import.meta.url))},
  banner:{js:'import {createRequire} from "node:module"; const require=createRequire(import.meta.url);'}});
await appendLicenses('build/server.mjs',server.metafile);
const launcher=await build({entryPoints:["src/node/launcher.ts"],outfile:"build/launcher.mjs",bundle:true,platform:"node",metafile:true,
  target:"node24",format:"esm"});
await appendLicenses('build/launcher.mjs',launcher.metafile);
