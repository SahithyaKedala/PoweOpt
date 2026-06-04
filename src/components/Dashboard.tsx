import { useMemo, useEffect } from 'react';
import {
  Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Line, Legend, ComposedChart, ReferenceLine
} from 'recharts';
import { AlertCircle, ShieldCheck, Database, Info, TrendingUp, AlertTriangle, HelpCircle } from 'lucide-react';

interface DashboardProps {
  data: any;
  currentBlock: number;
  activeTab: string;
  onBlockSelect?: (block: number) => void;
}

export const Dashboard = ({ data, currentBlock, activeTab, onBlockSelect }: DashboardProps) => {
  // 1. Process 96-block schedule data
  const processedData = useMemo(() => {
    if (!data || !data.dispatches) return [];
    
    const genMapping = data.generators || [];

    const roundNumber = (value: number, precision: number) => {
      const factor = Math.pow(10, precision);
      return Math.round(value * factor) / factor;
    };

    return data.dispatches.map((d: any) => {
      let centralThermal = 0;
      let stateThermal = 0;
      let ippThermal = 0;
      
      Object.entries(d.generatorOutputs || {}).forEach(([id, output]) => {
        const val = output as number;
        const gen = genMapping.find((g: any) => g.id === id);
        if (gen?.type === 'central') {
          centralThermal += val;
        } else if (gen?.type === 'ipp') {
          ippThermal += val;
        } else {
          stateThermal += val;
        }
      });

      const totalRenewable = d.mustRun.solar + d.mustRun.wind + d.mustRun.hydro;
      const totalThermalAvailability = Object.values(d.generatorAvailabilities || {}).reduce((acc: number, val: any) => acc + (val || 0), 0);
      const totalAvailability = totalThermalAvailability + totalRenewable;

      const availabilityValue = d.availability ?? totalAvailability;
      const forecastDelta = roundNumber(d.demand - availabilityValue, 2);
      return {
        block: d.block,
        time: d.timeStr,
        Demand: d.demand,
        Availability: availabilityValue,
        'State Thermal': stateThermal,
        'Central Thermal': centralThermal,
        'IPP Thermal': ippThermal,
        'Solar Must-Run': d.mustRun.solar,
        'Wind Must-Run': d.mustRun.wind,
        'Hydro Must-Run': d.mustRun.hydro,
        'Market Buy (RTM)': d.marketBuys?.rtm || 0,
        Shortage: d.unservedShortage || 0,
        Surplus: d.netBalance > 0 ? d.netBalance : 0,
        ForecastDelta: forecastDelta,
        ForecastShortage: forecastDelta > 0 ? forecastDelta : 0,
        ForecastSurplus: forecastDelta < 0 ? Math.abs(forecastDelta) : 0,
        'RTM Price (₹)': d.rtmPrice || 0,
        'Total Generation': (stateThermal + centralThermal + ippThermal + totalRenewable + (d.marketBuys?.rtm || 0)),
        
        // Raw outputs
        generatorOutputs: d.generatorOutputs || {},
        generatorAvailabilities: d.generatorAvailabilities || {},
        
        // Metadata
        totalThermalAvailability,
        totalAvailability,
        netDeficit: d.unservedShortage > 0 ? d.unservedShortage : 0,
        netSurplus: d.mustRunCurtailment > 0 ? d.mustRunCurtailment : 0,
        totalCost: d.totalCost || 0,
        cgsLocked: d.cgsLocked || false,
        warnings: d.warnings || []
      };
    });
  }, [data]);

  // Current block data
  const currentBlockData = useMemo(() => {
    if (!processedData || processedData.length === 0) return null;
    return processedData[currentBlock - 1] || processedData[0];
  }, [processedData, currentBlock]);

  const meritGenList = useMemo(() => {
    if (!data?.generators) return [];
    return [...data.generators].sort((a: any, b: any) => {
      const rankA = a.rank ?? 99;
      const rankB = b.rank ?? 99;
      if (rankA !== rankB) return rankA - rankB;
      if (a.cost !== b.cost) return a.cost - b.cost;
      return a.name.localeCompare(b.name);
    });
  }, [data?.generators]);

  // Custom Chart Tooltip (with safe guards for undefined properties)
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="glass-card tooltip-custom" style={{ padding: '12px', border: '1px solid rgba(255,255,255,0.1)' }}>
          <p style={{ margin: 0, fontWeight: 'bold', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '5px', marginBottom: '5px' }}>Block {label}</p>
          {payload.map((entry: any, index: number) => {
            const entryName = entry.name || '';
            const isMonetary = entryName.includes('Price') || entryName.includes('Cost');
            return (
              <div key={index} style={{ color: entry.color, display: 'flex', justifyContent: 'space-between', gap: '20px', fontSize: '0.85rem', padding: '2px 0' }}>
                <span>{entryName}:</span>
                <span style={{ fontWeight: '600' }}>
                  {isMonetary ? `₹${Number(entry.value).toLocaleString('en-IN')}` : `${Math.round(entry.value)} MW`}
                </span>
              </div>
            );
          })}
        </div>
      );
    }
    return null;
  };

  // Auto-scroll table to active row
  useEffect(() => {
    if (activeTab === 'scheduler') {
      const timer = setTimeout(() => {
        const activeRow = document.querySelector('.active-row');
        if (activeRow) {
          activeRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [currentBlock, activeTab]);

  // Cost Optimization Calculation
  const costSavingsList = useMemo(() => {
    if (!processedData || !data?.generators) return [];
    const gens = data.generators;
    const list: any[] = [];
    
    processedData.forEach((d: any) => {
      const rtmPriceKwh = d['RTM Price (₹)'] / 1000.0;
      Object.entries(d.generatorOutputs).forEach(([genId, output]) => {
        const val = output as number;
        const gen = gens.find((g: any) => g.id === genId);
        if (gen && gen.type === 'state' && val > 0.1 && rtmPriceKwh < gen.cost) {
          const minCap = gen.minCapacity || 45.0;
          const backedDown = val - minCap;
          if (backedDown > 1.0) {
            const savings = backedDown * (gen.cost - rtmPriceKwh) * 0.25 * 1000;
            list.push({
              block: d.block,
              time: d.time,
              genName: gen.name,
              genCost: gen.cost,
              rtmCost: rtmPriceKwh,
              output: val,
              backedDown: backedDown,
              savings: savings
            });
          }
        }
      });
    });
    return list;
  }, [processedData, data]);

  const totalSavingsCalculated = useMemo(() => {
    return costSavingsList.reduce((acc, curr) => acc + curr.savings, 0);
  }, [costSavingsList]);

  // --- SECTION 1: OVERVIEW ---
  if (activeTab === 'overview') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '30px' }}>
          {/* Current Block Status */}
          <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={{ borderBottom: '1px solid var(--border-card)', paddingBottom: '12px', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Database size={20} color="var(--primary)" />
              <h3 style={{ margin: 0 }}>Active Block Status (T{currentBlockData?.block})</h3>
            </div>
            {currentBlockData && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span className="text-muted">Time Block:</span>
                  <span style={{ fontWeight: '600' }}>T{currentBlockData.block} ({currentBlockData.time})</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span className="text-muted">Demand Load:</span>
                  <span style={{ fontWeight: '700', color: 'var(--text-main)' }}>{Math.round(currentBlockData.Demand)} MW</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span className="text-muted">Must-Run Renewable Generation:</span>
                  <span style={{ fontWeight: '600', color: 'var(--accent-emerald)' }}>
                    {Math.round(currentBlockData['Solar Must-Run'] + currentBlockData['Wind Must-Run'] + currentBlockData['Hydro Must-Run'])} MW
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span className="text-muted">State Thermal Generation:</span>
                  <span style={{ fontWeight: '600' }}>{Math.round(currentBlockData['State Thermal'])} MW</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span className="text-muted">Central CGS Generation:</span>
                  <span style={{ fontWeight: '600', color: currentBlockData.cgsLocked ? 'var(--accent-rose)' : 'var(--text-main)' }}>
                    {Math.round(currentBlockData['Central Thermal'])} MW {currentBlockData.cgsLocked ? '(Locked)' : ''}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span className="text-muted">IPP Generation:</span>
                  <span style={{ fontWeight: '600' }}>{Math.round(currentBlockData['IPP Thermal'])} MW</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border-card)', paddingTop: '10px' }}>
                  <span className="text-muted">Market Purchase (RTM):</span>
                  <span style={{ fontWeight: '700', color: 'var(--accent-amber)' }}>{Math.round(currentBlockData['Market Buy (RTM)'])} MW</span>
                </div>
                {currentBlockData.Shortage > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--accent-rose)' }}>
                    <span>Unserved Deficit:</span>
                    <span style={{ fontWeight: 'bold' }}>{Math.round(currentBlockData.Shortage)} MW</span>
                  </div>
                )}
              </div>
            )}
          </div>


        </div>
      </div>
    );
  }

  // --- SECTION 2: BLOCK SCHEDULE TABLE ---
  if (activeTab === 'scheduler') {
    return (
      <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-card)', paddingBottom: '15px' }}>
          <div>
            <h3 style={{ margin: 0 }}>PowerOpt SCED Scheduler Table</h3>
            <p style={{ margin: '4px 0 0 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              96-block schedule with must-runs, optimized generator dispatches in merit order, and RTM purchases.
            </p>
          </div>
        </div>
        
        <div className="table-responsive" style={{ maxHeight: '60vh', overflow: 'auto', border: '1px solid var(--border-card)', borderRadius: '8px' }}>
          <table className="data-table" style={{ borderCollapse: 'separate', borderSpacing: 0, width: 'max-content' }}>
            <thead style={{ position: 'sticky', top: 0, zIndex: 10 }}>
              <tr>
                <th className="sticky-col" style={{ left: 0, zIndex: 11 }}>Block</th>
                <th className="sticky-col-time" style={{ left: 60, zIndex: 11 }}>Time</th>
                <th className="sticky-col-demand text-right" style={{ left: 160, zIndex: 11 }}>Demand</th>
                <th className="sticky-col-avail text-right" style={{ left: 260, zIndex: 11, color: 'var(--accent-emerald)' }}>Forecast Avail</th>
                <th className="text-right" style={{ color: 'var(--accent-amber)' }}>Solar</th>
                <th className="text-right" style={{ color: 'var(--primary)' }}>Wind</th>
                <th className="text-right" style={{ color: 'var(--accent-emerald)' }}>Hydro</th>
                <th className="text-center">CGS Lock Status</th>
                <th className="text-right" style={{ color: 'var(--accent-rose)' }}>Shortage</th>
                <th className="text-right" style={{ color: 'var(--accent-teal)' }}>Surplus</th>
                <th className="text-right">MCP (₹/kWh)</th>
                <th className="text-right" style={{ fontWeight: 'bold' }}>Opt Cost</th>
              </tr>
            </thead>
            <tbody>
              {processedData.map((d: any) => {
                const isCurrent = d.block === currentBlock;
                const forecastDelta = d.ForecastDelta ?? (d.Demand - d.Availability);
                return (
                  <tr key={d.block} className={isCurrent ? 'active-row' : ''} style={{ fontStyle: isCurrent ? 'italic' : 'normal' }}>
                    <td className="sticky-col" style={{ left: 0, fontWeight: 'bold' }}>{d.block}</td>
                    <td className="sticky-col-time" style={{ left: 60 }}>{d.time}</td>
                    <td className="sticky-col-demand text-right" style={{ left: 160, fontWeight: '700' }}>{Math.round(d.Demand)}</td>
                    <td className="sticky-col-avail text-right" style={{ left: 260, fontWeight: '700', color: 'var(--accent-emerald)' }}>{Math.round(d.Availability)}</td>
                    <td className="text-right" style={{ color: 'var(--accent-amber)' }}>{Math.round(d['Solar Must-Run'])}</td>
                    <td className="text-right" style={{ color: 'var(--primary)' }}>{Math.round(d['Wind Must-Run'])}</td>
                    <td className="text-right" style={{ color: 'var(--accent-emerald)' }}>{Math.round(d['Hydro Must-Run'])}</td>
                    <td className="text-center">
                      <span style={{ 
                        padding: '3px 8px', 
                        borderRadius: '12px', 
                        fontSize: '0.75rem', 
                        fontWeight: '600',
                        backgroundColor: d.cgsLocked ? 'rgba(244, 63, 94, 0.15)' : 'rgba(52, 211, 153, 0.15)',
                        color: d.cgsLocked ? 'var(--accent-rose)' : 'var(--accent-emerald)'
                      }}>
                        {d.cgsLocked ? '🔒 Locked' : '🔓 State Only'}
                      </span>
                    </td>
                    
                    <td className="text-right text-danger" style={{ fontWeight: 'bold' }}>
                      {d.ForecastShortage > 0 ? Math.round(d.ForecastShortage) : '-'}
                    </td>
                    <td className="text-right" style={{ fontWeight: 'bold', color: 'var(--accent-teal)' }}>
                      {d.ForecastSurplus > 0 ? Math.round(d.ForecastSurplus) : '-'}
                    </td>
                    <td className="text-right" style={{ fontSize: '0.85rem' }}>₹{(d.rtmPriceKwh || (d['RTM Price (₹)']/1000 || 0)).toFixed(2)}</td>
                    <td className="text-right" style={{ fontWeight: 'bold' }}>₹{Math.round(d.totalCost).toLocaleString('en-IN')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // --- SECTION 3: RECOMMENDATIONS ---
  if (activeTab === 'recommendations') {
    const isEven = currentBlock % 2 === 0;

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
        {/* Lock Boundary Info Card */}
        <div className="glass-card" style={{ display: 'flex', alignItems: 'center', gap: '15px', borderLeft: '4px solid var(--primary)' }}>
          <Info size={24} color="var(--primary)" />
          <div>
            <h4 style={{ margin: 0 }}>Gate-Closure Locking Rules</h4>
            <p style={{ margin: '4px 0 0 0', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
              ODD Current Block locks CGS at <strong>T+7</strong> onwards. EVEN Current Block locks CGS at <strong>T+8</strong> onwards. In-between window uses State-only assets.
            </p>
          </div>
        </div>

        {isEven ? (
          <div className="glass-card">
            <div style={{ borderBottom: '1px solid var(--border-card)', paddingBottom: '15px', marginBottom: '20px' }}>
              <h3 style={{ margin: 0 }}>2-Hour Sourcing Recommendations (T{currentBlock + 1} to T{currentBlock + 8})</h3>
              <p style={{ margin: '4px 0 0 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                System-read suggestions generated during even block gate-closure at Block T{currentBlock}.
              </p>
            </div>

            {data?.recommendations && data.recommendations.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                {data.recommendations.map((rec: any, idx: number) => {
                  const isCost = rec.type === 'cost_optimization';
                  return (
                    <div key={idx} style={{ 
                      padding: '16px 20px', 
                      background: isCost ? 'rgba(59, 130, 246, 0.08)' : 'rgba(251, 191, 36, 0.08)',
                      borderRadius: '12px',
                      borderLeft: isCost ? '4px solid var(--primary)' : '4px solid var(--accent-amber)',
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '15px'
                    }}>
                      <div style={{ 
                        background: isCost ? 'var(--primary-glow)' : 'rgba(251, 191, 36, 0.15)',
                        color: isCost ? 'var(--primary)' : 'var(--accent-amber)',
                        padding: '6px',
                        borderRadius: '6px',
                        fontSize: '0.8rem',
                        fontWeight: 'bold'
                      }}>
                        Block T{rec.block}
                      </div>
                      <div style={{ flexGrow: 1, fontSize: '0.95rem', color: 'var(--text-main)', lineHeight: '1.4' }}>
                        {rec.message}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ padding: '30px', textAlign: 'center', color: 'var(--text-muted)' }}>
                <ShieldCheck size={48} color="var(--accent-emerald)" style={{ marginBottom: '15px' }} />
                <h4>No Actions Required</h4>
                <p>Grid is fully optimized and balanced for the next 2 hours.</p>
              </div>
            )}
          </div>
        ) : (
          <div className="glass-card" style={{ textAlign: 'center', padding: '50px 30px' }}>
            <HelpCircle size={64} color="var(--primary)" style={{ marginBottom: '20px', opacity: 0.7 }} />
            <h3 style={{ marginBottom: '10px' }}>Recommendations Restricted to Even Blocks</h3>
            <p style={{ maxWidth: '600px', margin: '0 auto 20px auto', color: 'var(--text-muted)', lineHeight: '1.5' }}>
              According to operating rules, grid optimization recommendations are published at even gate closures (Block 2, 4, 6, ...). Block T{currentBlock} is odd.
            </p>
            {onBlockSelect && (
              <button 
                className="glass-card" 
                style={{ 
                  background: 'var(--primary-glow)', 
                  color: 'var(--primary)', 
                  border: '1px solid var(--primary)',
                  padding: '10px 20px',
                  fontWeight: 'bold',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px'
                }}
                onClick={() => onBlockSelect(Math.min(96, currentBlock + 1))}
              >
                Switch to Block T{currentBlock + 1} (Even) to View Recommendations
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  // --- SECTION 4: SCED ANALYTICS CHARTS ---
  if (activeTab === 'charts') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
        {/* Load Generation Balance */}
        <div className="glass-card chart-container">
          <div className="chart-header">
            <h3>Grid Dispatch Profile (Load vs Sourcing)</h3>
            <p>96-block demand load profile vs cumulative optimized dispatch</p>
          </div>
          <div style={{ width: '100%', height: 350 }}>
            <ResponsiveContainer>
              <ComposedChart data={processedData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorDemand" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#f43f5e" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorGen" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.5}/>
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis dataKey="time" stroke="rgba(255,255,255,0.3)" fontSize={12} tickMargin={10} minTickGap={30} />
                <YAxis stroke="rgba(255,255,255,0.3)" fontSize={12} />
                <Tooltip content={<CustomTooltip />} />
                <Legend verticalAlign="top" height={36} iconType="circle" />
                {currentBlockData?.time && (
                  <ReferenceLine x={currentBlockData.time} stroke="#22c55e" strokeDasharray="3 3" label={{ value: 'Now', position: 'top', fill: '#22c55e', fontSize: 12 }} />
                )}
                <Area type="monotone" dataKey="Total Generation" stroke="#3b82f6" fillOpacity={1} fill="url(#colorGen)" strokeWidth={2} name="Total Generation" />
                <Line type="monotone" dataKey="Demand" stroke="#f43f5e" strokeWidth={2.5} dot={false} name="Forecast Demand" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Breakdown Mix */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '30px' }}>
          <div className="glass-card chart-container">
            <div className="chart-header">
              <h3>Generation Sourcing Mix</h3>
              <p>Contribution of different resource categories to balance the grid</p>
            </div>
            <div style={{ width: '100%', height: 300 }}>
              <ResponsiveContainer>
                <BarChart data={processedData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                  <XAxis dataKey="time" stroke="rgba(255,255,255,0.3)" fontSize={12} tickMargin={10} minTickGap={30} />
                  <YAxis stroke="rgba(255,255,255,0.3)" fontSize={12} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: '12px' }} />
                  <Bar dataKey="State Thermal" stackId="a" fill="#ea580c" name="State Thermal" />
                  <Bar dataKey="Central Thermal" stackId="a" fill="#8b5cf6" name="Central CGS" />
                  <Bar dataKey="IPP Thermal" stackId="a" fill="#ec4899" name="IPP Thermal" />
                  <Bar dataKey="Hydro Must-Run" stackId="a" fill="#10b981" name="Hydro Sourcing" />
                  <Bar dataKey="Solar Must-Run" stackId="a" fill="#fbbf24" name="Solar" />
                  <Bar dataKey="Wind Must-Run" stackId="a" fill="#0ea5e9" name="Wind" />
                  <Bar dataKey="Market Buy (RTM)" stackId="a" fill="#ef4444" name="RTM Buy" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="glass-card chart-container">
            <div className="chart-header">
              <h3>RTM Prices & Clearing Trend</h3>
              <p>Clearing price profile from market_prices table</p>
            </div>
            <div style={{ width: '100%', height: 300 }}>
              <ResponsiveContainer>
                <ComposedChart data={processedData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                  <XAxis dataKey="time" stroke="rgba(255,255,255,0.3)" fontSize={12} tickMargin={10} minTickGap={30} />
                  <YAxis stroke="rgba(255,255,255,0.3)" fontSize={12} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend iconType="circle" />
                  {currentBlockData?.time && (
                    <ReferenceLine x={currentBlockData.time} stroke="#22c55e" strokeDasharray="3 3" label={{ value: 'Now', position: 'top', fill: '#22c55e', fontSize: 12 }} />
                  )}
                  <Line type="monotone" dataKey="RTM Price (₹)" stroke="#fbbf24" strokeWidth={2.5} dot={false} name="RTM MCP (₹/MWh)" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // --- SECTION 5: ALERTS PANEL ---
  if (activeTab === 'alerts') {
    const alerts = data?.alerts || [];

    return (
      <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div style={{ borderBottom: '1px solid var(--border-card)', paddingBottom: '15px' }}>
          <h3 style={{ margin: 0 }}>Active Grid Alerts</h3>
          <p style={{ margin: '4px 0 0 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            System-generated alerts for grid instability, unserved shortages, and operational locks in the next 2 hours.
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
          {alerts.map((alert: any, idx: number) => {
            const isCritical = alert.type === 'critical';
            return (
              <div key={idx} style={{ 
                padding: '16px 20px', 
                background: isCritical ? 'rgba(244, 63, 94, 0.08)' : 'rgba(52, 211, 153, 0.08)',
                borderRadius: '12px',
                borderLeft: isCritical ? '4px solid var(--accent-rose)' : '4px solid var(--accent-emerald)',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '15px'
              }}>
                {isCritical ? (
                  <AlertCircle size={20} color="var(--accent-rose)" style={{ marginTop: '2px' }} />
                ) : (
                  <ShieldCheck size={20} color="var(--accent-emerald)" style={{ marginTop: '2px' }} />
                )}
                <div style={{ flexGrow: 1 }}>
                  <h4 style={{ margin: 0, fontSize: '0.98rem', fontWeight: 'bold' }}>{alert.message}</h4>
                  <p style={{ margin: '4px 0 0 0', fontSize: '0.88rem', color: 'var(--text-muted)' }}>{alert.detail}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // --- SECTION 6: COST OPTIMIZATION ---
  if (activeTab === 'cost') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
        {/* KPI stat summary */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '30px' }}>
          <div className="glass-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <span className="text-muted" style={{ fontSize: '0.9rem' }}>Opportunity Cost Savings (Active)</span>
              <h2 style={{ fontSize: '2.2rem', fontWeight: 'bold', color: 'var(--accent-emerald)', margin: '5px 0' }}>
                ₹{Math.round(totalSavingsCalculated).toLocaleString('en-IN')}
              </h2>
              <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                Total savings realized by backing down high-cost state thermals and importing from RTM.
              </p>
            </div>
            <div style={{ background: 'rgba(52, 211, 153, 0.15)', color: 'var(--accent-emerald)', padding: '16px', borderRadius: '50%' }}>
              <TrendingUp size={24} />
            </div>
          </div>

          <div className="glass-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <span className="text-muted" style={{ fontSize: '0.9rem' }}>Market Import Saturated Blocks</span>
              <h2 style={{ fontSize: '2.2rem', fontWeight: 'bold', color: 'var(--accent-amber)', margin: '5px 0' }}>
                {processedData.filter((d: any) => d['Market Buy (RTM)'] >= 499.0).length} / 96
              </h2>
              <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                Blocks where RTM buy has hit the 500 MW corridor import limit.
              </p>
            </div>
            <div style={{ background: 'rgba(251, 191, 36, 0.15)', color: 'var(--accent-amber)', padding: '16px', borderRadius: '50%' }}>
              <AlertTriangle size={24} />
            </div>
          </div>
        </div>

        {/* Detailed Sourcing Table */}
        <div className="glass-card">
          <div style={{ borderBottom: '1px solid var(--border-card)', paddingBottom: '15px', marginBottom: '20px' }}>
            <h3 style={{ margin: 0 }}>Cost Optimization Sourcing Details</h3>
            <p style={{ margin: '4px 0 0 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              Comparison where State Thermal Variable Cost (₹/kWh) is sourced from the real database merit curve and compared to RTM market cost.
            </p>
          </div>

          {costSavingsList.length > 0 ? (
            <div className="table-responsive" style={{ border: '1px solid var(--border-card)', borderRadius: '8px' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="text-center">Block</th>
                    <th>Time</th>
                    <th>Generator</th>
                    <th className="text-right">Variable Cost (₹/kWh)</th>
                    <th className="text-right">RTM Price (₹/kWh)</th>
                    <th className="text-right">Current Output (MW)</th>
                    <th className="text-right">Backed Down (MW)</th>
                    <th className="text-right" style={{ color: 'var(--accent-emerald)', fontWeight: 'bold' }}>Savings this block</th>
                  </tr>
                </thead>
                <tbody>
                  {costSavingsList.map((c: any, idx: number) => (
                    <tr key={idx}>
                      <td className="text-center" style={{ fontWeight: 'bold' }}>{c.block}</td>
                      <td>{c.time}</td>
                      <td style={{ fontWeight: '600' }}>{c.genName}</td>
                      <td className="text-right" style={{ color: 'var(--accent-rose)', fontWeight: '600' }}>₹{c.genCost.toFixed(3)}</td>
                      <td className="text-right" style={{ color: 'var(--accent-emerald)', fontWeight: '600' }}>₹{c.rtmCost.toFixed(3)}</td>
                      <td className="text-right">{Math.round(c.output)} MW</td>
                      <td className="text-right" style={{ color: 'var(--primary)', fontWeight: 'bold' }}>−{Math.round(c.backedDown)} MW</td>
                      <td className="text-right" style={{ color: 'var(--accent-emerald)', fontWeight: 'bold' }}>
                        ₹{Math.round(c.savings).toLocaleString('en-IN')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
              <ShieldCheck size={48} color="var(--accent-emerald)" style={{ marginBottom: '15px' }} />
              <h4>No Economical Redirection Opportunities</h4>
              <p>RTM clearing prices are currently higher than or equal to variable costs of running state generators.</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // --- SECTION 7: MERIT ORDER LIST & COSTS ---
  if (activeTab === 'merit') {
    const genList = meritGenList;

    return (
      <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div>
          <h3 style={{ margin: 0 }}>Merit Order Generator Master</h3>
          <p style={{ margin: '4px 0 0 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            List of dispatchable units ranked by variable cost (cheapest dispatched first in economic dispatch).
          </p>
        </div>

        <div className="table-responsive" style={{ border: '1px solid var(--border-card)', borderRadius: '8px' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th className="text-center">Rank</th>
                <th>Generator Name</th>
                <th className="text-center">Type</th>
                <th className="text-right">Variable Cost (₹/kWh)</th>
                <th className="text-right">Max Capacity (MW)</th>
                <th className="text-right">Tech Minimum (MW)</th>
              </tr>
            </thead>
            <tbody>
              {genList.map((g: any) => {
                let badgeStyle = { background: 'rgba(255,255,255,0.05)', color: 'var(--text-muted)' };
                if (g.type === 'state') {
                  badgeStyle = { background: 'rgba(234, 88, 12, 0.15)', color: '#ea580c' };
                } else if (g.type === 'central') {
                  badgeStyle = { background: 'rgba(139, 92, 246, 0.15)', color: '#8b5cf6' };
                } else if (g.type === 'ipp') {
                  badgeStyle = { background: 'rgba(236, 72, 153, 0.15)', color: '#ec4899' };
                }

                return (
                  <tr key={g.id}>
                    <td className="text-center" style={{ fontWeight: 'bold' }}>{g.rank}</td>
                    <td style={{ fontWeight: '600' }}>{g.name}</td>
                    <td className="text-center">
                      <span style={{ 
                        padding: '3px 8px', 
                        borderRadius: '12px', 
                        fontSize: '0.75rem', 
                        fontWeight: '600',
                        textTransform: 'uppercase',
                        ...badgeStyle
                      }}>
                        {g.type}
                      </span>
                    </td>
                    <td className="text-right" style={{ fontWeight: 'bold', color: 'var(--primary)' }}>
                      ₹{g.cost.toFixed(3)}
                    </td>
                    <td className="text-right">{Math.round(g.maxCapacity)} MW</td>
                    <td className="text-right">{Math.round(g.minCapacity)} MW</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return null;
};
