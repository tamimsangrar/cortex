'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

const PROVIDERS = [
  { id: 'anthropic', name: 'Anthropic' },
  { id: 'openai', name: 'OpenAI' },
];

const TABS = [
  { id: 'personal', label: 'Personal Info' },
  { id: 'llm', label: 'LLM Provider' },
  { id: 'privacy', label: 'Data Privacy' },
  { id: 'mcp', label: 'MCP' },
  { id: 'danger', label: 'Destroy.all' },
] as const;

type TabId = typeof TABS[number]['id'];

/* ------------------------------------------------------------------ */
/*  Personal Info Tab                                                  */
/* ------------------------------------------------------------------ */

function PersonalInfoTab() {
  const ipc = typeof window !== 'undefined' ? window.cortex : null;
  const [profileName, setProfileName] = useState('');
  const [profileNicknames, setProfileNicknames] = useState('');
  const [compileTemp, setCompileTemp] = useState('0.5');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!ipc) return;
    if (ipc.getConfig) {
      ipc.getConfig().then((config: any) => {
        const profile = config?.userProfile;
        if (profile?.name) setProfileName(profile.name);
        if (profile?.nicknames?.length) setProfileNicknames(profile.nicknames.join(', '));
        if (config?.compileTemperature) setCompileTemp(String(config.compileTemperature));
      }).catch(() => {});
    }
  }, []);

  const handleSave = async () => {
    if (!ipc || !profileName.trim()) return;
    setSaving(true);
    try {
      await ipc.setConfig('userProfile', {
        name: profileName.trim(),
        nicknames: profileNicknames.split(',').map((s: string) => s.trim()).filter(Boolean),
      });
      await ipc.setConfig('compileTemperature', parseFloat(compileTemp) || 0.5);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      // silent
    }
    setSaving(false);
  };

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <label style={labelStyle}>Name</label>
        <input
          type="text"
          value={profileName}
          onChange={(e) => { setProfileName(e.target.value); setSaved(false); }}
          placeholder="Your name"
          style={inputStyle}
        />
      </div>
      <div style={{ marginBottom: 20 }}>
        <label style={labelStyle}>Nicknames</label>
        <input
          type="text"
          value={profileNicknames}
          onChange={(e) => { setProfileNicknames(e.target.value); setSaved(false); }}
          placeholder="e.g. Alex, AJ, buddy"
          style={inputStyle}
        />
        <p style={hintStyle}>Helps identify you in conversations</p>
      </div>
      <div style={{ marginBottom: 24 }}>
        <label style={labelStyle}>Writing Temperature</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input
            type="range" min="0.1" max="0.9" step="0.1"
            value={compileTemp}
            onChange={(e) => { setCompileTemp(e.target.value); setSaved(false); }}
            style={{ flex: 1, accentColor: '#d97757' }}
          />
          <span style={{ fontSize: 13, fontWeight: 600, color: '#1b1c1b', fontFamily: 'monospace', minWidth: 28 }}>
            {compileTemp}
          </span>
        </div>
        <p style={hintStyle}>Lower = factual. Higher = creative. Default 0.5.</p>
      </div>
      <button
        onClick={handleSave}
        disabled={!profileName.trim() || saving}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          background: profileName.trim() && !saving ? '#d97757' : '#e4e2e0',
          color: profileName.trim() && !saving ? '#ffffff' : '#88726c',
          padding: '8px 24px', borderRadius: 6, fontWeight: 500, fontSize: 13,
          border: 'none', cursor: profileName.trim() && !saving ? 'pointer' : 'not-allowed',
          fontFamily: 'Inter, sans-serif',
        }}
      >
        {saving ? 'Saving...' : saved ? 'Saved' : 'Save'}
        {saved && (
          <span className="material-symbols-outlined" style={{ fontSize: 16, color: '#ffffff', fontVariationSettings: "'FILL' 1" }}>check_circle</span>
        )}
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  LLM Provider Tab                                                   */
/* ------------------------------------------------------------------ */

