(() => {
'use strict';

const DATASET='projects/gcp-public-data-weathernext/assets/weathernext_3_0_0_0p1deg';
const CONFIG_KEY='wn3ExplorerConfigV1';
const LIX_CENTER={lat:30.25,lng:-90.2};
const LIX_ZOOM=7;

const palettes={
  temp:['#4b0082','#2d2bc7','#2768e8','#28a9ef','#67d7df','#9de187','#e4e76f','#ffd34e','#ff9b3f','#ef5038','#b5152c'],
  dewpoint:['#5b3a29','#9b6f45','#d7b46a','#ece39a','#b8dc87','#70c879','#2e9c68','#147a75','#16629a','#553e9e'],
  wind:['#f7fbff','#d8efff','#9ed7f5','#58b8e2','#2795c4','#17759e','#ffc857','#f28f3b','#d94f30'],
  precip:['#f7fbff','#d8f0d1','#92d483','#42b85c','#1b9348','#f0e442','#f5a142','#e65c3a','#c5283d','#8b1a8c'],
  mslp:['#552c8a','#4056b4','#3184c4','#5ab2c9','#a1d5c7','#e8e7bb','#e5b674','#d9794b','#b73b4b'],
  qpfprob:['#607080','#62a5cf','#55c4b0','#d6d65c','#f2a444','#d94c43']
};

const PROBABILITY_LABELS=['<10%','10–25%','25–50%','50–75%','75–90%','>90%'];

const PRODUCTS={
  temp:{title:'2-m Temperature',unit:'°F',band:'temperature_2m',min:20,max:110,transform:i=>i.subtract(273.15).multiply(9/5).add(32)},
  dewpoint:{title:'2-m Dewpoint',unit:'°F',band:'dewpoint_temperature_2m',min:0,max:85,transform:i=>i.subtract(273.15).multiply(9/5).add(32)},
  wind:{title:'10-m Wind Speed',unit:'kt',band:'wind_speed_10m',min:0,max:45,transform:i=>i.multiply(1.943844)},
  precip:{title:'QPF',unit:'in',band:'total_precipitation_1hr',min:0,max:2.5,transform:i=>i.multiply(39.3700787)},
  mslp:{title:'Mean Sea-Level Pressure',unit:'hPa',band:'mean_sea_level_pressure',min:990,max:1035,transform:i=>i.divide(100)},
  qpfprob:{title:'1-h QPF Exceedance Probability Range',unit:'%',min:0,max:5}
};

let cfg=null,map=null,overlay=null,currentProduct='temp',currentImage=null,currentLayerMeta=null,accumHours=1,connected=false;
let availableForecastHours=[],availableForecastHourSet=new Set(),renderSeq=0,forecastHourSeq=0,sampleSeq=0;

const $=id=>document.getElementById(id);
const els={
  authBadge:$('authBadge'),settingsBtn:$('settingsBtn'),setupDialog:$('setupDialog'),setupForm:$('setupForm'),
  projectId:$('projectId'),clientId:$('clientId'),mapsKey:$('mapsKey'),clearConfigBtn:$('clearConfigBtn'),
  runSelect:$('runSelect'),fhRange:$('fhRange'),fhNumber:$('fhNumber'),validTime:$('validTime'),statSelect:$('statSelect'),
  refreshBtn:$('refreshBtn'),homeBtn:$('homeBtn'),precipControls:$('precipControls'),probControls:$('probControls'),
  qpfThreshold:$('qpfThreshold'),opacityRange:$('opacityRange'),loading:$('loading'),message:$('message'),
  messageSetupBtn:$('messageSetupBtn'),legend:$('legend'),legendTitle:$('legendTitle'),legendGradient:$('legendGradient'),
  legendDiscrete:$('legendDiscrete'),legendLabels:$('legendLabels'),legendMin:$('legendMin'),legendMid:$('legendMid'),legendMax:$('legendMax'),legendNote:$('legendNote'),
  pointReadout:$('pointReadout'),readoutClose:$('readoutClose'),readoutLocation:$('readoutLocation'),
  readoutValue:$('readoutValue'),readoutMeta:$('readoutMeta')
};

function getSavedConfig(){try{return JSON.parse(localStorage.getItem(CONFIG_KEY)||'null')}catch{return null}}
function saveConfig(){
  cfg={projectId:els.projectId.value.trim(),clientId:els.clientId.value.trim(),mapsKey:els.mapsKey.value.trim()};
  localStorage.setItem(CONFIG_KEY,JSON.stringify(cfg));
}
function fillConfig(){
  const s=getSavedConfig()||{};
  els.projectId.value=s.projectId||'';els.clientId.value=s.clientId||'';els.mapsKey.value=s.mapsKey||'';
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
function accumButtons(){return Array.from(document.querySelectorAll('#accumGroup button'))}

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
    hideMessage();loadRuns();
  },connectionError,null,cfg.projectId);
}

