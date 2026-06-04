import React, { useState } from 'react';
import { Sliders, HelpCircle } from 'lucide-react';
import type { Generator, Market } from '../utils/optimizer';

interface ConfigPanelProps {
  generators: Generator[];
  markets: Market[];
  peakSolar: number;
  peakWind: number;
  peakHydro: number;
  onUpdateGenerator: (updatedGen: Generator) => void;
  onUpdateMarketCapacity: (marketId: 'rtm' | 'iex' | 'pxil', capacity: number) => void;
  onUpdateRenewables: (solar: number, wind: number, hydro: number) => void;
}

type TabType = 'generators' | 'markets' | 'renewables';

export const ConfigPanel: React.FC<ConfigPanelProps> = ({
  generators,
  markets,
  peakSolar,
  peakWind,
  peakHydro,
  onUpdateGenerator,
  onUpdateMarketCapacity,
  onUpdateRenewables,
}) => {
  const [activeTab, setActiveTab] = useState<TabType>('generators');
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'state' | 'central'>('all');

  const filteredGenerators = generators.filter(g => {
    const matchesSearch = g.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesType = filterType === 'all' || g.type === filterType;
    return matchesSearch && matchesType;
  });

  return (
    <div className="glass-card fade-in" style={{ flex: 1 }}>
      <div className="section-header" style={{ marginBottom: '15px' }}>
        <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Sliders style={{ color: 'var(--primary)' }} size={18} />
          Configuration Center
        </h3>
      </div>

      <div className="tabs">
        <button
          className={`tab ${activeTab === 'generators' ? 'active' : ''}`}
          onClick={() => setActiveTab('generators')}
        >
          Thermal Units
        </button>
        <button
          className={`tab ${activeTab === 'markets' ? 'active' : ''}`}
          onClick={() => setActiveTab('markets')}
        >
          Corridor & Markets
        </button>
        <button
          className={`tab ${activeTab === 'renewables' ? 'active' : ''}`}
          onClick={() => setActiveTab('renewables')}
        >
          Renewable Peak
        </button>
      </div>

      {activeTab === 'generators' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ display: 'flex', gap: '10px' }}>
            <input
              type="text"
              placeholder="Search units..."
              className="search-input"
              style={{ padding: '6px 12px', fontSize: '0.85rem', flex: 1 }}
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
            <select
              className="speed-select"
              style={{ padding: '6px 12px', fontSize: '0.85rem' }}
              value={filterType}
              onChange={e => setFilterType(e.target.value as any)}
            >
              <option value="all">All Sectors</option>
              <option value="state">State Sector</option>
              <option value="central">Central Sector</option>
            </select>
          </div>
          <div className="config-table-container" style={{ maxHeight: '420px', overflowY: 'auto' }}>
            <table className="config-table">
              <thead>
                <tr>
                  <th>Unit Name</th>
                  <th>Type</th>
                  <th>Cost (Rs/u)</th>
                  <th>Tech Min (MW)</th>
                  <th>Max Dec (MW)</th>
                  <th>Ramp (MW/m)</th>
                </tr>
              </thead>
              <tbody>
                {filteredGenerators.map(gen => (
                  <tr key={gen.id}>
                    <td style={{ fontWeight: '600' }}>{gen.name}</td>
                    <td>
                      <span className={`lock-indicator ${gen.type === 'state' ? 'open' : 'locked'}`} style={{ fontSize: '0.65rem' }}>
                        {gen.type.toUpperCase()}
                      </span>
                    </td>
                    <td>
                      <input
                        type="number"
                        step="0.1"
                        className="config-input"
                        value={gen.cost}
                        onChange={e => onUpdateGenerator({ ...gen, cost: parseFloat(e.target.value) || 0 })}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        className="config-input"
                        value={gen.minCapacity}
                        onChange={e => onUpdateGenerator({ ...gen, minCapacity: parseInt(e.target.value) || 0 })}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        className="config-input"
                        value={gen.maxCapacity}
                        onChange={e => onUpdateGenerator({ ...gen, maxCapacity: parseInt(e.target.value) || 0 })}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        className="config-input"
                        value={gen.rampRate}
                        onChange={e => onUpdateGenerator({ ...gen, rampRate: parseFloat(e.target.value) || 0 })}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ marginTop: '10px', fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <HelpCircle size={12} />
              Note: Central Sector generators have gate closure restrictions. State Thermal units can be adjusted in real-time.
            </div>
          </div>
        </div>
      )}

      {activeTab === 'markets' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '15px', padding: '5px 0' }}>
          {markets.map(market => (
            <div key={market.id} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: '600', fontSize: '0.9rem' }}>{market.name} transmission Corridor Limit</span>
                <span style={{ fontSize: '0.85rem', fontWeight: 'bold', color: 'var(--primary)' }}>{market.maxCapacity} MW</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <input
                  type="range"
                  min="50"
                  max="1000"
                  step="50"
                  style={{ flex: 1, accentColor: 'var(--primary)' }}
                  value={market.maxCapacity}
                  onChange={e => onUpdateMarketCapacity(market.id, parseInt(e.target.value) || 50)}
                />
                <input
                  type="number"
                  className="config-input"
                  value={market.maxCapacity}
                  onChange={e => onUpdateMarketCapacity(market.id, parseInt(e.target.value) || 50)}
                  style={{ width: '80px' }}
                />
              </div>
            </div>
          ))}
          <div style={{ marginTop: '5px', fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: '1.4' }}>
            💼 **RTM (Real-Time Market)** is priced block-by-block, making it ideal for covering unexpected deviations. <br />
            📅 **IEX (Day-Ahead Market)** represents standard baseload contracts booked prior.
          </div>
        </div>
      )}

      {activeTab === 'renewables' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '15px', padding: '5px 0' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <label style={{ fontSize: '0.85rem', fontWeight: '600' }}>Peak Solar Capacity (MW)</label>
              <span style={{ fontSize: '0.85rem', fontWeight: 'bold' }}>{peakSolar} MW</span>
            </div>
            <input
              type="range"
              min="0"
              max="1000"
              step="50"
              style={{ accentColor: 'var(--accent-amber)' }}
              value={peakSolar}
              onChange={e => onUpdateRenewables(parseInt(e.target.value) || 0, peakWind, peakHydro)}
            />
          </div>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <label style={{ fontSize: '0.85rem', fontWeight: '600' }}>Peak Wind Capacity (MW)</label>
              <span style={{ fontSize: '0.85rem', fontWeight: 'bold' }}>{peakWind} MW</span>
            </div>
            <input
              type="range"
              min="0"
              max="500"
              step="10"
              style={{ accentColor: 'rgba(14, 165, 233, 0.8)' }}
              value={peakWind}
              onChange={e => onUpdateRenewables(peakSolar, parseInt(e.target.value) || 0, peakHydro)}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <label style={{ fontSize: '0.85rem', fontWeight: '600' }}>Peak Hydro Capacity (MW)</label>
              <span style={{ fontSize: '0.85rem', fontWeight: 'bold' }}>{peakHydro} MW</span>
            </div>
            <input
              type="range"
              min="0"
              max="300"
              step="10"
              style={{ accentColor: 'var(--primary)' }}
              value={peakHydro}
              onChange={e => onUpdateRenewables(peakSolar, peakWind, parseInt(e.target.value) || 0)}
            />
          </div>
        </div>
      )}
    </div>
  );
};
