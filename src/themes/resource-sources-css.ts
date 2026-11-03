import type { PublicResourceSource } from './default-resources.ts';

/** Public CSS dependency identity, independent of theme name or ecosystem.
 * These stylesheets use identical Semantic UI icon glyphs/font faces/flag rules.
 * Only the complete audited library rule fingerprint activates fallback. */
export const SEMANTIC_UI_REVISION = 'fc9f8bd7e4f5934756ec60c0423f77d1c7be7c6f';
const SEMANTIC_UI_ASSET_HASHES:Readonly<Record<string,string>>={
  "fonts/brand-icons.eot": "d023c55fde220495f13a87b72995e0df98c8d2893577299d199da5bbf5b4fe02",
  "fonts/brand-icons.svg": "6519a15b08294be395ed914c40236ba604214cb1163b5311a9875f1df5eed86d",
  "fonts/brand-icons.ttf": "42e369dc8c372973ba77a826b62d2c7a2070532313df832a23288ddb76974158",
  "fonts/brand-icons.woff": "9fafd6c3e7bfc145db42a906e5fa68fe6a6f97221f013d3e833fc3231b992c44",
  "fonts/brand-icons.woff2": "e7d4d5340bbe57a01d8f7992142e2763d438d5783890c76748306eebfa056a69",
  "fonts/icons.eot": "8b4e1b847e22233d4f467d34faefe7bcbfebce6fa9bbbee560c45cd894868751",
  "fonts/icons.otf": "bdc5d0b9f397be83e886c74b0141d1954aa4384b359dce49829994c4a2e1f7bf",
  "fonts/icons.svg": "282a64fb600cdac6ff790bd01f92dd671d10a98278cccf52fb22479a18ab6934",
  "fonts/icons.ttf": "cb7f81f542f5c418a3bbb9ad3f9fbe784151d13b04cec50ecedec6013324a3da",
  "fonts/icons.woff": "95b6a4840f8711ecab427bc236eb86098db7e5c782bafb139c8c30805aa5ffe1",
  "fonts/icons.woff2": "434466b59545a8a1cac6ddb38197cdc6b35995a98c3f3812fb88d61b1c300dd3",
  "fonts/outline-icons.eot": "4537fa06340ee62c264e9d7a4d8aabcab3de7bda2c5cc334010f46b683106fcb",
  "fonts/outline-icons.svg": "ae8fd02a7bb87479fe46a541e2ea5af7e342393e8ef88d351cdaf10ce71ce601",
  "fonts/outline-icons.ttf": "67172172eafce4563725e661043d5db854b86768a9e8bd39758dbe81c4796935",
  "fonts/outline-icons.woff": "4bc359c27057b3ed0baca66d6c5349a5d4a605096fbc7875061ba2d91a3d6d05",
  "fonts/outline-icons.woff2": "4d2883443b24e424527f6a0a7aa2897b3df71f239db40373c4ff760e48147801",
  "images/flags.png": "94d5c7f1661301c4a6dc491d72dd559a0620cd917a826f0df1b023bb96ea9ddd"
};

/** The fingerprint is of all font-face, icon glyph and flag rules, not of a theme's CSS. */
export async function semanticUiDependencyFingerprint(bytes:Uint8Array):Promise<string|null> {
  let css:string;
  try{css=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{return null;}
  // Preserve quoted strings (including comment-looking text inside URLs).
  css=css.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\*[\s\S]*?\*\//g,token=>token.startsWith('/*')?'':token);
  const rules:[string,string][]=[];
  const stack:{selector:string;body:number;nested:boolean}[]=[];
  let start=0,quote='',escaped=false;
  const normalize=(s:string)=>s.trim().replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\s+/g,token=>/^\s/.test(token)?' ':token);
  for(let i=0;i<css.length;i++){
    const c=css[i]!;
    if(quote){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c===quote)quote='';continue;}
    if(c==='"'||c==="'"){quote=c;continue;}
    if(c==='{' ){
      if(stack.length)stack[stack.length-1]!.nested=true;
      stack.push({selector:normalize(css.slice(start,i)),body:i+1,nested:false});start=i+1;
    }else if(c==='}'){
      const rule=stack.pop();if(!rule)return null;
      const body=normalize(css.slice(rule.body,i));
      if(!rule.nested&&(rule.selector==='@font-face'||/\.flag(?=[^\w-]|$)/.test(rule.selector)||(/\.icon(?=[^\w-]|$)/.test(rule.selector)&&/(?:^|;)\s*content\s*:/.test(body))))rules.push([rule.selector,body]);
      start=i+1;
    }else if(c===';'&&!stack.length)start=i+1;
  }
  if(stack.length||quote||!rules.length)return null;
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(rules)));
  return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}

export const SEMANTIC_UI_RULE_FINGERPRINT='ca7b17c41d4d68feffef3572e1702147bf559f76f0a3960907c656003c473776';

/** Sources keyed by the actual browser-relative path under this stylesheet. */
export async function cssDependencySources(cssPath:string,bytes:Uint8Array):Promise<Record<string,PublicResourceSource>> {
  if(!cssPath.endsWith('.css')||cssPath.startsWith('/')||/[\\:%?#\x00-\x1f\x7f]/.test(cssPath)||cssPath.split('/').some(part=>!part||part==='.'||part==='..'))return {};
  if(await semanticUiDependencyFingerprint(bytes)!==SEMANTIC_UI_RULE_FINGERPRINT)return {};
  const base=cssPath.slice(0,cssPath.lastIndexOf('/')+1);
  return Object.fromEntries(Object.entries(SEMANTIC_UI_ASSET_HASHES).map(([path,sha256])=>[
    `${base}themes/default/assets/${path}`,
    {url:`https://raw.githubusercontent.com/Semantic-Org/Semantic-UI-CSS/${SEMANTIC_UI_REVISION}/themes/default/assets/${path}`,sha256},
  ]));
}
