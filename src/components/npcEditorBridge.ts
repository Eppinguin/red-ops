import type { GeneratedNpcView } from '../engine/types';

type NpcListener = (view: GeneratedNpcView | null) => void;

let installed = false;
let activeWorker: Worker | null = null;
let currentView: GeneratedNpcView | null = null;
const listeners = new Set<NpcListener>();

function publish(view: GeneratedNpcView | null): void {
  currentView = view;
  for (const listener of listeners) listener(view);
}

export function installNpcWorkerBridge(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  const NativeWorker = window.Worker;

  class BridgedWorker extends NativeWorker {
    constructor(scriptURL: string | URL, options?: WorkerOptions) {
      super(scriptURL, options);
      activeWorker = this;
      this.addEventListener('message', (event: MessageEvent) => {
        const data = event.data as { type?: unknown; view?: unknown } | null;
        if (data?.type === 'generation-progress') {
          publish(null);
          return;
        }
        if (data?.type === 'result' && data.view) publish(data.view as GeneratedNpcView);
      });
    }
  }

  window.Worker = BridgedWorker as typeof Worker;
}

export function getCurrentNpc(): GeneratedNpcView | null {
  return currentView;
}

export function subscribeCurrentNpc(listener: NpcListener): () => void {
  listeners.add(listener);
  listener(currentView);
  return () => listeners.delete(listener);
}

export function publishCurrentNpc(view: GeneratedNpcView): void {
  publish(view);
}

export function applyCurrentNpc(view: GeneratedNpcView): void {
  publish(view);
  activeWorker?.dispatchEvent(new MessageEvent('message', {
    data: { type: 'result', view, warning: null },
  }));
}
