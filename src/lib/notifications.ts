import { createAdminClient } from './supabase/admin';

type NotificationType =
  | 'new_booking'
  | 'booking_cancelled'
  | 'booking_rescheduled'
  | 'time_off_requested'
  | 'time_off_withdrawn'
  | 'employee_activated'
  | 'time_off_approved'
  | 'time_off_denied';

interface CreateNotificationParams {
  shopId:      string;
  recipientId: string;
  type:        NotificationType;
  title:       string;
  body:        string;
  bookingId?:  string;
  employeeId?: string;
}

export async function createNotification(params: CreateNotificationParams): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from('notifications').insert({
    shop_id:      params.shopId,
    recipient_id: params.recipientId,
    type:         params.type,
    title:        params.title,
    body:         params.body,
    booking_id:   params.bookingId  ?? null,
    employee_id:  params.employeeId ?? null,
  });
  if (error) {
    // Never throw — notification failure must not break the parent operation
    console.error('[notifications] Failed to create notification:', error.message);
  }
}
