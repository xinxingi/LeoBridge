import { PING_SLOTS, readConfig, type Config } from '../core/config.ts';
import { BridgeError } from '../core/errors.ts';
import { IDENTITY_FIELDS, resolveBindings, type Binding } from '../core/identity.ts';
import type { Snapshot } from '../core/model.ts';
import { sourceConfig, type SourceReview } from '../core/source.ts';
import type { ThemeStore } from '../themes/store.ts';

export class SourceManagement {
  constructor(private initial:Config,private store:ThemeStore,private probe:(config:Config)=>Promise<Snapshot>){}
  private async current(){const state=await this.store.state();return {version:state.source?.version??0,config:state.source?sourceConfig(this.initial,state.source):this.initial};}
  async status(){
    const {version,config}=await this.current();
    return {version,configured:!!config.baseUrl,baseUrl:config.baseUrl,hasToken:!!config.token,bindingCount:config.bindings.length,storage:version?'saved':'environment'};
  }
  async check(body:Record<string,unknown>,sessionId:string){
    const {version,config:current}=await this.current();
    if(body.version!==version)throw new BridgeError('SOURCE_CONFLICT',409,'数据源已变更，请刷新后重试。');
    if(typeof body.baseUrl!=='string'||typeof body.token!=='string'||body.token.length>4096||/[\u0000-\u001f\u007f]/.test(body.token))throw new BridgeError('SOURCE_INPUT',400,'请填写有效的主控地址和 Token。');
    const baseUrl=readConfig({MMWX_BASE_URL:body.baseUrl.trim()}).baseUrl;
    // A retained credential must never be sent to a different origin.
    const token=body.token || (baseUrl===current.baseUrl?current.token:'');
    const candidate=sourceConfig(current,{baseUrl,token,bindings:[],pingTargets:{}});
    const snapshot=await this.probe(candidate);
    if(!snapshot.enabled)throw new BridgeError('PROBE_DISABLED',503,'上游未开放探针展示。');
    if(!snapshot.showName)snapshot.servers=snapshot.servers.map(({name,...publicFields})=>publicFields);
    const previous=current.bindings;
    const matches=(match:Binding['match'],raw:Record<string,unknown>)=>Object.entries(match).every(([key,value])=>raw[key]===value);
    const candidates=snapshot.servers.map(raw=>{
      const matched=baseUrl===current.baseUrl?previous.filter(binding=>matches(binding.match,raw)&&snapshot.servers.filter(server=>matches(binding.match,server)).length===1):[];
      const match:Binding['match']={};
      for(const key of IDENTITY_FIELDS){
        if(!['name','cpu_model','cpu_threads','arch','region_country','provider_name'].includes(key))continue;
        const value=raw[key];if((typeof value==='string'&&value.trim())||(typeof value==='number'&&Number.isFinite(value)&&value>=0))match[key]=value;
      }
      // Keep already reviewed selectors for an unchanged, unambiguous identity.
      return {match:matched.length===1?matched[0]!.match:match,newId:crypto.randomUUID(),suggestedId:matched.length===1?matched[0]!.id:''};
    });
    // Refuse indistinguishable public descriptions, including empty selectors.
    resolveBindings(snapshot,candidates.map(item=>({id:item.newId,match:item.match})));
    const targets=new Map<string,{key:string;label:string}>();
    for(const server of snapshot.servers)if(Array.isArray(server.ping))for(const value of server.ping){
      if(value&&typeof value==='object'&&typeof value.key==='string'&&typeof value.label==='string')targets.set(value.key,{key:value.key,label:value.label});
    }
    const pingTargets=baseUrl===current.baseUrl?current.pingTargets:Object.fromEntries([...targets.values()].slice(0,8).map((target,index)=>[PING_SLOTS[index],target]));
    const review:SourceReview={id:crypto.randomUUID(),expires:Date.now()+15*60_000,expectedVersion:version,settings:{baseUrl,token,bindings:[],pingTargets},candidates,previous,targets:[...targets.values()]};
    await this.store.command({type:'source-review',sessionId,review});
    const visiblePrevious=previous.map(binding=>({...binding,match:snapshot.showName?binding.match:Object.fromEntries(Object.entries(binding.match).filter(([key])=>key!=='name'))}));
    return {reviewId:review.id,expires:review.expires,baseUrl,candidates:candidates.map(item=>({...item,suggestedId:item.suggestedId||(!previous.length?item.newId:'')})),previous:visiblePrevious,targets:review.targets,pingTargets};
  }
  async save(body:Record<string,unknown>,sessionId:string){
    const state=await this.store.state(),review=state.sessions[sessionId]?.sourceReview;
    if(!review||body.reviewId!==review.id||review.expires<=Date.now()||review.expectedVersion!==(state.source?.version??0))throw new BridgeError('SOURCE_CONFLICT',409,'连接检查已失效，请重新检查。');
    if(body.confirmed!==true||!Array.isArray(body.assignments)||body.assignments.length!==review.candidates.length||!Array.isArray(body.pingKeys)||body.pingKeys.length!==PING_SLOTS.length)throw new BridgeError('SOURCE_REVIEW_REQUIRED',400,'请核对全部节点身份和 Ping 目标后确认保存。');
    const bindings=review.candidates.map((item,index)=>{
      const id=(body.assignments as unknown[])[index];
      if(typeof id!=='string'||(id!==item.newId&&!review.previous.some(old=>old.id===id)))throw new BridgeError('SOURCE_IDENTITY',400,'请为每台节点选择已有身份或新建身份。');
      return {id,match:item.match};
    });
    const pingTargets:Config['pingTargets']={};
    for(const [index,key]of body.pingKeys.entries()){
      if(key==='')continue;
      const target=review.targets.find(item=>item.key===key);
      if(!target)throw new BridgeError('SOURCE_PING',400,'请选择检查结果中的 Ping 目标。');
      pingTargets[PING_SLOTS[index]!]=target;
    }
    const settings={...review.settings,bindings,pingTargets};
    const config=sourceConfig(this.initial,settings);
    // Re-read before publishing. A changed/hidden/reordered node must still match one-to-one.
    const snapshot=await this.probe(config);
    if(!snapshot.enabled)throw new BridgeError('PROBE_DISABLED',503,'上游未开放探针展示。');
    if(!snapshot.showName)snapshot.servers=snapshot.servers.map(({name,...publicFields})=>publicFields);
    resolveBindings(snapshot,bindings);
    await this.store.command({type:'source',sessionId,reviewId:review.id,expectedVersion:review.expectedVersion,settings});
    return {ok:true,version:review.expectedVersion+1};
  }
}
