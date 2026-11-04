import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const path = value => fileURLToPath(new URL(value, import.meta.url));
const options={bundle:true,
  platform:'node', format:'esm', target:'node24', external:['koffi'],
  alias:{
    'bridge-seatbelt':path('third_party/dsh/packages/sandbox/sandbox-local/src/profiles.ts'),
    'bridge-windows':path('third_party/dsh/packages/sandbox/sandbox-windows-acl/src/index.ts'),
    'bridge-roots':path('third_party/dsh/packages/sandbox/sandbox/src/roots.ts'),
    '@deepseek-ai/dsh-win32-process':path('third_party/dsh/packages/subprocess/win32-process/src/index.ts'),
    '@deepseek-ai/dsh-lazy-require':path('third_party/dsh/packages/util/lazy-require/src/index.ts'),
    '@deepseek-ai/dsh-sandbox':path('policy.ts'),
    '@deepseek-ai/node-addon-system/landlock-run':path('unsupported-linux.ts'),
  }, plugins:[{name:'omit-harness-only-registration',setup(b) {
    b.onResolve({filter:/^bridge-html-runtime$/},()=>({path:'./html.mjs',external:true}));
    b.onResolve({filter:/^bridge-html$/},() => ({path:'html',namespace:'bridge'}));
    b.onLoad({filter:/.*/,namespace:'bridge'},async () => {
      const original=await readFile(path('third_party/dsh/packages/web/tool-web/src/fetch.ts'),'utf8');
      const start=original.indexOf('const turndown =');
      const end=original.indexOf('/**\n * Validate value constraints');
      return {loader:'ts',resolveDir:path('.'),contents:
        "import TurndownService from 'turndown'; import {gfm} from '@joplin/turndown-plugin-gfm';\n"
        +original.slice(start,end)+"\nexport const convertHtml = (html) => turndown.turndown(html);"};
    });
    b.onLoad({filter:/sandbox-windows-acl[\\/]src[\\/]index\.ts$/},async args => ({loader:'ts',
      contents:(await readFile(args.path,'utf8')).replace(/^export \{ ACL_DIAGNOSIS_SKILL, registerAclDiagnosisSkill \} from '\.\/acl-skill\.ts'\n/m,'')}));
  }}]};
await build({...options,entryPoints:[path('runner.ts')],outfile:path('runner.mjs')});
await build({...options,entryPoints:[path('html.ts')],outfile:path('html.mjs')});