function LlmProviderTab() {
  const ipc = typeof window !== 'undefined' ? window.cortex : null;
  const [provider, setProvider] = useState('anthropic');
  const [model, setModel] = useState('');
  const [fastModel, setFastModel] = useState('');
  const [models, setModels] = useState<{ id: string; name: string }[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testError, setTestError] = useState('');

  // Smart defaults per provider
  const FAST_MODEL_DEFAULTS: Record<string, string> = {
    anthropic: 'claude-haiku-4-5',
    openai: 'gpt-4.1-nano',
  };
  const WRITE_MODEL_DEFAULTS: Record<string, string> = {
    anthropic: 'claude-sonnet-4-6',
    openai: 'gpt-4.1',
  };

  const loadModels = useCallback(async (p: string) => {
    if (!ipc) return;
    setModelsLoading(true);
    try {
      const m = await ipc.fetchModels(p);
      const mapped = m.map((x: any) => ({ id: x.id, name: x.name }));
      setModels(mapped);
      if (mapped.length > 0 && !mapped.find((x: any) => x.id === model)) {
        setModel(WRITE_MODEL_DEFAULTS[p] || mapped[0].id);
      }
      if (mapped.length > 0 && !mapped.find((x: any) => x.id === fastModel)) {
        setFastModel(FAST_MODEL_DEFAULTS[p] || mapped[0].id);
      }
    } catch {
      const m = await ipc.getModels(p);
      setModels(m);
      if (m.length > 0 && !m.find((x: any) => x.id === model)) {
        setModel(WRITE_MODEL_DEFAULTS[p] || m[0].id);
      }
      if (m.length > 0 && !m.find((x: any) => x.id === fastModel)) {
        setFastModel(FAST_MODEL_DEFAULTS[p] || m[0].id);
      }
    } finally {
      setModelsLoading(false);
    }
    const has = await ipc.hasApiKey(p);
    setHasKey(has);
    setTestStatus('idle');
    setApiKey('');
  }, [ipc, model, fastModel]);

  useEffect(() => {
    if (!ipc) return;
    ipc.getProvider().then((saved: any) => {
      if (saved.provider) setProvider(saved.provider);
      if (saved.model) setModel(saved.model);
      if (saved.fastModel) setFastModel(saved.fastModel);
    });
  }, []);

  useEffect(() => { loadModels(provider); }, [provider, loadModels]);

  const handleProviderChange = (p: string) => {
    setProvider(p);
    if (ipc) ipc.setProvider(p, '', '');
  };

  const handleModelChange = (m: string) => {
    setModel(m);
    if (ipc) ipc.setProvider(provider, m, fastModel);
  };

  const handleFastModelChange = (m: string) => {
    setFastModel(m);
    if (ipc) ipc.setProvider(provider, model, m);
  };

  const handleSaveKey = async () => {
    if (!ipc || !apiKey.trim()) return;
    const result = await ipc.setApiKey(provider, apiKey.trim());
    if (result.success) {
      setHasKey(true);
      setApiKey('');
      setShowKey(false);
      loadModels(provider);
    }
  };

  const handleTest = async () => {
    if (!ipc) return;
    setTestStatus('testing');
    await ipc.setProvider(provider, model, fastModel);
    const result = await ipc.testConnection();
    if (result.success) {
      setTestStatus('success');
    } else {
      setTestStatus('error');
      setTestError(result.error || 'Connection failed');
    }
  };

  const isGitHub = provider === 'github';

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 12 }}>
        <div>
          <label style={labelStyle}>Service Provider</label>
          <select
            value={provider}
            onChange={(e) => handleProviderChange(e.target.value)}
            style={{ ...inputStyle, cursor: 'pointer', WebkitAppearance: 'menulist' }}
          >
            {PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label style={labelStyle}>
            Writer Model
            {modelsLoading && (
              <span style={{ marginLeft: 8, fontSize: 11, color: '#88726c', fontWeight: 400 }}>Refreshing...</span>
            )}
          </label>
          <select
            value={model}
            onChange={(e) => handleModelChange(e.target.value)}
            disabled={modelsLoading}
            style={{ ...inputStyle, cursor: 'pointer', color: modelsLoading ? '#88726c' : '#1b1c1b', WebkitAppearance: 'menulist' }}
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
          <p style={{ fontSize: 11, color: '#88726c', marginTop: 4, fontFamily: 'Inter, sans-serif' }}>Creates and updates wiki articles</p>
        </div>
      </div>

      <div style={{ marginBottom: 24 }}>
        <div style={{ maxWidth: 'calc(50% - 10px)', marginLeft: 'auto' }}>
          <label style={labelStyle}>Fast Model</label>
          <select
            value={fastModel}
            onChange={(e) => handleFastModelChange(e.target.value)}
            disabled={modelsLoading}
            style={{ ...inputStyle, cursor: 'pointer', color: modelsLoading ? '#88726c' : '#1b1c1b', WebkitAppearance: 'menulist' }}
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
          <p style={{ fontSize: 11, color: '#88726c', marginTop: 4, fontFamily: 'Inter, sans-serif' }}>Used for planning and triage — cheaper, faster</p>
        </div>
      </div>

      {/* GitHub sign-in */}
      {isGitHub && (
        <div style={{ marginBottom: 24 }}>
          {hasKey ? (
            <div style={{ background: '#f5f3f1', borderRadius: 8, padding: 16, display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 20, color: '#006b5f', fontVariationSettings: "'FILL' 1" }}>check_circle</span>
              <div>
                <p style={{ fontSize: 13, fontWeight: 600, color: '#1b1c1b', fontFamily: 'Inter, sans-serif' }}>Connected to GitHub</p>
                <p style={{ fontSize: 13, color: '#88726c', marginTop: 2, fontFamily: 'Inter, sans-serif' }}>Token saved securely</p>
              </div>
            </div>
          ) : (
            <div style={{ marginBottom: 16 }}>
              <button
                onClick={async () => {
                  if (!ipc || !ipc.detectGitHubCLIToken) return;
                  const res = await ipc.detectGitHubCLIToken();
                  if (res.success) {
                    setHasKey(true);
                    setTimeout(() => loadModels(provider), 500);
                  } else {
                    window.open('https://github.com/settings/tokens/new?scopes=&description=Cortex+App', '_blank');
                  }
                }}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                  background: 'rgba(153,70,42,0.06)', border: '1px solid rgba(219,193,185,0.3)', borderRadius: 8,
                  padding: '14px 24px', fontSize: 13, fontWeight: 600, color: '#99462a', cursor: 'pointer',
                  marginBottom: 8,
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 20 }}>login</span>
                Sign in with GitHub
              </button>
              <p style={{ fontSize: 13, color: '#88726c', textAlign: 'center', fontFamily: 'Inter, sans-serif' }}>
                Auto-detects your GitHub CLI token, or opens github.com to create one.
              </p>
            </div>
          )}

          {(provider !== 'github' || !hasKey) && (
            <div style={{ marginTop: 8 }}>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <input
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={hasKey ? '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022' : 'ghp_...'}
                  style={{ ...inputStyle, paddingRight: 48 }}
                />
                <button
                  onClick={() => setShowKey(!showKey)}
                  style={{ position: 'absolute', right: 12, background: 'none', border: 'none', color: '#55433d', cursor: 'pointer', padding: 0 }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
                    {showKey ? 'visibility_off' : 'visibility'}
                  </span>
                </button>
              </div>
              {apiKey.trim() && (
                <button onClick={handleSaveKey} style={smallButtonStyle}>Save Key</button>
              )}
              <p style={hintStyle}>
                Generate a PAT at github.com/settings/tokens with the models:read scope. Requires a GitHub Copilot subscription.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Non-GitHub API Key */}
      {!isGitHub && (
        <div style={{ marginBottom: 24 }}>
          <label style={labelStyle}>
            API Key {hasKey && <span style={{ color: '#006b5f', marginLeft: 8 }}>&#10003; Saved</span>}
          </label>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <input
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={hasKey ? '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022' : 'sk-ant-...'}
              style={{ ...inputStyle, paddingRight: 48 }}
            />
            <button
              onClick={() => setShowKey(!showKey)}
              style={{ position: 'absolute', right: 12, background: 'none', border: 'none', color: '#55433d', cursor: 'pointer', padding: 0 }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
                {showKey ? 'visibility_off' : 'visibility'}
              </span>
            </button>
          </div>
          {apiKey.trim() && (
            <button onClick={handleSaveKey} style={smallButtonStyle}>Save Key</button>
          )}
        </div>
      )}

      {/* Test Connection */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <p style={{ fontSize: 13, color: '#55433d', fontStyle: 'italic', fontFamily: 'Inter, sans-serif' }}>Encrypted via OS Keychain</p>
        <button
          onClick={handleTest}
          disabled={testStatus === 'testing' || !hasKey}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            background: hasKey ? '#d97757' : '#e4e2e0',
            color: hasKey ? '#ffffff' : '#88726c',
            padding: '8px 24px', borderRadius: 6, fontWeight: 500, fontSize: 13,
            border: 'none', cursor: hasKey ? 'pointer' : 'not-allowed',
            opacity: testStatus === 'testing' ? 0.7 : 1,
            fontFamily: 'Inter, sans-serif',
          }}
        >
          {testStatus === 'testing' ? 'Testing...' : 'Test Connection'}
          {testStatus === 'success' && (
            <span className="material-symbols-outlined" style={{ fontSize: 16, color: '#006b5f', fontVariationSettings: "'FILL' 1" }}>check_circle</span>
          )}
          {testStatus === 'error' && (
            <span className="material-symbols-outlined" style={{ fontSize: 16, color: '#ba1a1a', fontVariationSettings: "'FILL' 1" }}>error</span>
          )}
        </button>
      </div>
      {testStatus === 'error' && (
        <p style={{ fontSize: 13, color: '#ba1a1a', marginTop: 8, fontFamily: 'Inter, sans-serif' }}>{testError}</p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Data Privacy Tab                                                   */
/* ------------------------------------------------------------------ */

function DataPrivacyTab() {
  const [provider, setProvider] = useState('anthropic');
  const ipc = typeof window !== 'undefined' ? window.cortex : null;

  useEffect(() => {
    if (!ipc) return;
    ipc.getProvider().then((saved: any) => {
      if (saved.provider) setProvider(saved.provider);
    }).catch(() => {});
  }, []);

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 24 }}>
        <div style={{ background: '#f5f3f1', borderRadius: 10, padding: 20 }}>
          <p style={{ fontSize: 11, fontWeight: 600, color: '#55433d', textTransform: 'uppercase' as const, letterSpacing: '0.04em', marginBottom: 12, fontFamily: 'Inter, sans-serif' }}>
            Stored Locally
          </p>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: 13, color: '#55433d', lineHeight: 2, fontFamily: 'Inter, sans-serif' }}>
            <li>Messages and conversations</li>
            <li>Notes and web clips</li>
            <li>Wiki articles</li>
            <li>All configuration</li>
          </ul>
        </div>
        <div style={{ background: '#f5f3f1', borderRadius: 10, padding: 20 }}>
          <p style={{ fontSize: 11, fontWeight: 600, color: '#55433d', textTransform: 'uppercase' as const, letterSpacing: '0.04em', marginBottom: 12, fontFamily: 'Inter, sans-serif' }}>
            Sent to LLM Provider
          </p>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: 13, color: '#55433d', lineHeight: 2, fontFamily: 'Inter, sans-serif' }}>
            <li>Relevant entry text during compilation</li>
            <li>Chat messages for responses</li>
            <li>Wiki context for article generation</li>
          </ul>
        </div>
      </div>

      <p style={{ fontSize: 13, lineHeight: 1.7, color: '#55433d', marginBottom: 20, fontFamily: 'Inter, sans-serif' }}>
        No analytics or telemetry is collected. No data is sent anywhere other than your chosen LLM provider's API.
      </p>

      <div style={{ fontSize: 13, lineHeight: 1.8, color: '#88726c', marginBottom: 16, fontFamily: 'Inter, sans-serif' }}>
        <p style={{ marginBottom: 4 }}><strong style={{ color: '#55433d' }}>OpenAI:</strong> API data is not used for model training (since March 2023)</p>
        <p style={{ marginBottom: 4 }}><strong style={{ color: '#55433d' }}>Anthropic:</strong> API data is not used for training</p>
        <p style={{ marginBottom: 4 }}><strong style={{ color: '#55433d' }}>Other providers:</strong> Review their respective data policies before use.</p>
      </div>

      <a
        href="#"
        onClick={(e) => {
          e.preventDefault();
          const urls: Record<string, string> = {
            anthropic: 'https://www.anthropic.com/privacy',
            openai: 'https://openai.com/policies/privacy-policy',
          };
          const url = urls[provider] || urls.anthropic;
          window.open(url, '_blank');
        }}
        style={{ fontSize: 13, color: '#99462a', textDecoration: 'none', borderBottom: '1px solid rgba(153,70,42,0.3)', fontFamily: 'Inter, sans-serif' }}
      >
        Review your provider's data policy
      </a>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  MCP Tab                                                            */
/* ------------------------------------------------------------------ */

function McpTab() {
  const ipc = typeof window !== 'undefined' ? window.cortex : null;
  const [mcpStatus, setMcpStatus] = useState<{ running: boolean; port?: number }>({ running: false });
  const [mcpStarting, setMcpStarting] = useState(false);
  const [mcpError, setMcpError] = useState<string | null>(null);

  useEffect(() => {
    if (!ipc || !ipc.getMcpStatus) return;
    ipc.getMcpStatus().then((s: any) => setMcpStatus(s)).catch(() => {});
  }, []);

  const handleToggle = async () => {
    if (!ipc) return;
    setMcpError(null);
    if (mcpStatus.running) {
      await ipc.stopMcpServer();
      setMcpStatus({ running: false });
    } else {
      setMcpStarting(true);
      try {
        const result = await ipc.startMcpServer();
        if (result.running) {
          setMcpStatus({ running: true, port: result.port });
        } else {
          setMcpError(result.error || 'Failed to start server');
        }
      } catch (e: any) {
        setMcpError(e.message || 'Failed to start server');
      } finally {
        setMcpStarting(false);
      }
    }
  };

  return (
    <div>
      <p style={{ fontSize: 13, color: '#55433d', lineHeight: 1.6, marginBottom: 20, fontFamily: 'Inter, sans-serif' }}>
        Connect your LLM agent to Cortex via MCP (Model Context Protocol). This lets Claude, Copilot, Cursor, or any MCP-compatible agent search your wiki, read articles, and query your knowledge base.
      </p>

      {/* Server control */}
      <div style={{ background: '#f5f3f1', borderRadius: 8, padding: 16, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: mcpStatus.running ? 12 : 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%',
              background: mcpStatus.running ? '#006b5f' : '#dbc1b9',
              display: 'inline-block', flexShrink: 0,
            }} />
            <div>
              <p style={{ fontSize: 13, fontWeight: 600, color: '#1b1c1b', fontFamily: 'Inter, sans-serif' }}>
                HTTP Server {mcpStatus.running ? '-- Running' : '-- Stopped'}
              </p>
              {mcpStatus.running && mcpStatus.port && (
                <p style={{ fontSize: 11, color: '#88726c', marginTop: 2, fontFamily: 'Inter, sans-serif' }}>
                  Port {mcpStatus.port}
                </p>
              )}
            </div>
          </div>
          <button
            onClick={handleToggle}
            disabled={mcpStarting}
            style={{
              padding: '6px 16px',
              background: mcpStatus.running ? 'rgba(186,26,26,0.12)' : '#d97757',
              color: mcpStatus.running ? '#ba1a1a' : '#ffffff',
              border: mcpStatus.running ? '1px solid rgba(186,26,26,0.15)' : 'none',
              borderRadius: 6, fontSize: 13, fontWeight: 600,
              cursor: mcpStarting ? 'default' : 'pointer',
              opacity: mcpStarting ? 0.6 : 1,
              fontFamily: 'Inter, sans-serif',
            }}
          >
            {mcpStarting ? 'Starting...' : mcpStatus.running ? 'Stop Server' : 'Start Server'}
          </button>
        </div>
        {mcpStatus.running && mcpStatus.port && (
          <div style={{ background: '#ffffff', borderRadius: 6, padding: 12 }}>
            <p style={{ fontSize: 11, fontWeight: 600, color: '#88726c', textTransform: 'uppercase' as const, letterSpacing: '0.04em', marginBottom: 6, fontFamily: 'Inter, sans-serif' }}>Connection URL</p>
            <code style={{ fontSize: 13, color: '#99462a' }}>http://localhost:{mcpStatus.port}/sse</code>
            <p style={{ fontSize: 11, color: '#88726c', marginTop: 8, lineHeight: 1.5, fontFamily: 'Inter, sans-serif' }}>
              Connect any MCP-compatible client using SSE transport at this URL. Messages are sent via POST to /messages.
            </p>
          </div>
        )}
        {mcpError && (
          <p style={{ fontSize: 13, color: '#ba1a1a', marginTop: 8, fontFamily: 'Inter, sans-serif' }}>{mcpError}</p>
        )}
      </div>

      {/* Connection instructions */}
      <div style={{ background: '#f5f3f1', borderRadius: 8, padding: 16, marginBottom: 12 }}>
        <p style={{ fontSize: 11, fontWeight: 600, color: '#88726c', textTransform: 'uppercase' as const, letterSpacing: '0.04em', marginBottom: 8, fontFamily: 'Inter, sans-serif' }}>Claude Desktop</p>
        <p style={{ fontSize: 13, color: '#55433d', lineHeight: 1.6, fontFamily: 'Inter, sans-serif' }}>
          Add to your Claude Desktop config at<br/>
          <code style={{ background: '#ffffff', padding: '2px 6px', borderRadius: 3, fontSize: 11, color: '#99462a' }}>~/Library/Application Support/Claude/claude_desktop_config.json</code>
        </p>
      </div>
      <div style={{ background: '#f5f3f1', borderRadius: 8, padding: 16, marginBottom: 12 }}>
        <p style={{ fontSize: 11, fontWeight: 600, color: '#88726c', textTransform: 'uppercase' as const, letterSpacing: '0.04em', marginBottom: 8, fontFamily: 'Inter, sans-serif' }}>Claude Code CLI</p>
        <code style={{ fontSize: 13, color: '#99462a', display: 'block', padding: '8px 12px', background: '#ffffff', borderRadius: 4 }}>
          claude mcp add cortex -- npx tsx mcp/server.ts
        </code>
      </div>
      <div style={{ background: '#f5f3f1', borderRadius: 8, padding: 16 }}>
        <p style={{ fontSize: 11, fontWeight: 600, color: '#88726c', textTransform: 'uppercase' as const, letterSpacing: '0.04em', marginBottom: 8, fontFamily: 'Inter, sans-serif' }}>Other MCP clients</p>
        <p style={{ fontSize: 13, color: '#55433d', lineHeight: 1.6, fontFamily: 'Inter, sans-serif' }}>
          Point any MCP-compatible client to: <code style={{ background: '#ffffff', padding: '2px 6px', borderRadius: 3, fontSize: 11, color: '#99462a' }}>npx tsx mcp/server.ts</code><br/>
          8 tools available: search_wiki, read_article, list_articles, read_index, list_sources, read_source, search_sources, get_wiki_stats
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Danger Zone Tab                                                    */
/* ------------------------------------------------------------------ */

function DangerZoneTab() {
  const ipc = typeof window !== 'undefined' ? window.cortex : null;
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [nuking, setNuking] = useState(false);
  const [result, setResult] = useState<{ deletedEntries: number; deletedArticles: number; deletedChats: number } | null>(null);

  const handleNuke = async () => {
    if (!ipc || confirmText !== 'NUKE') return;
    setNuking(true);
    try {
      const res = await ipc.nukeAll();
      if (res.success) {
        setResult({ deletedEntries: res.deletedEntries, deletedArticles: res.deletedArticles, deletedChats: res.deletedChats });
        // Hard reload to root — forces Shell to re-check config and trigger onboarding
        setTimeout(() => { window.location.href = '/?reset=' + Date.now(); }, 2000);
      }
    } catch {
      // silent
    }
    setNuking(false);
  };

  return (
    <div>
      <div style={{
        background: 'rgba(186,26,26,0.08)',
        border: '1px solid rgba(186,26,26,0.2)',
        borderRadius: 12,
        padding: 20,
      }}>
        <h3 style={{ fontSize: 14, fontWeight: 500, color: '#ba1a1a', marginBottom: 8, fontFamily: 'Inter, sans-serif' }}>Reset Cortex</h3>
        <p style={{ fontSize: 13, color: '#55433d', lineHeight: 1.7, marginBottom: 16, fontFamily: 'Inter, sans-serif' }}>
          Permanently delete all sources, wiki articles, and chat history. Your API keys, wiki schema, and LLM configuration will be preserved.
        </p>

        {result ? (
          <div style={{ background: 'rgba(0,107,95,0.1)', borderRadius: 8, padding: 16 }}>
            <p style={{ fontSize: 13, color: '#006b5f', fontWeight: 600, fontFamily: 'Inter, sans-serif' }}>
              Reset complete. Deleted {result.deletedEntries} entries, {result.deletedArticles} articles, {result.deletedChats} chats. Reloading...
            </p>
          </div>
        ) : !showConfirm ? (
          <button
            onClick={() => setShowConfirm(true)}
            style={{
              background: '#ba1a1a',
              color: '#ffffff',
              padding: '10px 24px',
              borderRadius: 6,
              fontWeight: 600,
              fontSize: 13,
              border: 'none',
              cursor: 'pointer',
              fontFamily: 'Inter, sans-serif',
            }}
          >
            Reset Cortex
          </button>
        ) : (
          <div>
            <p style={{ fontSize: 13, color: '#ba1a1a', marginBottom: 12, lineHeight: 1.7, fontFamily: 'Inter, sans-serif' }}>
              This will permanently delete all your sources, wiki articles, and chat history. Your API keys will be preserved. Type NUKE to confirm.
            </p>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="Type NUKE"
                style={{
                  background: '#f5f3f1',
                  border: '1px solid rgba(186,26,26,0.3)',
                  borderRadius: 6,
                  padding: '9px 14px',
                  fontSize: 13,
                  color: '#1b1c1b',
                  outline: 'none',
                  fontFamily: 'Inter, sans-serif',
                  width: 140,
                }}
              />
              <button
                onClick={handleNuke}
                disabled={confirmText !== 'NUKE' || nuking}
                style={{
                  background: confirmText === 'NUKE' && !nuking ? '#ba1a1a' : '#e4e2e0',
                  color: confirmText === 'NUKE' && !nuking ? '#ffffff' : '#88726c',
                  padding: '9px 20px',
                  borderRadius: 6,
                  fontWeight: 600,
                  fontSize: 13,
                  border: 'none',
                  cursor: confirmText === 'NUKE' && !nuking ? 'pointer' : 'default',
                  fontFamily: 'Inter, sans-serif',
                }}
              >
                {nuking ? 'Nuking...' : 'Confirm Reset'}
              </button>
              <button
                onClick={() => { setShowConfirm(false); setConfirmText(''); }}
                style={{
                  background: 'none',
                  color: '#88726c',
                  padding: '9px 14px',
                  borderRadius: 6,
                  fontSize: 13,
                  border: '1px solid rgba(219,193,185,0.3)',
                  cursor: 'pointer',
                  fontFamily: 'Inter, sans-serif',
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Shared styles                                                      */
/* ------------------------------------------------------------------ */

const labelStyle: React.CSSProperties = {
  fontSize: 13, fontWeight: 500, color: '#55433d',
  display: 'block', marginBottom: 8, marginLeft: 4,
  fontFamily: 'Inter, sans-serif',
};

const inputStyle: React.CSSProperties = {
  width: '100%', background: '#f5f3f1',
  border: '1px solid rgba(219,193,185,0.3)', borderRadius: 6,
  padding: '10px 16px', fontSize: 13, color: '#1b1c1b',
  outline: 'none', fontFamily: 'Inter, sans-serif', boxSizing: 'border-box',
};

const hintStyle: React.CSSProperties = {
  fontSize: 11, color: '#88726c', marginTop: 6,
  fontFamily: 'Inter, sans-serif', lineHeight: 1.5,
};

const smallButtonStyle: React.CSSProperties = {
  marginTop: 8, padding: '6px 16px', background: '#efedec',
  color: '#1b1c1b', border: 'none', borderRadius: 4,
  fontSize: 13, fontWeight: 600, cursor: 'pointer',
  fontFamily: 'Inter, sans-serif',
};

/* ------------------------------------------------------------------ */
/*  Settings Panel                                                     */
/* ------------------------------------------------------------------ */

export function SettingsPanel({ open, onClose, inline }: { open: boolean; onClose: () => void; inline?: boolean }) {
  const [activeTab, setActiveTab] = useState<TabId>('personal');
  const backdropRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    if (!open || inline) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose, inline]);

  if (!open) return null;

  const renderTab = () => {
    switch (activeTab) {
      case 'personal': return <PersonalInfoTab />;
      case 'llm': return <LlmProviderTab />;
      case 'privacy': return <DataPrivacyTab />;
      case 'mcp': return <McpTab />;
      case 'danger': return <DangerZoneTab />;
    }
  };

  if (inline) {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#fbf9f7' }}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '20px 32px 0 32px', flexShrink: 0 }}>
          <h2 style={{ fontSize: 24, fontWeight: 500, color: '#1b1c1b', fontFamily: 'Newsreader, serif' }}>Settings</h2>
        </div>
        <div style={{ display: 'flex', gap: 0, padding: '16px 32px 0 32px', borderBottom: '1px solid rgba(219,193,185,0.2)', flexShrink: 0 }}>
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                padding: '8px 16px', background: 'none', border: 'none',
                borderBottom: activeTab === tab.id ? '2px solid #d97757' : '2px solid transparent',
                color: activeTab === tab.id ? '#99462a' : '#88726c',
                fontSize: 13, fontWeight: activeTab === tab.id ? 600 : 400,
                cursor: 'pointer', fontFamily: 'Inter, sans-serif',
                whiteSpace: 'nowrap' as const,
              }}
            >{tab.label}</button>
          ))}
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px', maxWidth: 520 }}>
          {renderTab()}
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Backdrop */}
      <div
        ref={backdropRef}
        onClick={(e) => { if (e.target === backdropRef.current) onClose(); }}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(27,28,27,0.18)',
          zIndex: 60,
        }}
      />

      {/* Panel */}
      <div style={{
        position: 'fixed',
        top: 0,
        left: 264,
        width: 480,
        height: '100%',
        background: '#ffffff',
        zIndex: 61,
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '4px 0 24px rgba(85,67,61,0.10)',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '20px 24px 0 24px', flexShrink: 0,
        }}>
          <h2 style={{
            fontSize: 24, fontWeight: 500, color: '#1b1c1b',
            fontFamily: 'Newsreader, serif', letterSpacing: '-0.02em',
          }}>
            Settings
          </h2>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: '#88726c', padding: 4, borderRadius: 6,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 20 }}>close</span>
          </button>
        </div>

        {/* Tab bar */}
        <div style={{
          display: 'flex', gap: 0, padding: '16px 24px 0 24px',
          borderBottom: '1px solid rgba(219,193,185,0.2)', flexShrink: 0,
        }}>
          {TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  background: 'none', border: 'none',
                  padding: '8px 14px 10px', cursor: 'pointer',
                  fontSize: 13, fontWeight: isActive ? 600 : 400,
                  color: isActive ? '#1b1c1b' : '#88726c',
                  fontFamily: 'Inter, sans-serif',
                  borderBottom: isActive ? '2px solid #d97757' : '2px solid transparent',
                  marginBottom: -1,
                  transition: 'color 0.15s',
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div style={{
          flex: 1, overflowY: 'auto', padding: '24px 24px 32px', maxWidth: 480,
        }}>
          {renderTab()}
        </div>
      </div>
    </>
  );
}
