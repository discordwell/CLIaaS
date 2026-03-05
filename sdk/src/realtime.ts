export class SDKRealtimeClient {
  private eventSource: EventSource | null = null;
  private listeners: Map<string, Set<(data: unknown) => void>> = new Map();

  connect(url: string, token: string): void {
    this.disconnect();

    const separator = url.includes('?') ? '&' : '?';
    const sseUrl = `${url}${separator}stream=true&token=${encodeURIComponent(token)}`;

    this.eventSource = new EventSource(sseUrl);

    this.eventSource.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        const eventType = parsed.type ?? 'message:received';
        this.emit(eventType, parsed);
      } catch {
        // Ignore malformed SSE data
      }
    };

    this.eventSource.onerror = () => {
      this.emit('error', { message: 'SSE connection error' });
    };

    this.eventSource.addEventListener('message:received', (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data);
        this.emit('message:received', data);
      } catch {
        // Ignore parse errors
      }
    });

    this.eventSource.addEventListener('session:ended', (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data);
        this.emit('session:ended', data);
      } catch {
        // Ignore parse errors
      }
    });
  }

  disconnect(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }

  on(event: string, handler: (data: unknown) => void): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler);
  }

  off(event: string, handler: (data: unknown) => void): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      handlers.delete(handler);
    }
  }

  private emit(event: string, data: unknown): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(data);
        } catch {
          // Swallow handler errors to avoid breaking the event loop
        }
      }
    }
  }
}
