'use client';

import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Card from '@/components/ui/Card';
import { getDayName } from '@/lib/utils';
import { formatTimeInZone } from '@/lib/utils';
import BookingResolutionModal, {
  type AffectedBooking,
  type AvailableBarber,
  type BookingResolution,
} from '@/components/admin/BookingResolutionModal';
import type { Employee, EmployeeSchedule, EmployeeScheduleOverride, Shop, TimeOffRequest } from '@/types';
import {
  Users, Plus, Trash2, ChevronDown, ChevronUp, Clock, AlertTriangle,
  X, Calendar, CheckCircle, XCircle, Mail, Pencil, Tag,
} from 'lucide-react';
import { format, addDays } from 'date-fns';

const DAYS = [0, 1, 2, 3, 4, 5, 6];

const OVERRIDE_REASONS: { value: EmployeeScheduleOverride['reason']; label: string }[] = [
  { value: 'sick_call',       label: 'Sick Call'       },
  { value: 'personal',        label: 'Personal'        },
  { value: 'holiday',         label: 'Holiday'         },
  { value: 'schedule_change', label: 'Schedule Change' },
  { value: 'other',           label: 'Other'           },
];

interface EmployeeWithSchedule extends Employee {
  employee_schedules: EmployeeSchedule[];
  shop?: Pick<Shop, 'name'>;
}

// ── Conflict modal context ─────────────────────────────────────────────────────
type ConflictContext =
  | { kind: 'approve-tor'; torId: string; adminNotes?: string; timezone: string }
  | { kind: 'add-override'; employeeId: string; overrideBody: Record<string, unknown>; timezone: string }
  | { kind: 'delete-employee'; employeeId: string; employeeName: string; timezone: string }
  | { kind: 'schedule-is-off'; employeeId: string; dayOfWeek: number; dayName: string; timezone: string };

interface ConflictState {
  context:          ConflictContext;
  affectedBookings: AffectedBooking[];
  availableBySlot:  Record<string, AvailableBarber[]>;
  isSubmitting:     boolean;
}

interface ServiceDurationRow {
  id:                 string;
  name:               string;
  base_duration:      number;
  employee_duration:  number | null;
  effective_duration: number;
}

interface EmpSvcData {
  services:             ServiceDurationRow[];
  buffer_minutes:       number;
  slot_interval_minutes: number;
}

