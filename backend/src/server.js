import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import {
  testHindsightConnection,
  retainMemory,
  recallMemories,
  reflectMemories,
  getBankId
} from './services/hindsightService.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// GET /api/health - Baseline Backend Health Check Endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'online',
    service: 'RecallOps API Engine',
    timestamp: new Date().toISOString(),
    hindsightConfig: {
      bankId: getBankId(),
      baseUrl: process.env.HINDSIGHT_BASE_URL || 'http://localhost:8888',
      configured: Boolean(process.env.HINDSIGHT_BASE_URL)
    },
    message: 'RecallOps Phase 2 backend service operational.'
  });
});

// GET /api/hindsight/status - REAL Hindsight Connection Probe Endpoint
app.get('/api/hindsight/status', async (req, res) => {
  const status = await testHindsightConnection();
  res.status(status.connected ? 200 : 503).json(status);
});

const DEMO_INCIDENT = {
  service: 'payment-service',
  title: 'Payment service connection-pool exhaustion',
  summary: 'Payment requests are timing out as the service exhausts its database connection pool.'
};

const safeSimulation = {
  mode: 'simulation',
  changedSystems: false,
  message: 'No infrastructure was changed. Remediation is shown as a safe simulation.'
};

function getRecallResults(response) {
  if (Array.isArray(response?.results)) return response.results;
  if (Array.isArray(response?.memories)) return response.memories;
  return [];
}

function memoryText(memory) {
  return [memory?.text, memory?.content, memory?.summary].filter(Boolean).join(' ');
}

function recommendFromMemories(memories) {
  const relevant = memories.filter((memory) =>
    /payment|connection.?pool|max_connections/i.test(memoryText(memory))
  );
  if (!relevant.length) {
    return {
      mode: 'baseline',
      title: 'Stabilize the pool, then inspect database capacity',
      steps: [
        'Check pool saturation, checkout wait time, and database connection limits.',
        'Reduce optional payment worker concurrency in a controlled simulation.',
        'Compare configured pool size with database capacity before proposing a limit change.'
      ],
      evidence: []
    };
  }

  const evidence = relevant.slice(0, 4);
  return {
    mode: 'learned',
    title: 'Check database max_connections before tuning the payment pool',
    steps: [
      'Confirm pool saturation and compare payment worker demand with database max_connections.',
      'Simulate a capacity increase only after validating database headroom; avoid raising the app pool alone.',
      'After capacity is safe, simulate restarting payment workers and verify checkout wait time falls.'
    ],
    evidence
  };
}

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function retainWithSingle503Retry(content, options) {
  try {
    return await retainMemory(content, options);
  } catch (err) {
    if (Number(err.statusCode || err.status) !== 503) throw err;
    await wait(500);
    return retainMemory(content, options);
  }
}

// Analyze always recalls from the live Hindsight bank. An empty result produces the baseline path.
app.post('/api/incidents/analyze', async (req, res) => {
  const incident = {
    service: String(req.body?.service || DEMO_INCIDENT.service).slice(0, 100),
    title: String(req.body?.title || DEMO_INCIDENT.title).slice(0, 200),
    summary: String(req.body?.summary || DEMO_INCIDENT.summary).slice(0, 1000)
  };

  try {
    const status = await testHindsightConnection();
    const recall = status.connected
      ? await recallMemories(`${incident.service} ${incident.title} ${incident.summary} root cause fix outcome`, {
          tags: [`service:${incident.service}`]
        })
      : { results: [] };
    const recalled = status.connected ? getRecallResults(recall) : [];

    res.json({
      incident,
      hindsight: { connected: status.connected, bankId: getBankId() },
      recalled,
      recommendation: recommendFromMemories(recalled),
      simulation: safeSimulation
    });
  } catch (err) {
    res.status(502).json({ error: err.message, incident });
  }
});

