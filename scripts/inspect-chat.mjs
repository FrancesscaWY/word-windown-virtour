import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export async function listChats(root) {
  const found = [];
  for (const date of await readdir(root, { withFileTypes: true }).catch(error => {
    if (error.code === 'ENOENT') return [];
    throw error;
  })) {
    if (!date.isDirectory() || !/^\d{4}-\d{2}-\d{2}$/.test(date.name)) continue;
    for (const turn of await readdir(resolve(root, date.name), { withFileTypes: true })) {
      if (!turn.isDirectory()) continue;
      const directory = resolve(root, date.name, turn.name);
      const summary = await readFile(resolve(directory, 'summary.json'), 'utf8').then(JSON.parse).catch(error => {
        if (error.code === 'ENOENT') return { chatId: turn.name, outcome: 'ongoing-or-unfinalized' };
        throw error;
      });
      found.push({ directory, ...summary });
    }
  }
  return found.sort((a, b) => b.chatId.localeCompare(a.chatId));
}

export async function inspectChat(directory, { events = false } = {}) {
  const content = await readFile(resolve(directory, 'events.jsonl'), 'utf8');
  const lines = content.split('\n'), rows = [];
  let unreadableLines = 0;
  for (const line of lines) {
    if (!line) continue;
    try { rows.push(JSON.parse(line)); } catch { unreadableLines++; }
  }
  const summary = await readFile(resolve(directory, 'summary.json'), 'utf8').then(JSON.parse).catch(error => {
    if (error.code === 'ENOENT') return { chatId: rows[0]?.chatId, outcome: 'ongoing-or-unfinalized' };
    throw error;
  });
  return { directory, ...summary, unreadableLines,
    input: rows.find(row => row.event.type === 'request.input')?.event,
    modelRounds: rows.filter(row => row.event.type === 'model.response').map(({ event }) => ({ round: event.round, durationMs: event.durationMs, usage: event.usage })),
    tools: rows.filter(row => row.event.type === 'tool_end').map(({ event }) => ({ id: event.trace.id,
      name: event.trace.name, args: event.trace.args, status: event.trace.status, durationMs: event.trace.duration })),
    errors: rows.filter(row => /error|rejected|disconnected|omitted/.test(row.event.type)),
    ...(events ? { events: rows } : {}),
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('Usage: npm run chats:inspect -- [--list] [--limit 20] [--id CHAT_ID] [--events]\nWithout --list/--id, shows the latest turn. --events includes prompts, model replies and full tool results.');
    return;
  }
  for (let i = 0; i < args.length; i++) {
    if (['--id', '--limit'].includes(args[i])) {
      if (!args[++i] || args[i].startsWith('--')) throw new Error('Missing --id/--limit value.');
    } else if (!['--list', '--events'].includes(args[i])) throw new Error(`Unknown option: ${args[i]}`);
  }
  const root = process.env.CHAT_LOG_DIR || fileURLToPath(new URL('../logs/chats/', import.meta.url));
  const limit = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('--limit must be an integer from 1 to 1000.');
  const chats = await listChats(root);
  if (args.includes('--list')) {
    console.log(JSON.stringify(chats.slice(0, limit).map(({ chatId, startedAt, outcome, httpStatus, durationMs, question, model, logging }) =>
      ({ chatId, startedAt, outcome, httpStatus, durationMs, question, model, logging })), null, 2));
    return;
  }
  const id = args.includes('--id') ? args[args.indexOf('--id') + 1] : undefined;
  const chat = id ? chats.find(chat => chat.chatId === id) : chats[0];
  if (!chat) throw new Error(id ? 'Chat ID not found.' : 'No chat journals yet. Send a text question to /api/guide first.');
  console.log(JSON.stringify(await inspectChat(chat.directory, { events: args.includes('--events') }), null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
