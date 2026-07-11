import type { AppUser } from "./domain";
import { ulid } from "./id";

export async function auditLog(
  db: D1Database,
  user: AppUser,
  actionType: string,
  entityType: string,
  entityId: string,
  beforeValue: unknown,
  afterValue: unknown,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO audit_logs (id, actor_user_id, action_type, entity_type, entity_id, before_json, after_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      ulid("aud"),
      user.id,
      actionType,
      entityType,
      entityId,
      beforeValue === undefined ? null : JSON.stringify(beforeValue),
      afterValue === undefined ? null : JSON.stringify(afterValue),
    )
    .run();
}
