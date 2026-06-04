// ============================================================
// TRANSCO Power Purchase Decision-Support — Optimizer Engine
// Handles: Merit Order Dispatch, Ramp Rate Constraints,
//          State vs Central Gate Closure (Task 2),
//          Renewable Forecast Errors & Alerts (Task 3)
// ============================================================

export type GeneratorType = 'state' | 'central' | 'ipp';

export interface Generator {
  id: string;
  name: string;
  type: GeneratorType;
  cost: number;        // Rs per kWh (unit)
  minCapacity: number; // MW
  maxCapacity: number; // MW
  rampRate: number;    // MW/min → block ramp limit = rampRate * 15
  fuelType?: 'coal' | 'gas' | 'nuclear' | 'oil';
  plant?: string;
}

export type MarketId = 'rtm' | 'iex' | 'pxil';

export interface Market {
  id: MarketId;
  name: string;
  maxCapacity: number; // MW (corridor constraint)
  buyPrices: number[]; // 96 blocks
  sellPrices: number[]; // 96 blocks
}

export interface MustRunForecast {
  solar: number[];  // 96 blocks
  wind: number[];   // 96 blocks
  hydro: number[];  // 96 blocks
  ipp: number[];    // 96 blocks (IPP scheduled output)
}

export interface WeatherEvent {
  block: number;       // Block where event starts
  severity: number;    // 0-1 (fraction of solar lost)
  type: 'cloud' | 'rain' | 'storm';
  durationBlocks: number;
}

export interface SimulationParams {
  generators: Generator[];
  markets: Market[];
  demandYesterday: number[];   // 96 blocks
  demandToday: number[];       // 96 blocks
  mustRuns: MustRunForecast;
  weatherEvents: WeatherEvent[];
  userApprovedActions: { [alertId: string]: boolean };
  userRejectedActions: { [alertId: string]: boolean };
}

export interface BlockDispatch {
  block: number;
  timeStr: string;
  demand: number;
  mustRun: {
    solar: number;
    wind: number;
    hydro: number;
    ipp: number;
    total: number;
  };
  generatorOutputs: { [genId: string]: number };
  marketBuys: { rtm: number; iex: number; pxil: number };
  marketSells: { rtm: number; iex: number; pxil: number };
  unservedShortage: number;
  mustRunCurtailment: number;
  totalCost: number;   // Rs
  marginalCost: number; // Rs/unit
  netBalance: number;   // positive = surplus, negative = deficit
  forecastShortfallSurplus?: number;
  warnings: string[];
  activeWeatherEvents: WeatherEvent[];
}

export interface SimulationResult {
  dispatches: BlockDispatch[];
  lockedCentralSchedules: { [genId: string]: number[] };
  totalCost: number;
  totalSavings: number;
  totalMarketBuy: number;
  totalMarketSell: number;
  alerts: AlertEvent[];
}

export interface AlertEvent {
  id: string;
  block: number;
  type: 'info' | 'warning' | 'critical' | 'success';
  category: 'weather' | 'shortage' | 'surplus' | 'market' | 'gate_closure' | 'system';
  message: string;
  detail?: string;
  actionRequired: boolean;
  approved: boolean;
  rejected: boolean;
  actionDetails?: {
    deficitMW: number;
    recommendedBuyMarket: MarketId | 'thermal';
    recommendedAmount: number;
    recommendedCost: number;
    alternativeCost: number;
    estimatedSavings: number;
    weatherEvent?: WeatherEvent;
  };
}

// ─── Curve Generators ────────────────────────────────────────────────────────

export const blockToTime = (block: number): string => {
  const totalMinutes = (block - 1) * 15;
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
};

export const generateDemandCurve = (base: number, peakMult: number, seed: number): number[] => {
  return Array.from({ length: 96 }, (_, i) => {
    const time = i / 4;
    const morningPeak = Math.exp(-Math.pow(time - 9.5, 2) / 6);
    const eveningPeak = Math.exp(-Math.pow(time - 19.5, 2) / 8);
    const nightLow   = Math.exp(-Math.pow(time - 3.5, 2) / 4) * 0.2;
    const noise = Math.sin(i * 0.5 + seed) * (base * 0.02);
    return Math.round(base + base * peakMult * (morningPeak + eveningPeak * 1.2 - nightLow) + noise);
  });
};

