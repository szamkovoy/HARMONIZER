export {
  fetchMyNotifications,
  fetchUnreadNotificationCount,
  markAllNotificationsRead,
  markNotificationRead,
  type MyNotification,
} from "@/modules/notifications/core/notificationsClient";
export {
  resolveNotificationCopy,
  resolveNotificationLocale,
  type NotificationCopySource,
} from "@/modules/notifications/core/resolveNotificationCopy";
export { registerPushToken } from "@/modules/notifications/core/pushRegistration";
export {
  ensureNotificationPermission,
  hasNotificationPermission,
  type NotificationPermissionReason,
  type NotificationPermissionResult,
} from "@/modules/notifications/core/notificationPermissionPolicy";
export { MyNotificationsScreen } from "@/modules/notifications/ui/MyNotificationsScreen";
export { PushMessageScreen } from "@/modules/notifications/ui/PushMessageScreen";
export { PushRegistrationBridge } from "@/modules/notifications/ui/PushRegistrationBridge";