// Resolve only records the operator-approved demo outcome; no operational action is executed.
app.post('/api/incidents/resolve', async (req, res) => {
  const incident = req.body?.incident || {};
  const rootCause = String(req.body?.rootCause || '').slice(0, 1000);
  const action = String(req.body?.action || '').slice(0, 1000);
  const outcome = String(req.body?.outcome || '').slice(0, 1000);
  const lesson = String(req.body?.lesson || '').slice(0, 1000);
  const rawResolutionMinutes = String(req.body?.resolutionMinutes ?? '').trim();
  const resolutionMinutes = Number(rawResolutionMinutes);

  if (!rootCause || !action || !outcome || !lesson || !rawResolutionMinutes || !Number.isFinite(resolutionMinutes) || resolutionMinutes < 0) {
    return res.status(400).json({ error: 'Root cause, action, outcome, lesson, and resolution time are required.' });
  }

  const incidentId = `incident-${Date.now()}`;
  const content = [
    `Incident ${incidentId}: ${String(incident.title || DEMO_INCIDENT.title)}.`,
    `Service: ${String(incident.service || DEMO_INCIDENT.service)}.`,
    `Root cause: ${rootCause}.`,
    `Action: ${action}.`,
    `Outcome: ${outcome}.`,
    `Resolution time: ${resolutionMinutes} minutes.`,
    `Lesson: ${lesson}.`
  ].join(' ');

  try {
    const retainResult = await retainWithSingle503Retry(content, {
      context: 'RecallOps resolved incident (operator-confirmed safe simulation)',
      tags: [`service:${String(incident.service || DEMO_INCIDENT.service)}`, 'recallops-incident'],
      metadata: { incidentId, resolutionMinutes: String(resolutionMinutes), simulation: 'true' }
    });
    res.json({ success: true, incidentId, retainResult, simulation: safeSimulation });
  } catch (err) {
    const temporarilyUnavailable = Number(err.statusCode || err.status) === 503;
    res.status(temporarilyUnavailable ? 503 : 502).json({
      success: false,
      incidentId,
      code: temporarilyUnavailable ? 'HINDSIGHT_TEMPORARILY_UNAVAILABLE' : 'INCIDENT_RESOLUTION_FAILED',
      error: temporarilyUnavailable
        ? 'The AI memory service is temporarily overloaded. The incident outcome was not falsely marked as learned.'
        : err.message,
      simulation: safeSimulation
    });
  }
});

// POST /api/hindsight/test-memory - Explicit-content RETAIN -> RECALL -> REFLECT diagnostic
app.post('/api/hindsight/test-memory', async (req, res) => {
  const testContent = typeof req.body?.content === 'string' ? req.body.content.trim() : '';
  const recallQuery = typeof req.body?.query === 'string' ? req.body.query.trim() : '';
  if (!testContent || !recallQuery) {
    return res.status(400).json({
      success: false,
      error: 'Provide content and query explicitly. The diagnostic does not seed a historical incident.'
    });
  }

  const conn = await testHindsightConnection();
  if (!conn.connected) {
    return res.status(503).json({
      success: false,
      connected: false,
      error: 'HINDSIGHT OFFLINE — Historical memory unavailable. Baseline analysis only.',
      details: conn.details
    });
  }

  try {
    const testIncidentId = `test-inc-${Date.now()}`;
    const retainResult = await retainMemory(testContent, {
      context: 'Operator supplied Hindsight diagnostic',
      tags: Array.isArray(req.body?.tags) ? req.body.tags.filter((tag) => typeof tag === 'string') : ['diagnostic'],
      metadata: { testIncidentId, diagnostic: 'true' }
    });

    const recallResult = await recallMemories(recallQuery, {
      tags: Array.isArray(req.body?.tags) ? req.body.tags.filter((tag) => typeof tag === 'string') : undefined
    });

    let reflectResult = null;
    if (typeof req.body?.reflectQuery === 'string' && req.body.reflectQuery.trim()) {
      try {
        reflectResult = await reflectMemories(req.body.reflectQuery.trim());
      } catch (rErr) {
        reflectResult = { error: rErr.message };
      }
    }

    res.json({
      success: true,
      connected: true,
      bankId: getBankId(),
      testIncidentId,
      retainResult,
      recallResult,
      reflectResult
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`[RecallOps Backend] Server running on http://localhost:${PORT}`);
  console.log(`[RecallOps Backend] Target Hindsight Bank ID: ${getBankId()}`);
});
