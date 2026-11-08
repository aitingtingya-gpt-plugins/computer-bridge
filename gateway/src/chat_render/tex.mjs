import {mathjax} from '@mathjax/src/js/mathjax.js';
import {TeX} from '@mathjax/src/js/input/tex.js';
import {liteAdaptor} from '@mathjax/src/js/adaptors/liteAdaptor.js';
import {RegisterHTMLHandler} from '@mathjax/src/js/handlers/html.js';
import '@mathjax/src/js/input/tex/base/BaseConfiguration.js';
import '@mathjax/src/js/input/tex/ams/AmsConfiguration.js';
import '@mathjax/src/js/input/tex/newcommand/NewcommandConfiguration.js';
import '@mathjax/src/js/input/tex/configmacros/ConfigMacrosConfiguration.js';
import '@mathjax/src/js/input/tex/physics/PhysicsConfiguration.js';
import '@mathjax/src/js/input/tex/boldsymbol/BoldsymbolConfiguration.js';
import '@mathjax/src/js/input/tex/cancel/CancelConfiguration.js';
import '@mathjax/src/js/input/tex/mathtools/MathtoolsConfiguration.js';
import '@mathjax/src/js/input/tex/color/ColorConfiguration.js';
import '@mathjax/src/js/input/tex/bbox/BboxConfiguration.js';
import '@mathjax/src/js/input/tex/tagformat/TagFormatConfiguration.js';

export const adaptor=liteAdaptor();RegisterHTMLHandler(adaptor);
const packages=['base','ams','newcommand','configmacros','physics','boldsymbol','cancel','mathtools','color','bbox','tagformat'];
/** A fresh TeX document makes macros, labels and equation numbers message-local. */
export function texInput(html,id,errors){
  return new TeX({packages,tags:'ams',macros:{bm:['\\boldsymbol{#1}',1]},maxBuffer:Math.max(5120,html.length*2),
    tagformat:{id:label=>'cb-'+String(id).replace(/[^a-zA-Z0-9_-]/g,'')+'-'+encodeURIComponent(label)},
    formatError(jax,error){errors.push(error.message);return jax.formatError(error);}});
}

/** Semantic compilation needs no SVG layout or font tables. */
export function semanticDocument(html,id,errors){
  return mathjax.document(html,{InputJax:texInput(html,id,errors)});
}
