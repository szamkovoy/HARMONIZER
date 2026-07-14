/**
 * Holds the last opened push payload so /push-message can render full text
 * without stuffing long bodies into route params.
 */
export type PendingPushMessage = {
  notificationId: string | null;
  title: string;
  body: string;
  url: string | null;
};

let pending: PendingPushMessage | null = null;

export function setPendingPushMessage(message: PendingPushMessage): void {
  pending = message;
}

export function consumePendingPushMessage(): PendingPushMessage | null {
  const value = pending;
  pending = null;
  return value;
}

export function peekPendingPushMessage(): PendingPushMessage | null {
  return pending;
}
