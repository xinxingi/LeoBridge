const $=id=>document.getElementById(id)
const apiRoot=location.pathname.startsWith('/admin/')?'/admin/api/':'/manage/api/'
let csrf='',state=null,view='installed',busy=false,loginHintRequest=0,sourceStatus=null,sourceReview=null,sourceDraftRevision=0,networkStatus=null
const catalogCache={}
function element(tag,text,className){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node}
function notice(message,error=false){$('notice').textContent=message;$('notice').className=error?'error':'';$('notice').hidden=!message;$('notification').hidden=!message}
$('notice-close').addEventListener('click',()=>notice(''))
const headerMenus=[...document.querySelectorAll('.header-menu')]
function closeHeaderMenus(){headerMenus.forEach(menu=>menu.open=false)}
headerMenus.forEach(menu=>{
  const trigger=menu.querySelector('summary')
  menu.addEventListener('click',event=>{
    if(trigger.contains(event.target)){headerMenus.forEach(other=>{if(other!==menu)other.open=false});return}
    if(event.target.closest('button,a')){menu.open=false;if(!menu.hidden)trigger.focus()}
  })
  menu.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&menu.open){event.preventDefault();menu.open=false;trigger.focus()}
  })
  document.addEventListener('focusin',event=>{if(!menu.contains(event.target))menu.open=false})
  document.addEventListener('click',event=>{if(!menu.contains(event.target))menu.open=false})
})
async function api(path,body){const response=await fetch(apiRoot+path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:body===undefined?undefined:JSON.stringify(body)});const data=await response.json();if(!response.ok){if(response.status===401)showLogin();if(data.code==='PASSWORD_CHANGE_REQUIRED')showPasswordChange(true);throw new Error(data.message||data.error||'请求失败')}return data}
async function task(action){if(busy)return;busy=true;document.querySelectorAll('button:not([data-appearance]):not(#notice-close)').forEach(b=>b.disabled=true);try{await action()}catch(error){notice(error.message,true)}finally{busy=false;document.querySelectorAll('button:not([data-appearance]):not(#notice-close)').forEach(b=>b.disabled=b.dataset.requiresConfirmation==='true'&&!b.confirmationInput?.checked);if(focusAfterTask){focusAfterTask.focus();focusAfterTask=null}}}
function link(text,href){const node=element('a',text,'button secondary');node.href=href;node.target='_blank';node.rel='noopener noreferrer';return node}
function button(text,handler,primary=false){const node=element('button',text,primary?'primary':'secondary');node.addEventListener('click',()=>task(handler));return node}
function displayText(value){if(typeof value==='string')return value;if(value&&typeof value==='object')return value['zh-CN']||value.zh||value.en||Object.values(value).find(v=>typeof v==='string')||'';return ''}
async function refreshState(){state=await api('state');$('display-link').href=state.displayOrigin;$('display-link').hidden=false;renderActive()}
function renderActive(){const host=$('active');host.replaceChildren();const item=state.installations[state.active];const current=element('div',undefined,'current');current.append(element('div',item?(item.ecosystem==='native'?'M':item.ecosystem==='komari'?'K':'C'):'L','icon'));const info=element('div');info.append(element('p','当前启用 / ACTIVE THEME','eyebrow'),element('h2',item?.title||'尚未启用主题'),element('p',item?`${item.ecosystem.toUpperCase()} · 固定版本 ${item.pinnedVersion.slice(0,16)} · 第 ${state.generation} 次状态修订`:'安装主题并完成预览后启用'));current.append(info);host.append(current);const actions=element('div',undefined,'actions');if(item)actions.append(link('查看 ↗',state.links[item.id].display));if(state.previous)actions.append(button('回退上一版本',async()=>{await api('rollback',{generation:state.generation});await refreshState();await render();notice('已回退。新打开的展示站将使用上一版本。')}));host.append(actions)}
function installedCard(item){const card=element('article',undefined,'card');const top=element('div',undefined,'card-top');top.append(element('span',item.ecosystem.toUpperCase(),'ecosystem'),element('span',item.compatibility==='verified'?'实测兼容':'未验证兼容',`badge ${item.compatibility==='verified'?'':'unknown'}`));card.append(top,element('h3',item.title),element('p',item.bundled?'随项目构建 · 保留上游来源与适配记录':'商店安装 · 固定来源已校验'),element('p',`版本 ${item.pinnedVersion}`,'version'),element('small',`${item.license.status==='missing'?'未发现明确许可文件':`许可信息 ${item.license.spdx}`} · ${new Set([...Object.keys(item.files),...Object.keys(item.remoteFiles||{})]).size} 个资源`));if(item.ecosystem==='native')card.append(nativeThemeControl(item));let ack=null;if(item.compatibility!=='verified'&&item.id!==state.active){const label=element('label',undefined,'ack');ack=element('input');ack.type='checkbox';label.append(ack,document.createTextNode('已检查预览，接受此版本尚未经完整兼容验收'));card.append(label)}const buttons=element('div',undefined,'buttons');buttons.append(link('预览 ↗',state.links[item.id].preview));if(item.id===state.active)buttons.append(element('span','✓ 当前启用','active-status'));else buttons.append(button('启用此版本',async()=>{await api('activate',{id:item.id,generation:state.generation,acknowledgeUnverified:ack?.checked===true});await refreshState();await render();notice('已启用。请刷新展示页面查看新主题。')},true));card.append(buttons);const detail=element('details');detail.append(element('summary','来源与许可证'),element('p',item.source),element('pre',item.license.text));if(item.confirmation)detail.append(element('p',`知情安装确认：${item.confirmation.at} · 说明版本 ${item.confirmation.noticeVersion}`),element('p',item.confirmation.noticeText));else detail.append(element('p','历史安装，无本流程的确认记录。'));for(const doc of item.license.documents||[]){const record=element('details');record.append(element('summary',doc.path),element('pre',doc.text));detail.append(record)}card.append(detail);return card}
function nativeThemeControl(item){
  const box=element('div',undefined,'native-theme-control'),label=element('label','原生外观'),select=element('select');
  select.setAttribute('aria-label','原生外观');
  for(const [value,text]of [['source','跟随主控'],['pixel','像素'],['flat','扁平'],['anime','二次元'],['premium','高级黑金（付费许可证）']]){
    const option=element('option',text);option.value=value;select.append(option);
  }
  select.value=item.nativeTheme||'source';label.append(select);box.append(label);
  box.append(element('small','由桥接器保存，仅影响此安装版本的展示与预览。'));
  box.append(button('保存外观',async()=>{
    await api('native-theme',{id:item.id,generation:state.generation,theme:select.value});
    await refreshState();await render();notice('原生外观已保存。请刷新展示或预览页面。');
  }));return box;
}
let installDialog=null,focusAfterTask=null;
function closeInstallReview(restoreFocus=true){if(installDialog){const dialog=installDialog;installDialog=null;dialog.close();dialog.remove();if(restoreFocus&&dialog.returnFocus?.isConnected){if(busy)focusAfterTask=dialog.returnFocus;else dialog.returnFocus.focus()}}}
function showInstallReview(title,review,trigger){
  closeInstallReview();
  const dialog=element('dialog',undefined,'install-dialog');installDialog=dialog;dialog.returnFocus=trigger;
  dialog.setAttribute('aria-labelledby','install-title');
  const header=element('div',undefined,'install-header'),heading=element('div');
  const name=element('h2',title);name.id='install-title';
  heading.append(element('p','安装主题','eyebrow'),name,element('p','核对来源与许可信息后确认安装。'));
  const close=button('×',async()=>closeInstallReview());close.className='dialog-close';close.setAttribute('aria-label','关闭安装确认');
  header.append(heading,close);
  const body=element('div',undefined,'install-body'),metadata=element('dl',undefined,'install-metadata');
  const sourceRow=element('div'),versionRow=element('div'),source=element('dd'),version=element('dd',review.pinnedVersion,'install-version');
  const sourceLink=link('查看上游来源 ↗',review.source);sourceLink.className='text-link';source.append(sourceLink);
  sourceRow.append(element('dt','主题来源'),source);versionRow.append(element('dt','固定版本'),version);metadata.append(sourceRow,versionRow);body.append(metadata);
  const license=element('div',undefined,'install-license');
  license.append(element('p',review.license.status==='missing'?'未发现明确许可文件':'许可文件','license-status'),element('p','LeoBridge 不提供授权判断，勾选仅记录你的安装决定。'));
  const docs=review.license.documents?.length?review.license.documents:review.license.text?[{path:'许可说明',text:review.license.text}]:[];
  for(const doc of docs){const details=element('details');details.append(element('summary',doc.path),element('pre',doc.text));license.append(details)}
  if(review.license.source){const source=link('查看许可来源 ↗',review.license.source);source.className='text-link';license.append(source)}
  body.append(license);
  if(review.resourceNotices?.length){const resources=element('details');resources.append(element('summary','主题资源依赖'),element('p','资源由主题来源提供；外部依赖的可用性取决于访问网络。'),element('pre',review.resourceNotices.join('\n')));body.append(resources)}
  const footer=element('div',undefined,'install-footer'),label=element('label',undefined,'ack'),ack=element('input');ack.type='checkbox';ack.checked=false;
  label.append(ack,element('span',review.noticeText));
  const status=element('p',undefined,'install-status');status.hidden=true;status.setAttribute('role','status');
  const actions=element('div',undefined,'install-actions');
  const confirm=button('确认安装',async()=>{
    if(!ack.checked)throw new Error('请阅读来源与许可信息，并主动勾选确认。');
    status.hidden=false;status.className='install-status';status.textContent='正在核对版本并安装…';confirm.textContent='正在安装…';ack.disabled=true;
    try{
      const result=await api('install',{reviewId:review.reviewId,noticeVersion:review.noticeVersion,acknowledge:ack.checked===true});
      closeInstallReview(false);await refreshState();view='installed';await render();notice(`安装完成，版本 ${result.id.slice(0,10)}。先预览，再启用。`);
    }catch(error){status.className='install-status error';status.textContent=error.message;throw error}
    finally{confirm.textContent='确认安装';ack.disabled=false}
  },true);
  confirm.dataset.requiresConfirmation='true';confirm.disabled=true;confirm.confirmationInput=ack;
  ack.addEventListener('change',()=>{confirm.disabled=busy||!ack.checked});
  actions.append(button('取消',async()=>closeInstallReview()),confirm);footer.append(label,status,actions);
  dialog.append(header,body,footer);
  dialog.addEventListener('cancel',event=>{event.preventDefault();if(!busy)closeInstallReview()});
  document.body.append(dialog);dialog.showModal();close.focus();
}
function catalogCard(entry,ecosystem){
  const card=element('article',undefined,'card catalog-card'),top=element('div',undefined,'card-top');
  top.append(element('span',ecosystem.toUpperCase(),'ecosystem'),element('span','未验证兼容','badge unknown'));
  const title=displayText(entry.title||entry.name)||entry.id;
  card.append(top,element('h3',title),element('p',displayText(entry.description)||'来自生态官方目录。','catalog-description'));
  const meta=element('div',undefined,'catalog-meta');
  const stars=element('p',Number.isSafeInteger(entry.stars)&&entry.stars>=0?`★ ${entry.stars.toLocaleString('zh-CN')} Stars`:'☆ - Stars','theme-stars');
  stars.title=entry.starsFetchedAt?`GitHub 仓库 Star 数 · 获取时间 ${new Date(entry.starsFetchedAt).toLocaleString('zh-CN')}${entry.starsStale?'（缓存，刷新未成功）':''}`:'未获取到 GitHub 仓库 Star 数';
  meta.append(stars,element('span',entry.version||entry.branch||'安装时固定版本','catalog-version'));card.append(meta);
  if(entry.blockReasons?.length)card.append(element('small',entry.blockReasons.join('；'),'catalog-blocked'));
  const buttons=element('div',undefined,'buttons');
  if(entry.repositoryUrl){const source=link('上游项目 ↗',entry.repositoryUrl);source.className='text-link';buttons.append(source)}
  if(entry.canAttemptInstall!==false){const prepare=button('查看安装',async()=>{
    notice(ecosystem==='native'?'正在下载并构建原生主题，首次准备可能需要数分钟…':'正在读取主题及许可信息…');
    const review=await api('prepare-install',{ecosystem,id:entry.id,catalogRevision:catalogCache[ecosystem].catalogRevision});
    showInstallReview(title,review,prepare);notice('');
  },true);buttons.append(prepare)}else buttons.append(element('span','当前不可安装','badge unknown'));
  card.append(buttons);return card;
}
async function render(){
  $('workspace').hidden=view==='settings';$('settings').hidden=view!=='settings';
  $('subtitle').textContent=view==='settings'?'管理数据源连接和主题商店下载。':'安装一次，预览后切换。保留每个版本，随时回退。';
  if(view==='settings'){
    document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('selected',b.dataset.view===view));
    $('heading').textContent='设置';
    const results=await Promise.allSettled([loadSource(),loadNetwork()]);
    const failure=results.find(result=>result.status==='rejected');
    if(failure)throw failure.reason;
    return;
  }
