import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Linking,
  Platform,
  Text,
  View,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import {
  Button,
  Card,
  colors,
  Icon,
  Note,
  PurchaseForm,
  Screen,
  s,
} from "../../components/ui";
import { money } from "../../lib/model";
import { selectedScanState, mergeCatalogMatches, type ScanResult } from "../../../src/types/scan";
import { useAuth } from '../../../src/lib/auth/auth-context';
import { useApp } from "../../lib/store";
import { requestRecognition, requestBarcodeLookup, ScanRequestError } from '../../lib/recognition';
import { imageByteLength } from '../../../src/types/scan-image';
import { apiUrl } from '../../lib/endpoint';
export default function Scan() {
  const { loading } = useApp();
  const {apiFetch}=useAuth();
  const [matches, setMatches] = useState<ScanResult | null>(null);
  const [scanState, setScanState] = useState("");
  const [progressMessage,setProgressMessage]=useState('');
  const [image, setImage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [catalogBusy,setCatalogBusy]=useState(false);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [denied, setDenied] = useState(false);
  const [product, setProduct] = useState<{
    name: string;
    price: string;
    category: string;
    confidence: number;
  } | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function select(camera: boolean) {
    if(busy) return;
    setBusy(true);
    setProgressMessage('Preparing photo…');
    setError("");
    setDenied(false);
    try {
      if (camera) {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          setDenied(true);
          setError(
            "Camera access is off. Choose a photo or enter the item below.",
          );
          return;
        }
      }
      const options: ImagePicker.ImagePickerOptions = {
        mediaTypes: ["images"],
        base64: false,
        quality: 1,
        allowsEditing: false,
      };
      const result = camera
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);
      if (result.canceled) return;
      const asset = result.assets[0];
      const captureStarted=Date.now();
      const resizeStarted=captureStarted;
      const longEdge=Math.max(asset.width??0,asset.height??0);
      const context=ImageManipulator.ImageManipulator.manipulate(asset.uri);
      if(longEdge>1600) context.resize(asset.width>=asset.height?{width:1600}:{height:1600});
      const rendered=await context.renderAsync();
      const resized=await rendered.saveAsync({compress:0.82,format:ImageManipulator.SaveFormat.JPEG,base64:true});
      rendered.release();
      context.release();
      const imageMs=Date.now()-resizeStarted;
      const base64=resized.base64;
      console.info('[recognition.mobile]',{stage:'image-ready',sourceType:camera?'camera':'library',originalBytes:asset.fileSize??null,imageMimeType:'image/jpeg',imageByteLength:base64?imageByteLength(base64):0,imageWidth:resized.width,imageHeight:resized.height,imageResizeMs:imageMs,captureToReadyMs:Date.now()-captureStarted});
      setImage(resized.uri);
      setImageBase64(null);
      setScanState("");
      setProduct(null);
      setMatches(null);
      if (!base64 || base64.length > 5_600_000) {
        setError(
          "Choose a smaller image (under 4 MB), or enter the details below.",
        );
        return;
      }
      setImageBase64(base64);
      await recognize(base64,{width:resized.width,height:resized.height,imageResizeMs:imageMs,captureToReadyMs:Date.now()-captureStarted,startedAt:captureStarted});
    } catch {
      setError('The photo could not be prepared. Choose another photo or enter the item manually.');
    } finally {setBusy(false);setProgressMessage('');}
  }
  async function recognize(base64: string,metadata?:{width:number;height:number;imageResizeMs:number;captureToReadyMs:number;startedAt:number}) {
    setError('');
    setScanState('');
    setProgressMessage('Analyzing photo…');
    setMatches(null);
    setProduct(null);
    try {
      setBusy(true);
      const abort = new AbortController();
      controller.current = abort;
      const timeout = setTimeout(() => abort.abort(), 45_000);
      const progress=['Analyzing photo…','Looking for product details…','Identifying likely matches…'];
      let progressIndex=0;
      const progressTimer=setInterval(()=>{progressIndex=Math.min(progressIndex+1,progress.length-1);setProgressMessage(progress[progressIndex]);},1800);
      try {
        const uploadStarted=Date.now();
        const parsed = await requestRecognition(base64,apiUrl,'',abort.signal,apiFetch);
        console.info('[recognition.mobile]',{stage:'complete',backend:parsed.timings,uploadMs:Date.now()-uploadStarted,totalRecognitionMs:metadata?.startedAt?Date.now()-metadata.startedAt:Date.now()-uploadStarted});
        setMatches(parsed);
        setScanState(parsed.status);
      } finally {
        clearTimeout(timeout);
        clearInterval(progressTimer);
      }
    } catch (cause) {
      if(cause instanceof ScanRequestError) {
        setScanState(cause.status);
        console.info('[recognition.mobile]',{status:cause.status,code:cause.code,requestId:cause.requestId});
        setError(
          cause.code === 'GEMINI_TIMEOUT' || cause.code === 'TIMEOUT'
            ? 'Scanning took too long. Please try again, or enter the product and price below.'
            : cause.message,
        );
      } else setError('The photo could not be prepared. Choose another photo or enter the item manually.');
    } finally {
      setBusy(false);
      setProgressMessage('');
    }
  }
  return (
    <Screen>
      <Text style={s.title}>Found something{"\n"}you love?</Text>
      <Text style={s.body}>
        Scan a product or price tag.
      </Text>
      {image ? (
        <Image
          source={{ uri: image }}
          accessibilityLabel="Selected product photo"
          alt="Selected product photo"
          style={{ width: "100%", height: 220, borderRadius: 24 }}
          resizeMode="contain"
        />
      ) : (
        <View
          style={{
            height: 210,
            borderRadius: 28,
            backgroundColor: colors.soft,
            alignItems: "center",
            justifyContent: "center",
            gap: 18,
          }}
        >
          <View
            style={{
              width: 100,
              height: 90,
              borderWidth: 2,
              borderStyle: "dashed",
              borderColor: colors.green,
              borderRadius: 20,
              justifyContent: "center",
              alignItems: "center",
            }}
          >
            <Icon name="camera" size={38} />
          </View>
          <Text style={s.label}>The next step starts with a photo</Text>
        </View>
      )}
      <Button
        title={image ? "Retake Photo" : "Take Photo"}
        icon="camera"
        disabled={busy}
        onPress={() => void select(true)}
      />
      <Button
        title="Choose From Library"
        icon="image"
        secondary
        disabled={busy}
        onPress={() => void select(false)}
      />
      {busy && (
        <Card>
          <View style={s.row}>
            <ActivityIndicator color={colors.green} />
            <Text accessibilityLiveRegion="polite" style={s.heading}>
              {progressMessage||'Analyzing your photo…'}
            </Text>
          </View>
        </Card>
      )}
      {error ? <Note>{error}</Note> : null}
      {Boolean(error) && imageBase64 && !denied && <Button title="Try scanning again" secondary disabled={busy} onPress={() => void recognize(imageBase64)} />}
      {denied && Platform.OS !== "web" && (
        <Button
          title="Open camera settings"
          secondary
          onPress={() =>
            void Linking.openSettings().catch(() =>
              setError("Open your phone settings to allow camera access."),
            )
          }
        />
      )}
      {matches && !product && !busy && matches.candidates.length > 0 && (
        <View style={{ gap: 16 }}>
          <Text style={s.heading}>{matches.status==='FULL_SUCCESS'?'Found it':matches.status==='PRODUCT_ONLY'?'Product found':'Possible matches'}</Text>
          <Text style={s.body}>{matches.status === 'PRODUCT_ONLY' ? 'Select the item and enter its price.' : matches.status === 'MULTIPLE_CANDIDATES' ? (matches.detectedProducts.length>1?'Which item do you want to check?':'Choose the most likely match, then confirm its price.') : 'Confirm the item and price to continue.'}</Text>
          {matches.candidates.map((item, index) => (
            <Card key={`${item.productName}-${index}`}>
              {item.imageUrl && <Image source={{ uri: item.imageUrl }} alt={item.productName} style={{ width: '100%', height: 140 }} resizeMode="contain" />}
              <Text style={s.heading}>{item.productName}</Text>
              <Text style={s.body}>{item.priceCents !== null ? money(item.priceCents) : item.priceRange ? `${money(item.priceRange.minCents)} – ${money(item.priceRange.maxCents)}` : 'Price not visible — enter it after selecting'}</Text>
              {item.priceSource==='catalog' && <Text style={s.label}>Listed price</Text>}
              <Button title="Select" onPress={() => {
                setProduct({ name: item.productName, price: item.priceCents === null ? '' : (item.priceCents / 100).toFixed(2), category: item.category, confidence: item.confidence });
                setScanState(selectedScanState(item, false));
              }} />
            </Card>
          ))}
          <Button title="None of these" secondary onPress={() => { setMatches(null); setProduct(null); setScanState('NO_MATCH'); }} />
        </View>
      )}
      {matches?.warnings.map(warning => <Note key={warning}>{warning}</Note>)}
      {matches && Boolean(matches.barcode) && /^(?:\d{8}|\d{12,14})$/.test(matches.barcode??'') && !product && !busy && <Button title={catalogBusy?'Finding product details…':'Find product details'} secondary disabled={catalogBusy} onPress={()=>{
        const snapshot=matches;setCatalogBusy(true);
        void requestBarcodeLookup(matches.barcode??'',apiUrl,apiFetch).then(result=>{
          setMatches(current=>current!==snapshot?current:mergeCatalogMatches(current,result.candidates,result.message));
        }).catch(()=>setMatches(current=>current!==snapshot?current:{...current,warnings:['No listed price found. Enter the price to continue.']})).finally(()=>setCatalogBusy(false));
      }}/>}
      {!busy && (product || !matches || matches.candidates.length === 0) && (
        <Card>
          <Text style={s.heading}>{product ? 'Confirm your item and price' : 'Enter your item'}</Text>
          {(scanState === 'PRODUCT_FOUND_PRICE_MISSING' || scanState === 'PRODUCT_ONLY') && <Text style={s.body}>Product found. Enter the price you expect to pay, including any tax and shipping.</Text>}
          {scanState === 'NO_MATCH' && <Text style={s.body}>No clear match yet. Try another photo or enter the details here.</Text>}
          <PurchaseForm key={`${image}-${product?.name}-${product?.price}`}
            initialName={product?.name ?? ''} initialPrice={product?.price ?? ''}
            category={product?.category} onConfirmed={() => setScanState('FULL_SUCCESS')} title="Check Purchase" />
          {product && <Button title="Choose another match" secondary disabled={loading} onPress={() => setProduct(null)} />}
        </Card>
      )}
    </Screen>
  );
}
