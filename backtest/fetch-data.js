// Fetch historical OHLCV data from Binance (free, no API key required)
// Returns proper daily candles with distinct O, H, L, C values

const fs = require('fs');
const path = require('path');

const TOKENS = {
  SOL: { symbol: 'SOLUSDT' },
  BONK: { symbol: 'BONKUSDT' },
  WIF: { symbol: 'WIFUSDT' },
  JUP: { symbol: 'JUPUSDT' },
  JTO: { symbol: 'JTOUSDT' },
  RAY: { symbol: 'RAYUSDT' },
};

const CACHE_DIR = path.join(__dirname, 'data');

async function fetchWithRetry(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url);
      if (res.status === 429) {
        console.log('  Rate limited, waiting 30s...');
        await new Promise(r => setTimeout(r, 30000));
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      return await res.json();
    } catch (e) {
      if (i === retries - 1) throw e;
      console.log(`  Retry ${i + 1}/${retries}...`);
      await new Promise(r => setTimeout(r, 3000));
    }
  }
}

async function fetchToken(symbol, binanceSymbol) {
  const cacheFile = path.join(CACHE_DIR, `${symbol}.json`);

  if (fs.existsSync(cacheFile)) {
    const stat = fs.statSync(cacheFile);
    const ageHours = (Date.now() - stat.mtimeMs) / 3600000;
    if (ageHours < 12) {
      console.log(`  ${symbol}: Using cached data`);
      return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    }
  }

  console.log(`  ${symbol}: Fetching from Binance...`);

  const endTime = Date.now();
  const startTime = endTime - (365 * 24 * 60 * 60 * 1000);
  const url = `https://api.binance.com/api/v3/klines?symbol=${binanceSymbol}&interval=1d&startTime=${startTime}&endTime=${endTime}&limit=1000`;
  const data = await fetchWithRetry(url);

  // Binance kline: [openTime, open, high, low, close, volume, closeTime, quoteVol, trades, ...]
  const candles = data.map(k => {
    const date = new Date(k[0]).toISOString().split('T')[0];
    return {
      date,
      t: k[0],
      o: parseFloat(k[1]),
      h: parseFloat(k[2]),
      l: parseFloat(k[3]),
      c: parseFloat(k[4]),
      v: parseFloat(k[7]), // quote asset volume (USD)
    };
  });

  const degenerate = candles.filter(c => c.o === c.h && c.h === c.l && c.l === c.c).length;
  console.log(`  ${symbol}: ${candles.length} candles (${candles[0]?.date} to ${candles[candles.length-1]?.date}) | OHLCV quality: ${degenerate === 0 ? 'PERFECT' : degenerate + ' degenerate'}`);

  fs.writeFileSync(cacheFile, JSON.stringify(candles, null, 2));
  return candles;
}

async function main() {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

  console.log('Fetching 365 days of daily OHLCV from Binance...\n');

  const allData = {};
  const symbols = Object.keys(TOKENS);

  for (let i = 0; i < symbols.length; i++) {
    const sym = symbols[i];
    allData[sym] = await fetchToken(sym, TOKENS[sym].symbol);
    if (i < symbols.length - 1) {
      console.log('  Waiting 2s...');
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  const combinedFile = path.join(CACHE_DIR, '_all.json');
  fs.writeFileSync(combinedFile, JSON.stringify(allData, null, 2));

  console.log('\nAll data saved to backtest/data/');
  console.log('Tokens:', Object.keys(allData).join(', '));
  console.log('Run `node backtest.js` next to simulate agents.');
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