export const generateSolarCurve = (maxSolar: number): number[] => {
  return Array.from({ length: 96 }, (_, i) => {
    const time = i / 4;
    if (time >= 6 && time <= 18) {
      return Math.round(maxSolar * Math.sin(Math.PI * (time - 6) / 12));
    }
    return 0;
  });
};

export const generateWindCurve = (maxWind: number, seed: number): number[] => {
  return Array.from({ length: 96 }, (_, i) => {
    const time = i / 4;
    const base = maxWind * 0.4 + maxWind * 0.3 * Math.cos(Math.PI * (time - 2) / 12);
    const fluctuation = Math.sin(i * 0.15 + seed) * (maxWind * 0.15);
    return Math.max(0, Math.round(base + fluctuation));
  });
};

export const generateHydroCurve = (maxHydro: number): number[] => {
  return Array.from({ length: 96 }, (_, i) => {
    const time = i / 4;
    const morningPeak = Math.exp(-Math.pow(time - 9.5, 2) / 2);
    const eveningPeak = Math.exp(-Math.pow(time - 19.5, 2) / 2);
    return Math.min(maxHydro, Math.round(maxHydro * 0.1 + maxHydro * 0.9 * (morningPeak + eveningPeak)));
  });
};

export const generateIPPCurve = (baseOutput: number, seed: number): number[] => {
  // IPP typically flat/contracted output with minor variations
  return Array.from({ length: 96 }, (_, i) => {
    const variation = Math.sin(i * 0.3 + seed) * (baseOutput * 0.05);
    return Math.max(0, Math.round(baseOutput + variation));
  });
};

export const generateMarketPrices = (basePrice: number, seed: number): { buyPrices: number[]; sellPrices: number[] } => {
  const buyPrices: number[] = [];
  const sellPrices: number[] = [];
  for (let i = 0; i < 96; i++) {
    const time = i / 4;
    const peak = Math.exp(-Math.pow(time - 9.5, 2) / 4) * 1.5
               + Math.exp(-Math.pow(time - 19.5, 2) / 5) * 1.8;
    const nightLow = Math.exp(-Math.pow(time - 3.5, 2) / 3) * 0.3;
    const noise = Math.sin(i * 0.2 + seed) * 0.2;
    const price = Math.max(1.5, basePrice + basePrice * (peak - nightLow) + noise);
    buyPrices.push(parseFloat(price.toFixed(2)));
    sellPrices.push(parseFloat((price * 0.85).toFixed(2)));
  }
  return { buyPrices, sellPrices };
};

// ─── Gate Closure Logic (Task 2) ─────────────────────────────────────────────
// At block T (current):
//   If T is ODD  → lock count = 7 → lock T+6 and T+7
//   If T is EVEN → lock count = 8 → lock T+7 and T+8
export const getGateClosureBlock = (currentBlock: number): number => {
  return currentBlock % 2 !== 0 ? currentBlock + 6 : currentBlock + 7;
};

export const getLockedBlocks = (currentBlock: number): number[] => {
  if (currentBlock % 2 !== 0) {
    return [currentBlock + 6, currentBlock + 7].filter(b => b <= 96);
  } else {
    return [currentBlock + 7, currentBlock + 8].filter(b => b <= 96);
  }
};

// ─── Weather Event Helpers ────────────────────────────────────────────────────
export const getActiveWeatherEvents = (block: number, events: WeatherEvent[]): WeatherEvent[] => {
  return events.filter(e => block >= e.block && block < e.block + e.durationBlocks);
};

export const applySolarWeatherLoss = (solarForecast: number, events: WeatherEvent[]): number => {
  let result = solarForecast;
  for (const evt of events) {
    result = Math.round(result * (1 - evt.severity));
  }
  return Math.max(0, result);
};