function connectionError(err){
  setLoading(false);connected=false;
  els.authBadge.classList.remove('online');els.authBadge.classList.add('offline');
  els.authBadge.innerHTML='<span></span>Not connected';
  const msg=escapeHtml(errorText(err,'Unknown authentication or access error'));
  showMessage('Authentication / access failed',msg+'<br><br>Verify the registered Earth Engine project, OAuth origin, Maps API key restrictions, and that you signed in with the allowlisted WeatherNext account.',true);
}

function loadRuns(){
  setLoading(true,'Finding recent WeatherNext runs…');
  const runHeads=ee.ImageCollection(DATASET)
    .filter(ee.Filter.eq('forecast_hour',1))
    .sort('start_time',false)
    .limit(40);
  ee.List(runHeads.aggregate_array('start_time')).distinct().evaluate((runs,err)=>{
    setLoading(false);
    if(err){
      els.runSelect.innerHTML='<option>Run discovery failed</option>';
      showMessage('Run discovery failed',escapeHtml(errorText(err))+'<br><br>Earth Engine connected, but recent WeatherNext initialization times could not be read.',false);
      return;
    }
    if(!runs?.length){
      els.runSelect.innerHTML='<option>No runs available</option>';
      showMessage('Run unavailable','No WeatherNext runs with F001 were returned from Earth Engine.',false);
      return;
    }
    els.runSelect.innerHTML='';
    runs.forEach((r,i)=>{const o=document.createElement('option');o.value=r;o.textContent=formatRun(r)+(i===0?'  • latest':'');els.runSelect.appendChild(o)});
    loadForecastHours(true);
  });
}

function formatRun(iso){const d=new Date(iso);if(Number.isNaN(+d))return iso;return d.toISOString().slice(0,10)+' '+String(d.getUTCHours()).padStart(2,'0')+'Z'}
function baseRunCollection(run=els.runSelect.value){return ee.ImageCollection(DATASET).filter(ee.Filter.eq('start_time',run))}

