import {readFile,writeFile} from 'node:fs/promises';
import {basename,resolve} from 'node:path';
import sharp from 'sharp';
import {recognizeProducts,DEFAULT_GEMINI_MODEL} from '../src/lib/integrations/gemini';
import {IntegrationError} from '../src/lib/integrations/http';
import {validateRecognitionImage} from '../src/lib/server/recognition-image';
import {z} from 'zod';
import {scanProduct} from '../src/lib/server/scan';

async function main(){
  if(process.env.NODE_ENV==='production')throw new Error('Development script only');
  const args=process.argv.slice(2);
  const file=args[0];
  if(!file)throw new Error('Usage: npm run gemini:image -- image-path [--model model] [--output report.json]');
  const modelIndex=args.indexOf('--model'),outputIndex=args.indexOf('--output');
  const model=modelIndex>=0?args[modelIndex+1]:process.env.GEMINI_MODEL??DEFAULT_GEMINI_MODEL;
  const started=performance.now();
  const original=await readFile(resolve(file));
  const originalMetadata=await sharp(original,{limitInputPixels:60_000_000}).metadata();
  const optimized=await sharp(original,{failOn:'error',limitInputPixels:60_000_000}).rotate().resize({width:1600,height:1600,fit:'inside',withoutEnlargement:true}).flatten({background:'#fff'}).jpeg({quality:82}).toBuffer();
  const input={imageBase64:optimized.toString('base64'),mimeType:'image/jpeg'};
  const metadata=await validateRecognitionImage(input.imageBase64,input.mimeType);
  const imageResizeMs=Math.round(performance.now()-started);
  let timing:{geminiRequestMs:number|null;geminiParseMs:number|null}={geminiRequestMs:null,geminiParseMs:null};
  let recognition:unknown=null,normalized:unknown=null,error:unknown=null;
  const requestStarted=performance.now();
  try{
    const result=await recognizeProducts(input,{model,onTiming:value=>{timing=value;},fetcher:async(url,init)=>{
      const response=await fetch(url,init);
      if(response.status===429){
        const quotaSchema=z.object({error:z.object({details:z.array(z.object({retryDelay:z.string().optional(),violations:z.array(z.object({quotaMetric:z.string().optional(),quotaValue:z.string().optional()})).optional()})).optional()})});
        const diagnostic=quotaSchema.safeParse(await response.clone().json().catch(()=>null));
        if(diagnostic.success)console.info(JSON.stringify({quota:diagnostic.data.error.details}));
      }
      return response;
    }});
    recognition=result;
    normalized=await scanProduct(input,{recognize:async()=>result,lookup:async()=>[],catalogKey:undefined},{skipCatalog:true});
  }catch(cause){
    error=cause instanceof IntegrationError?{code:cause.code,httpStatus:cause.status??null}:{code:'invalid-input-or-response'};
    process.exitCode=1;
  }
  const report={image:basename(file),model,original:{bytes:original.length,width:originalMetadata.width,height:originalMetadata.height,format:originalMetadata.format},optimized:metadata,timing:{imageResizeMs,...timing,requestAttemptMs:Math.round(performance.now()-requestStarted),totalRecognitionMs:Math.round(performance.now()-started)},recognition,normalized,error};
  console.info(JSON.stringify(report,null,2));
  if(outputIndex>=0 && args[outputIndex+1])await writeFile(resolve(args[outputIndex+1]),JSON.stringify(report,null,2)+'\n');
}
main().catch(()=>{console.error('Could not read or decode the input image. Check the path and format.');process.exitCode=1;});
