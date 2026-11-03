import { PREVIEW_PARAMETER } from '../management/config.ts';

/** Carry the version through root-relative static imports, CSS URLs and navigations.
 * Redirect before serving bytes so the next resource also has a versioned referrer.
 * No cookies or process-global selection: simultaneous tabs keep independent versions.
 */
export function previewRedirect(request:Request):Response|null {
  const url=new URL(request.url);
  if(url.searchParams.has(PREVIEW_PARAMETER))return null;
  let referrer:URL;
  try{referrer=new URL(request.headers.get('referer')||'');}catch{return null;}
  if(referrer.origin!==url.origin)return null;
  const ids=referrer.searchParams.getAll(PREVIEW_PARAMETER);
  if(ids.length!==1||! /^[a-f0-9]{32}$/.test(ids[0]!))return null;
  url.searchParams.set(PREVIEW_PARAMETER,ids[0]!);
  return new Response(null,{status:307,headers:{Location:url.href,'Cache-Control':'no-store',Vary:'Referer','Referrer-Policy':'same-origin'}});
}

/** Serialized into the document before any theme scripts. Keep this self-contained.
 * Network URLs and browser history retain the version; pathname stays untouched so
 * third-party routers can keep their original routes. This is NOT a security sandbox.
 */
const PREVIEW_CLIENT=String.raw`function(parameter,id){
  const origin=location.origin;
  function mark(value){
    const url=new URL(value,document.baseURI);
    const httpOrigin=url.origin.replace(/^ws/,'http');
    if(httpOrigin!==origin||!['http:','https:','ws:','wss:'].includes(url.protocol))return value;
    url.searchParams.set(parameter,id);
    return url.href;
  }
  const originalFetch=window.fetch;
  window.fetch=function(input,init){
    return originalFetch.call(this,input instanceof Request?new Request(mark(input.url),input):mark(String(input)),init);
  };
  const originalOpen=XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open=function(method,url,async=true,username,password){
    return originalOpen.call(this,method,mark(String(url)),async,username,password);
  };
  window.WebSocket=new Proxy(WebSocket,{construct(Target,args){args[0]=mark(String(args[0]));return Reflect.construct(Target,args);}});
  if(window.EventSource)window.EventSource=new Proxy(EventSource,{construct(Target,args){args[0]=mark(String(args[0]));return Reflect.construct(Target,args);}});
  for(const method of ['pushState','replaceState']){
    const original=history[method];
    history[method]=function(data,unused,url){return original.call(this,data,unused,url==null?url:mark(String(url)));};
  }
}`;

export function previewHtml(html:string,id:string):string {
  // The id comes from a validated installation, never raw request text.
  if(!/^[a-f0-9]{32}$/.test(id))throw new Error('Invalid installation id');
  const bootstrap=`<meta name="referrer" content="same-origin"><script>(${PREVIEW_CLIENT})(${JSON.stringify(PREVIEW_PARAMETER)},${JSON.stringify(id)});</script>`;
  // A theme's no-referrer meta would lose version selection for nested resources.
  html=html.replace(/<meta\b[^>]*\bname\s*=\s*["']?referrer\b[^>]*>/gi,'');
  if(/<head(?:\s[^>]*)?>/i.test(html))return html.replace(/<head(?:\s[^>]*)?>/i,head=>head+bootstrap);
  return html.replace(/^(\s*<!doctype[^>]*>)?/i,start=>start+bootstrap);
}
