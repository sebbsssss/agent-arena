// ═══════════════════════════════════════════════════════════════
// THE HIVE BACKTESTER
// Simulates 10,000 bees trading against real historical data
// Each bee starts with $1,000 paper money
// ═══════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

// ─── Config ────────────────────────────────────────────────────
const INITIAL_CAPITAL = 1000;
const TOTAL_AGENTS = 10000;
const TRADE_FEE = 0.001; // 0.1% per trade (Solana DEX typical)
const SLIPPAGE = 0.0005; // 0.05% slippage
const MAX_POSITION_PCT = 0.25; // Max 25% of portfolio per position
const DATA_DIR = path.join(__dirname, 'data');
const OBSIDIAN_DIR = '/Users/sebastien/Obsidian Notes/Main Notes/';

// ─── PRNG (same as frontend) ──────────────────────────────────
function mulberry32(s) {
  return function () {
    s |= 0; s = s + 0x6D2B79F5 | 0;
    let t = Math.imul(s ^ s >>> 15, 1 | s);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// ─── Strategies (same as frontend) ────────────────────────────
const STRATEGIES = [
  // ── Momentum (6) ──
  { name: 'Trend Following', cat: 'Momentum', risk: 'MED' },
  { name: 'Momentum Factor', cat: 'Momentum', risk: 'MED' },
  { name: 'Breakout Trading', cat: 'Momentum', risk: 'HIGH' },
  { name: 'Donchian Channel', cat: 'Momentum', risk: 'MED' },
  { name: 'Dual Momentum', cat: 'Momentum', risk: 'MED' },
  { name: 'Momentum Ignition', cat: 'Momentum', risk: 'HIGH' },
  // ── Mean Reversion (6) ──
  { name: 'Mean Reversion', cat: 'Mean Rev', risk: 'MED' },
  { name: 'Pairs Trading', cat: 'Mean Rev', risk: 'LOW' },
  { name: 'Stat Arb', cat: 'Mean Rev', risk: 'MED' },
  { name: 'Bollinger Reversion', cat: 'Mean Rev', risk: 'MED' },
  { name: 'RSI Mean Reversion', cat: 'Mean Rev', risk: 'MED' },
  { name: 'Ornstein-Uhlenbeck', cat: 'Mean Rev', risk: 'MED' },
  // ── Volatility (6) ──
  { name: 'Volatility Trading', cat: 'Volatility', risk: 'HIGH' },
  { name: 'Gamma Scalping', cat: 'Volatility', risk: 'HIGH' },
  { name: 'Volatility Regime', cat: 'Volatility', risk: 'MED' },
  { name: 'Dispersion Trading', cat: 'Volatility', risk: 'HIGH' },
  { name: 'Straddle Selling', cat: 'Volatility', risk: 'HIGH' },
  { name: 'VIX Term Structure', cat: 'Volatility', risk: 'MED' },
  // ── Execution (6) ──
  { name: 'Market Making', cat: 'Execution', risk: 'MED' },
  { name: 'Grid Trading', cat: 'Execution', risk: 'MED' },
  { name: 'TWAP Execution', cat: 'Execution', risk: 'LOW' },
  { name: 'VWAP Strategy', cat: 'Execution', risk: 'LOW' },
  { name: 'Orderbook Imbalance', cat: 'Execution', risk: 'HIGH' },
  { name: 'Latency Arb', cat: 'Execution', risk: 'HIGH' },
  // ── Technical (8) ──
  { name: 'Ichimoku System', cat: 'Technical', risk: 'MED' },
  { name: 'Fibonacci', cat: 'Technical', risk: 'MED' },
  { name: 'EMA Ribbon', cat: 'Technical', risk: 'MED' },
  { name: 'Volume Profile', cat: 'Technical', risk: 'MED' },
  { name: 'Order Flow', cat: 'Technical', risk: 'HIGH' },
  { name: 'MACD Divergence', cat: 'Technical', risk: 'MED' },
  { name: 'Keltner Breakout', cat: 'Technical', risk: 'HIGH' },
  { name: 'Wyckoff Method', cat: 'Technical', risk: 'MED' },
  // ── Macro (6) ──
  { name: 'Risk Parity', cat: 'Macro', risk: 'LOW' },
  { name: 'Carry Trade', cat: 'Macro', risk: 'MED' },
  { name: 'Cross-Asset Momentum', cat: 'Macro', risk: 'MED' },
  { name: 'Factor Rotation', cat: 'Macro', risk: 'MED' },
  { name: 'Tail Risk Hedging', cat: 'Macro', risk: 'LOW' },
  { name: 'Global Macro', cat: 'Macro', risk: 'HIGH' },
  // ── Quant (11) ──
  { name: 'Kalman Filter', cat: 'Quant', risk: 'MED' },
  { name: 'Machine Learning Alpha', cat: 'Quant', risk: 'HIGH' },
  { name: 'Correlation Breakdown', cat: 'Quant', risk: 'HIGH' },
  { name: 'Kelly Criterion', cat: 'Quant', risk: 'DEGEN' },
  { name: 'Martingale', cat: 'Quant', risk: 'DEGEN' },
  { name: 'Relative Value', cat: 'Quant', risk: 'MED' },
  { name: 'Basis Trading', cat: 'Quant', risk: 'LOW' },
  { name: 'Delta Neutral', cat: 'Quant', risk: 'LOW' },
  { name: 'Scalping', cat: 'Quant', risk: 'HIGH' },
  { name: 'Swing Trading', cat: 'Quant', risk: 'MED' },
  { name: 'Position Trading', cat: 'Quant', risk: 'LOW' },
];

const TIME_HORIZONS = ['Scalper', 'Day Trader', 'Swing Trader', 'Position Trader', 'Long-Term Holder'];
const RISK_STYLES = ['Kelly Criterion', 'Fixed Fractional', 'Risk Parity', 'Trailing Stops', 'Pyramiding', 'Anti-Martingale', 'Conservative'];
const AGGRESSION_LEVELS = ['Ultra-Conservative', 'Conservative', 'Moderate', 'Aggressive', 'Degen'];
const TOKENS = ['SOL', 'BONK', 'WIF', 'JUP', 'JTO', 'RAY'];

// ─── Technical Indicators ─────────────────────────────────────
function sma(data, period) {
  const result = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { result.push(null); continue; }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += data[j];
    result.push(sum / period);
  }
  return result;
}

function ema(data, period) {
  const result = [];
  const k = 2 / (period + 1);
  let prev = null;
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { result.push(null); continue; }
    if (prev === null) {
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) sum += data[j];
      prev = sum / period;
    } else {
      prev = data[i] * k + prev * (1 - k);
    }
    result.push(prev);
  }
  return result;
}

function rsi(closes, period = 14) {
  const result = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period) { result.push(null); continue; }
    let gains = 0, losses = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const diff = closes[j] - closes[j - 1];
      if (diff > 0) gains += diff; else losses -= diff;
    }
    const avgGain = gains / period;
    const avgLoss = losses / period;
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    result.push(100 - (100 / (1 + rs)));
  }
  return result;
}

function bollingerBands(closes, period = 20, mult = 2) {
  const ma = sma(closes, period);
  const upper = [], lower = [], bandwidth = [];
  for (let i = 0; i < closes.length; i++) {
    if (ma[i] === null) { upper.push(null); lower.push(null); bandwidth.push(null); continue; }
    let sumSq = 0;
    for (let j = i - period + 1; j <= i; j++) sumSq += (closes[j] - ma[i]) ** 2;
    const std = Math.sqrt(sumSq / period);
    upper.push(ma[i] + mult * std);
    lower.push(ma[i] - mult * std);
    bandwidth.push(std * 2 * mult / ma[i]);
  }
  return { ma, upper, lower, bandwidth };
}

function atr(candles, period = 14) {
  const result = [];
  for (let i = 0; i < candles.length; i++) {
    if (i < period) { result.push(null); continue; }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const tr = Math.max(
        candles[j].h - candles[j].l,
        Math.abs(candles[j].h - candles[j - 1].c),
        Math.abs(candles[j].l - candles[j - 1].c)
      );
      sum += tr;
    }
    result.push(sum / period);
  }
  return result;
}

function volatility(closes, period = 14) {
  const result = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period) { result.push(null); continue; }
    const slice = closes.slice(i - period + 1, i + 1);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period;
    result.push(Math.sqrt(variance) / mean); // coefficient of variation
  }
  return result;
}

function macd(closes) {
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const macdLine = [];
  for (let i = 0; i < closes.length; i++) {
    if (ema12[i] === null || ema26[i] === null) { macdLine.push(null); continue; }
    macdLine.push(ema12[i] - ema26[i]);
  }
  // Signal line = 9-period EMA of MACD
  const validMacd = macdLine.filter(x => x !== null);
  const signalRaw = ema(validMacd, 9);
  const signal = [];
  let vi = 0;
  for (let i = 0; i < closes.length; i++) {
    if (macdLine[i] === null) { signal.push(null); continue; }
    signal.push(signalRaw[vi] || null);
    vi++;
  }
  // Histogram
  const histogram = [];
  for (let i = 0; i < closes.length; i++) {
    if (macdLine[i] === null || signal[i] === null) { histogram.push(null); continue; }
    histogram.push(macdLine[i] - signal[i]);
  }
  return { line: macdLine, signal, histogram };
}

