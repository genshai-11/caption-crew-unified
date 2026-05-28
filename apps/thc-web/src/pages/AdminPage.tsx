import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAdminAuth } from '@/auth/AdminAuthContext';
import {
  AdminRuntimeConfig,
  defaultAdminRuntimeConfig,
  loadAdminRuntimeConfig,
  loadSharedAdminRuntimeConfig,
  saveAdminRuntimeConfig,
  saveSharedAdminRuntimeConfig,
} from '@/services/adminConfigRepository';
import {
  fetchGoogleSttModels,
  fetchRouterModels,
  testGoogleSttModels,
  testRouterCompletion,
  type GoogleSttModelInfo,
  type RouterModelInfo,
} from '@/services/adminValidationService';
import { transcribeRoundAudio } from '@/services/transcriptionService';
import { useRoundRecorder } from '@/hooks/useRoundRecorder';
import { analyzeTranscript, OhmAnalysisResult } from '@/services/aiService';
import type { CciCard } from '@/types';

interface TestState {
  status: 'idle' | 'loading' | 'success' | 'error';
  message: string;
  transcript?: string;
}

const idleTestState: TestState = {
  status: 'idle',
  message: 'Not tested yet.',
};

function createDraftCciCard(nextOrder: number): CciCard {
  return {
    id: `cci-card-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    label: 'New card',
    baseA: 10,
    icon: 'hand',
    active: true,
    order: nextOrder,
  };
}

function StatusBadge({ label, status }: { label: string; status: TestState['status'] | 'ready' | 'not-ready' | 'loading' }) {
  return <span className={`status-dot status-${status}`}>{label}</span>;
}

export default function AdminPage() {
  const navigate = useNavigate();
  const { user, signOutAdmin } = useAdminAuth();
  const [config, setConfig] = useState<AdminRuntimeConfig>(defaultAdminRuntimeConfig);
  const [saved, setSaved] = useState(false);
  const [cloudStatus, setCloudStatus] = useState<'idle' | 'loading' | 'loaded' | 'saved' | 'error'>('idle');
  const [cloudMessage, setCloudMessage] = useState('');
  const [routerModels, setRouterModels] = useState<RouterModelInfo[]>([]);
  const [modelsState, setModelsState] = useState<TestState>(idleTestState);
  const [routerTestState, setRouterTestState] = useState<TestState>(idleTestState);
  const [captainTestState, setCaptainTestState] = useState<TestState>(idleTestState);
  const [crewTestState, setCrewTestState] = useState<TestState>(idleTestState);
  const [googleCaptainTestState, setGoogleCaptainTestState] = useState<TestState>(idleTestState);
  const [googleCrewTestState, setGoogleCrewTestState] = useState<TestState>(idleTestState);
  const [googleSttModels, setGoogleSttModels] = useState<GoogleSttModelInfo[]>([]);
  const [googleModelsState, setGoogleModelsState] = useState<TestState>(idleTestState);
  const [googleModelsTestState, setGoogleModelsTestState] = useState<TestState>(idleTestState);
  const [analysisTranscript, setAnalysisTranscript] = useState('');
  const [analysisResult, setAnalysisResult] = useState<OhmAnalysisResult | null>(null);
  const [analysisState, setAnalysisState] = useState<TestState>(idleTestState);

  const captainRecorder = useRoundRecorder();
  const crewRecorder = useRoundRecorder();

  useEffect(() => {
    setConfig(loadAdminRuntimeConfig());
  }, []);

  useEffect(() => {
    if (!user?.email) return;
    let cancelled = false;
    setCloudStatus('loading');
    setCloudMessage('Loading shared config…');
    loadSharedAdminRuntimeConfig()
      .then((remote) => {
        if (cancelled) return;
        setConfig(remote);
        setCloudStatus('loaded');
        setCloudMessage('Shared config loaded from cloud.');
      })
      .catch((error: any) => {
        if (cancelled) return;
        setCloudStatus('error');
        setCloudMessage(error?.message || 'Could not load shared config. Using local cache.');
      });
    return () => {
      cancelled = true;
    };
  }, [user?.email]);

  const patchConfig = <K extends keyof AdminRuntimeConfig>(key: K, value: AdminRuntimeConfig[K]) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
  };

  const updateOhmAnalysisPreview = async (transcript: string) => {
    const normalizedTranscript = transcript.trim();
    setAnalysisTranscript(normalizedTranscript);
    if (!normalizedTranscript) {
      setAnalysisResult(null);
      setAnalysisState({ status: 'idle', message: 'No transcript to analyze.' });
      return;
    }

    setAnalysisState({ status: 'loading', message: 'Analyzing transcript with AI…' });
    try {
      const result = await analyzeTranscript(normalizedTranscript, {
        model: config.ohmModel || config.router9Model,
        fallbackModel: config.ohmFallbackModel || config.router9FallbackModel,
      });
      setAnalysisResult(result);
      setAnalysisState({
        status: 'success',
        message: `Analysis complete • engine Router9 • model ${result.modelUsed || config.ohmModel || config.router9Model || 'default'}`,
      });
    } catch (error: any) {
      setAnalysisResult(null);
      setAnalysisState({ status: 'error', message: error?.message || 'Transcript analysis failed.' });
    }
  };

  const handleSave = async () => {
    try {
      setCloudStatus('loading');
      setCloudMessage('Saving shared config…');
      saveAdminRuntimeConfig(config);
      const savedConfig = await saveSharedAdminRuntimeConfig(config);
      setConfig(savedConfig);
      setSaved(true);
      setCloudStatus('saved');
      setCloudMessage('Shared config and public theme saved.');
      window.setTimeout(() => setSaved(false), 1500);
    } catch (error: any) {
      saveAdminRuntimeConfig(config);
      setCloudStatus('error');
      setCloudMessage(error?.message || 'Saved locally, but cloud sync failed.');
    }
  };

  const handleFetchModels = async () => {
    setModelsState({ status: 'loading', message: 'Fetching models...' });
    try {
      saveAdminRuntimeConfig(config);
      const models = await fetchRouterModels();
      setRouterModels(models);
      setModelsState({ status: 'success', message: `${models.length} model(s) loaded.` });
      if (models[0]?.id) {
        setConfig((prev) => ({
          ...prev,
          router9Model: prev.router9Model || models[0].id,
          router9FallbackModel: prev.router9FallbackModel || models[1]?.id || models[0].id,
          ohmModel: prev.ohmModel || models[0].id,
          ohmFallbackModel: prev.ohmFallbackModel || models[1]?.id || models[0].id,
        }));
      }
    } catch (error: any) {
      setModelsState({ status: 'error', message: error.message || 'Failed to fetch models.' });
    }
  };

  const handleTestRouter = async () => {
    setRouterTestState({ status: 'loading', message: 'Testing Router9 completion...' });
    try {
      saveAdminRuntimeConfig(config);
      const result = await testRouterCompletion();
      setRouterTestState({ status: 'success', message: `Router9 OK: ${String(result.content || '').trim() || 'No content returned.'}` });
    } catch (error: any) {
      setRouterTestState({ status: 'error', message: error.message || 'Router9 test failed.' });
    }
  };

  const handleCaptainTranscriptionTest = async () => {
    setCaptainTestState({ status: 'loading', message: 'Transcribing Vietnamese sample...' });
    try {
      saveAdminRuntimeConfig(config);
      const blob = captainRecorder.audioBlob || await captainRecorder.stop();
      if (!blob) throw new Error('No Captain sample audio found. Record Vietnamese first.');
      const result = await transcribeRoundAudio(blob, { role: 'captain', language: 'vi' });
      const diagnostics = result.fallbackUsed ? ` • fallback ${result.modelUsed}` : ` • ${result.modelUsed || 'primary model'}`;
      setCaptainTestState({
        status: 'success',
        message: `Vietnamese STT OK • confidence ${(result.confidence || 0).toFixed(2)}${diagnostics}` ,
        transcript: result.transcript,
      });
      void updateOhmAnalysisPreview(result.transcript);
    } catch (error: any) {
      setCaptainTestState({ status: 'error', message: error.message || 'Vietnamese STT failed.' });
    }
  };

  const handleCrewTranscriptionTest = async () => {
    setCrewTestState({ status: 'loading', message: 'Transcribing English sample...' });
    try {
      saveAdminRuntimeConfig(config);
      const blob = crewRecorder.audioBlob || await crewRecorder.stop();
      if (!blob) throw new Error('No Crew sample audio found. Record English first.');
      const result = await transcribeRoundAudio(blob, { role: 'crew', language: 'en' });
      if (result.emptyTranscript) {
        const fallbackText = result.fallbackUsed ? ` Fallback tried: ${result.modelUsed}.` : '';
        const echoText = ` Backend received role=${result.roleReceived || 'n/a'}, language=${result.languageReceived || 'n/a'}, contentType=${result.contentTypeReceived || 'n/a'}.`;
        throw new Error(`Audio was recorded but no English speech was recognized.${fallbackText}${echoText} Request: ${result.requestId || 'n/a'}`);
      }
      const diagnostics = result.fallbackUsed ? ` • fallback ${result.modelUsed}` : ` • ${result.modelUsed || 'primary model'}`;
      setCrewTestState({
        status: 'success',
        message: `English STT OK • confidence ${(result.confidence || 0).toFixed(2)}${diagnostics}` ,
        transcript: result.transcript,
      });
      void updateOhmAnalysisPreview(result.transcript);
    } catch (error: any) {
      setCrewTestState({ status: 'error', message: error.message || 'English STT failed.' });
    }
  };

  const handleGoogleCaptainTranscriptionTest = async () => {
    setGoogleCaptainTestState({ status: 'loading', message: 'Testing forced Google STT (Vietnamese)...' });
    try {
      const blob = captainRecorder.audioBlob || await captainRecorder.stop();
      if (!blob) throw new Error('No Captain sample audio found. Record Vietnamese first.');
      const result = await transcribeRoundAudio(blob, {
        role: 'captain',
        language: 'vi',
        providerOverride: 'google',
        googleApiKeyOverride: config.googleApiKey,
        googleModelOverride: config.googleTranscriptModel,
        googleProjectIdOverride: config.googleCloudProjectId,
        googleLocationOverride: config.googleTranscriptLocation,
      });

      if (result.emptyTranscript) {
        throw new Error('Google STT returned empty transcript.');
      }

      setGoogleCaptainTestState({
        status: 'success',
        message: `Google STT Vietnamese OK • model ${result.modelUsed || config.googleTranscriptModel || 'chirp_3'}`,
        transcript: result.transcript,
      });
      void updateOhmAnalysisPreview(result.transcript);
    } catch (error: any) {
      setGoogleCaptainTestState({ status: 'error', message: error.message || 'Google Vietnamese STT failed.' });
    }
  };

  const handleGoogleCrewTranscriptionTest = async () => {
    setGoogleCrewTestState({ status: 'loading', message: 'Testing forced Google STT (English)...' });
    try {
      const blob = crewRecorder.audioBlob || await crewRecorder.stop();
      if (!blob) throw new Error('No Crew sample audio found. Record English first.');
      const result = await transcribeRoundAudio(blob, {
        role: 'crew',
        language: 'en',
        providerOverride: 'google',
        googleApiKeyOverride: config.googleApiKey,
        googleModelOverride: config.googleTranscriptModel,
        googleProjectIdOverride: config.googleCloudProjectId,
        googleLocationOverride: config.googleTranscriptLocation,
      });

      if (result.emptyTranscript) {
        throw new Error('Google STT returned empty transcript.');
      }

      setGoogleCrewTestState({
        status: 'success',
        message: `Google STT English OK • model ${result.modelUsed || config.googleTranscriptModel || 'chirp_3'}`,
        transcript: result.transcript,
      });
      void updateOhmAnalysisPreview(result.transcript);
    } catch (error: any) {
      setGoogleCrewTestState({ status: 'error', message: error.message || 'Google English STT failed.' });
    }
  };

  const handleFetchGoogleSttModels = async () => {
    setGoogleModelsState({ status: 'loading', message: 'Fetching Google STT models...' });
    try {
      const result = await fetchGoogleSttModels();
      setGoogleSttModels(result.models);
      if (result.recommendedModel && !config.googleTranscriptModel) {
        patchConfig('googleTranscriptModel', result.recommendedModel);
      }
      setGoogleModelsState({ status: 'success', message: `${result.models.length} Google STT model(s) loaded.` });
    } catch (error: any) {
      setGoogleModelsState({ status: 'error', message: error?.message || 'Failed to fetch Google STT models.' });
    }
  };

  const handleTestGoogleModelsParallel = async () => {
    setGoogleModelsTestState({ status: 'loading', message: 'Testing Google STT models in parallel...' });
    try {
      const captainBlob = captainRecorder.audioBlob;
      const crewBlob = crewRecorder.audioBlob;
      const blob = captainBlob || crewBlob;
      if (!blob) throw new Error('Record Captain or Crew sample audio first to test models.');

      const role = captainBlob ? 'captain' : 'crew';
      const language = captainBlob ? 'vi' : 'en';
      const modelsToTest = googleSttModels.length > 0 ? googleSttModels.map((model) => model.id) : ['chirp_3', 'chirp_2', 'telephony'];

      const result = await testGoogleSttModels(blob, {
        role,
        language,
        googleApiKey: config.googleApiKey,
        googleProjectId: config.googleCloudProjectId,
        googleLocation: config.googleTranscriptLocation,
        models: modelsToTest,
      });

      const passCount = result.passedModels.length;
      const failCount = result.results.filter((entry) => !entry.ok || entry.emptyTranscript).length;
      const best = result.results
        .filter((entry) => entry.ok && !entry.emptyTranscript)
        .sort((a, b) => (b.confidence || 0) - (a.confidence || 0))[0];

      if (best?.model) {
        patchConfig('googleTranscriptModel', best.model);
      }

      setGoogleModelsTestState({
        status: passCount > 0 ? 'success' : 'error',
        message: `Parallel test done • pass ${passCount} • fail ${failCount} • best ${best?.model || 'n/a'} • ${(result.elapsedMs / 1000).toFixed(1)}s`,
      });
    } catch (error: any) {
      setGoogleModelsTestState({ status: 'error', message: error?.message || 'Google STT parallel test failed.' });
    }
  };

  const transcriptReady = config.transcriptProvider === 'google'
    ? captainTestState.status === 'success' && crewTestState.status === 'success'
    : config.transcriptProvider === 'thirdparty'
      ? !!config.thirdPartyTranscriptUrl && captainTestState.status === 'success' && crewTestState.status === 'success'
      : !!config.deepgramApiKey && captainTestState.status === 'success' && crewTestState.status === 'success';
  const routerReady = !!config.router9ApiKey && !!config.router9Model && routerTestState.status === 'success';
  const systemReady = transcriptReady && routerReady;

  const modelOptions = useMemo(() => routerModels.map((model) => model.id), [routerModels]);

  return (
    <main className="screen-shell admin-shell">
      <header className="page-header">
        <div>
          <p className="page-kicker">Admin</p>
          <h1 className="page-title">STT + meaning setup</h1>
          {user?.email && <p className="muted-copy">Signed in as {user.email}</p>}
        </div>
        <div className="action-row">
          <StatusBadge label={systemReady ? 'ready' : 'not ready'} status={systemReady ? 'ready' : 'not-ready'} />
          <button className="ghost-pill-button" onClick={() => navigate('/admin/dashboard')}>
            Dashboard
          </button>
          <button className="ghost-pill-button" onClick={async () => { await signOutAdmin(); navigate('/admin-login', { replace: true }); }}>
            Sign out
          </button>
        </div>
      </header>

      <section className="soft-card admin-section-minimal">
        <div className="action-row">
          <span className="soft-label">Cloud sync</span>
          <StatusBadge label={cloudStatus} status={cloudStatus === 'loaded' || cloudStatus === 'saved' ? 'success' : cloudStatus === 'error' ? 'error' : cloudStatus === 'loading' ? 'loading' : 'idle'} />
        </div>
        <p className="admin-message">{cloudMessage || 'Shared config will load after admin sign-in.'}</p>
      </section>

      <section className="admin-grid two-up">
        <article className="soft-card compact">
          <span className="soft-label">Transcript ({config.transcriptProvider === 'google' ? 'Google' : config.transcriptProvider === 'thirdparty' ? 'Third-party API' : 'Deepgram'})</span>
          <div className="action-row">
            <StatusBadge label={transcriptReady ? 'ready' : 'not ready'} status={transcriptReady ? 'ready' : 'not-ready'} />
            <StatusBadge
              label={config.transcriptProvider === 'deepgram' && config.partialTranscriptEnabled ? 'streaming enabled' : 'single transcript mode'}
              status={config.transcriptProvider === 'deepgram' && config.partialTranscriptEnabled ? 'success' : 'idle'}
            />
          </div>
        </article>
        <article className="soft-card compact">
          <span className="soft-label">Router9</span>
          <StatusBadge label={routerReady ? 'ready' : 'not ready'} status={routerReady ? 'ready' : 'not-ready'} />
        </article>
      </section>

      <section className="soft-card admin-section-minimal">
        <div className="section-title-row">
          <h2 className="section-title">Visual style</h2>
        </div>
        <div className="admin-grid two-up">
          <label className="field-stack">
            <span>Shared app theme</span>
            <select value={config.visualTheme} onChange={(e) => patchConfig('visualTheme', e.target.value as AdminRuntimeConfig['visualTheme'])}>
              <option value="minimal">Minimal</option>
              <option value="bold">Bold</option>
              <option value="swiss">Swiss Typography</option>
            </select>
          </label>
          <div className="field-stack">
            <span>Theme note</span>
            <p className="admin-message">This is saved as a public visual setting so all devices see the same gameplay style.</p>
          </div>
        </div>
      </section>

      <section className="soft-card admin-section-minimal">
        <div className="section-title-row">
          <h2 className="section-title">Speech to text</h2>
        </div>

        <label className="field-stack">
          <span>Transcript provider</span>
          <select value={config.transcriptProvider} onChange={(e) => patchConfig('transcriptProvider', e.target.value as AdminRuntimeConfig['transcriptProvider'])}>
            <option value="deepgram">Deepgram (streaming + batch)</option>
            <option value="google">Google Speech-to-Text V2 (batch transcript)</option>
            <option value="thirdparty">Third-party transcript API (batch)</option>
          </select>
        </label>

        <label className="toggle-row">
          <input
            type="checkbox"
            checked={config.partialTranscriptEnabled}
            onChange={(e) => patchConfig('partialTranscriptEnabled', e.target.checked)}
          />
          Enable live partial transcript (Deepgram only)
        </label>

        {config.transcriptProvider === 'google' ? (
          <>
            <label className="field-stack">
              <span>Google API key</span>
              <input type="password" value={config.googleApiKey} onChange={(e) => patchConfig('googleApiKey', e.target.value)} />
            </label>
            <div className="admin-grid two-up">
              <label className="field-stack">
                <span>Google Cloud project ID (optional)</span>
                <input value={config.googleCloudProjectId} onChange={(e) => patchConfig('googleCloudProjectId', e.target.value)} placeholder="gen-lang-client-0815518176" />
              </label>
              <label className="field-stack">
                <span>Speech location</span>
                <input value={config.googleTranscriptLocation} onChange={(e) => patchConfig('googleTranscriptLocation', e.target.value)} placeholder="global" />
              </label>
            </div>
            <label className="field-stack">
              <span>Google STT model</span>
              <input value={config.googleTranscriptModel} onChange={(e) => patchConfig('googleTranscriptModel', e.target.value)} />
            </label>
            <div className="action-row">
              <button className="ghost-pill-button" onClick={() => void handleFetchGoogleSttModels()} disabled={googleModelsState.status === 'loading'}>
                {googleModelsState.status === 'loading' ? 'Fetching…' : 'Fetch Google STT models'}
              </button>
              <button className="ghost-pill-button" onClick={() => void handleTestGoogleModelsParallel()} disabled={googleModelsTestState.status === 'loading'}>
                {googleModelsTestState.status === 'loading' ? 'Testing…' : 'Test models in parallel'}
              </button>
            </div>
            <p className="admin-message">{googleModelsState.message}</p>
            <p className="admin-message">{googleModelsTestState.message}</p>
            {googleSttModels.length > 0 ? (
              <ul>
                {googleSttModels.map((model) => (
                  <li key={model.id} className="admin-message">
                    {model.id}{model.recommended ? ' (recommended)' : ''} — {model.description || 'Google STT model'}
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="admin-message">Recommended model: chirp_3. To keep a single transcript source, leave partial transcript disabled.</p>
          </>
        ) : config.transcriptProvider === 'thirdparty' ? (
          <>
            <label className="field-stack">
              <span>Third-party transcript endpoint URL</span>
              <input value={config.thirdPartyTranscriptUrl} onChange={(e) => patchConfig('thirdPartyTranscriptUrl', e.target.value)} placeholder="https://api.example.com/transcribe" />
            </label>
            <label className="field-stack">
              <span>Third-party transcript API key</span>
              <input type="password" value={config.thirdPartyTranscriptApiKey} onChange={(e) => patchConfig('thirdPartyTranscriptApiKey', e.target.value)} />
            </label>
            <div className="admin-grid two-up">
              <label className="field-stack">
                <span>Third-party transcript model (optional)</span>
                <input value={config.thirdPartyTranscriptModel} onChange={(e) => patchConfig('thirdPartyTranscriptModel', e.target.value)} placeholder="whisper-large-v3" />
              </label>
              <label className="field-stack">
                <span>Auth scheme</span>
                <select value={config.thirdPartyTranscriptAuthScheme} onChange={(e) => patchConfig('thirdPartyTranscriptAuthScheme', e.target.value as AdminRuntimeConfig['thirdPartyTranscriptAuthScheme'])}>
                  <option value="bearer">Bearer</option>
                  <option value="x-api-key">x-api-key</option>
                  <option value="none">None</option>
                </select>
              </label>
            </div>
            <p className="admin-message">Expected API contract: POST transcript + settings.ohmBaseValues (Green=5, Blue=7, Red=9, Pink=3) + optional webhookUrl to /api/analyze-ohm; return transcriptRaw, transcriptNormalized, chunks, formula, totalOhm, modelUsed.</p>
          </>
        ) : (
          <p className="admin-message">Deepgram settings are active for transcript. OHM analysis model is configured in the Router9 section below.</p>
        )}
        <p className="admin-message">{analysisState.message}</p>
        {analysisTranscript ? (
          <>
            <p className="admin-transcript-preview">{analysisTranscript}</p>
            {analysisResult ? (
              <>
                <div className="admin-grid two-up">
                  <div className="field-stack">
                    <span className="metric-cvr">CVR raw units (Ω)</span>
                    <strong className="metric-cvr">{analysisResult.totalOhm} Ω</strong>
                  </div>
                  <div className="field-stack">
                    <span>Formula</span>
                    <strong>{analysisResult.formula}</strong>
                  </div>
                  <div className="field-stack">
                    <span>Normalized transcript</span>
                    <strong>{analysisResult.transcriptNormalized || 'n/a'}</strong>
                  </div>
                  <div className="field-stack">
                    <span>Chunks</span>
                    <strong>{analysisResult.chunks.length}</strong>
                  </div>
                </div>
                <div className="field-stack">
                  <span>Detected chunks (AI)</span>
                  {analysisResult.chunks.length > 0 ? (
                    <ul>
                      {analysisResult.chunks.map((chunk, idx) => (
                        <li key={`${chunk.text}-${idx}`} className="admin-message">
                          [{chunk.label}] {chunk.text} • {chunk.ohm}Ω • conf {(Number(chunk.confidence || 0)).toFixed(2)} • {chunk.reason}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="admin-message">No semantic chunks detected.</p>
                  )}
                </div>
              </>
            ) : (
              <p className="admin-message">No AI analysis result yet.</p>
            )}
          </>
        ) : (
          <p className="admin-message">Run any STT test above to preview transcript and AI Ohm analysis.</p>
        )}
      </section>

      <section className="soft-card admin-section-minimal">
        <div className="section-title-row">
          <h2 className="section-title">Router9</h2>
        </div>

        <label className="field-stack">
          <span>API key</span>
          <input type="password" value={config.router9ApiKey} onChange={(e) => patchConfig('router9ApiKey', e.target.value)} />
        </label>
        <label className="field-stack">
          <span>Base URL</span>
          <input value={config.router9BaseUrl} onChange={(e) => patchConfig('router9BaseUrl', e.target.value)} />
        </label>
        <div className="action-row">
          <button className="ghost-pill-button" onClick={() => void handleFetchModels()} disabled={modelsState.status === 'loading'}>
            {modelsState.status === 'loading' ? 'Fetching…' : 'Fetch models'}
          </button>
          <StatusBadge label={modelsState.status === 'success' ? 'loaded' : modelsState.status === 'error' ? 'failed' : 'pending'} status={modelsState.status === 'success' ? 'success' : modelsState.status === 'error' ? 'error' : 'idle'} />
        </div>
        <p className="admin-message">{modelsState.message}</p>

        <div className="admin-grid two-up">
          <label className="field-stack">
            <span>Primary model</span>
            {modelOptions.length > 0 ? (
              <select value={config.router9Model} onChange={(e) => patchConfig('router9Model', e.target.value)}>
                <option value="">Select a model</option>
                {modelOptions.map((modelId) => <option key={modelId} value={modelId}>{modelId}</option>)}
              </select>
            ) : (
              <input value={config.router9Model} onChange={(e) => patchConfig('router9Model', e.target.value)} />
            )}
          </label>
          <label className="field-stack">
            <span>Fallback model</span>
            {modelOptions.length > 0 ? (
              <select value={config.router9FallbackModel} onChange={(e) => patchConfig('router9FallbackModel', e.target.value)}>
                <option value="">Select a fallback model</option>
                {modelOptions.map((modelId) => <option key={modelId} value={modelId}>{modelId}</option>)}
              </select>
            ) : (
              <input value={config.router9FallbackModel} onChange={(e) => patchConfig('router9FallbackModel', e.target.value)} />
            )}
          </label>
        </div>

        <div className="action-row">
          <button className="primary-pill-button" onClick={() => void handleTestRouter()} disabled={routerTestState.status === 'loading'}>
            {routerTestState.status === 'loading' ? 'Testing…' : 'Test Router9'}
          </button>
          <StatusBadge label={routerTestState.status === 'success' ? 'pass' : routerTestState.status === 'error' ? 'fail' : 'pending'} status={routerTestState.status === 'success' ? 'success' : routerTestState.status === 'error' ? 'error' : 'idle'} />
        </div>
        <p className="admin-message">{routerTestState.message}</p>
      </section>

      <section className="soft-card admin-section-minimal">
        <div className="section-title-row">
          <h2 className="section-title">OHM analysis (Router9)</h2>
        </div>

        <div className="admin-grid two-up">
          <label className="field-stack">
            <span>OHM primary model</span>
            {modelOptions.length > 0 ? (
              <select value={config.ohmModel} onChange={(e) => patchConfig('ohmModel', e.target.value)}>
                <option value="">Select a model</option>
                {modelOptions.map((modelId) => <option key={`ohm-${modelId}`} value={modelId}>{modelId}</option>)}
              </select>
            ) : (
              <input value={config.ohmModel} onChange={(e) => patchConfig('ohmModel', e.target.value)} placeholder="gpt" />
            )}
          </label>
          <label className="field-stack">
            <span>OHM fallback model</span>
            {modelOptions.length > 0 ? (
              <select value={config.ohmFallbackModel} onChange={(e) => patchConfig('ohmFallbackModel', e.target.value)}>
                <option value="">Select a fallback model</option>
                {modelOptions.map((modelId) => <option key={`ohm-fallback-${modelId}`} value={modelId}>{modelId}</option>)}
              </select>
            ) : (
              <input value={config.ohmFallbackModel} onChange={(e) => patchConfig('ohmFallbackModel', e.target.value)} placeholder="gpt" />
            )}
          </label>
        </div>

        <div className="admin-grid four-up">
          <label className="field-stack"><span>GREEN</span><input type="number" value={config.ohmWeights.GREEN} onChange={(e) => setConfig((prev) => ({ ...prev, ohmWeights: { ...prev.ohmWeights, GREEN: Number(e.target.value) || 0 } }))} /></label>
          <label className="field-stack"><span>BLUE</span><input type="number" value={config.ohmWeights.BLUE} onChange={(e) => setConfig((prev) => ({ ...prev, ohmWeights: { ...prev.ohmWeights, BLUE: Number(e.target.value) || 0 } }))} /></label>
          <label className="field-stack"><span>RED</span><input type="number" value={config.ohmWeights.RED} onChange={(e) => setConfig((prev) => ({ ...prev, ohmWeights: { ...prev.ohmWeights, RED: Number(e.target.value) || 0 } }))} /></label>
          <label className="field-stack"><span>PINK</span><input type="number" value={config.ohmWeights.PINK} onChange={(e) => setConfig((prev) => ({ ...prev, ohmWeights: { ...prev.ohmWeights, PINK: Number(e.target.value) || 0 } }))} /></label>
        </div>

        <div className="admin-grid four-up">
          <label className="field-stack"><span>Very short max sentences</span><input type="number" value={config.ohmLengthConstraints.veryShort.maxSentences} onChange={(e) => setConfig((prev) => ({ ...prev, ohmLengthConstraints: { ...prev.ohmLengthConstraints, veryShort: { ...prev.ohmLengthConstraints.veryShort, maxSentences: Number(e.target.value) || 1 } } }))} /></label>
          <label className="field-stack"><span>Very short max words</span><input type="number" value={config.ohmLengthConstraints.veryShort.maxWords} onChange={(e) => setConfig((prev) => ({ ...prev, ohmLengthConstraints: { ...prev.ohmLengthConstraints, veryShort: { ...prev.ohmLengthConstraints.veryShort, maxWords: Number(e.target.value) || 25 } } }))} /></label>
          <label className="field-stack"><span>Short max sentences</span><input type="number" value={config.ohmLengthConstraints.short.maxSentences} onChange={(e) => setConfig((prev) => ({ ...prev, ohmLengthConstraints: { ...prev.ohmLengthConstraints, short: { ...prev.ohmLengthConstraints.short, maxSentences: Number(e.target.value) || 2 } } }))} /></label>
          <label className="field-stack"><span>Short max words</span><input type="number" value={config.ohmLengthConstraints.short.maxWords} onChange={(e) => setConfig((prev) => ({ ...prev, ohmLengthConstraints: { ...prev.ohmLengthConstraints, short: { ...prev.ohmLengthConstraints.short, maxWords: Number(e.target.value) || 35 } } }))} /></label>
        </div>

        <div className="admin-grid four-up">
          <label className="field-stack"><span>Medium max sentences</span><input type="number" value={config.ohmLengthConstraints.medium.maxSentences} onChange={(e) => setConfig((prev) => ({ ...prev, ohmLengthConstraints: { ...prev.ohmLengthConstraints, medium: { ...prev.ohmLengthConstraints.medium, maxSentences: Number(e.target.value) || 3 } } }))} /></label>
          <label className="field-stack"><span>Medium max words</span><input type="number" value={config.ohmLengthConstraints.medium.maxWords} onChange={(e) => setConfig((prev) => ({ ...prev, ohmLengthConstraints: { ...prev.ohmLengthConstraints, medium: { ...prev.ohmLengthConstraints.medium, maxWords: Number(e.target.value) || 60 } } }))} /></label>
          <label className="field-stack"><span>Long max sentences</span><input type="number" value={config.ohmLengthConstraints.long.maxSentences} onChange={(e) => setConfig((prev) => ({ ...prev, ohmLengthConstraints: { ...prev.ohmLengthConstraints, long: { ...prev.ohmLengthConstraints.long, maxSentences: Number(e.target.value) || 5 } } }))} /></label>
          <label className="field-stack"><span>Long max words</span><input type="number" value={config.ohmLengthConstraints.long.maxWords} onChange={(e) => setConfig((prev) => ({ ...prev, ohmLengthConstraints: { ...prev.ohmLengthConstraints, long: { ...prev.ohmLengthConstraints.long, maxWords: Number(e.target.value) || 110 } } }))} /></label>
        </div>

        <div className="admin-grid four-up">
          <label className="field-stack"><span>Very short coef</span><select value={String(config.ohmLengthCoefficients.veryShort)} onChange={(e) => setConfig((prev) => ({ ...prev, ohmLengthCoefficients: { ...prev.ohmLengthCoefficients, veryShort: Number(e.target.value) } }))}><option value="1">1</option><option value="1.5">1.5</option><option value="2">2</option><option value="2.5">2.5</option></select></label>
          <label className="field-stack"><span>Short coef</span><select value={String(config.ohmLengthCoefficients.short)} onChange={(e) => setConfig((prev) => ({ ...prev, ohmLengthCoefficients: { ...prev.ohmLengthCoefficients, short: Number(e.target.value) } }))}><option value="1">1</option><option value="1.5">1.5</option><option value="2">2</option><option value="2.5">2.5</option></select></label>
          <label className="field-stack"><span>Medium coef</span><select value={String(config.ohmLengthCoefficients.medium)} onChange={(e) => setConfig((prev) => ({ ...prev, ohmLengthCoefficients: { ...prev.ohmLengthCoefficients, medium: Number(e.target.value) } }))}><option value="1">1</option><option value="1.5">1.5</option><option value="2">2</option><option value="2.5">2.5</option></select></label>
          <label className="field-stack"><span>Long coef</span><select value={String(config.ohmLengthCoefficients.long)} onChange={(e) => setConfig((prev) => ({ ...prev, ohmLengthCoefficients: { ...prev.ohmLengthCoefficients, long: Number(e.target.value) } }))}><option value="1">1</option><option value="1.5">1.5</option><option value="2">2</option><option value="2.5">2.5</option></select></label>
        </div>

        <p className="admin-message">Allowed coefficients: 1, 1.5, 2, 2.5. overLong is fixed at 2.5.</p>
      </section>

      <section className="soft-card admin-section-minimal">
        <div className="section-title-row">
          <h2 className="section-title">CCI cards</h2>
        </div>

        <p className="admin-message">These cards define the base Ample for CCI. Round page users can only select from this list; evaluator MSE is still entered later on the summary page.</p>

        <div className="admin-stack">
          {config.cciCards.map((card, index) => (
            <div key={card.id} className="admin-grid four-up cci-admin-row">
              <label className="field-stack">
                <span>Label</span>
                <input value={card.label} onChange={(e) => setConfig((prev) => ({ ...prev, cciCards: prev.cciCards.map((entry) => entry.id === card.id ? { ...entry, label: e.target.value } : entry) }))} />
              </label>
              <label className="field-stack">
                <span>Base A</span>
                <input type="number" min={0} step={0.5} value={card.baseA} onChange={(e) => setConfig((prev) => ({ ...prev, cciCards: prev.cciCards.map((entry) => entry.id === card.id ? { ...entry, baseA: Number(e.target.value) || 0 } : entry) }))} />
              </label>
              <label className="field-stack">
                <span>Icon</span>
                <select value={card.icon} onChange={(e) => setConfig((prev) => ({ ...prev, cciCards: prev.cciCards.map((entry) => entry.id === card.id ? { ...entry, icon: e.target.value as CciCard['icon'] } : entry) }))}>
                  <option value="hand">Hand</option>
                  <option value="users">Users</option>
                  <option value="waves">Waves</option>
                  <option value="blocks">Blocks</option>
                </select>
              </label>
              <div className="field-stack cci-admin-actions">
                <span>State</span>
                <div className="action-row">
                  <label className="toggle-row"><input type="checkbox" checked={card.active} onChange={(e) => setConfig((prev) => ({ ...prev, cciCards: prev.cciCards.map((entry) => entry.id === card.id ? { ...entry, active: e.target.checked } : entry) }))} />Active</label>
                  <button type="button" className="ghost-pill-button" onClick={() => setConfig((prev) => ({ ...prev, cciCards: prev.cciCards.filter((entry) => entry.id !== card.id).map((entry, idx) => ({ ...entry, order: idx })) }))} disabled={config.cciCards.length <= 1}>Remove</button>
                  {index > 0 && <button type="button" className="ghost-pill-button" onClick={() => setConfig((prev) => {
                    const next = [...prev.cciCards];
                    [next[index - 1], next[index]] = [next[index], next[index - 1]];
                    return { ...prev, cciCards: next.map((entry, idx) => ({ ...entry, order: idx })) };
                  })}>Up</button>}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="action-row">
          <button type="button" className="ghost-pill-button" onClick={() => setConfig((prev) => ({ ...prev, cciCards: [...prev.cciCards, createDraftCciCard(prev.cciCards.length)] }))}>Add CCI card</button>
        </div>
      </section>

      <section className="soft-card admin-section-minimal">
        <div className="section-title-row">
          <h2 className="section-title">Meaning match</h2>
        </div>

        <div className="admin-grid two-up">
          <label className="field-stack">
            <span>Strictness</span>
            <select value={config.meaningStrictness} onChange={(e) => patchConfig('meaningStrictness', e.target.value as AdminRuntimeConfig['meaningStrictness'])}>
              <option value="loose">Loose</option>
              <option value="medium">Medium</option>
              <option value="strict">Strict</option>
            </select>
          </label>
          <label className="field-stack">
            <span>Meaning weight</span>
            <input type="number" min={0} max={100} value={config.meaningWeight} onChange={(e) => patchConfig('meaningWeight', Number(e.target.value) || 0)} />
          </label>
        </div>

        <div className="admin-grid two-up">
          <label className="field-stack">
            <span>Feedback mode</span>
            <select value={config.feedbackMode} onChange={(e) => patchConfig('feedbackMode', e.target.value as AdminRuntimeConfig['feedbackMode'])}>
              <option value="gentle">Gentle</option>
              <option value="balanced">Balanced</option>
              <option value="detailed">Detailed</option>
            </select>
          </label>
          <label className="field-stack">
            <span>Tone</span>
            <select value={config.feedbackTone} onChange={(e) => patchConfig('feedbackTone', e.target.value as AdminRuntimeConfig['feedbackTone'])}>
              <option value="encouraging">Encouraging</option>
              <option value="neutral">Neutral</option>
              <option value="strict">Strict</option>
            </select>
          </label>
        </div>

        <label className="toggle-row"><input type="checkbox" checked={config.feedbackEnabled} onChange={(e) => patchConfig('feedbackEnabled', e.target.checked)} />Enable feedback</label>
        <label className="toggle-row"><input type="checkbox" checked={config.showGrammarReminder} onChange={(e) => patchConfig('showGrammarReminder', e.target.checked)} />Show grammar reminder</label>
        <label className="toggle-row"><input type="checkbox" checked={config.showImprovedSentence} onChange={(e) => patchConfig('showImprovedSentence', e.target.checked)} />Show improved sentence</label>
        <label className="toggle-row"><input type="checkbox" checked={config.showWhenMeaningCorrect} onChange={(e) => patchConfig('showWhenMeaningCorrect', e.target.checked)} />Show feedback even when meaning is correct</label>
        <label className="toggle-row"><input type="checkbox" checked={config.onlyIfAffectsClarity} onChange={(e) => patchConfig('onlyIfAffectsClarity', e.target.checked)} />Only show feedback if clarity is affected</label>
      </section>

      <div className="action-row sticky-save-row">
        <button className="primary-pill-button" onClick={() => void handleSave()}>Save admin config</button>
        {saved && <span className="save-pill">Saved</span>}
      </div>
    </main>
  );
}
