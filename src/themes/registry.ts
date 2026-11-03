/** Discovery, installation and verified compatibility are deliberately separate. */
export type Ecosystem='cfsm'|'komari';
export interface ThemeRecord {
  id:string;ecosystem:Ecosystem;source:string;upstreamVersion:string;
  license:string;entry:string;assetDirectory:string;protocolProfile:string;
  discoverable:boolean;installed:boolean;compatibility:'unverified'|'verified'|'incompatible';
}
export const bundledTheme:Readonly<ThemeRecord>=Object.freeze({
  id:'cfsm-default',ecosystem:'cfsm',source:'https://github.com/huilang-me/CF-Server-Monitor',
  upstreamVersion:'609cc0b0998793510453be8eadced2064b28ad7d',license:'MIT',entry:'/index.html',
  assetDirectory:'dist/public',protocolProfile:'cfsm-609cc0b',discoverable:true,installed:true,compatibility:'verified',
});
export function selectTheme(id='cfsm-default'):Readonly<ThemeRecord> {
  if(id!==bundledTheme.id)throw new Error('Theme not installed; this stage only packages the CFSM default frontend.');
  return bundledTheme;
}
