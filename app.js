(() => {
'use strict';

const DATASET='projects/gcp-public-data-weathernext/assets/weathernext_3_0_0_0p1deg';
const CONFIG_KEY='wn3ExplorerConfigV1';
const LIX_CENTER={lat:30.25,lng:-90.2};
const LIX_ZOOM=7;
const MAX_LAYER_CACHE=20;
const MAX_TREND_RUNS=16;
const RUN_HOURS_CACHE_MS=120000;

const palettes={
  temp:['#4b0082','#3521b5','#2456d4','#1f8be0','#37b8df','#70d4c3','#a8df91','#e5e873','#ffd34e','#ffab43','#f47a3e','#e54735','#b5152c'],
  dewpoint:['#5b3a29','#876044','#b58b58','#d9bd74','#e8df9c','#b8dc87','#7bcf79','#43b870','#1f9c70','#187e7e','#17649a','#3f4f9c','#633c91'],
  wind:['#e8f5ff','#c9e9fa','#9ed7f5','#70c2e8','#44add7','#2795c4','#17759e','#9ac45a','#e4d64a','#f5a142','#e65c3a','#c5283d'],
  precip:['#d8f0d1','#9cda8b','#54c46a','#1e9c50','#f0e442','#f6ba45','#f28f3b','#e65c3a','#c5283d','#8b1a8c'],
  mslp:['#54278f','#756bb1','#9e9ac8','#bcbddc','#d9d9d9','#f0f0c8','#f3d079','#eba45a','#df7649','#ca4d4d','#9e2f45'],
  qpfprob:['#607080','#62a5cf','#55c4b0','#d6d65c','#f2a444','#d94c43'],
  spread:['#f7fbff','#deebf7','#c6dbef','#9ecae1','#6baed6','#4292c6','#2171b5','#08519c','#08306b'],
  difference:['#5b2a86','#3f51b5','#2879c7','#55a8d3','#a6cee3','#f7f7f7','#f6c49a','#ef8a62','#d95f4f','#b63a45','#7f1d35'],
  rawprob:['#16334a','#2f80b9','#48b7a0','#d6d65c','#f2a444','#d94c43']
};

const PROBABILITY_LABELS=['<10%','10–25%','25–50%','50–75%','75–90%','>90%'];
const QPF_THRESHOLDS=[0.001,0.01,0.10,0.25,0.50,1.00,1.50,2.00,3.00,5.00];
const QPF_LABELS=['Trace–0.01','0.01–0.10','0.10–0.25','0.25–0.50','0.50–1.00','1.00–1.50','1.50–2.00','2.00–3.00','3.00–5.00','5.00+'];
const WIND_THRESHOLDS=[0,5,10,15,20,25,30,35,40,50,64,80];
const WIND_LABELS=['0–5','5–10','10–15','15–20','20–25','25–30','30–35','35–40','40–50','50–64','64–80','80+'];
const SPREAD_MAX={temp:30,dewpoint:30,wind:40,mslp:20};
const DIFF_RANGE={temp:20,dewpoint:20,wind:30,precip:5,mslp:30};
const RAW_PROB_THRESHOLDS=[0,10,25,50,75,90,100.01];
const RAW_PROB_LABELS=['0–10%','10–25%','25–50%','50–75%','75–90%','90–100%'];
const MAX_RAW_RESPONSE_CACHE=12;
const RAW_REQUEST_TIMEOUT_MS=180000;

const PRODUCTS={
  temp:{title:'2-m Temperature',unit:'°F',band:'temperature_2m',min:0,max:110,transform:i=>i.subtract(273.15).multiply(9/5).add(32)},
  dewpoint:{title:'2-m Dewpoint',unit:'°F',band:'dewpoint_temperature_2m',min:-10,max:85,transform:i=>i.subtract(273.15).multiply(9/5).add(32)},
  wind:{title:'10-m Wind Speed',unit:'kt',band:'wind_speed_10m',min:0,max:80,transform:i=>i.multiply(1.943844)},
  precip:{title:'QPF',unit:'in',band:'total_precipitation_1hr',min:0,max:5,transform:i=>i.multiply(39.3700787)},
  mslp:{title:'Mean Sea-Level Pressure',unit:'hPa',band:'mean_sea_level_pressure',min:940,max:1040,transform:i=>i.divide(100)},
  qpfprob:{title:'1-h QPF Exceedance Probability Range',unit:'%',min:0,max:5},
  h500:{title:'500-mb Height',unit:'dam',raw:true},
  rawqpf:{title:'Raw-member QPF',unit:'%',raw:true}
};

let cfg=null,map=null,overlay=null,currentProduct='temp',currentImage=null,currentLayerMeta=null,accumHours=1,connected=false;
let availableRuns=[],availableForecastHours=[],availableForecastHourSet=new Set();
let renderSeq=0,forecastHourSeq=0,sampleSeq=0,analysisSeq=0;
let selectedPoint=null,pointMarker=null,analysisChart=null;
let rawIdToken=null,rawIdentityEmail='',rawIdentityInitialized=false,rawAbortController=null;
let rawDataLayer=null,rawGroundOverlay=null,currentRawGrid=null;
const runHoursCache=new Map();
const layerCache=new Map();
const rawResponseCache=new Map();

const $=id=>document.getElementById(id);
const els={
  authBadge:$('authBadge'),settingsBtn:$('settingsBtn'),setupDialog:$('setupDialog'),setupForm:$('setupForm'),
  projectId:$('projectId'),clientId:$('clientId'),mapsKey:$('mapsKey'),backendUrl:$('backendUrl'),clearConfigBtn:$('clearConfigBtn'),
  runSelect:$('runSelect'),fhRange:$('fhRange'),fhNumber:$('fhNumber'),validTime:$('validTime'),statSelect:$('statSelect'),
  compareToggle:$('compareToggle'),compareControls:$('compareControls'),compareRun:$('compareRun'),compareMode:$('compareMode'),compareHint:$('compareHint'),
  rawControls:$('rawControls'),rawAuthStatus:$('rawAuthStatus'),rawSignInButton:$('rawSignInButton'),rawQpfControls:$('rawQpfControls'),
  rawQpfMode:$('rawQpfMode'),rawAccum:$('rawAccum'),rawThresholdRow:$('rawThresholdRow'),rawThreshold:$('rawThreshold'),
  refreshBtn:$('refreshBtn'),homeBtn:$('homeBtn'),precipControls:$('precipControls'),probControls:$('probControls'),
  qpfThreshold:$('qpfThreshold'),opacityRange:$('opacityRange'),loading:$('loading'),message:$('message'),
  messageSetupBtn:$('messageSetupBtn'),layerStatus:$('layerStatus'),
  legend:$('legend'),legendTitle:$('legendTitle'),legendGradient:$('legendGradient'),legendDiscrete:$('legendDiscrete'),
  legendLabels:$('legendLabels'),legendMin:$('legendMin'),legendMid:$('legendMid'),legendMax:$('legendMax'),legendNote:$('legendNote'),
  pointReadout:$('pointReadout'),readoutClose:$('readoutClose'),readoutLocation:$('readoutLocation'),
  readoutValue:$('readoutValue'),readoutMeta:$('readoutMeta'),meteogramBtn:$('meteogramBtn'),trendBtn:$('trendBtn'),
  analysisPanel:$('analysisPanel'),analysisClose:$('analysisClose'),analysisTitle:$('analysisTitle'),analysisMeta:$('analysisMeta'),
  analysisLoading:$('analysisLoading'),analysisError:$('analysisError'),analysisCanvas:$('analysisChart')
};

function getSavedConfig(){try{return JSON.parse(localStorage.getItem(CONFIG_KEY)||'null')}catch{return null}}
function saveConfig(){
  cfg={projectId:els.projectId.value.trim(),clientId:els.clientId.value.trim(),mapsKey:els.mapsKey.value.trim(),backendUrl:els.backendUrl.value.trim().replace(/\/+$/,'')};
  localStorage.setItem(CONFIG_KEY,JSON.stringify(cfg));
}
function fillConfig(){
  const s=getSavedConfig()||{};
  els.projectId.value=s.projectId||'';els.clientId.value=s.clientId||'';els.mapsKey.value=s.mapsKey||'';els.backendUrl.value=s.backendUrl||'';
}
function setLoading(on,text='Building WeatherNext layer…'){els.loading.classList.toggle('hidden',!on);els.loading.querySelector('span').textContent=text}
function showMessage(title,body,showSetup=true){
  els.message.innerHTML='<b>'+title+'</b><span>'+body+'</span>'+(showSetup?'<button id="dynamicSetup" class="primary-btn">Open setup</button>':'');
  els.message.classList.remove('hidden');const b=$('dynamicSetup');if(b)b.onclick=openSetup;
}
function hideMessage(){els.message.classList.add('hidden')}
function openSetup(){fillConfig();if(!els.setupDialog.open)els.setupDialog.showModal()}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function errorText(err,fallback='Unknown error'){return (err&&err.message)||String(err||fallback)}
function formatForecastHour(fh){return 'F'+String(fh).padStart(3,'0')}
function formatRun(iso){const d=new Date(iso);if(Number.isNaN(+d))return iso;return d.toISOString().slice(0,10)+' '+String(d.getUTCHours()).padStart(2,'0')+'Z'}
function formatValid(d){const x=d instanceof Date?d:new Date(d);return Number.isNaN(+x)?'—':x.toISOString().replace('T',' ').slice(0,16)+'Z'}
function shortUtc(iso){const d=new Date(iso);return Number.isNaN(+d)?String(iso):d.toISOString().slice(5,10).replace('-','/')+' '+String(d.getUTCHours()).padStart(2,'0')+'Z'}
function accumButtons(){return Array.from(document.querySelectorAll('#accumGroup button'))}
function isSpreadStat(stat){return stat==='spread_iqr'||stat==='spread_p80'}
function spreadLabel(stat){return stat==='spread_iqr'?'P75–P25 percentile spread':'P90–P10 percentile spread'}
function supportsSpread(product){return ['temp','dewpoint','wind','mslp'].includes(product)}
function isRawProduct(product){return !!PRODUCTS[product]?.raw}
function canCompare(product){return !['qpfprob','h500','rawqpf'].includes(product)}
function canMeteogram(meta){return meta&&['temp','dewpoint','wind','mslp','precip'].includes(meta.product)&&!meta.comparison&&!meta.raw}
function canTrend(meta){return meta&&['temp','dewpoint','wind','mslp','precip'].includes(meta.product)&&!meta.comparison&&!meta.raw}
function convertRaw(product,v){
  if(v==null||!Number.isFinite(Number(v)))return null;
  const n=Number(v);
  if(product==='temp'||product==='dewpoint')return (n-273.15)*9/5+32;
  if(product==='wind')return n*1.943844;
  if(product==='precip')return n*39.3700787;
  if(product==='mslp')return n/100;
  return n;
}
function evaluatePromise(obj){return new Promise((resolve,reject)=>obj.evaluate((value,err)=>err?reject(err):resolve(value)))}


function decodeJwtPayload(token){
  try{
    const part=token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');
    return JSON.parse(decodeURIComponent(atob(part).split('').map(c=>'%'+('00'+c.charCodeAt(0).toString(16)).slice(-2)).join('')));
  }catch{return null}
}
function rawTokenValid(){
  if(!rawIdToken)return false;
  const p=decodeJwtPayload(rawIdToken);
  return !!p?.exp&&p.exp*1000>Date.now()+60000;
}
function prepareRawIdentity(){
  if(!els.rawSignInButton)return;
  cfg=getSavedConfig()||cfg||{};
  if(!cfg?.backendUrl){
    els.rawAuthStatus.textContent='Backend URL not configured in Setup.';
    els.rawSignInButton.innerHTML='';
    return;
  }
  if(rawTokenValid()){
    els.rawAuthStatus.textContent='Raw backend signed in'+(rawIdentityEmail?' as '+rawIdentityEmail:'')+'.';
    els.rawSignInButton.innerHTML='';
    return;
  }
  rawIdToken=null;rawIdentityEmail='';
  if(!window.google?.accounts?.id){
    els.rawAuthStatus.textContent='Google backend sign-in is loading…';
    return;
  }
  if(!rawIdentityInitialized){
    google.accounts.id.initialize({
      client_id:cfg.clientId,
      callback:response=>{
        rawIdToken=response.credential||null;
        const p=decodeJwtPayload(rawIdToken||'');
        rawIdentityEmail=p?.email||'';
        prepareRawIdentity();
        if(isRawProduct(currentProduct))renderLayer();
      },
      auto_select:false,
      cancel_on_tap_outside:true
    });
    rawIdentityInitialized=true;
  }
  els.rawAuthStatus.textContent='Google sign-in is required for raw full-ensemble products.';
  els.rawSignInButton.innerHTML='';
  google.accounts.id.renderButton(els.rawSignInButton,{theme:'filled_black',size:'medium',shape:'pill',text:'signin_with'});
}
function rawCacheGet(key){
  const v=rawResponseCache.get(key);
  if(v){rawResponseCache.delete(key);rawResponseCache.set(key,v)}
  return v||null;
}
function rawCacheSet(key,value){
  if(rawResponseCache.has(key))rawResponseCache.delete(key);
  rawResponseCache.set(key,value);
  while(rawResponseCache.size>MAX_RAW_RESPONSE_CACHE)rawResponseCache.delete(rawResponseCache.keys().next().value);
}
function rawBbox(){
  const b=map?.getBounds();if(!b)throw new Error('Map bounds are not ready yet.');
  const sw=b.getSouthWest(),ne=b.getNorthEast();
  let west=sw.lng(),east=ne.lng(),south=sw.lat(),north=ne.lat();
  if(east<west)throw new Error('Raw products do not currently support a viewport crossing the dateline.');
  west=Math.floor((west-.25)*4)/4;east=Math.ceil((east+.25)*4)/4;
  south=Math.max(-90,Math.floor((south-.25)*4)/4);north=Math.min(90,Math.ceil((north+.25)*4)/4);
  if(east-west>25||north-south>20)throw new Error('Raw WeatherNext requests are limited to a 25° × 20° regional view. Zoom in, then refresh.');
  return [west,south,east,north];
}
async function fetchRaw(path,params){
  cfg=getSavedConfig()||cfg||{};
  if(!cfg?.backendUrl)throw Object.assign(new Error('Raw backend URL is not configured. Open Setup and add the Cloud Run service URL.'),{code:'backend_not_configured'});
  if(!rawTokenValid())throw Object.assign(new Error('Sign in with Google in the Raw full-ensemble panel first.'),{code:'backend_sign_in_required'});
  const url=new URL(cfg.backendUrl.replace(/\/+$/,'')+path);
  Object.entries(params).forEach(([k,v])=>url.searchParams.set(k,String(v)));
  const key=url.toString();
  const cached=rawCacheGet(key);if(cached)return {...cached,browserCache:'hit'};
  if(rawAbortController)rawAbortController.abort();
  const controller=new AbortController();rawAbortController=controller;
  const timer=setTimeout(()=>controller.abort(),RAW_REQUEST_TIMEOUT_MS);
  try{
    const response=await fetch(url,{headers:{Authorization:'Bearer '+rawIdToken},signal:controller.signal});
    let data=null;try{data=await response.json()}catch{}
    if(!response.ok){
      if(response.status===401){rawIdToken=null;rawIdentityEmail='';prepareRawIdentity()}
      const err=new Error(data?.error?.message||('Raw backend returned HTTP '+response.status));
      err.code=data?.error?.code||('http_'+response.status);throw err;
    }
    rawCacheSet(key,data);return data;
  }catch(err){
    if(err?.name==='AbortError')throw Object.assign(new Error('Raw backend request timed out or was superseded.'),{code:'backend_timeout'});
    throw err;
  }finally{
    clearTimeout(timer);if(rawAbortController===controller)rawAbortController=null;
  }
}
function syncRawControls(){
  const raw=isRawProduct(currentProduct);
  els.rawControls.classList.toggle('hidden',!raw);
  els.rawQpfControls.classList.toggle('hidden',currentProduct!=='rawqpf');
  els.rawThresholdRow.classList.toggle('hidden',currentProduct!=='rawqpf'||els.rawQpfMode.value!=='probability');
  if(raw){
    prepareRawIdentity();
    const fh=getSelectedForecastHour();
    Array.from(els.rawAccum.options).forEach(o=>{
      const h=Number(o.value);o.disabled=fh==null||!isAccumulationAvailable(h,fh);
    });
    if(els.rawAccum.selectedOptions[0]?.disabled){
      const first=Array.from(els.rawAccum.options).find(o=>!o.disabled);if(first)els.rawAccum.value=first.value;
    }
  }
}
function clearRawLayers(){
  if(rawDataLayer){rawDataLayer.setMap(null);rawDataLayer=null}
  if(rawGroundOverlay){rawGroundOverlay.setMap(null);rawGroundOverlay=null}
  currentRawGrid=null;
}
function clearEeOverlay(){
  if(overlay){const idx=map.overlayMapTypes.getArray().indexOf(overlay);if(idx>=0)map.overlayMapTypes.removeAt(idx);overlay=null}
}
function installRawContours(data){
  clearEeOverlay();clearRawLayers();
  rawDataLayer=new google.maps.Data();
  rawDataLayer.addGeoJson({type:'FeatureCollection',features:data.features||[]});
  rawDataLayer.setStyle(feature=>{
    const level=Number(feature.getProperty('height_dam')),major=Math.abs(level%6)<0.01;
    return {strokeColor:major?'#7ee7ff':'#d7f4ff',strokeWeight:major?2.3:1.15,strokeOpacity:major?0.95:0.68,clickable:false};
  });
  rawDataLayer.setMap(map);
}
function colorForRawProbability(v){
  if(v==null||!Number.isFinite(Number(v))||Number(v)<=0)return null;
  const n=Number(v);let idx=0;
  for(let i=1;i<RAW_PROB_THRESHOLDS.length-1;i++)if(n>=RAW_PROB_THRESHOLDS[i])idx=i;
  return palettes.rawprob[Math.min(idx,palettes.rawprob.length-1)];
}
function colorForRawQpf(v){
  if(v==null||!Number.isFinite(Number(v))||Number(v)<QPF_THRESHOLDS[0])return null;
  const n=Number(v);let idx=0;
  for(let i=1;i<QPF_THRESHOLDS.length;i++)if(n>=QPF_THRESHOLDS[i])idx=i;
  return palettes.precip[Math.min(idx,palettes.precip.length-1)];
}
function renderRawGrid(data,mode){
  const lat=data.lat||[],lon=data.lon||[],values=data.values||[];
  if(lat.length<2||lon.length<2||values.length!==lat.length)throw new Error('Raw backend returned an invalid grid.');
  const cell=4,canvas=document.createElement('canvas');canvas.width=lon.length*cell;canvas.height=lat.length*cell;
  const ctx=canvas.getContext('2d');ctx.imageSmoothingEnabled=false;ctx.clearRect(0,0,canvas.width,canvas.height);
  for(let i=0;i<lat.length;i++)for(let j=0;j<lon.length;j++){
    const color=mode==='probability'?colorForRawProbability(values[i]?.[j]):colorForRawQpf(values[i]?.[j]);
    if(!color)continue;ctx.fillStyle=color;ctx.fillRect(j*cell,(lat.length-1-i)*cell,cell,cell);
  }
  const res=Number(data.resolution_deg)||0.1;
  const bounds={north:lat[lat.length-1]+res/2,south:lat[0]-res/2,east:lon[lon.length-1]+res/2,west:lon[0]-res/2};
  clearEeOverlay();clearRawLayers();
  rawGroundOverlay=new google.maps.GroundOverlay(canvas.toDataURL('image/png'),bounds,{opacity:parseFloat(els.opacityRange.value),clickable:false});
  rawGroundOverlay.setMap(map);currentRawGrid=data;
}
function updateRawLegend(meta,data){
  els.legend.classList.remove('hidden');
  if(meta.product==='h500'){
    els.legendTitle.textContent='500-mb Height • ensemble mean';
    els.legendGradient.classList.add('hidden');els.legendDiscrete.classList.add('hidden');els.legendLabels.classList.add('hidden');
    els.legendNote.textContent='3-dam contours • raw 64-member GCS/Zarr • 0.25° (~25 km) pressure-level grid • no artificial high-resolution interpolation';
    return;
  }
  if(meta.rawQpfMode==='probability'){
    setDiscreteLegend(palettes.rawprob,RAW_PROB_LABELS);
    els.legendTitle.textContent='Exact '+meta.rawAccum+'-h QPF probability';
    els.legendNote.textContent='All 64 members • QPF > '+Number(meta.rawThreshold).toFixed(2)+' in • exact member-count values binned only for map coloring';
  }else{
    setDiscreteLegend(palettes.precip,QPF_LABELS);
    els.legendTitle.textContent='True accumulated QPF '+meta.rawQpfMode.toUpperCase();
    els.legendNote.textContent=meta.rawAccum+'-h QPF • accumulate each of 64 members first, then compute '+meta.rawQpfMode.toUpperCase();
  }
}
function updateRawStatus(meta,data){
  const valid=currentValidDate(meta.run,meta.fh);
  if(meta.product==='h500'){
    els.layerStatus.textContent=formatRun(meta.run)+' • '+formatForecastHour(meta.fh)+' • Valid '+formatValid(valid)+' • 500-mb Height • 64-member mean • raw GCS 0.25° • 3-dam contours';
  }else if(meta.rawQpfMode==='probability'){
    els.layerStatus.textContent=formatRun(meta.run)+' • '+formatForecastHour(meta.fh)+' • Valid '+formatValid(valid)+' • '+meta.rawAccum+'-h QPF > '+Number(meta.rawThreshold).toFixed(2)+' in • exact 64-member probability • raw GCS 0.1°';
  }else{
    els.layerStatus.textContent=formatRun(meta.run)+' • '+formatForecastHour(meta.fh)+' • Valid '+formatValid(valid)+' • '+meta.rawAccum+'-h QPF '+meta.rawQpfMode.toUpperCase()+' • true accumulated-member percentile • raw GCS 0.1°';
  }
  els.layerStatus.classList.remove('muted');
}
async function renderRawLayer(requestId,meta){
  if(rawAbortController)rawAbortController.abort();
  syncRawControls();
  if(!cfg?.backendUrl){setLoading(false);showMessage('Raw backend not configured','Open Setup and add the Cloud Run backend URL after Phase 3 deployment.',true);return}
  if(!rawTokenValid()){setLoading(false);showMessage('Raw backend sign-in required','Use the Google sign-in button in the Raw full-ensemble panel, then refresh the layer.',false);return}
  let bbox;
  try{bbox=rawBbox()}catch(err){setLoading(false);showMessage('Raw request region unavailable',escapeHtml(errorText(err)),false);return}
  setLoading(true,meta.product==='h500'?'Loading raw 500-mb ensemble…':'Computing raw 64-member QPF…');
  try{
    let data;
    if(meta.product==='h500'){
      const hour=new Date(meta.run).getUTCHours();
      if(![0,6,12,18].includes(hour))throw Object.assign(new Error('500-mb pressure-level fields are available only on 00/06/12/18 UTC runs.'),{code:'pressure_level_run_unavailable'});
      data=await fetchRaw('/v1/field',{run:meta.run,fh:meta.fh,variable:'geopotential',level:500,bbox:bbox.join(',')});
      if(requestId!==renderSeq)return;
      installRawContours(data);
    }else{
      meta.rawAccum=Number(els.rawAccum.value);meta.rawQpfMode=els.rawQpfMode.value;meta.rawThreshold=Number(els.rawThreshold.value);
      if(!isAccumulationAvailable(meta.rawAccum,meta.fh))throw Object.assign(new Error(meta.rawAccum+'-h raw QPF requires every forecast hour in the accumulation window.'),{code:'accumulation_unavailable'});
      if(meta.rawQpfMode==='probability'){
        data=await fetchRaw('/v1/probability',{run:meta.run,fh:meta.fh,accum_hours:meta.rawAccum,threshold_in:meta.rawThreshold,bbox:bbox.join(',')});
        if(requestId!==renderSeq)return;renderRawGrid(data,'probability');
      }else{
        const pct=Number(meta.rawQpfMode.slice(1));
        data=await fetchRaw('/v1/percentile',{run:meta.run,fh:meta.fh,accum_hours:meta.rawAccum,percentile:pct,bbox:bbox.join(',')});
        if(requestId!==renderSeq)return;renderRawGrid(data,'percentile');
      }
    }
    currentImage=null;currentLayerMeta={...meta,raw:true,rawData:data};hideMessage();setLoading(false);
    updateRawLegend(currentLayerMeta,data);updateRawStatus(currentLayerMeta,data);syncPointActions();
  }catch(err){
    if(requestId!==renderSeq)return;
    setLoading(false);prepareRawIdentity();
    const title=err?.code==='backend_timeout'?'Raw backend timeout':err?.code==='backend_sign_in_required'?'Raw backend sign-in required':'Raw backend unavailable';
    showMessage(title,escapeHtml(errorText(err)),false);
  }
}
function nearestIndex(values,target){
  let best=0,diff=Infinity;for(let i=0;i<values.length;i++){const d=Math.abs(Number(values[i])-target);if(d<diff){best=i;diff=d}}return best;
}
function sampleRawPoint(lat,lng){
  markSelectedPoint(lat,lng);els.pointReadout.classList.remove('hidden');
  els.readoutLocation.textContent=lat.toFixed(3)+', '+lng.toFixed(3);els.meteogramBtn.disabled=true;els.trendBtn.disabled=true;
  const meta=currentLayerMeta;
  if(meta.product==='h500'||!currentRawGrid){
    els.readoutValue.textContent='Contour layer';els.readoutMeta.textContent='500-mb values are rendered as 3-dam contours from the 0.25° raw ensemble mean.';return;
  }
  const i=nearestIndex(currentRawGrid.lat,lat),j=nearestIndex(currentRawGrid.lon,lng),v=currentRawGrid.values?.[i]?.[j];
  if(v==null){els.readoutValue.textContent='No data';els.readoutMeta.textContent='Raw grid cell is unavailable.';return}
  if(meta.rawQpfMode==='probability'){
    els.readoutValue.textContent=Number(v).toFixed(1)+'%';
    els.readoutMeta.textContent=meta.rawAccum+'-h QPF > '+Number(meta.rawThreshold).toFixed(2)+' in • exact 64-member probability';
  }else{
    els.readoutValue.textContent=Number(v).toFixed(2)+' in';
    els.readoutMeta.textContent=meta.rawAccum+'-h QPF '+meta.rawQpfMode.toUpperCase()+' • true accumulated-member percentile';
  }
}

function loadGoogleMaps(key){
  return new Promise((resolve,reject)=>{
    if(window.google?.maps)return resolve();
    window.__wn3MapsReady=resolve;
    const s=document.createElement('script');
    s.src='https://maps.googleapis.com/maps/api/js?key='+encodeURIComponent(key)+'&callback=__wn3MapsReady';
    s.async=true;s.defer=true;s.onerror=()=>reject(new Error('Google Maps failed to load. Check the API key/referrer restriction.'));
    document.head.appendChild(s);
  });
}
function initMap(){
  if(map)return;
  map=new google.maps.Map($('map'),{
    center:LIX_CENTER,zoom:LIX_ZOOM,mapTypeId:'terrain',streetViewControl:false,fullscreenControl:true,mapTypeControl:true,
    mapTypeControlOptions:{position:google.maps.ControlPosition.TOP_RIGHT},gestureHandling:'greedy'
  });
  map.addListener('click',e=>samplePoint(e.latLng.lat(),e.latLng.lng()));
}

function authenticate(){
  cfg=getSavedConfig();
  if(!cfg?.projectId||!cfg?.clientId||!cfg?.mapsKey){openSetup();return}
  setLoading(true,'Connecting to Google Earth Engine…');
  loadGoogleMaps(cfg.mapsKey).then(()=>{
    initMap();
    ee.data.authenticateViaOauth(
      cfg.clientId,
      initializeEE,
      err=>connectionError(err),
      ['https://www.googleapis.com/auth/earthengine.readonly'],
      ()=>{setLoading(false);showMessage('Sign in required','Click Setup → Save & connect, then sign in with the Google account approved for WeatherNext.',true)},
      true
    );
  }).catch(connectionError);
}
function initializeEE(){
  ee.initialize(null,null,()=>{
    connected=true;
    els.authBadge.classList.remove('offline');els.authBadge.classList.add('online');
    els.authBadge.innerHTML='<span></span>WeatherNext connected';
    els.runSelect.disabled=false;els.refreshBtn.disabled=false;
    hideMessage();prepareRawIdentity();loadRuns();
  },connectionError,null,cfg.projectId);
}
function connectionError(err){
  setLoading(false);connected=false;
  els.authBadge.classList.remove('online');els.authBadge.classList.add('offline');
  els.authBadge.innerHTML='<span></span>Not connected';
  const msg=escapeHtml(errorText(err,'Unknown authentication or access error'));
  showMessage('Authentication / access failed',msg+'<br><br>Verify the registered Earth Engine project, OAuth origin, Maps API key restrictions, and that you signed in with the allowlisted WeatherNext account.',true);
}

function baseRunCollection(run=els.runSelect.value){return ee.ImageCollection(DATASET).filter(ee.Filter.eq('start_time',run))}
async function getRunHours(run){
  const cached=runHoursCache.get(run);
  if(cached&&Date.now()-cached.at<RUN_HOURS_CACHE_MS)return cached.hours;
  const hours=await evaluatePromise(ee.List(baseRunCollection(run).aggregate_array('forecast_hour')).distinct().sort());
  const parsed=(hours||[]).map(Number).filter(Number.isFinite).sort((a,b)=>a-b);
  if(!parsed.length)throw new Error('No forecast-hour images are available for '+formatRun(run)+'.');
  runHoursCache.set(run,{hours:parsed,at:Date.now()});
  return parsed;
}
async function loadRuns(){
  setLoading(true,'Finding recent WeatherNext runs…');
  try{
    const runHeads=ee.ImageCollection(DATASET).filter(ee.Filter.eq('forecast_hour',1)).sort('start_time',false).limit(40);
    const runs=await evaluatePromise(ee.List(runHeads.aggregate_array('start_time')).distinct());
    if(!runs?.length)throw new Error('No WeatherNext runs with F001 were returned from Earth Engine.');
    availableRuns=runs;
    els.runSelect.innerHTML='';
    runs.forEach((r,i)=>{const o=document.createElement('option');o.value=r;o.textContent=formatRun(r)+(i===0?'  • latest':'');els.runSelect.appendChild(o)});
    populateCompareRuns();
    await loadForecastHours(true);
  }catch(err){
    setLoading(false);els.runSelect.innerHTML='<option>Run discovery failed</option>';
    showMessage('Run discovery failed',escapeHtml(errorText(err))+'<br><br>Earth Engine connected, but WeatherNext initialization times could not be read.',false);
  }
}
function populateCompareRuns(){
  const primary=els.runSelect.value,previous=els.compareRun.value;
  els.compareRun.innerHTML='';
  availableRuns.forEach(r=>{const o=document.createElement('option');o.value=r;o.textContent=formatRun(r);els.compareRun.appendChild(o)});
  if(previous&&availableRuns.includes(previous)&&previous!==primary)els.compareRun.value=previous;
  else{
    const fallback=availableRuns.find(r=>r!==primary);
    if(fallback)els.compareRun.value=fallback;
  }
  updateCompareHint();
}
async function loadForecastHours(renderWhenReady=false){
  if(!connected)return;
  renderSeq++;
  const run=els.runSelect.value,requestId=++forecastHourSeq;
  availableForecastHours=[];availableForecastHourSet=new Set();
  els.fhRange.disabled=true;els.fhNumber.disabled=true;els.refreshBtn.disabled=true;
  setLoading(true,'Loading available forecast hours…');
  try{
    const parsed=await getRunHours(run);
    if(requestId!==forecastHourSeq||run!==els.runSelect.value)return;
    availableForecastHours=parsed;availableForecastHourSet=new Set(parsed);
    configureForecastControls(Number(els.fhNumber.value)||12);
    els.fhRange.disabled=false;els.fhNumber.disabled=false;els.refreshBtn.disabled=false;
    populateCompareRuns();syncStatControl();syncComparisonControls();hideMessage();setLoading(false);
    if(renderWhenReady)renderLayer();
  }catch(err){
    if(requestId!==forecastHourSeq)return;
    setLoading(false);showMessage('Run unavailable','Could not read forecast hours for '+escapeHtml(formatRun(run))+'.<br><br>'+escapeHtml(errorText(err)),false);
  }
}
function nearestAvailableForecastHour(value){
  if(!availableForecastHours.length)return null;
  const n=Number(value);if(!Number.isFinite(n))return availableForecastHours[0];
  let best=availableForecastHours[0],bestDiff=Math.abs(best-n);
  for(let i=1;i<availableForecastHours.length;i++){
    const fh=availableForecastHours[i],diff=Math.abs(fh-n);
    if(diff<bestDiff){best=fh;bestDiff=diff}
  }
  return best;
}
function getSelectedForecastHour(){
  if(!availableForecastHours.length)return null;
  const idx=Math.max(0,Math.min(Math.round(Number(els.fhRange.value)||0),availableForecastHours.length-1));
  return availableForecastHours[idx];
}
function setForecastHour(fh){
  const target=nearestAvailableForecastHour(fh);if(target==null)return null;
  els.fhRange.value=String(availableForecastHours.indexOf(target));els.fhNumber.value=String(target);
  updateValidTime();updateAccumulationAvailability();updateCompareHint();
  return target;
}
function configureForecastControls(preferredFh){
  els.fhRange.min='0';els.fhRange.max=String(Math.max(0,availableForecastHours.length-1));els.fhRange.step='1';
  els.fhNumber.min=String(availableForecastHours[0]);els.fhNumber.max=String(availableForecastHours[availableForecastHours.length-1]);els.fhNumber.step='1';
  setForecastHour(preferredFh);
}
function currentValidDate(run=els.runSelect.value,fh=getSelectedForecastHour()){
  if(!run||fh==null)return null;
  const d=new Date(run);if(Number.isNaN(+d))return null;
  return new Date(d.getTime()+fh*3600000);
}
function updateValidTime(){
  const valid=currentValidDate(),fh=getSelectedForecastHour();
  els.validTime.textContent=valid&&fh!=null?'Valid '+formatValid(valid)+'  •  '+formatForecastHour(fh):'Valid time —';
}
function isAccumulationAvailableFor(hours,fh,hourSet){
  if(fh==null||hours<1||fh<hours)return false;
  const start=fh-hours+1;
  for(let h=start;h<=fh;h++)if(!hourSet.has(h))return false;
  return true;
}
function isAccumulationAvailable(hours,fh=getSelectedForecastHour()){return isAccumulationAvailableFor(hours,fh,availableForecastHourSet)}
function updateAccumulationAvailability(){
  const fh=getSelectedForecastHour();
  accumButtons().forEach(button=>{
    const hours=Number(button.dataset.hours),ok=isAccumulationAvailable(hours,fh);
    button.disabled=!ok;
    button.title=ok?'':(fh==null?'No forecast hour is selected':hours+'-h QPF requires every hourly forecast from '+formatForecastHour(Math.max(1,(fh||0)-hours+1))+' through '+formatForecastHour(fh||0));
  });
}
function syncStatControl(){
  const spreadOptions=Array.from(els.statSelect.options).filter(o=>isSpreadStat(o.value));
  spreadOptions.forEach(o=>o.disabled=!supportsSpread(currentProduct));
  if(isSpreadStat(els.statSelect.value)&&!supportsSpread(currentProduct))els.statSelect.value='mean';
  if(!connected||!availableForecastHours.length){els.statSelect.disabled=true;return}
  if(isRawProduct(currentProduct)){els.statSelect.value='mean';els.statSelect.disabled=true;return}
  if(currentProduct==='qpfprob'||(currentProduct==='precip'&&accumHours>1)){
    els.statSelect.value='mean';els.statSelect.disabled=true;
  }else els.statSelect.disabled=false;
}
function syncComparisonControls(){
  const supported=canCompare(currentProduct);
  els.compareToggle.disabled=!supported;
  if(!supported){els.compareToggle.checked=false;els.compareControls.classList.add('hidden')}
  else els.compareControls.classList.toggle('hidden',!els.compareToggle.checked);
  updateCompareHint();
}
function updateCompareHint(){
  if(!els.compareHint)return;
  if(!els.compareToggle.checked){els.compareHint.textContent='';return}
  if(els.compareMode.value==='same_valid'){
    els.compareHint.textContent='Same valid time: the comparison run is matched to the current valid timestamp.';
  }else{
    els.compareHint.textContent='Same forecast lead: both runs use the same F-hour, so their valid times will differ.';
  }
}

function captureSelection(){
  const stat=els.statSelect.value;
  return {
    run:els.runSelect.value,fh:getSelectedForecastHour(),product:currentProduct,stat,
    statLabel:isSpreadStat(stat)?spreadLabel(stat):(els.statSelect.options[els.statSelect.selectedIndex]?.text||stat),
    accumHours,thresholdIn:parseFloat(els.qpfThreshold.value)||0.25,
    rawQpfMode:els.rawQpfMode.value,rawAccum:Number(els.rawAccum.value),rawThreshold:Number(els.rawThreshold.value),
    comparison:!!els.compareToggle.checked,compareRun:els.compareRun.value,compareMode:els.compareMode.value
  };
}
function expectedBand(meta){
  if(meta.product==='qpfprob')return 'total_precipitation_1hr_p10/p25/p50/p75/p90';
  if(isSpreadStat(meta.stat))return PRODUCTS[meta.product].band+' percentile bands';
  if(meta.product==='precip'&&meta.accumHours>1)return 'total_precipitation_1hr_mean';
  return PRODUCTS[meta.product]?.band+'_'+meta.stat;
}
function getSingleImage(run,fh){return ee.Image(baseRunCollection(run).filter(ee.Filter.eq('forecast_hour',fh)).first())}
function buildFieldImage(meta){
  const p=PRODUCTS[meta.product];
  if(isSpreadStat(meta.stat)){
    const low=meta.stat==='spread_iqr'?'p25':'p10',high=meta.stat==='spread_iqr'?'p75':'p90';
    const img=getSingleImage(meta.run,meta.fh);
    return p.transform(img.select(p.band+'_'+high)).subtract(p.transform(img.select(p.band+'_'+low))).rename('value');
  }
  if(meta.product==='precip'&&meta.accumHours>1){
    const start=meta.fh-meta.accumHours+1;
    const summed=baseRunCollection(meta.run).filter(ee.Filter.gte('forecast_hour',start)).filter(ee.Filter.lte('forecast_hour',meta.fh))
      .select('total_precipitation_1hr_mean').sum();
    return p.transform(summed).rename('value');
  }
  return p.transform(getSingleImage(meta.run,meta.fh).select(p.band+'_'+meta.stat)).rename('value');
}
function buildProbabilityRangeImage(meta){
  const t=meta.thresholdIn/39.3700787,img=getSingleImage(meta.run,meta.fh);
  const q10=img.select('total_precipitation_1hr_p10'),q25=img.select('total_precipitation_1hr_p25'),
        q50=img.select('total_precipitation_1hr_p50'),q75=img.select('total_precipitation_1hr_p75'),
        q90=img.select('total_precipitation_1hr_p90');
  return ee.Image.constant(0).where(q90.gt(t),1).where(q75.gt(t),2).where(q50.gt(t),3).where(q25.gt(t),4).where(q10.gt(t),5).rename('value');
}
function classifyThresholds(image,thresholds,maskBelowFirst=false){
  let classified=ee.Image.constant(0);
  for(let i=1;i<thresholds.length;i++)classified=classified.where(image.gte(thresholds[i]),i);
  if(maskBelowFirst)classified=classified.updateMask(image.gte(thresholds[0]));
  return classified.rename('display');
}
function diffRange(meta){
  if(isSpreadStat(meta.stat))return Math.max(5,(SPREAD_MAX[meta.product]||20)/2);
  return DIFF_RANGE[meta.product]||20;
}
function prepareDisplay(meta,dataImage){
  if(meta.comparison){
    const range=diffRange(meta);
    return {image:dataImage,vis:{min:-range,max:range,palette:palettes.difference},kind:'difference',range};
  }
  if(meta.product==='qpfprob')return {image:dataImage,vis:{min:0,max:5,palette:palettes.qpfprob},kind:'qpfprob'};
  if(meta.product==='precip'){
    return {image:classifyThresholds(dataImage,QPF_THRESHOLDS,true),vis:{min:0,max:QPF_THRESHOLDS.length-1,palette:palettes.precip},kind:'qpf'};
  }
  if(meta.product==='wind'&&!isSpreadStat(meta.stat)){
    return {image:classifyThresholds(dataImage,WIND_THRESHOLDS,false),vis:{min:0,max:WIND_THRESHOLDS.length-1,palette:palettes.wind},kind:'wind'};
  }
  if(isSpreadStat(meta.stat)){
    const max=SPREAD_MAX[meta.product]||20;
    return {image:dataImage,vis:{min:0,max,palette:palettes.spread},kind:'spread',max};
  }
  if(meta.product==='mslp'){
    const fill=dataImage.visualize({min:PRODUCTS.mslp.min,max:PRODUCTS.mslp.max,palette:palettes.mslp});
    const contourBands=dataImage.divide(4).floor();
    const edges=ee.Algorithms.CannyEdgeDetector(contourBands,0.1,0).selfMask();
    const contours=edges.visualize({palette:['#f7fafc'],opacity:0.55});
    return {image:fill.blend(contours),vis:{},kind:'mslp'};
  }
  const p=PRODUCTS[meta.product];
  return {image:dataImage,vis:{min:p.min,max:p.max,palette:palettes[meta.product]},kind:'continuous'};
}
async function resolveComparison(meta){
  if(!meta.comparison)return meta;
  if(!canCompare(meta.product))throw new Error('Run comparison is not supported for the bracketed QPF probability product.');
  if(!meta.compareRun||meta.compareRun===meta.run)throw new Error('Choose a different comparison initialization.');
  const compareHours=await getRunHours(meta.compareRun),compareSet=new Set(compareHours);
  let compareFh;
  if(meta.compareMode==='same_valid'){
    const valid=currentValidDate(meta.run,meta.fh),compareStart=new Date(meta.compareRun);
    compareFh=(valid.getTime()-compareStart.getTime())/3600000;
    if(!Number.isInteger(compareFh)||compareFh<1||!compareSet.has(compareFh)){
      throw new Error(formatRun(meta.compareRun)+' does not have a forecast hour matching '+formatValid(valid)+'.');
    }
  }else{
    compareFh=meta.fh;
    if(!compareSet.has(compareFh))throw new Error(formatRun(meta.compareRun)+' does not contain '+formatForecastHour(compareFh)+'.');
  }
  if(meta.product==='precip'&&!isAccumulationAvailableFor(meta.accumHours,compareFh,compareSet)){
    throw new Error(formatRun(meta.compareRun)+' does not contain the complete '+meta.accumHours+'-h QPF window ending at '+formatForecastHour(compareFh)+'.');
  }
  return {...meta,compareFh,compareValid:currentValidDate(meta.compareRun,compareFh)};
}
function layerCacheKey(meta){return JSON.stringify([meta.run,meta.fh,meta.product,meta.stat,meta.accumHours,meta.thresholdIn,meta.comparison,meta.compareRun,meta.compareMode,meta.compareFh])}
function cacheMapId(key,mapId){
  if(layerCache.has(key))layerCache.delete(key);
  layerCache.set(key,mapId);
  while(layerCache.size>MAX_LAYER_CACHE)layerCache.delete(layerCache.keys().next().value);
}
function installOverlay(mapId){
  clearRawLayers();
  if(overlay){const idx=map.overlayMapTypes.getArray().indexOf(overlay);if(idx>=0)map.overlayMapTypes.removeAt(idx)}
  const tileSource=new ee.layers.EarthEngineTileSource(mapId);
  overlay=new ee.layers.ImageOverlay(tileSource);
  overlay.setOpacity(parseFloat(els.opacityRange.value));map.overlayMapTypes.push(overlay);
}
function showRenderError(err,meta){
  const raw=errorText(err,'Unknown Earth Engine rendering error'),safe=escapeHtml(raw);
  if(/band|Image\.select|did not match any bands|no bands/i.test(raw)){
    showMessage('Product unavailable','The expected band <code>'+escapeHtml(expectedBand(meta))+'</code> could not be rendered for '+escapeHtml(formatRun(meta.run))+' '+escapeHtml(formatForecastHour(meta.fh))+'.<br><br>'+safe,false);
  }else showMessage('Earth Engine render failed','Earth Engine could not create the requested WeatherNext map layer.<br><br>'+safe,false);
}
async function renderLayer(){
  if(!connected)return;
  if(rawAbortController){rawAbortController.abort();rawAbortController=null}
  const requestId=++renderSeq;
  let meta=captureSelection();
  updateValidTime();updateCompareHint();
  if(!meta.run){setLoading(false);showMessage('Run unavailable','Select an available WeatherNext model run.',false);return}
  if(meta.fh==null||!availableForecastHourSet.has(meta.fh)){
    setLoading(false);showMessage('Forecast hour unavailable','The selected forecast hour is not available for this WeatherNext run.',false);return;
  }
  if(meta.product==='precip'&&!isAccumulationAvailable(meta.accumHours,meta.fh)){
    setLoading(false);showMessage('QPF accumulation unavailable',meta.accumHours+'-h QPF requires every hourly forecast in the accumulation window.',false);return;
  }
  if(isRawProduct(meta.product)){await renderRawLayer(requestId,meta);return}
  setLoading(true,meta.comparison?'Building run-difference layer…':'Building WeatherNext layer…');
  try{
    meta=await resolveComparison(meta);
    if(requestId!==renderSeq)return;
    const primary=meta.product==='qpfprob'?buildProbabilityRangeImage(meta):buildFieldImage(meta);
    let dataImage=primary;
    if(meta.comparison){
      const comparisonMeta={...meta,run:meta.compareRun,fh:meta.compareFh,comparison:false};
      dataImage=primary.subtract(buildFieldImage(comparisonMeta)).rename('value');
    }
    const display=prepareDisplay(meta,dataImage),key=layerCacheKey(meta),cached=layerCache.get(key);
    const finish=mapId=>{
      if(requestId!==renderSeq)return;
      installOverlay(mapId);currentImage=dataImage;currentLayerMeta={...meta};hideMessage();setLoading(false);
      updateLegend(currentLayerMeta,display);updateLayerStatus(currentLayerMeta);syncPointActions();
    };
    if(cached){finish(cached);return}
    display.image.getMap(display.vis,(mapId,err)=>{
      if(requestId!==renderSeq)return;
      if(err){setLoading(false);showRenderError(err,meta);return}
      cacheMapId(key,mapId);finish(mapId);
    });
  }catch(err){
    if(requestId!==renderSeq)return;
    setLoading(false);
    const title=meta.comparison?'Comparison unavailable':'Earth Engine render failed';
    showMessage(title,escapeHtml(errorText(err)),false);
  }
}
function setDiscreteLegend(colors,labels){
  els.legendGradient.classList.add('hidden');els.legendLabels.classList.add('hidden');els.legendDiscrete.classList.remove('hidden');
  els.legendDiscrete.innerHTML=labels.map((label,i)=>'<div class="legend-bin"><span class="legend-bin-color" style="background:'+colors[i]+'"></span><span class="legend-bin-label">'+label+'</span></div>').join('');
}
function setGradientLegend(colors,min,mid,max){
  els.legendDiscrete.classList.add('hidden');els.legendGradient.classList.remove('hidden');els.legendLabels.classList.remove('hidden');
  els.legendGradient.style.background='linear-gradient(90deg,'+colors.join(',')+')';
  els.legendMin.textContent=min;els.legendMid.textContent=mid;els.legendMax.textContent=max;
}
function updateLegend(meta=currentLayerMeta,display=meta?prepareDisplay(meta,currentImage):null){
  if(!meta||!display)return;
  const p=PRODUCTS[meta.product];els.legend.classList.remove('hidden');
  if(meta.comparison){
    const range=display.range||diffRange(meta);
    els.legendTitle.textContent='Run difference • '+p.title;
    setGradientLegend(palettes.difference,'−'+range+' '+p.unit,'0','+'+range+' '+p.unit);
    els.legendNote.textContent='Current run minus comparison run • symmetric fixed scale centered on zero.';
    return;
  }
  els.legendTitle.textContent=p.title+(meta.product==='precip'?' • '+meta.accumHours+' h':'')+(isSpreadStat(meta.stat)?' • '+spreadLabel(meta.stat):'');
  if(meta.product==='qpfprob'){
    setDiscreteLegend(palettes.qpfprob,PROBABILITY_LABELS);
    els.legendNote.textContent='Bracketed probability of 1-h QPF > '+meta.thresholdIn.toFixed(2)+' in, inferred from published ensemble quantiles.';
  }else if(meta.product==='precip'){
    setDiscreteLegend(palettes.precip,QPF_LABELS);
    els.legendNote.textContent=(meta.accumHours>1?'ensemble mean • ':'')+'inches • values below trace are transparent';
  }else if(meta.product==='wind'&&!isSpreadStat(meta.stat)){
    setDiscreteLegend(palettes.wind,WIND_LABELS);
    els.legendNote.textContent=meta.statLabel.toLowerCase()+' • kt • fixed operational bins';
  }else if(isSpreadStat(meta.stat)){
    const max=SPREAD_MAX[meta.product]||20;
    setGradientLegend(palettes.spread,'0 '+p.unit,(max/2)+' '+p.unit,max+'+ '+p.unit);
    els.legendNote.textContent=spreadLabel(meta.stat)+' • percentile range, not standard deviation';
  }else{
    setGradientLegend(palettes[meta.product],p.min+' '+p.unit,((p.min+p.max)/2).toFixed(0)+' '+p.unit,p.max+' '+p.unit);
    const extra=meta.product==='mslp'?' • ~4-hPa contour edges':'';
    els.legendNote.textContent=meta.statLabel.toLowerCase()+' • WeatherNext 3 0.1° (~11 km)'+extra;
  }
}
function layerStatusText(meta){
  const p=PRODUCTS[meta.product],valid=currentValidDate(meta.run,meta.fh);
  let detail=meta.statLabel;
  if(meta.product==='precip')detail=meta.accumHours+'-h QPF • '+meta.statLabel;
  if(meta.product==='qpfprob')detail='QPF probability range > '+meta.thresholdIn.toFixed(2)+' in';
  if(!meta.comparison)return formatRun(meta.run)+' • '+formatForecastHour(meta.fh)+' • Valid '+formatValid(valid)+' • '+p.title+' • '+detail;
  const field=p.title+' • '+meta.statLabel+' • Δ '+p.unit;
  if(meta.compareMode==='same_valid'){
    return 'Δ '+formatRun(meta.run)+' '+formatForecastHour(meta.fh)+' − '+formatRun(meta.compareRun)+' '+formatForecastHour(meta.compareFh)+' • Valid '+formatValid(valid)+' • Same valid time • '+field;
  }
  return 'Δ '+formatRun(meta.run)+' '+formatForecastHour(meta.fh)+' (Valid '+formatValid(valid)+') − '+formatRun(meta.compareRun)+' '+formatForecastHour(meta.compareFh)+' (Valid '+formatValid(meta.compareValid)+') • Same forecast lead • '+field;
}
function updateLayerStatus(meta){els.layerStatus.textContent=layerStatusText(meta);els.layerStatus.classList.remove('muted')}

function sampleMetaText(meta){
  if(meta.comparison)return layerStatusText(meta);
  const base=formatRun(meta.run)+' • '+formatForecastHour(meta.fh)+' • '+PRODUCTS[meta.product].title;
  if(meta.product==='qpfprob')return base+' • > '+meta.thresholdIn.toFixed(2)+' in';
  if(meta.product==='precip'&&meta.accumHours>1)return base+' • '+meta.accumHours+'-h ensemble mean';
  return base+' • '+meta.statLabel;
}
function markSelectedPoint(lat,lng){
  selectedPoint={lat,lng};
  if(pointMarker)pointMarker.setMap(null);
  pointMarker=new google.maps.Marker({position:{lat,lng},map,title:'Selected forecast point'});
}
function syncPointActions(){
  const meta=currentLayerMeta;
  els.meteogramBtn.disabled=!selectedPoint||!canMeteogram(meta);
  els.trendBtn.disabled=!selectedPoint||!canTrend(meta);
  els.meteogramBtn.title=meta?.comparison?'Meteogram is available from the primary run outside comparison mode.':'';
  els.trendBtn.title=meta?.comparison?'Run trend is available outside comparison mode.':(meta?.product==='precip'?'Run trend is focused on instantaneous scalar fields.':'');
}
function samplePoint(lat,lng){
  if(currentLayerMeta?.raw){sampleRawPoint(lat,lng);return}
  if(!currentImage||!currentLayerMeta)return;
  markSelectedPoint(lat,lng);
  const requestId=++sampleSeq,image=currentImage,meta={...currentLayerMeta};
  els.pointReadout.classList.remove('hidden');els.readoutLocation.textContent=lat.toFixed(3)+', '+lng.toFixed(3);els.readoutValue.textContent='…';els.readoutMeta.textContent=sampleMetaText(meta);syncPointActions();
  image.reduceRegion({reducer:ee.Reducer.first(),geometry:ee.Geometry.Point([lng,lat]),scale:11132,bestEffort:true,maxPixels:1e6})
    .get('value').evaluate((v,err)=>{
      if(requestId!==sampleSeq)return;
      if(err){els.readoutValue.textContent='Sample failed';els.readoutMeta.textContent=sampleMetaText(meta)+' • '+errorText(err,'Earth Engine point-sample failure');return}
      if(v==null){els.readoutValue.textContent='No data';els.readoutMeta.textContent=sampleMetaText(meta)+' • no value at this location';return}
      if(meta.product==='qpfprob'){
        const cls=Math.max(0,Math.min(5,Math.round(Number(v))));els.readoutValue.textContent=PROBABILITY_LABELS[cls];
      }else{
        const p=PRODUCTS[meta.product],digits=meta.product==='precip'?2:1;
        els.readoutValue.textContent=(meta.comparison?'Δ ':'')+Number(v).toFixed(digits)+' '+p.unit;
      }
      els.readoutMeta.textContent=sampleMetaText(meta);
    });
}

function analysisState(title,meta){
  els.analysisPanel.classList.remove('hidden');els.analysisTitle.textContent=title;els.analysisMeta.textContent=meta||'';
  els.analysisLoading.classList.remove('hidden');els.analysisError.classList.add('hidden');
  if(analysisChart){analysisChart.destroy();analysisChart=null}
}
function analysisFail(err){
  els.analysisLoading.classList.add('hidden');els.analysisError.textContent=errorText(err);els.analysisError.classList.remove('hidden');
}
function analysisOptions(unit){
  return {
    responsive:true,maintainAspectRatio:false,animation:false,interaction:{mode:'index',intersect:false},
    plugins:{legend:{labels:{color:'#dbe7f4',boxWidth:14,usePointStyle:false}},tooltip:{callbacks:{title:items=>items[0]?.label||''}}},
    scales:{
      x:{ticks:{color:'#91a7bf',maxTicksLimit:12,maxRotation:0,autoSkip:true},grid:{color:'rgba(120,145,170,.12)'},title:{display:true,text:'Valid time (UTC)',color:'#9fb2c6'}},
      y:{ticks:{color:'#91a7bf'},grid:{color:'rgba(120,145,170,.12)'},title:{display:true,text:unit,color:'#9fb2c6'}}
    }
  };
}
function featureRows(result){
  return (result?.features||[]).map(f=>f.properties||{}).sort((a,b)=>Number(a.forecast_hour)-Number(b.forecast_hour));
}
function makePointSeriesCollection(meta,point){
  const p=PRODUCTS[meta.product],collection=baseRunCollection(meta.run).sort('forecast_hour'),list=collection.toList(collection.size());
  let bands;
  if(meta.product==='precip')bands=[p.band+'_mean'];
  else bands=[p.band+'_p10',p.band+'_p25',p.band+'_mean',p.band+'_p75',p.band+'_p90'];
  return ee.FeatureCollection(list.map(obj=>{
    const img=ee.Image(obj),vals=img.select(bands).reduceRegion({reducer:ee.Reducer.first(),geometry:point,scale:11132,bestEffort:true,maxPixels:1e6});
    return ee.Feature(null,vals).set('forecast_hour',img.get('forecast_hour')).set('valid_time',img.get('end_time'));
  }));
}
async function openMeteogram(){
  if(!selectedPoint||!currentLayerMeta||!canMeteogram(currentLayerMeta))return;
  const requestId=++analysisSeq,meta={...currentLayerMeta},p=PRODUCTS[meta.product];
  analysisState(p.title+' meteogram',formatRun(meta.run)+' • '+selectedPoint.lat.toFixed(3)+', '+selectedPoint.lng.toFixed(3));
  try{
    if(typeof Chart==='undefined')throw new Error('Chart library did not load.');
    const point=ee.Geometry.Point([selectedPoint.lng,selectedPoint.lat]);
    const result=await evaluatePromise(makePointSeriesCollection(meta,point));
    if(requestId!==analysisSeq)return;
    const rows=featureRows(result);
    if(!rows.length)throw new Error('No point time-series data were returned.');
    const labels=rows.map(r=>shortUtc(r.valid_time));
    let datasets,options=analysisOptions(p.unit);
    if(meta.product==='precip'){
      const raw=new Map(rows.map(r=>[Number(r.forecast_hour),convertRaw('precip',r[p.band+'_mean'])]));
      const values=rows.map(r=>{
        const fh=Number(r.forecast_hour);
        if(meta.accumHours===1)return raw.get(fh);
        let sum=0;
        for(let h=fh-meta.accumHours+1;h<=fh;h++){if(!raw.has(h)||raw.get(h)==null)return null;sum+=raw.get(h)}
        return sum;
      });
      datasets=[{type:'bar',label:meta.accumHours===1?'1-h ensemble-mean QPF':meta.accumHours+'-h ensemble-mean QPF',data:values,backgroundColor:'rgba(84,184,255,.62)',borderColor:'rgba(84,184,255,.95)',borderWidth:1}];
    }else{
      const b=p.band,get=stat=>rows.map(r=>convertRaw(meta.product,r[b+'_'+stat]));
      datasets=[
        {label:'P10',data:get('p10'),borderColor:'rgba(84,184,255,.24)',backgroundColor:'rgba(84,184,255,.08)',pointRadius:0,borderWidth:1},
        {label:'P90',data:get('p90'),borderColor:'rgba(84,184,255,.24)',backgroundColor:'rgba(84,184,255,.10)',pointRadius:0,borderWidth:1,fill:'-1'},
        {label:'P25',data:get('p25'),borderColor:'rgba(110,231,199,.35)',backgroundColor:'rgba(110,231,199,.10)',pointRadius:0,borderWidth:1},
        {label:'P75',data:get('p75'),borderColor:'rgba(110,231,199,.35)',backgroundColor:'rgba(110,231,199,.16)',pointRadius:0,borderWidth:1,fill:'-1'},
        {label:'Mean',data:get('mean'),borderColor:'#f5f8ff',backgroundColor:'#f5f8ff',pointRadius:0,borderWidth:2}
      ];
    }
    els.analysisLoading.classList.add('hidden');
    analysisChart=new Chart(els.analysisCanvas.getContext('2d'),{type:meta.product==='precip'?'bar':'line',data:{labels,datasets},options});
  }catch(err){if(requestId===analysisSeq)analysisFail(err)}
}
function trendCollection(meta,point,targetValid){
  const p=PRODUCTS[meta.product];
  if(meta.product==='precip'&&meta.accumHours>1){
    const candidates=availableRuns.slice(0,24).map(run=>{
      const fh=(targetValid.getTime()-new Date(run).getTime())/3600000;
      return {run,fh};
    }).filter(x=>Number.isInteger(x.fh)&&x.fh>=meta.accumHours);
    return ee.FeatureCollection(candidates.map(x=>{
      const startFh=x.fh-meta.accumHours+1;
      const window=baseRunCollection(x.run).filter(ee.Filter.gte('forecast_hour',startFh)).filter(ee.Filter.lte('forecast_hour',x.fh));
      const summed=p.transform(window.select(p.band+'_mean').sum()).rename('value');
      const sampled=summed.reduceRegion({reducer:ee.Reducer.first(),geometry:point,scale:11132,bestEffort:true,maxPixels:1e6}).get('value');
      const value=ee.Algorithms.If(window.size().eq(meta.accumHours),sampled,null);
      return ee.Feature(null,{value}).set('start_time',x.run).set('forecast_hour',x.fh);
    }));
  }
  const start=new Date(targetValid.getTime()),end=new Date(targetValid.getTime()+60000);
  const collection=ee.ImageCollection(DATASET).filterDate(ee.Date(start.getTime()),ee.Date(end.getTime())).filter(ee.Filter.inList('start_time',availableRuns.slice(0,24))).sort('start_time');
  const list=collection.toList(collection.size());
  let bands;
  if(isSpreadStat(meta.stat)){
    const low=meta.stat==='spread_iqr'?'p25':'p10',high=meta.stat==='spread_iqr'?'p75':'p90';
    bands=[p.band+'_'+low,p.band+'_'+high];
  }else bands=[p.band+'_'+meta.stat];
  return ee.FeatureCollection(list.map(obj=>{
    const img=ee.Image(obj),vals=img.select(bands).reduceRegion({reducer:ee.Reducer.first(),geometry:point,scale:11132,bestEffort:true,maxPixels:1e6});
    return ee.Feature(null,vals).set('start_time',img.get('start_time')).set('forecast_hour',img.get('forecast_hour'));
  }));
}
async function openRunTrend(){
  if(!selectedPoint||!currentLayerMeta||!canTrend(currentLayerMeta))return;
  const requestId=++analysisSeq,meta={...currentLayerMeta},p=PRODUCTS[meta.product],targetValid=currentValidDate(meta.run,meta.fh);
  const trendLabel=meta.product==='precip'&&meta.accumHours>1?meta.accumHours+'-h ensemble-mean QPF':meta.statLabel;
  analysisState('Run-over-run point trend','Valid '+formatValid(targetValid)+' • '+p.title+' • '+trendLabel+' • '+selectedPoint.lat.toFixed(3)+', '+selectedPoint.lng.toFixed(3));
  try{
    if(typeof Chart==='undefined')throw new Error('Chart library did not load.');
    const point=ee.Geometry.Point([selectedPoint.lng,selectedPoint.lat]),result=await evaluatePromise(trendCollection(meta,point,targetValid));
    if(requestId!==analysisSeq)return;
    let rows=(result?.features||[]).map(f=>f.properties||{}).filter(r=>r.start_time).sort((a,b)=>new Date(a.start_time)-new Date(b.start_time));
    if(rows.length>MAX_TREND_RUNS)rows=rows.slice(-MAX_TREND_RUNS);
    if(!rows.length)throw new Error('No recent runs were available for this valid time.');
    const b=p.band;
    const values=rows.map(r=>{
      if(meta.product==='precip'&&meta.accumHours>1)return r.value==null?null:Number(r.value);
      if(isSpreadStat(meta.stat)){
        const low=meta.stat==='spread_iqr'?'p25':'p10',high=meta.stat==='spread_iqr'?'p75':'p90';
        const hi=convertRaw(meta.product,r[b+'_'+high]),lo=convertRaw(meta.product,r[b+'_'+low]);
        return hi==null||lo==null?null:hi-lo;
      }
      return convertRaw(meta.product,r[b+'_'+meta.stat]);
    });
    const labels=rows.map(r=>formatRun(r.start_time).replace(/^\d{4}-/,''));
    const options=analysisOptions(p.unit);options.scales.x.title.text='Model initialization (UTC)';
    els.analysisLoading.classList.add('hidden');
    analysisChart=new Chart(els.analysisCanvas.getContext('2d'),{
      type:'line',
      data:{labels,datasets:[{label:p.title+' • '+trendLabel,data:values,borderColor:'#6ee7c7',backgroundColor:'rgba(110,231,199,.18)',pointBackgroundColor:'#f5f8ff',pointRadius:3,borderWidth:2,tension:0.15}]},
      options
    });
  }catch(err){if(requestId===analysisSeq)analysisFail(err)}
}
function closeAnalysis(){
  analysisSeq++;els.analysisPanel.classList.add('hidden');
  if(analysisChart){analysisChart.destroy();analysisChart=null}
}

function selectProduct(name){
  currentProduct=name;document.querySelectorAll('.product').forEach(b=>b.classList.toggle('active',b.dataset.product===name));
  els.precipControls.classList.toggle('hidden',name!=='precip');els.probControls.classList.toggle('hidden',name!=='qpfprob');
  syncStatControl();syncComparisonControls();syncRawControls();renderLayer();
}

els.settingsBtn.onclick=openSetup;els.messageSetupBtn.onclick=openSetup;
els.setupForm.addEventListener('submit',e=>{e.preventDefault();saveConfig();els.setupDialog.close();location.reload()});
els.clearConfigBtn.onclick=()=>{localStorage.removeItem(CONFIG_KEY);fillConfig()};
els.homeBtn.onclick=()=>map&&map.setOptions({center:LIX_CENTER,zoom:LIX_ZOOM});
els.refreshBtn.onclick=renderLayer;
els.runSelect.onchange=()=>{populateCompareRuns();loadForecastHours(true)};
els.fhRange.oninput=()=>{renderSeq++;if(rawAbortController)rawAbortController.abort();setLoading(false);const fh=getSelectedForecastHour();if(fh!=null)els.fhNumber.value=String(fh);updateValidTime();updateAccumulationAvailability();updateCompareHint();syncRawControls()};
els.fhRange.onchange=renderLayer;
els.fhNumber.onchange=()=>{setForecastHour(els.fhNumber.value);renderLayer()};
els.statSelect.onchange=()=>{syncComparisonControls();renderLayer()};
els.opacityRange.oninput=()=>{
  const opacity=parseFloat(els.opacityRange.value);if(overlay)overlay.setOpacity(opacity);if(rawGroundOverlay)rawGroundOverlay.setOpacity(opacity);
  if(rawDataLayer)rawDataLayer.setStyle(feature=>{const level=Number(feature.getProperty('height_dam')),major=Math.abs(level%6)<0.01;return {strokeColor:major?'#7ee7ff':'#d7f4ff',strokeWeight:major?2.3:1.15,strokeOpacity:(major?0.95:0.68)*opacity,clickable:false}})
};
els.qpfThreshold.onchange=renderLayer;
els.rawQpfMode.onchange=()=>{syncRawControls();renderLayer()};els.rawAccum.onchange=renderLayer;els.rawThreshold.onchange=renderLayer;
els.compareToggle.onchange=()=>{syncComparisonControls();renderLayer()};
els.compareRun.onchange=renderLayer;els.compareMode.onchange=()=>{updateCompareHint();renderLayer()};
els.readoutClose.onclick=()=>els.pointReadout.classList.add('hidden');
els.meteogramBtn.onclick=openMeteogram;els.trendBtn.onclick=openRunTrend;els.analysisClose.onclick=closeAnalysis;
document.querySelectorAll('.product').forEach(b=>b.onclick=()=>selectProduct(b.dataset.product));
accumButtons().forEach(b=>b.onclick=()=>{
  const requested=Number(b.dataset.hours);if(b.disabled||!isAccumulationAvailable(requested))return;
  accumButtons().forEach(x=>x.classList.remove('active'));b.classList.add('active');accumHours=requested;
  syncStatControl();renderLayer();
});

cfg=getSavedConfig();
if(cfg?.projectId&&cfg?.clientId&&cfg?.mapsKey)authenticate();else openSetup();
})();