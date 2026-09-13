/** A configured deployment wins; local development follows the device's current host. */
export function resolveBackendUrl(input:{configured?:string;expoHost?:string;platform:string;webHostname?:string}){
  const configured=input.configured?.trim();
  if(configured)return configured.replace(/\/$/,'');
  // Keep browser auth cookies same-site, even when Expo advertises a LAN address.
  if(input.platform==='web' && input.webHostname)return `http://${input.webHostname}:3000`;
  if(input.expoHost){
    try{return `http://${new URL(`http://${input.expoHost}`).hostname}:3000`;}catch{/* Use the simulator fallback when Expo has no usable host. */}
  }
  return input.platform==='android'?'http://10.0.2.2:3000':'http://127.0.0.1:3000';
}
