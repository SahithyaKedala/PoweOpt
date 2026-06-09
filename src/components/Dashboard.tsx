import { useMemo, useEffect } from 'react';
import {
  Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Line, Legend, ComposedChart, ReferenceLine,
  PieChart, Pie, Cell
} from 'recharts';
import { AlertCircle, ShieldCheck, Database, Info, TrendingUp, AlertTriangle, HelpCircle } from 'lucide-react';

interface DashboardProps {
  data: any;
  currentBlock: number;
  activeTab: string;
  onBlockSelect?: (block: number) => void;
  costOptimizationApplied: boolean;
  onApplyCostOptimization?: () => void;
  onResetCostOptimization?: () => void;
}

export const Dashboard = ({ data, currentBlock, activeTab, onBlockSelect, costOptimizationApplied, onApplyCostOptimization, onResetCostOptimization }: DashboardProps) => {
  const scheduleData = useMemo(() => {
    if (!data) return [];
    if (costOptimizationApplied && Array.isArray(data.costOptimizationDispatches) && data.costOptimizationDispatches.length > 0) {
      return data.costOptimizationDispatches;
    }
    return Array.isArray(data.dispatches) ? data.dispatches : [];
  }, [data, costOptimizationApplied]);

  // 1. Process 96-block schedule data
  const processedData = useMemo(() => {
    if (!data || !scheduleData || scheduleData.length === 0) return [];
    
    const genMapping = data.generators || [];

    const roundNumber = (value: number, precision: number) => {
      const factor = Math.pow(10, precision);
      return Math.round(value * factor) / factor;
    };

    return scheduleData.map((d: any) => {
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

  const costDispatchData = useMemo(() => {
    return data?.costOptimizationDispatches || data?.dispatches || [];
  }, [data]);

  const costProcessedData = useMemo(() => {
    if (!costDispatchData || !data?.generators) return [];
    return costDispatchData.map((d: any) => {
      let centralThermal = typeof d.centralThermal === 'number' ? d.centralThermal : 0;
      let stateThermal = typeof d.stateThermal === 'number' ? d.stateThermal : 0;
      let ippThermal = typeof d.ippThermal === 'number' ? d.ippThermal : 0;
      let forecastCGS = typeof d.forecastCGS === 'number' ? d.forecastCGS : null;
      let forecastStateThermal = typeof d.forecastStateThermal === 'number' ? d.forecastStateThermal : null;

      if (typeof d.centralThermal !== 'number' || typeof d.stateThermal !== 'number' || typeof d.ippThermal !== 'number') {
        Object.entries(d.generatorOutputs || {}).forEach(([id, output]) => {
          const val = output as number;
          const gen = data.generators.find((g: any) => g.id === id);
          if (gen?.type === 'central') {
            centralThermal += val;
          } else if (gen?.type === 'ipp') {
            ippThermal += val;
          } else {
            stateThermal += val;
          }
        });
      }

      const solar = d.mustRun?.solar ?? 0;
      const wind = d.mustRun?.wind ?? 0;
      const hydro = d.mustRun?.hydro ?? 0;
      const totalRenewable = solar + wind + hydro;
      const totalThermalAvailability = Object.values(d.generatorAvailabilities || {}).reduce((acc: number, val: any) => acc + (val || 0), 0);
      const availabilityValue = d.availability ?? totalThermalAvailability + totalRenewable;
      const forecastDelta = Math.round((d.demand - availabilityValue) * 100) / 100;

      return {
        block: d.block,
        time: d.timeStr || d.time,
        Demand: d.demand,
        Availability: availabilityValue,
        ForecastCGS: forecastCGS,
        ForecastStateThermal: forecastStateThermal,
        'State Thermal': stateThermal,
        'Central Thermal': centralThermal,
        'IPP Thermal': ippThermal,
        'Solar Must-Run': solar,
        'Wind Must-Run': wind,
        'Hydro Must-Run': hydro,
        'Market Buy (RTM)': d.marketBuys?.rtm || 0,
        'Market Sell (RTM)': d.marketSells?.rtm || 0,
        Shortage: d.unservedShortage || 0,
        Surplus: d.netBalance > 0 ? d.netBalance : 0,
        ForecastDelta: forecastDelta,
        ForecastShortage: forecastDelta > 0 ? forecastDelta : 0,
        ForecastSurplus: forecastDelta < 0 ? Math.abs(forecastDelta) : 0,
        'RTM Price (₹)': d.rtmPrice || 0,
        'Total Generation': stateThermal + centralThermal + ippThermal + totalRenewable + (d.marketBuys?.rtm || 0) - (d.marketSells?.rtm || 0),
        generatorOutputs: d.generatorOutputs || {},
        generatorAvailabilities: d.generatorAvailabilities || {},
        marketBuys: d.marketBuys || {},
        marketSells: d.marketSells || {},
        totalCost: d.totalCost || 0,
        cgsLocked: d.cgsLocked || false,
        warnings: d.warnings || [],
      };
    });
  }, [costDispatchData, data]);

  const currentBlockCostData = useMemo(() => {
    if (!costProcessedData || costProcessedData.length === 0) return null;
    return costProcessedData[currentBlock - 1] || costProcessedData[0];
  }, [costProcessedData, currentBlock]);

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
    if (!costDispatchData || !data?.generators) return [];
    const gens = data.generators;
    const list: any[] = [];
    
    costDispatchData.forEach((d: any) => {
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
  }, [costDispatchData, data]);

  const totalSavingsCalculated = useMemo(() => {
    return costSavingsList.reduce((acc, curr) => acc + curr.savings, 0);
  }, [costSavingsList]);

  const dailySourcingMix = useMemo(() => {
    if (!costProcessedData || costProcessedData.length === 0) return [];
    
    let solarTotal = 0;
    let windTotal = 0;
    let hydroTotal = 0;
    let centralTotal = 0;
    let ippTotal = 0;
    let stateTotal = 0;
    let rtmTotal = 0;
    let shortageTotal = 0;

    costProcessedData.forEach((d: any) => {
      solarTotal += d['Solar Must-Run'] || 0;
      windTotal += d['Wind Must-Run'] || 0;
      hydroTotal += d['Hydro Must-Run'] || 0;
      centralTotal += d['Central Thermal'] || 0;
      ippTotal += d['IPP Thermal'] || 0;
      stateTotal += d['State Thermal'] || 0;
      rtmTotal += d['Market Buy (RTM)'] || 0;
      shortageTotal += d.Shortage || 0;
    });

    const total = solarTotal + windTotal + hydroTotal + centralTotal + ippTotal + stateTotal + rtmTotal + shortageTotal;
    if (total === 0) return [];

    return [
      { name: 'Solar', value: solarTotal, color: '#fbbf24' },
      { name: 'Wind', value: windTotal, color: '#0ea5e9' },
      { name: 'Hydro', value: hydroTotal, color: '#10b981' },
      { name: 'Central CGS', value: centralTotal, color: '#8b5cf6' },
      { name: 'IPP Thermal', value: ippTotal, color: '#ec4899' },
      { name: 'State Thermal', value: stateTotal, color: '#ea580c' },
      { name: 'RTM Buy', value: rtmTotal, color: '#14b8a6' },
      { name: 'Unserved Shortage', value: shortageTotal, color: '#64748b' },
    ].filter(item => item.value > 0);
  }, [costProcessedData]);

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
                {currentBlockData.ForecastCGS !== undefined && currentBlockData.ForecastCGS !== null && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span className="text-muted">CGS Limit (Forecast):</span>
                    <span style={{ fontWeight: '600', color: 'var(--accent-indigo)' }}>{Math.round(currentBlockData.ForecastCGS)} MW</span>
                  </div>
                )}
                {currentBlockData.ForecastStateThermal !== undefined && currentBlockData.ForecastStateThermal !== null && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span className="text-muted">State Thermal Limit (Forecast):</span>
                    <span style={{ fontWeight: '600', color: 'var(--accent-amber)' }}>{Math.round(currentBlockData.ForecastStateThermal)} MW</span>
                  </div>
                )}
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
    // Generators sorted by merit order for display
    const gensSorted = data?.generators
      ? [...data.generators].sort((a: any, b: any) => (a.rank ?? 99) - (b.rank ?? 99) || a.cost - b.cost)
      : [];

    // Compute KPIs from cost optimization dispatches
    const totalDayCost = costProcessedData.reduce((acc: number, d: any) => acc + (d.totalCost || 0), 0);
    const totalRtmMW = costProcessedData.reduce((acc: number, d: any) => acc + (d['Market Buy (RTM)'] || 0), 0);
    const totalRtmSellMW = costProcessedData.reduce((acc: number, d: any) => acc + (d['Market Sell (RTM)'] || 0), 0);
    const totalRtmSellRevenue = data?.rtmSaleRevenue ?? costProcessedData.reduce((acc: number, d: any) => acc + (d.rtmSellRevenue || 0), 0);
    const shortageBlockCount = costProcessedData.filter((d: any) => (d.Shortage || 0) > 0.5).length;
    const avgMcpKwh = costProcessedData.length > 0
      ? costProcessedData.reduce((acc: number, d: any) => acc + (d['RTM Price (₹)'] || 0), 0) / costProcessedData.length / 1000
      : 0;

    // Build per-generator status for current block
    const currentBlockGenDetails = gensSorted.map((gen: any) => {
      const output = currentBlockCostData?.generatorOutputs?.[gen.id] ?? 0;
      const available = currentBlockCostData?.generatorAvailabilities?.[gen.id] ?? 0;
      const techMin = gen.minCapacity || 0;
      const maxCap = gen.maxCapacity || 0;
      const mcpKwh = (currentBlockCostData?.['RTM Price (₹)'] || 0) / 1000;

      let status = 'Off';
      let statusColor = 'var(--text-muted)';
      let statusBg = 'rgba(255,255,255,0.05)';
      if (output >= maxCap - 0.5 && maxCap > 0) {
        status = 'Full Load';
        statusColor = '#ef4444';
        statusBg = 'rgba(239,68,68,0.12)';
      } else if (output > techMin + 0.5) {
        status = 'Merit Dispatch';
        statusColor = 'var(--accent-emerald)';
        statusBg = 'rgba(52,211,153,0.12)';
      } else if (output >= techMin - 0.5 && output > 0.5) {
        status = 'Tech Min';
        statusColor = 'var(--accent-amber)';
        statusBg = 'rgba(251,191,36,0.12)';
      } else if (output > 0.5) {
        status = 'Partial';
        statusColor = 'var(--primary)';
        statusBg = 'rgba(59,130,246,0.12)';
      }

      const cheaper = gen.cost < mcpKwh;

      return {
        ...gen,
        output,
        available,
        techMin,
        maxCap,
        mcpKwh,
        status,
        statusColor,
        statusBg,
        cheaper,
      };
    });

    // Type badge styles
    const getTypeBadge = (type: string) => {
      const styles: Record<string, { bg: string; color: string }> = {
        state: { bg: 'rgba(234,88,12,0.15)', color: '#ea580c' },
        central: { bg: 'rgba(139,92,246,0.15)', color: '#8b5cf6' },
        ipp: { bg: 'rgba(236,72,153,0.15)', color: '#ec4899' },
      };
      return styles[type] || { bg: 'rgba(255,255,255,0.05)', color: 'var(--text-muted)' };
    };

    // Total generation for current block
    const currentTotalGen = currentBlockCostData
      ? (currentBlockCostData['State Thermal'] || 0) +
        (currentBlockCostData['Central Thermal'] || 0) +
        (currentBlockCostData['IPP Thermal'] || 0) +
        (currentBlockCostData['Solar Must-Run'] || 0) +
        (currentBlockCostData['Wind Must-Run'] || 0) +
        (currentBlockCostData['Hydro Must-Run'] || 0) +
        (currentBlockCostData['Market Buy (RTM)'] || 0)
      : 0;

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>

        {/* ─── KPI Cards ─── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '20px' }}>
          <div className="glass-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <span className="text-muted" style={{ fontSize: '0.82rem' }}>Total LP Optimized Cost</span>
              <h2 style={{ fontSize: '1.8rem', fontWeight: 'bold', color: 'var(--primary)', margin: '4px 0' }}>
                ₹{Math.round(totalDayCost).toLocaleString('en-IN')}
              </h2>
              <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                {data?.costOptSolverName || "PuLP"} solver — 96 blocks
              </p>
            </div>
            <div style={{ background: 'rgba(59,130,246,0.12)', color: 'var(--primary)', padding: '14px', borderRadius: '50%' }}>
              <TrendingUp size={22} />
            </div>
          </div>

          <div className="glass-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <span className="text-muted" style={{ fontSize: '0.82rem' }}>RTM Market Purchases</span>
              <h2 style={{ fontSize: '1.8rem', fontWeight: 'bold', color: 'var(--accent-amber)', margin: '4px 0' }}>
                {Math.round(totalRtmMW * 0.25).toLocaleString()} MWh
              </h2>
              <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Total RTM energy imported
              </p>
            </div>
            <div style={{ background: 'rgba(251,191,36,0.12)', color: 'var(--accent-amber)', padding: '14px', borderRadius: '50%' }}>
              <AlertTriangle size={22} />
            </div>
          </div>

          <div className="glass-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <span className="text-muted" style={{ fontSize: '0.82rem' }}>RTM Market Sales</span>
              <h2 style={{ fontSize: '1.8rem', fontWeight: 'bold', color: 'var(--accent-emerald)', margin: '4px 0' }}>
                {Math.round(totalRtmSellMW * 0.25).toLocaleString()} MWh
              </h2>
              <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Revenue: ₹{Math.round(totalRtmSellRevenue).toLocaleString('en-IN')}
              </p>
            </div>
            <div style={{ background: 'rgba(52,211,153,0.12)', color: 'var(--accent-emerald)', padding: '14px', borderRadius: '50%' }}>
              <TrendingUp size={22} />
            </div>
          </div>

          <div className="glass-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <span className="text-muted" style={{ fontSize: '0.82rem' }}>Blocks with Shortage</span>
              <h2 style={{ fontSize: '1.8rem', fontWeight: 'bold', color: shortageBlockCount > 0 ? 'var(--accent-rose)' : 'var(--accent-emerald)', margin: '4px 0' }}>
                {shortageBlockCount} / 96
              </h2>
              <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                {shortageBlockCount === 0 ? 'All demand served' : 'Unserved shortage detected'}
              </p>
            </div>
            <div style={{ background: shortageBlockCount > 0 ? 'rgba(244,63,94,0.12)' : 'rgba(52,211,153,0.12)', color: shortageBlockCount > 0 ? 'var(--accent-rose)' : 'var(--accent-emerald)', padding: '14px', borderRadius: '50%' }}>
              {shortageBlockCount > 0 ? <AlertCircle size={22} /> : <ShieldCheck size={22} />}
            </div>
          </div>

          <div className="glass-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <span className="text-muted" style={{ fontSize: '0.82rem' }}>Avg RTM MCP</span>
              <h2 style={{ fontSize: '1.8rem', fontWeight: 'bold', color: 'var(--accent-teal)', margin: '4px 0' }}>
                ₹{avgMcpKwh.toFixed(2)}/kWh
              </h2>
              <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Avg clearing price (rtm_market)
              </p>
            </div>
            <div style={{ background: 'rgba(20,184,166,0.12)', color: 'var(--accent-teal)', padding: '14px', borderRadius: '50%' }}>
              <Database size={22} />
            </div>
          </div>
        </div>

        {/* ─── Current Block Generator-Level Dispatch ─── */}
        <div className="glass-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-card)', paddingBottom: '15px', marginBottom: '20px' }}>
            <div>
              <h3 style={{ margin: 0 }}>
                Generator Dispatch — Block T{currentBlock}
                {currentBlockCostData && <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: '10px', fontSize: '0.9rem' }}>({currentBlockCostData.time})</span>}
              </h3>
              <p style={{ margin: '4px 0 0 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                LP solver merit-order dispatch per generator. Tech min from unit-specific rules, max capacity from genco_and_ipp, prices from merit_order.
              </p>
            </div>
            {currentBlockCostData && (
              <div style={{ textAlign: 'right', minWidth: '200px' }}>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Demand / Total Gen</div>
                <div style={{ fontSize: '1.3rem', fontWeight: 700 }}>
                  <span style={{ color: 'var(--accent-rose)' }}>{Math.round(currentBlockCostData.Demand)}</span>
                  <span style={{ color: 'var(--text-muted)', margin: '0 6px' }}>/</span>
                  <span style={{ color: 'var(--accent-emerald)' }}>{Math.round(currentTotalGen)}</span>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginLeft: '4px' }}>MW</span>
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                  MCP: ₹{((currentBlockCostData['RTM Price (₹)'] || 0) / 1000).toFixed(3)}/kWh
                </div>
              </div>
            )}
          </div>

          {/* Must-Run renewables summary row */}
          {currentBlockCostData && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '20px' }}>
              <div style={{ padding: '12px 16px', background: 'rgba(251,191,36,0.08)', borderRadius: '10px', borderLeft: '3px solid #fbbf24' }}>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Solar Must-Run</div>
                <div style={{ fontSize: '1.2rem', fontWeight: 700, color: '#fbbf24' }}>{Math.round(currentBlockCostData['Solar Must-Run'])} MW</div>
              </div>
              <div style={{ padding: '12px 16px', background: 'rgba(14,165,233,0.08)', borderRadius: '10px', borderLeft: '3px solid #0ea5e9' }}>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Wind Must-Run</div>
                <div style={{ fontSize: '1.2rem', fontWeight: 700, color: '#0ea5e9' }}>{Math.round(currentBlockCostData['Wind Must-Run'])} MW</div>
              </div>
              <div style={{ padding: '12px 16px', background: 'rgba(16,185,129,0.08)', borderRadius: '10px', borderLeft: '3px solid #10b981' }}>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Hydro Must-Run</div>
                <div style={{ fontSize: '1.2rem', fontWeight: 700, color: '#10b981' }}>{Math.round(currentBlockCostData['Hydro Must-Run'])} MW</div>
              </div>
            </div>
          )}

          {/* Generator dispatch table */}
          <div className="table-responsive" style={{ maxHeight: '55vh', overflow: 'auto', border: '1px solid var(--border-card)', borderRadius: '8px' }}>
            <table className="data-table" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
              <thead style={{ position: 'sticky', top: 0, zIndex: 5 }}>
                <tr>
                  <th className="text-center" style={{ width: '50px' }}>Rank</th>
                  <th style={{ minWidth: '180px' }}>Generator</th>
                  <th className="text-center" style={{ width: '80px' }}>Type</th>
                  <th className="text-right" style={{ width: '100px' }}>Price (₹/kWh)</th>
                  <th className="text-right" style={{ width: '95px' }}>Tech Min</th>
                  <th className="text-right" style={{ width: '95px' }}>Max Cap</th>
                  <th className="text-right" style={{ width: '95px' }}>Available</th>
                  <th className="text-right" style={{ width: '110px', fontWeight: 800 }}>Dispatched</th>
                  <th className="text-right" style={{ width: '100px' }}>MCP (₹/kWh)</th>
                  <th className="text-center" style={{ width: '110px' }}>vs MCP</th>
                  <th className="text-center" style={{ width: '120px' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {currentBlockGenDetails.map((gen: any) => {
                  const badge = getTypeBadge(gen.type);
                  return (
                    <tr key={gen.id} style={{ opacity: gen.status === 'Off' ? 0.5 : 1 }}>
                      <td className="text-center" style={{ fontWeight: 'bold', color: 'var(--primary)' }}>{gen.rank}</td>
                      <td style={{ fontWeight: '600' }}>{gen.name}</td>
                      <td className="text-center">
                        <span style={{
                          padding: '3px 8px', borderRadius: '12px', fontSize: '0.7rem', fontWeight: 600,
                          textTransform: 'uppercase', background: badge.bg, color: badge.color
                        }}>
                          {gen.type}
                        </span>
                      </td>
                      <td className="text-right" style={{ fontWeight: '600', color: 'var(--primary)' }}>₹{gen.cost.toFixed(3)}</td>
                      <td className="text-right" style={{ color: 'var(--accent-amber)' }}>{Math.round(gen.techMin)}</td>
                      <td className="text-right">{Math.round(gen.maxCap)}</td>
                      <td className="text-right" style={{ color: 'var(--text-muted)' }}>{Math.round(gen.available)}</td>
                      <td className="text-right" style={{ fontWeight: 800, fontSize: '1rem' }}>
                        {gen.output > 0.5 ? `${Math.round(gen.output)} MW` : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                      </td>
                      <td className="text-right" style={{ color: 'var(--accent-teal)' }}>₹{gen.mcpKwh.toFixed(3)}</td>
                      <td className="text-center">
                        {gen.output > 0.5 ? (
                          <span style={{
                            padding: '3px 8px', borderRadius: '12px', fontSize: '0.72rem', fontWeight: 600,
                            background: gen.cheaper ? 'rgba(52,211,153,0.12)' : 'rgba(244,63,94,0.12)',
                            color: gen.cheaper ? 'var(--accent-emerald)' : 'var(--accent-rose)'
                          }}>
                            {gen.cheaper ? '✓ Cheaper' : '✗ Costlier'}
                          </span>
                        ) : <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>—</span>}
                      </td>
                      <td className="text-center">
                        <span style={{
                          padding: '4px 10px', borderRadius: '14px', fontSize: '0.72rem', fontWeight: 700,
                          background: gen.statusBg, color: gen.statusColor
                        }}>
                          {gen.status}
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {/* RTM Market Buy row */}
                {currentBlockCostData && currentBlockCostData['Market Buy (RTM)'] > 0.5 && (
                  <tr style={{ borderTop: '2px solid var(--border-card)' }}>
                    <td className="text-center" style={{ fontWeight: 'bold', color: '#ef4444' }}>—</td>
                    <td style={{ fontWeight: '600', color: '#ef4444' }}>RTM Market Purchase</td>
                    <td className="text-center">
                      <span style={{ padding: '3px 8px', borderRadius: '12px', fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', background: 'rgba(239,68,68,0.12)', color: '#ef4444' }}>
                        MARKET
                      </span>
                    </td>
                    <td className="text-right" style={{ fontWeight: '600', color: '#ef4444' }}>₹{((currentBlockCostData['RTM Price (₹)'] || 0) / 1000).toFixed(3)}</td>
                    <td className="text-right" style={{ color: 'var(--text-muted)' }}>—</td>
                    <td className="text-right">500</td>
                    <td className="text-right" style={{ color: 'var(--text-muted)' }}>500</td>
                    <td className="text-right" style={{ fontWeight: 800, fontSize: '1rem', color: '#ef4444' }}>
                      {Math.round(currentBlockCostData['Market Buy (RTM)'])} MW
                    </td>
                    <td className="text-right" style={{ color: 'var(--accent-teal)' }}>₹{((currentBlockCostData['RTM Price (₹)'] || 0) / 1000).toFixed(3)}</td>
                    <td className="text-center"><span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>—</span></td>
                    <td className="text-center">
                      <span style={{ padding: '4px 10px', borderRadius: '14px', fontSize: '0.72rem', fontWeight: 700, background: 'rgba(239,68,68,0.12)', color: '#ef4444' }}>
                        Market Buy
                      </span>
                    </td>
                  </tr>
                )}
                {/* RTM Market Sell row */}
                {currentBlockCostData && currentBlockCostData['Market Sell (RTM)'] > 0.5 && (
                  <tr style={{ borderTop: '1px solid var(--border-card)' }}>
                    <td className="text-center" style={{ fontWeight: 'bold', color: 'var(--accent-emerald)' }}>—</td>
                    <td style={{ fontWeight: '600', color: 'var(--accent-emerald)' }}>RTM Market Sale</td>
                    <td className="text-center">
                      <span style={{ padding: '3px 8px', borderRadius: '12px', fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', background: 'rgba(52,211,153,0.12)', color: 'var(--accent-emerald)' }}>
                        MARKET
                      </span>
                    </td>
                    <td className="text-right" style={{ fontWeight: '600', color: 'var(--accent-emerald)' }}>₹{((currentBlockCostData['RTM Price (₹)'] || 0) / 1000 * 0.85).toFixed(3)}</td>
                    <td className="text-right" style={{ color: 'var(--text-muted)' }}>—</td>
                    <td className="text-right">500</td>
                    <td className="text-right" style={{ color: 'var(--text-muted)' }}>500</td>
                    <td className="text-right" style={{ fontWeight: 800, fontSize: '1rem', color: 'var(--accent-emerald)' }}>
                      {Math.round(currentBlockCostData['Market Sell (RTM)'])} MW
                    </td>
                    <td className="text-right" style={{ color: 'var(--accent-teal)' }}>₹{((currentBlockCostData['RTM Price (₹)'] || 0) / 1000).toFixed(3)}</td>
                    <td className="text-center"><span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>—</span></td>
                    <td className="text-center">
                      <span style={{ padding: '4px 10px', borderRadius: '14px', fontSize: '0.72rem', fontWeight: 700, background: 'rgba(52,211,153,0.12)', color: 'var(--accent-emerald)' }}>
                        Market Sell
                      </span>
                    </td>
                  </tr>
                )}
                {/* Totals row */}
                {currentBlockCostData && (
                  <tr style={{ borderTop: '2px solid var(--primary)', background: 'rgba(59,130,246,0.05)' }}>
                    <td className="text-center" style={{ fontWeight: 800 }}>Σ</td>
                    <td style={{ fontWeight: 800 }}>Total Generation</td>
                    <td></td>
                    <td></td>
                    <td className="text-right" style={{ fontWeight: 700, color: 'var(--accent-amber)' }}>
                      {Math.round(gensSorted.reduce((a: number, g: any) => a + (g.minCapacity || 0), 0))}
                    </td>
                    <td className="text-right" style={{ fontWeight: 700 }}>
                      {Math.round(gensSorted.reduce((a: number, g: any) => a + (g.maxCapacity || 0), 0))}
                    </td>
                    <td className="text-right" style={{ fontWeight: 700, color: 'var(--text-muted)' }}>
                      {Math.round(gensSorted.reduce((a: number, g: any) => a + (currentBlockCostData?.generatorAvailabilities?.[g.id] ?? 0), 0))}
                    </td>
                    <td className="text-right" style={{ fontWeight: 800, fontSize: '1.05rem', color: 'var(--accent-emerald)' }}>
                      {Math.round(currentTotalGen)} MW
                    </td>
                    <td></td>
                    <td></td>
                    <td className="text-center" style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--primary)' }}>
                      Cost: ₹{Math.round(currentBlockCostData.totalCost).toLocaleString('en-IN')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ─── Stacked Generation Dispatch Stack & Daily Energy Mix Pie Chart ─── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.8fr 1.2fr', gap: '20px' }}>
          {/* Left: Dispatch Stacked Area Chart */}
          <div className="glass-card chart-container" style={{ margin: 0 }}>
            <div className="chart-header">
              <h3>Optimal Generation Dispatch Stack (24-Hour SCED Schedule)</h3>
              <p style={{ margin: '4px 0' }}>Contribution of different resource categories stacked to meet the System Demand line.</p>
              
              {/* Color Index legend mapping colors to the table column style */}
              <div style={{ 
                display: 'flex', 
                flexWrap: 'wrap', 
                gap: '10px', 
                marginTop: '12px', 
                padding: '8px 12px', 
                background: 'rgba(255, 255, 255, 0.03)', 
                borderRadius: '8px', 
                border: '1px solid var(--border-card)' 
              }}>
                <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', marginRight: '4px' }}>
                  Color Index:
                </span>
                <span style={{ fontSize: '0.75rem', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: '#fbbf24' }}></span> Solar (Yellow)
                </span>
                <span style={{ fontSize: '0.75rem', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: '#0ea5e9' }}></span> Wind (Blue)
                </span>
                <span style={{ fontSize: '0.75rem', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: '#10b981' }}></span> Hydro (Green)
                </span>
                <span style={{ fontSize: '0.75rem', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: '#8b5cf6' }}></span> Central CGS (Purple)
                </span>
                <span style={{ fontSize: '0.75rem', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: '#ec4899' }}></span> IPP Thermal (Pink)
                </span>
                <span style={{ fontSize: '0.75rem', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: '#ea580c' }}></span> State Thermal (Orange)
                </span>
                <span style={{ fontSize: '0.75rem', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: '#14b8a6' }}></span> RTM Buy (Teal)
                </span>
                <span style={{ fontSize: '0.75rem', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: '#64748b' }}></span> Unserved Shortage (Slate)
                </span>
              </div>
            </div>
            <div style={{ width: '100%', height: 350 }}>
              <ResponsiveContainer>
                <ComposedChart data={costProcessedData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                  <XAxis dataKey="time" stroke="rgba(255,255,255,0.3)" fontSize={11} tickMargin={10} minTickGap={40} />
                  <YAxis stroke="rgba(255,255,255,0.3)" fontSize={11} unit=" MW" />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: '11px' }} />
                  
                  {/* Stacked generation areas */}
                  <Area type="monotone" dataKey="Solar Must-Run" stackId="gen_stack" stroke="#fbbf24" fill="#fbbf24" fillOpacity={0.65} name="Solar" />
                  <Area type="monotone" dataKey="Wind Must-Run" stackId="gen_stack" stroke="#0ea5e9" fill="#0ea5e9" fillOpacity={0.65} name="Wind" />
                  <Area type="monotone" dataKey="Hydro Must-Run" stackId="gen_stack" stroke="#10b981" fill="#10b981" fillOpacity={0.65} name="Hydro" />
                  <Area type="monotone" dataKey="Central Thermal" stackId="gen_stack" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.65} name="Central CGS" />
                  <Area type="monotone" dataKey="IPP Thermal" stackId="gen_stack" stroke="#ec4899" fill="#ec4899" fillOpacity={0.65} name="IPP Thermal" />
                  <Area type="monotone" dataKey="State Thermal" stackId="gen_stack" stroke="#ea580c" fill="#ea580c" fillOpacity={0.65} name="State Thermal" />
                  <Area type="monotone" dataKey="Market Buy (RTM)" stackId="gen_stack" stroke="#14b8a6" fill="#14b8a6" fillOpacity={0.8} name="RTM Buy" />
                  <Area type="monotone" dataKey="Shortage" stackId="gen_stack" stroke="#64748b" fill="#64748b" fillOpacity={0.8} name="Unserved Shortage" />
                  
                  {/* Demand Line drawn on top */}
                  <Line type="monotone" dataKey="Demand" stroke="#f43f5e" strokeWidth={3.5} dot={false} name="System Demand" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Right: Pie Chart for Demand Fulfilled mix (100% Demand break-up) */}
          <div className="glass-card chart-container" style={{ margin: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
            <div className="chart-header">
              <h3>Sourcing Energy Mix (100% Daily Demand)</h3>
              <p style={{ margin: '4px 0' }}>Percentage share of each resource in fulfilling the total daily demand.</p>
            </div>
            
            <div style={{ width: '100%', height: 220, position: 'relative', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
              <ResponsiveContainer>
                <PieChart>
                  <Pie
                    data={dailySourcingMix}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={80}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {dailySourcingMix.map((entry: any, index: number) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip 
                    formatter={(value: any) => {
                      const totalVal = dailySourcingMix.reduce((a: number, b: any) => a + b.value, 0);
                      const percent = ((Number(value) / totalVal) * 100).toFixed(1);
                      return [`${Math.round(Number(value) * 0.25).toLocaleString()} MWh (${percent}%)`, 'Share'];
                    }}
                    contentStyle={{ background: 'rgba(15,15,25,0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', fontSize: '0.85rem' }}
                  />
                </PieChart>
              </ResponsiveContainer>
              {/* Total demand indicator inside donut hole */}
              <div style={{
                position: 'absolute',
                top: '55%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                textAlign: 'center',
                pointerEvents: 'none'
              }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Daily Demand</div>
                <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-main)' }}>
                  {Math.round(dailySourcingMix.reduce((a: number, b: any) => a + b.value, 0) * 0.25).toLocaleString()}
                </div>
                <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>MWh</div>
              </div>
            </div>

            {/* List breakdown of resource shares */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 10px', marginTop: '10px', padding: '8px 12px', background: 'rgba(255, 255, 255, 0.02)', borderRadius: '8px', border: '1px solid var(--border-card)' }}>
              {dailySourcingMix.map((entry: any, index: number) => {
                const totalVal = dailySourcingMix.reduce((a: number, b: any) => a + b.value, 0);
                const percent = ((entry.value / totalVal) * 100).toFixed(1);
                return (
                  <div key={index} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.75rem' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontWeight: 600, color: 'var(--text-muted)' }}>
                      <span style={{ display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', background: entry.color }}></span>
                      {entry.name}
                    </span>
                    <span style={{ fontWeight: 800, color: 'var(--text-main)' }}>{percent}%</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* ─── Block-Wise Demand Fulfillment Pie Chart ─── */}
        {currentBlockCostData && (() => {
          const blockDemand = currentBlockCostData.Demand || 0;
          const solarMW = currentBlockCostData['Solar Must-Run'] || 0;
          const windMW = currentBlockCostData['Wind Must-Run'] || 0;
          const hydroMW = currentBlockCostData['Hydro Must-Run'] || 0;
          const centralMW = currentBlockCostData['Central Thermal'] || 0;
          const ippMW = currentBlockCostData['IPP Thermal'] || 0;
          const stateMW = currentBlockCostData['State Thermal'] || 0;
          const rtmMW = currentBlockCostData['Market Buy (RTM)'] || 0;
          const shortageMW = currentBlockCostData.Shortage || 0;
          const totalGen = solarMW + windMW + hydroMW + centralMW + ippMW + stateMW + rtmMW;

          const blockPieData = [
            { name: 'Solar', value: solarMW, color: '#fbbf24' },
            { name: 'Wind', value: windMW, color: '#0ea5e9' },
            { name: 'Hydro', value: hydroMW, color: '#10b981' },
            { name: 'Central CGS', value: centralMW, color: '#8b5cf6' },
            { name: 'IPP Thermal', value: ippMW, color: '#ec4899' },
            { name: 'State Thermal', value: stateMW, color: '#ea580c' },
            { name: 'RTM Buy', value: rtmMW, color: '#14b8a6' },
            { name: 'Unserved Shortage', value: shortageMW, color: '#64748b' },
          ].filter(item => item.value > 0.1);

          // Calculate percentages
          const refTotal = blockDemand > 0 ? blockDemand : totalGen;

          // Compute ramp-up candidates for shortage resolution
          const gensSortedByMerit = data?.generators
            ? [...data.generators].sort((a: any, b: any) => (a.rank ?? 99) - (b.rank ?? 99) || a.cost - b.cost)
            : [];
          
          const rampUpCandidates = gensSortedByMerit.map((gen: any) => {
            const output = currentBlockCostData.generatorOutputs?.[gen.id] ?? 0;
            const available = currentBlockCostData.generatorAvailabilities?.[gen.id] ?? 0;
            const spare = Math.max(0, available - output);
            return {
              ...gen,
              output,
              available,
              spare: Math.round(spare * 100) / 100,
            };
          }).filter((g: any) => g.spare > 1);

          const totalSpare = rampUpCandidates.reduce((acc: number, g: any) => acc + g.spare, 0);
          const hasShortage = shortageMW > 0.5;
          const isDeficit = blockDemand > totalGen + 0.5;

          return (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: '20px' }}>
              {/* Block-Wise Pie Chart */}
              <div className="glass-card chart-container" style={{ margin: 0, display: 'flex', flexDirection: 'column' }}>
                <div className="chart-header">
                  <h3>Block T{currentBlock} — Demand Fulfillment Breakdown</h3>
                  <p style={{ margin: '4px 0' }}>
                    Demand = <strong>{Math.round(blockDemand)} MW</strong> (100%). Each resource's share of meeting this block's demand.
                  </p>
                </div>

                <div style={{ width: '100%', height: 240, position: 'relative', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                  <ResponsiveContainer>
                    <PieChart>
                      <Pie
                        data={blockPieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={90}
                        paddingAngle={2}
                        dataKey="value"
                        label={({ name, value }: any) => {
                          const pct = refTotal > 0 ? ((value / refTotal) * 100).toFixed(1) : '0';
                          return `${name} ${pct}%`;
                        }}
                        labelLine={true}
                      >
                        {blockPieData.map((entry: any, index: number) => (
                          <Cell key={`bpc-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(value: any) => {
                          const pct = refTotal > 0 ? ((Number(value) / refTotal) * 100).toFixed(1) : '0';
                          return [`${Math.round(Number(value))} MW (${pct}%)`, 'Contribution'];
                        }}
                        contentStyle={{ background: 'rgba(15,15,25,0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', fontSize: '0.85rem' }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  {/* Center label */}
                  <div style={{
                    position: 'absolute', top: '50%', left: '50%',
                    transform: 'translate(-50%, -50%)', textAlign: 'center', pointerEvents: 'none'
                  }}>
                    <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Block T{currentBlock}</div>
                    <div style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--text-main)' }}>{Math.round(blockDemand)}</div>
                    <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>MW Demand</div>
                  </div>
                </div>

                {/* Resource breakdown list */}
                <div style={{
                  display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px 12px',
                  padding: '10px 14px', background: 'rgba(255,255,255,0.02)',
                  borderRadius: '8px', border: '1px solid var(--border-card)', marginTop: '8px'
                }}>
                  {blockPieData.map((entry: any, index: number) => {
                    const pct = refTotal > 0 ? ((entry.value / refTotal) * 100).toFixed(1) : '0';
                    return (
                      <div key={index} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.78rem' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontWeight: 600, color: entry.color }}>
                          <span style={{ display: 'inline-block', width: '7px', height: '7px', borderRadius: '50%', background: entry.color }}></span>
                          {entry.name}
                        </span>
                        <span style={{ fontWeight: 800, color: 'var(--text-main)' }}>
                          {Math.round(entry.value)} MW ({pct}%)
                        </span>
                      </div>
                    );
                  })}
                  {/* Demand total row */}
                  <div style={{
                    gridColumn: '1 / -1', display: 'flex', justifyContent: 'space-between',
                    borderTop: '1px solid var(--border-card)', paddingTop: '6px', marginTop: '4px', fontSize: '0.82rem'
                  }}>
                    <span style={{ fontWeight: 700, color: '#f43f5e' }}>Total Demand</span>
                    <span style={{ fontWeight: 800, color: '#f43f5e' }}>{Math.round(blockDemand)} MW (100%)</span>
                  </div>
                  <div style={{
                    gridColumn: '1 / -1', display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem'
                  }}>
                    <span style={{ fontWeight: 700, color: 'var(--accent-emerald)' }}>Total Generation</span>
                    <span style={{ fontWeight: 800, color: 'var(--accent-emerald)' }}>
                      {Math.round(totalGen)} MW ({refTotal > 0 ? ((totalGen / refTotal) * 100).toFixed(1) : '0'}%)
                    </span>
                  </div>
                </div>
              </div>

              {/* Shortage Resolution / Optimizer Decision Panel */}
              <div className="glass-card" style={{ margin: 0, display: 'flex', flexDirection: 'column' }}>
                <div style={{ borderBottom: '1px solid var(--border-card)', paddingBottom: '12px', marginBottom: '16px' }}>
                  <h3 style={{ margin: 0 }}>
                    {hasShortage || isDeficit 
                      ? `⚡ Shortage Resolution — Block T${currentBlock}` 
                      : `✅ Demand Fully Met — Block T${currentBlock}`}
                  </h3>
                  <p style={{ margin: '4px 0 0 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                    {hasShortage || isDeficit
                      ? 'Optimizer decision: which generators can ramp up or RTM purchase needed to cover deficit.'
                      : 'All demand is satisfied. No additional dispatch or market purchase required.'}
                  </p>
                </div>

                {(hasShortage || isDeficit) ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', flex: 1 }}>
                    {/* Deficit summary */}
                    <div style={{
                      padding: '14px 18px', borderRadius: '12px',
                      background: 'rgba(244,63,94,0.08)', borderLeft: '4px solid #f43f5e',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                    }}>
                      <div>
                        <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Unserved Shortage</div>
                        <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#f43f5e' }}>
                          {Math.round(shortageMW)} MW
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>RTM Already Bought</div>
                        <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#14b8a6' }}>
                          {Math.round(rtmMW)} MW
                        </div>
                      </div>
                    </div>

                    {/* Ramp-up candidates */}
                    {rampUpCandidates.length > 0 ? (
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '8px' }}>
                          🔋 Available Generators to Ramp Up ({Math.round(totalSpare)} MW spare)
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '220px', overflow: 'auto' }}>
                          {rampUpCandidates.map((g: any) => {
                            const loadPct = g.available > 0 ? ((g.output / g.available) * 100).toFixed(0) : '0';
                            const typeColors: Record<string, string> = {
                              state: '#ea580c', central: '#8b5cf6', ipp: '#ec4899'
                            };
                            return (
                              <div key={g.id} style={{
                                padding: '10px 14px', borderRadius: '10px',
                                background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-card)',
                                display: 'flex', alignItems: 'center', gap: '12px'
                              }}>
                                <div style={{
                                  width: '6px', height: '36px', borderRadius: '3px',
                                  background: typeColors[g.type] || 'var(--primary)'
                                }} />
                                <div style={{ flex: 1 }}>
                                  <div style={{ fontWeight: 700, fontSize: '0.85rem' }}>{g.name}</div>
                                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                                    {g.type.toUpperCase()} · R{g.rank} · ₹{g.cost.toFixed(2)}/kWh
                                  </div>
                                </div>
                                <div style={{ textAlign: 'right' }}>
                                  <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--accent-emerald)' }}>
                                    +{Math.round(g.spare)} MW
                                  </div>
                                  <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                                    {Math.round(g.output)}/{Math.round(g.available)} MW ({loadPct}%)
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : (
                      <div style={{
                        padding: '16px', borderRadius: '12px',
                        background: 'rgba(244,63,94,0.06)', textAlign: 'center'
                      }}>
                        <AlertTriangle size={28} color="#f43f5e" style={{ marginBottom: '8px' }} />
                        <div style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '4px' }}>No Generators Available to Ramp Up</div>
                        <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                          All dispatchable generators are at maximum available capacity.
                        </div>
                      </div>
                    )}

                    {/* Optimizer recommendation */}
                    <div style={{
                      padding: '12px 16px', borderRadius: '10px',
                      background: 'rgba(59,130,246,0.06)', borderLeft: '3px solid var(--primary)',
                      fontSize: '0.85rem', color: 'var(--text-main)', lineHeight: '1.5'
                    }}>
                      <strong>⚙️ Optimizer Decision:</strong>{' '}
                      {totalSpare >= shortageMW
                        ? `Ramp up ${Math.round(shortageMW)} MW from available generators (${rampUpCandidates.slice(0, 3).map((g: any) => g.name).join(', ')}${rampUpCandidates.length > 3 ? '...' : ''}) by merit order to fully cover the shortage.`
                        : totalSpare > 0
                          ? `Ramp up ${Math.round(totalSpare)} MW from available generators, then buy remaining ${Math.round(Math.max(0, shortageMW - totalSpare))} MW from RTM at ₹${((currentBlockCostData['RTM Price (₹)'] || 0) / 1000).toFixed(2)}/kWh.`
                          : `No spare generator capacity available. Buy ${Math.round(shortageMW)} MW from RTM at ₹${((currentBlockCostData['RTM Price (₹)'] || 0) / 1000).toFixed(2)}/kWh. If RTM corridor limit (500 MW) is reached, shortage remains unserved.`
                      }
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, gap: '12px', padding: '20px' }}>
                    <ShieldCheck size={48} color="var(--accent-emerald)" style={{ opacity: 0.8 }} />
                    <h4 style={{ margin: 0, color: 'var(--accent-emerald)' }}>Demand Fully Satisfied</h4>
                    <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--text-muted)', textAlign: 'center', maxWidth: '400px' }}>
                      Total generation ({Math.round(totalGen)} MW) meets or exceeds demand ({Math.round(blockDemand)} MW).
                      The LP optimizer has scheduled the most cost-efficient dispatch for this block.
                    </p>
                    {rampUpCandidates.length > 0 && (
                      <div style={{ marginTop: '12px', fontSize: '0.82rem', color: 'var(--text-muted)', textAlign: 'center' }}>
                        <strong>{Math.round(totalSpare)} MW</strong> spare capacity available across{' '}
                        <strong>{rampUpCandidates.length}</strong> generators if demand increases.
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })()}

        {/* ─── 96-Block Generator-Level Schedule ─── */}
        <div className="glass-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', borderBottom: '1px solid var(--border-card)', paddingBottom: '15px', marginBottom: '20px' }}>
            <div>
              <h3 style={{ margin: 0 }}>96-Block Generator-Level Optimization Schedule</h3>
              <p style={{ margin: '4px 0 0 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                LP solver dispatch per generator per block. Scroll horizontally to see all generators. Capacities from genco_and_ipp, prices from merit_order, MCP from rtm_market.
              </p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              {costOptimizationApplied && (
                <span style={{
                  background: 'rgba(52,211,153,0.14)', color: 'var(--accent-emerald)',
                  padding: '8px 12px', borderRadius: '999px', fontWeight: 700, fontSize: '0.85rem'
                }}>
                  ✓ Optimizer Applied
                </span>
              )}
              <button
                onClick={onApplyCostOptimization}
                disabled={costOptimizationApplied}
                style={{
                  padding: '10px 18px', borderRadius: '14px',
                  background: costOptimizationApplied ? 'rgba(255,255,255,0.08)' : 'var(--primary)',
                  color: costOptimizationApplied ? 'var(--text-muted)' : 'var(--text-main)',
                  border: '1px solid rgba(255,255,255,0.1)', fontWeight: 700,
                  cursor: costOptimizationApplied ? 'not-allowed' : 'pointer'
                }}
              >
                {costOptimizationApplied ? 'Applied' : 'Apply Cost Optimization'}
              </button>
              {costOptimizationApplied && onResetCostOptimization && (
                <button
                  onClick={onResetCostOptimization}
                  style={{
                    padding: '10px 18px', borderRadius: '14px',
                    background: 'rgba(255,255,255,0.05)', color: 'var(--text-main)',
                    border: '1px solid rgba(255,255,255,0.12)', fontWeight: 700, cursor: 'pointer'
                  }}
                >
                  Reset
                </button>
              )}
            </div>
          </div>

          <div className="table-responsive" style={{ maxHeight: '60vh', overflow: 'auto', border: '1px solid var(--border-card)', borderRadius: '8px' }}>
            <table className="data-table" style={{ borderCollapse: 'separate', borderSpacing: 0, width: 'max-content' }}>
              <thead style={{ position: 'sticky', top: 0, zIndex: 10 }}>
                <tr>
                  <th className="sticky-col" style={{ left: 0, zIndex: 11, minWidth: '55px' }}>Block</th>
                  <th className="sticky-col-time" style={{ left: 55, zIndex: 11, minWidth: '85px' }}>Time</th>
                  <th className="sticky-col-demand text-right" style={{ left: 140, zIndex: 11, minWidth: '85px' }}>Demand</th>
                  <th className="text-right" style={{ color: '#fbbf24', minWidth: '65px' }}>Solar</th>
                  <th className="text-right" style={{ color: '#0ea5e9', minWidth: '65px' }}>Wind</th>
                  <th className="text-right" style={{ color: '#10b981', minWidth: '65px' }}>Hydro</th>
                  {gensSorted.map((g: any) => {
                    const badge = getTypeBadge(g.type);
                    return (
                      <th key={g.id} className="text-right" style={{ minWidth: '80px', fontSize: '0.72rem', lineHeight: '1.2', color: badge.color }}>
                        <div>{g.name}</div>
                        <div style={{ fontSize: '0.65rem', opacity: 0.7, fontWeight: 400 }}>₹{g.cost.toFixed(2)} | R{g.rank}</div>
                      </th>
                    );
                  })}
                  <th className="text-right" style={{ color: '#ef4444', minWidth: '75px' }}>RTM Buy</th>
                  <th className="text-right" style={{ color: 'var(--accent-emerald)', minWidth: '75px' }}>RTM Sell</th>
                  <th className="text-right" style={{ minWidth: '90px' }}>MCP ₹/kWh</th>
                  <th className="text-right" style={{ minWidth: '75px', color: 'var(--accent-rose)' }}>Shortage</th>
                  <th className="text-right" style={{ fontWeight: 800, minWidth: '100px' }}>Cost (₹)</th>
                </tr>
              </thead>
              <tbody>
                {costDispatchData.map((d: any, idx: number) => {
                  const blockNum = d.block || idx + 1;
                  const isCurrent = blockNum === currentBlock;
                  const rtmBuy = d.marketBuys?.rtm || 0;
                  const rtmSell = d.marketSells?.rtm || 0;
                  const shortage = d.unservedShortage || 0;
                  return (
                    <tr key={blockNum} className={isCurrent ? 'active-row' : ''}>
                      <td className="sticky-col" style={{ left: 0, fontWeight: 'bold' }}>{blockNum}</td>
                      <td className="sticky-col-time" style={{ left: 55, fontSize: '0.8rem' }}>{d.timeStr || d.time}</td>
                      <td className="sticky-col-demand text-right" style={{ left: 140, fontWeight: 700 }}>{Math.round(d.demand)}</td>
                      <td className="text-right" style={{ color: '#fbbf24', fontSize: '0.85rem' }}>{Math.round(d.mustRun?.solar ?? 0)}</td>
                      <td className="text-right" style={{ color: '#0ea5e9', fontSize: '0.85rem' }}>{Math.round(d.mustRun?.wind ?? 0)}</td>
                      <td className="text-right" style={{ color: '#10b981', fontSize: '0.85rem' }}>{Math.round(d.mustRun?.hydro ?? 0)}</td>
                      {gensSorted.map((g: any) => {
                        const val = d.generatorOutputs?.[g.id] ?? 0;
                        const techMin = g.minCapacity || 0;
                        const maxCap = g.maxCapacity || 0;
                        let cellColor = 'var(--text-muted)';
                        let cellWeight = '400';
                        if (val > 0.5) {
                          cellColor = 'var(--text-main)';
                          cellWeight = '600';
                          if (val >= maxCap - 0.5 && maxCap > 0) {
                            cellColor = '#ef4444'; // full load
                          } else if (val <= techMin + 0.5 && val > 0.5) {
                            cellColor = 'var(--accent-amber)'; // at tech min
                          }
                        }
                        return (
                          <td key={g.id} className="text-right" style={{ color: cellColor, fontWeight: cellWeight, fontSize: '0.83rem' }}>
                            {val > 0.5 ? Math.round(val) : <span style={{ opacity: 0.3 }}>—</span>}
                          </td>
                        );
                      })}
                      <td className="text-right" style={{ color: rtmBuy > 0.5 ? '#ef4444' : 'var(--text-muted)', fontWeight: rtmBuy > 0.5 ? '700' : '400', fontSize: '0.85rem' }}>
                        {rtmBuy > 0.5 ? Math.round(rtmBuy) : '—'}
                      </td>
                      <td className="text-right" style={{ color: rtmSell > 0.5 ? 'var(--accent-emerald)' : 'var(--text-muted)', fontWeight: rtmSell > 0.5 ? '700' : '400', fontSize: '0.85rem' }}>
                        {rtmSell > 0.5 ? Math.round(rtmSell) : '—'}
                      </td>
                      <td className="text-right" style={{ fontSize: '0.83rem' }}>₹{(d.rtmPriceKwh ?? (d.rtmPrice || 0) / 1000).toFixed(2)}</td>
                      <td className="text-right" style={{ color: shortage > 0.5 ? 'var(--accent-rose)' : 'var(--text-muted)', fontWeight: shortage > 0.5 ? '700' : '400', fontSize: '0.85rem' }}>
                        {shortage > 0.5 ? Math.round(shortage) : '—'}
                      </td>
                      <td className="text-right" style={{ fontWeight: '700', fontSize: '0.85rem' }}>₹{Math.round(d.totalCost || 0).toLocaleString('en-IN')}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* ─── Cost Savings Opportunities ─── */}
        <div className="glass-card">
          <div style={{ borderBottom: '1px solid var(--border-card)', paddingBottom: '15px', marginBottom: '20px' }}>
            <h3 style={{ margin: 0 }}>Cost Savings — Generator vs RTM Price Comparison</h3>
            <p style={{ margin: '4px 0 0 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              Blocks where generator variable cost (from merit_order) exceeds RTM MCP (from rtm_market). Back down to tech min and buy cheaper from RTM.
            </p>
          </div>

          {costSavingsList.length > 0 ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '20px', padding: '14px 20px', background: 'rgba(52,211,153,0.06)', borderRadius: '12px', borderLeft: '4px solid var(--accent-emerald)' }}>
                <TrendingUp size={24} color="var(--accent-emerald)" />
                <div>
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Total Opportunity Savings</span>
                  <h3 style={{ margin: '2px 0 0 0', color: 'var(--accent-emerald)' }}>₹{Math.round(totalSavingsCalculated).toLocaleString('en-IN')}</h3>
                </div>
              </div>
              <div className="table-responsive" style={{ border: '1px solid var(--border-card)', borderRadius: '8px' }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th className="text-center">Block</th>
                      <th>Time</th>
                      <th>Generator</th>
                      <th className="text-center">Type</th>
                      <th className="text-right">Merit Rank</th>
                      <th className="text-right">Max Cap (MW)</th>
                      <th className="text-right">Tech Min (MW)</th>
                      <th className="text-right" style={{ color: 'var(--accent-rose)' }}>Gen Cost (₹/kWh)</th>
                      <th className="text-right" style={{ color: 'var(--accent-emerald)' }}>RTM MCP (₹/kWh)</th>
                      <th className="text-right">Current (MW)</th>
                      <th className="text-right" style={{ color: 'var(--primary)' }}>Back Down (MW)</th>
                      <th className="text-right" style={{ color: 'var(--accent-emerald)', fontWeight: 'bold' }}>Savings (₹)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {costSavingsList.map((c: any, idx: number) => {
                      const genMeta = data.generators?.find((gg: any) => gg.name === c.genName);
                      const badge = getTypeBadge(genMeta?.type || 'state');
                      return (
                        <tr key={idx}>
                          <td className="text-center" style={{ fontWeight: 'bold' }}>{c.block}</td>
                          <td>{c.time}</td>
                          <td style={{ fontWeight: '600' }}>{c.genName}</td>
                          <td className="text-center">
                            <span style={{ padding: '2px 6px', borderRadius: '10px', fontSize: '0.68rem', fontWeight: 600, textTransform: 'uppercase', background: badge.bg, color: badge.color }}>
                              {genMeta?.type || '—'}
                            </span>
                          </td>
                          <td className="text-right" style={{ color: 'var(--primary)' }}>{genMeta?.rank ?? '—'}</td>
                          <td className="text-right">{Math.round(genMeta?.maxCapacity || 0)}</td>
                          <td className="text-right" style={{ color: 'var(--accent-amber)' }}>{Math.round(genMeta?.minCapacity || 0)}</td>
                          <td className="text-right" style={{ color: 'var(--accent-rose)', fontWeight: '600' }}>₹{c.genCost.toFixed(3)}</td>
                          <td className="text-right" style={{ color: 'var(--accent-emerald)', fontWeight: '600' }}>₹{c.rtmCost.toFixed(3)}</td>
                          <td className="text-right">{Math.round(c.output)}</td>
                          <td className="text-right" style={{ color: 'var(--primary)', fontWeight: 'bold' }}>−{Math.round(c.backedDown)}</td>
                          <td className="text-right" style={{ color: 'var(--accent-emerald)', fontWeight: 'bold' }}>
                            ₹{Math.round(c.savings).toLocaleString('en-IN')}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
              <ShieldCheck size={48} color="var(--accent-emerald)" style={{ marginBottom: '15px' }} />
              <h4>No Cost Redirection Opportunities</h4>
              <p>All dispatched generators are cheaper than or equal to RTM MCP. The LP solver dispatch is already optimal.</p>
            </div>
          )}
        </div>

        {/* ─── Merit Order Price vs MCP Chart ─── */}
        <div className="glass-card chart-container">
          <div className="chart-header">
            <h3>Generator Cost vs RTM MCP — Block T{currentBlock}</h3>
            <p>Bar chart of generator variable cost (₹/kWh from merit_order) compared to RTM MCP clearing price (from rtm_market)</p>
          </div>
          <div style={{ width: '100%', height: 350 }}>
            <ResponsiveContainer>
              <BarChart
                data={[
                  ...currentBlockGenDetails
                    .filter((g: any) => g.output > 0.5)
                    .map((g: any) => ({
                      name: g.name.length > 15 ? g.name.substring(0, 14) + '…' : g.name,
                      'Gen Cost': g.cost,
                      'RTM MCP': g.mcpKwh,
                      dispatched: g.output,
                    })),
                  ...(currentBlockCostData && currentBlockCostData['Market Buy (RTM)'] > 0.5
                    ? [{
                        name: 'RTM Buy',
                        'Gen Cost': (currentBlockCostData['RTM Price (₹)'] || 0) / 1000,
                        'RTM MCP': (currentBlockCostData['RTM Price (₹)'] || 0) / 1000,
                        dispatched: currentBlockCostData['Market Buy (RTM)'],
                      }]
                    : []),
                ]}
                margin={{ top: 10, right: 20, left: -10, bottom: 60 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis dataKey="name" stroke="rgba(255,255,255,0.3)" fontSize={11} tickMargin={8} angle={-35} textAnchor="end" height={80} />
                <YAxis stroke="rgba(255,255,255,0.3)" fontSize={12} label={{ value: '₹/kWh', angle: -90, position: 'insideLeft', fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} />
                <Tooltip
                  contentStyle={{ background: 'rgba(15,15,25,0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', fontSize: '0.85rem' }}
                  formatter={(value: any, name: any) => [`₹${Number(value).toFixed(3)}/kWh`, name]}
                />
                <Legend verticalAlign="top" height={36} iconType="circle" />
                <Bar dataKey="Gen Cost" fill="#8b5cf6" name="Generator Cost" radius={[4, 4, 0, 0]} />
                <Bar dataKey="RTM MCP" fill="#14b8a6" name="RTM MCP" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
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
