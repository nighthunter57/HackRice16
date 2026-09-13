/** Detect the actual encoded format, including PNGs returned by the web picker. */
export function prepareScanImage(base64: string) {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  if(!base64 || base64.length%4!==0 || base64.length/4*3-padding>4*1024*1024 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) throw new Error('INVALID_IMAGE');
  const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const bytes:number[]=[];
  for(let i=0;i<16 && i+3<base64.length;i+=4) {
    const bits=(alphabet.indexOf(base64[i])<<18)|(alphabet.indexOf(base64[i+1])<<12)|(alphabet.indexOf(base64[i+2])<<6)|alphabet.indexOf(base64[i+3]);
    bytes.push((bits>>16)&255,(bits>>8)&255,bits&255);
  }
  const mimeType:'image/jpeg'|'image/png'|'image/webp'|null = base64.startsWith('/9j/') ? 'image/jpeg' : base64.startsWith('iVBORw0KGgo') ? 'image/png' : String.fromCharCode(...bytes.slice(0,4))==='RIFF' && String.fromCharCode(...bytes.slice(8,12))==='WEBP' ? 'image/webp' : null;
  if(!mimeType) throw new Error('UNSUPPORTED_IMAGE');
  return {imageBase64:base64,mimeType};
}

export function imageByteLength(base64:string){return base64.length/4*3-(base64.endsWith('==')?2:base64.endsWith('=')?1:0);}
