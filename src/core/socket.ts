export interface Socket {
  send(data:string):void;
  close(code?:number,reason?:string):void;
  onMessage(callback:(data:string)=>void):void;
  onClose(callback:()=>void):void;
  onError(callback:()=>void):void;
}
export type Connect = () => Promise<Socket>;