function loadForecastHours(renderWhenReady=false){
  if(!connected)return;
  renderSeq++;
  const run=els.runSelect.value;
  const requestId=++forecastHourSeq;
  availableForecastHours=[];availableForecastHourSet=new Set();
  els.fhRange.disabled=true;els.fhNumber.disabled=true;els.refreshBtn.disabled=true;
  setLoading(true,'Loading available forecast hours…');
  ee.List(baseRunCollection(run).aggregate_array('forecast_hour')).distinct().sort().evaluate((hours,err)=>{
    if(requestId!==forecastHourSeq||run!==els.runSelect.value)return;
    setLoading(false);
    if(err){
      showMessage('Run unavailable','Could not read forecast hours for '+escapeHtml(formatRun(run))+'.<br><br>'+escapeHtml(errorText(err)),false);
      return;
    }
    const parsed=(hours||[]).map(Number).filter(Number.isFinite).sort((a,b)=>a-b);
    if(!parsed.length){
      showMessage('Run unavailable','The selected WeatherNext run exists in the run list, but no forecast-hour images are currently available.',false);
      return;
    }
    availableForecastHours=parsed;availableForecastHourSet=new Set(parsed);
    configureForecastControls(Number(els.fhNumber.value)||12);
    els.fhRange.disabled=false;els.fhNumber.disabled=false;els.refreshBtn.disabled=false;
    syncStatControl();hideMessage();
    if(renderWhenReady)renderLayer();
  });
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
  const idx=availableForecastHours.indexOf(target);
  els.fhRange.value=String(idx);els.fhNumber.value=String(target);
  updateValidTime();updateAccumulationAvailability();
  return target;
}
function configureForecastControls(preferredFh){
  els.fhRange.min='0';els.fhRange.max=String(Math.max(0,availableForecastHours.length-1));els.fhRange.step='1';
  els.fhNumber.min=String(availableForecastHours[0]);els.fhNumber.max=String(availableForecastHours[availableForecastHours.length-1]);els.fhNumber.step='1';
  setForecastHour(preferredFh);
}
function updateValidTime(){
  const run=new Date(els.runSelect.value),fh=getSelectedForecastHour();
  if(Number.isNaN(+run)||fh==null){els.validTime.textContent='Valid time —';return}
  const valid=new Date(run.getTime()+fh*3600000);
  els.validTime.textContent='Valid '+valid.toISOString().replace('T',' ').slice(0,16)+'Z  •  '+formatForecastHour(fh);
}
function isAccumulationAvailable(hours,fh=getSelectedForecastHour()){
  if(fh==null||hours<1||fh<hours)return false;
  const start=fh-hours+1;
  for(let h=start;h<=fh;h++)if(!availableForecastHourSet.has(h))return false;
  return true;
}
function updateAccumulationAvailability(){
  const fh=getSelectedForecastHour();
  accumButtons().forEach(button=>{
    const hours=Number(button.dataset.hours),ok=isAccumulationAvailable(hours,fh);
    button.disabled=!ok;
    button.title=ok?'':(fh==null?'No forecast hour is selected':hours+'-h QPF requires every hourly forecast from '+formatForecastHour(Math.max(1,(fh||0)-hours+1))+' through '+formatForecastHour(fh||0));
  });
}
function syncStatControl(){
  if(!connected||!availableForecastHours.length){els.statSelect.disabled=true;return}
  if(currentProduct==='qpfprob'||(currentProduct==='precip'&&accumHours>1)){
    els.statSelect.value='mean';els.statSelect.disabled=true;
  }else els.statSelect.disabled=false;
}

