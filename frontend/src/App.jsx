import { useEffect, useMemo, useState } from 'react';
import {
  Activity, AlertTriangle, ArrowDown, ArrowRight, Check, CheckCircle2, Circle,
  Clock3, Cpu, Database, History, LoaderCircle, RefreshCw, ShieldCheck,
  Sparkles, Zap
} from 'lucide-react';

const DEMO_INCIDENT = {
  service: 'payment-service',
  severity: 'SEV-2',
  environment: 'Production',
  title: 'Payment service connection-pool exhaustion',
  symptoms: 'Payment requests are timing out because the database connection pool is exhausted.',
  logs: 'pool checkout timeout; connection acquisition exceeded 30s'
};

const EMPTY_RESOLUTION = {
  rootCause: '', action: '', outcome: '', resolutionMinutes: '', lesson: ''
};

const FLOW = [
  ['observe', 'OBSERVE'], ['recall', 'RECALL'], ['reason', 'REASON'],
  ['recommend', 'RECOMMEND'], ['simulate', 'SIMULATE'], ['resolve', 'RESOLVE'], ['learn', 'LEARN']
];

function memoryText(memory) {
  return memory?.text || memory?.content || memory?.summary || '';
}

function evidenceField(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].trim().replace(/[.;,]+$/, '');
  }
  return 'Not stated in this recalled evidence.';
}

function memoryFacts(memory) {
  const text = memoryText(memory);
  return {
    rootCause: evidenceField(text, [
      /root cause(?: was)?\s*:?\s*([^.|]+)/i,
      /caused by\s+([^.|]+)/i,
      /caused the\s+([^.|]+)/i
    ]),
    successfulFix: evidenceField(text, [
      /successfully resolved by\s+([^.|]+)/i,
      /resolved after\s+([^.|]+)/i,
      /resolution\s*:\s*([^.|]+)/i,
      /remediation\s*:\s*([^.|]+)/i,
      /action\s*:\s*([^.|]+)/i
    ]),
    lesson: evidenceField(text, [
      /lesson(?: learned)?\s*:\s*([^.|]+)/i,
      /learned that\s+([^.|]+)/i,
      /next time\s*:\s*([^.|]+)/i
    ])
  };
}

function firstMemoryFact(memories, key) {
  for (const memory of memories) {
    const value = memoryFacts(memory)[key];
    if (value && value !== 'Not stated in this recalled evidence.') return value;
  }
  return 'Not stated in recalled evidence.';
}

function memoryIncident(memory, index) {
  const text = memoryText(memory);
  const topic = (memory?.entities || []).slice(0, 3).join(' · ');
  const mentioned = text.match(/incident\s+(.+?)\s+(?:occurred|was|involved|:)/i)?.[1];
  if (mentioned && !mentioned.startsWith('recallops-verify')) return mentioned;
  return topic || `Retrieved incident ${index + 1}`;
}

function getErrorMessage(message) {
  if (/429|resource_exhausted|quota/i.test(message || '')) {
    return 'Gemini memory-generation quota is currently exhausted. The verified Hindsight retain/recall pipeline is implemented.';
  }
  return message || 'The request could not be completed.';
}

function FlowState({ state }) {
  const completed = state === 'complete';
  const current = state === 'current';
  return <span className={`flow-state ${completed ? 'complete' : current ? 'current' : 'pending'}`}>
    {completed ? <Check size={12} /> : current ? <span className="flow-pulse" /> : <Circle size={10} />}
    {completed ? 'DONE' : current ? 'CURRENT' : 'PENDING'}
  </span>;
}