export default function AdminEmployeesPage() {
  const supabase = createClient();
  const [shops, setShops]         = useState<Shop[]>([]);
  const [employees, setEmployees] = useState<EmployeeWithSchedule[]>([]);
  const [loading, setLoading]     = useState(true);
  const [showForm, setShowForm]   = useState(false);
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [overrides, setOverrides]       = useState<Record<string, EmployeeScheduleOverride[]>>({});
  const [overrideSaving, setOverrideSaving] = useState(false);
  const [overrideForm, setOverrideForm] = useState<Record<string, {
    date: string; type: 'off' | 'different_hours' | 'extra_day';
    startTime: string; endTime: string;
    reason: EmployeeScheduleOverride['reason']; notes: string; open: boolean;
  }>>({});

  const [empName, setEmpName]     = useState('');
  const [empEmail, setEmpEmail]   = useState('');
  const [empBio, setEmpBio]       = useState('');
  const [empShopId, setEmpShopId] = useState('');

  const [timeOffRequests, setTimeOffRequests] = useState<TimeOffRequest[]>([]);
  const [timeOffActing, setTimeOffActing]     = useState<string | null>(null);
  const [denyNotes, setDenyNotes]             = useState<Record<string, string>>({});
  const [denyOpen, setDenyOpen]               = useState<string | null>(null);

  // Fix 1: employee deletion state
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Fix 1 (resend invite) + Fix 3 (edit) shared toast
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Fix 1: resend invite
  const [resendingInviteId, setResendingInviteId] = useState<string | null>(null);

  // Fix 2: profile email map (userId → email)
  const [profileEmailMap, setProfileEmailMap] = useState<Record<string, string>>({});

  // Fix 3: inline employee edit
  const [editingEmpId, setEditingEmpId]     = useState<string | null>(null);
  const [editEmpForm, setEditEmpForm]       = useState<{ name: string; bio: string }>({ name: '', bio: '' });
  const [editEmpSaving, setEditEmpSaving]   = useState(false);
  const [editEmpError, setEditEmpError]     = useState('');

  // Conflict modal (Fixes 1, 2)
  const [conflict, setConflict] = useState<ConflictState | null>(null);

  // Fix 3: service duration overrides per employee
  const [empSvcData, setEmpSvcData] = useState<Record<string, EmpSvcData>>({});
  const [durInputs, setDurInputs]   = useState<Record<string, Record<string, string>>>({});
  const [savingDur, setSavingDur]   = useState<Record<string, string | null>>({});

  // Mark Unavailable modal (unchanged)
  const [unavailModal, setUnavailModal] = useState<{
    employee: EmployeeWithSchedule;
    step: 1 | 2;
    date: string; startTime: string; endTime: string;
    reason: EmployeeScheduleOverride['reason']; notes: string;
    affectedBookings: AffectedBooking[];
    availableBySlot: Record<string, AvailableBarber[]>;
    actions: Record<string, { action: 'cancel' | 'offer_reschedule' | 'reassign'; newEmployeeId?: string }>;
    submitting: boolean;
  } | null>(null);

  const load = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) return;
    const { data: shopsData } = await supabase.from('shops').select('*').eq('owner_id', user.id).is('deleted_at', null);
    setShops(shopsData ?? []);
    if (shopsData && shopsData.length > 0) {
      if (!empShopId) setEmpShopId(shopsData[0].id);
      const shopIds = shopsData.map((s) => s.id);
      const [{ data: empsData }, { data: torData }] = await Promise.all([
        supabase.from('employees').select('*, employee_schedules(*), shop:shops(name)').in('shop_id', shopIds).order('name'),
        supabase.from('time_off_requests')
          .select('*, employee:employees(name, user_id, shop:shops(name))')
          .eq('status', 'pending').order('date', { ascending: true }),
      ]);
      setEmployees((empsData ?? []) as EmployeeWithSchedule[]);

      // Fix 2: fetch profile emails for cards — skip if no linked user_ids
      const filteredUserIds = (empsData ?? [])
        .map((e) => e.user_id)
        .filter(Boolean) as string[];
      if (filteredUserIds.length > 0) {
        const { data: profilesData } = await supabase
          .from('profiles')
          .select('id, email')
          .in('id', filteredUserIds);
        const emailMap: Record<string, string> = {};
        for (const p of profilesData ?? []) emailMap[p.id] = p.email;
        setProfileEmailMap(emailMap);
      } else {
        setProfileEmailMap({});
      }

      setTimeOffRequests((torData ?? []) as TimeOffRequest[]);
    }
    setLoading(false);
  }, [empShopId, supabase]);

  useEffect(() => { load(); }, [load]);

  async function loadOverrides(employeeId: string) {
    const { data } = await supabase
      .from('employee_schedule_overrides').select('*').eq('employee_id', employeeId)
      .gte('date', format(new Date(), 'yyyy-MM-dd')).order('date', { ascending: true });
    setOverrides((prev) => ({ ...prev, [employeeId]: data ?? [] }));
  }

  async function loadServiceDurations(employeeId: string) {
    const res = await fetch(`/api/employee/services?employeeId=${employeeId}`);
    if (!res.ok) return;
    const data: EmpSvcData = await res.json();
    setEmpSvcData((prev) => ({ ...prev, [employeeId]: data }));
    const inputs: Record<string, string> = {};
    for (const svc of data.services ?? []) {
      inputs[svc.id] = String(svc.employee_duration ?? svc.base_duration);
    }
    setDurInputs((prev) => ({ ...prev, [employeeId]: inputs }));
  }

  async function saveDuration(employeeId: string, serviceId: string) {
    const inputVal = durInputs[employeeId]?.[serviceId];
    const duration = parseInt(inputVal ?? '', 10);
    if (isNaN(duration) || duration < 5 || duration > 480) return;
    setSavingDur((prev) => ({ ...prev, [employeeId]: serviceId }));
    try {
      const res = await fetch(`/api/employee/services/${serviceId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ duration_minutes: duration, employeeId }),
      });
      if (res.ok) {
        const result = await res.json();
        setEmpSvcData((prev) => {
          const current = prev[employeeId];
          if (!current) return prev;
          return {
            ...prev,
            [employeeId]: {
              ...current,
              services: current.services.map((s) =>
                s.id === serviceId
                  ? { ...s, employee_duration: result.employee_duration as number | null, effective_duration: result.effective_duration as number }
                  : s
              ),
            },
          };
        });
      }
    } catch {}
    setSavingDur((prev) => ({ ...prev, [employeeId]: null }));
  }

  function toggleExpand(empId: string) {
    if (expandedId === empId) {
      setExpandedId(null);
    } else {
      setExpandedId(empId);
      loadOverrides(empId);
      loadServiceDurations(empId);
      if (!overrideForm[empId]) {
        setOverrideForm((prev) => ({
          ...prev,
          [empId]: { date: format(addDays(new Date(), 1), 'yyyy-MM-dd'), type: 'off', startTime: '09:00', endTime: '18:00', reason: 'personal', notes: '', open: false },
        }));
      }
    }
  }

  async function handleAddEmployee(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setError('');
    try {
      const res = await fetch('/api/employees', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: empName, email: empEmail, bio: empBio, shopId: empShopId }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? 'Failed'); }
      setEmpName(''); setEmpEmail(''); setEmpBio('');
      setShowForm(false); await load();
    } catch (err: unknown) { setError(err instanceof Error ? err.message : 'Error'); }
    setSaving(false);
  }

  // Fix 1: pre-deletion check
  async function handleDeleteEmployee(id: string, name: string) {
    if (!confirm(`Remove ${name}? Any upcoming bookings must be resolved before deletion.`)) return;
    setDeletingId(id);

    const res = await fetch(`/api/admin/employees/${id}/upcoming-bookings`);
    if (!res.ok) { setDeletingId(null); return; }
    const { bookings, availableBySlot, shopTimezone } = await res.json();

    if (bookings.length === 0) {
      // No future bookings — proceed directly
      await proceedDeleteEmployee(id, []);
    } else {
      setConflict({
        context:          { kind: 'delete-employee', employeeId: id, employeeName: name, timezone: shopTimezone },
        affectedBookings: bookings,
        availableBySlot,
        isSubmitting:     false,
      });
    }
    setDeletingId(null);
  }

  async function proceedDeleteEmployee(employeeId: string, resolutions: BookingResolution[]) {
    const res = await fetch(`/api/admin/employees/${employeeId}`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actions: resolutions.map((r) => ({ bookingId: r.bookingId, action: r.action, newEmployeeId: r.newEmployeeId })) }),
    });
    if (res.ok) {
      setConflict(null);
      setEmployees((prev) => prev.filter((e) => e.id !== employeeId));
    } else {
      const data = await res.json();
      setError(data.error ?? 'Delete failed');
      setConflict(null);
    }
  }

  // Fix 1: resend invite
  async function handleResendInvite(empId: string, empName: string) {
    setResendingInviteId(empId);
    setToast(null);
    const res = await fetch(`/api/admin/employees/${empId}/resend-invite`, { method: 'POST' });
    const data = await res.json();
    if (res.ok) {
      setToast({ message: `Invite resent to ${data.email ?? empName}.`, type: 'success' });
    } else {
      setToast({ message: data.error ?? 'Could not resend invite. Please try again.', type: 'error' });
    }
    setResendingInviteId(null);
    setTimeout(() => setToast(null), 4000);
  }

  // Fix 3: edit employee name / bio
  function handleStartEditEmp(emp: EmployeeWithSchedule) {
    setEditingEmpId(emp.id);
    setEditEmpForm({ name: emp.name, bio: emp.bio ?? '' });
    setEditEmpError('');
  }

  async function handleSaveEditEmp(empId: string) {
    if (!editEmpForm.name.trim()) { setEditEmpError('Name is required.'); return; }
    setEditEmpSaving(true);
    setEditEmpError('');
    const res = await fetch(`/api/admin/employees/${empId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: editEmpForm.name.trim(), bio: editEmpForm.bio.trim() || null }),
    });
    if (res.ok) {
      setEmployees((prev) => prev.map((e) =>
        e.id === empId ? { ...e, name: editEmpForm.name.trim(), bio: editEmpForm.bio.trim() || null } : e
      ));
      setEditingEmpId(null);
      setToast({ message: `${editEmpForm.name.trim()} updated.`, type: 'success' });
      setTimeout(() => setToast(null), 4000);
    } else {
      const data = await res.json();
      setEditEmpError(data.error ?? 'Update failed.');
    }
    setEditEmpSaving(false);
  }

  // Schedule changes — is_off: true may return 409 when future bookings exist on that weekday
  async function handleScheduleChange(
    employeeId: string, day: number,
    field: 'start_time' | 'end_time' | 'is_off', value: string | boolean,
    resolutions?: BookingResolution[]
  ) {
    const res = await fetch('/api/admin/schedules', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        employeeId, dayOfWeek: day, field, value,
        ...(resolutions ? { actions: resolutions.map((r) => ({ bookingId: r.bookingId, action: r.action, newEmployeeId: r.newEmployeeId })) } : {}),
      }),
    });

    if (res.status === 409 && field === 'is_off' && value === true) {
      const { affectedBookings, availableBySlot, shopTimezone } = await res.json();
      const emp = employees.find((e) => e.id === employeeId);
      setConflict({
        context: {
          kind:        'schedule-is-off',
          employeeId,
          dayOfWeek:   day,
          dayName:     getDayName(day),
          timezone:    shopTimezone ?? (emp as unknown as { shop?: { timezone?: string } })?.shop?.timezone ?? 'UTC',
        },
        affectedBookings,
        availableBySlot,
        isSubmitting: false,
      });
      return;
    }

    if (res.ok) await load();
  }

  // Fix 2: time off approval with 409 handling
  async function handleTimeOff(id: string, action: 'approve' | 'deny', resolutions?: BookingResolution[]) {
    setTimeOffActing(id);
    const res = await fetch('/api/admin/time-off', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id, action,
        adminNotes: denyNotes[id] || undefined,
        ...(resolutions ? { actions: resolutions.map((r) => ({ bookingId: r.bookingId, action: r.action, newEmployeeId: r.newEmployeeId })) } : {}),
      }),
    });

    if (res.status === 409) {
      const { affectedBookings, availableBySlot } = await res.json();
      const tor = timeOffRequests.find((r) => r.id === id);
      const emp = (tor as unknown as { employee?: { shop?: { timezone?: string } } })?.employee;
      setConflict({
        context:         { kind: 'approve-tor', torId: id, adminNotes: denyNotes[id], timezone: emp?.shop?.timezone ?? 'UTC' },
        affectedBookings,
        availableBySlot,
        isSubmitting:    false,
      });
    } else if (res.ok) {
      setTimeOffRequests((prev) => prev.filter((r) => r.id !== id));
      setDenyOpen(null);
      setConflict(null);
    }
    setTimeOffActing(null);
  }

  // Fix 2: manual Day Off override with 409 handling
  async function handleAddOverride(employeeId: string, resolutions?: BookingResolution[]) {
    const form = overrideForm[employeeId];
    if (!form || !form.date) return;
    setOverrideSaving(true);
    const isWorking = form.type !== 'off';

    const emp      = employees.find((e) => e.id === employeeId);
    const timezone = (emp as unknown as { shop?: { timezone?: string } })?.shop?.timezone ?? 'UTC';

    const overrideBody = {
      employeeId,
      date:      form.date,
      isWorking,
      startTime: isWorking && form.type === 'different_hours' ? form.startTime : null,
      endTime:   isWorking && form.type === 'different_hours' ? form.endTime   : null,
      reason:    form.reason,
      notes:     form.notes || null,
    };

    const res = await fetch('/api/admin/overrides', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...overrideBody,
        ...(resolutions ? { actions: resolutions.map((r) => ({ bookingId: r.bookingId, action: r.action, newEmployeeId: r.newEmployeeId })) } : {}),
      }),
    });

    if (res.status === 409) {
      const { affectedBookings, availableBySlot } = await res.json();
      setConflict({
        context:         { kind: 'add-override', employeeId, overrideBody, timezone },
        affectedBookings,
        availableBySlot,
        isSubmitting:    false,
      });
    } else if (res.ok) {
      setOverrideForm((prev) => ({ ...prev, [employeeId]: { ...form, open: false, notes: '' } }));
      await loadOverrides(employeeId);
      setConflict(null);
    }
    setOverrideSaving(false);
  }

  // Fix 10: override deletion goes through API
  async function handleDeleteOverride(employeeId: string, overrideId: string) {
    await fetch('/api/admin/overrides', {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ overrideId }),
    });
    await loadOverrides(employeeId);
  }

  // Conflict modal resolution handler (dispatches to correct flow)
  async function handleConflictResolved(resolutions: BookingResolution[]) {
    if (!conflict) return;
    setConflict((prev) => prev ? { ...prev, isSubmitting: true } : null);
    const ctx = conflict.context;

    if (ctx.kind === 'delete-employee') {
      await proceedDeleteEmployee(ctx.employeeId, resolutions);
    } else if (ctx.kind === 'approve-tor') {
      await handleTimeOff(ctx.torId, 'approve', resolutions);
    } else if (ctx.kind === 'add-override') {
      const form = overrideForm[ctx.employeeId];
      if (!form) return;
      setOverrideSaving(true);
      const res = await fetch('/api/admin/overrides', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...ctx.overrideBody,
          actions: resolutions.map((r) => ({ bookingId: r.bookingId, action: r.action, newEmployeeId: r.newEmployeeId })),
        }),
      });
      if (res.ok) {
        setOverrideForm((prev) => ({ ...prev, [ctx.employeeId]: { ...form, open: false, notes: '' } }));
        await loadOverrides(ctx.employeeId);
        setConflict(null);
      }
      setOverrideSaving(false);
    } else if (ctx.kind === 'schedule-is-off') {
      await handleScheduleChange(ctx.employeeId, ctx.dayOfWeek, 'is_off', true, resolutions);
      setConflict(null);
    }
    setConflict((prev) => prev ? { ...prev, isSubmitting: false } : null);
  }

  // Mark Unavailable modal
  async function openUnavailModal(emp: EmployeeWithSchedule) {
    setUnavailModal({
      employee: emp, step: 1,
      date: format(new Date(), 'yyyy-MM-dd'), startTime: '', endTime: '',
      reason: 'sick_call', notes: '',
      affectedBookings: [], availableBySlot: {}, actions: {}, submitting: false,
    });
  }

  async function fetchAffectedBookings() {
    if (!unavailModal) return;
    const { employee, date, startTime, endTime } = unavailModal;
    const params = new URLSearchParams({ employeeId: employee.id, date });
    if (startTime) params.set('startTime', startTime);
    if (endTime)   params.set('endTime', endTime);
    const res = await fetch(`/api/admin/unavailability?${params}`);
    if (!res.ok) return;
    const { affectedBookings, availableBySlot } = await res.json();
    const defaultActions: Record<string, { action: 'cancel' | 'offer_reschedule' | 'reassign'; newEmployeeId?: string }> = {};
    for (const b of affectedBookings) defaultActions[b.id] = { action: 'cancel' };
    setUnavailModal((m) => m ? { ...m, step: 2, affectedBookings, availableBySlot, actions: defaultActions } : null);
  }

  async function submitUnavailability() {
    if (!unavailModal) return;
    // Fix 7: validate reassign actions have barber selected
    for (const [, state] of Object.entries(unavailModal.actions)) {
      if (state.action === 'reassign' && !state.newEmployeeId) {
        alert('Please select a replacement barber for all reassign actions.');
        return;
      }
    }
    setUnavailModal((m) => m ? { ...m, submitting: true } : null);
    const { employee, date, startTime, endTime, reason, notes, actions } = unavailModal;
    const res = await fetch('/api/admin/unavailability', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        employeeId: employee.id, date,
        startTime: startTime || null, endTime: endTime || null, reason, notes: notes || null,
        actions: Object.entries(actions).map(([bookingId, state]) => ({
          bookingId, action: state.action, newEmployeeId: state.newEmployeeId,
        })),
      }),
    });
    if (res.ok) { setUnavailModal(null); await load(); }
    else { setUnavailModal((m) => m ? { ...m, submitting: false } : null); }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold mb-1">Employees</h1>
          <p className="text-gray-400 text-sm">Manage your barbers and their schedules</p>
        </div>
        <Button onClick={() => setShowForm(!showForm)} size="sm">
          <Plus className="w-4 h-4" />
          Add Employee
        </Button>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">{error}</div>
      )}

      {showForm && (
        <Card className="mb-6 border-gold/20">
          <h3 className="font-semibold mb-4">New Employee</h3>
          <form onSubmit={handleAddEmployee} className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <Input label="Full name" value={empName} onChange={(e) => setEmpName(e.target.value)} placeholder="Carlos Mendez" required />
              <Input label="Email address" type="email" value={empEmail} onChange={(e) => setEmpEmail(e.target.value)} placeholder="carlos@example.com" hint="They'll receive a login invite" required />
            </div>
            <Input label="Bio (optional)" value={empBio} onChange={(e) => setEmpBio(e.target.value)} placeholder="Specializes in fades..." />
            {shops.length === 1 ? (
              <div className="p-3 rounded-lg bg-dark-200 border border-dark-400 text-sm text-gray-400">
                Adding to: <span className="font-medium text-white">{shops[0].name}</span>
              </div>
            ) : shops.length > 1 ? (
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium text-gray-300">Assign to shop</label>
                <select value={empShopId} onChange={(e) => setEmpShopId(e.target.value)} className="w-full px-4 py-2.5 rounded-lg bg-dark-200 border border-dark-400 text-white text-sm focus:outline-none focus:ring-2 focus:ring-gold">
                  {shops.map((s) => <option key={s.id} value={s.id} className="bg-dark-200">{s.name}</option>)}
                </select>
              </div>
            ) : null}
            <div className="flex gap-3">
              <Button type="submit" loading={saving} size="sm">Add &amp; Send Invite</Button>
              <Button variant="secondary" size="sm" onClick={() => setShowForm(false)} type="button">Cancel</Button>
            </div>
          </form>
        </Card>
      )}

      {/* Time Off Requests */}
      {timeOffRequests.length > 0 && (
        <div className="mb-8">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Calendar className="w-5 h-5 text-yellow-400" />
            Pending Time Off Requests
            <span className="text-xs bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 px-1.5 py-0.5 rounded-full">{timeOffRequests.length}</span>
          </h2>
          <div className="space-y-3">
            {timeOffRequests.map((req) => {
              const emp = (req as unknown as { employee?: { name: string; user_id: string | null; shop?: { name: string } | null } }).employee;
              const empEmail = emp?.user_id ? profileEmailMap[emp.user_id] : null;
              return (
                <div key={req.id} className="p-4 bg-dark-100 border border-yellow-500/20 rounded-xl space-y-2">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="font-medium text-sm">{emp?.name ?? 'Unknown'}</div>
                      <div className="text-xs text-gray-500">{emp?.shop?.name}</div>
                      {empEmail && (
                        <div className="text-xs text-gray-400 mt-0.5 flex items-center gap-1">
                          <Mail className="w-3 h-3" />{empEmail}
                        </div>
                      )}
                      <div className="text-xs text-yellow-400 mt-0.5">{format(new Date(req.date + 'T12:00:00'), 'EEE, MMMM d')}</div>
                      <div className="text-xs text-gray-400 mt-0.5">{req.reason}</div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <Button size="sm" onClick={() => handleTimeOff(req.id, 'approve')} loading={timeOffActing === req.id} className="flex items-center gap-1">
                        <CheckCircle className="w-3.5 h-3.5" /> Approve
                      </Button>
                      <button onClick={() => setDenyOpen(denyOpen === req.id ? null : req.id)} className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg border border-red-500/20 text-red-400 hover:bg-red-500/10 transition-colors">
                        <XCircle className="w-3.5 h-3.5" /> Deny
                      </button>
                    </div>
                  </div>
                  {denyOpen === req.id && (
                    <div className="flex items-center gap-2 pt-1">
                      <input type="text" value={denyNotes[req.id] ?? ''} onChange={(e) => setDenyNotes((prev) => ({ ...prev, [req.id]: e.target.value }))} placeholder="Reason for denial (optional)" className="flex-1 px-3 py-1.5 text-xs rounded-lg bg-dark-200 border border-dark-400 text-white placeholder:text-gray-600 focus:outline-none focus:ring-1 focus:ring-red-500" />
                      <button onClick={() => handleTimeOff(req.id, 'deny')} disabled={timeOffActing === req.id} className="px-3 py-1.5 text-xs font-medium rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors disabled:opacity-50">
                        {timeOffActing === req.id ? '…' : 'Confirm Deny'}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Employee list */}
      {loading ? (
        <div className="flex items-center gap-2 text-gray-400">
          <div className="w-4 h-4 border-2 border-gold border-t-transparent rounded-full animate-spin" />
          Loading…
        </div>
      ) : employees.length === 0 ? (
        <div className="text-center py-16 bg-dark-100 border border-dark-300 rounded-2xl">
          <Users className="w-10 h-10 text-gray-600 mx-auto mb-3" />
          <p className="text-gray-400">No employees yet.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {employees.map((emp) => (
            <Card key={emp.id}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-gold-muted border border-gold/20 flex items-center justify-center font-bold text-gold flex-shrink-0">
                    {emp.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="font-semibold">{emp.name}</div>
                      {!emp.activated_notified && emp.invite_email && (
                        <span className="text-xs px-1.5 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 font-medium">
                          Invite Pending
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500">{emp.shop?.name}</div>
                    {/* Fix 2: show email — prefer linked profile email, fallback to invite_email */}
                    {(emp.user_id ? profileEmailMap[emp.user_id] : null) ?? emp.invite_email
                      ? <div className="text-xs text-gray-500 mt-0.5">
                          {(emp.user_id ? profileEmailMap[emp.user_id] : null) ?? emp.invite_email}
                        </div>
                      : null}
                    {emp.bio && editingEmpId !== emp.id && (
                      <div className="text-xs text-gray-400 mt-0.5">{emp.bio}</div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap justify-end">
                  {/* Fix 1: resend invite — only shown for pending employees */}
                  {!emp.activated_notified && emp.invite_email && (
                    <button
                      onClick={() => handleResendInvite(emp.id, emp.name)}
                      disabled={resendingInviteId === emp.id}
                      className="text-xs px-3 py-1.5 rounded-lg border border-amber-500/30 text-amber-400 hover:bg-amber-500/10 transition-all flex items-center gap-1 disabled:opacity-50"
                    >
                      {resendingInviteId === emp.id
                        ? <div className="w-3.5 h-3.5 border border-amber-400 border-t-transparent rounded-full animate-spin" />
                        : <Mail className="w-3.5 h-3.5" />}
                      Resend Invite
                    </button>
                  )}
                  {/* Fix 3: edit name / bio */}
                  <button
                    onClick={() => editingEmpId === emp.id ? setEditingEmpId(null) : handleStartEditEmp(emp)}
                    className="text-xs px-2 py-1.5 rounded-lg border border-dark-400 hover:border-gold text-gray-400 hover:text-gold transition-all"
                    title="Edit name and bio"
                  >
                    {editingEmpId === emp.id ? <X className="w-3.5 h-3.5" /> : <Pencil className="w-3.5 h-3.5" />}
                  </button>
                  <button onClick={() => openUnavailModal(emp)} className="text-xs px-3 py-1.5 rounded-lg border border-orange-500/30 text-orange-400 hover:bg-orange-500/10 transition-all flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5" /> Mark Unavailable
                  </button>
                  <button onClick={() => toggleExpand(emp.id)} className="text-xs px-3 py-1.5 rounded-lg border border-dark-400 hover:border-dark-500 text-gray-400 hover:text-white transition-all flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5" /> Schedule
                    {expandedId === emp.id ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  </button>
                  <button
                    onClick={() => handleDeleteEmployee(emp.id, emp.name)}
                    disabled={deletingId === emp.id}
                    className="text-xs px-2 py-1.5 rounded-lg text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-all disabled:opacity-50"
                  >
                    {deletingId === emp.id
                      ? <div className="w-3.5 h-3.5 border-2 border-red-400 border-t-transparent rounded-full animate-spin" />
                      : <Trash2 className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              {/* Fix 3: inline edit form */}
              {editingEmpId === emp.id && (
                <div className="mt-4 pt-4 border-t border-dark-300 space-y-3">
                  <h4 className="text-sm font-semibold">Edit Employee</h4>
                  <Input
                    label="Name"
                    value={editEmpForm.name}
                    onChange={(e) => setEditEmpForm((f) => ({ ...f, name: e.target.value }))}
                    required
                  />
                  <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-medium text-gray-300">Bio (optional)</label>
                    <textarea
                      value={editEmpForm.bio}
                      onChange={(e) => setEditEmpForm((f) => ({ ...f, bio: e.target.value }))}
                      placeholder="Specializes in fades..."
                      rows={2}
                      className="w-full px-4 py-2.5 rounded-lg bg-dark-200 border border-dark-400 text-white text-sm placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-gold resize-none"
                    />
                  </div>
                  {editEmpError && (
                    <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">{editEmpError}</div>
                  )}
                  <div className="flex gap-3">
                    <Button size="sm" loading={editEmpSaving} onClick={() => handleSaveEditEmp(emp.id)}>Save</Button>
                    <Button size="sm" variant="secondary" onClick={() => setEditingEmpId(null)} type="button">Cancel</Button>
                  </div>
                </div>
              )}

              {expandedId === emp.id && (
                <div className="mt-4 pt-4 border-t border-dark-300 space-y-6">
                  {/* Base weekly schedule */}
                  <div>
                    <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                      <Clock className="w-4 h-4 text-gold" /> Weekly Schedule
                    </h4>
                    <div className="space-y-2">
                      {DAYS.map((day) => {
                        const sched = emp.employee_schedules.find((s) => s.day_of_week === day);
                        const isOff = sched?.is_off ?? true;
                        return (
                          <div key={day} className="flex items-center gap-3">
                            <div className="w-24 text-sm text-gray-300 flex-shrink-0">{getDayName(day)}</div>
                            <input type="checkbox" checked={!isOff} onChange={(e) => handleScheduleChange(emp.id, day, 'is_off', !e.target.checked)} className="accent-gold flex-shrink-0" />
                            {!isOff ? (
                              <div className="flex items-center gap-2">
                                <input type="time" value={sched?.start_time?.slice(0, 5) ?? '09:00'} onChange={(e) => handleScheduleChange(emp.id, day, 'start_time', e.target.value)} className="px-2 py-1 text-xs rounded-lg bg-dark-200 border border-dark-400 text-white focus:outline-none focus:ring-1 focus:ring-gold" />
                                <span className="text-gray-600 text-xs">to</span>
                                <input type="time" value={sched?.end_time?.slice(0, 5) ?? '18:00'} onChange={(e) => handleScheduleChange(emp.id, day, 'end_time', e.target.value)} className="px-2 py-1 text-xs rounded-lg bg-dark-200 border border-dark-400 text-white focus:outline-none focus:ring-1 focus:ring-gold" />
                              </div>
                            ) : <span className="text-xs text-gray-600">Off</span>}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Service Durations */}
                  {empSvcData[emp.id] && (
                    <div>
                      <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                        <Tag className="w-4 h-4 text-gold" /> Service Durations
                      </h4>
                      {empSvcData[emp.id].services.length === 0 ? (
                        <p className="text-xs text-gray-600 py-2">No active services at this shop.</p>
                      ) : (
                        <div className="space-y-2">
                          {empSvcData[emp.id].services.map((svc) => {
                            const inputVal = durInputs[emp.id]?.[svc.id] ?? String(svc.employee_duration ?? svc.base_duration);
                            const parsedDur = parseInt(inputVal, 10);
                            const buffer   = empSvcData[emp.id].buffer_minutes;
                            const interval = empSvcData[emp.id].slot_interval_minutes;
                            const blocked  = !isNaN(parsedDur) && parsedDur >= 5
                              ? Math.ceil((parsedDur + buffer) / interval) * interval
                              : null;
                            const isSaving = savingDur[emp.id] === svc.id;
                            return (
                              <div key={svc.id} className="flex items-center gap-3 py-2 px-3 rounded-lg bg-dark-200">
                                <div className="flex-1 min-w-0">
                                  <div className="text-xs font-medium text-white truncate">{svc.name}</div>
                                  <div className="text-xs text-gray-500">Base: {svc.base_duration} min</div>
                                </div>
                                <div className="flex items-center gap-1.5 flex-shrink-0">
                                  <input
                                    type="number"
                                    min="5" max="480"
                                    value={inputVal}
                                    onChange={(e) => setDurInputs((prev) => ({
                                      ...prev,
                                      [emp.id]: { ...prev[emp.id], [svc.id]: e.target.value },
                                    }))}
                                    className="w-14 px-2 py-1 text-xs rounded bg-dark-300 border border-dark-400 text-white focus:outline-none focus:ring-1 focus:ring-gold text-center"
                                  />
                                  <span className="text-xs text-gray-500">min</span>
                                </div>
                                {blocked !== null && (
                                  <span className="text-xs text-gray-500 w-24 text-right flex-shrink-0">
                                    {blocked} min blocked
                                  </span>
                                )}
                                {svc.employee_duration !== null && (
                                  <span className="text-xs px-1.5 py-0.5 rounded bg-gold-muted text-gold border border-gold/20 flex-shrink-0">custom</span>
                                )}
                                <button
                                  onClick={() => saveDuration(emp.id, svc.id)}
                                  disabled={isSaving}
                                  className="text-xs px-2 py-1 rounded bg-dark-300 hover:bg-gold hover:text-dark text-gray-400 transition-colors disabled:opacity-50 flex-shrink-0"
                                >
                                  {isSaving ? '…' : 'Save'}
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Exceptions */}
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-sm font-semibold flex items-center gap-2">
                        <Calendar className="w-4 h-4 text-gold" /> Exceptions
                        {(overrides[emp.id]?.length ?? 0) > 0 && (
                          <span className="text-xs bg-gold-muted text-gold px-1.5 py-0.5 rounded-full">{overrides[emp.id].length}</span>
                        )}
                      </h4>
                      <button onClick={() => setOverrideForm((prev) => ({ ...prev, [emp.id]: { ...prev[emp.id], open: !prev[emp.id]?.open } }))} className="text-xs text-gold hover:text-gold-light flex items-center gap-1">
                        <Plus className="w-3 h-3" /> Add Exception
                      </button>
                    </div>

                    {overrideForm[emp.id]?.open && (
                      <div className="mb-3 p-3 bg-dark-200 rounded-lg border border-dark-400 space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                          <div className="flex flex-col gap-1">
                            <label className="text-xs text-gray-400">Date</label>
                            <input type="date" value={overrideForm[emp.id].date} min={format(new Date(), 'yyyy-MM-dd')} onChange={(e) => setOverrideForm((prev) => ({ ...prev, [emp.id]: { ...prev[emp.id], date: e.target.value } }))} className="px-2 py-1.5 text-xs rounded-lg bg-dark-300 border border-dark-400 text-white focus:outline-none focus:ring-1 focus:ring-gold" />
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className="text-xs text-gray-400">Type</label>
                            <select value={overrideForm[emp.id].type} onChange={(e) => setOverrideForm((prev) => ({ ...prev, [emp.id]: { ...prev[emp.id], type: e.target.value as 'off' | 'different_hours' | 'extra_day' } }))} className="px-2 py-1.5 text-xs rounded-lg bg-dark-300 border border-dark-400 text-white focus:outline-none focus:ring-1 focus:ring-gold">
                              <option value="off">Day Off</option>
                              <option value="different_hours">Different Hours</option>
                              <option value="extra_day">Extra Working Day</option>
                            </select>
                          </div>
                        </div>
                        {overrideForm[emp.id].type === 'different_hours' && (
                          <div className="flex items-center gap-2">
                            <label className="text-xs text-gray-400 flex-shrink-0">Hours</label>
                            <input type="time" value={overrideForm[emp.id].startTime} onChange={(e) => setOverrideForm((prev) => ({ ...prev, [emp.id]: { ...prev[emp.id], startTime: e.target.value } }))} className="px-2 py-1 text-xs rounded-lg bg-dark-300 border border-dark-400 text-white focus:outline-none focus:ring-1 focus:ring-gold" />
                            <span className="text-gray-600 text-xs">to</span>
                            <input type="time" value={overrideForm[emp.id].endTime} onChange={(e) => setOverrideForm((prev) => ({ ...prev, [emp.id]: { ...prev[emp.id], endTime: e.target.value } }))} className="px-2 py-1 text-xs rounded-lg bg-dark-300 border border-dark-400 text-white focus:outline-none focus:ring-1 focus:ring-gold" />
                          </div>
                        )}
                        <div className="grid grid-cols-2 gap-3">
                          <div className="flex flex-col gap-1">
                            <label className="text-xs text-gray-400">Reason</label>
                            <select value={overrideForm[emp.id].reason} onChange={(e) => setOverrideForm((prev) => ({ ...prev, [emp.id]: { ...prev[emp.id], reason: e.target.value as EmployeeScheduleOverride['reason'] } }))} className="px-2 py-1.5 text-xs rounded-lg bg-dark-300 border border-dark-400 text-white focus:outline-none focus:ring-1 focus:ring-gold">
                              {OVERRIDE_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                            </select>
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className="text-xs text-gray-400">Notes (optional)</label>
                            <input type="text" value={overrideForm[emp.id].notes} onChange={(e) => setOverrideForm((prev) => ({ ...prev, [emp.id]: { ...prev[emp.id], notes: e.target.value } }))} placeholder="e.g. Doctor appointment" className="px-2 py-1.5 text-xs rounded-lg bg-dark-300 border border-dark-400 text-white placeholder:text-gray-600 focus:outline-none focus:ring-1 focus:ring-gold" />
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" loading={overrideSaving} onClick={() => handleAddOverride(emp.id)}>Save Exception</Button>
                          <Button size="sm" variant="secondary" onClick={() => setOverrideForm((prev) => ({ ...prev, [emp.id]: { ...prev[emp.id], open: false } }))}>Cancel</Button>
                        </div>
                      </div>
                    )}

                    {(overrides[emp.id]?.length ?? 0) === 0 ? (
                      <p className="text-xs text-gray-600 py-2">No upcoming exceptions.</p>
                    ) : (
                      <div className="space-y-1.5">
                        {overrides[emp.id].map((ov) => (
                          <div key={ov.id} className="flex items-center justify-between py-1.5 px-2 rounded-lg bg-dark-200">
                            <div className="flex items-center gap-3">
                              <span className="text-xs font-medium text-white">{format(new Date(ov.date + 'T12:00:00'), 'EEE, MMM d')}</span>
                              {ov.is_working ? (
                                <span className="text-xs px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
                                  {ov.start_time && ov.end_time ? `${ov.start_time.slice(0, 5)} – ${ov.end_time.slice(0, 5)}` : 'Extra Day'}
                                </span>
                              ) : <span className="text-xs px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20">Day Off</span>}
                              <span className="text-xs text-gray-500 capitalize">{ov.reason.replace('_', ' ')}</span>
                            </div>
                            <button onClick={() => handleDeleteOverride(emp.id, ov.id)} className="text-gray-600 hover:text-red-400 transition-colors">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {/* Booking Resolution Modal (Fixes 1, 2) */}
      {conflict && (
        <BookingResolutionModal
          title={
            conflict.context.kind === 'delete-employee'  ? `Resolve Bookings Before Deleting ${conflict.context.employeeName}` :
            conflict.context.kind === 'approve-tor'      ? 'Resolve Bookings Before Approving Time Off' :
            conflict.context.kind === 'schedule-is-off'  ? `Resolve ${conflict.context.dayName} Bookings Before Marking Day Off` :
            'Resolve Bookings Before Adding Day Off'
          }
          description={
            conflict.context.kind === 'delete-employee'
              ? `This employee has ${conflict.affectedBookings.length} upcoming booking(s) that must be resolved before deletion.`
              : conflict.context.kind === 'schedule-is-off'
              ? `This employee has ${conflict.affectedBookings.length} upcoming booking(s) on ${conflict.context.dayName}s. Resolve each one before saving the schedule change.`
              : undefined
          }
          affectedBookings={conflict.affectedBookings}
          availableBySlot={conflict.availableBySlot}
          timezone={conflict.context.timezone}
          isSubmitting={conflict.isSubmitting}
          onSubmit={handleConflictResolved}
          onCancel={() => setConflict(null)}
        />
      )}

      {/* Toast notification (Fix 1 invite resend, Fix 3 edit save) */}
      {toast && (
        <div className={`fixed bottom-4 right-4 z-50 p-4 rounded-xl border text-sm font-medium shadow-lg ${
          toast.type === 'success'
            ? 'bg-green-500/10 border-green-500/20 text-green-400'
            : 'bg-red-500/10 border-red-500/20 text-red-400'
        }`}>
          {toast.message}
        </div>
      )}

      {/* Mark Unavailable Modal (unchanged) */}
      {unavailModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70">
          <div className="bg-dark-100 border border-dark-300 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-dark-300">
              <div>
                <h2 className="font-bold text-lg flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-orange-400" /> Mark Unavailable
                </h2>
                <p className="text-sm text-gray-400 mt-0.5">{unavailModal.employee.name}</p>
              </div>
              <button onClick={() => setUnavailModal(null)} className="text-gray-500 hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              {unavailModal.step === 1 && (
                <>
                  <div className="grid grid-cols-1 gap-3">
                    <div className="flex flex-col gap-1.5">
                      <label className="text-sm text-gray-300 font-medium">Date</label>
                      <input type="date" value={unavailModal.date} min={format(new Date(), 'yyyy-MM-dd')} onChange={(e) => setUnavailModal((m) => m ? { ...m, date: e.target.value } : null)} className="px-3 py-2 rounded-lg bg-dark-200 border border-dark-400 text-white text-sm focus:outline-none focus:ring-2 focus:ring-gold" />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-sm text-gray-300 font-medium">Time range (optional)</label>
                      <div className="flex items-center gap-2">
                        <input type="time" value={unavailModal.startTime} onChange={(e) => setUnavailModal((m) => m ? { ...m, startTime: e.target.value } : null)} className="flex-1 px-3 py-2 rounded-lg bg-dark-200 border border-dark-400 text-white text-sm focus:outline-none focus:ring-2 focus:ring-gold" />
                        <span className="text-gray-500 text-sm">to</span>
                        <input type="time" value={unavailModal.endTime} onChange={(e) => setUnavailModal((m) => m ? { ...m, endTime: e.target.value } : null)} className="flex-1 px-3 py-2 rounded-lg bg-dark-200 border border-dark-400 text-white text-sm focus:outline-none focus:ring-2 focus:ring-gold" />
                      </div>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-sm text-gray-300 font-medium">Reason</label>
                      <select value={unavailModal.reason} onChange={(e) => setUnavailModal((m) => m ? { ...m, reason: e.target.value as EmployeeScheduleOverride['reason'] } : null)} className="px-3 py-2 rounded-lg bg-dark-200 border border-dark-400 text-white text-sm focus:outline-none focus:ring-2 focus:ring-gold">
                        {OVERRIDE_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                      </select>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-sm text-gray-300 font-medium">Notes (optional)</label>
                      <input type="text" value={unavailModal.notes} onChange={(e) => setUnavailModal((m) => m ? { ...m, notes: e.target.value } : null)} placeholder="e.g. Called in sick" className="px-3 py-2 rounded-lg bg-dark-200 border border-dark-400 text-white text-sm placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-gold" />
                    </div>
                  </div>
                  <Button onClick={fetchAffectedBookings} className="w-full">Check Affected Bookings →</Button>
                </>
              )}
              {unavailModal.step === 2 && (
                <>
                  {unavailModal.affectedBookings.length === 0 ? (
                    <div className="py-6 text-center">
                      <p className="text-gray-400 text-sm mb-1">No confirmed bookings in this window.</p>
                      <p className="text-gray-500 text-xs">The unavailability override will still be saved.</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-sm text-gray-400">{unavailModal.affectedBookings.length} booking(s) will be affected. Choose an action for each:</p>
                      {unavailModal.affectedBookings.map((b) => {
                        const actionState = unavailModal.actions[b.id] ?? { action: 'cancel' };
                        const available   = unavailModal.availableBySlot[b.id] ?? [];
                        return (
                          <div key={b.id} className="p-3 bg-dark-200 rounded-xl border border-dark-400 space-y-2">
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <div className="text-sm font-medium">{b.customer?.full_name ?? 'Unknown'}</div>
                                <div className="text-xs text-gray-500">{b.customer?.email}</div>
                                <div className="text-xs text-gold mt-0.5">{format(new Date(b.start_time), 'h:mm a')}</div>
                              </div>
                              <select value={actionState.action} onChange={(e) => setUnavailModal((m) => { if (!m) return null; return { ...m, actions: { ...m.actions, [b.id]: { action: e.target.value as 'cancel' | 'offer_reschedule' | 'reassign' } } }; })} className="px-2 py-1.5 text-xs rounded-lg bg-dark-300 border border-dark-400 text-white focus:outline-none focus:ring-1 focus:ring-gold">
                                <option value="cancel">Cancel</option>
                                <option value="offer_reschedule">Offer Reschedule</option>
                                {available.length > 0 && <option value="reassign">Reassign</option>}
                              </select>
                            </div>
                            {actionState.action === 'reassign' && available.length > 0 && (
                              <div className="space-y-1">
                                <select value={actionState.newEmployeeId ?? ''} onChange={(e) => setUnavailModal((m) => { if (!m) return null; return { ...m, actions: { ...m.actions, [b.id]: { action: 'reassign', newEmployeeId: e.target.value } } }; })} className={`w-full px-2 py-1.5 text-xs rounded-lg bg-dark-300 border text-white focus:outline-none focus:ring-1 focus:ring-gold ${actionState.action === 'reassign' && !actionState.newEmployeeId ? 'border-red-500/60' : 'border-dark-400'}`}>
                                  <option value="">Select replacement barber…</option>
                                  {available.map((av) => <option key={av.id} value={av.id}>{av.name}</option>)}
                                </select>
                                {actionState.action === 'reassign' && !actionState.newEmployeeId && (
                                  <p className="text-xs text-red-400">Select a replacement barber</p>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <div className="flex gap-3 pt-2">
                    <Button variant="secondary" onClick={() => setUnavailModal((m) => m ? { ...m, step: 1 } : null)}>← Back</Button>
                    <Button onClick={submitUnavailability} loading={unavailModal.submitting} className="flex-1">Confirm &amp; Save Unavailability</Button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
