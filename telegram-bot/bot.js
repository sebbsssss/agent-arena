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
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO || 'sebbsssss/agent-arena';

// ── GitHub API ──────────────────────────────────────────────────
async function ghAPI(endpoint, method = 'GET', body = null) {
  const opts = {
    method,
    headers: {
      'Authorization': `token ${GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'ArenaBot',
    },
  };
  if (body) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/${endpoint}`, opts);
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
  return res.json();
}

async function readFileFromGH(filePath) {
  const data = await ghAPI(`contents/${filePath}`);
  return Buffer.from(data.content, 'base64').toString('utf8');
}

async function writeFileToGH(filePath, content, message) {
  let sha;
  try {
    const existing = await ghAPI(`contents/${filePath}`);
    sha = existing.sha;
  } catch (e) { /* new file */ }

  const body = {
    message: message || `Update ${filePath} via Arena Bot`,
    content: Buffer.from(content).toString('base64'),
  };
  if (sha) body.sha = sha;
  return ghAPI(`contents/${filePath}`, 'PUT', body);
}

async function listFilesFromGH(dirPath = '') {
  const data = await ghAPI(`contents/${dirPath}`);
  return data.map(f => ({ name: f.name, type: f.type, path: f.path, size: f.size }));
}

// ── Claude Tools ────────────────────────────────────────────────
const TOOLS = [
  {
    name: 'read_file',
    description: 'Read a file from the codebase. For large files, use start_line/end_line to read specific sections.',
    input_schema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Path to the file (e.g. "index-v8.html", "backtest/backtest.js")' },
        start_line: { type: 'integer', description: 'Start line number (1-indexed). Omit to read from start.' },
        end_line: { type: 'integer', description: 'End line number (inclusive). Omit to read to end.' }
      },
      required: ['file_path']
    }
  },
  {
    name: 'search_replace',
    description: 'Find and replace text in a file. This is the PRIMARY way to edit files. The old_text must match exactly (including whitespace). Changes are committed to GitHub.',
    input_schema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Path to the file to edit' },
        old_text: { type: 'string', description: 'Exact text to find in the file (must be unique)' },
        new_text: { type: 'string', description: 'Text to replace it with' },
        commit_message: { type: 'string', description: 'Short description of the change' }
      },
      required: ['file_path', 'old_text', 'new_text', 'commit_message']
    }
  },
  {
    name: 'create_file',
    description: 'Create a new file or fully overwrite a small file (<200 lines). For editing existing files, use search_replace instead.',
    input_schema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Path for the new file' },
        content: { type: 'string', description: 'File content' },
        commit_message: { type: 'string', description: 'Short description' }
      },
      required: ['file_path', 'content', 'commit_message']
    }
  },
  {
    name: 'list_files',
    description: 'List files and directories in the codebase.',
    input_schema: {
      type: 'object',
      properties: {
        directory: { type: 'string', description: 'Directory path (empty string for root)', default: '' }
      },
      required: []
    }
  }
];

async function executeTool(name, input) {
  switch (name) {
    case 'read_file': {
      const content = await readFileFromGH(input.file_path);
      const lines = content.split('\n');
      const totalLines = lines.length;
      const start = Math.max(0, (input.start_line || 1) - 1);
      const end = input.end_line ? Math.min(input.end_line, totalLines) : totalLines;
      const slice = lines.slice(start, end);

      // Add line numbers and return
      const numbered = slice.map((l, i) => `${start + i + 1}: ${l}`).join('\n');
      const header = `File: ${input.file_path} (${totalLines} lines total, showing ${start+1}-${end})\n\n`;

      // Cap output to prevent context overflow
      if (numbered.length > 12000) {
        return header + numbered.substring(0, 12000) + `\n\n... [output truncated - use start_line/end_line to read sections]`;
      }
      return header + numbered;
    }
    case 'search_replace': {
      const content = await readFileFromGH(input.file_path);
      if (!content.includes(input.old_text)) {
        return `ERROR: old_text not found in ${input.file_path}. Make sure it matches exactly (including whitespace and indentation). Use read_file to see the exact content first.`;
      }
      const count = content.split(input.old_text).length - 1;
      if (count > 1) {
        return `ERROR: old_text matches ${count} locations in ${input.file_path}. Provide more surrounding context to make it unique.`;
      }
      const newContent = content.replace(input.old_text, input.new_text);
      await writeFileToGH(input.file_path, newContent, input.commit_message);

      // Also update web/index.html if editing index-v8.html
      if (input.file_path === 'index-v8.html') {
        try {
          const webContent = await readFileFromGH('web/index.html');
          if (webContent.includes(input.old_text)) {
            const newWebContent = webContent.replace(input.old_text, input.new_text);
            await writeFileToGH('web/index.html', newWebContent, input.commit_message + ' (web copy)');
          }
        } catch (e) { /* web copy may not exist */ }
      }

      return `Done! Committed to ${input.file_path}: "${input.commit_message}"`;
    }
    case 'create_file': {
      await writeFileToGH(input.file_path, input.content, input.commit_message);
      return `Created ${input.file_path}: "${input.commit_message}"`;
    }
    case 'list_files': {
      const files = await listFilesFromGH(input.directory || '');
      return files.map(f => `${f.type === 'dir' ? '📁' : '📄'} ${f.path}${f.size ? ` (${f.size}b)` : ''}`).join('\n');
    }
    default:
      return 'Unknown tool';
  }
}

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

