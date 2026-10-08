export function options(defaults, args = process.argv.slice(2)) {
  const result = { ...defaults };
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i].replace(/^--/, '');
    if (!args[i].startsWith('--') || !Object.hasOwn(defaults, key) || args[i + 1] === undefined)
      throw new Error(`Invalid argument: ${args[i]}`);
    result[key] = args[i + 1];
  }
  return result;
}