// ─── Single Block Merit-Order Dispatch Solver ────────────────────────────────
export const dispatchSingleBlock = (
  block: number,
  demand: number,
  mustRun: { solar: number; wind: number; hydro: number; ipp: number },
  generators: Generator[],
  markets: Market[],
  prevGeneratorOutputs: { [genId: string]: number },
  lockedCentralOutputs: { [genId: string]: number },
  isCentralLocked: boolean,
  activeWeatherEvents: WeatherEvent[]
): Omit<BlockDispatch, 'marginalCost'> => {
  const blockIndex = block - 1;
  const totalMustRun = mustRun.solar + mustRun.wind + mustRun.hydro + mustRun.ipp;

  // 1. Compute generator bounds (ramp rate + technical min/max)
  const generatorOutputs: { [genId: string]: number } = {};
  const bounds: { [genId: string]: { min: number; max: number } } = {};
  let preDispatchedThermal = 0;

  for (const gen of generators) {
    const prevOutput = prevGeneratorOutputs[gen.id] ?? gen.minCapacity;
    const blockRampLimit = gen.rampRate * 15;

    if (gen.type === 'central' && isCentralLocked) {
      const lockedVal = lockedCentralOutputs[gen.id] ?? gen.minCapacity;
      bounds[gen.id] = { min: lockedVal, max: lockedVal };
      generatorOutputs[gen.id] = lockedVal;
    } else {
      const minByRamp = prevOutput - blockRampLimit;
      const maxByRamp = prevOutput + blockRampLimit;
      const minLimit = Math.max(gen.minCapacity, minByRamp);
      const maxLimit = Math.min(gen.maxCapacity, maxByRamp);
      bounds[gen.id] = { min: minLimit, max: maxLimit };
      generatorOutputs[gen.id] = minLimit;
    }
    preDispatchedThermal += generatorOutputs[gen.id];
  }

  // 2. Net remaining demand after must-runs + generator minimums
  let remainingDemand = demand - totalMustRun - preDispatchedThermal;
  const marketBuys: { rtm: number; iex: number; pxil: number } = { rtm: 0, iex: 0, pxil: 0 };
  const marketSells: { rtm: number; iex: number; pxil: number } = { rtm: 0, iex: 0, pxil: 0 };
  let unservedShortage = 0;
  let mustRunCurtailment = 0;
  const warnings: string[] = [];

  if (remainingDemand > 0) {
    // DEFICIT — merit order: ramp up cheapest thermal first, then buy from markets
    interface DispatchOption {
      id: string;
      type: 'generator' | 'market';
      marketId?: MarketId;
      availableCapacity: number;
      cost: number;
    }
    const options: DispatchOption[] = [];

    for (const gen of generators) {
      const avail = bounds[gen.id].max - bounds[gen.id].min;
      if (avail > 0) {
        options.push({ id: gen.id, type: 'generator', availableCapacity: avail, cost: gen.cost });
      }
    }
    for (const market of markets) {
      options.push({
        id: `market_buy_${market.id}`,
        type: 'market',
        marketId: market.id,
        availableCapacity: market.maxCapacity,
        cost: market.buyPrices[blockIndex]
      });
    }

    // Sort by cost ascending (merit order)
    options.sort((a, b) => a.cost - b.cost);

    for (const opt of options) {
      if (remainingDemand <= 0) break;
      const amount = Math.min(opt.availableCapacity, remainingDemand);
      if (opt.type === 'generator') {
        generatorOutputs[opt.id] += amount;
      } else if (opt.type === 'market' && opt.marketId) {
        marketBuys[opt.marketId] += amount;
      }
      remainingDemand -= amount;
    }

    if (remainingDemand > 0) {
      unservedShortage = remainingDemand;
      warnings.push(`⚠ Deficit of ${Math.round(unservedShortage)} MW unmet — all resources exhausted.`);
    }
  } else if (remainingDemand < 0) {
    // SURPLUS — sell to highest-price market first
    let surplus = Math.abs(remainingDemand);
    const sellOptions = markets
      .map(m => ({ marketId: m.id as MarketId, price: m.sellPrices[blockIndex], capacity: m.maxCapacity }))
      .sort((a, b) => b.price - a.price);

    for (const opt of sellOptions) {
      if (surplus <= 0) break;
      const amount = Math.min(opt.capacity, surplus);
      marketSells[opt.marketId] = amount;
      surplus -= amount;
    }
    if (surplus > 0) {
      mustRunCurtailment = surplus;
      warnings.push(`⚡ Curtailed ${Math.round(mustRunCurtailment)} MW — transmission corridor limits reached.`);
    }
  }

  // 3. Cost calculation
  let totalCost = 0;
  for (const gen of generators) {
    const outputMWh = generatorOutputs[gen.id] * 0.25; // 15min → hours
    totalCost += outputMWh * (gen.cost * 1000);         // Rs/kWh * 1000 = Rs/MWh
  }
  for (const mId of ['rtm', 'iex', 'pxil'] as MarketId[]) {
    const buyPrice  = markets.find(m => m.id === mId)?.buyPrices[blockIndex] ?? 0;
    const sellPrice = markets.find(m => m.id === mId)?.sellPrices[blockIndex] ?? 0;
    totalCost += (marketBuys[mId] * 0.25) * (buyPrice * 1000);
    totalCost -= (marketSells[mId] * 0.25) * (sellPrice * 1000);
  }
  if (unservedShortage > 0) {
    totalCost += (unservedShortage * 0.25) * (20 * 1000); // 20 Rs/unit penalty
  }

  const netBalance = (totalMustRun + preDispatchedThermal + marketBuys.rtm + marketBuys.iex + marketBuys.pxil)
                   - (demand + unservedShortage + marketSells.rtm + marketSells.iex + marketSells.pxil);

  return {
    block,
    timeStr: blockToTime(block),
    demand,
    mustRun: { ...mustRun, total: totalMustRun },
    generatorOutputs,
    marketBuys,
    marketSells,
    unservedShortage,
    mustRunCurtailment,
    totalCost: parseFloat(totalCost.toFixed(2)),
    netBalance: parseFloat(netBalance.toFixed(1)),
    warnings,
    activeWeatherEvents
  };
};

