'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { format, addDays, startOfDay } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { createClient } from '@/lib/supabase/client';
import { formatTimeInZone } from '@/lib/utils';
import { formatPrice } from '@/lib/format';
import Button from '@/components/ui/Button';
import type { Shop, TimeSlot } from '@/types';
import {
  Tag, Calendar, Clock, User, ChevronRight, Loader2, CheckCircle, ArrowLeft,
} from 'lucide-react';

interface BookingWidgetProps {
  shop: Shop;
}

const DAYS_AHEAD  = 14;
const STORAGE_KEY = 'bb_pending_booking';

interface ServiceLite {
  id: string;
  name: string;
  description: string | null;
  duration_minutes: number;
  price: number | null;
}

interface BarberLite {
  id: string;
  name: string;
  bio: string | null;
  effective_duration: number;
}

interface PendingBooking {
  shopId:            string;
  shopSlug:          string;
  service:           ServiceLite;
  employeeId:        string;       // 'any' or specific UUID
  date:              string;
  startTime:         string;
  endTime:           string;
  employeeName:      string | null;
  effectiveDuration: number;
  notes:             string;
}

export default function BookingWidget({ shop }: BookingWidgetProps) {
  const router = useRouter();
  const supabase = createClient();

  // ── Services ───────────────────────────────────────────────────────────
  const [services,        setServices]        = useState<ServiceLite[]>([]);
  const [servicesLoading, setServicesLoading] = useState(true);
  const [servicesError,   setServicesError]   = useState(false);
  const [selectedService, setSelectedService] = useState<ServiceLite | null>(null);

  // ── Barbers (Step 2) ───────────────────────────────────────────────────
  const [barbers,                setBarbers]                = useState<BarberLite[]>([]);
  const [barbersLoading,         setBarbersLoading]         = useState(false);
  const [barbersError,           setBarbersError]           = useState(false);
  const [selectedEmployeeId,     setSelectedEmployeeId]     = useState<string>('');
  const [selectedBarberName,     setSelectedBarberName]     = useState<string>('');
  const [selectedBarberDuration, setSelectedBarberDuration] = useState<number>(0);

  // ── Date availability (Step 3) ─────────────────────────────────────────
  const [availability,        setAvailability]        = useState<Record<string, boolean>>({});
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [availabilityError,   setAvailabilityError]   = useState(false);
  const [selectedDate,        setSelectedDate]        = useState('');

  // ── Slots ──────────────────────────────────────────────────────────────
  const [slots,          setSlots]          = useState<TimeSlot[]>([]);
  const [loadingSlots,   setLoadingSlots]   = useState(false);
  const [slotFetchError, setSlotFetchError] = useState(false);
  const [selectedSlot,   setSelectedSlot]   = useState<TimeSlot | null>(null);
  const slotCache = useRef<Map<string, TimeSlot[]>>(new Map());

  // ── Booking flow ───────────────────────────────────────────────────────
  const [step,                  setStep]                  = useState(1);
  const [notes,                 setNotes]                 = useState('');
  const [booking,               setBooking]               = useState(false);
  const [error,                 setError]                 = useState('');
  const [pendingRescheduleId,   setPendingRescheduleId]   = useState<string | null>(null);
  const [sessionExpired,        setSessionExpired]        = useState(false);

  // ── Auth + restoration ─────────────────────────────────────────────────
  const [user,        setUser]        = useState<{ id: string; email: string } | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [restored,    setRestored]    = useState(false);
  const autoSkipped = useRef(false);

  // Refreshes once a minute so the date grid never shows yesterday when the page
  // has been open across midnight.
  const [today, setToday] = useState(() => startOfDay(new Date()));
  useEffect(() => {
    const interval = setInterval(() => {
      const newToday = startOfDay(new Date());
      if (newToday.getTime() !== today.getTime()) setToday(newToday);
    }, 60_000);
    return () => clearInterval(interval);
  }, [today]);

  const availableDates = useMemo(
    () =>
      Array.from({ length: DAYS_AHEAD }, (_, i) => {
        const d = addDays(today, i);
        return format(toZonedTime(d, shop.timezone), 'yyyy-MM-dd');
      }),
    [today, shop.timezone]
  );

  // ── Fetch services on mount ────────────────────────────────────────────
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch(`/api/services?shopId=${shop.id}`, { signal: controller.signal });
        if (!res.ok) throw new Error('Failed');
        const data: ServiceLite[] = await res.json();
        setServices(data);
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        setServicesError(true);
      } finally {
        if (!controller.signal.aborted) setServicesLoading(false);
      }
    })();
    return () => controller.abort();
  }, [shop.id]);

  // ── Auth check + session restore ───────────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      const u = session?.user ? { id: session.user.id, email: session.user.email! } : null;
      setUser(u);

      if (u) {
        try {
          const raw = sessionStorage.getItem(STORAGE_KEY);
          if (raw) {
            const pending: PendingBooking = JSON.parse(raw);
            if (pending.shopId === shop.id && pending.service?.id) {
              setSelectedService(pending.service);
              setSelectedDate(pending.date);
              setSelectedEmployeeId(pending.employeeId ?? 'any');
              setSelectedBarberName(pending.employeeName ?? '');
              setSelectedBarberDuration(pending.effectiveDuration);
              setSelectedSlot({
                start:        pending.startTime,
                end:          pending.endTime,
                employeeId:   pending.employeeId !== 'any' ? pending.employeeId : undefined,
                employeeName: pending.employeeName ?? undefined,
              });
              setNotes(pending.notes ?? '');
              setStep(5);
              setRestored(true);
              autoSkipped.current = true;
              sessionStorage.removeItem(STORAGE_KEY);
            }
          }
        } catch {
          sessionStorage.removeItem(STORAGE_KEY);
        }
      }
      setAuthChecked(true);
    });
  }, [shop.id, supabase]);

  // ── Auto-skip Step 1 for single-service shops ──────────────────────────
  useEffect(() => {
    if (autoSkipped.current) return;
    if (servicesLoading || !authChecked || restored) return;
    if (services.length === 1 && !selectedService) {
      autoSkipped.current = true;
      setSelectedService(services[0]);
      setStep(2);
    }
  }, [services, servicesLoading, authChecked, restored, selectedService]);

  // ── Step 1: pick service ───────────────────────────────────────────────
  function handleServiceSelect(svc: ServiceLite) {
    if (selectedService?.id !== svc.id) {
      // Service changed — clear everything downstream
      setBarbers([]);
      setSelectedEmployeeId('');
      setSelectedBarberName('');
      setSelectedBarberDuration(0);
      setAvailability({});
      setSelectedDate('');
      setSlots([]);
      setSelectedSlot(null);
      slotCache.current.clear();
    }
    setSelectedService(svc);
    setStep(2);
  }

  // ── Step 2: fetch full shop roster when entering ───────────────────────
  // (No date yet — we want every barber at the shop so the user can pick.)
  useEffect(() => {
    if (step !== 2 || !selectedService) return;
    if (barbers.length > 0) return;

    const controller = new AbortController();
    (async () => {
      setBarbersLoading(true);
      setBarbersError(false);
      try {
        const params = new URLSearchParams({
          shopId:    shop.id,
          serviceId: selectedService.id,
        });
        const res = await fetch(`/api/employees/available?${params}`, { signal: controller.signal });
        if (!res.ok) throw new Error('Failed');
        const data: BarberLite[] = await res.json();
        setBarbers(data);
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        setBarbersError(true);
      } finally {
        if (!controller.signal.aborted) setBarbersLoading(false);
      }
    })();
    return () => controller.abort();
  }, [step, selectedService, barbers.length, shop.id]);

  function handleBarberSelect(emp: BarberLite | 'any') {
    const newId   = emp === 'any' ? 'any' : emp.id;
    const changed = selectedEmployeeId !== newId;

    if (emp === 'any') {
      setSelectedEmployeeId('any');
      setSelectedBarberName('Any available');
      setSelectedBarberDuration(selectedService?.duration_minutes ?? 0);
    } else {
      setSelectedEmployeeId(emp.id);
      setSelectedBarberName(emp.name);
      setSelectedBarberDuration(emp.effective_duration);
    }

    if (changed) {
      // Barber changed — invalidate the date availability map and downstream
      setAvailability({});
      setSelectedDate('');
      setSlots([]);
      setSelectedSlot(null);
      slotCache.current.clear();
    }
    setStep(3);
  }

  // ── Step 3: fetch date availability for selected barber when entering ──
  useEffect(() => {
    if (step !== 3 || !selectedService || !selectedEmployeeId) return;
    if (Object.keys(availability).length > 0) return;

    const controller = new AbortController();
    (async () => {
      setAvailabilityLoading(true);
      setAvailabilityError(false);
      try {
        const params = new URLSearchParams({
          shopId:    shop.id,
          serviceId: selectedService.id,
          startDate: availableDates[0],
          endDate:   availableDates[availableDates.length - 1],
        });
        // Specific barber → include employeeId so the API restricts to that barber.
        // "any" → omit; API checks across the whole shop.
        if (selectedEmployeeId !== 'any') {
          params.set('employeeId', selectedEmployeeId);
        }
        const res = await fetch(`/api/availability?${params}`, { signal: controller.signal });
        if (!res.ok) throw new Error('Failed');
        const data = await res.json();
        setAvailability(data.dates ?? {});
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        setAvailabilityError(true);
      } finally {
        if (!controller.signal.aborted) setAvailabilityLoading(false);
      }
    })();
    return () => controller.abort();
  }, [step, selectedService, selectedEmployeeId, availability, shop.id, availableDates]);

  function handleDateSelect(date: string) {
    if (!availability[date]) return;
    if (selectedDate !== date) {
      // Date changed — clear slots only (barber + service unchanged)
      setSlots([]);
      setSelectedSlot(null);
      slotCache.current.clear();
    }
    setSelectedDate(date);
    setStep(4);
  }

  // ── Step 4: fetch slots when entering ──────────────────────────────────
  const fetchSlots = useCallback(async (signal?: AbortSignal): Promise<TimeSlot[] | null> => {
    if (!selectedService || !selectedDate || !selectedEmployeeId) return null;
    try {
      const params = new URLSearchParams({
        shopId:     shop.id,
        date:       selectedDate,
        employeeId: selectedEmployeeId,
        serviceId:  selectedService.id,
      });
      const res = await fetch(`/api/slots?${params}`, { signal });
      if (!res.ok) throw new Error('Failed');
      return await res.json();
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return null;
      return null;
    }
  }, [shop.id, selectedDate, selectedEmployeeId, selectedService]);

  useEffect(() => {
    if (step !== 4 || !selectedService || !selectedDate || !selectedEmployeeId) return;
    const cacheKey = `${selectedDate}-${selectedEmployeeId}-${selectedService.id}`;
    if (slotCache.current.has(cacheKey)) {
      setSlots(slotCache.current.get(cacheKey)!);
      return;
    }
    const controller = new AbortController();
    (async () => {
      setLoadingSlots(true);
      setSlotFetchError(false);
      const result = await fetchSlots(controller.signal);
      if (controller.signal.aborted) return;
      setLoadingSlots(false);
      if (result === null) {
        setSlotFetchError(true);
        return;
      }
      slotCache.current.set(cacheKey, result);
      setSlots(result);
    })();
    return () => controller.abort();
  }, [step, selectedService, selectedDate, selectedEmployeeId, fetchSlots]);

  async function retrySlots() {
    if (!selectedService) return;
    const cacheKey = `${selectedDate}-${selectedEmployeeId}-${selectedService.id}`;
    slotCache.current.delete(cacheKey);
    setLoadingSlots(true);
    setSlotFetchError(false);
    const result = await fetchSlots();
    setLoadingSlots(false);
    if (result === null) {
      setSlotFetchError(true);
      return;
    }
    slotCache.current.set(cacheKey, result);
    setSlots(result);
  }

  function handleSlotSelect(slot: TimeSlot) {
    setSelectedSlot(slot);
    setError('');
    setStep(5);
  }

  function goToStep(target: number) {
    if (target === 1 && services.length <= 1) return;
    setStep(target);
  }

  async function handleConfirmBooking() {
    if (!selectedSlot || !selectedService) return;

    if (!user) {
      const pending: PendingBooking = {
        shopId:            shop.id,
        shopSlug:          shop.slug,
        service:           selectedService,
        employeeId:        selectedEmployeeId,
        date:              selectedDate,
        startTime:         selectedSlot.start,
        endTime:           selectedSlot.end,
        employeeName:      selectedSlot.employeeName ?? selectedBarberName ?? null,
        effectiveDuration: selectedBarberDuration,
        notes,
      };
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(pending));

      const returnTo = encodeURIComponent(`/shop/${shop.slug}`);
      router.push(`/auth/login?returnTo=${returnTo}`);
      return;
    }

    setBooking(true);
    setError('');
    try {
      const res = await fetch('/api/bookings', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          shopId:     shop.id,
          serviceId:  selectedService.id,
          employeeId: selectedEmployeeId,
          startTime:  selectedSlot.start,
          notes,
        }),
      });

      if (res.status === 401) {
        setSessionExpired(true);
        setBooking(false);
        return;
      }

      if (!res.ok) {
        const data = await res.json();
        if (data.pendingBookingId) {
          setPendingRescheduleId(data.pendingBookingId);
          setError(data.error);
          setBooking(false);
          return;
        }
        throw new Error(data.error ?? 'Booking failed');
      }

      const { bookingId } = await res.json();
      router.push(`/booking/${bookingId}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Booking failed');
      setBooking(false);
    }
  }

  const stepLabels = ['Service', 'Barber', 'Date', 'Time', 'Confirm'];

  return (
    <div className="bg-dark-100 border border-dark-300 rounded-2xl overflow-hidden">
      {restored && (
        <div className="flex items-center gap-2 px-5 py-3 bg-green-500/10 border-b border-green-500/20 text-green-400 text-sm">
          <CheckCircle className="w-4 h-4 flex-shrink-0" />
          Your selection has been restored — just confirm below to complete your booking.
        </div>
      )}

      {/* Progress stepper */}
      <div className="flex border-b border-dark-300 overflow-x-auto">
        {stepLabels.map((label, i) => {
          const stepNum      = i + 1;
          const isActive     = step === stepNum;
          const isDone       = step > stepNum;
          const canClickBack = isDone && !(stepNum === 1 && services.length <= 1);
          return (
            <button
              key={label}
              onClick={() => canClickBack && goToStep(stepNum)}
              className={`flex-1 py-3 text-xs font-medium transition-colors min-w-[80px] ${
                isActive
                  ? 'text-gold border-b-2 border-gold bg-gold-muted'
                  : isDone
                  ? canClickBack
                    ? 'text-gray-300 cursor-pointer hover:text-gold'
                    : 'text-gray-300 cursor-default'
                  : 'text-gray-600 cursor-default'
              }`}
            >
              <span
                className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-xs mr-1.5 ${
                  isActive
                    ? 'bg-gold text-dark'
                    : isDone
                    ? 'bg-dark-300 text-gray-300'
                    : 'bg-dark-300 text-gray-600'
                }`}
              >
                {stepNum}
              </span>
              {label}
            </button>
          );
        })}
      </div>

      <div className="p-6">
        {/* ── Step 1: Service ─────────────────────────────────────────── */}
        {step === 1 && (
          <div className="animate-fade-in">
            <h3 className="font-semibold mb-4 flex items-center gap-2">
              <Tag className="w-4 h-4 text-gold" /> Choose a service
            </h3>
            {servicesLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 text-gold animate-spin" />
              </div>
            ) : servicesError ? (
              <div className="text-center py-10">
                <p className="text-red-400 text-sm mb-3">Could not load services. Please try again.</p>
                <Button variant="secondary" size="sm" onClick={() => window.location.reload()}>Retry</Button>
              </div>
            ) : services.length === 0 ? (
              <p className="text-gray-400 text-sm py-6 text-center">No services available right now.</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {services.map((svc) => {
                  const priceLabel = formatPrice(svc.price);
                  const isSelected = selectedService?.id === svc.id;
                  return (
                    <button
                      key={svc.id}
                      onClick={() => handleServiceSelect(svc)}
                      className={`flex flex-col items-start gap-1.5 p-4 rounded-xl border transition-all text-left ${
                        isSelected
                          ? 'border-gold bg-gold-muted text-gold'
                          : 'border-dark-400 hover:border-dark-500 text-white'
                      }`}
                    >
                      <div className="flex items-center justify-between w-full">
                        <span className="font-medium">{svc.name}</span>
                        {priceLabel && <span className="text-sm">{priceLabel}</span>}
                      </div>
                      {svc.description && (
                        <span className="text-xs text-gray-500 line-clamp-2">{svc.description}</span>
                      )}
                      <span className="text-xs text-gray-500 mt-1">{svc.duration_minutes} min</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Step 2: Barber ──────────────────────────────────────────── */}
        {step === 2 && (
          <div className="animate-fade-in">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold flex items-center gap-2">
                <User className="w-4 h-4 text-gold" /> Choose a barber
              </h3>
              {services.length > 1 && (
                <button
                  onClick={() => goToStep(1)}
                  className="text-xs text-gray-400 hover:text-gold flex items-center gap-1"
                >
                  <ArrowLeft className="w-3 h-3" /> Back
                </button>
              )}
            </div>
            {barbersLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 text-gold animate-spin" />
              </div>
            ) : barbersError ? (
              <div className="text-center py-10">
                <p className="text-red-400 text-sm mb-3">Could not load barbers.</p>
                <Button variant="secondary" size="sm" onClick={() => setBarbers([])}>Retry</Button>
              </div>
            ) : barbers.length === 0 ? (
              <p className="text-gray-400 text-sm py-6 text-center">No barbers at this shop yet.</p>
            ) : (
              <div className="space-y-2">
                <button
                  onClick={() => handleBarberSelect('any')}
                  className={`w-full flex items-center gap-3 p-4 rounded-xl border transition-all ${
                    selectedEmployeeId === 'any'
                      ? 'border-gold bg-gold-muted text-gold'
                      : 'border-dark-400 hover:border-dark-500 text-white'
                  }`}
                >
                  <div className="w-10 h-10 rounded-full bg-dark-300 flex items-center justify-center text-lg">✂</div>
                  <div className="text-left">
                    <div className="font-medium">Any Available Barber</div>
                    <div className="text-xs text-gray-500">We&apos;ll show all open dates</div>
                  </div>
                  <ChevronRight className="w-4 h-4 ml-auto text-gray-500" />
                </button>

                {barbers.map((emp) => (
                  <button
                    key={emp.id}
                    onClick={() => handleBarberSelect(emp)}
                    className={`w-full flex items-center gap-3 p-4 rounded-xl border transition-all ${
                      selectedEmployeeId === emp.id
                        ? 'border-gold bg-gold-muted text-gold'
                        : 'border-dark-400 hover:border-dark-500 text-white'
                    }`}
                  >
                    <div className="w-10 h-10 rounded-full bg-gold-muted border border-gold/20 flex items-center justify-center font-bold text-gold">
                      {emp.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="text-left">
                      <div className="font-medium">{emp.name}</div>
                      {emp.bio && (
                        <div className="text-xs text-gray-500 truncate max-w-[180px]">{emp.bio}</div>
                      )}
                    </div>
                    <ChevronRight className="w-4 h-4 ml-auto text-gray-500" />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Step 3: Date ────────────────────────────────────────────── */}
        {step === 3 && (
          <div className="animate-fade-in">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold flex items-center gap-2">
                <Calendar className="w-4 h-4 text-gold" /> Choose a date
                {selectedEmployeeId && selectedEmployeeId !== 'any' && selectedBarberName && (
                  <span className="text-sm text-gray-400 font-normal ml-1">
                    — {selectedBarberName}
                  </span>
                )}
              </h3>
              <button
                onClick={() => goToStep(2)}
                className="text-xs text-gray-400 hover:text-gold flex items-center gap-1"
              >
                <ArrowLeft className="w-3 h-3" /> Back
              </button>
            </div>
            {availabilityLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 text-gold animate-spin" />
              </div>
            ) : availabilityError ? (
              <div className="text-center py-10">
                <p className="text-red-400 text-sm mb-3">Could not load availability.</p>
                <Button variant="secondary" size="sm" onClick={() => setAvailability({})}>Retry</Button>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                  {availableDates.map((date) => {
                    const d         = new Date(date + 'T12:00:00');
                    const available = availability[date] === true;
                    const isSelected = selectedDate === date;
                    return (
                      <button
                        key={date}
                        onClick={() => handleDateSelect(date)}
                        disabled={!available}
                        className={`flex flex-col items-center py-3 px-2 rounded-xl border transition-all ${
                          isSelected
                            ? 'border-gold bg-gold-muted text-gold'
                            : available
                            ? 'border-dark-400 hover:border-gold/40 hover:bg-dark-200 text-white'
                            : 'border-dark-300 bg-dark-200/40 text-gray-600 cursor-not-allowed'
                        }`}
                      >
                        <span className="text-xs text-gray-400">{format(d, 'EEE')}</span>
                        <span className="text-xl font-bold">{format(d, 'd')}</span>
                        <span className="text-xs text-gray-400">{format(d, 'MMM')}</span>
                      </button>
                    );
                  })}
                </div>
                {Object.keys(availability).length > 0 && !Object.values(availability).some(Boolean) && (
                  <p className="text-gray-400 text-sm text-center mt-4">
                    {selectedEmployeeId === 'any'
                      ? 'No available dates in the next 14 days. Please check back later.'
                      : `${selectedBarberName} has no availability in the next 14 days. Try another barber.`}
                  </p>
                )}
              </>
            )}
          </div>
        )}

        {/* ── Step 4: Time ────────────────────────────────────────────── */}
        {step === 4 && (
          <div className="animate-fade-in">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold flex items-center gap-2">
                <Clock className="w-4 h-4 text-gold" /> Choose a time
                {selectedDate && (
                  <span className="text-sm text-gray-400 font-normal ml-1">
                    — {format(new Date(selectedDate + 'T12:00:00'), 'EEEE, MMM d')}
                  </span>
                )}
              </h3>
              <button
                onClick={() => goToStep(3)}
                className="text-xs text-gray-400 hover:text-gold flex items-center gap-1"
              >
                <ArrowLeft className="w-3 h-3" /> Back
              </button>
            </div>

            {loadingSlots ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 text-gold animate-spin" />
              </div>
            ) : slotFetchError ? (
              <div className="text-center py-10">
                <p className="text-red-400 text-sm mb-4">
                  Could not load available times. Please try again.
                </p>
                <Button variant="secondary" size="sm" onClick={retrySlots}>Retry</Button>
              </div>
            ) : slots.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-gray-400 mb-4">No available slots for this date.</p>
                <Button variant="secondary" size="sm" onClick={() => goToStep(3)}>Pick another date</Button>
              </div>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {slots.map((slot) => (
                  <button
                    key={slot.start}
                    onClick={() => handleSlotSelect(slot)}
                    className={`py-2.5 px-2 rounded-lg border text-sm font-medium transition-all ${
                      selectedSlot?.start === slot.start ? 'slot-selected' : 'slot-available'
                    }`}
                  >
                    {formatTimeInZone(slot.start, shop.timezone)}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Step 5: Confirm ─────────────────────────────────────────── */}
        {step === 5 && selectedSlot && selectedService && (
          <div className="animate-fade-in">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold">Confirm your booking</h3>
              <button
                onClick={() => goToStep(4)}
                className="text-xs text-gray-400 hover:text-gold flex items-center gap-1"
              >
                <ArrowLeft className="w-3 h-3" /> Back
              </button>
            </div>

            <div className="space-y-3 p-4 bg-dark-200 rounded-xl border border-dark-400 mb-5">
              <Row label="Shop"    value={shop.name} />
              <Row label="Service" value={selectedService.name} />
              <Row
                label="Barber"
                value={selectedSlot.employeeName ?? selectedBarberName ?? 'Any available'}
              />
              <Row
                label="Date"
                value={format(new Date(selectedDate + 'T12:00:00'), 'EEEE, MMMM d, yyyy')}
              />
              <Row
                label="Time"
                value={`${formatTimeInZone(selectedSlot.start, shop.timezone)} — ${formatTimeInZone(selectedSlot.end, shop.timezone)}`}
                gold
              />
              <Row
                label="Duration"
                value={`${selectedBarberDuration || selectedService.duration_minutes} minutes`}
              />
              {selectedService.price != null && (
                <Row label="Price" value={formatPrice(selectedService.price)} />
              )}
            </div>

            <div className="mb-5">
              <label className="text-sm font-medium text-gray-300 block mb-2">
                Notes <span className="text-gray-500 font-normal">(optional)</span>
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Any special requests or style notes..."
                rows={3}
                className="w-full px-4 py-2.5 rounded-lg bg-dark-200 border border-dark-400 text-white placeholder-gray-600 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-gold focus:border-transparent"
              />
            </div>

            {!user && (
              <div className="p-4 rounded-xl bg-gold-muted border border-gold/20 mb-4">
                <p className="text-sm text-gold font-medium mb-1">Almost there!</p>
                <p className="text-xs text-gold/70">
                  Sign in or create a free account to confirm. Your selection will be saved
                  and you&apos;ll be brought straight back here.
                </p>
              </div>
            )}

            {sessionExpired && (
              <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 mb-4">
                <p className="text-sm text-amber-400 font-medium mb-3">
                  Your session has expired. Please sign in again to complete your booking.
                </p>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => router.push(`/auth/login?returnTo=/shop/${shop.slug}`)}
                >
                  Sign In
                </Button>
              </div>
            )}

            {error && !sessionExpired && (
              <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm mb-4">
                {error}
                {pendingRescheduleId && (
                  <div className="mt-2">
                    <button
                      onClick={() => router.push(`/booking/${pendingRescheduleId}`)}
                      className="text-gold underline font-medium"
                    >
                      View Appointment →
                    </button>
                  </div>
                )}
              </div>
            )}

            <div className="flex gap-3">
              <Button
                variant="secondary"
                onClick={() => { goToStep(4); setError(''); setPendingRescheduleId(null); setSessionExpired(false); }}
                className="flex-1"
              >
                Back
              </Button>
              <Button
                onClick={handleConfirmBooking}
                loading={booking}
                disabled={!authChecked}
                style={{ flex: 2 }}
              >
                {!authChecked ? 'Loading…' : user ? 'Confirm Booking' : 'Sign In & Confirm'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value, gold }: { label: string; value: string; gold?: boolean }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-gray-400">{label}</span>
      <span className={`font-medium ${gold ? 'text-gold' : ''}`}>{value}</span>
    </div>
  );
}