function getSingleImage(run,fh){return ee.Image(baseRunCollection(run).filter(ee.Filter.eq('forecast_hour',fh)).first())}
function captureSelection(){
  const stat=els.statSelect.value;
  return {
    run:els.runSelect.value,
    fh:getSelectedForecastHour(),
    product:currentProduct,
    stat,
    statLabel:els.statSelect.options[els.statSelect.selectedIndex]?.text||stat,
    accumHours,
    thresholdIn:parseFloat(els.qpfThreshold.value)||0.25
  };
}
function expectedBand(meta){
  if(meta.product==='qpfprob')return 'total_precipitation_1hr_p10/p25/p50/p75/p90';
  if(meta.product==='precip'&&meta.accumHours>1)return 'total_precipitation_1hr_mean';
  return PRODUCTS[meta.product]?.band+'_'+meta.stat;
}
function buildStandardImage(meta){
  const p=PRODUCTS[meta.product];
  if(meta.product==='precip'&&meta.accumHours>1){
    const start=meta.fh-meta.accumHours+1;
    const summed=baseRunCollection(meta.run)
      .filter(ee.Filter.gte('forecast_hour',start))
      .filter(ee.Filter.lte('forecast_hour',meta.fh))
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

function showRenderError(err,meta){
  const raw=errorText(err,'Unknown Earth Engine rendering error');
  const safe=escapeHtml(raw);
  if(/band|Image\.select|did not match any bands|no bands/i.test(raw)){
    showMessage('Product unavailable','The expected band <code>'+escapeHtml(expectedBand(meta))+'</code> could not be rendered for '+escapeHtml(formatRun(meta.run))+' '+escapeHtml(formatForecastHour(meta.fh))+'.<br><br>'+safe,false);
  }else{
    showMessage('Earth Engine render failed','The requested WeatherNext image was found, but Earth Engine could not create the map layer.<br><br>'+safe,false);
  }
}
function renderLayer(){
  if(!connected)return;
  const requestId=++renderSeq,meta=captureSelection();
  updateValidTime();
  if(!meta.run){setLoading(false);showMessage('Run unavailable','Select an available WeatherNext model run.',false);return}
  if(meta.fh==null||!availableForecastHourSet.has(meta.fh)){
    setLoading(false);showMessage('Forecast hour unavailable','The selected forecast hour is not available for this WeatherNext run. Reload the run or choose another available hour.',false);return;
  }
  if(meta.product==='precip'&&!isAccumulationAvailable(meta.accumHours,meta.fh)){
    const start=meta.fh-meta.accumHours+1;
    setLoading(false);
    showMessage('QPF accumulation unavailable',meta.accumHours+'-h QPF requires every hourly forecast from '+escapeHtml(formatForecastHour(start))+' through '+escapeHtml(formatForecastHour(meta.fh))+'. One or more required forecast hours are not available yet.',false);
    return;
  }
  setLoading(true);
  let requestedImage;
  try{requestedImage=meta.product==='qpfprob'?buildProbabilityRangeImage(meta):buildStandardImage(meta)}
  catch(err){if(requestId===renderSeq){setLoading(false);showRenderError(err,meta)}return}
  const p=PRODUCTS[meta.product],vis={min:p.min,max:p.max,palette:palettes[meta.product]};
  requestedImage.getMap(vis,(mapId,err)=>{
    if(requestId!==renderSeq)return;
    setLoading(false);
    if(err){showRenderError(err,meta);return}
    hideMessage();
    if(overlay){const idx=map.overlayMapTypes.getArray().indexOf(overlay);if(idx>=0)map.overlayMapTypes.removeAt(idx)}
    const tileSource=new ee.layers.EarthEngineTileSource(mapId);
    overlay=new ee.layers.ImageOverlay(tileSource);
    overlay.setOpacity(parseFloat(els.opacityRange.value));map.overlayMapTypes.push(overlay);
    currentImage=requestedImage;currentLayerMeta={...meta};updateLegend(currentLayerMeta);
  });
}

function updateLegend(meta=currentLayerMeta){
  if(!meta)return;
  const p=PRODUCTS[meta.product];els.legend.classList.remove('hidden');
  els.legendTitle.textContent=p.title+(meta.product==='precip'?' • '+meta.accumHours+' h':'');
  if(meta.product==='qpfprob'){
    els.legendGradient.classList.add('hidden');els.legendLabels.classList.add('hidden');els.legendDiscrete.classList.remove('hidden');
    els.legendDiscrete.innerHTML=PROBABILITY_LABELS.map((label,i)=>'<div class="legend-bin"><span class="legend-bin-color" style="background:'+palettes.qpfprob[i]+'"></span><span class="legend-bin-label">'+label+'</span></div>').join('');
    els.legendNote.textContent='Bracketed probability of 1-h QPF > '+meta.thresholdIn.toFixed(2)+' in, inferred from published ensemble quantiles.';
  }else{
    els.legendDiscrete.classList.add('hidden');els.legendGradient.classList.remove('hidden');els.legendLabels.classList.remove('hidden');
    els.legendGradient.style.background='linear-gradient(90deg,'+palettes[meta.product].join(',')+')';
    els.legendMin.textContent=p.min+' '+p.unit;els.legendMid.textContent=((p.min+p.max)/2).toFixed(0)+' '+p.unit;els.legendMax.textContent=p.max+' '+p.unit;
    const stat=(meta.product==='precip'&&meta.accumHours>1)?'ensemble mean':meta.statLabel.toLowerCase();
    els.legendNote.textContent=stat+' • WeatherNext 3 0.1° (~11 km) surface guidance';
  }
}

function sampleMetaText(meta){
  const base=formatRun(meta.run)+' • '+formatForecastHour(meta.fh)+' • '+PRODUCTS[meta.product].title;
  if(meta.product==='qpfprob')return base+' • > '+meta.thresholdIn.toFixed(2)+' in';
  if(meta.product==='precip'&&meta.accumHours>1)return base+' • '+meta.accumHours+'-h ensemble mean';
  return base+' • '+meta.statLabel;
}
function samplePoint(lat,lng){
  if(!currentImage||!currentLayerMeta)return;
  const requestId=++sampleSeq,image=currentImage,meta={...currentLayerMeta};
  els.pointReadout.classList.remove('hidden');els.readoutLocation.textContent=lat.toFixed(3)+', '+lng.toFixed(3);els.readoutValue.textContent='…';els.readoutMeta.textContent=sampleMetaText(meta);
  image.reduceRegion({reducer:ee.Reducer.first(),geometry:ee.Geometry.Point([lng,lat]),scale:10000,bestEffort:true,maxPixels:1e6})
    .get('value').evaluate((v,err)=>{
      if(requestId!==sampleSeq)return;
      if(err){
        els.readoutValue.textContent='Sample failed';
        els.readoutMeta.textContent=sampleMetaText(meta)+' • '+errorText(err,'Earth Engine point-sample failure');
        return;
      }
      if(v==null){els.readoutValue.textContent='No data';els.readoutMeta.textContent=sampleMetaText(meta)+' • no value at this location';return}
      if(meta.product==='qpfprob'){
        const cls=Math.max(0,Math.min(5,Math.round(Number(v))));els.readoutValue.textContent=PROBABILITY_LABELS[cls];
      }else{
        const p=PRODUCTS[meta.product],digits=meta.product==='precip'?2:(meta.product==='mslp'?1:0);
        els.readoutValue.textContent=Number(v).toFixed(digits)+' '+p.unit;
      }
      els.readoutMeta.textContent=sampleMetaText(meta);
    });
}

function selectProduct(name){
  currentProduct=name;document.querySelectorAll('.product').forEach(b=>b.classList.toggle('active',b.dataset.product===name));
  els.precipControls.classList.toggle('hidden',name!=='precip');els.probControls.classList.toggle('hidden',name!=='qpfprob');
  syncStatControl();renderLayer();
}

els.settingsBtn.onclick=openSetup;els.messageSetupBtn.onclick=openSetup;
els.setupForm.addEventListener('submit',e=>{e.preventDefault();saveConfig();els.setupDialog.close();location.reload()});
els.clearConfigBtn.onclick=()=>{localStorage.removeItem(CONFIG_KEY);fillConfig()};
els.homeBtn.onclick=()=>map&&map.setOptions({center:LIX_CENTER,zoom:LIX_ZOOM});
els.refreshBtn.onclick=renderLayer;
els.runSelect.onchange=()=>loadForecastHours(true);
els.fhRange.oninput=()=>{renderSeq++;setLoading(false);const fh=getSelectedForecastHour();if(fh!=null)els.fhNumber.value=String(fh);updateValidTime();updateAccumulationAvailability()};
els.fhRange.onchange=renderLayer;
els.fhNumber.onchange=()=>{setForecastHour(els.fhNumber.value);renderLayer()};
els.statSelect.onchange=renderLayer;
els.opacityRange.oninput=()=>overlay&&overlay.setOpacity(parseFloat(els.opacityRange.value));
els.qpfThreshold.onchange=renderLayer;els.readoutClose.onclick=()=>els.pointReadout.classList.add('hidden');
document.querySelectorAll('.product').forEach(b=>b.onclick=()=>selectProduct(b.dataset.product));
accumButtons().forEach(b=>b.onclick=()=>{
  const requested=Number(b.dataset.hours);if(b.disabled||!isAccumulationAvailable(requested))return;
  accumButtons().forEach(x=>x.classList.remove('active'));b.classList.add('active');accumHours=requested;
  syncStatControl();renderLayer();
});

cfg=getSavedConfig();
if(cfg?.projectId&&cfg?.clientId&&cfg?.mapsKey)authenticate();else openSetup();
})();