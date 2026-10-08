export function options(args = process.argv.slice(2)) {
  const result = {db:'data/notes.sqlite', port:8080};
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i], value = args[i + 1];
    if (!['--db','--port'].includes(flag) || value === undefined) throw new Error('Usage: --db path.sqlite [--port 8080]');
    result[flag.slice(2)] = flag === '--port' ? Number(value) : value;
  }
  if (!Number.isInteger(result.port) || result.port < 0 || result.port > 65535) throw new Error('Invalid port');
  return result;
}
