export type Role = 'admin' | 'employee' | 'customer';
export type BookingStatus =
  | 'confirmed'
  | 'cancelled'
  | 'rescheduled'
  | 'pending_reschedule'
  | 'checked_in'
  | 'completed'
  | 'no_show';

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  role: Role;
  created_at: string;
}

export interface Shop {
  id: string;
  owner_id: string;
  name: string;
  slug: string;
  address: string | null;
  timezone: string;
  default_open_time: string;
  default_close_time: string;
  created_at: string;
  deleted_at: string | null;
  deleted_by: string | null;
}

export interface ShopSpecialHours {
  id: string;
  shop_id: string;
  date: string;
  open_time: string | null;
  close_time: string | null;
  is_closed: boolean;
}

export interface Employee {
  id: string;
  user_id: string | null;
  shop_id: string;
  name: string;
  bio: string | null;
  created_at: string;
  invite_email: string | null;
  activated_notified: boolean;
}

export interface EmployeeSchedule {
  id: string;
  employee_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_off: boolean;
}

export interface EmployeeScheduleOverride {
  id: string;
  employee_id: string;
  date: string; // YYYY-MM-DD
  is_working: boolean;
  start_time: string | null;
  end_time: string | null;
  reason: 'sick_call' | 'personal' | 'holiday' | 'schedule_change' | 'other';
  notes: string | null;
  created_by: string | null;
  created_at: string;
}

export type UnavailabilityActionType = 'reassign' | 'offer_reschedule' | 'cancel';

export interface UnavailabilityAction {
  bookingId: string;
  action: UnavailabilityActionType;
  newEmployeeId?: string;
}

export interface Service {
  id: string;
  shop_id: string;
  name: string;
  description: string | null;
  duration_minutes: number;
  price: number | null;
  is_active: boolean;
  display_order: number;
  created_at: string;
}

export interface EmployeeService {
  id: string;
  employee_id: string;
  service_id: string;
  duration_minutes: number | null;
  created_at: string;
}

export interface ShopConfig {
  id: string;
  shop_id: string;
  slot_interval_minutes: number;
  buffer_minutes: number;
  created_at: string;
}

export interface Booking {
  id: string;
  customer_id: string | null;
  employee_id: string | null;
  shop_id: string;
  start_time: string;
  end_time: string;
  status: BookingStatus;
  notes: string | null;
  reschedule_deadline: string | null;
  no_show_set_at: string | null;
  was_pending_reschedule: boolean;
  service_id: string | null;
  service_name: string | null;
  service_duration_minutes: number | null;
  created_at: string;
}

export interface BookingLog {
  id: string;
  booking_id: string;
  changed_by: string | null;
  change_type: string;
  old_values: Record<string, unknown> | null;
  changed_at: string;
}

// Enriched types with joins
export interface BookingWithDetails extends Booking {
  employee: Pick<Employee, 'id' | 'name'> | null;
  shop: Pick<Shop, 'id' | 'name' | 'timezone' | 'slug' | 'address' | 'owner_id'> | null;
  customer: Pick<Profile, 'id' | 'full_name' | 'email'> | null;
}

export interface EmployeeWithSchedule extends Employee {
  employee_schedules: EmployeeSchedule[];
}

export interface TimeOffRequest {
  id: string;
  employee_id: string;
  date: string; // YYYY-MM-DD
  reason: string;
  status: 'pending' | 'approved' | 'denied';
  admin_notes: string | null;
  created_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
}

export interface TimeSlot {
  start: string; // ISO UTC
  end: string;   // ISO UTC
  employeeId?: string;
  employeeName?: string;
  availableEmployees?: { id: string; name: string }[];
}