// ─── Lookahead (Rolling Horizon) for Central Scheduling (Task 2) ──────────────
export const runLookahead = (
  startBlock: number,
  currentState: {
    prevOutputs: { [genId: string]: number };
    lockedCentralSchedules: { [genId: string]: number[] };
  },
  params: SimulationParams
): { [genId: string]: number[] } => {
  const lookaheadSchedules: { [genId: string]: number[] } = {};
  for (const gen of params.generators) {
    lookaheadSchedules[gen.id] = [...(currentState.lockedCentralSchedules[gen.id] ?? Array(96).fill(0))];
  }

  let simulatedPrevOutputs = { ...currentState.prevOutputs };
  const gateLimit = getGateClosureBlock(startBlock);

  for (let t = startBlock; t <= 96; t++) {
    const isCentralLockedForBlock = t < gateLimit;
    const blockIndex = t - 1;

    const activeEvts = getActiveWeatherEvents(t, params.weatherEvents);
    const rawSolar = params.mustRuns.solar[blockIndex];
    const activeSolar = activeEvts.length > 0 ? applySolarWeatherLoss(rawSolar, activeEvts) : rawSolar;

    const mustRun = {
      solar: activeSolar,
      wind: params.mustRuns.wind[blockIndex],
      hydro: params.mustRuns.hydro[blockIndex],
      ipp: params.mustRuns.ipp[blockIndex]
    };

    const lockedVals: { [genId: string]: number } = {};
    for (const gen of params.generators) {
      if (gen.type === 'central') {
        lockedVals[gen.id] = lookaheadSchedules[gen.id][blockIndex] ?? gen.minCapacity;
      }
    }

    const result = dispatchSingleBlock(
      t,
      params.demandToday[blockIndex],
      mustRun,
      params.generators,
      params.markets,
      simulatedPrevOutputs,
      lockedVals,
      isCentralLockedForBlock,
      activeEvts
    );

    for (const gen of params.generators) {
      simulatedPrevOutputs[gen.id] = result.generatorOutputs[gen.id];
      if (gen.type === 'central' && !isCentralLockedForBlock) {
        lookaheadSchedules[gen.id][blockIndex] = result.generatorOutputs[gen.id];
      }
    }
  }
  return lookaheadSchedules;
};