// Keltner Channel (EMA + ATR bands)
function keltnerChannel(candles, emaPeriod = 20, atrPeriod = 14, mult = 2) {
  const closes = candles.map(x => x.c);
  const emaLine = ema(closes, emaPeriod);
  const atrLine = atr(candles, atrPeriod);
  const upper = [], lower = [];
  for (let i = 0; i < candles.length; i++) {
    if (emaLine[i] === null || atrLine[i] === null) { upper.push(null); lower.push(null); continue; }
    upper.push(emaLine[i] + mult * atrLine[i]);
    lower.push(emaLine[i] - mult * atrLine[i]);
  }
  return { mid: emaLine, upper, lower };
}

// ─── Agent Generator (same seed logic as frontend) ────────────
function generateAgent(id) {
  const seed = id * 2654435761 >>> 0;
  const rng = mulberry32(seed);

  const strat = STRATEGIES[Math.floor(rng() * STRATEGIES.length)];
  const strat2 = STRATEGIES[Math.floor(rng() * STRATEGIES.length)];
  const horizon = TIME_HORIZONS[Math.floor(rng() * TIME_HORIZONS.length)];
  const riskStyle = RISK_STYLES[Math.floor(rng() * RISK_STYLES.length)];
  const aggression = AGGRESSION_LEVELS[Math.floor(rng() * AGGRESSION_LEVELS.length)];

  // Each agent prefers certain tokens based on their seed
  const tokenPrefs = [];
  const numTokens = 1 + Math.floor(rng() * 3); // 1-3 tokens
  const shuffled = [...TOKENS].sort(() => rng() - 0.5);
  for (let i = 0; i < numTokens; i++) tokenPrefs.push(shuffled[i]);

  const prefixes = ['ALPHA', 'BETA', 'DELTA', 'SIGMA', 'OMEGA', 'NEXUS', 'FLUX', 'VOID', 'APEX', 'GHOST', 'CYBER', 'NEON', 'TURBO', 'BLITZ', 'IRON', 'STORM', 'PULSE', 'ZERO', 'HYPER', 'ROGUE', 'SHADE', 'SPARK', 'DRIFT', 'CORE', 'WAVE', 'ECHO', 'VIPER', 'TITAN', 'ATLAS', 'PRIME', 'ONYX', 'HELIX'];
  const suffixes = ['', '_X', '_V2', '_PRO', '_MAX', '_LITE', '_9000', '_AI', '_BOT', '_DAO', '_SOL', '', '', '', '', ''];
  const name = prefixes[Math.floor(rng() * prefixes.length)] + suffixes[Math.floor(rng() * suffixes.length)];

  return {
    id, seed, name, rng,
    strategy: strat.name, strategyCat: strat.cat, strategyRisk: strat.risk,
    strategy2: strat2.name,
    horizon, riskStyle, aggression,
    tokens: tokenPrefs,
  };
}

// ─── Position sizing based on agent traits ────────────────────
function getPositionSize(agent, portfolio) {
  const aggrMult = { 'Ultra-Conservative': 0.03, 'Conservative': 0.06, 'Moderate': 0.10, 'Aggressive': 0.18, 'Degen': 0.25 };
  const riskMult = { 'Kelly Criterion': 1.0, 'Fixed Fractional': 0.8, 'Risk Parity': 0.7, 'Trailing Stops': 0.9, 'Pyramiding': 1.2, 'Anti-Martingale': 0.9, 'Conservative': 0.5 };

  const base = aggrMult[agent.aggression] || 0.10;
  const risk = riskMult[agent.riskStyle] || 0.8;
  const size = portfolio * base * risk;
  return Math.min(size, portfolio * MAX_POSITION_PCT);
}

// ─── Trend Detection ──────────────────────────────────────────

const TREND_FILTERED = new Set([
  'Mean Reversion', 'Pairs Trading', 'Stat Arb', 'Bollinger Reversion',
  'RSI Mean Reversion', 'Ornstein-Uhlenbeck',
  'Grid Trading', 'Market Making', 'VWAP Strategy',
  'Swing Trading', 'Position Trading', 'Scalping',
  'Carry Trade', 'Relative Value',
  'Basis Trading', 'Delta Neutral', 'TWAP Execution',
  'Risk Parity', 'Straddle Selling',
]);

function isUptrend(indicators, idx) {
  const ma50 = indicators.sma50[idx];
  const ma50prev = indicators.sma50[Math.max(0, idx - 10)];
  if (!ma50 || !ma50prev) return true; // default allow when not enough data
  return ma50 >= ma50prev;
}

// ─── Strategy Implementations ─────────────────────────────────
// Each returns: { signal: 'BUY'|'SELL'|'HOLD', confidence: 0-1 }
// They only see data up to current index (no look-ahead)

