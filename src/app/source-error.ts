/** The installed native frontend only displays HTTP status codes. Add a transient
 * source-error alert at delivery time without changing its immutable package. */
const SOURCE_ERROR_CLIENT=String.raw`function(){
  const originalFetch=window.fetch;
  let notice,latest=0;
  function clear(){if(notice)notice.remove();notice=undefined;}
  function show(message){
    clear();
    notice=document.createElement('aside');
    notice.setAttribute('data-leobridge-source-error','');
    notice.style.cssText='position:fixed;z-index:2147483647;top:20px;left:50%;transform:translateX(-50%);width:calc(100% - 32px);max-width:560px;';
    const shadow=notice.attachShadow({mode:'open'});
    const panel=document.createElement('div');
    panel.setAttribute('role','alert');
    panel.style.cssText='box-sizing:border-box;padding:20px 24px;border:1px solid #f0b4ad;border-radius:12px;background:#fff7f5;color:#752c24;box-shadow:0 8px 24px #0002;font:15px/1.7 system-ui,sans-serif;text-align:left;';
    const title=document.createElement('strong');
    title.textContent='请检查数据源 Token';
    title.style.cssText='display:block;font-size:18px;margin-bottom:8px;';
    const text=document.createElement('div');text.textContent=message;
    const retry=document.createElement('button');retry.type='button';retry.textContent='重新检查';
    retry.style.cssText='margin-top:14px;padding:6px 14px;border:1px solid #b76050;border-radius:6px;background:#fff;color:#752c24;font:inherit;cursor:pointer;';
    retry.onclick=()=>location.reload();
    panel.append(title,text,retry);shadow.append(panel);document.body.append(notice);
  }
  window.fetch=function(input,init){
    let target;
    try{target=new URL(input instanceof Request?input.url:String(input),document.baseURI);}catch{}
    if(!target||target.origin!==location.origin||target.pathname!=='/api/probe')return originalFetch.call(this,input,init);
    const sequence=++latest;
    const task=originalFetch.call(this,input,init);
    task.then(async response=>{
      if(sequence!==latest)return;
      if(response.ok){clear();return;}
      const data=await response.clone().json();
      if(sequence!==latest)return;
      if(['UPSTREAM_AUTH','UPSTREAM_NOT_FOUND'].includes(data?.code)&&typeof data.message==='string')show(data.message);
      else clear();
    }).catch(()=>{if(sequence===latest)clear();});
    return task;
  };
}`;

export function sourceErrorHtml(html:string):string {
  const bootstrap=`<script>(${SOURCE_ERROR_CLIENT})();</script>`;
  if(/<head(?:\s[^>]*)?>/i.test(html))return html.replace(/<head(?:\s[^>]*)?>/i,head=>head+bootstrap);
  return html.replace(/^(\s*<!doctype[^>]*>)?/i,start=>start+bootstrap);
}