// ── Load Backtest Data ──────────────────────────────────────────
let backtestResults = null;
let arenaContext = '';

function loadArenaData() {
  try {
    const resultsPath = path.join(__dirname, 'data/results.json');
    backtestResults = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
    const { meta, summary } = backtestResults;
    arenaContext = `
BACKTEST DATA (${meta.startDate} to ${meta.endDate}):
- ${meta.totalAgents} agents, $${meta.initialCapital} each
- Avg Return: ${summary.avgReturn.toFixed(2)}% | Profitable: ${summary.profitable}/${meta.totalAgents}
- Top strategies: ${backtestResults.strategyRankings.slice(0,5).map(s => `${s.name}(${s.avgReturn>0?'+':''}${s.avgReturn.toFixed(1)}%)`).join(', ')}
- Top agents: ${backtestResults.top50.slice(0,3).map(a => `${a.name}#${a.id}(${a.returnPct>0?'+':''}${a.returnPct.toFixed(1)}%)`).join(', ')}`;
    console.log('Loaded backtest data.');
  } catch (e) {
    console.log('No backtest data found.');
  }
}
loadArenaData();

const SYSTEM_PROMPT = `You are the Agent Arena AI assistant on Telegram, powered by Claude.

Agent Arena is a simulated trading competition with 10,000 AI agents on Solana. You have FULL ACCESS to the codebase via GitHub tools.

YOU CAN:
- Read any file in the repo (read_file) - use start_line/end_line for large files
- Edit files via find-and-replace (search_replace) - changes auto-commit to GitHub
- Create new small files (create_file)
- List directory contents (list_files)

Key files:
- index-v8.html: The main frontend (single-file HTML/CSS/JS app, ~1500 lines - ALWAYS use start_line/end_line)
- backtest/backtest.js: Backtesting engine (strategies, indicators, simulation)
- backtest/fetch-data.js: Price data fetcher (Binance API)
- web/index.html: Auto-synced copy of frontend (updated automatically when you edit index-v8.html)

When asked to make changes:
1. First read_file with start_line/end_line to see the specific section you need to edit
2. Use search_replace with the exact text you want to change and the replacement
3. web/index.html is auto-synced when you edit index-v8.html - no need to edit both

IMPORTANT RULES:
- NEVER try to read an entire large file (>200 lines). Always use start_line/end_line.
- For search_replace, the old_text must match EXACTLY including whitespace.
- Keep each edit small and focused. Do multiple small search_replace calls rather than one huge one.

GitHub repo: ${GITHUB_REPO}
Live site: https://arena-web-production-ce34.up.railway.app
${arenaContext}

Style: Concise, terminal-like. Keep responses under 4000 chars for Telegram.`;

// ── Chat with Claude (tool use loop) ────────────────────────────
async function chat(userId, userMessage) {
  addMessage(userId, 'user', userMessage);

  try {
    let messages = [...getHistory(userId)];
    let response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools: GITHUB_TOKEN ? TOOLS : [],
      messages,
    });

    // Tool use loop - Claude may call tools multiple times (max 10 iterations to prevent runaway)
    let toolRounds = 0;
    const MAX_TOOL_ROUNDS = 10;
    while (response.stop_reason === 'tool_use' && toolRounds < MAX_TOOL_ROUNDS) {
      toolRounds++;
      const assistantContent = response.content;
      messages.push({ role: 'assistant', content: assistantContent });

      const toolResults = [];
      for (const block of assistantContent) {
        if (block.type === 'tool_use') {
          console.log(`Tool call: ${block.name}(${JSON.stringify(block.input).substring(0, 100)})`);
          try {
            const result = await executeTool(block.name, block.input);
            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result });
          } catch (e) {
            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: `Error: ${e.message}`, is_error: true });
          }
        }
      }

      messages.push({ role: 'user', content: toolResults });

      response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        tools: GITHUB_TOKEN ? TOOLS : [],
        messages,
      });
    }

    // If we hit the tool call limit, add a note
    if (toolRounds >= MAX_TOOL_ROUNDS && response.stop_reason === 'tool_use') {
      console.log(`Hit max tool rounds (${MAX_TOOL_ROUNDS}) for user ${userId}`);
    }

    // Extract final text reply
    const textBlocks = response.content.filter(b => b.type === 'text');
    const reply = textBlocks.map(b => b.text).join('\n') || (toolRounds >= MAX_TOOL_ROUNDS ? 'I made several changes but hit my edit limit. Let me know if you need more tweaks!' : 'Done.');

    // Save simplified history (just the text parts)
    addMessage(userId, 'assistant', reply);
    return reply;
  } catch (e) {
    console.error('Claude API error:', e.message);
    return `Error: ${e.message}`;
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

I'm Claude AI with full codebase access.

COMMANDS:
/top - Top agents
/bottom - Worst agents
/strategies - Strategy rankings
/stats - Backtest statistics
/categories - By category & risk
/files - Browse codebase
/reset - Clear memory

CODEBASE ACCESS:
Ask me to read, edit, or tweak any file.
"Show me the RSI strategy code"
"Change the background color to dark"
"Add a new strategy called XYZ"

Changes commit to GitHub and auto-deploy.
Live site: https://arena-web-production-ce34.up.railway.app`
  );
});

