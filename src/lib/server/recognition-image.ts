import sharp from 'sharp';
import {prepareScanImage} from '@/types/scan-image';
/** Signature checks alone accept truncated files. Decode before calling Gemini. */
export async function validateRecognitionImage(base64:string,mimeType:string){
  const input=prepareScanImage(base64);
  if(input.mimeType!==mimeType)throw new Error('INVALID_IMAGE');
  const bytes=Buffer.from(input.imageBase64,'base64');
  const image=sharp(bytes,{failOn:'error',limitInputPixels:40_000_000});
  const metadata=await image.metadata();
  if(!metadata.width || !metadata.height || (metadata.pages??1)>1)throw new Error('INVALID_IMAGE');
  await image.stats();
  return {imageByteLength:bytes.length,imageWidth:metadata.width,imageHeight:metadata.height,imageMimeType:input.mimeType};
}
