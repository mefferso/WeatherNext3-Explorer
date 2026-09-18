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

const PRODUCTS={
  temp:{title:'2-m Temperature',unit:'°F',band:'temperature_2m',min:20,max:110,transform:i=>i.subtract(273.15).multiply(9/5).add(32)},
  dewpoint:{title:'2-m Dewpoint',unit:'°F',band:'dewpoint_temperature_2m',min:0,max:85,transform:i=>i.subtract(273.15).multiply(9/5).add(32)},
  wind:{title:'10-m Wind Speed',unit:'kt',band:'wind_speed_10m',min:0,max:45,transform:i=>i.multiply(1.943844)},
  precip:{title:'QPF',unit:'in',band:'total_precipitation_1hr',min:0,max:2.5,transform:i=>i.multiply(39.3700787)},
  mslp:{title:'Mean Sea-Level Pressure',unit:'hPa',band:'mean_sea_level_pressure',min:990,max:1035,transform:i=>i.divide(100)},
  qpfprob:{title:'1-h QPF Exceedance Probability Range',unit:'%',min:0,max:100}
};

let cfg=null,map=null,overlay=null,currentProduct='temp',currentImage=null,accumHours=1,connected=false;

const $=id=>document.getElementById(id);
const els={
  authBadge:$('authBadge'),settingsBtn:$('settingsBtn'),setupDialog:$('setupDialog'),setupForm:$('setupForm'),
  projectId:$('projectId'),clientId:$('clientId'),mapsKey:$('mapsKey'),clearConfigBtn:$('clearConfigBtn'),
  runSelect:$('runSelect'),fhRange:$('fhRange'),fhNumber:$('fhNumber'),validTime:$('validTime'),statSelect:$('statSelect'),
  refreshBtn:$('refreshBtn'),homeBtn:$('homeBtn'),precipControls:$('precipControls'),probControls:$('probControls'),
  qpfThreshold:$('qpfThreshold'),opacityRange:$('opacityRange'),loading:$('loading'),message:$('message'),
  messageSetupBtn:$('messageSetupBtn'),legend:$('legend'),legendTitle:$('legendTitle'),legendGradient:$('legendGradient'),
  legendMin:$('legendMin'),legendMid:$('legendMid'),legendMax:$('legendMax'),legendNote:$('legendNote'),
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
function openSetup(){fillConfig();els.setupDialog.showModal()}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}

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
    [els.runSelect,els.fhRange,els.fhNumber,els.statSelect,els.refreshBtn].forEach(x=>x.disabled=false);
    hideMessage();loadRuns();
  },connectionError,null,cfg.projectId);
}

function connectionError(err){
  setLoading(false);connected=false;
  const msg=(err&&err.message)||String(err||'Unknown authentication error');
  showMessage('Connection failed',escapeHtml(msg)+'<br><br>Verify the registered Earth Engine project, OAuth origin, and that you signed in with the allowlisted WeatherNext account.',true);
}

function loadRuns(){
  setLoading(true,'Finding recent WeatherNext runs…');
  const now=ee.Date(Date.now());
  const recent=ee.ImageCollection(DATASET).filterDate(now.advance(-72,'hour'),now.advance(1,'hour'));
  ee.List(recent.aggregate_array('start_time')).distinct().sort().reverse().slice(0,40).evaluate((runs,err)=>{
    setLoading(false);
    if(err||!runs?.length){connectionError(err||new Error('No recent WeatherNext runs returned.'));return}
    els.runSelect.innerHTML='';
    runs.forEach((r,i)=>{const o=document.createElement('option');o.value=r;o.textContent=formatRun(r)+(i===0?'  • latest':'');els.runSelect.appendChild(o)});
    updateHorizon();renderLayer();
  });
}

