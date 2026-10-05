/** Module observations for the existing approved Frida script runner. */
(() => {
  const options = globalThis.securityScriptOptions;
  let count = 0;
  let initial = true;
  let observer;
  function record(event, module) {
    if (count >= options.maxEvents) return;
    count++;
    send({ event, pid: Process.id, name: module.name, path: module.path,
      base: module.base.toString(), size: module.size });
    if (count === options.maxEvents) {
      send({ event: 'limit', incomplete: true, observed: count });
      if (observer) observer.detach();
    }
  }
  observer = Process.attachModuleObserver({
    onAdded(module) { record(initial ? 'existing' : 'loaded', module); },
    onRemoved(module) { record('unloaded', module); },
  });
  initial = false;
  if (count >= options.maxEvents) observer.detach();
})();
