(() => {
'use strict';

const CONFIG_KEY='wn3ExplorerConfigV2';
const TABLE='weathernext_3_0_0_0p1deg';
const LIX_CENTER={lat:30.25,lng:-90.2};
const LIX_ZOOM=7;
const REGION_WKT='POLYGON((-94.5 27.0,-86.0 27.0,-86.0 35.5,-94.5 35.5,-94.5 27.0))';

const palettes={
  temp:['#4b0082','#2d2bc7','#2768e8','#28a9ef','#67d7df','#9de187','#e4e76f','#ffd34e','#ff9b3f','#ef5038','#b5152c'],
  dewpoint:['#5b3a29','#9b6f45','#d7b46a','#ece39a','#b8dc87','#70c879','#2e9c68','#147a75','#16629a','#553e9e'],
  wind:['#f7fbff','#d8efff','#9ed7f5','#58b8e2','#2795c4','#17759e','#ffc857','#f28f3b','#d94f30'],
  precip:['#f7fbff','#d8f0d1','#92d483','#42b85c','#1b9348','#f0e442','#f5a142','#e65c3a','#c5283d','#8b1a8c'],
  mslp:['#552c8a','#4056b4','#3184c4','#5ab2c9','#a1d5c7','#e8e7bb','#e5b674','#d9794b','#b73b4b'],
  qpfprob:['#607080','#62a5cf','#55c4b0','#d6d65c','#f2a444','#d94c43']
};

const PRODUCTS={
  temp:{title:'2-m Temperature',unit:'°F',field:'temperature_2m',min:20,max:110,sql:x=>'('+x+'-273.15)*9/5+32'},
  dewpoint:{title:'2-m Dewpoint',unit:'°F',field:'dewpoint_temperature_2m',min:0,max:85,sql:x=>'('+x+'-273.15)*9/5+32'},
  wind:{title:'10-m Wind Speed',unit:'kt',field:'wind_speed_10m',min:0,max:45,sql:x=>x+'*1.943844'},
  precip:{title:'QPF',unit:'in',field:'total_precipitation_1hr',min:0,max:2.5,sql:x=>x+'*39.3700787'},
  mslp:{title:'Mean Sea-Level Pressure',unit:'hPa',field:'mean_sea_level_pressure',min:990,max:1035,sql:x=>x+'/100'},
  qpfprob:{title:'1-h QPF Exceedance Probability Range',unit:'%',min:0,max:100}
};

let cfg=null,accessToken=null,tokenClient=null,map=null,currentProduct='temp',accumHours=1,connected=false,currentRows=[];

const $=id=>document.getElementById(id);
const els={
  authBadge:$('authBadge'),settingsBtn:$('settingsBtn'),setupDialog:$('setupDialog'),setupForm:$('setupForm'),
  projectId:$('projectId'),datasetId:$('datasetId'),clientId:$('clientId'),mapsKey:$('mapsKey'),clearConfigBtn:$('clearConfigBtn'),
  runSelect:$('runSelect'),fhRange:$('fhRange'),fhNumber:$('fhNumber'),validTime:$('validTime'),statSelect:$('statSelect'),
  refreshBtn:$('refreshBtn'),homeBtn:$('homeBtn'),precipControls:$('precipControls'),probControls:$('probControls'),
  qpfThreshold:$('qpfThreshold'),opacityRange:$('opacityRange'),loading:$('loading'),message:$('message'),
  messageSetupBtn:$('messageSetupBtn'),legend:$('legend'),legendTitle:$('legendTitle'),legendGradient:$('legendGradient'),
  legendMin:$('legendMin'),legendMid:$('legendMid'),legendMax:$('legendMax'),legendNote:$('legendNote'),
  pointReadout:$('pointReadout'),readoutClose:$('readoutClose'),readoutLocation:$('readoutLocation'),
  readoutValue:$('readoutValue'),readoutMeta:$('readoutMeta')
};

function getSaved(){try{return JSON.parse(localStorage.getItem(CONFIG_KEY)||'null')}catch{return null}}
function saveConfig(){
  cfg={projectId:els.projectId.value.trim(),datasetId:els.datasetId.value.trim(),clientId:els.clientId.value.trim(),mapsKey:els.mapsKey.value.trim()};
  localStorage.setItem(CONFIG_KEY,JSON.stringify(cfg));
}
function fillConfig(){
  const s=getSaved()||{};
  els.projectId.value=s.projectId||'';els.datasetId.value=s.datasetId||'';els.clientId.value=s.clientId||'';els.mapsKey.value=s.mapsKey||'';
}
function openSetup(){fillConfig();els.setupDialog.showModal()}
function setLoading(on,text='Querying WeatherNext 3…'){els.loading.classList.toggle('hidden',!on);els.loading.querySelector('span').textContent=text}
function showMessage(title,body,setup=true){
  els.message.innerHTML='<b>'+title+'</b><span>'+body+'</span>'+(setup?'<button id="dynamicSetup" class="primary-btn">Open setup</button>':'');
  els.message.classList.remove('hidden');const b=$('dynamicSetup');if(b)b.onclick=openSetup;
}
function hideMessage(){els.message.classList.add('hidden')}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}

function validateConfig(c){
  if(!c?.projectId||!c?.datasetId||!c?.clientId||!c?.mapsKey)return false;
  if(!/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(c.projectId))throw new Error('Cloud Project ID does not look valid.');
  if(!/^[A-Za-z0-9_]+$/.test(c.datasetId))throw new Error('BigQuery dataset ID should contain only letters, numbers, and underscores.');
  return true;
}

function loadMaps(key){
  return new Promise((resolve,reject)=>{
    if(window.google?.maps)return resolve();
    window.__wn3MapsReady=resolve;
    const s=document.createElement('script');
    s.src='https://maps.googleapis.com/maps/api/js?key='+encodeURIComponent(key)+'&callback=__wn3MapsReady';
    s.async=true;s.defer=true;s.onerror=()=>reject(new Error('Google Maps failed to load. Check the Maps API key and referrer restriction.'));
    document.head.appendChild(s);
  });
}
function initMap(){
  if(map)return;
  map=new google.maps.Map($('map'),{center:LIX_CENTER,zoom:LIX_ZOOM,mapTypeId:'terrain',streetViewControl:false,fullscreenControl:true,mapTypeControl:true,gestureHandling:'greedy'});
  map.data.addListener('click',e=>{
    const v=Number(e.feature.getProperty('value')),lat=Number(e.feature.getProperty('lat')),lon=Number(e.feature.getProperty('lon'));
    showReadout(lat,lon,v);
  });
}

function waitForGIS(){
  return new Promise((resolve,reject)=>{
    let n=0;const t=setInterval(()=>{if(window.google?.accounts?.oauth2){clearInterval(t);resolve()}else if(++n>100){clearInterval(t);reject(new Error('Google Identity Services failed to load.'))}},100);
  });
}

async function connect(){
  cfg=getSaved();
  try{
    if(!validateConfig(cfg)){openSetup();return}
    setLoading(true,'Connecting to Google…');
    await Promise.all([loadMaps(cfg.mapsKey),waitForGIS()]);
    initMap();
    tokenClient=google.accounts.oauth2.initTokenClient({
      client_id:cfg.clientId,
      scope:'https://www.googleapis.com/auth/bigquery',
      callback:async resp=>{
        if(resp.error){connectionError(new Error(resp.error_description||resp.error));return}
        accessToken=resp.access_token;connected=true;
        els.authBadge.classList.remove('offline');els.authBadge.classList.add('online');els.authBadge.innerHTML='<span></span>BigQuery connected';
        [els.runSelect,els.fhRange,els.fhNumber,els.statSelect,els.refreshBtn].forEach(x=>x.disabled=false);
        hideMessage();
        try{await loadRuns()}catch(e){connectionError(e)}
      },
      error_callback:e=>connectionError(new Error(e?.message||e?.type||'OAuth failed'))
    });
    tokenClient.requestAccessToken({prompt:''});
  }catch(e){connectionError(e)}
}

function connectionError(err){
  setLoading(false);connected=false;
  const msg=(err&&err.message)||String(err||'Unknown connection error');
  showMessage('Connection failed',escapeHtml(msg)+'<br><br>This build uses BigQuery, not Earth Engine. Verify BigQuery API is enabled and your WeatherNext Analytics Hub linked dataset ID is correct.',true);
}

function tableRef(){return '`'+cfg.projectId+'.'+cfg.datasetId+'.'+TABLE+'`'}

async function bqQuery(query){
  const url='https://bigquery.googleapis.com/bigquery/v2/projects/'+encodeURIComponent(cfg.projectId)+'/queries';
  const r=await fetch(url,{method:'POST',headers:{Authorization:'Bearer '+accessToken,'Content-Type':'application/json'},body:JSON.stringify({query,useLegacySql:false,maxResults:10000,timeoutMs:20000})});
  const j=await r.json();
  if(!r.ok)throw new Error(j?.error?.message||'BigQuery query failed');
  let result=j;
  if(!j.jobComplete){
    const ref=j.jobReference;
    for(let i=0;i<20;i++){
      await new Promise(res=>setTimeout(res,800));
      const u='https://bigquery.googleapis.com/bigquery/v2/projects/'+encodeURIComponent(ref.projectId)+'/queries/'+encodeURIComponent(ref.jobId)+'?location='+encodeURIComponent(ref.location||'US')+'&maxResults=10000';
      const rr=await fetch(u,{headers:{Authorization:'Bearer '+accessToken}});
      result=await rr.json();
      if(!rr.ok)throw new Error(result?.error?.message||'BigQuery job failed');
      if(result.jobComplete)break;
    }
  }
  if(!result.jobComplete)throw new Error('BigQuery query timed out.');
  return parseBQ(result);
}

function parseBQ(j){
  const names=(j.schema?.fields||[]).map(f=>f.name);
  return (j.rows||[]).map(row=>{
    const o={};(row.f||[]).forEach((x,i)=>o[names[i]]=x.v);return o;
  });
}

async function loadRuns(){
  setLoading(true,'Finding recent WeatherNext runs…');
  const sql='SELECT DISTINCT init_time FROM '+tableRef()+' WHERE init_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 3 DAY) ORDER BY init_time DESC LIMIT 40';
  const rows=await bqQuery(sql);
  if(!rows.length)throw new Error('No WeatherNext 3 runs found in the linked BigQuery table.');
  els.runSelect.innerHTML='';
  rows.forEach((r,i)=>{
    const iso=new Date(r.init_time).toISOString();
    const o=document.createElement('option');o.value=iso;o.textContent=formatRun(iso)+(i===0?'  • latest':'');els.runSelect.appendChild(o);
  });
  updateHorizon();setLoading(false);await renderLayer();
}

function formatRun(iso){const d=new Date(iso);return d.toISOString().slice(0,10)+' '+String(d.getUTCHours()).padStart(2,'0')+'Z'}
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
function sqlTimestamp(iso){return new Date(iso).toISOString().replace('T',' ').replace('.000Z',' UTC')}

function buildMapSql(){
  const run=sqlTimestamp(els.runSelect.value),fh=+els.fhRange.value,stat=els.statSelect.value,p=PRODUCTS[currentProduct];
  const where="t.init_time = TIMESTAMP('"+run+"') AND ST_INTERSECTS(t.geography_polygon, ST_GEOGFROMTEXT('"+REGION_WKT+"'))";
  if(currentProduct==='precip'&&accumHours>1){
    const start=Math.max(1,fh-accumHours+1);
    return 'SELECT ST_X(t.geography) longitude, ST_Y(t.geography) latitude, SUM(f.total_precipitation_1hr_mean)*39.3700787 value FROM '+tableRef()+' t, UNNEST(t.forecast) f WHERE '+where+' AND f.hours BETWEEN '+start+' AND '+fh+' GROUP BY longitude, latitude';
  }
  if(currentProduct==='qpfprob'){
    const threshold=(parseFloat(els.qpfThreshold.value)||0.25)/39.3700787;
    return 'SELECT ST_X(t.geography) longitude, ST_Y(t.geography) latitude, CASE WHEN f.total_precipitation_1hr_p10 > '+threshold+' THEN 95 WHEN f.total_precipitation_1hr_p25 > '+threshold+' THEN 82.5 WHEN f.total_precipitation_1hr_p50 > '+threshold+' THEN 62.5 WHEN f.total_precipitation_1hr_p75 > '+threshold+' THEN 37.5 WHEN f.total_precipitation_1hr_p90 > '+threshold+' THEN 17.5 ELSE 5 END value FROM '+tableRef()+' t, UNNEST(t.forecast) f WHERE '+where+' AND f.hours = '+fh;
  }
  const expr=p.sql('f.'+p.field+'_'+stat);
  return 'SELECT ST_X(t.geography) longitude, ST_Y(t.geography) latitude, '+expr+' value FROM '+tableRef()+' t, UNNEST(t.forecast) f WHERE '+where+' AND f.hours = '+fh;
}

async function renderLayer(){
  if(!connected||currentProduct==='h500')return;
  updateValidTime();
  if(currentProduct==='precip'&&accumHours>+els.fhRange.value)accumHours=Math.max(1,+els.fhRange.value);
  setLoading(true,'Querying regional WeatherNext grid…');
  try{
    currentRows=await bqQuery(buildMapSql());
    if(!currentRows.length)throw new Error('No grid cells returned for this run / forecast hour.');
    drawGrid(currentRows);updateLegend();hideMessage();
  }catch(e){showMessage('Layer error',escapeHtml(e.message||String(e)),false)}
  finally{setLoading(false)}
}

function drawGrid(rows){
  map.data.forEach(f=>map.data.remove(f));
  const features=[];
  for(const r of rows){
    const lon=Number(r.longitude),lat=Number(r.latitude),value=Number(r.value);
    if(!Number.isFinite(lon)||!Number.isFinite(lat)||!Number.isFinite(value))continue;
    const d=0.05;
    features.push({type:'Feature',properties:{value,lat,lon},geometry:{type:'Polygon',coordinates:[[[lon-d,lat-d],[lon+d,lat-d],[lon+d,lat+d],[lon-d,lat+d],[lon-d,lat-d]]]}});
  }
  map.data.addGeoJson({type:'FeatureCollection',features});
  map.data.setStyle(f=>{
    const v=Number(f.getProperty('value')),p=PRODUCTS[currentProduct];
    return {fillColor:colorFor(v,p.min,p.max,palettes[currentProduct]),fillOpacity:parseFloat(els.opacityRange.value),strokeOpacity:0,clickable:true};
  });
}

function colorFor(v,min,max,palette){
  const x=Math.max(0,Math.min(0.999,(v-min)/(max-min)));
  return palette[Math.floor(x*palette.length)];
}

function updateLegend(){
  const p=PRODUCTS[currentProduct];els.legend.classList.remove('hidden');
  els.legendTitle.textContent=p.title+(currentProduct==='precip'?' • '+accumHours+' h':'');
  els.legendGradient.style.background='linear-gradient(90deg,'+palettes[currentProduct].join(',')+')';
  if(currentProduct==='qpfprob'){
    els.legendMin.textContent='<10%';els.legendMid.textContent='50–75%';els.legendMax.textContent='>90%';
    els.legendNote.textContent='Bracketed probability of 1-h QPF > '+(+els.qpfThreshold.value).toFixed(2)+' in from published WN3 quantiles.';
  }else{
    els.legendMin.textContent=p.min+' '+p.unit;els.legendMid.textContent=((p.min+p.max)/2).toFixed(0)+' '+p.unit;els.legendMax.textContent=p.max+' '+p.unit;
    const stat=(currentProduct==='precip'&&accumHours>1)?'ensemble mean':els.statSelect.options[els.statSelect.selectedIndex].text.toLowerCase();
    els.legendNote.textContent=stat+' • WeatherNext 3 0.1° (~11 km) BigQuery surface statistics';
  }
}

function showReadout(lat,lon,v){
  els.pointReadout.classList.remove('hidden');els.readoutLocation.textContent=lat.toFixed(2)+', '+lon.toFixed(2);
  if(currentProduct==='qpfprob'){
    els.readoutValue.textContent=v>=90?'>90%':v>=75?'75–90%':v>=50?'50–75%':v>=25?'25–50%':v>=10?'10–25%':'<10%';
  }else{
    const p=PRODUCTS[currentProduct],digits=currentProduct==='precip'?2:(currentProduct==='mslp'?1:0);
    els.readoutValue.textContent=v.toFixed(digits)+' '+p.unit;
  }
  els.readoutMeta.textContent=formatRun(els.runSelect.value)+' • F'+String(els.fhRange.value).padStart(3,'0')+' • '+PRODUCTS[currentProduct].title;
}

function selectProduct(name){
  if(name==='h500'){
    showMessage('500-mb heights are next','Pressure-level fields are in the raw 64-member GCS/Zarr store, not BigQuery. The repo is now structured so that backend can be added without Earth Engine.',false);return;
  }
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
els.statSelect.onchange=renderLayer;
els.opacityRange.oninput=()=>map&&map.data.setStyle(f=>{const p=PRODUCTS[currentProduct],v=Number(f.getProperty('value'));return{fillColor:colorFor(v,p.min,p.max,palettes[currentProduct]),fillOpacity:parseFloat(els.opacityRange.value),strokeOpacity:0}});
els.qpfThreshold.onchange=renderLayer;els.readoutClose.onclick=()=>els.pointReadout.classList.add('hidden');
document.querySelectorAll('.product').forEach(b=>b.onclick=()=>selectProduct(b.dataset.product));
document.querySelectorAll('#accumGroup button').forEach(b=>b.onclick=()=>{
  document.querySelectorAll('#accumGroup button').forEach(x=>x.classList.remove('active'));b.classList.add('active');accumHours=+b.dataset.hours;
  if(accumHours>1){els.statSelect.value='mean';els.statSelect.disabled=true}else els.statSelect.disabled=!connected;renderLayer();
});

cfg=getSaved();
if(cfg?.projectId&&cfg?.datasetId&&cfg?.clientId&&cfg?.mapsKey)connect();else openSetup();
})();
