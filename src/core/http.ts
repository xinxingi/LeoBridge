import { safeError } from './errors.ts';
export function json(data:unknown,status=200) {return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});}
export function errorResponse(error:unknown) {const safe=safeError(error);return json({error:safe.message,message:safe.message,code:safe.code},safe.status);}