function strategySignal(stratName, candles, idx, indicators, agent) {
  const c = candles[idx];

  switch (stratName) {

    // ═══════════════════════════════════
    // MOMENTUM STRATEGIES
    // ═══════════════════════════════════

    case 'Trend Following': {
      // Rides sustained moves using MA crossover + trend strength
      const ema12 = indicators.ema12[idx];
      const ema26 = indicators.ema26[idx];
      const ma50 = indicators.sma50[idx];
      if (ema12 === null || ema26 === null || ma50 === null) return { signal: 'HOLD', confidence: 0 };
      const macd = ema12 - ema26;
      const prevMacd = (indicators.ema12[idx - 1] || 0) - (indicators.ema26[idx - 1] || 0);
      // Strong trend: price above 50 SMA and MACD crossing up
      if (macd > 0 && prevMacd <= 0 && c.c > ma50) return { signal: 'BUY', confidence: 0.8 };
      if (macd < 0 && prevMacd >= 0 && c.c < ma50) return { signal: 'SELL', confidence: 0.8 };
      if (macd > 0 && c.c > ma50) return { signal: 'BUY', confidence: 0.3 };
      if (macd < 0 && c.c < ma50) return { signal: 'SELL', confidence: 0.3 };
      return { signal: 'HOLD', confidence: 0 };
    }

    case 'Momentum Factor': {
      // Ranks by recent performance, goes long winners
      if (idx < 20) return { signal: 'HOLD', confidence: 0 };
      const ret20d = (c.c - candles[idx - 20].c) / candles[idx - 20].c;
      const ret5d = (c.c - candles[idx - 5].c) / candles[idx - 5].c;
      // Strong positive momentum on both timeframes
      if (ret20d > 0.10 && ret5d > 0.03) return { signal: 'BUY', confidence: 0.7 };
      if (ret20d > 0.05 && ret5d > 0) return { signal: 'BUY', confidence: 0.4 };
      if (ret20d < -0.10 && ret5d < -0.03) return { signal: 'SELL', confidence: 0.7 };
      if (ret20d < -0.05) return { signal: 'SELL', confidence: 0.4 };
      return { signal: 'HOLD', confidence: 0 };
    }

    case 'Breakout Trading': {
      // Enter when price breaks 20-day high/low with volume
      if (idx < 20) return { signal: 'HOLD', confidence: 0 };
      const high20 = Math.max(...candles.slice(idx - 20, idx).map(x => x.h));
      const low20 = Math.min(...candles.slice(idx - 20, idx).map(x => x.l));
      const avgVol = candles.slice(idx - 10, idx).reduce((s, x) => s + x.v, 0) / 10;
      const volConfirm = c.v > avgVol * 1.2;
      if (c.c > high20 && volConfirm) return { signal: 'BUY', confidence: 0.8 };
      if (c.c < low20) return { signal: 'SELL', confidence: 0.8 };
      return { signal: 'HOLD', confidence: 0 };
    }

    case 'Donchian Channel': {
      // Buy new 20-day high, sell new 20-day low (turtle trading)
      if (idx < 20) return { signal: 'HOLD', confidence: 0 };
      const high20 = Math.max(...candles.slice(idx - 20, idx).map(x => x.h));
      const low20 = Math.min(...candles.slice(idx - 20, idx).map(x => x.l));
      if (c.c > high20) return { signal: 'BUY', confidence: 0.7 };
      if (c.c < low20) return { signal: 'SELL', confidence: 0.7 };
      // Exit on 10-day channel break opposite direction
      if (idx >= 10) {
        const high10 = Math.max(...candles.slice(idx - 10, idx).map(x => x.h));
        const low10 = Math.min(...candles.slice(idx - 10, idx).map(x => x.l));
        if (c.c < low10) return { signal: 'SELL', confidence: 0.5 };
      }
      return { signal: 'HOLD', confidence: 0 };
    }

    case 'Dual Momentum': {
      // Absolute + relative momentum must both align
      if (idx < 20) return { signal: 'HOLD', confidence: 0 };
      const ret20d = (c.c - candles[idx - 20].c) / candles[idx - 20].c;
      const ma50 = indicators.sma50[idx];
      // Absolute momentum: positive returns. Relative: above long MA
      if (ret20d > 0.05 && ma50 && c.c > ma50) return { signal: 'BUY', confidence: 0.7 };
      if (ret20d > 0 && ma50 && c.c > ma50) return { signal: 'BUY', confidence: 0.4 };
      if (ret20d < -0.05 && ma50 && c.c < ma50) return { signal: 'SELL', confidence: 0.7 };
      if (ret20d < 0 && ma50 && c.c < ma50) return { signal: 'SELL', confidence: 0.4 };
      return { signal: 'HOLD', confidence: 0 };
    }

    case 'Momentum Ignition': {
      // Detects early-stage momentum bursts via volume surge
      if (idx < 5) return { signal: 'HOLD', confidence: 0 };
      const ret3d = (c.c - candles[idx - 3].c) / candles[idx - 3].c;
      const avgVol = candles.slice(idx - 5, idx).reduce((s, x) => s + x.v, 0) / 5;
      const volSurge = c.v > avgVol * 1.8;
      if (ret3d > 0.05 && volSurge) return { signal: 'BUY', confidence: 0.8 };
      if (ret3d < -0.05 && volSurge) return { signal: 'SELL', confidence: 0.8 };
      if (ret3d > 0.03 && volSurge) return { signal: 'BUY', confidence: 0.5 };
      return { signal: 'HOLD', confidence: 0 };
    }

    // ═══════════════════════════════════
    // MEAN REVERSION STRATEGIES
    // ═══════════════════════════════════

    case 'Mean Reversion': {
      const rsiVal = indicators.rsi[idx];
      const bb = indicators.bb;
      if (rsiVal === null || bb.lower[idx] === null) return { signal: 'HOLD', confidence: 0 };
      if (rsiVal < 30 && c.c <= bb.lower[idx]) return { signal: 'BUY', confidence: 0.7 };
      if (rsiVal > 70 && c.c >= bb.upper[idx]) return { signal: 'SELL', confidence: 0.7 };
      if (rsiVal < 35) return { signal: 'BUY', confidence: 0.4 };
      if (rsiVal > 65) return { signal: 'SELL', confidence: 0.4 };
      return { signal: 'HOLD', confidence: 0 };
    }

    case 'Pairs Trading':
    case 'Stat Arb': {
      // Mean reversion with tighter bands on deviation from SMA
      const ma = indicators.sma20[idx];
      if (ma === null) return { signal: 'HOLD', confidence: 0 };
      const dev = (c.c - ma) / ma;
      if (dev < -0.03) return { signal: 'BUY', confidence: 0.6 };
      if (dev > 0.03) return { signal: 'SELL', confidence: 0.6 };
      if (dev < -0.015) return { signal: 'BUY', confidence: 0.3 };
      if (dev > 0.015) return { signal: 'SELL', confidence: 0.3 };
      return { signal: 'HOLD', confidence: 0 };
    }

    case 'Bollinger Reversion': {
      // Fades moves to +/-2 std dev Bollinger Band extremes
      const bb = indicators.bb;
      if (bb.lower[idx] === null) return { signal: 'HOLD', confidence: 0 };
      if (c.c <= bb.lower[idx]) return { signal: 'BUY', confidence: 0.7 };
      if (c.c >= bb.upper[idx]) return { signal: 'SELL', confidence: 0.7 };
      // Near-band entries
      const midLow = (bb.ma[idx] + bb.lower[idx]) / 2;
      const midHigh = (bb.ma[idx] + bb.upper[idx]) / 2;
      if (c.c < midLow) return { signal: 'BUY', confidence: 0.3 };
      if (c.c > midHigh) return { signal: 'SELL', confidence: 0.3 };
      return { signal: 'HOLD', confidence: 0 };
    }

    case 'RSI Mean Reversion': {
      // Classic RSI oversold/overbought counter-trend
      const rsiVal = indicators.rsi[idx];
      if (rsiVal === null) return { signal: 'HOLD', confidence: 0 };
      if (rsiVal < 25) return { signal: 'BUY', confidence: 0.8 };
      if (rsiVal > 75) return { signal: 'SELL', confidence: 0.8 };
      if (rsiVal < 30) return { signal: 'BUY', confidence: 0.5 };
      if (rsiVal > 70) return { signal: 'SELL', confidence: 0.5 };
      return { signal: 'HOLD', confidence: 0 };
    }

    case 'Ornstein-Uhlenbeck': {
      // OU process: trade when price deviates significantly from EMA (mean)
      const e26 = indicators.ema26[idx];
      const vol = indicators.vol[idx];
      if (e26 === null || vol === null) return { signal: 'HOLD', confidence: 0 };
      const dev = (c.c - e26) / e26;
      const threshold = vol * 1.5; // Dynamic threshold based on realized vol
      if (dev < -threshold && threshold > 0.01) return { signal: 'BUY', confidence: 0.6 };
      if (dev > threshold && threshold > 0.01) return { signal: 'SELL', confidence: 0.6 };
      return { signal: 'HOLD', confidence: 0 };
    }

    // ═══════════════════════════════════
    // VOLATILITY STRATEGIES
    // ═══════════════════════════════════

    case 'Volatility Trading': {
      // Trades implied vs realized vol divergence (directional on vol expansion)
      const vol = indicators.vol[idx];
      const bw = indicators.bb.bandwidth[idx];
      if (vol === null || bw === null) return { signal: 'HOLD', confidence: 0 };
      const aboveMa = c.c > indicators.bb.ma[idx];
      if (bw > 0.08 && aboveMa) return { signal: 'BUY', confidence: 0.5 };
      if (bw > 0.08 && !aboveMa) return { signal: 'SELL', confidence: 0.5 };
      if (bw < 0.03) return { signal: 'HOLD', confidence: 0 };
      return { signal: 'HOLD', confidence: 0 };
    }

    case 'Gamma Scalping': {
      // Profits when realized vol exceeds implied; buys dips and sells rips rapidly
      if (idx < 3) return { signal: 'HOLD', confidence: 0 };
      const vol = indicators.vol[idx];
      if (vol === null) return { signal: 'HOLD', confidence: 0 };
      const ret1d = (c.c - candles[idx - 1].c) / candles[idx - 1].c;
      // High realized vol = good for gamma scalping
      if (vol > 0.03) {
        if (ret1d < -0.02) return { signal: 'BUY', confidence: 0.6 };
        if (ret1d > 0.02) return { signal: 'SELL', confidence: 0.6 };
      }
      return { signal: 'HOLD', confidence: 0 };
    }

    case 'Volatility Regime': {
      // Low vol: mean reversion. High vol: trend follow
      const vol = indicators.vol[idx];
      const rsiVal = indicators.rsi[idx];
      if (vol === null || rsiVal === null) return { signal: 'HOLD', confidence: 0 };
      if (vol < 0.02) {
        if (rsiVal < 35) return { signal: 'BUY', confidence: 0.5 };
        if (rsiVal > 65) return { signal: 'SELL', confidence: 0.5 };
      } else {
        const ema12 = indicators.ema12[idx];
        if (ema12 && c.c > ema12) return { signal: 'BUY', confidence: 0.5 };
        if (ema12 && c.c < ema12) return { signal: 'SELL', confidence: 0.5 };
      }
      return { signal: 'HOLD', confidence: 0 };
    }

    case 'VIX Term Structure': {
      // Trades vol curve shape: in low vol buy, in high vol sell
      const vol = indicators.vol[idx];
      if (vol === null || idx < 30) return { signal: 'HOLD', confidence: 0 };
      const vol30ago = indicators.vol[idx - 30];
      if (vol30ago === null) return { signal: 'HOLD', confidence: 0 };
      // Contango (short-term vol < long-term vol): long carry
      if (vol < vol30ago * 0.8) return { signal: 'BUY', confidence: 0.5 };
      // Backwardation (short-term vol > long-term vol): short
      if (vol > vol30ago * 1.3) return { signal: 'SELL', confidence: 0.5 };
      return { signal: 'HOLD', confidence: 0 };
    }

    case 'Straddle Selling': {
      // Profits in low-vol ranges (collecting "theta"), loses on actual big moves (short gamma)
      const bw = indicators.bb.bandwidth[idx];
      const bb = indicators.bb;
      if (bw === null || idx < 2) return { signal: 'HOLD', confidence: 0 };
      const ret1d = (c.c - candles[idx - 1].c) / candles[idx - 1].c;
      // Low vol = calm market, take small mean-reversion positions
      if (bw < 0.04) {
        if (c.c <= bb.lower[idx]) return { signal: 'BUY', confidence: 0.4 };
        if (c.c >= bb.upper[idx]) return { signal: 'SELL', confidence: 0.4 };
        return { signal: 'HOLD', confidence: 0 };
      }
      // High vol with actual big move = getting crushed, exit immediately
      if (bw > 0.06 && Math.abs(ret1d) > 0.02) {
        return { signal: 'SELL', confidence: 0.9 };
      }
      return { signal: 'HOLD', confidence: 0 };
    }

    case 'Dispersion Trading': {
      // Profits from vol mean reversion — buy when vol is spiking down from highs, sell when expanding
      const vol = indicators.vol[idx];
      if (vol === null || idx < 20) return { signal: 'HOLD', confidence: 0 };
      const prevVol = indicators.vol[idx - 10];
      if (prevVol === null) return { signal: 'HOLD', confidence: 0 };
      // Vol peaked and now calming = buy (vol reversion = price stabilizing)
      if (vol < prevVol * 0.8 && vol > 0.02) return { signal: 'BUY', confidence: 0.5 };
      // Vol expanding from low base = sell/reduce
      if (vol > prevVol * 1.3 && vol > 0.04) return { signal: 'SELL', confidence: 0.5 };
      return { signal: 'HOLD', confidence: 0 };
    }

    // ═══════════════════════════════════
    // EXECUTION STRATEGIES
    // ═══════════════════════════════════

    case 'Market Making': {
      // Profits from spread — buys dips, sells rips, small sizing
      if (idx < 1) return { signal: 'HOLD', confidence: 0 };
      const change = (c.c - candles[idx - 1].c) / candles[idx - 1].c;
      if (change < -0.01) return { signal: 'BUY', confidence: 0.3 };
      if (change > 0.01) return { signal: 'SELL', confidence: 0.3 };
      return { signal: 'HOLD', confidence: 0 };
    }

    case 'Grid Trading': {
      // Buys at regular intervals below MA, sells above
      const ma = indicators.sma20[idx];
      if (ma === null) return { signal: 'HOLD', confidence: 0 };
      const pctFromMa = (c.c - ma) / ma;
      if (pctFromMa < -0.02) return { signal: 'BUY', confidence: 0.4 };
      if (pctFromMa > 0.02) return { signal: 'SELL', confidence: 0.4 };
      return { signal: 'HOLD', confidence: 0 };
    }

    case 'VWAP Strategy': {
      // VWAP approximation using SMA — buy below, sell above
      const vwap = indicators.sma20[idx];
      if (vwap === null) return { signal: 'HOLD', confidence: 0 };
      if (c.c < vwap * 0.98) return { signal: 'BUY', confidence: 0.5 };
      if (c.c > vwap * 1.02) return { signal: 'SELL', confidence: 0.5 };
      return { signal: 'HOLD', confidence: 0 };
    }

    case 'Orderbook Imbalance': {
      // Reads volume imbalances to predict short-term direction
      if (idx < 5) return { signal: 'HOLD', confidence: 0 };
      const avgVol = candles.slice(idx - 5, idx).reduce((s, x) => s + x.v, 0) / 5;
      const volRatio = c.v / avgVol;
      const ret1d = (c.c - candles[idx - 1].c) / candles[idx - 1].c;
      // High volume + direction = imbalance signal
      if (volRatio > 1.8 && ret1d > 0.01) return { signal: 'BUY', confidence: 0.7 };
      if (volRatio > 1.8 && ret1d < -0.01) return { signal: 'SELL', confidence: 0.7 };
      return { signal: 'HOLD', confidence: 0 };
    }

    case 'Latency Arb': {
      // Exploits micro price differences — profits from vol spikes
      if (idx < 5) return { signal: 'HOLD', confidence: 0 };
      const avgVol = candles.slice(idx - 5, idx).reduce((s, x) => s + x.v, 0) / 5;
      if (c.v > avgVol * 1.5) return { signal: 'BUY', confidence: 0.5 };
      if (c.v > avgVol * 2.0 && c.c < candles[idx - 1].c) return { signal: 'SELL', confidence: 0.6 };
      return { signal: 'HOLD', confidence: 0 };
    }

    case 'TWAP Execution': {
      // Dollar-cost average: buy small amounts at regular intervals, only below VWAP proxy
      const ma = indicators.sma20[idx];
      if (ma === null) return { signal: 'HOLD', confidence: 0 };
      // Buy every 5 days when price is at or below 20-day average
      if (idx % 5 === 0 && c.c <= ma) return { signal: 'BUY', confidence: 0.3 };
      // Sell when price is significantly above average (take profit)
      if (c.c > ma * 1.04) return { signal: 'SELL', confidence: 0.3 };
      return { signal: 'HOLD', confidence: 0 };
    }

    // ═══════════════════════════════════
    // TECHNICAL STRATEGIES
    // ═══════════════════════════════════

    case 'Ichimoku System': {
      // Simplified: use 9/26 EMA as tenkan/kijun
      const tenkan = indicators.ema9[idx];
      const kijun = indicators.sma26[idx];
      if (tenkan === null || kijun === null) return { signal: 'HOLD', confidence: 0 };
      if (tenkan > kijun && c.c > tenkan) return { signal: 'BUY', confidence: 0.5 };
      if (tenkan < kijun && c.c < tenkan) return { signal: 'SELL', confidence: 0.5 };
      return { signal: 'HOLD', confidence: 0 };
    }

    case 'Fibonacci': {
      // 20-day high/low fib retracements
      if (idx < 20) return { signal: 'HOLD', confidence: 0 };
      const high = Math.max(...candles.slice(idx - 20, idx).map(x => x.h));
      const low = Math.min(...candles.slice(idx - 20, idx).map(x => x.l));
      const range = high - low;
      if (range === 0) return { signal: 'HOLD', confidence: 0 };
      const fib382 = high - range * 0.382;
      const fib618 = high - range * 0.618;
      if (c.c <= fib618 * 1.005 && c.c >= fib618 * 0.995) return { signal: 'BUY', confidence: 0.5 };
      if (c.c <= fib382 * 1.005 && c.c >= fib382 * 0.995) return { signal: 'SELL', confidence: 0.5 };
      return { signal: 'HOLD', confidence: 0 };
    }

    case 'EMA Ribbon': {
      const e9 = indicators.ema9[idx];
      const e12 = indicators.ema12[idx];
      const e26 = indicators.ema26[idx];
      if (e9 === null || e12 === null || e26 === null) return { signal: 'HOLD', confidence: 0 };
      if (e9 > e12 && e12 > e26) return { signal: 'BUY', confidence: 0.5 };
      if (e9 < e12 && e12 < e26) return { signal: 'SELL', confidence: 0.5 };
      return { signal: 'HOLD', confidence: 0 };
    }

    case 'Volume Profile':
    case 'Order Flow': {
      // Volume-based signals
      if (idx < 10) return { signal: 'HOLD', confidence: 0 };
      const avgVol = candles.slice(idx - 10, idx).reduce((s, x) => s + x.v, 0) / 10;
      const volRatio = c.v / avgVol;
      if (volRatio > 2.0 && c.c > candles[idx - 1].c) return { signal: 'BUY', confidence: 0.6 };
      if (volRatio > 2.0 && c.c < candles[idx - 1].c) return { signal: 'SELL', confidence: 0.6 };
      return { signal: 'HOLD', confidence: 0 };
    }

    case 'MACD Divergence': {
      // Spots divergence between price and MACD histogram
      if (idx < 30) return { signal: 'HOLD', confidence: 0 };
      const ema12v = indicators.ema12[idx];
      const ema26v = indicators.ema26[idx];
      const prevEma12 = indicators.ema12[idx - 5];
      const prevEma26 = indicators.ema26[idx - 5];
      if (!ema12v || !ema26v || !prevEma12 || !prevEma26) return { signal: 'HOLD', confidence: 0 };
      const macdNow = ema12v - ema26v;
      const macdPrev = prevEma12 - prevEma26;
      const priceNow = c.c;
      const pricePrev = candles[idx - 5].c;
      // Bullish divergence: price lower but MACD higher
      if (priceNow < pricePrev && macdNow > macdPrev) return { signal: 'BUY', confidence: 0.6 };
      // Bearish divergence: price higher but MACD lower
      if (priceNow > pricePrev && macdNow < macdPrev) return { signal: 'SELL', confidence: 0.6 };
      return { signal: 'HOLD', confidence: 0 };
    }

    case 'Keltner Breakout': {
      // Enters on closes outside Keltner Channel with ATR stops
      const atrVal = indicators.atr[idx];
      const e20 = indicators.ema20[idx];
      if (atrVal === null || e20 === null) return { signal: 'HOLD', confidence: 0 };
      const kUpper = e20 + 2 * atrVal;
      const kLower = e20 - 2 * atrVal;
      if (c.c > kUpper) return { signal: 'BUY', confidence: 0.7 };
      if (c.c < kLower) return { signal: 'SELL', confidence: 0.7 };
      return { signal: 'HOLD', confidence: 0 };
    }

    case 'Wyckoff Method': {
      // Accumulation/distribution via volume + price action
      if (idx < 20) return { signal: 'HOLD', confidence: 0 };
      const avgVol = candles.slice(idx - 20, idx).reduce((s, x) => s + x.v, 0) / 20;
      const ret20d = (c.c - candles[idx - 20].c) / candles[idx - 20].c;
      const volRatio = c.v / avgVol;
      // Accumulation: low price, high volume (smart money buying)
      if (ret20d < -0.05 && volRatio > 1.5) return { signal: 'BUY', confidence: 0.6 };
      // Distribution: high price, high volume (smart money selling)
      if (ret20d > 0.05 && volRatio > 1.5) return { signal: 'SELL', confidence: 0.6 };
      // Spring: sharp drop below support with quick recovery
      if (idx >= 2) {
        const prev = candles[idx - 1];
        if (prev.c < candles[idx - 2].l && c.c > prev.c) return { signal: 'BUY', confidence: 0.5 };
      }
      return { signal: 'HOLD', confidence: 0 };
    }

    // ═══════════════════════════════════
    // MACRO STRATEGIES
    // ═══════════════════════════════════

    case 'Carry Trade': {
      // Long high-yield assets in uptrends
      const ma50 = indicators.sma50[idx];
      if (ma50 === null) return { signal: 'HOLD', confidence: 0 };
      if (c.c > ma50 * 1.01) return { signal: 'BUY', confidence: 0.4 };
      if (c.c < ma50 * 0.98) return { signal: 'SELL', confidence: 0.4 };
      return { signal: 'HOLD', confidence: 0 };
    }

    case 'Cross-Asset Momentum': {
      // Momentum across timeframes
      if (idx < 20) return { signal: 'HOLD', confidence: 0 };
      const ret5d = (c.c - candles[idx - 5].c) / candles[idx - 5].c;
      const ret20d = (c.c - candles[idx - 20].c) / candles[idx - 20].c;
      if (ret5d > 0.03 && ret20d > 0.05) return { signal: 'BUY', confidence: 0.6 };
      if (ret5d < -0.03 && ret20d < -0.05) return { signal: 'SELL', confidence: 0.6 };
      return { signal: 'HOLD', confidence: 0 };
    }

    case 'Factor Rotation': {
      // Rotates between momentum and value based on vol regime
      const vol = indicators.vol[idx];
      const rsiVal = indicators.rsi[idx];
      if (vol === null || rsiVal === null || idx < 20) return { signal: 'HOLD', confidence: 0 };
      const ret20d = (c.c - candles[idx - 20].c) / candles[idx - 20].c;
      // Low vol: favor value (oversold)
      if (vol < 0.02 && rsiVal < 35) return { signal: 'BUY', confidence: 0.5 };
      if (vol < 0.02 && rsiVal > 65) return { signal: 'SELL', confidence: 0.5 };
      // High vol: favor momentum
      if (vol > 0.03 && ret20d > 0.08) return { signal: 'BUY', confidence: 0.5 };
      if (vol > 0.03 && ret20d < -0.08) return { signal: 'SELL', confidence: 0.5 };
      return { signal: 'HOLD', confidence: 0 };
    }

    case 'Global Macro': {
      // Directional positions based on macro trends (simulated via long-term MA)
      const ma50 = indicators.sma50[idx];
      if (ma50 === null || idx < 30) return { signal: 'HOLD', confidence: 0 };
      const ret30d = (c.c - candles[idx - 30].c) / candles[idx - 30].c;
      // Strong conviction trades on macro trends
      if (c.c > ma50 * 1.05 && ret30d > 0.10) return { signal: 'BUY', confidence: 0.7 };
      if (c.c < ma50 * 0.95 && ret30d < -0.10) return { signal: 'SELL', confidence: 0.7 };
      if (c.c > ma50) return { signal: 'BUY', confidence: 0.3 };
      if (c.c < ma50) return { signal: 'SELL', confidence: 0.3 };
      return { signal: 'HOLD', confidence: 0 };
    }

    case 'Risk Parity': {
      // Vol-adjusted trend following: bigger positions in low vol, smaller in high vol
      const vol = indicators.vol[idx];
      const ma50 = indicators.sma50[idx];
      if (vol === null || ma50 === null) return { signal: 'HOLD', confidence: 0 };
      // Confidence scales inversely with realized vol (risk parity = equal risk per unit)
      const volAdj = Math.max(0.15, Math.min(0.6, 0.02 / (vol || 0.02)));
      if (c.c > ma50 * 1.01) return { signal: 'BUY', confidence: volAdj };
      if (c.c < ma50 * 0.99) return { signal: 'SELL', confidence: volAdj };
      return { signal: 'HOLD', confidence: 0 };
    }

    case 'Tail Risk Hedging': {
      // Sits in cash most of the time. Buys aggressively only on actual large drops.
      // "Premium bleed" is opportunity cost of being in cash. Payoff = buying real crash dips.
      if (idx < 5) return { signal: 'HOLD', confidence: 0 };
      const ret1d = (c.c - candles[idx - 1].c) / candles[idx - 1].c;
      const ret5d = (c.c - candles[idx - 5].c) / candles[idx - 5].c;
      // Large actual daily crash — buy the panic aggressively
      if (ret1d < -0.07) return { signal: 'BUY', confidence: 0.8 };
      if (ret1d < -0.04) return { signal: 'BUY', confidence: 0.5 };
      // Take profit when price bounces back
      if (ret5d > 0.08) return { signal: 'SELL', confidence: 0.7 };
      if (ret5d > 0.04) return { signal: 'SELL', confidence: 0.4 };
      return { signal: 'HOLD', confidence: 0 };
    }

    // ═══════════════════════════════════
    // QUANT STRATEGIES
    // ═══════════════════════════════════

    case 'Kalman Filter': {
      // Recursive smoothed estimate: use EMA as proxy for Kalman state
      const e9 = indicators.ema9[idx];
      const e26 = indicators.ema26[idx];
      if (e9 === null || e26 === null) return { signal: 'HOLD', confidence: 0 };
      const signal = e9 - e26;
      const prevE9 = indicators.ema9[idx - 1];
      const prevE26 = indicators.ema26[idx - 1];
      if (!prevE9 || !prevE26) return { signal: 'HOLD', confidence: 0 };
      const prevSignal = prevE9 - prevE26;
      // Kalman crossover: signal changing sign
      if (signal > 0 && prevSignal <= 0) return { signal: 'BUY', confidence: 0.6 };
      if (signal < 0 && prevSignal >= 0) return { signal: 'SELL', confidence: 0.6 };
      // Trend continuation
      if (signal > 0 && signal > prevSignal) return { signal: 'BUY', confidence: 0.3 };
      if (signal < 0 && signal < prevSignal) return { signal: 'SELL', confidence: 0.3 };
      return { signal: 'HOLD', confidence: 0 };
    }

    case 'Machine Learning Alpha': {
      // Multi-feature model proxy: combines RSI + MA + Vol for signal
      const rsiVal = indicators.rsi[idx];
      const ma20 = indicators.sma20[idx];
      const vol = indicators.vol[idx];
      if (rsiVal === null || ma20 === null || vol === null) return { signal: 'HOLD', confidence: 0 };
      const priceSignal = (c.c - ma20) / ma20;
      // Composite score from multiple features
      let score = 0;
      if (rsiVal < 30) score += 2;
      else if (rsiVal < 40) score += 1;
      else if (rsiVal > 70) score -= 2;
      else if (rsiVal > 60) score -= 1;
      if (priceSignal < -0.03) score += 1;
      if (priceSignal > 0.03) score -= 1;
      if (vol > 0.04) score += (priceSignal > 0 ? 1 : -1); // momentum in high vol
      if (score >= 2) return { signal: 'BUY', confidence: 0.7 };
      if (score <= -2) return { signal: 'SELL', confidence: 0.7 };
      if (score >= 1) return { signal: 'BUY', confidence: 0.4 };
      if (score <= -1) return { signal: 'SELL', confidence: 0.4 };
      return { signal: 'HOLD', confidence: 0 };
    }

    case 'Correlation Breakdown': {
      // Trade big moves as potential correlation breaks
      if (idx < 5) return { signal: 'HOLD', confidence: 0 };
      const ret5d = (c.c - candles[idx - 5].c) / candles[idx - 5].c;
      if (Math.abs(ret5d) > 0.10) return { signal: ret5d > 0 ? 'SELL' : 'BUY', confidence: 0.6 };
      return { signal: 'HOLD', confidence: 0 };
    }

    case 'Kelly Criterion': {
      // Full Kelly sizing: aggressive entry on high-confidence signals
      const rsiVal = indicators.rsi[idx];
      const ema12 = indicators.ema12[idx];
      const ema26 = indicators.ema26[idx];
      if (rsiVal === null || ema12 === null || ema26 === null) return { signal: 'HOLD', confidence: 0 };
      const momentum = ema12 - ema26;
      // Kelly bets big on strong signals
      if (rsiVal < 25 && momentum < 0) return { signal: 'BUY', confidence: 0.9 };
      if (rsiVal > 75 && momentum > 0) return { signal: 'SELL', confidence: 0.9 };
      if (rsiVal < 35) return { signal: 'BUY', confidence: 0.5 };
      if (rsiVal > 65) return { signal: 'SELL', confidence: 0.5 };
      return { signal: 'HOLD', confidence: 0 };
    }

    case 'Martingale': {
      // Double down on losses, recover with one win
      if (idx < 1) return { signal: 'HOLD', confidence: 0 };
      const dayLoss = (c.c - candles[idx - 1].c) / candles[idx - 1].c;
      if (dayLoss < -0.03) return { signal: 'BUY', confidence: 0.9 };
      if (dayLoss > 0.02) return { signal: 'SELL', confidence: 0.3 };
      return { signal: 'HOLD', confidence: 0 };
    }

    case 'Relative Value': {
      // Trade mispricings between price and its "fair value" (SMA)
      const ma20 = indicators.sma20[idx];
      const ma50 = indicators.sma50[idx];
      if (ma20 === null || ma50 === null) return { signal: 'HOLD', confidence: 0 };
      const shortDev = (c.c - ma20) / ma20;
      const longDev = (c.c - ma50) / ma50;
      // Price below both MAs = undervalued
      if (shortDev < -0.02 && longDev < -0.03) return { signal: 'BUY', confidence: 0.6 };
      if (shortDev > 0.02 && longDev > 0.03) return { signal: 'SELL', confidence: 0.6 };
      return { signal: 'HOLD', confidence: 0 };
    }

    case 'Scalping': {
      // Quick in-and-out on small moves
      if (idx < 1) return { signal: 'HOLD', confidence: 0 };
      const change = (c.c - candles[idx - 1].c) / candles[idx - 1].c;
      if (change < -0.008) return { signal: 'BUY', confidence: 0.4 };
      if (change > 0.008) return { signal: 'SELL', confidence: 0.4 };
      return { signal: 'HOLD', confidence: 0 };
    }

    case 'Swing Trading': {
      // 5-day momentum with RSI confirmation
      if (idx < 5) return { signal: 'HOLD', confidence: 0 };
      const ret5d = (c.c - candles[idx - 5].c) / candles[idx - 5].c;
      const rsiVal = indicators.rsi[idx];
      if (ret5d < -0.05 && rsiVal && rsiVal < 40) return { signal: 'BUY', confidence: 0.6 };
      if (ret5d > 0.05 && rsiVal && rsiVal > 60) return { signal: 'SELL', confidence: 0.6 };
      return { signal: 'HOLD', confidence: 0 };
    }

    case 'Position Trading': {
      // Long-term trend following
      const ma50 = indicators.sma50[idx];
      if (ma50 === null) return { signal: 'HOLD', confidence: 0 };
      if (c.c > ma50 * 1.02) return { signal: 'BUY', confidence: 0.4 };
      if (c.c < ma50 * 0.98) return { signal: 'SELL', confidence: 0.4 };
      return { signal: 'HOLD', confidence: 0 };
    }

    case 'Basis Trading': {
      // Buys when spot is at discount to "fair value" (below SMA), sells at premium
      // Conservative, small positions, frequent mean-reversion entries
      const ma20 = indicators.sma20[idx];
      const e9 = indicators.ema9[idx];
      if (ma20 === null || e9 === null) return { signal: 'HOLD', confidence: 0 };
      const dev = (c.c - ma20) / ma20;
      // Buy when spot is discounted below moving average
      if (dev < -0.02) return { signal: 'BUY', confidence: 0.35 };
      // Sell when spot is at premium above moving average
      if (dev > 0.02) return { signal: 'SELL', confidence: 0.35 };
      return { signal: 'HOLD', confidence: 0 };
    }

    case 'Delta Neutral': {
      // Very conservative — tiny positions, quick mean-reversion at extremes only
      const rsiVal = indicators.rsi[idx];
      const ma20 = indicators.sma20[idx];
      if (rsiVal === null || ma20 === null) return { signal: 'HOLD', confidence: 0 };
      // Only enter at RSI extremes with very low confidence (= tiny position)
      if (rsiVal < 28) return { signal: 'BUY', confidence: 0.2 };
      if (rsiVal > 72) return { signal: 'SELL', confidence: 0.2 };
      return { signal: 'HOLD', confidence: 0 };
    }

    default:
      return { signal: 'HOLD', confidence: 0 };
  }
}