function formatRun(iso){const d=new Date(iso);if(Number.isNaN(+d))return iso;return d.toISOString().slice(0,10)+' '+String(d.getUTCHours()).padStart(2,'0')+'Z'}
function updateHorizon(){
  const d=new Date(els.runSelect.value),max=[0,6,12,18].includes(d.getUTCHours())?360:48;
  els.fhRange.max=max;els.fhNumber.max=max;
  if(+els.fhRange.value>max){els.fhRange.value=max;els.fhNumber.value=max}
  updateValidTime();
}
function updateValidTime(){
  const run=new Date(els.runSelect.value),fh=+els.fhRange.value;if(Number.isNaN(+run))return;
  const valid=new Date(run.getTime()+fh*3600000);
  els.validTime.textContent='Valid '+valid.toISOString().replace('T',' ').slice(0,16)+'Z  •  F'+String(fh).padStart(3,'0');
}

function baseRunCollection(){return ee.ImageCollection(DATASET).filter(ee.Filter.eq('start_time',els.runSelect.value))}
function getSingleImage(){const fh=+els.fhRange.value;return ee.Image(baseRunCollection().filter(ee.Filter.eq('forecast_hour',fh)).first())}

function buildStandardImage(){
  const p=PRODUCTS[currentProduct],stat=els.statSelect.value;
  if(currentProduct==='precip'&&accumHours>1){
    const fh=+els.fhRange.value,start=Math.max(1,fh-accumHours+1);
    const summed=baseRunCollection().filter(ee.Filter.gte('forecast_hour',start)).filter(ee.Filter.lte('forecast_hour',fh))
      .select('total_precipitation_1hr_mean').sum();
    return p.transform(summed).rename('value');
  }
  return p.transform(getSingleImage().select(p.band+'_'+stat)).rename('value');
}

function buildProbabilityRangeImage(){
  const thresholdIn=parseFloat(els.qpfThreshold.value)||0.25,t=thresholdIn/39.3700787,img=getSingleImage();
  const q10=img.select('total_precipitation_1hr_p10'),q25=img.select('total_precipitation_1hr_p25'),
        q50=img.select('total_precipitation_1hr_p50'),q75=img.select('total_precipitation_1hr_p75'),
        q90=img.select('total_precipitation_1hr_p90');
  return ee.Image.constant(5).where(q90.gt(t),17.5).where(q75.gt(t),37.5).where(q50.gt(t),62.5).where(q25.gt(t),82.5).where(q10.gt(t),95).rename('value');
}

function renderLayer(){
  if(!connected)return;
  updateValidTime();setLoading(true);
  if(currentProduct==='precip'&&accumHours>+els.fhRange.value)accumHours=Math.max(1,+els.fhRange.value);
  currentImage=currentProduct==='qpfprob'?buildProbabilityRangeImage():buildStandardImage();
  const p=PRODUCTS[currentProduct],vis={min:p.min,max:p.max,palette:palettes[currentProduct]};
  currentImage.getMap(vis,(mapId,err)=>{
    setLoading(false);
    if(err){showMessage('Layer error',escapeHtml(err.message||String(err)),false);return}
    hideMessage();
    if(overlay){const idx=map.overlayMapTypes.getArray().indexOf(overlay);if(idx>=0)map.overlayMapTypes.removeAt(idx)}
    const tileSource=new ee.layers.EarthEngineTileSource(mapId);
    overlay=new ee.layers.ImageOverlay(tileSource);
    overlay.setOpacity(parseFloat(els.opacityRange.value));map.overlayMapTypes.push(overlay);updateLegend();
  });
}

function updateLegend(){
  const p=PRODUCTS[currentProduct];els.legend.classList.remove('hidden');
  els.legendTitle.textContent=p.title+(currentProduct==='precip'?' • '+accumHours+' h':'');
  els.legendGradient.style.background='linear-gradient(90deg,'+palettes[currentProduct].join(',')+')';
  if(currentProduct==='qpfprob'){
    els.legendMin.textContent='<10%';els.legendMid.textContent='50–75%';els.legendMax.textContent='>90%';
    els.legendNote.textContent='Bracketed probability of 1-h QPF > '+(+els.qpfThreshold.value).toFixed(2)+' in, inferred from published ensemble quantiles.';
  }else{
    els.legendMin.textContent=p.min+' '+p.unit;els.legendMid.textContent=((p.min+p.max)/2).toFixed(0)+' '+p.unit;els.legendMax.textContent=p.max+' '+p.unit;
    const stat=(currentProduct==='precip'&&accumHours>1)?'ensemble mean':els.statSelect.options[els.statSelect.selectedIndex].text.toLowerCase();
    els.legendNote.textContent=stat+' • WeatherNext 3 0.1° (~11 km) surface guidance';
  }
}