function MemoryCard({ memory, index }) {
  const text = memoryText(memory);
  const { rootCause, successfulFix, lesson } = memoryFacts(memory);

  return <article className="memory-entry">
    <div className="memory-entry-heading">
      <span className="memory-index">0{index + 1}</span>
      <div><span className="retrieved-label"><Database size={12} /> Retrieved from Hindsight</span><h4>{memoryIncident(memory, index)}</h4></div>
      {memory?.scores?.final != null && <span className="match-score">{Math.round(memory.scores.final * 100)}% match</span>}
    </div>
    <div className="memory-facts">
      <div><span>ROOT CAUSE</span><p>{rootCause}</p></div>
      <div><span>SUCCESSFUL FIX</span><p>{successfulFix}</p></div>
      <div><span>LESSON</span><p>{lesson}</p></div>
    </div>
    <details className="evidence-details"><summary>Relevant evidence</summary><p>{text || 'No text evidence returned.'}</p></details>
  </article>;
}

export default function App() {
  const [status, setStatus] = useState(null);
  const [backendReachable, setBackendReachable] = useState(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [incident, setIncident] = useState(DEMO_INCIDENT);
  const [resolution, setResolution] = useState(EMPTY_RESOLUTION);
  const [analysis, setAnalysis] = useState(null);
  const [simulation, setSimulation] = useState(null);
  const [lastResolved, setLastResolved] = useState(null);
  const [timeline, setTimeline] = useState([]);
  const [busy, setBusy] = useState(false);
  const [busyAction, setBusyAction] = useState('');
  const [error, setError] = useState('');
  const [retainUnavailable, setRetainUnavailable] = useState(false);
  // Non-generative startup checks cannot determine Gemini quota. Keep it unknown until a real retain response.
  const [quotaState, setQuotaState] = useState('unknown');

  async function refreshStatus() {
    setStatusLoading(true);
    try {
      const response = await fetch('/api/hindsight/status');
      const data = await response.json();
      setBackendReachable(true);
      setStatus(data);
    } catch (err) {
      setBackendReachable(false);
      setStatus({ connected: false, error: err.message });
    } finally {
      setStatusLoading(false);
    }
  }

  useEffect(() => { refreshStatus(); }, []);

  const memories = analysis?.recalled || [];
  const recommendation = analysis?.recommendation;
  const recallCount = memories.length;

  const milestones = useMemo(() => ({
    observe: Boolean(timeline.some((item) => item.key === 'observe')),
    recall: Boolean(timeline.some((item) => item.key === 'recall')),
    reason: Boolean(timeline.some((item) => item.key === 'reason')),
    recommend: Boolean(timeline.some((item) => item.key === 'recommend')),
    simulate: Boolean(simulation),
    resolve: Boolean(timeline.some((item) => item.key === 'resolve')),
    learn: Boolean(timeline.some((item) => item.key === 'learn'))
  }), [timeline, simulation, lastResolved]);

  function recordMilestone(key, label, detail) {
    setTimeline((items) => {
      const next = items.filter((item) => item.key !== key);
      return [...next, { key, label, detail, time: new Date().toLocaleTimeString() }];
    });
  }

  async function analyzeIncident(event) {
    event?.preventDefault();
    setBusy(true);
    setBusyAction('analyze');
    setError('');
    setSimulation(null);
    setTimeline([]);
    try {
      const summary = [incident.symptoms, incident.logs && `Error / logs: ${incident.logs}`, `Severity: ${incident.severity}`, `Environment: ${incident.environment}`]
        .filter(Boolean).join('\n');
      const response = await fetch('/api/incidents/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ service: incident.service, title: incident.title, summary })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `Analysis failed (${response.status}).`);
      setAnalysis(data);
      setResolution(EMPTY_RESOLUTION);
      setBackendReachable(true);
      recordMilestone('observe', 'Incident detected', `${incident.service} · ${incident.severity} · ${incident.environment}`);
      recordMilestone('analyzed', 'Incident analyzed', incident.title);
      recordMilestone('recall', 'Hindsight recall completed', `${data.recalled?.length || 0} memories returned from live recall`);
      recordMilestone('reason', 'Agent reasoning completed', data.recalled?.length ? 'Assessment used recalled incident evidence' : 'No relevant memory; baseline analysis used');
      recordMilestone('recommend', 'Recommendation generated', data.recommendation?.title || 'Recommendation ready');
    } catch (err) {
      setAnalysis(null);
      const message = err.message || 'Incident analysis failed.';
      setError(getErrorMessage(message));
      if (/failed to fetch|networkerror|load failed/i.test(message)) {
        setBackendReachable(false);
        setStatus(null);
      }
      if (/429|resource_exhausted|quota/i.test(message)) setQuotaState('exhausted');
    } finally {
      setBusy(false);
      setBusyAction('');
    }
  }

  function simulateRemediation() {
    if (!recommendation) return;
    const steps = recommendation.steps || [];
    setSimulation({ steps, completedAt: new Date().toLocaleTimeString() });
    recordMilestone('simulate', 'Safe remediation simulated', `${steps.length} operational steps · no production changes`);
    setError('');
  }

  async function resolveAndLearn(event) {
    event?.preventDefault();
    if (!simulation || !resolution.rootCause.trim() || !resolution.action.trim() || !resolution.outcome.trim() || !resolution.lesson.trim() || resolution.resolutionMinutes === '') return;
    setBusy(true);
    setBusyAction('resolve');
    setError('');
    setRetainUnavailable(false);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);
    try {
      const response = await fetch('/api/incidents/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          incident: { service: incident.service, title: incident.title },
          ...resolution
        })
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        const requestError = new Error(data.error || `Resolution failed (${response.status}).`);
        requestError.status = response.status;
        requestError.code = data.code;
        throw requestError;
      }

      const resolved = {
        ...resolution,
        incidentId: data.incidentId,
        title: incident.title,
        service: incident.service,
        retained: true
      };
      setLastResolved(resolved);
      setQuotaState('available');
      recordMilestone('resolve', 'Incident resolved', `${data.incidentId} · ${resolution.resolutionMinutes} minutes`);
      recordMilestone('learn', 'Outcome submitted for memory retention', 'Backend confirmed successful Hindsight retain');
      setBackendReachable(true);
      await refreshStatus();
    } catch (err) {
      const message = err.message || 'Incident resolution failed.';
      if (err.status === 503 || err.code === 'HINDSIGHT_TEMPORARILY_UNAVAILABLE') {
        setRetainUnavailable(true);
      } else if (err.name === 'AbortError') {
        setError('The request timed out before retention was confirmed. This session has not marked the outcome as learned; check the backend before submitting again.');
      } else {
        setError(getErrorMessage(message));
      }
      if (/failed to fetch|networkerror|load failed/i.test(message)) {
        setBackendReachable(false);
        setStatus(null);
      }
      if (/429|resource_exhausted|quota/i.test(message)) setQuotaState('exhausted');
    } finally {
      clearTimeout(timeoutId);
      setBusy(false);
      setBusyAction('');
    }
  }

  function startSimilarIncident() {
    setIncident({
      ...DEMO_INCIDENT,
      symptoms: 'Similar payment requests are timing out again and the connection pool is exhausted.'
    });
    setAnalysis(null);
    setSimulation(null);
    setResolution(EMPTY_RESOLUTION);
    setTimeline([]);
    setError('');
    setRetainUnavailable(false);
  }

  const recalledRoot = memories.length
    ? 'Historical root-cause evidence is shown in the Hindsight Memory panel.'
    : 'No historical root-cause signal was returned; assess pool saturation and database capacity.';
  const whyRecommendation = memories.length
    ? `This recommendation uses ${recallCount} memory result${recallCount === 1 ? '' : 's'} returned by Hindsight for this service and symptom.`
    : 'No relevant historical memory was returned. The recommendation uses a cautious baseline investigation path.';

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand-lockup">
        <div className="brand-mark"><Cpu size={20} /></div>
        <div><h1>RecallOps</h1><span>AI Incident Response Agent</span></div>
      </div>
      <p className="header-subtitle">An incident response agent that remembers what worked.</p>
      <div className="header-right">
        <div className={`hindsight-live ${status?.connected ? 'is-online' : 'is-offline'}`}>
          <i />{statusLoading ? 'CHECKING HINDSIGHT' : backendReachable === false ? 'STATUS UNAVAILABLE' : status?.connected ? 'HINDSIGHT ONLINE' : 'HINDSIGHT OFFLINE'}
        </div>
        <div className="header-meta"><span>Memory Engine <b>Hindsight</b></span><span>Version <b>{status?.version || '—'}</b></span></div>
        <button className="refresh-button" onClick={refreshStatus} disabled={statusLoading} aria-label="Refresh service status"><RefreshCw size={15} /></button>
      </div>
    </header>

    <main className="console">
      <section className="console-intro">
        <div><div className="overline"><Activity size={14} /> INCIDENT OPERATIONS CENTER</div><h2>Respond with context.<br /><em>Learn from every incident.</em></h2></div>
        <div className="intro-callout"><span>LIVE MEMORY BANK</span><b>{status?.bankId || 'recallops-incidents'}</b><small>{status?.connected ? 'Connected to the existing Hindsight service' : 'Waiting for Hindsight connection'}</small></div>
      </section>

      {backendReachable === false && <div className="alert-banner danger"><AlertTriangle size={17} /><div><b>Backend unavailable</b><span>Could not reach the RecallOps status API. Start the backend and retry.</span></div></div>}
      {backendReachable && status && !status.connected && <div className="alert-banner warning"><AlertTriangle size={17} /><div><b>Hindsight offline</b><span>Analysis can use the baseline path, but memory recall and learning are unavailable.</span></div></div>}
      {quotaState === 'exhausted' && <div className="alert-banner quota"><AlertTriangle size={17} /><div><b>HINDSIGHT LEARNING PAUSED</b><span>Gemini memory-generation quota is currently exhausted. The verified Hindsight retain/recall pipeline is implemented. This notice clears only after a confirmed successful retain.</span></div></div>}
      {quotaState === 'unknown' && <div className="alert-banner quota-unknown"><AlertTriangle size={17} /><div><b>GEMINI QUOTA UNVERIFIED</b><span>Status and health checks do not generate Gemini requests. Quota becomes available only after backend confirms a successful retain; a real 429 will mark learning paused.</span></div></div>}
      {quotaState === 'available' && <div className="alert-banner quota-ready"><CheckCircle2 size={17} /><div><b>HINDSIGHT LEARNING READY</b><span>The backend confirmed a successful retain with the current configuration.</span></div></div>}
      {retainUnavailable && <div className="alert-banner danger"><AlertTriangle size={17} /><div><b>HINDSIGHT LEARNING TEMPORARILY UNAVAILABLE</b><span>The AI memory service is temporarily overloaded. The incident outcome was not falsely marked as learned. No production systems were changed.</span></div></div>}
      {error && quotaState !== 'exhausted' && !retainUnavailable && <div className="alert-banner danger"><AlertTriangle size={17} /><div><b>Request could not be completed</b><span>{error}</span></div></div>}

      <div className="main-grid">
        <div className="primary-column">
          <section className="panel incident-panel">
            <div className="panel-heading"><div className="panel-icon blue"><Activity size={17} /></div><div><span className="panel-kicker">OBSERVE</span><h3>Active incident</h3></div><span className={`incident-status ${lastResolved ? 'resolved' : analysis ? 'analyzed' : ''}`}><i />{lastResolved ? 'RESOLVED & RETAINED' : analysis ? 'ANALYSIS COMPLETE' : 'AWAITING ANALYSIS'}</span></div>
            <form className="incident-form" onSubmit={analyzeIncident}>
              <div className="form-row">
                <label>Service<input required value={incident.service} onChange={(e) => setIncident({ ...incident, service: e.target.value })} /></label>
                <label>Severity<select value={incident.severity} onChange={(e) => setIncident({ ...incident, severity: e.target.value })}><option>SEV-1</option><option>SEV-2</option><option>SEV-3</option><option>SEV-4</option></select></label>
                <label>Environment<select value={incident.environment} onChange={(e) => setIncident({ ...incident, environment: e.target.value })}><option>Production</option><option>Staging</option><option>Development</option></select></label>
              </div>
              <label>Incident title<input required value={incident.title} onChange={(e) => setIncident({ ...incident, title: e.target.value })} /></label>
              <label>Symptoms<textarea required rows="2" value={incident.symptoms} onChange={(e) => setIncident({ ...incident, symptoms: e.target.value })} /></label>
              <label>Error / logs<div className="log-field"><span>&gt;_</span><input value={incident.logs} onChange={(e) => setIncident({ ...incident, logs: e.target.value })} /></div></label>
              <div className="form-actions"><small>Analysis performs a live recall from the configured Hindsight bank.</small><button className="button-primary" disabled={busy}><Zap size={16} />{busyAction === 'analyze' ? 'ANALYZING…' : 'ANALYZE INCIDENT'}<ArrowRight size={15} /></button></div>
            </form>
          </section>

          <section className="panel analysis-panel">
            <div className="panel-heading"><div className="panel-icon purple"><Sparkles size={17} /></div><div><span className="panel-kicker">REASON · RECOMMEND</span><h3>Agent analysis</h3></div>{analysis && <span className={`analysis-mode ${memories.length ? 'learned' : 'baseline'}`}>{memories.length ? 'LEARNED FROM PREVIOUS INCIDENT' : 'BASELINE ANALYSIS'}</span>}</div>
            {!analysis ? <div className="placeholder-state"><Cpu size={21} /><b>Analysis will appear here</b><span>Submit an incident to see recall, reasoning, and the recommended response.</span></div> : <>
              <div className="analysis-summary"><div className="summary-chip"><span>ASSESSMENT</span><b>{recommendation?.mode === 'learned' ? 'Memory informed' : 'Baseline'}</b></div><div className="summary-chip"><span>MEMORIES RECALLED</span><b>{recallCount}</b></div><div className="summary-chip"><span>SEVERITY</span><b className="severity-text">{incident.severity}</b></div></div>
              <div className="analysis-block"><span className="analysis-label">ROOT CAUSE SIGNAL</span><p>{recalledRoot}</p></div>
              <div className="recommendation-box"><div className="recommendation-title"><div><span className="analysis-label">RECOMMENDED ACTION</span><h4>{recommendation?.title}</h4></div><span className="safe-chip"><ShieldCheck size={13} />SIMULATION ONLY</span></div><ol>{(recommendation?.steps || []).map((step, index) => <li key={`${index}-${step}`}><span>{String(index + 1).padStart(2, '0')}</span>{step}</li>)}</ol></div>
              <div className="analysis-block why-block"><span className="analysis-label">WHY THIS RECOMMENDATION</span><p>{whyRecommendation}</p>{memories.length > 0 && <span className="learned-callout"><Sparkles size={13} />Historical evidence influenced the response. See the retrieved facts at right.</span>}</div>
            </>}
          </section>

          {analysis && <section className="panel simulation-panel">
            <div className="panel-heading"><div className="panel-icon green"><ShieldCheck size={17} /></div><div><span className="panel-kicker">SIMULATE</span><h3>Safe remediation</h3></div><span className="safe-chip"><ShieldCheck size={13} />NO PRODUCTION SYSTEMS ARE CHANGED</span></div>
            {simulation ? <div className="simulation-result"><div className="simulation-banner"><CheckCircle2 size={17} /><div><b>SAFE SIMULATION COMPLETE</b><span>Steps recorded locally at {simulation.completedAt}. No infrastructure command was executed.</span></div></div><ol>{simulation.steps.map((step, i) => <li key={`${i}-${step}`}><Check size={14} />{step}</li>)}</ol></div> : <><p className="panel-description">Review the recommendation, then run a local demonstration of the operational steps.</p><button className="button-secondary" onClick={simulateRemediation}><Zap size={15} />SIMULATE REMEDIATION</button></>}
          </section>}

          {analysis && simulation && !lastResolved && <section className="panel resolution-panel">
            <div className="panel-heading"><div className="panel-icon amber"><CheckCircle2 size={17} /></div><div><span className="panel-kicker">RESOLVE · LEARN</span><h3>Resolve incident</h3></div></div>
            <p className="panel-description">Enter confirmed incident findings. A learning success appears only after the backend confirms Hindsight retention.</p>
            <form className="resolution-form" onSubmit={resolveAndLearn}>
              <label>Actual root cause<input required value={resolution.rootCause} onChange={(e) => setResolution({ ...resolution, rootCause: e.target.value })} placeholder="What caused the incident?" /></label>
              <label>Action taken<input required value={resolution.action} onChange={(e) => setResolution({ ...resolution, action: e.target.value })} placeholder="Describe the simulated action" /></label>
              <div className="form-row outcome-row"><label>Outcome<input required value={resolution.outcome} onChange={(e) => setResolution({ ...resolution, outcome: e.target.value })} placeholder="What changed in the simulation?" /></label><label>Resolution time<input required type="number" min="0" value={resolution.resolutionMinutes} onChange={(e) => setResolution({ ...resolution, resolutionMinutes: e.target.value })} placeholder="Minutes" /></label></div>
              <label>Lesson learned<input required value={resolution.lesson} onChange={(e) => setResolution({ ...resolution, lesson: e.target.value })} placeholder="What should the next response remember?" /></label>
              <button className="button-primary resolve-button" disabled={busy}>{busyAction === 'resolve' ? <><LoaderCircle className="spin" size={15} />UPDATING HINDSIGHT MEMORY…</> : <><Check size={15} />RESOLVE &amp; LEARN</>}</button>
              {busyAction === 'resolve' && <p className="retain-progress" role="status">Recording this incident and updating operational memory.</p>}
            </form>
          </section>}
        </div>

        <aside className="side-column">
          <section className="panel memory-panel">
            <div className="memory-panel-glow" />
            <div className="panel-heading memory-heading"><div className="panel-icon cyan"><Database size={17} /></div><div><span className="panel-kicker">LIVE RECALL</span><h3>Hindsight Memory</h3></div><span className={`memory-live-dot ${status?.connected ? 'online' : 'offline'}`} title={status?.connected ? 'Connected' : backendReachable === false ? 'Status unavailable' : 'Offline'} /></div>
          <div className="memory-count"><b>{analysis ? recallCount : '—'}</b><span>{analysis ? `REAL ${recallCount === 1 ? 'MEMORY' : 'MEMORIES'} RECALLED` : 'REAL MEMORY RECALL'}</span><small>{analysis ? 'Returned by the live Hindsight API' : 'Awaiting incident analysis'}</small></div>
            {!analysis ? <div className="memory-empty"><History size={20} /><b>Memory recall not run yet</b><p>Analyze an incident to retrieve related historical evidence.</p></div> : recallCount === 0 ? <div className="memory-empty no-history"><History size={20} /><b>No relevant historical memory found.</b><p>Baseline analysis — this incident has not yet been learned.</p></div> : <div className="memory-entries">{memories.map((memory, index) => <MemoryCard key={memory.id || index} memory={memory} index={index} />)}</div>}
            {status?.connected && <div className="memory-origin"><Database size={12} />ALL EVIDENCE RETRIEVED FROM HINDSIGHT</div>}
          </section>

          <section className="panel workflow-panel">
            <div className="panel-heading"><div className="panel-icon purple"><Activity size={17} /></div><div><span className="panel-kicker">RESPONSE PIPELINE</span><h3>Agent workflow</h3></div></div>
            <div className="workflow-list">{FLOW.map(([key, label], index) => {
              const done = milestones[key];
              const current = !done && (index === 0 || milestones[FLOW[index - 1][0]]);
              return <div className={`workflow-step ${done ? 'done' : current ? 'active' : ''}`} key={key}><div className="workflow-number">{done ? <Check size={13} /> : String(index + 1).padStart(2, '0')}</div><span>{label}</span><FlowState state={done ? 'complete' : current ? 'current' : 'pending'} /></div>;
            })}</div>
          </section>

          <section className="panel timeline-panel">
            <div className="panel-heading"><div className="panel-icon amber"><Clock3 size={17} /></div><div><span className="panel-kicker">SESSION EVENTS</span><h3>Learning timeline</h3></div></div>
            {timeline.length ? <div className="event-timeline">{timeline.map((item) => <div className="event-item" key={item.key}><i className="event-dot" /><div><b>{item.label}</b><span>{item.detail}</span><small>{item.time}</small></div></div>)}</div> : <div className="timeline-empty"><span>01</span><p>Incident detected</p><small>Waiting for analysis to begin the timeline</small></div>}
          </section>
        </aside>
      </div>

      <section className="learning-loop panel">
        <div className="loop-heading"><span className="panel-kicker">THE RECALL-AND-LEARN LOOP</span><h3>Every resolved incident can make the next response better.</h3><p>“After memory” is shown only when Hindsight actually returns or confirms a memory.</p></div>
        <div className="loop-flow">
          <div className="loop-card"><span>BEFORE MEMORY</span><b>Baseline recommendation</b><small>{!analysis ? 'Awaiting an incident analysis' : recallCount > 0 ? 'This analysis found relevant history.' : 'No relevant historical memory'}</small><i className={analysis && recallCount > 0 ? 'loop-seen' : ''}>{!analysis ? 'NOT RUN' : recallCount > 0 ? 'HISTORY FOUND' : 'BASELINE'}</i></div>
          <ArrowRight className="loop-arrow" size={19} />
          <div className="loop-card middle"><span>INCIDENT RESOLVED</span><b>{lastResolved ? 'Outcome captured' : 'Outcome pending'}</b><small>{lastResolved ? `${lastResolved.resolutionMinutes} min · retained confirmation received` : 'Simulation and operator findings required'}</small><i className={lastResolved ? 'loop-seen' : ''}>{lastResolved ? 'CONFIRMED' : 'PENDING'}</i></div>
          <ArrowRight className="loop-arrow" size={19} />
          <div className="loop-card after"><span>AFTER MEMORY</span><b>{memories.length > 0 || lastResolved ? 'Historical learning available' : 'Waiting for a confirmed memory'}</b><small>{memories.length > 0 ? `${recallCount} historical result${recallCount === 1 ? '' : 's'} recalled` : lastResolved ? 'Retained by Hindsight; analyze a similar incident to verify recall' : 'No after-memory is being claimed'}</small><i className={memories.length > 0 || lastResolved ? 'loop-seen' : ''}>{memories.length > 0 ? 'RECALLED' : lastResolved ? 'RETAINED' : 'NOT YET LEARNED'}</i>{memories.length > 0 && <div className="loop-facts"><span>Previous root cause remembered</span><b>{firstMemoryFact(memories, 'rootCause')}</b><span>Previous successful fix remembered</span><b>{firstMemoryFact(memories, 'successfulFix')}</b></div>}{!memories.length && lastResolved && <div className="loop-facts"><span>Root cause retained</span><b>{lastResolved.rootCause}</b><span>Successful fix retained</span><b>{lastResolved.action}</b></div>}</div>
        </div>
      </section>

      <section className="similar-incident-bar"><div><span className="panel-kicker">CONTINUE THE DEMO</span><b>Test the response against a similar incident</b><small>Prepares the incident form; analysis still calls the real backend.</small></div><button className="button-secondary" onClick={startSimilarIncident}><RefreshCw size={14} />NEW SIMILAR INCIDENT</button></section>

      <footer className="console-footer"><span><ShieldCheck size={14} />SAFE SIMULATION — NO PRODUCTION SYSTEMS ARE CHANGED</span><span>RecallOps <i /> Hindsight memory-backed response</span></footer>
    </main>
  </div>;
}
