require('dotenv').config();
const { Telegraf } = require('telegraf');
const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');

// ── Config ──────────────────────────────────────────────────────
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-5-20250929';
const MAX_HISTORY = parseInt(process.env.MAX_HISTORY || '20');

// ── Conversation Memory (per user) ─────────────────────────────
const conversations = new Map();

function getHistory(userId) {
  if (!conversations.has(userId)) conversations.set(userId, []);
  return conversations.get(userId);
}

function addMessage(userId, role, content) {
  const history = getHistory(userId);
  history.push({ role, content });
  while (history.length > MAX_HISTORY) history.shift();
}

// ── Load Agent Arena Backtest Data ──────────────────────────────
let backtestResults = null;
let arenaContext = '';

function loadArenaData() {
  try {
    const resultsPath = path.join(__dirname, 'data/results.json');
    backtestResults = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));

    const { meta, summary } = backtestResults;
    arenaContext = `
AGENT ARENA BACKTEST DATA (live from results.json):
- Period: ${meta.startDate} to ${meta.endDate} (~${meta.totalAgents ? '' : ''}365 days)
- Total Agents: ${meta.totalAgents.toLocaleString()}
- Starting Capital: $${meta.initialCapital.toLocaleString()} each
- Average Return: ${summary.avgReturn.toFixed(2)}%
- Median Return: ${summary.medianReturn.toFixed(2)}%
- Profitable: ${summary.profitable} / ${meta.totalAgents} (${(summary.profitable/meta.totalAgents*100).toFixed(1)}%)
- Avg Win Rate: ${summary.avgWinRate.toFixed(1)}%
- Avg Max Drawdown: ${summary.avgDrawdown.toFixed(1)}%

TOP 10 STRATEGIES:
${backtestResults.strategyRankings.slice(0, 10).map((s, i) =>
  `${i+1}. ${s.name} (${s.cat}/${s.risk}): avg ${s.avgReturn > 0 ? '+' : ''}${s.avgReturn.toFixed(2)}% | ${s.profitable}/${s.count} profitable | WR ${s.winRate.toFixed(0)}%`
).join('\n')}

WORST 5 STRATEGIES:
${backtestResults.strategyRankings.slice(-5).map((s, i) =>
  `${i+1}. ${s.name} (${s.cat}/${s.risk}): avg ${s.avgReturn.toFixed(2)}% | ${s.profitable}/${s.count} profitable`
).join('\n')}

TOP 10 AGENTS:
${backtestResults.top50.slice(0, 10).map((a, i) =>
  `${i+1}. ${a.name} #${a.id}: ${a.strategy} | ${a.returnPct > 0 ? '+' : ''}${a.returnPct.toFixed(1)}% | $${a.finalValue.toFixed(0)} | ${a.totalTrades} trades`
).join('\n')}

BOTTOM 5 AGENTS:
${backtestResults.bottom20.slice(-5).map((a, i) =>
  `${i+1}. ${a.name} #${a.id}: ${a.strategy} | ${a.returnPct.toFixed(1)}% | $${a.finalValue.toFixed(0)}`
).join('\n')}

PERFORMANCE BY CATEGORY:
${backtestResults.categoryRankings.map(c =>
  `- ${c.cat}: ${c.count} agents, avg ${c.avgReturn > 0 ? '+' : ''}${c.avgReturn.toFixed(2)}%, ${c.profitable}/${c.count} profitable`
).join('\n')}

PERFORMANCE BY RISK LEVEL:
${backtestResults.riskRankings.map(r =>
  `- ${r.risk}: ${r.count} agents, avg ${r.avgReturn > 0 ? '+' : ''}${r.avgReturn.toFixed(2)}%, DD ${r.avgDrawdown.toFixed(1)}%`
).join('\n')}`;

    console.log('Loaded backtest data successfully.');
  } catch (e) {
    console.log('No backtest data found. Bot will work without arena context.');
  }
}

loadArenaData();

const SYSTEM_PROMPT = `You are the Agent Arena AI assistant, deployed via Telegram. You are powered by Claude (Anthropic).

Agent Arena is a simulated trading competition with 10,000 procedurally generated AI agents trading on Solana.

Each agent has:
- A unique name (e.g., ATLAS_AI #1, TURBO_PRO #6020)
- A primary and secondary trading strategy (46 total strategies)
- A risk style (Kelly Criterion, Trailing Stops, Conservative, Fixed Fractional, Pyramiding, Anti-Martingale, Risk Parity)
- An aggression level (Ultra-Conservative, Conservative, Moderate, Aggressive, Degen)
- Preferred tokens: SOL, BONK, WIF, JUP, JTO, RAY
- $1,000 starting paper money

Strategy categories: Technical Analysis (TA), DeFi, Crypto Native, Quantitative, Alternative Data, Time-Based, Risk

The backtest uses real historical OHLCV data from Binance. Agents have stop losses, trend filters, and market-neutral strategies generate yield instead of taking directional bets.

${arenaContext}

Your communication style:
- Be concise and direct, like a trading terminal
- Use clean formatting for data (tables, lists)
- When asked about strategies or agents, reference the backtest data above
- You can also discuss general trading concepts, crypto markets, DeFi, and Solana ecosystem
- Keep responses under 4000 characters for Telegram`;

// ── Chat with Claude ────────────────────────────────────────────
async function chat(userId, message) {
  addMessage(userId, 'user', message);

  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: getHistory(userId),
    });

    const reply = response.content[0].text;
    addMessage(userId, 'assistant', reply);
    return reply;
  } catch (e) {
    console.error('Claude API error:', e.message);
    return `Error connecting to Claude: ${e.message}`;
  }
}

// ── Bot Commands ────────────────────────────────────────────────
bot.command('start', (ctx) => {
  conversations.delete(ctx.from.id.toString());
  ctx.reply(
`═══════════════════════════
  AGENT ARENA TERMINAL
═══════════════════════════

Welcome, operator.

I'm powered by Claude AI with full Agent Arena context.

/top - Top performing agents
/bottom - Worst performing agents
/strategies - Strategy rankings
/stats - Overall backtest statistics
/categories - Performance by category
/reset - Clear conversation history

Or just ask me anything about the 10,000 agents, their strategies, or trading in general.`
  );
});

bot.command('reset', (ctx) => {
  conversations.delete(ctx.from.id.toString());
  ctx.reply('Memory wiped. Fresh terminal.');
});

bot.command('top', (ctx) => {
  if (!backtestResults) return ctx.reply('No backtest data loaded.');
  const top = backtestResults.top50.slice(0, 10);
  let msg = '🏆 TOP 10 AGENTS\n\n';
  top.forEach((a, i) => {
    msg += `${i+1}. ${a.name} #${a.id}\n`;
    msg += `   ${a.strategy} | ${a.returnPct > 0 ? '+' : ''}${a.returnPct.toFixed(1)}% | $${a.finalValue.toFixed(0)} | ${a.totalTrades} trades\n\n`;
  });
  ctx.reply(msg);
});

