import { useState, useEffect } from 'react';
import { Sun, Moon, Zap, Brain, TrendingUp, AlertTriangle, Clock, List, FileSpreadsheet, Activity } from 'lucide-react';
import { Dashboard } from './components/Dashboard';

function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  const [simResult, setSimResult] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>('overview');
  const [costOptimizationApplied, setCostOptimizationApplied] = useState<boolean>(false);
  
  // Real-time tracking and block selector override
  const [currentBlock, setCurrentBlock] = useState<number>(1);
  const [isAutoBlock, setIsAutoBlock] = useState<boolean>(true);
  const [currentTimeStr, setCurrentTimeStr] = useState<string>("");

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Hook to track the actual system time and map it to a 15-minute block (1-96)
  useEffect(() => {
    if (!isAutoBlock) return;
    const updateTime = () => {
      const now = new Date();
      const hours = now.getHours();
      const minutes = now.getMinutes();
      const totalMinutes = hours * 60 + minutes;
      
      const block = Math.floor(totalMinutes / 15) + 1;
      setCurrentBlock(Math.min(96, Math.max(1, block)));
      
      setCurrentTimeStr(now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    };

    updateTime(); // Initial call
    const interval = setInterval(updateTime, 60000); // Check every minute
    return () => clearInterval(interval);
  }, [isAutoBlock]);

  // Fetch simulation results whenever currentBlock changes
  useEffect(() => {
    setLoading(true);
    fetch('http://127.0.0.1:8000/api/simulation/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentBlock })
    })
      .then(res => {
        if (!res.ok) throw new Error("Simulation endpoint error");
        return res.json();
      })
      .then(data => {
        setSimResult(data);
        setError(null);
        setLoading(false);
      })
      .catch(err => {
        console.error("Backend simulation run failed:", err);
        setError("Failed to fetch simulation results. Ensure backend is running.");
        setLoading(false);
      });
  }, [currentBlock]);

  return (
    <div className="main-layout">
      {/* Sidebar Navigation */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <img className="sidebar-logo-img" src="/poweropt-logo.svg" alt="PowerOpt logo" />
          <span className="sidebar-logo-text">PowerOpt</span>
        </div>
        <nav className="sidebar-menu">
          <button 
            className={`sidebar-item ${activeTab === 'overview' ? 'active' : ''}`}
            onClick={() => setActiveTab('overview')}
          >
            <Brain size={18} /> Overview & Health
          </button>
          <button 
            className={`sidebar-item ${activeTab === 'scheduler' ? 'active' : ''}`}
            onClick={() => setActiveTab('scheduler')}
          >
            <FileSpreadsheet size={18} /> LGB Scheduler
          </button>
          <button 
            className={`sidebar-item ${activeTab === 'recommendations' ? 'active' : ''}`}
            onClick={() => setActiveTab('recommendations')}
          >
            <Zap size={18} /> Recommendations
          </button>
          <button 
            className={`sidebar-item ${activeTab === 'charts' ? 'active' : ''}`}
            onClick={() => setActiveTab('charts')}
          >
            <TrendingUp size={18} /> SCED Charts
          </button>
          <button 
            className={`sidebar-item ${activeTab === 'alerts' ? 'active' : ''}`}
            onClick={() => setActiveTab('alerts')}
          >
            <AlertTriangle size={18} /> Alerts Panel
          </button>
          <button 
            className={`sidebar-item ${activeTab === 'cost' ? 'active' : ''}`}
            onClick={() => setActiveTab('cost')}
          >
            <Activity size={18} /> Cost Optimization
          </button>
          <button 
            className={`sidebar-item ${activeTab === 'merit' ? 'active' : ''}`}
            onClick={() => setActiveTab('merit')}
          >
            <List size={18} /> Merit Order & Costs
          </button>
        </nav>
      </aside>

      {/* Main Content Area */}
      <main className="content-area">
        <header className="app-header">
          <div className="brand">
            <div className="title-group">
              <h2>PowerOpt Dispatch Dashboard</h2>
              <p>Real-Time Power Operations Decision Support</p>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
            {loading && (
              <span className="loading-badge">
                <span className="spinner-mini"></span> Optimizing SCED...
              </span>
            )}

            {/* Block selector control */}
            <div className="glass-card" style={{ padding: '6px 12px', display: 'flex', alignItems: 'center', gap: '10px', boxShadow: 'none' }}>
              <label style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', userSelect: 'none' }}>
                <input 
                  type="checkbox" 
                  checked={isAutoBlock} 
                  onChange={(e) => setIsAutoBlock(e.target.checked)} 
                />
                Auto Time
              </label>
              
              <select 
                value={currentBlock} 
                disabled={isAutoBlock}
                onChange={(e) => setCurrentBlock(Number(e.target.value))}
                style={{
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid var(--border-card)',
                  borderRadius: '4px',
                  color: 'var(--text-main)',
                  padding: '4px 8px',
                  outline: 'none',
                  fontSize: '0.85rem',
                  cursor: isAutoBlock ? 'not-allowed' : 'pointer'
                }}
              >
                {Array.from({ length: 96 }, (_, i) => (
                  <option key={i + 1} value={i + 1} style={{ background: '#111' }}>
                    Block T{i + 1} ({Math.floor(i * 15 / 60).toString().padStart(2, '0')}:{(i * 15 % 60).toString().padStart(2, '0')})
                  </option>
                ))}
              </select>
            </div>
            
            <div className="time-badge glass-card" style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--primary)', boxShadow: 'none' }}>
              <Clock size={16} />
              <span style={{ fontWeight: 'bold' }}>{isAutoBlock ? currentTimeStr : "Manual Mode"}</span>
              <span style={{ opacity: 0.7 }}>| Block T{currentBlock}</span>
            </div>

            <button
              className="theme-switch"
              onClick={() => setTheme(prev => (prev === 'light' ? 'dark' : 'light'))}
              title={`Switch to ${theme === 'light' ? 'Dark' : 'Light'} Mode`}
            >
              {theme === 'light' ? <Moon size={20} /> : <Sun size={20} />}
            </button>
          </div>
        </header>

        <div className="dashboard-container fade-in">
          {error && <div className="error-banner"><AlertTriangle size={20} /> {error}</div>}
          
          {loading && !simResult ? (
            <div className="loading-state">
              <div className="spinner-large"></div>
              <h2>Running 96-Block Optimization</h2>
              <p>Fetching real forecast data and computing SCED...</p>
            </div>
          ) : simResult ? (
            <>
              {/* KPI Section */}
              <section className="stats-grid">
                <div className="glass-card stat-card">
                  <div className="stat-info">
                    <span className="stat-label">Total Dispatch Cost</span>
                    <span className="stat-value">₹{simResult.totalCost.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                    <span className="stat-change up"><Activity size={12} /> Today's Operations</span>
                  </div>
                  <div className="stat-icon" style={{ background: 'rgba(59, 130, 246, 0.1)', color: 'var(--primary)' }}>
                    <Zap size={22} />
                  </div>
                </div>

                <div className="glass-card stat-card">
                  <div className="stat-info">
                    <span className="stat-label">Market Imports (RTM)</span>
                    <span className="stat-value">{Math.round(simResult.totalMarketBuy).toLocaleString()} MWh</span>
                    <span className="stat-change up">Sourced</span>
                  </div>
                  <div className="stat-icon" style={{ background: 'rgba(52, 211, 153, 0.1)', color: 'var(--accent-emerald)' }}>
                    <TrendingUp size={22} />
                  </div>
                </div>

                <div className="glass-card stat-card">
                  <div className="stat-info">
                    <span className="stat-label">Estimated Savings</span>
                    <span className="stat-value" style={{ color: 'var(--accent-emerald)' }}>
                      ₹{Math.round(simResult.totalSavings).toLocaleString('en-IN')}
                    </span>
                    <span className="stat-change" style={{ color: 'var(--accent-emerald)' }}>
                      vs Baseline
                    </span>
                  </div>
                  <div className="stat-icon" style={{ background: 'rgba(52, 211, 153, 0.1)', color: 'var(--accent-emerald)' }}>
                    <Brain size={22} />
                  </div>
                </div>
              </section>

              {/* Main Dashboard UI */}
              <Dashboard 
                data={simResult} 
                currentBlock={currentBlock} 
                activeTab={activeTab} 
                onBlockSelect={(block) => {
                  setIsAutoBlock(false);
                  setCurrentBlock(block);
                }}
                costOptimizationApplied={costOptimizationApplied}
                onApplyCostOptimization={() => setCostOptimizationApplied(true)}
                onResetCostOptimization={() => setCostOptimizationApplied(false)}
              />
            </>
          ) : null}
        </div>
      </main>
    </div>
  );
}

export default App;
