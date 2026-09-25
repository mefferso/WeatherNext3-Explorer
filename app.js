(() => {
'use strict';

const DATASET='projects/gcp-public-data-weathernext/assets/weathernext_3_0_0_0p1deg';
const CONFIG_KEY='wn3ExplorerConfigV1';
const LIX_CENTER={lat:30.25,lng:-90.2};
const LIX_ZOOM=7;
const MAX_LAYER_CACHE=20;
const MAX_TREND_RUNS=16;
const RUN_HOURS_CACHE_MS=120000;
const MAX_AUTO_SCALE_CACHE=60;
const AUTO_SCALE_DEBOUNCE_MS=450;

const palettes={
  temp:['#4b0082','#3521b5','#2456d4','#1f8be0','#37b8df','#70d4c3','#a8df91','#e5e873','#ffd34e','#ffab43','#f47a3e','#e54735','#b5152c'],
  dewpoint:['#5b3a29','#876044','#b58b58','#d9bd74','#e8df9c','#b8dc87','#7bcf79','#43b870','#1f9c70','#187e7e','#17649a','#3f4f9c','#633c91'],
  wind:['#e8f5ff','#c9e9fa','#9ed7f5','#70c2e8','#44add7','#2795c4','#17759e','#9ac45a','#e4d64a','#f5a142','#e65c3a','#c5283d'],
  precip:['#d8f0d1','#9cda8b','#54c46a','#1e9c50','#f0e442','#f6ba45','#f28f3b','#e65c3a','#c5283d','#8b1a8c'],
  mslp:['#54278f','#756bb1','#9e9ac8','#bcbddc','#d9d9d9','#f0f0c8','#f3d079','#eba45a','#df7649','#ca4d4d','#9e2f45'],
  qpfprob:['#607080','#62a5cf','#55c4b0','#d6d65c','#f2a444','#d94c43'],
  spread:['#f7fbff','#deebf7','#c6dbef','#9ecae1','#6baed6','#4292c6','#2171b5','#08519c','#08306b'],
  difference:['#5b2a86','#3f51b5','#2879c7','#55a8d3','#a6cee3','#f7f7f7','#f6c49a','#ef8a62','#d95f4f','#b63a45','#7f1d35']
};

const PROBABILITY_LABELS=['<10%','10–25%','25–50%','50–75%','75–90%','>90%'];
const QPF_THRESHOLDS=[0.001,0.01,0.10,0.25,0.50,1.00,1.50,2.00,3.00,5.00];
const QPF_LABELS=['Trace–0.01','0.01–0.10','0.10–0.25','0.25–0.50','0.50–1.00','1.00–1.50','1.50–2.00','2.00–3.00','3.00–5.00','5.00+'];
const WIND_THRESHOLDS=[0,5,10,15,20,25,30,35,40,50,64,80];
const WIND_LABELS=['0–5','5–10','10–15','15–20','20–25','25–30','30–35','35–40','40–50','50–64','64–80','80+'];
const SPREAD_MAX={temp:30,dewpoint:30,wind:40,mslp:20};
const DIFF_RANGE={temp:20,dewpoint:20,wind:30,precip:5,mslp:30};
const AUTO_MIN_SPAN={temp:10,dewpoint:10,wind:10,mslp:8,precip:0.10};
const AUTO_SPREAD_MIN_MAX={temp:4,dewpoint:4,wind:5,mslp:2};
const AUTO_DIFF_MIN_RANGE={temp:3,dewpoint:3,wind:3,mslp:2,precip:0.10};
const QPF_AUTO_LADDER=[0.001,0.01,0.03,0.05,0.075,0.10,0.15,0.20,0.25,0.35,0.50,0.75,1.00,1.50,2.00,3.00,5.00,7.00,10.00];

const PRODUCTS={
  temp:{title:'2-m Temperature',unit:'°F',band:'temperature_2m',min:0,max:110,transform:i=>i.subtract(273.15).multiply(9/5).add(32)},
  dewpoint:{title:'2-m Dewpoint',unit:'°F',band:'dewpoint_temperature_2m',min:-10,max:85,transform:i=>i.subtract(273.15).multiply(9/5).add(32)},
  wind:{title:'10-m Wind Speed',unit:'kt',band:'wind_speed_10m',min:0,max:80,transform:i=>i.multiply(1.943844)},
  precip:{title:'QPF',unit:'in',band:'total_precipitation_1hr',min:0,max:5,transform:i=>i.multiply(39.3700787)},
  mslp:{title:'Mean Sea-Level Pressure',unit:'hPa',band:'mean_sea_level_pressure',min:940,max:1040,transform:i=>i.divide(100)},
  qpfprob:{title:'1-h QPF Exceedance Probability Range',unit:'%',min:0,max:5}
};

let cfg=null,map=null,overlay=null,currentProduct='temp',currentImage=null,currentLayerMeta=null,accumHours=1,connected=false;
let availableRuns=[],availableForecastHours=[],availableForecastHourSet=new Set();
let renderSeq=0,forecastHourSeq=0,sampleSeq=0,analysisSeq=0;
let selectedPoint=null,pointMarker=null,analysisChart=null,currentDisplay=null;
let scaleMode='auto',autoScaleMoveTimer=null;
const runHoursCache=new Map();
const layerCache=new Map();
const autoScaleCache=new Map();

const $=id=>document.getElementById(id);
const els={
  authBadge:$('authBadge'),settingsBtn:$('settingsBtn'),setupDialog:$('setupDialog'),setupForm:$('setupForm'),
  projectId:$('projectId'),clientId:$('clientId'),clearConfigBtn:$('clearConfigBtn'),
  runSelect:$('runSelect'),fhRange:$('fhRange'),fhNumber:$('fhNumber'),validTime:$('validTime'),statSelect:$('statSelect'),
  compareToggle:$('compareToggle'),compareControls:$('compareControls'),compareRun:$('compareRun'),compareMode:$('compareMode'),compareHint:$('compareHint'),
  refreshBtn:$('refreshBtn'),homeBtn:$('homeBtn'),precipControls:$('precipControls'),probControls:$('probControls'),
  qpfThreshold:$('qpfThreshold'),opacityRange:$('opacityRange'),scaleMode:$('scaleMode'),loading:$('loading'),message:$('message'),
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
  cfg={projectId:els.projectId.value.trim(),clientId:els.clientId.value.trim()};
  localStorage.setItem(CONFIG_KEY,JSON.stringify(cfg));
}
function fillConfig(){
  const s=getSavedConfig()||{};
  els.projectId.value=s.projectId||'';els.clientId.value=s.clientId||'';
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
function canCompare(product){return product!=='qpfprob'}
function canMeteogram(meta){return meta&&['temp','dewpoint','wind','mslp','precip'].includes(meta.product)&&!meta.comparison}
function canTrend(meta){return meta&&['temp','dewpoint','wind','mslp','precip'].includes(meta.product)&&!meta.comparison}
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

function initMap(){
  if(map)return;
  if(typeof L==='undefined')throw new Error('Leaflet failed to load.');
  map=L.map('map',{zoomControl:true,attributionControl:true}).setView([LIX_CENTER.lat,LIX_CENTER.lng],LIX_ZOOM);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{
    maxZoom:19,
    attribution:'&copy; OpenStreetMap contributors'
  }).addTo(map);
  map.on('click',e=>samplePoint(e.latlng.lat,e.latlng.lng));
  map.on('moveend',()=>{
    if(scaleMode!=='auto'||!connected||!currentLayerMeta)return;
    clearTimeout(autoScaleMoveTimer);
    autoScaleMoveTimer=setTimeout(()=>renderLayer(),AUTO_SCALE_DEBOUNCE_MS);
  });
}

function authenticate(){
  cfg=getSavedConfig();
  if(!cfg?.projectId||!cfg?.clientId){openSetup();return}
  setLoading(true,'Connecting to Google Earth Engine…');
  try{initMap()}catch(err){connectionError(err);return}
  ee.data.authenticateViaOauth(
    cfg.clientId,
    initializeEE,
    err=>connectionError(err),
    ['https://www.googleapis.com/auth/earthengine.readonly'],
    ()=>{setLoading(false);showMessage('Sign in required','Click Setup → Save & connect, then sign in with the Google account approved for WeatherNext.',true)},
    true
  );
}
function initializeEE(){
  ee.initialize(null,null,()=>{
    connected=true;
    els.authBadge.classList.remove('offline');els.authBadge.classList.add('online');
    els.authBadge.innerHTML='<span></span>WeatherNext connected';
    els.runSelect.disabled=false;els.refreshBtn.disabled=false;
    hideMessage();loadRuns();
  },connectionError,null,cfg.projectId);
}
function connectionError(err){
  setLoading(false);connected=false;
  els.authBadge.classList.remove('online');els.authBadge.classList.add('offline');
  els.authBadge.innerHTML='<span></span>Not connected';
  const msg=escapeHtml(errorText(err,'Unknown authentication or access error'));
  showMessage('Authentication / access failed',msg+'<br><br>Verify the registered Earth Engine project, OAuth origin, and that you signed in with the allowlisted WeatherNext account.',true);
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
function currentMapGeometry(){
  const b=map?.getBounds();if(!b)throw new Error('Map bounds are not ready.');
  return ee.Geometry.Rectangle([b.getWest(),b.getSouth(),b.getEast(),b.getNorth()],null,false);
}
function viewportKey(){
  const b=map?.getBounds();if(!b)return 'no-bounds';
  const q=v=>(Math.round(v*4)/4).toFixed(2);
  return [q(b.getWest()),q(b.getSouth()),q(b.getEast()),q(b.getNorth())].join(',');
}
function autoScaleCacheKey(meta,kind){
  return JSON.stringify([kind,meta.run,meta.fh,meta.product,meta.stat,meta.accumHours,meta.thresholdIn,meta.comparison,meta.compareRun,meta.compareMode,meta.compareFh,viewportKey()]);
}
function cacheAutoScale(key,value){
  if(autoScaleCache.has(key))autoScaleCache.delete(key);
  autoScaleCache.set(key,value);
  while(autoScaleCache.size>MAX_AUTO_SCALE_CACHE)autoScaleCache.delete(autoScaleCache.keys().next().value);
}
function niceStep(meta){
  if(meta.product==='temp'||meta.product==='dewpoint')return isSpreadStat(meta.stat)?1:2;
  if(meta.product==='wind')return isSpreadStat(meta.stat)?1:2;
  if(meta.product==='mslp')return 1;
  if(meta.product==='precip')return 0.05;
  return 1;
}
function floorTo(v,step){return Math.floor(v/step)*step}
function ceilTo(v,step){return Math.ceil(v/step)*step}
function ensureSpan(min,max,minSpan){
  if(max-min>=minSpan)return {min,max};
  const mid=(min+max)/2,half=minSpan/2;
  return {min:mid-half,max:mid+half};
}
function samplePalette(palette,count){
  if(count<=1)return [palette[Math.floor(palette.length/2)]];
  return Array.from({length:count},(_,i)=>palette[Math.round(i*(palette.length-1)/(count-1))]);
}
function dynamicQpfThresholds(upper){
  const target=Math.max(0.03,Number(upper)||0.03);
  let candidates=QPF_AUTO_LADDER.filter(v=>v<=target*1.08);
  const next=QPF_AUTO_LADDER.find(v=>v>target*1.08);
  if(next)candidates.push(next);
  if(candidates.length<5)candidates=QPF_AUTO_LADDER.slice(0,Math.max(5,QPF_AUTO_LADDER.indexOf(next)+1));
  if(candidates.length>10){
    const keep=[0,1];
    const interior=candidates.length-3,slots=7;
    for(let i=1;i<=slots;i++)keep.push(1+Math.round(i*interior/(slots+1)));
    keep.push(candidates.length-1);
    candidates=[...new Set(keep)].map(i=>candidates[i]).filter(Number.isFinite);
  }
  return candidates.slice(0,10);
}
function qpfLabels(thresholds){
  return thresholds.map((v,i)=>{
    const fmt=x=>x<0.01?x.toFixed(3):x<1?x.toFixed(2):x.toFixed(1);
    return i<thresholds.length-1?fmt(v)+'–'+fmt(thresholds[i+1]):fmt(v)+'+';
  });
}
async function reduceAutoStats(image,meta,mode){
  const key=autoScaleCacheKey(meta,mode),cached=autoScaleCache.get(key);
  if(cached)return cached;
  let target=image,reducer;
  if(mode==='difference'){
    target=image.abs();reducer=ee.Reducer.percentile([98]);
  }else if(mode==='spread'){
    target=image.updateMask(image.gt(0));reducer=ee.Reducer.percentile([98]);
  }else if(mode==='qpf'){
    target=image.updateMask(image.gte(0.001));reducer=ee.Reducer.percentile([5,98]);
  }else reducer=ee.Reducer.percentile([2,98]);
  const stats=await evaluatePromise(target.reduceRegion({
    reducer,geometry:currentMapGeometry(),scale:11132,bestEffort:true,maxPixels:1e7,tileScale:2
  }));
  const out={};
  for(const [k,v] of Object.entries(stats||{}))if(Number.isFinite(Number(v)))out[k]=Number(v);
  if(!Object.keys(out).length)throw new Error('No finite values were available for dynamic scaling.');
  cacheAutoScale(key,out);return out;
}
function percentileValue(stats,suffix){
  const key=Object.keys(stats).find(k=>k.endsWith(suffix));
  return key?Number(stats[key]):NaN;
}
async function autoContinuousRange(image,meta){
  const stats=await reduceAutoStats(image,meta,'continuous');
  let min=percentileValue(stats,'_p2'),max=percentileValue(stats,'_p98');
  if(!Number.isFinite(min)||!Number.isFinite(max)||max<=min)throw new Error('Invalid dynamic percentile range.');
  ({min,max}=ensureSpan(min,max,AUTO_MIN_SPAN[meta.product]||4));
  const pad=(max-min)*0.04;min-=pad;max+=pad;
  const step=niceStep(meta);min=floorTo(min,step);max=ceilTo(max,step);
  return {min,max};
}
async function autoDifferenceRange(image,meta){
  const stats=await reduceAutoStats(image,meta,'difference');
  let range=percentileValue(stats,'_p98');
  if(!Number.isFinite(range)||range<=0)throw new Error('Invalid dynamic difference range.');
  range=Math.max(range,AUTO_DIFF_MIN_RANGE[meta.product]||1);
  range=ceilTo(range,niceStep(meta));
  return range;
}
async function autoSpreadMax(image,meta){
  const stats=await reduceAutoStats(image,meta,'spread');
  let max=percentileValue(stats,'_p98');
  if(!Number.isFinite(max)||max<=0)throw new Error('Invalid dynamic spread range.');
  max=Math.max(max,AUTO_SPREAD_MIN_MAX[meta.product]||1);
  return ceilTo(max,niceStep(meta));
}
async function autoQpfThresholds(image,meta){
  const stats=await reduceAutoStats(image,meta,'qpf');
  let upper=percentileValue(stats,'_p98');
  if(!Number.isFinite(upper)||upper<=0)upper=0.10;
  return dynamicQpfThresholds(upper);
}
function prepareFixedDisplay(meta,dataImage){
  if(meta.comparison){
    const range=diffRange(meta);
    return {image:dataImage,vis:{min:-range,max:range,palette:palettes.difference},kind:'difference',range,scale:'fixed'};
  }
  if(meta.product==='qpfprob')return {image:dataImage,vis:{min:0,max:5,palette:palettes.qpfprob},kind:'qpfprob',scale:'categorical'};
  if(meta.product==='precip'){
    return {image:classifyThresholds(dataImage,QPF_THRESHOLDS,true),vis:{min:0,max:QPF_THRESHOLDS.length-1,palette:palettes.precip},kind:'qpf',thresholds:QPF_THRESHOLDS,labels:QPF_LABELS,colors:palettes.precip,scale:'fixed'};
  }
  if(meta.product==='wind'&&!isSpreadStat(meta.stat)){
    return {image:classifyThresholds(dataImage,WIND_THRESHOLDS,false),vis:{min:0,max:WIND_THRESHOLDS.length-1,palette:palettes.wind},kind:'wind',scale:'fixed'};
  }
  if(isSpreadStat(meta.stat)){
    const max=SPREAD_MAX[meta.product]||20;
    return {image:dataImage,vis:{min:0,max,palette:palettes.spread},kind:'spread',max,scale:'fixed'};
  }
  if(meta.product==='mslp'){
    const fill=dataImage.visualize({min:PRODUCTS.mslp.min,max:PRODUCTS.mslp.max,palette:palettes.mslp});
    const contourBands=dataImage.divide(4).floor();
    const edges=ee.Algorithms.CannyEdgeDetector(contourBands,0.1,0).selfMask();
    const contours=edges.visualize({palette:['#f7fafc'],opacity:0.55});
    return {image:fill.blend(contours),vis:{},kind:'mslp',min:PRODUCTS.mslp.min,max:PRODUCTS.mslp.max,scale:'fixed'};
  }
  const p=PRODUCTS[meta.product];
  return {image:dataImage,vis:{min:p.min,max:p.max,palette:palettes[meta.product]},kind:'continuous',min:p.min,max:p.max,scale:'fixed'};
}
async function prepareDisplay(meta,dataImage){
  if(scaleMode!=='auto'||meta.product==='qpfprob')return prepareFixedDisplay(meta,dataImage);
  try{
    if(meta.comparison){
      const range=await autoDifferenceRange(dataImage,meta);
      return {image:dataImage,vis:{min:-range,max:range,palette:palettes.difference},kind:'difference',range,scale:'auto'};
    }
    if(meta.product==='precip'){
      const thresholds=await autoQpfThresholds(dataImage,meta),colors=samplePalette(palettes.precip,thresholds.length);
      return {image:classifyThresholds(dataImage,thresholds,true),vis:{min:0,max:thresholds.length-1,palette:colors},kind:'qpf',thresholds,labels:qpfLabels(thresholds),colors,scale:'auto'};
    }
    if(isSpreadStat(meta.stat)){
      const max=await autoSpreadMax(dataImage,meta);
      return {image:dataImage,vis:{min:0,max,palette:palettes.spread},kind:'spread',max,scale:'auto'};
    }
    const range=await autoContinuousRange(dataImage,meta);
    if(meta.product==='mslp'){
      const fill=dataImage.visualize({min:range.min,max:range.max,palette:palettes.mslp});
      const contourBands=dataImage.divide(4).floor();
      const edges=ee.Algorithms.CannyEdgeDetector(contourBands,0.1,0).selfMask();
      const contours=edges.visualize({palette:['#f7fafc'],opacity:0.62});
      return {image:fill.blend(contours),vis:{},kind:'mslp',min:range.min,max:range.max,scale:'auto'};
    }
    return {image:dataImage,vis:{min:range.min,max:range.max,palette:palettes[meta.product]},kind:'continuous',min:range.min,max:range.max,scale:'auto'};
  }catch(err){
    console.warn('Dynamic scale failed; using fixed scale.',err);
    return {...prepareFixedDisplay(meta,dataImage),autoFallback:true};
  }
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
function layerCacheKey(meta,display){
  return JSON.stringify([meta.run,meta.fh,meta.product,meta.stat,meta.accumHours,meta.thresholdIn,meta.comparison,meta.compareRun,meta.compareMode,meta.compareFh,display.scale,display.min,display.max,display.range,display.thresholds]);
}
function cacheMapId(key,mapId){
  if(layerCache.has(key))layerCache.delete(key);
  layerCache.set(key,mapId);
  while(layerCache.size>MAX_LAYER_CACHE)layerCache.delete(layerCache.keys().next().value);
}
function installOverlay(mapId){
  if(overlay){map.removeLayer(overlay);overlay=null}
  const EETileLayer=L.TileLayer.extend({
    getTileUrl(coords){return ee.data.getTileUrl(this.options.eeMapId,coords.x,coords.y,coords.z)}
  });
  overlay=new EETileLayer('',{
    eeMapId:mapId,
    opacity:parseFloat(els.opacityRange.value),
    tileSize:256,
    maxZoom:19,
    noWrap:true,
    attribution:'WeatherNext 3 / Google Earth Engine'
  });
  overlay.addTo(map);
}
function showRenderError(err,meta){
  const raw=errorText(err,'Unknown Earth Engine rendering error'),safe=escapeHtml(raw);
  if(/band|Image\.select|did not match any bands|no bands/i.test(raw)){
    showMessage('Product unavailable','The expected band <code>'+escapeHtml(expectedBand(meta))+'</code> could not be rendered for '+escapeHtml(formatRun(meta.run))+' '+escapeHtml(formatForecastHour(meta.fh))+'.<br><br>'+safe,false);
  }else showMessage('Earth Engine render failed','Earth Engine could not create the requested WeatherNext map layer.<br><br>'+safe,false);
}
async function renderLayer(){
  if(!connected)return;
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
    const display=await prepareDisplay(meta,dataImage);
    if(requestId!==renderSeq)return;
    const key=layerCacheKey(meta,display),cached=layerCache.get(key);
    const finish=mapId=>{
      if(requestId!==renderSeq)return;
      installOverlay(mapId);currentImage=dataImage;currentLayerMeta={...meta};currentDisplay=display;hideMessage();setLoading(false);
      updateLegend(currentLayerMeta,display);updateLayerStatus(currentLayerMeta,display);syncPointActions();
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
function formatScaleValue(v,product){
  const n=Number(v);if(!Number.isFinite(n))return '—';
  if(product==='precip')return n<0.1?n.toFixed(2):n<1?n.toFixed(2):n.toFixed(1);
  if(product==='mslp')return n.toFixed(0);
  return Math.abs(n)<10?n.toFixed(1):n.toFixed(0);
}
function scaleName(display){return display?.scale==='auto'?'Auto / dynamic':display?.scale==='categorical'?'Categorical':'Fixed / operational'}
function updateLegend(meta=currentLayerMeta,display=currentDisplay){
  if(!meta||!display)return;
  const p=PRODUCTS[meta.product];els.legend.classList.remove('hidden');
  if(meta.comparison){
    const range=display.range||diffRange(meta);
    els.legendTitle.textContent='Run difference • '+p.title;
    setGradientLegend(palettes.difference,'−'+formatScaleValue(range,meta.product)+' '+p.unit,'0','+'+formatScaleValue(range,meta.product)+' '+p.unit);
    els.legendNote.textContent=scaleName(display)+' symmetric scale centered on zero'+(display.scale==='auto'?' • viewport 98th percentile |Δ|':'')+(display.autoFallback?' • auto fallback':'')+'.';
    return;
  }
  els.legendTitle.textContent=p.title+(meta.product==='precip'?' • '+meta.accumHours+' h':'')+(isSpreadStat(meta.stat)?' • '+spreadLabel(meta.stat):'');
  if(meta.product==='qpfprob'){
    setDiscreteLegend(palettes.qpfprob,PROBABILITY_LABELS);
    els.legendNote.textContent='Categorical probability range • 1-h QPF > '+meta.thresholdIn.toFixed(2)+' in • inferred from published ensemble quantiles.';
  }else if(meta.product==='precip'){
    setDiscreteLegend(display.colors||palettes.precip,display.labels||QPF_LABELS);
    els.legendNote.textContent=scaleName(display)+' QPF bins • '+(meta.accumHours>1?'ensemble mean • ':'')+'inches • values below trace are transparent'+(display.autoFallback?' • auto fallback':'');
  }else if(meta.product==='wind'&&display.kind==='wind'){
    setDiscreteLegend(palettes.wind,WIND_LABELS);
    els.legendNote.textContent='Fixed / operational wind bins • '+meta.statLabel.toLowerCase()+' • kt';
  }else if(isSpreadStat(meta.stat)){
    const max=display.max||SPREAD_MAX[meta.product]||20;
    setGradientLegend(palettes.spread,'0 '+p.unit,formatScaleValue(max/2,meta.product)+' '+p.unit,formatScaleValue(max,meta.product)+'+ '+p.unit);
    els.legendNote.textContent=scaleName(display)+' • '+spreadLabel(meta.stat)+' • percentile range, not standard deviation'+(display.scale==='auto'?' • viewport P98 upper bound':'')+(display.autoFallback?' • auto fallback':'');
  }else{
    const min=Number.isFinite(display.min)?display.min:p.min,max=Number.isFinite(display.max)?display.max:p.max;
    setGradientLegend(palettes[meta.product],formatScaleValue(min,meta.product)+' '+p.unit,formatScaleValue((min+max)/2,meta.product)+' '+p.unit,formatScaleValue(max,meta.product)+' '+p.unit);
    const extra=meta.product==='mslp'?' • ~4-hPa contour edges':'';
    els.legendNote.textContent=scaleName(display)+' • '+meta.statLabel.toLowerCase()+' • WeatherNext 3 0.1° (~11 km)'+(display.scale==='auto'?' • viewport P2–P98':'')+extra+(display.autoFallback?' • auto fallback':'');
  }
}
function scaleStatus(meta,display){
  if(!display)return '';
  const p=PRODUCTS[meta.product];
  if(display.scale==='categorical')return 'Categorical scale';
  if(meta.comparison)return (display.scale==='auto'?'Auto':'Fixed')+' scale ±'+formatScaleValue(display.range,meta.product)+' '+p.unit;
  if(meta.product==='precip'){
    const last=display.thresholds?.[display.thresholds.length-1];
    return (display.scale==='auto'?'Auto':'Fixed')+' QPF scale'+(Number.isFinite(last)?' to '+formatScaleValue(last,meta.product)+'+ '+p.unit:'');
  }
  if(isSpreadStat(meta.stat))return (display.scale==='auto'?'Auto':'Fixed')+' scale 0–'+formatScaleValue(display.max,meta.product)+' '+p.unit;
  const min=Number.isFinite(display.min)?display.min:p.min,max=Number.isFinite(display.max)?display.max:p.max;
  return (display.scale==='auto'?'Auto':'Fixed')+' scale '+formatScaleValue(min,meta.product)+'–'+formatScaleValue(max,meta.product)+' '+p.unit;
}
function layerStatusText(meta,display=currentDisplay){
  const p=PRODUCTS[meta.product],valid=currentValidDate(meta.run,meta.fh);
  let detail=meta.statLabel;
  if(meta.product==='precip')detail=meta.accumHours+'-h QPF • '+meta.statLabel;
  if(meta.product==='qpfprob')detail='QPF probability range > '+meta.thresholdIn.toFixed(2)+' in';
  const scale=scaleStatus(meta,display);
  if(!meta.comparison)return formatRun(meta.run)+' • '+formatForecastHour(meta.fh)+' • Valid '+formatValid(valid)+' • '+p.title+' • '+detail+(scale?' • '+scale:'');
  const field=p.title+' • '+meta.statLabel+' • Δ '+p.unit;
  if(meta.compareMode==='same_valid'){
    return 'Δ '+formatRun(meta.run)+' '+formatForecastHour(meta.fh)+' − '+formatRun(meta.compareRun)+' '+formatForecastHour(meta.compareFh)+' • Valid '+formatValid(valid)+' • Same valid time • '+field+(scale?' • '+scale:'');
  }
  return 'Δ '+formatRun(meta.run)+' '+formatForecastHour(meta.fh)+' (Valid '+formatValid(valid)+') − '+formatRun(meta.compareRun)+' '+formatForecastHour(meta.compareFh)+' (Valid '+formatValid(meta.compareValid)+') • Same forecast lead • '+field+(scale?' • '+scale:'');
}
function updateLayerStatus(meta,display=currentDisplay){els.layerStatus.textContent=layerStatusText(meta,display);els.layerStatus.classList.remove('muted')}

function sampleMetaText(meta){
  if(meta.comparison)return layerStatusText(meta);
  const base=formatRun(meta.run)+' • '+formatForecastHour(meta.fh)+' • '+PRODUCTS[meta.product].title;
  if(meta.product==='qpfprob')return base+' • > '+meta.thresholdIn.toFixed(2)+' in';
  if(meta.product==='precip'&&meta.accumHours>1)return base+' • '+meta.accumHours+'-h ensemble mean';
  return base+' • '+meta.statLabel;
}
function markSelectedPoint(lat,lng){
  selectedPoint={lat,lng};
  if(pointMarker)map.removeLayer(pointMarker);
  pointMarker=L.marker([lat,lng],{title:'Selected forecast point'}).addTo(map);
}
function syncPointActions(){
  const meta=currentLayerMeta;
  els.meteogramBtn.disabled=!selectedPoint||!canMeteogram(meta);
  els.trendBtn.disabled=!selectedPoint||!canTrend(meta);
  els.meteogramBtn.title=meta?.comparison?'Meteogram is available from the primary run outside comparison mode.':'';
  els.trendBtn.title=meta?.comparison?'Run trend is available outside comparison mode.':(meta?.product==='precip'?'Run trend is focused on instantaneous scalar fields.':'');
}
function samplePoint(lat,lng){
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
  syncStatControl();syncComparisonControls();renderLayer();
}

els.settingsBtn.onclick=openSetup;els.messageSetupBtn.onclick=openSetup;
els.setupForm.addEventListener('submit',e=>{e.preventDefault();saveConfig();els.setupDialog.close();location.reload()});
els.clearConfigBtn.onclick=()=>{localStorage.removeItem(CONFIG_KEY);fillConfig()};
els.homeBtn.onclick=()=>map&&map.setView([LIX_CENTER.lat,LIX_CENTER.lng],LIX_ZOOM);
els.refreshBtn.onclick=renderLayer;
els.runSelect.onchange=()=>{populateCompareRuns();loadForecastHours(true)};
els.fhRange.oninput=()=>{renderSeq++;setLoading(false);const fh=getSelectedForecastHour();if(fh!=null)els.fhNumber.value=String(fh);updateValidTime();updateAccumulationAvailability();updateCompareHint()};
els.fhRange.onchange=renderLayer;
els.fhNumber.onchange=()=>{setForecastHour(els.fhNumber.value);renderLayer()};
els.statSelect.onchange=()=>{syncComparisonControls();renderLayer()};
els.opacityRange.oninput=()=>overlay&&overlay.setOpacity(parseFloat(els.opacityRange.value));
els.scaleMode.onchange=()=>{scaleMode=els.scaleMode.value;autoScaleCache.clear();renderLayer()};
els.qpfThreshold.onchange=renderLayer;
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

scaleMode=els.scaleMode?.value||'auto';
cfg=getSavedConfig();
if(cfg?.projectId&&cfg?.clientId)authenticate();else openSetup();
})();