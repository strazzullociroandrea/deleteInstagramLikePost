// Client-side JS per avviare/monitorare/fermare il job di deleteLike
(function(){
  const startBtn = document.getElementById('startBtn');
  const stopBtn = document.getElementById('stopBtn');
  const clearBtn = document.getElementById('clearBtn');
  const jobIdEl = document.getElementById('jobId');
  const jobStatusEl = document.getElementById('jobStatus');
  const totalDeletedEl = document.getElementById('totalDeleted');
  const infoEl = document.getElementById('info');
  const logEl = document.getElementById('log');

  let pollInterval = null;
  let currentJobId = localStorage.getItem('deleteJobId') || null;

  function appendLog(msg){
    const ts = new Date().toLocaleTimeString();
    logEl.textContent = `${ts} - ${msg}\n` + logEl.textContent;
  }

  async function startJob(){
    startBtn.disabled = true;
    appendLog('Richiesta avvio job al server...');
    try{
      const res = await fetch('/startDelete', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({}) });
      const data = await res.json();
      if(data && data.jobId){
        currentJobId = data.jobId;
        localStorage.setItem('deleteJobId', currentJobId);
        jobIdEl.textContent = currentJobId;
        jobStatusEl.textContent = 'queued';
        stopBtn.disabled = false;
        appendLog('Job avviato: ' + currentJobId);
        startPolling();
      } else {
        appendLog('Risposta server non valida: ' + JSON.stringify(data));
        startBtn.disabled = false;
      }
    }catch(e){
      appendLog('Errore avviando job: ' + String(e));
      startBtn.disabled = false;
    }
  }

  async function stopJob(){
    if(!currentJobId){ appendLog('Nessun job attivo.'); return; }
    appendLog('Richiesta stop job ' + currentJobId);
    try{
      const res = await fetch('/stop/' + encodeURIComponent(currentJobId), { method: 'POST' });
      const data = await res.json();
      appendLog('Stop richiesto: ' + JSON.stringify(data));
      stopBtn.disabled = true;
    }catch(e){
      appendLog('Errore richiesta stop: ' + String(e));
    }
  }

  async function fetchStatus(){
    if(!currentJobId) return stopPolling();
    try{
      const res = await fetch('/status/' + encodeURIComponent(currentJobId));
      if(res.status === 404){
        appendLog('Job non trovato sul server (404). Rimuovere job locale o riprovare).');
        jobStatusEl.textContent = 'not_found';
        return;
      }
      const data = await res.json();
      jobStatusEl.textContent = data.status || 'unknown';
      jobIdEl.textContent = data.id || currentJobId;
      totalDeletedEl.textContent = (data.progress && data.progress.totalDeleted) ? data.progress.totalDeleted : 0;
      infoEl.textContent = data.error || (data.startedAt ? `avviato ${data.startedAt}` : '—');
      appendLog(`Stato: ${data.status} — eliminati: ${totalDeletedEl.textContent}`);

      if(['done','stopped','error'].includes(data.status)){
        appendLog('Job terminato con stato: ' + data.status);
        stopPolling();
        startBtn.disabled = false;
        stopBtn.disabled = true;
      } else {
        // job ancora attivo
        startBtn.disabled = true;
        stopBtn.disabled = false;
      }
    }catch(e){
      appendLog('Errore fetching status: ' + String(e));
    }
  }

  function startPolling(){
    if(pollInterval) return;
    fetchStatus();
    pollInterval = setInterval(fetchStatus, 2000);
  }

  function stopPolling(){
    if(pollInterval){ clearInterval(pollInterval); pollInterval = null; }
  }

  clearBtn.addEventListener('click', ()=>{
    appendLog('Rimuovo jobId locale');
    localStorage.removeItem('deleteJobId');
    currentJobId = null;
    jobIdEl.textContent = '—';
    jobStatusEl.textContent = 'idle';
    totalDeletedEl.textContent = '0';
    stopBtn.disabled = true;
    startBtn.disabled = false;
    stopPolling();
  });

  startBtn.addEventListener('click', startJob);
  stopBtn.addEventListener('click', stopJob);

  // Se avevamo un job salvato, ricominciamo a fare polling per mostrarne lo stato
  if(currentJobId){
    appendLog('Trovato jobId locale: ' + currentJobId + ' — ripristino polling stato');
    jobIdEl.textContent = currentJobId;
    startPolling();
  }
})();