function samplePoint(lat,lng){
  if(!currentImage)return;
  els.pointReadout.classList.remove('hidden');els.readoutLocation.textContent=lat.toFixed(3)+', '+lng.toFixed(3);els.readoutValue.textContent='…';
  currentImage.reduceRegion({reducer:ee.Reducer.first(),geometry:ee.Geometry.Point([lng,lat]),scale:11000,bestEffort:true,maxPixels:1e6})
    .get('value').evaluate((v,err)=>{
      if(err||v==null){els.readoutValue.textContent='No data';return}
      if(currentProduct==='qpfprob'){
        els.readoutValue.textContent=v>=90?'>90%':v>=75?'75–90%':v>=50?'50–75%':v>=25?'25–50%':v>=10?'10–25%':'<10%';
      }else{
        const p=PRODUCTS[currentProduct],digits=currentProduct==='precip'?2:(currentProduct==='mslp'?1:0);
        els.readoutValue.textContent=Number(v).toFixed(digits)+' '+p.unit;
      }
      els.readoutMeta.textContent=formatRun(els.runSelect.value)+' • F'+String(els.fhRange.value).padStart(3,'0')+' • '+PRODUCTS[currentProduct].title;
    });
}

function selectProduct(name){
  currentProduct=name;document.querySelectorAll('.product').forEach(b=>b.classList.toggle('active',b.dataset.product===name));
  els.precipControls.classList.toggle('hidden',name!=='precip');els.probControls.classList.toggle('hidden',name!=='qpfprob');
  if(name==='qpfprob'){els.statSelect.value='mean';els.statSelect.disabled=true}
  else if(name==='precip'&&accumHours>1){els.statSelect.value='mean';els.statSelect.disabled=true}
  else els.statSelect.disabled=!connected;
  renderLayer();
}

els.settingsBtn.onclick=openSetup;els.messageSetupBtn.onclick=openSetup;
els.setupForm.addEventListener('submit',e=>{e.preventDefault();saveConfig();els.setupDialog.close();location.reload()});
els.clearConfigBtn.onclick=()=>{localStorage.removeItem(CONFIG_KEY);fillConfig()};
els.homeBtn.onclick=()=>map&&map.setOptions({center:LIX_CENTER,zoom:LIX_ZOOM});
els.refreshBtn.onclick=renderLayer;els.runSelect.onchange=()=>{updateHorizon();renderLayer()};
els.fhRange.oninput=()=>{els.fhNumber.value=els.fhRange.value;updateValidTime()};els.fhRange.onchange=renderLayer;
els.fhNumber.onchange=()=>{let v=Math.max(1,Math.min(+els.fhNumber.value,+els.fhNumber.max));els.fhNumber.value=v;els.fhRange.value=v;updateValidTime();renderLayer()};
els.statSelect.onchange=renderLayer;els.opacityRange.oninput=()=>overlay&&overlay.setOpacity(parseFloat(els.opacityRange.value));
els.qpfThreshold.onchange=renderLayer;els.readoutClose.onclick=()=>els.pointReadout.classList.add('hidden');
document.querySelectorAll('.product').forEach(b=>b.onclick=()=>selectProduct(b.dataset.product));
document.querySelectorAll('#accumGroup button').forEach(b=>b.onclick=()=>{
  document.querySelectorAll('#accumGroup button').forEach(x=>x.classList.remove('active'));b.classList.add('active');accumHours=+b.dataset.hours;
  if(accumHours>1){els.statSelect.value='mean';els.statSelect.disabled=true}else els.statSelect.disabled=!connected;renderLayer();
});

cfg=getSavedConfig();
if(cfg?.projectId&&cfg?.clientId&&cfg?.mapsKey)authenticate();else openSetup();
})();