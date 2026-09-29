# RecallOps — AI Incident Response Agent That Remembers What Worked

> **RecallOps** is an intelligent operational assistant for SRE, DevOps, and Incident Response engineers. Powered by **Hindsight** persistent agent memory, RecallOps accumulates operational knowledge over time—learning from past outages, diagnostic runbooks, successful resolutions, and failed troubleshooting attempts.

---

## Architecture Overview

```
Frontend (React + Vite)
      │  REST API / Health Checks
      ▼
Backend (Node.js + Express)
      │
      ├──> Agent Orchestrator
      │       ├──> LLM Reasoning Engine
      │       └──> Hindsight Memory Client (@vectorize-io/hindsight-client)
```

---

## Tech Stack

- **Frontend**: React 18, Vite, Lucide Icons, Vanilla CSS Design Tokens (Dark Mode Operations Dashboard)
- **Backend**: Node.js, Express, ES Modules, Cors, Dotenv
- **Agent Memory**: [Hindsight](https://hindsight.vectorize.io/) (`@vectorize-io/hindsight-client`)

---

## Quick Start

### 1. Backend Setup
```bash
cd backend
npm install
npm run dev
```
Backend runs on `http://localhost:5000` with health endpoint at `http://localhost:5000/api/health`.

### 2. Frontend Setup
```bash
cd frontend
npm install
npm run dev
```
Frontend runs on `http://localhost:5173`.

### 3. Hindsight

RecallOps expects the existing Hindsight Docker service at `http://localhost:8888`. The backend reads the Gemini credential from `backend/.env`; keep it server-side. Configure:

```env
HINDSIGHT_API_LLM_PROVIDER=gemini
HINDSIGHT_API_LLM_MODEL=gemini-3.5-flash
HINDSIGHT_API_LLM_API_KEY=<existing Gemini key>
HINDSIGHT_BASE_URL=http://localhost:8888
HINDSIGHT_BANK_ID=recallops-incidents
```

The backend exposes `GET /api/hindsight/status`, `POST /api/incidents/analyze`, and `POST /api/incidents/resolve`. Analysis performs a live Hindsight recall. Resolution records only after the operator selects **Simulate resolution & retain in Hindsight**. All remediation is a simulation; no infrastructure actions are executed.

To verify Hindsight, open the app and check the connection badge, then analyze the payment connection-pool incident. The evidence panel shows the actual memories returned by Hindsight. After reviewing the incident fields, retain the simulated outcome and analyze again to see whether Hindsight recalls it.

---

## Environment Variables

Copy `.env.example` to `.env` in the `backend/` directory:

```env
PORT=5000
HINDSIGHT_BANK_ID=recallops-incidents
HINDSIGHT_BASE_URL=http://localhost:8888
# HINDSIGHT_API_KEY=your_hindsight_api_key
# LLM_API_KEY=your_llm_api_key
```
