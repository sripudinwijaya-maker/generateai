(() => {
const $=id=>document.getElementById(id);
const API_BASE='https://api.emix.ai/api/v1/client/tasks';
let apiKey='', request=null, pollTimer=null;
const toast=(s)=>{const t=$('toast');t.textContent=s;t.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.classList.remove('show'),3200)};
document.querySelectorAll('.tab[data-page]').forEach(btn=>btn.addEventListener('click',()=>{
 document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('active',b===btn));
 document.querySelectorAll('.page').forEach(p=>p.classList.toggle('show',p.id===btn.dataset.page));
}));
$('klingTab').addEventListener('click',()=>toast('Kling 2.6 Motion Control kita aktifkan di update berikutnya.'));
$('instrumental').addEventListener('change',()=>{$('lyricsBox').style.opacity=$('instrumental').checked?'.45':'1';$('lyrics').disabled=$('instrumental').checked});
$('toggleKey').addEventListener('click',()=>{$('apiKey').type=$('apiKey').type==='password'?'text':'password'});
$('connectBtn').addEventListener('click',()=>{
 const k=$('apiKey').value.trim();
 if(!k){toast('Tempel API key terlebih dahulu');$('apiKey').focus();return}
 apiKey=k;$('apiDot').classList.add('ready');$('apiStatus').textContent='API key dimasukkan di tab ini · belum diuji';toast('API key siap dipakai di tab ini');
});
$('apiKey').addEventListener('input',()=>{apiKey='';$('apiDot').classList.remove('ready');$('apiStatus').textContent='Belum tersambung · API key tidak disimpan'});
function getKey(){const field=$('apiKey').value.trim();if(field)apiKey=field;if(!apiKey){toast('Masukkan API key lalu tekan Sambungkan');$('apiKey').focus();return null}return apiKey}
async function apiFetch(path,options={}){
 const key=getKey();if(!key)throw new Error('API key belum dimasukkan');
 const response=await fetch(API_BASE+path,{...options,headers:{Authorization:'Bearer '+key,'Content-Type':'application/json',...(options.headers||{})}});
 const raw=await response.text();let data;try{data=JSON.parse(raw)}catch{data={raw}};
 if(!response.ok)throw new Error((data.msg||data.message||data.error||`HTTP ${response.status}`)+` (HTTP ${response.status})`);
 if(data.code && Number(data.code)>=400)throw new Error((data.msg||data.message||`API error ${data.code}`)+` (code ${data.code})`);
 return data;
}
function setBusy(busy){document.querySelectorAll('form .primary').forEach(b=>{b.disabled=busy;b.dataset.originalText ||= b.textContent;b.textContent=busy?'Mengirim...':b.dataset.originalText})}
function showResultPanel(title,status){$('resultPanel').hidden=false;$('resultHeading').textContent=title;$('resultStatus').textContent=status;$('resultItems').innerHTML=''}
function safeText(v){return String(v??'').replace(/[<>&"]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]))}
function findTaskId(data){
 const candidates=[data?.data?.taskId,data?.data?.task_id,data?.taskId,data?.task_id,data?.data?.id,data?.id];
 if(data?.data?.taskInfo)candidates.push(data.data.taskInfo.taskId,data.data.taskInfo.task_id);
 return candidates.find(v=>typeof v==='string'||typeof v==='number')||null;
}
function extractUrls(data){
 let objects=[data?.data,data?.data?.result,data?.result,data?.data?.response,data];
 const urls=[];
 for(const o of objects){
  if(!o)continue;
  let x=o.resultJson??o.result_json??o.response;
  if(typeof x==='string'){try{x=JSON.parse(x)}catch{}}
  if(x&&typeof x==='object')objects.push(x);
  for(const k of ['resultUrls','audioUrls','audio_urls','audioUrl','audio_url','url','audio','tracks','songs','data']){
   const v=o[k];
   if(typeof v==='string'&&/^https?:\/\//i.test(v))urls.push({url:v,title:o.title||o.songTitle||o.name||''});
   else if(Array.isArray(v))v.forEach(item=>{if(typeof item==='string'&&/^https?:\/\//i.test(item))urls.push({url:item,title:''});else if(item&&typeof item==='object'){const u=item.audioUrl||item.audio_url||item.url||item.streamAudioUrl||item.sourceAudioUrl;if(u)urls.push({url:u,title:item.title||item.songTitle||item.name||''})}});
   else if(v&&typeof v==='object'){const u=v.audioUrl||v.audio_url||v.url;if(u)urls.push({url:u,title:v.title||v.name||''})}
  }
 }
 return [...new Map(urls.map(x=>[x.url,x])).values()];
}
function renderResultUrls(urls){
 const host=$('resultItems');
 if(!urls.length){const d=document.createElement('div');d.className='result-item';d.innerHTML='<b>Task selesai, tetapi URL audio belum terbaca</b><div class="result-meta">Lihat detail respons API di bawah atau cek task ID di dashboard provider.</div>';host.append(d);return}
 urls.forEach((item,i)=>{
  const row=document.createElement('div');row.className='result-item';
  const title=document.createElement('b');title.textContent=item.title||`Track ${i+1}`;
  const audio=document.createElement('audio');audio.controls=true;audio.preload='none';audio.src=item.url;
  const link=document.createElement('a');link.href=item.url;link.target='_blank';link.rel='noopener';link.textContent='Buka / download audio';
  row.append(title,audio,link);host.append(row);
 });
}
function findTaskRecord(response, taskId){
 const root=response?.data??response;
 const candidates=[];
 const addArray=(v)=>{if(Array.isArray(v))candidates.push(...v);};
 if(root&&typeof root==='object'){
  addArray(root.records);addArray(root.list);addArray(root.rows);addArray(root.items);addArray(root.tasks);
  addArray(root.data?.records);addArray(root.data?.list);addArray(root.data?.rows);addArray(root.data?.items);addArray(root.data?.tasks);
  if(Array.isArray(root))candidates.push(...root);
  if(root.taskId||root.task_id||root.id)candidates.push(root);
 }
 const wanted=String(taskId);
 return candidates.find(x=>x&&String(x.taskId??x.task_id??x.id??x.taskID??'')===wanted)||null;
}
async function pollTask(taskId,title){
 showResultPanel(title,`Task dibuat: ${taskId}. Mengecek status setiap 4 detik...`);
 if(pollTimer)clearTimeout(pollTimer);
 const started=Date.now(), maxWait=20*60*1000;
 async function check(){
  try{
   // Endpoint client/tasks adalah daftar berhalaman; API mewajibkan pageSize dan pageNum.
   const response=await apiFetch('?pageSize=50&pageNum=1&taskId='+encodeURIComponent(taskId),{method:'GET',headers:{'Content-Type':'application/json'}});
   const d=findTaskRecord(response,taskId)||response?.data?.task||response?.task||response?.data||response;
   const state=String(d.state||d.status||d.taskStatus||d.task_status||d.data?.state||'unknown').toLowerCase();
   $('resultStatus').textContent=`Task ${taskId} · Status: ${state}`;
   if(['success','succeeded','completed','complete','finished','2'].includes(state)){
    const urls=extractUrls(d);renderResultUrls(urls);$('resultStatus').textContent=`Selesai · Task ${taskId}`;toast('Musik selesai diproses');return;
   }
   if(['fail','failed','failure','error','3'].includes(state)){const msg=d.failReason||d.fail_reason||d.errorMessage||d.error_message||d.message||response.msg||'Proses gagal';$('resultStatus').textContent=`Gagal: ${msg}`;toast('API gagal memproses task');return}
   if(Date.now()-started>maxWait){$('resultStatus').textContent=`Timeout menunggu hasil. Task ID: ${taskId}`;return}
   pollTimer=setTimeout(check,4000);
  }catch(err){$('resultStatus').textContent=`Tidak bisa cek status: ${err.message}. Akan mencoba lagi...`;if(Date.now()-started<maxWait)pollTimer=setTimeout(check,6000)}
 }
 check();
}
async function submitTask(model,input,title){
 if(!getKey())return;
 setBusy(true);showResultPanel(title,'Mengirim permintaan ke API...');
 try{
  const response=await apiFetch('',{method:'POST',body:JSON.stringify({model,input})});
  const taskId=findTaskId(response);
  if(!taskId){$('resultStatus').textContent='API merespons tetapi task ID tidak ditemukan: '+JSON.stringify(response).slice(0,500);toast('Respons API tidak memuat task ID');return}
  toast('Task berhasil dibuat');await pollTask(taskId,title);
 }catch(err){
  const message=err.message||'Unknown error';
  $('resultStatus').textContent=message.includes('Failed to fetch')?'Gagal menghubungi API. Kemungkinan CORS, koneksi, atau alamat API tidak menerima request dari file://. Coba host website atau gunakan backend proxy.':message;
  toast('Request API gagal');
 }finally{setBusy(false)}
}
$('generateForm').addEventListener('submit',async e=>{
 e.preventDefault();
 const instrumental=$('instrumental').checked;
 const input={model:$('model').value,customMode:true,title:$('title').value.trim()||'Untitled Track',prompt:$('prompt').value.trim(),style:$('style').value.trim(),duration:Number($('duration').value),instrumental};
 if($('negative').value.trim())input.negativeTags=$('negative').value.trim();
 if(!instrumental&&$('lyrics').value.trim())input.lyrics=$('lyrics').value.trim();
 if(!input.prompt&&!input.style){toast('Isi prompt atau style terlebih dahulu');return}
 if(!instrumental&&!input.style){toast('Isi genre/style agar request sesuai mode custom');return}
 if(!instrumental&&!input.lyrics&&!input.prompt){toast('Isi prompt atau lirik');return}
 await submitTask('suno/generate',input,'Hasil Generate Musik');
});
$('coverForm').addEventListener('submit',async e=>{
 e.preventDefault();const url=$('coverUrl').value.trim();
 if(!/^https?:\/\//i.test(url)){toast('Masukkan URL audio publik yang valid');return}
 const input={uploadUrl:url,model:$('coverModel').value,title:$('coverTitle').value.trim()||'Audio Cover',style:$('coverStyle').value.trim(),duration:Number($('coverDuration').value),instrumental:$('coverInstrumental').checked};
 await submitTask('suno/upload-and-cover-audio',input,'Hasil Cover Audio');
});
$('extendForm').addEventListener('submit',async e=>{
 e.preventDefault();const url=$('extendUrl').value.trim();
 if(!/^https?:\/\//i.test(url)){toast('Masukkan URL audio publik yang valid');return}
 const input={uploadUrl:url,model:$('extendModel').value,title:$('extendTitle').value.trim()||'Extended Track',style:$('extendStyle').value.trim(),instrumental:false,lyrics:$('extendStyle').value.trim(),continueAt:30};
 await submitTask('suno/upload-and-extend-audio',input,'Hasil Extend Cover');
});
})();