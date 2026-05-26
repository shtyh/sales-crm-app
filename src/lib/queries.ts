// React Query hooks for everything we read from / write to Supabase.
// Pages should import these instead of calling the raw fetchers directly,
// so navigating away and back doesn't re-trigger the network round-trip.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createBooking,
  deleteBooking,
  getBooking,
  listBookings,
  updateBooking,
} from './bookings'
import { listProfiles, updateProfile } from './profiles'
import { listAttachments } from './attachments'
import { createCar, getCar, listCars, updateCar } from './cars'
import {
  getCustomer,
  getCustomerByNric,
  listCustomers,
  updateCustomer,
  upsertCustomerByNric,
} from './customers'
import { listAuditForRow } from './audit'
import {
  createPayoutAndAssign,
  createSchedule,
  deleteSchedule,
  listPayouts,
  listSchedules,
  updateSchedule,
} from './commissions'
import type {
  Attachment,
  AuditLogEntry,
  Booking,
  BookingInsert,
  Car,
  CarInsert,
  CommissionPayout,
  CommissionPayoutInsert,
  CommissionSchedule,
  CommissionScheduleInsert,
  Customer,
  CustomerInsert,
  Profile,
} from './types'

// Query keys — centralised so we can invalidate from anywhere without
// having to remember the tuple shape.
export const qk = {
  bookings: ['bookings'] as const,
  booking: (id: string) => ['bookings', id] as const,
  profiles: ['profiles'] as const,
  attachments: (bookingId: string) =>
    ['booking-attachments', bookingId] as const,
  cars: ['cars'] as const,
  car: (id: string) => ['cars', id] as const,
  audit: (tableName: string, rowId: string) =>
    ['audit', tableName, rowId] as const,
  commissionSchedules: ['commission-schedules'] as const,
  commissionPayouts: ['commission-payouts'] as const,
  customers: ['customers'] as const,
  customer: (id: string) => ['customers', id] as const,
  customerByNric: (nric: string) => ['customers', 'by-nric', nric] as const,
}

// ---------- Bookings -------------------------------------------------------

export function useBookings() {
  return useQuery<Booking[]>({
    queryKey: qk.bookings,
    queryFn: listBookings,
  })
}

export function useBooking(id: string) {
  return useQuery<Booking | null>({
    queryKey: qk.booking(id),
    queryFn: () => getBooking(id),
    enabled: !!id,
  })
}

export function useCreateBooking() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: BookingInsert) => createBooking(input),
    onSuccess: (created) => {
      qc.setQueryData<Booking>(qk.booking(created.id), created)
      qc.invalidateQueries({ queryKey: qk.bookings })
    },
  })
}

export function useUpdateBooking() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      patch,
    }: {
      id: string
      patch: Partial<BookingInsert>
    }) => updateBooking(id, patch),
    onSuccess: (updated) => {
      qc.setQueryData<Booking>(qk.booking(updated.id), updated)
      qc.invalidateQueries({ queryKey: qk.bookings })
    },
  })
}

export function useDeleteBooking() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteBooking(id),
    onSuccess: (_, id) => {
      qc.removeQueries({ queryKey: qk.booking(id) })
      qc.invalidateQueries({ queryKey: qk.bookings })
    },
  })
}

// ---------- Profiles -------------------------------------------------------

export function useProfiles(enabled = true) {
  return useQuery<Profile[]>({
    queryKey: qk.profiles,
    queryFn: listProfiles,
    enabled,
  })
}

export function useUpdateProfile() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      patch,
    }: {
      id: string
      patch: Partial<Pick<Profile, 'full_name' | 'role'>>
    }) => updateProfile(id, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.profiles })
    },
  })
}

// ---------- Attachments ----------------------------------------------------

export function useAttachments(bookingId: string) {
  return useQuery<Attachment[]>({
    queryKey: qk.attachments(bookingId),
    queryFn: () => listAttachments(bookingId),
    enabled: !!bookingId,
  })
}

// ---------- Cars (inventory) -----------------------------------------------

export function useCars(enabled = true) {
  return useQuery<Car[]>({
    queryKey: qk.cars,
    queryFn: listCars,
    enabled,
  })
}

export function useCar(id: string) {
  return useQuery<Car | null>({
    queryKey: qk.car(id),
    queryFn: () => getCar(id),
    enabled: !!id,
  })
}

