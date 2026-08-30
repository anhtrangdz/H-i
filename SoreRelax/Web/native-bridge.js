'use strict';

(() => {
  let seq = 0;
  const pending = new Map();

  function call(method, params = {}) {
    return new Promise((resolve, reject) => {
      const handler = globalThis.webkit?.messageHandlers?.sorelax;
      if (!handler) {
        reject(new Error('Native bridge không khả dụng. Hãy chạy bản iOS đã build.'));
        return;
      }
      const id = `${Date.now().toString(36)}-${(++seq).toString(36)}`;
      pending.set(id, { resolve, reject });
      try {
        handler.postMessage({ id, method, params });
      } catch (err) {
        pending.delete(id);
        reject(err);
      }
    });
  }

  function receive(message) {
    const item = pending.get(message?.id);
    if (!item) return;
    pending.delete(message.id);
    if (message.error) item.reject(new Error(message.error));
    else item.resolve(message.result ?? null);
  }

  globalThis.NativeBridge = Object.freeze({ call, _receive: receive });
})();