bot.command('reset', (ctx) => {
  conversations.delete(ctx.from.id.toString());
  ctx.reply('Memory wiped.');
});

bot.command('files', async (ctx) => {
  if (!GITHUB_TOKEN) return ctx.reply('GitHub not configured.');
  try {
    const files = await listFilesFromGH('');
    let msg = '📂 REPO ROOT\n\n';
    files.forEach(f => {
      msg += `${f.type === 'dir' ? '📁' : '📄'} ${f.path}\n`;
    });
    ctx.reply(msg);
  } catch (e) {
    ctx.reply(`Error: ${e.message}`);
  }
});

bot.command('top', (ctx) => {
  if (!backtestResults) return ctx.reply('No backtest data.');
  let msg = '🏆 TOP 10 AGENTS\n\n';
  backtestResults.top50.slice(0, 10).forEach((a, i) => {
    msg += `${i+1}. ${a.name} #${a.id}\n   ${a.strategy} | ${a.returnPct>0?'+':''}${a.returnPct.toFixed(1)}% | $${a.finalValue.toFixed(0)}\n\n`;
  });
  ctx.reply(msg);
});

bot.command('bottom', (ctx) => {
  if (!backtestResults) return ctx.reply('No backtest data.');
  let msg = '📉 BOTTOM 10 AGENTS\n\n';
  backtestResults.bottom20.slice(-10).forEach((a, i) => {
    msg += `${i+1}. ${a.name} #${a.id}\n   ${a.strategy} | ${a.returnPct.toFixed(1)}% | $${a.finalValue.toFixed(0)}\n\n`;
  });
  ctx.reply(msg);
});

bot.command('strategies', (ctx) => {
  if (!backtestResults) return ctx.reply('No backtest data.');
  let msg = '📊 STRATEGY RANKINGS\n\n';
  backtestResults.strategyRankings.slice(0, 15).forEach((s, i) => {
    msg += `${s.avgReturn>0?'🟢':'🔴'} ${i+1}. ${s.name} (${s.cat})\n   ${s.avgReturn>0?'+':''}${s.avgReturn.toFixed(2)}% | ${s.profitable}/${s.count} profitable\n\n`;
  });
  ctx.reply(msg);
});

bot.command('stats', (ctx) => {
  if (!backtestResults) return ctx.reply('No backtest data.');
  const { meta, summary } = backtestResults;
  ctx.reply(
`═══ BACKTEST STATS ═══
Period: ${meta.startDate} → ${meta.endDate}
Agents: ${meta.totalAgents.toLocaleString()}

Avg Return: ${summary.avgReturn.toFixed(2)}%
Median: ${summary.medianReturn.toFixed(2)}%
Profitable: ${summary.profitable} (${(summary.profitable/meta.totalAgents*100).toFixed(1)}%)
Win Rate: ${summary.avgWinRate.toFixed(1)}%
Drawdown: ${summary.avgDrawdown.toFixed(1)}%
Net P&L: $${Math.round(summary.totalFinalValue - meta.totalAgents * meta.initialCapital).toLocaleString()}`
  );
});

bot.command('categories', (ctx) => {
  if (!backtestResults) return ctx.reply('No backtest data.');
  let msg = '📁 BY CATEGORY\n\n';
  backtestResults.categoryRankings.forEach(c => {
    msg += `${c.avgReturn>0?'🟢':'🔴'} ${c.cat}: ${c.avgReturn>0?'+':''}${c.avgReturn.toFixed(2)}% | ${c.profitable}/${c.count}\n`;
  });
  msg += '\n📊 BY RISK\n\n';
  backtestResults.riskRankings.forEach(r => {
    msg += `${r.avgReturn>0?'🟢':'🔴'} ${r.risk}: ${r.avgReturn>0?'+':''}${r.avgReturn.toFixed(2)}% | DD ${r.avgDrawdown.toFixed(1)}%\n`;
  });
  ctx.reply(msg);
});

// ── Message Handler ─────────────────────────────────────────────
bot.on('text', async (ctx) => {
  const userId = ctx.from.id.toString();
  ctx.sendChatAction('typing');

  const reply = await chat(userId, ctx.message.text);

  if (reply.length > 4000) {
    for (const chunk of reply.match(/.{1,4000}/gs)) {
      await ctx.reply(chunk);
    }
  } else {
    ctx.reply(reply);
  }
});

bot.catch((err, ctx) => {
  console.error('Bot error:', err);
  ctx.reply('System error. Try again.');
});

// ── Launch ──────────────────────────────────────────────────────
bot.launch();
console.log('Agent Arena bot running' + (GITHUB_TOKEN ? ' with GitHub access' : ' (no GitHub - read-only mode)'));
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
