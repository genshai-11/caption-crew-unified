import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, onSnapshot, orderBy, query, limit } from 'firebase/firestore';
import { useAdminAuth } from '@/auth/AdminAuthContext';
import { db } from '@/lib/firebase';
import {
  AdminRuntimeConfig,
  defaultAdminRuntimeConfig,
  loadAdminRuntimeConfig,
  loadSharedAdminRuntimeConfig,
  saveAdminRuntimeConfig,
  saveSharedAdminRuntimeConfig,
} from '@/services/adminConfigRepository';
import { defaultPublicTimingSettings, loadPublicTimingSettings, savePublicTimingSettings, type PublicTimingSettings } from '@/services/publicTimingRepository';
import { defaultPublicScoringSettings, loadPublicScoringSettings, savePublicScoringSettings, type PublicScoringSettings } from '@/services/publicScoringRepository';
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

interface TestState {
  status: 'idle' | 'loading' | 'success' | 'error';
  message: string;
  transcript?: string;
}

const idleTestState: TestState = {
  status: 'idle',
  message: 'Not tested yet.',
};

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

  const [timing, setTiming] = useState<PublicTimingSettings>(defaultPublicTimingSettings);
  const [scoring, setScoring] = useState<PublicScoringSettings>(defaultPublicScoringSettings);

  const [roomsStatus, setRoomsStatus] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle');
  const [roomsMessage, setRoomsMessage] = useState('');
  const [rooms, setRooms] = useState<Array<{ id: string; hostId?: string; captainId?: string | null; crewId?: string | null; status?: string; updatedAt?: any; createdAt?: any }>>([]);

  const captainRecorder = useRoundRecorder();
  const crewRecorder = useRoundRecorder();

  useEffect(() => {
    setConfig(loadAdminRuntimeConfig());
    void loadPublicTimingSettings().then(setTiming).catch(() => setTiming(defaultPublicTimingSettings));
    void loadPublicScoringSettings().then(setScoring).catch(() => setScoring(defaultPublicScoringSettings));
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

  useEffect(() => {
    if (!user?.email) return;
    if (!db) {
      setRoomsStatus('error');
      setRoomsMessage('Firestore not configured.');
      return;
    }

    setRoomsStatus('loading');
    setRoomsMessage('Loading recent rooms…');

    const q = query(collection(db, 'rooms'), orderBy('updatedAt', 'desc'), limit(30));
    const unsub = onSnapshot(
      q,
      (snap) => {
        if (!user?.email) return;
        setRooms(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setRoomsStatus('loaded');
        setRoomsMessage(`Loaded ${snap.size} recent room(s).`);
      },
      (error) => {
        setRoomsStatus('error');
        setRoomsMessage(error.message || 'Firestore rooms listener failed.');
      }
    );
    return () => unsub();
  }, [user?.email]);

  const patchConfig = <K extends keyof AdminRuntimeConfig>(key: K, value: AdminRuntimeConfig[K]) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    try {
      setCloudStatus('loading');
      setCloudMessage('Saving shared config…');
      saveAdminRuntimeConfig(config);
      const savedConfig = await saveSharedAdminRuntimeConfig(config);
      setConfig(savedConfig);
      
      await savePublicTimingSettings(timing);
      await savePublicScoringSettings(scoring);

      setSaved(true);
      setCloudStatus('saved');
      setCloudMessage('Shared config and public settings saved.');
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
        throw new Error(`Audio was recorded but no English speech was recognized. Request: ${result.requestId || 'n/a'}`);
      }
      const diagnostics = result.fallbackUsed ? ` • fallback ${result.modelUsed}` : ` • ${result.modelUsed || 'primary model'}`;
      setCrewTestState({
        status: 'success',
        message: `English STT OK • confidence ${(result.confidence || 0).toFixed(2)}${diagnostics}` ,
        transcript: result.transcript,
      });
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
          </>
        ) : (
          <p className="admin-message">Deepgram settings are active for transcript.</p>
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

      <section className="soft-card admin-section-minimal">
        <div className="section-title-row">
          <h2 className="section-title">Test transcription</h2>
          <p className="admin-message">Record Vietnamese/English sample audio to test transcription on current settings.</p>
        </div>
        <div className="admin-grid two-up">
          <div className="field-stack">
            <span>Captain (Vietnamese)</span>
            <div className="action-row">
              <button 
                className={`ghost-pill-button ${captainRecorder.isRecording ? 'pulse-active' : ''}`} 
                onClick={captainRecorder.isRecording ? () => void captainRecorder.stop() : () => void captainRecorder.start()}
              >
                {captainRecorder.isRecording ? 'Recording…' : 'Record sample'}
              </button>
              <button className="ghost-pill-button" onClick={() => void handleCaptainTranscriptionTest()} disabled={captainTestState.status === 'loading' || !captainRecorder.audioBlob}>
                Test Primary
              </button>
              <button className="ghost-pill-button" onClick={() => void handleGoogleCaptainTranscriptionTest()} disabled={googleCaptainTestState.status === 'loading' || !captainRecorder.audioBlob}>
                Test Google
              </button>
            </div>
            <p className="admin-message">{captainTestState.message}</p>
            <p className="admin-message">{googleCaptainTestState.message}</p>
            {captainTestState.transcript && <p className="admin-transcript-preview">{captainTestState.transcript}</p>}
            {googleCaptainTestState.transcript && <p className="admin-transcript-preview">{googleCaptainTestState.transcript}</p>}
          </div>

          <div className="field-stack">
            <span>Crew (English)</span>
            <div className="action-row">
              <button 
                className={`ghost-pill-button ${crewRecorder.isRecording ? 'pulse-active' : ''}`} 
                onClick={crewRecorder.isRecording ? () => void crewRecorder.stop() : () => void crewRecorder.start()}
              >
                {crewRecorder.isRecording ? 'Recording…' : 'Record sample'}
              </button>
              <button className="ghost-pill-button" onClick={() => void handleCrewTranscriptionTest()} disabled={crewTestState.status === 'loading' || !crewRecorder.audioBlob}>
                Test Primary
              </button>
              <button className="ghost-pill-button" onClick={() => void handleGoogleCrewTranscriptionTest()} disabled={googleCrewTestState.status === 'loading' || !crewRecorder.audioBlob}>
                Test Google
              </button>
            </div>
            <p className="admin-message">{crewTestState.message}</p>
            <p className="admin-message">{googleCrewTestState.message}</p>
            {crewTestState.transcript && <p className="admin-transcript-preview">{crewTestState.transcript}</p>}
            {googleCrewTestState.transcript && <p className="admin-transcript-preview">{googleCrewTestState.transcript}</p>}
          </div>
        </div>
      </section>

      <section className="soft-card admin-section-minimal">
        <div className="section-title-row">
          <h2 className="section-title">Active rooms ({rooms.length})</h2>
          <StatusBadge label={roomsStatus} status={roomsStatus === 'loaded' ? 'success' : roomsStatus === 'error' ? 'error' : 'loading'} />
        </div>
        <p className="admin-message">{roomsMessage}</p>
        <div className="room-list-grid">
          {rooms.map((room) => (
            <div key={room.id} className="room-card-mini">
              <div className="room-id">ID: {room.id}</div>
              <div className="room-meta">Status: {room.status}</div>
              <div className="room-meta">Role: {room.captainId ? 'Captain' : ''} {room.crewId ? 'Crew' : ''}</div>
              <div className="room-meta">Updated: {room.updatedAt?.toDate ? room.updatedAt.toDate().toLocaleTimeString() : 'n/a'}</div>
            </div>
          ))}
        </div>
      </section>

      <div className="action-row sticky-save-row">
        <button className="primary-pill-button" onClick={() => void handleSave()}>Save admin config</button>
        {saved && <span className="save-pill">Saved</span>}
      </div>
    </main>
  );
}