// ─── Main Full Simulation Runner ──────────────────────────────────────────────
export const runFullSimulation = (params: SimulationParams): SimulationResult => {
  const dispatches: BlockDispatch[] = [];
  const alerts: AlertEvent[] = [];

  const lockedCentralSchedules: { [genId: string]: number[] } = {};
  const prevOutputs: { [genId: string]: number } = {};
  for (const gen of params.generators) {
    lockedCentralSchedules[gen.id] = Array(96).fill(gen.minCapacity);
    prevOutputs[gen.id] = gen.minCapacity;
  }

  let totalBaselineCost = 0;
  let totalMarketBuy = 0;
  let totalMarketSell = 0;

  // Pre-generate weather alerts (Task 3)
  const firedWeatherAlerts = new Set<string>();

  for (let t = 1; t <= 96; t++) {
    const blockIndex = t - 1;

    // ── Weather alerts ────────────────────────────────────────────────────────
    for (const evt of params.weatherEvents) {
      const warnKey = `weather_warn_${evt.block}_${evt.type}`;
      const critKey = `weather_crit_${evt.block}_${evt.type}`;

      // Pre-alert 4 blocks before
      if (t === evt.block - 4 && !firedWeatherAlerts.has(warnKey)) {
        firedWeatherAlerts.add(warnKey);
        alerts.push({
          id: warnKey,
          block: t,
          type: 'warning',
          category: 'weather',
          message: `🌤️ Weather alert: ${evt.type.toUpperCase()} expected at block T${evt.block} (${blockToTime(evt.block)})`,
          detail: `Expected solar loss: ${Math.round(evt.severity * 100)}% for ${evt.durationBlocks} blocks. Prepare backup generation.`,
          actionRequired: false,
          approved: false,
          rejected: false
        });
      }

      // Critical alert at event block
      if (t === evt.block && !firedWeatherAlerts.has(critKey)) {
        firedWeatherAlerts.add(critKey);
        const rawSolar = params.mustRuns.solar[blockIndex];
        const actualSolar = Math.round(rawSolar * (1 - evt.severity));
        const solarLoss = rawSolar - actualSolar;

        const rtmPrice  = params.markets.find(m => m.id === 'rtm')?.buyPrices[blockIndex] ?? 0;
        const iexPrice  = params.markets.find(m => m.id === 'iex')?.buyPrices[blockIndex] ?? 0;
        const pxilPrice = params.markets.find(m => m.id === 'pxil')?.buyPrices[blockIndex] ?? 0;
        const cheapestThermal = Math.min(...params.generators.filter(g => g.type === 'state').map(g => g.cost));

        const priceMap: Record<string, number> = { rtm: rtmPrice, iex: iexPrice, pxil: pxilPrice, thermal: cheapestThermal };
        const bestMarket = (Object.entries(priceMap).sort((a, b) => a[1] - b[1])[0][0]) as MarketId | 'thermal';
        const bestPrice = priceMap[bestMarket];
        const altPrice = Object.values(priceMap).filter(p => p !== bestPrice).sort()[0];

        const isApproved = !!params.userApprovedActions[critKey];
        const isRejected = !!params.userRejectedActions[critKey];

        alerts.push({
          id: critKey,
          block: t,
          type: 'critical',
          category: 'weather',
          message: `🚨 ${evt.type.toUpperCase()} hit! Solar dropped from ${rawSolar}MW → ${actualSolar}MW (−${solarLoss}MW)`,
          detail: `Deficit: ${solarLoss} MW needs immediate coverage. Recommended: Buy from ${bestMarket.toUpperCase()} @ ₹${bestPrice.toFixed(2)}/unit`,
          actionRequired: !isApproved && !isRejected,
          approved: isApproved,
          rejected: isRejected,
          actionDetails: {
            deficitMW: solarLoss,
            recommendedBuyMarket: bestMarket,
            recommendedAmount: solarLoss,
            recommendedCost: bestPrice,
            alternativeCost: altPrice,
            estimatedSavings: (altPrice - bestPrice) * solarLoss * 0.25 * 1000,
            weatherEvent: evt
          }
        });
      }
    }

    // ── Gate closure lookahead ────────────────────────────────────────────────
    const newLocks = runLookahead(t, { prevOutputs, lockedCentralSchedules }, params);
    const blocksToLock = getLockedBlocks(t);
    for (const blockToLock of blocksToLock) {
      if (blockToLock <= 96) {
        for (const gen of params.generators) {
          if (gen.type === 'central') {
            lockedCentralSchedules[gen.id][blockToLock - 1] = newLocks[gen.id][blockToLock - 1];
          }
        }
      }
    }

    // ── Actual block dispatch ─────────────────────────────────────────────────
    const gateLimit = getGateClosureBlock(t);
    const activeEvts = getActiveWeatherEvents(t, params.weatherEvents);
    const rawSolar = params.mustRuns.solar[blockIndex];
    const actualSolar = activeEvts.length > 0 ? applySolarWeatherLoss(rawSolar, activeEvts) : rawSolar;

    const mustRun = {
      solar: actualSolar,
      wind: params.mustRuns.wind[blockIndex],
      hydro: params.mustRuns.hydro[blockIndex],
      ipp: params.mustRuns.ipp[blockIndex]
    };

    const lockedVals: { [genId: string]: number } = {};
    for (const gen of params.generators) {
      if (gen.type === 'central') {
        lockedVals[gen.id] = lockedCentralSchedules[gen.id][blockIndex];
      }
    }

    const dispatchResult = dispatchSingleBlock(
      t,
      params.demandToday[blockIndex],
      mustRun,
      params.generators,
      params.markets,
      prevOutputs,
      lockedVals,
      t < gateLimit,
      activeEvts
    );

    // Marginal cost
    const activeCosts: number[] = [];
    for (const gen of params.generators) {
      if (dispatchResult.generatorOutputs[gen.id] > gen.minCapacity) activeCosts.push(gen.cost);
    }
    if (dispatchResult.marketBuys.rtm > 0) activeCosts.push(params.markets.find(m => m.id === 'rtm')?.buyPrices[blockIndex] ?? 0);
    if (dispatchResult.marketBuys.iex > 0) activeCosts.push(params.markets.find(m => m.id === 'iex')?.buyPrices[blockIndex] ?? 0);
    if (dispatchResult.marketBuys.pxil > 0) activeCosts.push(params.markets.find(m => m.id === 'pxil')?.buyPrices[blockIndex] ?? 0);
    const marginalCost = activeCosts.length > 0 ? Math.max(...activeCosts) : 3.0;

    const fullDispatch: BlockDispatch = { ...dispatchResult, marginalCost };
    dispatches.push(fullDispatch);

    // Update states
    for (const gen of params.generators) {
      prevOutputs[gen.id] = fullDispatch.generatorOutputs[gen.id];
    }

    totalBaselineCost += fullDispatch.totalCost * 1.15;
    totalMarketBuy += fullDispatch.marketBuys.rtm + fullDispatch.marketBuys.iex + fullDispatch.marketBuys.pxil;
    totalMarketSell += fullDispatch.marketSells.rtm + fullDispatch.marketSells.iex + fullDispatch.marketSells.pxil;
  }

  const totalCost = dispatches.reduce((acc, d) => acc + d.totalCost, 0);
  const totalSavings = totalBaselineCost - totalCost;

  return {
    dispatches,
    lockedCentralSchedules,
    totalCost: parseFloat(totalCost.toFixed(2)),
    totalSavings: parseFloat(Math.max(0, totalSavings).toFixed(2)),
    totalMarketBuy: parseFloat((totalMarketBuy * 0.25).toFixed(1)),
    totalMarketSell: parseFloat((totalMarketSell * 0.25).toFixed(1)),
    alerts
  };
};
