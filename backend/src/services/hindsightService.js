import { HindsightClient, HindsightError } from '@vectorize-io/hindsight-client';
import dotenv from 'dotenv';

dotenv.config();

const HINDSIGHT_BASE_URL = process.env.HINDSIGHT_BASE_URL || 'http://localhost:8888';
const HINDSIGHT_API_KEY = process.env.HINDSIGHT_API_KEY || undefined;
const HINDSIGHT_BANK_ID = process.env.HINDSIGHT_BANK_ID || 'recallops-incidents';

// Initialize Hindsight Client using verified SDK v0.10.1 signature
export const hindsightClient = new HindsightClient({
  baseUrl: HINDSIGHT_BASE_URL,
  apiKey: HINDSIGHT_API_KEY
});

export const getBankId = () => process.env.HINDSIGHT_BANK_ID || HINDSIGHT_BANK_ID;

/**
 * Perform a REAL live connectivity check against the Hindsight server.
 */
export async function testHindsightConnection() {
  const bankId = getBankId();
  try {
    // Perform actual network probe using getVersion()
    const versionInfo = await hindsightClient.getVersion();
    return {
      connected: true,
      configured: true,
      bankId,
      baseUrl: HINDSIGHT_BASE_URL,
      version: versionInfo.version || '0.10',
      error: null,
      message: 'Hindsight memory engine online and responsive.'
    };
  } catch (err) {
    const errorMessage = err instanceof HindsightError
      ? `Hindsight Error [${err.statusCode || 500}]: ${err.message}`
      : (err.message || 'Hindsight server unreachable');

    return {
      connected: false,
      configured: Boolean(process.env.HINDSIGHT_BASE_URL),
      bankId,
      baseUrl: HINDSIGHT_BASE_URL,
      error: 'HINDSIGHT OFFLINE — Historical memory unavailable. Baseline analysis only.',
      details: errorMessage
    };
  }
}

/**
 * Retain operational memory item in Hindsight bank.
 */
export async function retainMemory(content, options = {}) {
  const bankId = getBankId();
  const conn = await testHindsightConnection();
  if (!conn.connected) {
    throw new Error('HINDSIGHT OFFLINE — Historical memory unavailable. Baseline analysis only.');
  }

  return await hindsightClient.retain(bankId, content, options);
}

/**
 * Recall relevant operational memories from Hindsight bank.
 */
export async function recallMemories(query, options = {}) {
  const bankId = getBankId();
  const conn = await testHindsightConnection();
  if (!conn.connected) {
    return {
      connected: false,
      results: [],
      error: 'HINDSIGHT OFFLINE — Historical memory unavailable. Baseline analysis only.'
    };
  }

  return await hindsightClient.recall(bankId, query, options);
}

/**
 * Reflect over operational memories using Hindsight reflection engine.
 */
export async function reflectMemories(query, options = {}) {
  const bankId = getBankId();
  const conn = await testHindsightConnection();
  if (!conn.connected) {
    return {
      connected: false,
      text: null,
      error: 'HINDSIGHT OFFLINE — Historical memory unavailable. Baseline analysis only.'
    };
  }

  return await hindsightClient.reflect(bankId, query, options);
}