export function useCreateCar() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CarInsert) => createCar(input),
    onSuccess: (created) => {
      qc.setQueryData<Car>(qk.car(created.id), created)
      qc.invalidateQueries({ queryKey: qk.cars })
    },
  })
}

export function useUpdateCar() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<CarInsert> }) =>
      updateCar(id, patch),
    onSuccess: (updated) => {
      qc.setQueryData<Car>(qk.car(updated.id), updated)
      qc.invalidateQueries({ queryKey: qk.cars })
    },
  })
}

// ---------- Commission schedules -------------------------------------------

export function useCommissionSchedules(enabled = true) {
  return useQuery<CommissionSchedule[]>({
    queryKey: qk.commissionSchedules,
    queryFn: listSchedules,
    enabled,
  })
}

export function useCreateSchedule() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CommissionScheduleInsert) => createSchedule(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.commissionSchedules })
    },
  })
}

export function useUpdateSchedule() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      patch,
    }: {
      id: string
      patch: Partial<CommissionScheduleInsert>
    }) => updateSchedule(id, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.commissionSchedules })
    },
  })
}

export function useDeleteSchedule() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteSchedule(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.commissionSchedules })
    },
  })
}

// ---------- Commission payouts ---------------------------------------------

export function useCommissionPayouts(enabled = true) {
  return useQuery<CommissionPayout[]>({
    queryKey: qk.commissionPayouts,
    queryFn: listPayouts,
    enabled,
  })
}

export function useCreatePayout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      input,
      bookingIds,
    }: {
      input: CommissionPayoutInsert
      bookingIds: string[]
    }) => createPayoutAndAssign(input, bookingIds),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.commissionPayouts })
      qc.invalidateQueries({ queryKey: qk.bookings })
    },
  })
}

// ---------- Customers ------------------------------------------------------

export function useCustomers(enabled = true) {
  return useQuery<Customer[]>({
    queryKey: qk.customers,
    queryFn: listCustomers,
    enabled,
  })
}

export function useCustomer(id: string | null | undefined) {
  return useQuery<Customer | null>({
    queryKey: qk.customer(id ?? ''),
    queryFn: () => getCustomer(id as string),
    enabled: !!id,
  })
}

/**
 * Look up a customer by NRIC. Used by NewBookingPage to pre-fill the form
 * when the SA types in an NRIC that already exists. NRIC is trimmed before
 * use; an empty string disables the query so React Query doesn't fire for
 * every keystroke.
 */
export function useCustomerByNric(nric: string) {
  const trimmed = nric.trim()
  return useQuery<Customer | null>({
    queryKey: qk.customerByNric(trimmed),
    queryFn: () => getCustomerByNric(trimmed),
    enabled: trimmed.length > 0,
    // Don't refetch every focus — the moment the user navigates back, they
    // probably just want what's already cached.
    staleTime: 30_000,
  })
}

export function useUpsertCustomerByNric() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CustomerInsert) => upsertCustomerByNric(input),
    onSuccess: (saved) => {
      qc.setQueryData<Customer>(qk.customer(saved.id), saved)
      qc.setQueryData<Customer>(qk.customerByNric(saved.nric), saved)
      qc.invalidateQueries({ queryKey: qk.customers })
    },
  })
}

export function useUpdateCustomer() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      patch,
    }: {
      id: string
      patch: Partial<CustomerInsert>
    }) => updateCustomer(id, patch),
    onSuccess: (saved) => {
      qc.setQueryData<Customer>(qk.customer(saved.id), saved)
      qc.setQueryData<Customer>(qk.customerByNric(saved.nric), saved)
      qc.invalidateQueries({ queryKey: qk.customers })
      // A customer change might affect how bookings render (customer name on
      // the list), so invalidate that too.
      qc.invalidateQueries({ queryKey: qk.bookings })
    },
  })
}

// ---------- Audit log ------------------------------------------------------

/**
 * Recent audit entries for a specific row. `enabled` should usually be the
 * caller's `isSuperAdmin` flag — RLS would return [] for everyone else anyway,
 * but skipping the request avoids the round-trip.
 */
export function useAuditForRow(
  tableName: string,
  rowId: string,
  enabled = true,
) {
  return useQuery<AuditLogEntry[]>({
    queryKey: qk.audit(tableName, rowId),
    queryFn: () => listAuditForRow(tableName, rowId),
    enabled: enabled && !!rowId,
    // Audit data isn't latency-critical; keep it fresh for a minute so we
    // refresh after navigating back from making changes.
    staleTime: 60_000,
  })
}