// ─── Backtest Engine v2 ───────────────────────────────────────
function backtestAgent(agent, allPriceData) {
  let cash = INITIAL_CAPITAL;
  const positions = {};
  let totalTrades = 0, wins = 0, losses = 0;
  let peakValue = INITIAL_CAPITAL;
  let maxDrawdown = 0;

  // Pre-compute indicators for all tokens
  const tokenData = {};
  for (const token of agent.tokens) {
    const candles = allPriceData[token];
    if (!candles || candles.length < 30) continue;
    const closes = candles.map(x => x.c);
    tokenData[token] = {
      candles,
      indicators: {
        sma20: sma(closes, 20),
        sma26: sma(closes, 26),
        sma50: sma(closes, 50),
        ema9: ema(closes, 9),
        ema12: ema(closes, 12),
        ema20: ema(closes, 20),
        ema26: ema(closes, 26),
        rsi: rsi(closes, 14),
        bb: bollingerBands(closes, 20, 2),
        vol: volatility(closes, 14),
        atr: atr(candles, 14),
      }
    };
    positions[token] = { qty: 0, avgCost: 0, peakPrice: 0 };
  }

  const validTokens = Object.keys(tokenData);
  if (validTokens.length === 0) {
    return {
      id: agent.id, name: agent.name, strategy: agent.strategy, strategy2: agent.strategy2,
      strategyCat: agent.strategyCat, strategyRisk: agent.strategyRisk, horizon: agent.horizon,
      riskStyle: agent.riskStyle, aggression: agent.aggression, tokens: agent.tokens,
      initialCapital: INITIAL_CAPITAL, finalValue: INITIAL_CAPITAL, returnPct: 0,
      totalTrades: 0, wins: 0, losses: 0, winRate: 0, maxDrawdown: 0, trades: 0,
    };
  }

  const maxDays = Math.max(...validTokens.map(t => tokenData[t].candles.length));

  for (let i = 20; i < maxDays; i++) {
      // ── Stop loss check (before signals) ──
      for (const token of validTokens) {
        if (i >= tokenData[token].candles.length) continue;
        const pos = positions[token];
        if (pos.qty <= 0) continue;
        const price = tokenData[token].candles[i].c;
        const unrealizedPnl = (price - pos.avgCost) / pos.avgCost;
        pos.peakPrice = Math.max(pos.peakPrice, price);
        const fromPeak = (price - pos.peakPrice) / pos.peakPrice;

        let stopHit = false;
        switch (agent.riskStyle) {
          case 'Trailing Stops': stopHit = fromPeak < -0.08; break;
          case 'Conservative': stopHit = unrealizedPnl < -0.10; break;
          case 'Fixed Fractional': stopHit = unrealizedPnl < -0.15; break;
          default: stopHit = unrealizedPnl < -0.25; break;
        }

        if (stopHit) {
          const ep = price * (1 - SLIPPAGE - TRADE_FEE);
          const proceeds = pos.qty * ep;
          if (proceeds > pos.qty * pos.avgCost) wins++; else losses++;
          cash += proceeds;
          totalTrades++;
          pos.qty = 0; pos.avgCost = 0; pos.peakPrice = 0;
        }
      }

      // ── Process signals for each token ──
      for (const token of validTokens) {
        if (i >= tokenData[token].candles.length) continue;
        const { candles, indicators } = tokenData[token];
        const price = candles[i].c;

        const sig1 = strategySignal(agent.strategy, candles, i, indicators, agent);
        const sig2 = strategySignal(agent.strategy2, candles, i, indicators, agent);

        let finalSignal = sig1.signal;
        let confidence = sig1.confidence;

        if (sig2.signal === sig1.signal && sig2.confidence > 0) {
          confidence = Math.min(confidence + sig2.confidence * 0.3, 1);
        } else if (sig2.signal !== 'HOLD' && sig2.signal !== sig1.signal) {
          confidence *= 0.6;
        }
        if (confidence < 0.2) finalSignal = 'HOLD';

        // Trend filter: block BUY in downtrends for applicable strategies
        if (TREND_FILTERED.has(agent.strategy) && finalSignal === 'BUY') {
          if (!isUptrend(indicators, i)) finalSignal = 'HOLD';
        }

        // Portfolio value using CURRENT prices
        const portfolioValue = cash + validTokens.reduce((sum, t) => {
          const cp = tokenData[t].candles[Math.min(i, tokenData[t].candles.length - 1)]?.c || 0;
          return sum + positions[t].qty * cp;
        }, 0);

        // Drawdown-based position reduction
        const ddRatio = portfolioValue / peakValue;
        const ddMult = ddRatio < 0.7 ? 0.25 : ddRatio < 0.85 ? 0.5 : 1.0;

        if (finalSignal === 'BUY' && cash > 10) {
          const posSize = getPositionSize(agent, portfolioValue) * confidence * ddMult;
          const amt = Math.min(posSize, cash * 0.9);
          if (amt < 5) continue;
          const ep = price * (1 + SLIPPAGE + TRADE_FEE);
          const qty = amt / ep;
          const pos = positions[token];
          const totalQty = pos.qty + qty;
          pos.avgCost = (pos.avgCost * pos.qty + ep * qty) / totalQty;
          pos.qty = totalQty;
          pos.peakPrice = Math.max(pos.peakPrice || price, price);
          cash -= amt;
          totalTrades++;
        } else if (finalSignal === 'SELL' && positions[token].qty > 0) {
          const pos = positions[token];
          const sellPct = confidence >= 0.9 ? 1.0 : Math.min(confidence, 0.8);
          const sellQty = pos.qty * sellPct;
          if (sellQty * price < 5) continue;
          const ep = price * (1 - SLIPPAGE - TRADE_FEE);
          const proceeds = sellQty * ep;
          const costBasis = sellQty * pos.avgCost;
          if (proceeds > costBasis) wins++; else losses++;
          pos.qty -= sellQty;
          if (pos.qty < 0.0001) { pos.qty = 0; pos.avgCost = 0; pos.peakPrice = 0; }
          cash += proceeds;
          totalTrades++;
        }
      }

    // Track drawdown
    const currentValue = cash + validTokens.reduce((sum, t) => {
      const cp = tokenData[t].candles[Math.min(i, tokenData[t].candles.length - 1)]?.c || 0;
      return sum + positions[t].qty * cp;
    }, 0);
    peakValue = Math.max(peakValue, currentValue);
    const dd = (peakValue - currentValue) / peakValue;
    maxDrawdown = Math.max(maxDrawdown, dd);
  }

  const finalValue = cash + validTokens.reduce((sum, token) => {
    const lastPrice = tokenData[token].candles[tokenData[token].candles.length - 1]?.c || 0;
    return sum + positions[token].qty * lastPrice;
  }, 0);

  const returnPct = ((finalValue - INITIAL_CAPITAL) / INITIAL_CAPITAL) * 100;
  const winRate = totalTrades > 0 ? (wins / Math.max(wins + losses, 1)) * 100 : 0;

  return {
    id: agent.id, name: agent.name, strategy: agent.strategy, strategy2: agent.strategy2,
    strategyCat: agent.strategyCat, strategyRisk: agent.strategyRisk, horizon: agent.horizon,
    riskStyle: agent.riskStyle, aggression: agent.aggression, tokens: agent.tokens,
    initialCapital: INITIAL_CAPITAL,
    finalValue: Math.round(finalValue * 100) / 100,
    returnPct: Math.round(returnPct * 100) / 100,
    totalTrades, wins, losses,
    winRate: Math.round(winRate * 100) / 100,
    maxDrawdown: Math.round(maxDrawdown * 10000) / 100,
    trades: totalTrades,
  };
}

