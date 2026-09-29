import { execFileSync } from 'child_process';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

const envPath = fileURLToPath(new URL('../.env', import.meta.url));
dotenv.config({ path: envPath, override: true });

const containerName = 'hindsight';
const image = 'ghcr.io/vectorize-io/hindsight:latest';
const preservedImage = 'recallops/hindsight-bank-preserved:latest';
const provider = 'gemini';
const model = 'gemini-3.5-flash';
const apiKey = (
  process.env.HINDSIGHT_API_LLM_API_KEY ||
  process.env.GEMINI_API_KEY ||
  process.env.LLM_API_KEY ||
  ''
).trim();

if (!apiKey) {
  console.error('[Hindsight Startup] No Gemini key found in backend/.env. Set HINDSIGHT_API_LLM_API_KEY.');
  process.exit(1);
}

function inspectContainer() {
  const id = execFileSync('docker', [
    'ps', '-aq', '--filter', `name=^/${containerName}$`
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

  if (!id) return null;

  // Docker inspection stays in memory; never print the environment or API key.
  const raw = execFileSync('docker', ['inspect', '--format', '{{json .}}', id], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  });
  const container = JSON.parse(raw);
  const env = container.Config?.Env || [];
  const readEnv = (name) => env.find((item) => item.startsWith(`${name}=`))?.slice(name.length + 1);
  const containerKey = readEnv('HINDSIGHT_API_LLM_API_KEY');

  return {
    id,
    running: Boolean(container.State?.Running),
    provider: readEnv('HINDSIGHT_API_LLM_PROVIDER'),
    model: readEnv('HINDSIGHT_API_LLM_MODEL'),
    keyMatches: Boolean(containerKey) && containerKey === apiKey,
    mountCount: container.Mounts?.length || 0
  };
}

function hasCurrentConfiguration(container) {
  return container.provider === provider && container.model === model && container.keyMatches;
}

function runContainer(imageToRun) {
  execFileSync('docker', [
    'run', '-d', '--name', containerName,
    '-p', '8888:8888', '-p', '9999:9999',
    '-e', `HINDSIGHT_API_LLM_PROVIDER=${provider}`,
    '-e', 'HINDSIGHT_API_LLM_API_KEY',
    '-e', `HINDSIGHT_API_LLM_MODEL=${model}`,
    imageToRun
  ], {
    encoding: 'utf8',
    stdio: ['ignore', 'ignore', 'inherit'],
    env: { ...process.env, HINDSIGHT_API_LLM_API_KEY: apiKey }
  });
}

function recreateWithPreservedState(existing) {
  if (existing.mountCount > 0) {
    console.error('[Hindsight Startup] Existing container has mounted data. Refusing automatic replacement to protect it.');
    process.exit(1);
  }

  console.log('[Hindsight Startup] Configuration differs; snapshotting the existing Hindsight bank before updating container settings.');
  execFileSync('docker', [
    'commit', '--change', 'ENV HINDSIGHT_API_LLM_API_KEY=', containerName, preservedImage
  ], { stdio: 'ignore' });

  // Ensure the preserved image does not carry the old key in its active config.
  const imageEnv = JSON.parse(execFileSync('docker', [
    'image', 'inspect', '--format', '{{json .Config.Env}}', preservedImage
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  const imageKey = imageEnv.find((item) => item.startsWith('HINDSIGHT_API_LLM_API_KEY='));
  if (imageKey && imageKey !== 'HINDSIGHT_API_LLM_API_KEY=') {
    console.error('[Hindsight Startup] Could not sanitize the snapshot configuration. Existing container left untouched.');
    process.exit(1);
  }

  execFileSync('docker', ['rm', '-f', containerName], { stdio: 'ignore' });
  runContainer(preservedImage);
  console.log(`[Hindsight Startup] Recreated ${provider}/${model} from the bank snapshot using backend/.env.`);
}

try {
  const existing = inspectContainer();
  if (existing) {
    if (!hasCurrentConfiguration(existing)) {
      recreateWithPreservedState(existing);
    } else if (existing.running) {
      console.log(`[Hindsight Startup] Existing ${provider}/${model} container already uses backend/.env; reusing it.`);
    } else {
      execFileSync('docker', ['start', containerName], { stdio: 'ignore' });
      console.log(`[Hindsight Startup] Started existing ${provider}/${model} container using backend/.env.`);
    }
  } else {
    runContainer(image);
    console.log(`[Hindsight Startup] Started a new ${provider}/${model} container.`);
  }
} catch {
  console.error('[Hindsight Startup] Docker could not start or inspect Hindsight. Check Docker Engine status and permissions.');
  process.exit(1);
}