bot.command('bottom', (ctx) => {
  if (!backtestResults) return ctx.reply('No backtest data loaded.');
  const bottom = backtestResults.bottom20.slice(-10);
  let msg = '📉 BOTTOM 10 AGENTS\n\n';
  bottom.forEach((a, i) => {
    msg += `${i+1}. ${a.name} #${a.id}\n`;
    msg += `   ${a.strategy} | ${a.returnPct.toFixed(1)}% | $${a.finalValue.toFixed(0)} | ${a.totalTrades} trades\n\n`;
  });
  ctx.reply(msg);
});

bot.command('strategies', (ctx) => {
  if (!backtestResults) return ctx.reply('No backtest data loaded.');
  const strats = backtestResults.strategyRankings;
  let msg = '📊 STRATEGY RANKINGS (46 strategies)\n\n';
  strats.slice(0, 15).forEach((s, i) => {
    const prefix = s.avgReturn > 0 ? '🟢' : '🔴';
    msg += `${prefix} ${i+1}. ${s.name} (${s.cat})\n`;
    msg += `   Avg: ${s.avgReturn > 0 ? '+' : ''}${s.avgReturn.toFixed(2)}% | ${s.profitable}/${s.count} profitable | WR ${s.winRate.toFixed(0)}%\n\n`;
  });
  msg += `... and ${strats.length - 15} more. Ask me about any strategy!`;
  ctx.reply(msg);
});

bot.command('stats', (ctx) => {
  if (!backtestResults) return ctx.reply('No backtest data loaded.');
  const { meta, summary } = backtestResults;
  ctx.reply(
`═══ BACKTEST STATS ═══

Period: ${meta.startDate} → ${meta.endDate}
Agents: ${meta.totalAgents.toLocaleString()}
Capital: $${(meta.totalAgents * meta.initialCapital).toLocaleString()}

Avg Return: ${summary.avgReturn.toFixed(2)}%
Median: ${summary.medianReturn.toFixed(2)}%
Profitable: ${summary.profitable} (${(summary.profitable/meta.totalAgents*100).toFixed(1)}%)
Avg Trades: ${summary.avgTrades.toFixed(0)}
Win Rate: ${summary.avgWinRate.toFixed(1)}%
Max Drawdown: ${summary.avgDrawdown.toFixed(1)}%

Final Value: $${Math.round(summary.totalFinalValue).toLocaleString()}
Net P&L: $${Math.round(summary.totalFinalValue - meta.totalAgents * meta.initialCapital).toLocaleString()}`
  );
});

bot.command('categories', (ctx) => {
  if (!backtestResults) return ctx.reply('No backtest data loaded.');
  let msg = '📁 PERFORMANCE BY CATEGORY\n\n';
  backtestResults.categoryRankings.forEach(c => {
    const prefix = c.avgReturn > 0 ? '🟢' : '🔴';
    msg += `${prefix} ${c.cat}: ${c.avgReturn > 0 ? '+' : ''}${c.avgReturn.toFixed(2)}% avg | ${c.profitable}/${c.count} profitable\n`;
  });
  msg += '\n📊 BY RISK LEVEL\n\n';
  backtestResults.riskRankings.forEach(r => {
    const prefix = r.avgReturn > 0 ? '🟢' : '🔴';
    msg += `${prefix} ${r.risk}: ${r.avgReturn > 0 ? '+' : ''}${r.avgReturn.toFixed(2)}% avg | DD ${r.avgDrawdown.toFixed(1)}%\n`;
  });
  ctx.reply(msg);
});

// ── Message Handler (natural language → Claude) ─────────────────
bot.on('text', async (ctx) => {
  const userId = ctx.from.id.toString();
  const message = ctx.message.text;

  ctx.sendChatAction('typing');

  const reply = await chat(userId, message);

  // Telegram has a 4096 char limit per message
  if (reply.length > 4000) {
    const chunks = reply.match(/.{1,4000}/gs);
    for (const chunk of chunks) {
      await ctx.reply(chunk);
    }
  } else {
    ctx.reply(reply);
  }
});

// ── Error Handling ──────────────────────────────────────────────
bot.catch((err, ctx) => {
  console.error('Bot error:', err);
  ctx.reply('System error. Try again.');
});

// ── Launch ──────────────────────────────────────────────────────
bot.launch();
console.log('Agent Arena Telegram bot is running...');
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
