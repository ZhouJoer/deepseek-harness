/** Bounded exported-function observations; arguments and return values are untouched. */
(() => {
  const options = globalThis.securityScriptOptions;
  const module = Process.getModuleByName(options.module);
  const targets = options.symbols.map(symbol => ({ symbol, address: module.getExportByName(symbol) }));
  const counts = Object.create(null);
  const listeners = [];
  let total = 0;
  for (const target of targets) {
    counts[target.symbol] = 0;
    listeners.push(Interceptor.attach(target.address, {
      onEnter() {
        if (total >= options.maxEvents) return;
        total++;
        counts[target.symbol]++;
        send({ event: 'call', pid: Process.id, threadId: this.threadId, module: module.name,
          symbol: target.symbol, count: counts[target.symbol],
          backtrace: Thread.backtrace(this.context, Backtracer.ACCURATE)
            .slice(0, options.stackDepth).map(address => DebugSymbol.fromAddress(address).toString()) });
        if (total === options.maxEvents) {
          send({ event: 'limit', incomplete: true, counts });
          for (const listener of listeners) listener.detach();
        }
      },
    }));
  }
  send({ event: 'ready', pid: Process.id, module: module.name, symbols: options.symbols });
})();
