import { q, nowIso } from '../db/connection.js';

/**
 * Record an important action. `actor` is the session user (or null for system actions).
 * Call inside the same transaction as the change so the log can never disagree with data.
 */
export function audit(actor, { restaurantId, action, entityType, entityId = null, summary, metadata = null, ip = null }) {
  q.run(
    `INSERT INTO audit_logs (restaurant_id, user_id, action, entity_type, entity_id, summary, metadata, ip, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    restaurantId ?? actor.restaurantId,
    actor?.id ?? null,
    action,
    entityType,
    entityId,
    summary,
    metadata ? JSON.stringify(metadata) : null,
    ip ?? actor?.ip ?? null,
    nowIso(),
  );
}
