import React, { useEffect, useState, useCallback } from 'react'
import { FixedSizeList as List } from 'react-window'

interface Message {
  id: number
  thread_id: number
  content: string
  role: string
  timestamp: number
  thread_title: string
  provider: string
}

interface ImportResult {
  success: boolean
  runId: number
  artifactId: number
}

interface OnboardingProps {
  onComplete: () => void
  vaultPath?: string
  onWipe: () => void
}

function Onboarding({ onComplete, vaultPath, onWipe }: OnboardingProps) {
  const [step, setStep] = useState(1)
  const [providerTab, setProviderTab] = useState<'chatgpt' | 'claude' | 'gemini'>('chatgpt')

  const nextStep = () => setStep((s: number) => s + 1)
  const prevStep = () => setStep((s: number) => Math.max(1, s - 1))

  return (
    <div className="onboarding-overlay">
      <div className="onboarding-card">
        <div className="onboarding-progress">
          <div className={`dot ${step >= 1 ? 'active' : ''}`} />
          <div className={`dot ${step >= 2 ? 'active' : ''}`} />
          <div className={`dot ${step >= 3 ? 'active' : ''}`} />
        </div>

        {step === 1 && (
          <div className="onboarding-slide fade-in">
            <h2>Welcome to Cognition Vault</h2>
            <p className="mission-text">
              "Cognition Vault is local-only recall of your AI history. Nothing is uploaded."
            </p>
            <div className="feature-list">
              <div className="feature-item">🔒 <strong>Forensic Integrity</strong>: We store raw artifacts exactly as they were exported.</div>
              <div className="feature-item">⚡ <strong>Sub-millisecond Search</strong>: Instant recall across thousands of messages.</div>
              <div className="feature-item">🕵️ <strong>Local Privacy</strong>: Your data never leaves this machine. No telemetry.</div>
            </div>
            <button className="primary-btn" onClick={nextStep}>Let's Get Started</button>
          </div>
        )}

        {step === 2 && (
          <div className="onboarding-slide fade-in">
            <h2>How to Export & Import</h2>
            <div className="tab-switcher">
              <button
                className={providerTab === 'chatgpt' ? 'active' : ''}
                onClick={() => setProviderTab('chatgpt')}
              >
                ChatGPT
              </button>
              <button
                className={providerTab === 'claude' ? 'active' : ''}
                onClick={() => setProviderTab('claude')}
              >
                Claude
              </button>
              <button
                className={providerTab === 'gemini' ? 'active' : ''}
                onClick={() => setProviderTab('gemini')}
              >
                Gemini
              </button>
            </div>

            <div className="instruction-box">
              {providerTab === 'chatgpt' ? (
                <ol>
                  <li>Go to <strong>Settings</strong> {'>'} <strong>Data Controls</strong>.</li>
                  <li>Click <strong>Export Data</strong> and confirm.</li>
                  <li>Download the ZIP from your email.</li>
                  <li>Import that ZIP directly into Cognition Vault.</li>
                </ol>
              ) : providerTab === 'claude' ? (
                <ol>
                  <li>Go to <strong>Settings</strong> {'>'} <strong>Account</strong>.</li>
                  <li>Find <strong>Export Data</strong> section.</li>
                  <li>Click <strong>Request Data Export</strong>.</li>
                  <li>Download the ZIP when ready and import it here.</li>
                </ol>
              ) : (
                <ol>
                  <li>Go to <strong>takeout.google.com</strong>.</li>
                  <li>Deselect all and check only <strong>Gemini Apps</strong> (within My Activity).</li>
                  <li>Create export and download the resulting ZIP.</li>
                  <li>Import the ZIP or <code>conversations.json</code> here.</li>
                </ol>
              )}
            </div>

            <div className="button-group">
              <button className="secondary-btn" onClick={prevStep}>Back</button>
              <button className="primary-btn" onClick={nextStep}>Got It</button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="onboarding-slide fade-in">
            <h2>Your Data, Your Control</h2>
            <p>Your vault artifacts and search index are stored at:</p>
            <code className="path-box">{vaultPath || 'Calculating...'}</code>

            <div className="danger-zone">
              <h3>Wipe Vault</h3>
              <p>This will permanently delete all local archives and search data. This is only reversible if you still have your original export files.</p>
              <button className="danger-btn" onClick={() => {
                if (confirm('Are you sure you want to wipe EVERYTHING? This cannot be undone.')) {
                  onWipe()
                }
              }}>Wipe Vault Now</button>
            </div>

            <div className="button-group">
              <button className="secondary-btn" onClick={prevStep}>Back</button>
              <button className="primary-btn" onClick={onComplete}>Enter the Vault</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

interface DiagnosticsProps {
  onClose: () => void
}

function DiagnosticsModal({ onClose }: DiagnosticsProps) {
  const [data, setData] = useState<any>(null)
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied'>('idle')

  useEffect(() => {
    // @ts-ignore
    window.electronAPI.getDiagnostics().then(setData)
  }, [])

  const handleCopy = () => {
    if (data) {
      navigator.clipboard.writeText(JSON.stringify(data, null, 2))
      setCopyStatus('copied')
      setTimeout(() => setCopyStatus('idle'), 2000)
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal diagnostics-modal">
        <h2>Privacy-Safe Diagnostics</h2>
        <p className="onboarding-text">
          This contains no conversations or titles. Local metadata only.
        </p>

        <div className="json-preview">
          {data ? (
            <pre>{JSON.stringify(data, null, 2)}</pre>
          ) : (
            <div className="loading">Generating diagnostics...</div>
          )}
        </div>

        <div className="button-group-center">
          <button className="primary-btn" onClick={handleCopy}>
            {copyStatus === 'copied' ? 'Copied ✅' : 'Copy diagnostics to clipboard'}
          </button>
          <button className="close-modal-link" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}

function App() {
  const [vaultStatus, setVaultStatus] = useState<{ status: string; localOnly: boolean; vaultPath?: string } | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Message[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [lastImport, setLastImport] = useState<ImportResult | null>(null)
  const [showImportModal, setShowImportModal] = useState(false)
  const [showDiagnostics, setShowDiagnostics] = useState(false)
  const [highlightedMessageId, setHighlightedMessageId] = useState<number | null>(null)
  const [isOnboarding, setIsOnboarding] = useState(!localStorage.getItem('onboarding_completed'))

  const listRef = React.useRef<List>(null)

  const [perfMetrics, setPerfMetrics] = useState<{ median: number; p95: number; count: number }>({ median: 0, p95: 0, count: 0 })
  const [latencies, setLatencies] = useState<number[]>([])

  useEffect(() => {
    // @ts-ignore
    window.electronAPI.getVaultStatus().then(setVaultStatus)
  }, [])

  const handleSearch = useCallback(async (query: string, startTime?: number) => {
    if (!query.trim()) {
      setSearchResults([])
      return
    }
    setIsSearching(true)
    try {
      // @ts-ignore
      const results = await window.electronAPI.search(query)
      setSearchResults(results)

      if (startTime) {
        const endTime = performance.now()
        const duration = endTime - startTime
        setLatencies((prev: number[]) => {
          const next = [...prev, duration]
          const sorted = [...next].sort((a, b) => a - b)
          const median = sorted[Math.floor(sorted.length / 2)]
          const p95 = sorted[Math.floor(sorted.length * 0.95)]
          setPerfMetrics({ median, p95, count: next.length })
          return next
        })
      }
    } catch (err) {
      console.error('Search failed:', err)
    } finally {
      setIsSearching(false)
    }
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => {
      const start = performance.now()
      handleSearch(searchQuery, start)
    }, 300)
    return () => clearTimeout(timer)
  }, [searchQuery, handleSearch])

  const startImport = async (provider: string) => {
    setIsImporting(true)
    setShowImportModal(false)
    try {
      // @ts-ignore
      const result = await window.electronAPI.importFile(provider)
      if (result && result.success) {
        setLastImport(result)
      }
    } catch (err) {
      console.error('Import failed:', err)
      alert('Import failed: ' + (err as Error).message)
    } finally {
      setIsImporting(false)
    }
  }

  const handleWipe = async () => {
    try {
      // @ts-ignore
      await window.electronAPI.wipeVault()
      alert('Vault wiped successfully.')
      setSearchResults([])
      setSearchQuery('')
      // @ts-ignore
      window.electronAPI.getVaultStatus().then(setVaultStatus)
    } catch (err) {
      alert('Wipe failed: ' + (err as Error).message)
    }
  }

  const handleResultClick = (index: number, msgId: number) => {
    setHighlightedMessageId(msgId)
    if (listRef.current) {
      listRef.current.scrollToItem(index, 'center')
    }
    setTimeout(() => {
      setHighlightedMessageId(null)
    }, 2000)
  }

  const Row = ({ index, style }: { index: number; style: React.CSSProperties }) => {
    const msg = searchResults[index]
    const isHighlighted = highlightedMessageId === msg.id

    return (
      <div
        style={style}
        className={`search-result-item ${isHighlighted ? 'highlighted' : ''}`}
        onClick={() => handleResultClick(index, msg.id)}
      >
        <div className="result-meta">
          <span className="result-provider">{msg.provider}</span>
          <span className="result-thread">{msg.thread_title}</span>
          <span className="result-date">
            {msg.timestamp ? new Date(msg.timestamp).toLocaleDateString() : 'No date'}
          </span>
        </div>
        <div className="result-content">
          {msg.role === 'user' ? '👤 ' : '🤖 '}
          {msg.content.substring(0, 200)}...
        </div>
      </div>
    )
  }

  const completeOnboarding = () => {
    localStorage.setItem('onboarding_completed', 'true')
    setIsOnboarding(false)
  }

  return (
    <div className="app-container">
      {isOnboarding && (
        <Onboarding
          onComplete={completeOnboarding}
          vaultPath={vaultStatus?.vaultPath}
          onWipe={handleWipe}
        />
      )}

      {showDiagnostics && (
        <DiagnosticsModal onClose={() => setShowDiagnostics(false)} />
      )}

      <header>
        <div className="brand">
          <h1>Cognition Vault</h1>
          <div className="badge-container">
            {vaultStatus?.localOnly && <span className="badge">Local only ✅</span>}
          </div>
        </div>
        <div className="search-bar">
          <input
            type="text"
            placeholder="Search your history..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="search-input"
          />
        </div>
      </header>

      <main>
        {isSearching && <div className="loading">Searching...</div>}

        {isImporting && <div className="loading">Importing your conversations...</div>}

        {lastImport && (
          <div className="import-success-banner">
            <div className="summary-card">
              <h3>Import Summary</h3>
              <p>Import complete</p>
              <p>Integrity verified ✅</p>
              <button onClick={() => setLastImport(null)}>Dismiss</button>
            </div>
          </div>
        )}

        {!isSearching && !isImporting && searchResults.length > 0 && (
          <div className="results-container">
            <List
              ref={listRef}
              height={window.innerHeight - 200}
              itemCount={searchResults.length}
              itemSize={100}
              width={'100%'}
            >
              {Row}
            </List>
          </div>
        )}

        {!isSearching && !isImporting && searchQuery && searchResults.length === 0 && (
          <div className="no-results">No matches found for "{searchQuery}"</div>
        )}

        {!searchQuery && !isImporting && !lastImport && (
          <div className="hero">
            <p>Your AI history, preserved forever.</p>
            <div className="placeholder-content">
              Import your ChatGPT or Claude exports to begin.
            </div>
            <div className="hero-buttons">
              <button className="import-btn" onClick={() => setShowImportModal(true)}>Import your AI history</button>
              <button className="secondary-btn-outline" onClick={() => setIsOnboarding(true)}>How it works</button>
            </div>
          </div>
        )}
      </main>

      <footer>
        <div className="status-footer">
          <div className="status-group">
            <span>Vault: {vaultStatus?.status}</span>
            <button className="footer-link-btn" onClick={() => setShowDiagnostics(true)}>Diagnostics</button>
          </div>
          {perfMetrics.count > 0 && (
            <span className="perf-debug">
              E2E Latency (n={perfMetrics.count}): {perfMetrics.median.toFixed(2)}ms (median) / {perfMetrics.p95.toFixed(2)}ms (p95)
            </span>
          )}
        </div>
      </footer>

      {showImportModal && (
        <div className="modal-overlay">
          <div className="modal">
            <h2>Select Provider</h2>
            <div className="provider-grid">
              <button onClick={() => startImport('chatgpt')}>ChatGPT</button>
              <button onClick={() => startImport('claude')}>Claude</button>
              <button onClick={() => startImport('gemini')}>Gemini</button>
            </div>
            <button className="close-modal" onClick={() => setShowImportModal(false)}>Cancel</button>
          </div>
        </div>
      )}

      <style>{`
        :root {
          --bg-color: #0f172a;
          --text-color: #f8fafc;
          --accent-color: #38bdf8;
          --badge-bg: #1e293b;
          --badge-text: #10b981;
          --border-color: #334155;
          --input-bg: #1e293b;
          --danger-color: #ef4444;
        }
        body {
          margin: 0;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
          background-color: var(--bg-color);
          color: var(--text-color);
          overflow: hidden;
        }
        .app-container {
          height: 100vh;
          display: flex;
          flex-direction: column;
          padding: 0 2rem;
        }
        header {
          display: flex;
          flex-direction: column;
          gap: 1rem;
          padding: 2rem 0;
          border-bottom: 1px solid var(--border-color);
        }
        .brand {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        h1 {
          margin: 0;
          font-weight: 300;
          font-size: 1.5rem;
          letter-spacing: -0.025em;
        }
        .badge {
          background-color: var(--badge-bg);
          color: var(--badge-text);
          padding: 0.25rem 0.75rem;
          border-radius: 9999px;
          font-size: 0.75rem;
          font-weight: 500;
          border: 1px solid rgba(16, 185, 129, 0.2);
        }
        .search-bar {
          width: 100%;
        }
        .search-input {
          width: 100%;
          background-color: var(--input-bg);
          border: 1px solid var(--border-color);
          color: var(--text-color);
          padding: 0.75rem 1rem;
          border-radius: 0.5rem;
          font-size: 1rem;
          outline: none;
          transition: border-color 0.2s;
        }
        .search-input:focus {
          border-color: var(--accent-color);
        }
        main {
          flex: 1;
          overflow: hidden;
          padding-top: 1rem;
        }
        .results-container {
          height: 100%;
        }
        .search-result-item {
          border-bottom: 1px solid var(--border-color);
          padding: 1rem 0;
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
          cursor: pointer;
        }
        .search-result-item:hover {
          background-color: rgba(255, 255, 255, 0.05);
        }
        .search-result-item.highlighted {
          background-color: rgba(56, 189, 248, 0.2);
          border-left: 4px solid var(--accent-color);
          animation: fadeHighlight 2s ease-out forwards;
        }
        @keyframes fadeHighlight {
          0% { background-color: rgba(56, 189, 248, 0.4); }
          100% { background-color: transparent; }
        }
        .result-meta {
          display: flex;
          gap: 1rem;
          font-size: 0.75rem;
          color: #64748b;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .result-provider {
          color: var(--accent-color);
          font-weight: bold;
        }
        .result-content {
          font-size: 0.9rem;
          line-height: 1.5;
          color: #cbd5e1;
          white-space: pre-wrap;
          overflow: hidden;
          text-overflow: ellipsis;
          display: -webkit-box;
          -webkit-line-clamp: 3;
          -webkit-box-orient: vertical;
        }
        .hero {
          margin-top: 6rem;
          text-align: center;
        }
        .hero p {
          font-size: 1.25rem;
          color: #94a3b8;
        }
        .placeholder-content {
          margin: 2rem 0;
          color: #64748b;
          font-style: italic;
        }
        .hero-buttons {
          display: flex;
          gap: 1rem;
          justify-content: center;
        }
        .import-btn, .primary-btn {
          background-color: var(--accent-color);
          color: #000;
          border: none;
          padding: 0.75rem 1.5rem;
          border-radius: 0.375rem;
          font-weight: 600;
          cursor: pointer;
        }
        .secondary-btn, .secondary-btn-outline {
          background-color: transparent;
          color: #94a3b8;
          border: 1px solid var(--border-color);
          padding: 0.75rem 1.5rem;
          border-radius: 0.375rem;
          cursor: pointer;
        }
        .secondary-btn:hover, .secondary-btn-outline:hover {
          background-color: rgba(255, 255, 255, 0.05);
        }
        .danger-btn {
          background-color: var(--danger-color);
          color: white;
          border: none;
          padding: 0.5rem 1rem;
          border-radius: 0.375rem;
          cursor: pointer;
          font-weight: 600;
        }
        .loading, .no-results {
          text-align: center;
          margin-top: 4rem;
          color: #64748b;
        }
        footer {
          padding: 1rem 0;
          border-top: 1px solid var(--border-color);
          font-size: 0.75rem;
          color: #64748b;
        }
        .status-footer {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .status-group {
          display: flex;
          gap: 1.5rem;
          align-items: center;
        }
        .footer-link-btn {
          background: none;
          border: none;
          color: #64748b;
          cursor: pointer;
          font-size: 0.75rem;
          padding: 0;
        }
        .footer-link-btn:hover {
          color: var(--accent-color);
          text-decoration: underline;
        }
        .perf-debug {
          font-family: monospace;
          color: var(--accent-color);
          opacity: 0.8;
        }
        /* Diagnostics Modal */
        .diagnostics-modal {
          width: 600px;
          max-height: 80vh;
          overflow: hidden;
          display: flex;
          flex-direction: column;
        }
        .json-preview {
          background: #0f172a;
          padding: 1rem;
          border-radius: 0.5rem;
          margin: 1rem 0;
          flex: 1;
          overflow: auto;
          text-align: left;
          font-family: monospace;
          font-size: 0.75rem;
          border: 1px solid var(--border-color);
        }
        .json-preview pre {
          margin: 0;
          color: #94a3b8;
        }
        .button-group-center {
          display: flex;
          flex-direction: column;
          gap: 1rem;
          align-items: center;
          margin-top: 1rem;
        }
        .close-modal-link {
          background: none;
          border: none;
          color: #64748b;
          cursor: pointer;
          text-decoration: underline;
        }
        /* Onboarding Styles */
        .onboarding-overlay {
          position: fixed;
          top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(0,0,0,0.8);
          display: flex;
          justify-content: center;
          align-items: center;
          z-index: 2000;
        }
        .onboarding-card {
          background: #1e293b;
          padding: 3rem;
          border-radius: 1.5rem;
          width: 500px;
          min-height: 400px;
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
          display: flex;
          flex-direction: column;
        }
        .onboarding-progress {
          display: flex;
          justify-content: center;
          gap: 0.5rem;
          margin-bottom: 2rem;
        }
        .dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #334155;
        }
        .dot.active {
          background: var(--accent-color);
        }
        .onboarding-slide {
          flex: 1;
          display: flex;
          flex-direction: column;
        }
        .fade-in {
          animation: fadeIn 0.3s ease-in;
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .mission-text {
          font-size: 1.25rem;
          line-height: 1.5;
          color: var(--accent-color);
          font-style: italic;
          margin-bottom: 2rem;
          text-align: center;
        }
        .onboarding-text {
          color: #94a3b8;
          font-size: 0.9rem;
          margin-bottom: 1rem;
        }
        .feature-list {
          display: flex;
          flex-direction: column;
          gap: 1rem;
          margin-bottom: 2rem;
        }
        .feature-item {
          color: #94a3b8;
          font-size: 0.9rem;
        }
        .tab-switcher {
          display: flex;
          gap: 0.5rem;
          margin-bottom: 1rem;
          background: #0f172a;
          padding: 0.25rem;
          border-radius: 0.5rem;
        }
        .tab-switcher button {
          flex: 1;
          padding: 0.5rem;
          background: transparent;
          border: none;
          color: #64748b;
          cursor: pointer;
          border-radius: 0.25rem;
        }
        .tab-switcher button.active {
          background: #1e293b;
          color: var(--accent-color);
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
        }
        .instruction-box {
          background: #0f172a;
          padding: 1rem;
          border-radius: 0.5rem;
          margin-bottom: 1.5rem;
          font-size: 0.9rem;
          color: #cbd5e1;
        }
        .instruction-box ol {
          margin: 0;
          padding-left: 1.5rem;
        }
        .instruction-box li {
          margin-bottom: 0.5rem;
        }
        .path-box {
          background: #0f172a;
          padding: 0.75rem;
          border-radius: 0.375rem;
          font-family: monospace;
          font-size: 0.75rem;
          color: var(--accent-color);
          margin-bottom: 1.5rem;
          word-break: break-all;
        }
        .danger-zone {
          border: 1px solid rgba(239, 68, 68, 0.2);
          padding: 1rem;
          border-radius: 0.5rem;
          background: rgba(239, 68, 68, 0.05);
          margin-bottom: 2rem;
        }
        .danger-zone h3 {
          margin-top: 0;
          color: var(--danger-color);
          font-size: 0.9rem;
        }
        .danger-zone p {
          font-size: 0.8rem;
          color: #94a3b8;
        }
        .button-group {
          display: flex;
          justify-content: space-between;
          margin-top: auto;
        }
        .modal-overlay {
          position: fixed;
          top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(0,0,0,0.8);
          display: flex;
          justify-content: center;
          align-items: center;
          z-index: 1000;
        }
        .modal {
          background: #1e293b;
          padding: 2rem;
          border-radius: 1rem;
          width: 400px;
          text-align: center;
        }
        .provider-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 1rem;
          margin: 2rem 0;
        }
        .provider-grid button {
          padding: 1rem;
          background: #334155;
          color: white;
          border: 1px solid #475569;
          border-radius: 0.5rem;
          cursor: pointer;
        }
        .provider-grid button:hover {
          background: #475569;
        }
        .close-modal {
          background: none;
          border: none;
          color: #94a3b8;
          cursor: pointer;
        }
        .import-success-banner {
          margin: 2rem 0;
        }
        .summary-card {
          background: #1e293b;
          border: 1px solid var(--badge-text);
          padding: 1.5rem;
          border-radius: 0.5rem;
        }
      `}</style>
    </div>
  )
}

export default App