// ─── Main ─────────────────────────────────────────────────────
async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  THE HIVE BACKTESTER');
  console.log('  10,000 bees / $1,000 each / Real price data');
  console.log('═══════════════════════════════════════════════════\n');

  // Load price data
  const dataFile = path.join(DATA_DIR, '_all.json');
  if (!fs.existsSync(dataFile)) {
    console.error('No price data found. Run `node fetch-data.js` first.');
    process.exit(1);
  }
  const allPriceData = JSON.parse(fs.readFileSync(dataFile, 'utf8'));

  // Show data summary
  for (const [token, candles] of Object.entries(allPriceData)) {
    const first = candles[0], last = candles[candles.length - 1];
    const ret = ((last.c - first.c) / first.c * 100).toFixed(1);
    console.log(`  ${token}: ${candles.length} days | $${first.c.toFixed(4)} -> $${last.c.toFixed(4)} (${ret}%)`);
  }
  console.log('');

  // Run backtest for all agents
  console.log('Running backtest on 10,000 bees...');
  const startTime = Date.now();
  const results = [];

  for (let i = 0; i < TOTAL_AGENTS; i++) {
    if (i % 1000 === 0 && i > 0) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`  Processed ${i.toLocaleString()} bees (${elapsed}s)`);
    }
    const agent = generateAgent(i);
    const result = backtestAgent(agent, allPriceData);
    results.push(result);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`  Completed all ${TOTAL_AGENTS.toLocaleString()} bees in ${elapsed}s\n`);

  // ─── Analysis ─────────────────────────────────────────
  results.sort((a, b) => b.returnPct - a.returnPct);

  const profitable = results.filter(r => r.returnPct > 0);
  const unprofitable = results.filter(r => r.returnPct <= 0);
  const avgReturn = results.reduce((s, r) => s + r.returnPct, 0) / results.length;
  const medianReturn = results[Math.floor(results.length / 2)].returnPct;
  const totalFinalValue = results.reduce((s, r) => s + r.finalValue, 0);
  const avgTrades = results.reduce((s, r) => s + r.totalTrades, 0) / results.length;
  const avgWinRate = results.filter(r => r.totalTrades > 0).reduce((s, r) => s + r.winRate, 0) / results.filter(r => r.totalTrades > 0).length;
  const avgDrawdown = results.reduce((s, r) => s + r.maxDrawdown, 0) / results.length;

  // By strategy
  const byStrategy = {};
  results.forEach(r => {
    if (!byStrategy[r.strategy]) byStrategy[r.strategy] = [];
    byStrategy[r.strategy].push(r);
  });
  const stratPerformance = Object.entries(byStrategy).map(([name, agents]) => ({
    name,
    count: agents.length,
    avgReturn: agents.reduce((s, a) => s + a.returnPct, 0) / agents.length,
    medReturn: agents.sort((a, b) => a.returnPct - b.returnPct)[Math.floor(agents.length / 2)]?.returnPct || 0,
    winRate: agents.filter(a => a.totalTrades > 0).reduce((s, a) => s + a.winRate, 0) / Math.max(agents.filter(a => a.totalTrades > 0).length, 1),
    profitable: agents.filter(a => a.returnPct > 0).length,
    avgDrawdown: agents.reduce((s, a) => s + a.maxDrawdown, 0) / agents.length,
    risk: STRATEGIES.find(s => s.name === name)?.risk || 'MED',
    cat: STRATEGIES.find(s => s.name === name)?.cat || '?',
  })).sort((a, b) => b.avgReturn - a.avgReturn);

  // By category
  const byCat = {};
  results.forEach(r => {
    if (!byCat[r.strategyCat]) byCat[r.strategyCat] = [];
    byCat[r.strategyCat].push(r);
  });
  const catPerformance = Object.entries(byCat).map(([cat, agents]) => ({
    cat,
    count: agents.length,
    avgReturn: agents.reduce((s, a) => s + a.returnPct, 0) / agents.length,
    profitable: agents.filter(a => a.returnPct > 0).length,
  })).sort((a, b) => b.avgReturn - a.avgReturn);

  // By risk level
  const byRisk = {};
  results.forEach(r => {
    if (!byRisk[r.strategyRisk]) byRisk[r.strategyRisk] = [];
    byRisk[r.strategyRisk].push(r);
  });
  const riskPerformance = Object.entries(byRisk).map(([risk, agents]) => ({
    risk,
    count: agents.length,
    avgReturn: agents.reduce((s, a) => s + a.returnPct, 0) / agents.length,
    avgDrawdown: agents.reduce((s, a) => s + a.maxDrawdown, 0) / agents.length,
    profitable: agents.filter(a => a.returnPct > 0).length,
  })).sort((a, b) => b.avgReturn - a.avgReturn);

  // By aggression
  const byAggression = {};
  results.forEach(r => {
    if (!byAggression[r.aggression]) byAggression[r.aggression] = [];
    byAggression[r.aggression].push(r);
  });
  const aggrPerformance = Object.entries(byAggression).map(([aggr, agents]) => ({
    aggr,
    count: agents.length,
    avgReturn: agents.reduce((s, a) => s + a.returnPct, 0) / agents.length,
    profitable: agents.filter(a => a.returnPct > 0).length,
  })).sort((a, b) => b.avgReturn - a.avgReturn);

  // ─── Console Output ───────────────────────────────────
  console.log('═══════════════════════════════════════════════════');
  console.log('  RESULTS SUMMARY');
  console.log('═══════════════════════════════════════════════════\n');
  console.log(`  Total Bees:       ${TOTAL_AGENTS.toLocaleString()}`);
  console.log(`  Initial Capital:  $${(TOTAL_AGENTS * INITIAL_CAPITAL).toLocaleString()}`);
  console.log(`  Final Value:      $${Math.round(totalFinalValue).toLocaleString()}`);
  console.log(`  Avg Return:       ${avgReturn.toFixed(2)}%`);
  console.log(`  Median Return:    ${medianReturn.toFixed(2)}%`);
  console.log(`  Profitable:       ${profitable.length} (${(profitable.length / TOTAL_AGENTS * 100).toFixed(1)}%)`);
  console.log(`  Unprofitable:     ${unprofitable.length} (${(unprofitable.length / TOTAL_AGENTS * 100).toFixed(1)}%)`);
  console.log(`  Avg Trades:       ${avgTrades.toFixed(1)}`);
  console.log(`  Avg Win Rate:     ${avgWinRate.toFixed(1)}%`);
  console.log(`  Avg Max Drawdown: ${avgDrawdown.toFixed(1)}%\n`);

  console.log('  TOP 10 BEES:');
  results.slice(0, 10).forEach((r, i) => {
    console.log(`    ${i + 1}. ${r.name} #${r.id} | ${r.strategy} | ${r.returnPct > 0 ? '+' : ''}${r.returnPct.toFixed(1)}% | $${r.finalValue.toFixed(0)} | ${r.totalTrades} trades`);
  });

  console.log('\n  BOTTOM 5 BEES:');
  results.slice(-5).forEach((r, i) => {
    console.log(`    ${TOTAL_AGENTS - 4 + i}. ${r.name} #${r.id} | ${r.strategy} | ${r.returnPct.toFixed(1)}% | $${r.finalValue.toFixed(0)}`);
  });

  console.log('\n  TOP STRATEGIES:');
  stratPerformance.slice(0, 10).forEach((s, i) => {
    console.log(`    ${i + 1}. ${s.name} (${s.cat}/${s.risk}) | avg ${s.avgReturn > 0 ? '+' : ''}${s.avgReturn.toFixed(1)}% | ${s.profitable}/${s.count} profitable | WR ${s.winRate.toFixed(0)}%`);
  });

  console.log('\n  WORST STRATEGIES:');
  stratPerformance.slice(-5).forEach((s, i) => {
    console.log(`    ${stratPerformance.length - 4 + i}. ${s.name} (${s.cat}/${s.risk}) | avg ${s.avgReturn.toFixed(1)}% | ${s.profitable}/${s.count} profitable`);
  });

  // ─── Write Obsidian Report ────────────────────────────
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  const dataRange = Object.values(allPriceData)[0];
  const startDate = dataRange[0]?.date || '?';
  const endDate = dataRange[dataRange.length - 1]?.date || '?';

  let md = `# The Hive Backtest Report\n`;
  md += `**Date:** ${dateStr}\n`;
  md += `**Data Period:** ${startDate} to ${endDate} (~${dataRange.length} days)\n`;
  md += `**Bees:** ${TOTAL_AGENTS.toLocaleString()} | **Starting Capital:** $${INITIAL_CAPITAL.toLocaleString()} each\n\n`;
  md += `---\n\n`;

  md += `## Market Context\n\n`;
  md += `| Token | Start | End | Return |\n|-------|-------|-----|--------|\n`;
  for (const [token, candles] of Object.entries(allPriceData)) {
    const first = candles[0], last = candles[candles.length - 1];
    const ret = ((last.c - first.c) / first.c * 100).toFixed(1);
    md += `| ${token} | $${first.c.toFixed(4)} | $${last.c.toFixed(4)} | ${ret}% |\n`;
  }
  md += `\n`;

  md += `## Overall Results\n\n`;
  md += `| Metric | Value |\n|--------|-------|\n`;
  md += `| Total Capital Deployed | $${(TOTAL_AGENTS * INITIAL_CAPITAL).toLocaleString()} |\n`;
  md += `| Final Portfolio Value | $${Math.round(totalFinalValue).toLocaleString()} |\n`;
  md += `| Net P&L | $${Math.round(totalFinalValue - TOTAL_AGENTS * INITIAL_CAPITAL).toLocaleString()} |\n`;
  md += `| Average Return | ${avgReturn.toFixed(2)}% |\n`;
  md += `| Median Return | ${medianReturn.toFixed(2)}% |\n`;
  md += `| Profitable Bees | ${profitable.length} (${(profitable.length / TOTAL_AGENTS * 100).toFixed(1)}%) |\n`;
  md += `| Avg Trades per Bee | ${avgTrades.toFixed(1)} |\n`;
  md += `| Avg Win Rate | ${avgWinRate.toFixed(1)}% |\n`;
  md += `| Avg Max Drawdown | ${avgDrawdown.toFixed(1)}% |\n`;
  md += `\n`;

  md += `## Top 20 Bees\n\n`;
  md += `| Rank | Bee | Strategy | Return | Final $ | Trades | Win Rate | Max DD |\n`;
  md += `|------|-----|----------|--------|---------|--------|----------|--------|\n`;
  results.slice(0, 20).forEach((r, i) => {
    md += `| ${i + 1} | ${r.name} #${r.id} | ${r.strategy} | ${r.returnPct > 0 ? '+' : ''}${r.returnPct.toFixed(1)}% | $${r.finalValue.toFixed(0)} | ${r.totalTrades} | ${r.winRate.toFixed(0)}% | ${r.maxDrawdown.toFixed(1)}% |\n`;
  });
  md += `\n`;

  md += `## Bottom 10 Bees\n\n`;
  md += `| Rank | Bee | Strategy | Return | Final $ | Trades | Aggression |\n`;
  md += `|------|-----|----------|--------|---------|--------|------------|\n`;
  results.slice(-10).forEach((r, i) => {
    md += `| ${TOTAL_AGENTS - 9 + i} | ${r.name} #${r.id} | ${r.strategy} | ${r.returnPct.toFixed(1)}% | $${r.finalValue.toFixed(0)} | ${r.totalTrades} | ${r.aggression} |\n`;
  });
  md += `\n`;

  md += `## Strategy Performance Rankings\n\n`;
  md += `| Rank | Strategy | Category | Risk | Avg Return | Med Return | Win Rate | Profitable | Avg DD |\n`;
  md += `|------|----------|----------|------|------------|------------|----------|------------|--------|\n`;
  stratPerformance.forEach((s, i) => {
    md += `| ${i + 1} | ${s.name} | ${s.cat} | ${s.risk} | ${s.avgReturn > 0 ? '+' : ''}${s.avgReturn.toFixed(2)}% | ${s.medReturn > 0 ? '+' : ''}${s.medReturn.toFixed(2)}% | ${s.winRate.toFixed(0)}% | ${s.profitable}/${s.count} | ${s.avgDrawdown.toFixed(1)}% |\n`;
  });
  md += `\n`;

  md += `## Performance by Category\n\n`;
  md += `| Category | Bees | Avg Return | Profitable |\n`;
  md += `|----------|------|------------|------------|\n`;
  catPerformance.forEach(c => {
    md += `| ${c.cat} | ${c.count} | ${c.avgReturn > 0 ? '+' : ''}${c.avgReturn.toFixed(2)}% | ${c.profitable}/${c.count} (${(c.profitable / c.count * 100).toFixed(0)}%) |\n`;
  });
  md += `\n`;

  md += `## Performance by Risk Level\n\n`;
  md += `| Risk | Bees | Avg Return | Avg DD | Profitable |\n`;
  md += `|------|------|------------|--------|------------|\n`;
  riskPerformance.forEach(r => {
    md += `| ${r.risk} | ${r.count} | ${r.avgReturn > 0 ? '+' : ''}${r.avgReturn.toFixed(2)}% | ${r.avgDrawdown.toFixed(1)}% | ${r.profitable}/${r.count} (${(r.profitable / r.count * 100).toFixed(0)}%) |\n`;
  });
  md += `\n`;

  md += `## Performance by Aggression\n\n`;
  md += `| Aggression | Bees | Avg Return | Profitable |\n`;
  md += `|------------|------|------------|------------|\n`;
  aggrPerformance.forEach(a => {
    md += `| ${a.aggr} | ${a.count} | ${a.avgReturn > 0 ? '+' : ''}${a.avgReturn.toFixed(2)}% | ${a.profitable}/${a.count} (${(a.profitable / a.count * 100).toFixed(0)}%) |\n`;
  });
  md += `\n`;

  md += `---\n\n`;
  md += `## Key Findings\n\n`;

  // Auto-generate findings
  const bestStrat = stratPerformance[0];
  const worstStrat = stratPerformance[stratPerformance.length - 1];
  const bestCat = catPerformance[0];
  const worstCat = catPerformance[catPerformance.length - 1];
  const bestRisk = riskPerformance[0];

  md += `### What Worked\n`;
  md += `- **Best strategy:** ${bestStrat.name} (${bestStrat.cat}) with avg ${bestStrat.avgReturn > 0 ? '+' : ''}${bestStrat.avgReturn.toFixed(2)}% return and ${bestStrat.winRate.toFixed(0)}% win rate\n`;
  md += `- **Best category:** ${bestCat.cat} strategies averaged ${bestCat.avgReturn > 0 ? '+' : ''}${bestCat.avgReturn.toFixed(2)}% returns\n`;
  md += `- **Best risk level:** ${bestRisk.risk}-risk strategies averaged ${bestRisk.avgReturn > 0 ? '+' : ''}${bestRisk.avgReturn.toFixed(2)}% returns\n`;
  md += `- **Top performing bee:** ${results[0].name} #${results[0].id} returned ${results[0].returnPct > 0 ? '+' : ''}${results[0].returnPct.toFixed(1)}% ($${INITIAL_CAPITAL} -> $${results[0].finalValue.toFixed(0)})\n`;
  md += `\n`;

  md += `### What Didn't Work\n`;
  md += `- **Worst strategy:** ${worstStrat.name} (${worstStrat.cat}) with avg ${worstStrat.avgReturn.toFixed(2)}% return\n`;
  md += `- **Worst category:** ${worstCat.cat} strategies averaged ${worstCat.avgReturn.toFixed(2)}% returns\n`;
  md += `- **Worst performing bee:** ${results[results.length - 1].name} #${results[results.length - 1].id} lost ${Math.abs(results[results.length - 1].returnPct).toFixed(1)}%\n`;
  md += `\n`;

  md += `### Insights\n`;
  md += `- ${profitable.length} out of ${TOTAL_AGENTS.toLocaleString()} bees (${(profitable.length / TOTAL_AGENTS * 100).toFixed(1)}%) were profitable\n`;
  md += `- Median return of ${medianReturn.toFixed(2)}% suggests the ${medianReturn >= 0 ? 'majority can generate positive returns' : 'majority struggle to beat holding cash'}\n`;
  md += `- Average max drawdown of ${avgDrawdown.toFixed(1)}% shows ${avgDrawdown < 15 ? 'reasonable risk management across bees' : 'significant drawdown risk exists'}\n`;
  md += `- Average of ${avgTrades.toFixed(0)} trades per bee over ~${dataRange.length} days = ~${(avgTrades / dataRange.length).toFixed(1)} trades/day\n`;

  const degen = byRisk['DEGEN'] || [];
  const low = byRisk['LOW'] || [];
  if (degen.length && low.length) {
    const degenAvg = degen.reduce((s, r) => s + r.returnPct, 0) / degen.length;
    const lowAvg = low.reduce((s, r) => s + r.returnPct, 0) / low.length;
    md += `- DEGEN vs LOW risk: DEGEN bees averaged ${degenAvg.toFixed(2)}% vs LOW at ${lowAvg.toFixed(2)}% -- ${Math.abs(degenAvg) > Math.abs(lowAvg) ? 'higher risk led to more extreme outcomes' : 'conservative approaches held up better'}\n`;
  }
  md += `\n`;

  md += `### Methodology Notes\n`;
  md += `- All bees start with $${INITIAL_CAPITAL.toLocaleString()} paper money\n`;
  md += `- Trade fees: ${TRADE_FEE * 100}% per trade + ${SLIPPAGE * 100}% slippage\n`;
  md += `- Max position size: ${MAX_POSITION_PCT * 100}% of portfolio\n`;
  md += `- 45 pure quantitative trading strategies across 7 categories\n`;
  md += `- Bees use dual strategies (primary + secondary) blended by confidence\n`;
  md += `- Position sizing varies by aggression level and risk management style\n`;
  md += `- Historical data from Binance (daily OHLCV with proper O/H/L/C)\n`;
  md += `- No look-ahead bias: bees only see data up to current candle\n`;

  // Write to Obsidian
  const obsidianFile = path.join(OBSIDIAN_DIR, `The Hive Backtest - ${dateStr}.md`);
  try {
    fs.writeFileSync(obsidianFile, md);
    console.log(`\nReport saved to Obsidian: ${obsidianFile}`);
  } catch (e) {
    console.log(`\nCould not write to Obsidian (${e.message})`);
  }

  // Also save report locally
  const reportFile = path.join(DATA_DIR, 'report.md');
  fs.writeFileSync(reportFile, md);
  console.log(`Report saved locally: ${reportFile}`);

  // Also save raw results
  const rawFile = path.join(DATA_DIR, 'results.json');
  fs.writeFileSync(rawFile, JSON.stringify({
    meta: { date: dateStr, startDate, endDate, totalAgents: TOTAL_AGENTS, initialCapital: INITIAL_CAPITAL },
    summary: { avgReturn, medianReturn, totalFinalValue, profitable: profitable.length, avgTrades, avgWinRate, avgDrawdown },
    strategyRankings: stratPerformance,
    categoryRankings: catPerformance,
    riskRankings: riskPerformance,
    aggressionRankings: aggrPerformance,
    top50: results.slice(0, 50),
    bottom20: results.slice(-20),
  }, null, 2));
  console.log(`Raw data saved to: ${rawFile}`);
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
