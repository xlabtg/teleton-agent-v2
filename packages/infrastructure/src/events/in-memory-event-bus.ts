/**
 * In-memory event bus implementation.
 * Suitable for single-process deployments.
 * For distributed systems, replace with Redis/NATS/Kafka adapter.
 */

import type { DomainEvent, EventBus, EventHandler } from "@teleton/core/domain/events.js";

export class InMemoryEventBus implements EventBus {
  private readonly handlers = new Map<string, Set<EventHandler>>();

  async publish(event: DomainEvent): Promise<void> {
    const eventHandlers = this.handlers.get(event.type);
    if (!eventHandlers) return;

    const promises = Array.from(eventHandlers).map((handler) =>
      handler.handle(event).catch((error) => {
        console.error(`Event handler error for ${event.type}:`, error);
      })
    );

    await Promise.allSettled(promises);
  }

  subscribe<T extends DomainEvent>(eventType: string, handler: EventHandler<T>): void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
    }
    this.handlers.get(eventType)!.add(handler as EventHandler);
  }

  unsubscribe(eventType: string, handler: EventHandler): void {
    this.handlers.get(eventType)?.delete(handler);
  }

  close(): void {
    this.handlers.clear();
  }
}