document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('selected',b.dataset.view===view));$('heading').textContent=view==='installed'?'主题工作台':view==='native'?'妙妙屋 X 原生主题':`${view==='cfsm'?'CFSM':'Komari'} 主题商店`;$('section-title').textContent=view==='installed'?'已安装版本':'探索主题';$('section-note').textContent=view==='installed'?'资源和协议一起切换。切换后请刷新展示页面。':'目录收录不代表已安装或兼容；包安全、许可信息和实际兼容性分别记录。';const cards=$('cards');cards.replaceChildren();if(view==='installed'){Object.values(state.installations).forEach(item=>cards.append(installedCard(item)));if(!cards.children.length)cards.append(element('p','尚未安装主题。','empty'));return}if(!catalogCache[view]){cards.append(element('p','正在读取官方主题目录…','empty'));try{catalogCache[view]=await api(`catalog?ecosystem=${view}&refresh=1`)}catch(error){cards.replaceChildren(element('p','目录读取失败，请检查网络或“设置”中的商店下载配置后刷新。','empty'));throw error}}const data=catalogCache[view];$('section-note').textContent=view==='native'?`固定源码 ${data.catalogRevision.slice(0,12)} · 首次准备会下载依赖并构建，请稍候；安装后可在主题工作台独立选择外观。`:`官方目录 ${data.catalogRevision.slice(0,12)} · ${data.entries.length} 个主题 · 按 Star 数从多到少排序，未获取到的排最后。Star 数缓存 1 小时；兼容性另行验证。`;cards.replaceChildren();const entries=data.entries||data.themes||[];entries.forEach(entry=>cards.append(catalogCard(entry,view)));if(!entries.length)cards.append(element('p','目录没有可显示条目。','empty'))}
async function showLogin(){closeInstallReview(false);closeHeaderMenus();csrf='';state=null;sourceStatus=null;networkStatus=null;clearSourceReview();$('source-form').reset();$('network-form').reset();$('network-url').value='';for(const key of Object.keys(catalogCache))delete catalogCache[key];for(const id of ['sidebar','account-menu','workspace','settings','password-change','logout','display-link','change-password'])$(id).hidden=true;$('login').hidden=false;$('password-form').reset();$('initial-password-hint').hidden=true;const request=++loginHintRequest;try{const response=await fetch(apiRoot+'login-info',{cache:'no-store'});if(!response.ok)return;const data=await response.json();if(request===loginHintRequest&&!$('login').hidden){const message=data.credentialSource==='default'?'初始密码：admin。登录后请设置新密码。':'';$('initial-password-hint').textContent=message||'';$('initial-password-hint').hidden=!message}}catch{/* Keep initialization guidance hidden when its status is unavailable. */}}
function showPasswordChange(required){closeInstallReview(false);closeHeaderMenus();$('account-menu').hidden=false;state=null;for(const id of ['sidebar','login','workspace','settings','display-link','change-password'])$(id).hidden=true;$('password-change').hidden=false;$('logout').hidden=false;$('cancel-password').hidden=required;$('password-heading').textContent=required?'设置高强度密码':'修改管理密码';$('password-error').hidden=true;$('password-error').textContent='';$('password-intro').textContent=required?'当前使用默认密码 admin，必须先更改后才能使用管理功能。':'改密后所有已登录会话将退出，请使用新密码重新登录。'}
async function signedIn(){const session=await api('session');csrf=session.csrf;$('account-menu').hidden=false;if(session.mustChangePassword){showPasswordChange(true);return}$('login').hidden=true;$('password-change').hidden=true;$('workspace').hidden=false;$('logout').hidden=false;$('change-password').hidden=false;await refreshState();sourceStatus=await api('source');if(!sourceStatus.configured)view='settings';await render();$('sidebar').hidden=false}
$('login-form').addEventListener('submit',event=>{event.preventDefault();task(async()=>{const form=new FormData(event.target);const result=await api('login',{username:form.get('username'),password:form.get('password')});csrf=result.csrf;event.target.elements.password.value='';await signedIn();notice('')})})
for(const id of ['logout','password-logout'])$(id).addEventListener('click',()=>task(async()=>{await api('logout',{});showLogin();notice('已退出管理会话。')}))
$('change-password').addEventListener('click',()=>{showPasswordChange(false);notice('')})
$('cancel-password').addEventListener('click',()=>task(async()=>{$('password-form').reset();await signedIn();notice('')}))
$('password-form').addEventListener('submit',event=>{event.preventDefault();task(async()=>{
  $('password-error').hidden=true;$('password-error').textContent='';
  try{
    const form=new FormData(event.target);const newPassword=form.get('newPassword');
    if(newPassword!==form.get('confirmPassword'))throw new Error('两次输入的新密码不一致。');
    await api('password',{currentPassword:form.get('currentPassword'),newPassword,confirmPassword:form.get('confirmPassword')});
    await showLogin();notice('密码已修改，请使用新密码重新登录。');
  }catch(error){$('password-error').textContent=error.message;$('password-error').hidden=false;throw error}
})})
document.querySelectorAll('[data-view]').forEach(node=>node.addEventListener('click',()=>task(async()=>{if(!state)return;view=node.dataset.view;notice('');await render()})))
$('refresh').addEventListener('click',()=>task(async()=>{delete catalogCache[view];await refreshState();await render();notice('已刷新。')}))
function clearSourceReview(){sourceReview=null;$('source-review').hidden=true;$('source-nodes').replaceChildren();$('source-targets').replaceChildren();$('source-confirm').checked=false}
function sourceEdit(editing){
  clearSourceReview();$('source-check-status').hidden=true;
  $('source-summary').hidden=editing||!sourceStatus.configured;$('source-editor').hidden=!editing;
  $('source-edit-note').hidden=!sourceStatus.configured;$('source-edit-cancel').hidden=!sourceStatus.configured;
  $('source-heading').textContent=sourceStatus.configured?(editing?'修改数据源':'当前数据源'):'连接妙妙屋X';
  $('source-form').elements.baseUrl.value=sourceStatus.baseUrl;$('source-form').elements.token.value='';
  sourceTokenHint();
}
function sourceTokenHint(){
  const form=$('source-form'),same=form.elements.baseUrl.value.trim().replace(/\/$/,'')===sourceStatus.baseUrl.replace(/\/$/,'');
  const retain=sourceStatus.hasToken&&same;
  form.elements.token.placeholder=retain?'已配置，留空保留现有 Token':'输入探针 Token';
  $('source-token-hint').textContent=retain?'Token 已配置，不会回显；无需重复填写。':'Token 仅保存在服务端。更换主控时请填写对应 Token；公开且无需鉴权的主控可留空。';
}
async function loadSource(){
  clearSourceReview();$('source-check-status').hidden=true;$('source-summary').hidden=true;$('source-editor').hidden=true;$('source-configured').hidden=true;
  $('source-status').textContent='正在读取配置…';sourceStatus=await api('source');
  $('source-configured').hidden=!sourceStatus.configured;
  $('source-status').textContent=sourceStatus.configured?'当前配置已生效，无需重复配置。':'尚未配置数据源。填写主控地址和探针 Token 后检查连接。';
  $('source-current-url').textContent=sourceStatus.baseUrl;
  $('source-current-nodes').textContent=`${sourceStatus.bindingCount} 个已配置节点身份`;
  $('source-current-token').textContent=sourceStatus.hasToken?'已配置（不显示密钥）':'未配置 Token';
  $('source-current-storage').textContent=sourceStatus.storage==='saved'?'后台保存':'尚未配置';
  sourceEdit(!sourceStatus.configured);
}
$('source-edit').addEventListener('click',()=>sourceEdit(true));
$('source-edit-cancel').addEventListener('click',()=>{sourceDraftRevision++;sourceEdit(false);notice('已取消修改，继续使用当前数据源。')});
function networkFields(){
  $('network-address').hidden=!$('network-enabled').checked;
  $('network-url').required=$('network-enabled').checked&&!networkStatus?.hasAddress;
}
async function loadNetwork(){
  $('network-form').hidden=true;$('network-status').textContent='正在读取设置…';
  networkStatus=await api('store-proxy');
  if(!networkStatus.supported){$('network-status').textContent='当前运行环境不支持配置商店代理。';return}
  $('network-form').hidden=false;$('network-enabled').checked=networkStatus.enabled;$('network-url').value='';$('network-url').placeholder=networkStatus.hasAddress?'已保存，留空保留原地址':'http://127.0.0.1:7897';
  $('network-status').textContent=networkStatus.enabled?`当前使用代理：${networkStatus.url}${networkStatus.hasCredentials?'（含认证信息）':''}`:'当前直接连接主题商店（代理已关闭）。';
  $('network-address-hint').textContent=networkStatus.hasAddress?`已保存地址：${networkStatus.url}。留空保留原地址及认证信息；输入新地址将完整替换。`:'支持 HTTP/HTTPS 代理，可包含用户名和密码。地址由运行 LeoBridge 的服务器访问。';
  networkFields();
}
$('network-enabled').addEventListener('change',networkFields);
$('network-reload').addEventListener('click',()=>task(loadNetwork));
$('network-form').addEventListener('submit',event=>{event.preventDefault();task(async()=>{
  await api('store-proxy',{version:networkStatus.version,enabled:$('network-enabled').checked,url:$('network-enabled').checked?$('network-url').value:''});
  for(const key of Object.keys(catalogCache))delete catalogCache[key];
  await loadNetwork();notice('商店下载设置已保存，后续请求使用新设置。');
})});
function renderSourceReview(review){
  clearSourceReview();sourceReview=review;$('source-review').hidden=false;
  review.candidates.forEach((item,index)=>{
    const row=element('div',undefined,'source-node'),label=element('label',`节点 ${index+1} · ${item.match.name||'名称未公开'}`),select=element('select');select.dataset.sourceIdentity='true';select.setAttribute('aria-label',`节点 ${index+1} 的稳定身份`);
    const add=(value,text)=>{const option=element('option',text);option.value=value;select.append(option)};
    add('','请选择身份');add(item.newId,`新建身份 · ${item.newId}`);
    for(const old of review.previous)add(old.id,`沿用 ${old.match.name||'已有节点'} · ${old.id}`);
    select.value=item.suggestedId;label.append(select);row.append(label,element('p',Object.entries(item.match).map(([key,value])=>`${key}: ${value}`).join(' · ')));$('source-nodes').append(row);
  });
  if(!review.candidates.length)$('source-nodes').append(element('p','主控当前公开 0 台节点。保存后绑定列表将为空。'));
  for(const [index,slot]of ['ct','cu','cm','bd','node_1','node_2','node_3','node_4'].entries()){
    const label=element('label',`目标 ${index+1}`),select=element('select');select.dataset.sourcePing='true';
    const empty=element('option','不展示');empty.value='';select.append(empty);
    for(const target of review.targets){const option=element('option',`${target.label} · ${target.key}`);option.value=target.key;select.append(option)}
    select.value=review.pingTargets[slot]?.key||'';label.append(select);$('source-targets').append(label);
  }
}
$('source-form').addEventListener('input',()=>{sourceDraftRevision++;clearSourceReview();sourceTokenHint();if(!busy)$('source-check-status').hidden=true});
$('source-form').addEventListener('submit',event=>{event.preventDefault();task(async()=>{
  clearSourceReview();notice('');const form=event.target;
  const revision=sourceDraftRevision;const payload={version:sourceStatus.version,baseUrl:form.elements.baseUrl.value,token:form.elements.token.value};
  const status=$('source-check-status'),message=$('source-check-message'),elapsed=$('source-check-elapsed'),control=$('source-check');
  status.hidden=false;status.classList.remove('error');message.textContent='正在连接主控并读取公开节点，请稍候…';
  control.textContent='正在检查…';control.setAttribute('aria-busy','true');$('source-check-spinner').hidden=false;elapsed.hidden=false;
  const started=Date.now();
  const updateElapsed=()=>{const seconds=Math.floor((Date.now()-started)/1000);elapsed.textContent=`已等待 ${seconds} 秒${seconds>=10?' · 主控响应较慢，请继续等待，无需重复点击。':''}`;};
  updateElapsed();const timer=setInterval(updateElapsed,1000);
  status.scrollIntoView({block:'nearest'});
  try{
    const review=await api('source/check',payload);
    if(revision!==sourceDraftRevision){message.textContent='配置已编辑，请重新检查连接。';return}
    form.elements.token.value='';renderSourceReview(review);
    message.textContent='连接成功。请在下方核对节点身份和 Ping 目标，15 分钟内确认保存。';
  }catch(error){
    status.classList.add('error');message.textContent=`检查失败：${error.message} 请检查配置后重试。`;
    throw error;
  }finally{
    clearInterval(timer);control.textContent='检查连接';control.removeAttribute('aria-busy');$('source-check-spinner').hidden=true;elapsed.hidden=true;
  }
})});
$('source-cancel').addEventListener('click',()=>{clearSourceReview();$('source-check-status').hidden=true;notice('已取消，当前配置未变更。')});
$('source-save').addEventListener('click',()=>task(async()=>{
  if(!sourceReview||!$('source-confirm').checked)throw new Error('请核对并勾选确认后保存。');
  const assignments=[...document.querySelectorAll('[data-source-identity]')].map(select=>select.value);
  if(assignments.some(id=>!id)||new Set(assignments).size!==assignments.length)throw new Error('请为每台节点选择不同的稳定身份。');
  const pingKeys=[...document.querySelectorAll('[data-source-ping]')].map(select=>select.value);
  notice('正在复核节点并保存配置…');await api('source/save',{reviewId:sourceReview.reviewId,assignments,pingKeys,confirmed:true});
  await loadSource();notice('数据源已保存并生效。可前往主题商店安装、预览并启用主题。');
}));
signedIn().catch(error=>{if(!error.message.includes('请登录'))notice(error.message,true);$('login').hidden=false})
