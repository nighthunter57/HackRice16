export type PreparedBrowserImage={imageBase64:string;mimeType:'image/jpeg';width:number;height:number;originalBytes:number;optimizedBytes:number;imageResizeMs:number};

/** One browser-side resize/compress pass. Called only from a user file event. */
export async function prepareBrowserImage(file:File):Promise<PreparedBrowserImage>{
  const started=performance.now();
  const source=URL.createObjectURL(file);
  let image:HTMLImageElement;
  try {
    image=await new Promise<HTMLImageElement>((resolve,reject)=>{const element=new Image();element.onload=()=>resolve(element);element.onerror=()=>reject(new Error('Could not decode the image.'));element.src=source;});
  } finally {URL.revokeObjectURL(source);}
  const scale=Math.min(1,1600/Math.max(image.naturalWidth,image.naturalHeight));
  const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
  const context=canvas.getContext('2d');
  if(!context)throw new Error('Image preparation is unavailable.');
  context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);
  context.drawImage(image,0,0,canvas.width,canvas.height);
  const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('Could not encode the image.')),'image/jpeg',0.82));
  const encoded=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]??'');reader.onerror=()=>reject(new Error('Could not encode the image.'));reader.readAsDataURL(blob);});
  return {imageBase64:encoded,mimeType:'image/jpeg',width:canvas.width,height:canvas.height,originalBytes:file.size,optimizedBytes:blob.size,imageResizeMs:Math.round(performance.now()-started)};
}
